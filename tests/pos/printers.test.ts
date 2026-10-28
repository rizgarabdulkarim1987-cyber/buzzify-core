import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { printerForReceipt, printerForSection, type PrinterView } from '@/server/pos/printers';
import { createKitchenSection, deleteKitchenSection, removePosPrinter, savePosPrinter } from '@/server/studio/actions/pos';
import { posPrinters } from '@/server/studio/queries/pos';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, run, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

const RECEIPT = { name: 'Front', role: 'RECEIPT', transport: 'NETWORK', address: '192.168.1.50:9100', paperWidth: 80, cut: true, drawerPin: 2, isDefault: true, sectionId: null } as const;

let a: { id: string };
let owner: Person;
let manager: Person;
let cashier: Person;
let kitchen: Person;

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await resetWorld();
  a = await restaurant('Till A');
  owner = await person('owner', { membership: [a.id, 'OWNER'] });
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
  kitchen = await person('kitchen', { staff: [a.id, 'KITCHEN'] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

describe('savePosPrinter', () => {
  it('saves a printer and lists it for every role', async () => {
    const { printerId } = dataOf(await run(manager, savePosPrinter, RECEIPT));
    for (const who of [owner, cashier, kitchen]) {
      const list = dataOf(await ask(who, posPrinters, {}));
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: printerId, name: 'Front', paperWidth: 80, drawerPin: 2, isDefault: true });
    }
  });

  it('makes the newest default receipt printer the only one', async () => {
    const first = dataOf(await run(manager, savePosPrinter, RECEIPT)).printerId;
    const second = dataOf(await run(manager, savePosPrinter, { ...RECEIPT, name: 'Back', address: '192.168.1.51:9100' })).printerId;
    const list = dataOf(await ask(owner, posPrinters, {}));
    expect(list.find((p) => p.id === first)?.isDefault).toBe(false);
    expect(list.find((p) => p.id === second)?.isDefault).toBe(true);
  });

  it('edits a printer in place when given its id', async () => {
    const { printerId } = dataOf(await run(manager, savePosPrinter, RECEIPT));
    await run(manager, savePosPrinter, { ...RECEIPT, printerId, name: 'Renamed' });
    const list = dataOf(await ask(owner, posPrinters, {}));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Renamed');
  });

  it('refuses a paper width or a drawer pin the hardware does not have', async () => {
    expect(codeOf(await run(manager, savePosPrinter, { ...RECEIPT, paperWidth: 72 }))).toBe('INVALID');
    expect(codeOf(await run(manager, savePosPrinter, { ...RECEIPT, drawerPin: 3 }))).toBe('INVALID');
  });

  it('refuses a network address that is not host:port and an empty file address', async () => {
    expect(codeOf(await run(manager, savePosPrinter, { ...RECEIPT, address: '192.168.1.50' }))).toBe('INVALID');
    expect(codeOf(await run(manager, savePosPrinter, { ...RECEIPT, transport: 'FILE', address: '' }))).toBe('INVALID');
    expect(codeOf(await run(manager, savePosPrinter, { ...RECEIPT, transport: 'FILE', address: '\\\\localhost\\XP80' }))).toBe('OK');
  });

  it('is for those who manage settings, not the cashier', async () => {
    expect(codeOf(await run(cashier, savePosPrinter, RECEIPT))).toBe('FORBIDDEN');
  });
});

describe('removePosPrinter', () => {
  it('removes a printer', async () => {
    const { printerId } = dataOf(await run(manager, savePosPrinter, RECEIPT));
    expect(codeOf(await run(manager, removePosPrinter, { printerId }))).toBe('OK');
    expect(dataOf(await ask(owner, posPrinters, {}))).toHaveLength(0);
  });
});

describe('a kitchen printer and its section', () => {
  it('keeps the printer, with no section, when the section is deleted', async () => {
    const { sectionId } = dataOf(await run(manager, createKitchenSection, { name: 'Grill' }));
    const { printerId } = dataOf(await run(manager, savePosPrinter, { ...RECEIPT, role: 'KITCHEN', name: 'Grill printer', drawerPin: null, isDefault: false, sectionId }));
    expect(codeOf(await run(manager, deleteKitchenSection, { sectionId }))).toBe('OK');
    const list = dataOf(await ask(owner, posPrinters, {}));
    expect(list.find((p) => p.id === printerId)?.sectionId).toBeNull();
  });

  it('refuses a section from another restaurant', async () => {
    expect(codeOf(await run(manager, savePosPrinter, { ...RECEIPT, role: 'KITCHEN', isDefault: false, sectionId: 'nope-not-here' }))).not.toBe('OK');
  });
});

describe('choosing a printer', () => {
  const view = (over: Partial<PrinterView>): PrinterView => ({
    id: 'x', name: 'P', role: 'KITCHEN', transport: 'NETWORK', address: '1.1.1.1:9100', paperWidth: 80, cut: true, drawerPin: null, isDefault: false, sectionId: null, sortOrder: 0, ...over,
  });

  it('takes the default receipt printer', () => {
    const printers = [view({ id: 'k', role: 'KITCHEN' }), view({ id: 'r1', role: 'RECEIPT' }), view({ id: 'r2', role: 'RECEIPT', isDefault: true })];
    expect(printerForReceipt(printers)?.id).toBe('r2');
    expect(printerForReceipt([view({ role: 'KITCHEN' })])).toBeNull();
  });

  it('takes the section printer, else the unsectioned kitchen printer, else none', () => {
    const printers = [view({ id: 'any' }), view({ id: 'grill', sectionId: 's1' })];
    expect(printerForSection(printers, 's1')?.id).toBe('grill');
    expect(printerForSection(printers, 's2')?.id).toBe('any');
    expect(printerForSection(printers, null)?.id).toBe('any');
    expect(printerForSection([view({ id: 'grill', sectionId: 's1' })], 's2')).toBeNull();
    expect(printerForSection([view({ id: 'r', role: 'RECEIPT' })], 's1')).toBeNull();
  });
});
