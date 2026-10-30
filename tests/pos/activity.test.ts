import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listActivityIn } from '@/server/pos/activity';
import { posActivity } from '@/server/studio/queries/pos-activity';
import { ask, codeOf, dataOf, person, prisma, resetWorld, restaurant, useTestDatabase, type Person } from './fixture';

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

let a: { id: string };
let b: { id: string };
let manager: Person;
let cashier: Person;
let clock = Date.parse('2026-10-27T10:00:00Z');

async function row(restaurantId: string, action: string, actorId: string | null, changes: object = {}) {
  clock += 1000;
  return prisma().auditLog.create({ data: { restaurantId, actorId, action, entityType: 'PosOrder', entityId: 'e1', changes, occurredAt: new Date(clock) } });
}

beforeAll(() => {
  useTestDatabase();
});

beforeEach(async () => {
  await resetWorld();
  a = await restaurant('Activity A');
  b = await restaurant('Activity B');
  manager = await person('manager', { staff: [a.id, 'MANAGER'] });
  cashier = await person('cashier', { staff: [a.id, 'CASHIER'] });
});

afterAll(async () => {
  await resetWorld();
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});

async function seed() {
  await row(a.id, 'pos.order.discount.invoice', cashier.userId, { discount: { before: null, after: { type: 'PERCENT', value: 10 } } });
  await row(a.id, 'pos.order.line.update', cashier.userId, { discount: { before: null, after: { type: 'AMOUNT', value: 500 } } });
  await row(a.id, 'pos.order.line.update', cashier.userId, { quantity: { before: 1, after: 2 } });
  await row(a.id, 'pos.order.cancel', manager.userId);
  await row(a.id, 'pos.order.line.cancel', cashier.userId);
  await row(a.id, 'pos.payment.reverse', manager.userId, { amount: { before: null, after: 4000 } });
  await row(a.id, 'pos.shift.close', cashier.userId, { difference: { before: null, after: -1500 } });
  await row(a.id, 'pos.shift.close', cashier.userId, { difference: { before: null, after: 0 } });
  await row(a.id, 'pos.pin.fail', null);
  await row(a.id, 'pos.approval.ok', manager.userId);
  await row(a.id, 'pos.order.open', cashier.userId);
}

describe('listActivityIn', () => {
  it('lists only the watched events, newest first, and names the person', async () => {
    await seed();
    const { rows } = await listActivityIn(prisma(), a.id, {});
    expect(rows.map((r) => r.action)).toEqual([
      'pos.approval.ok',
      'pos.pin.fail',
      'pos.shift.close',
      'pos.payment.reverse',
      'pos.order.line.cancel',
      'pos.order.cancel',
      'pos.order.line.update',
      'pos.order.discount.invoice',
    ]);
    expect(rows[0]).toMatchObject({ type: 'pin', actorName: expect.any(String) });
    expect(rows[1]).toMatchObject({ type: 'pin', actorName: null });
  });

  it.each([
    ['discount', ['pos.order.line.update', 'pos.order.discount.invoice']],
    ['cancel', ['pos.order.line.cancel', 'pos.order.cancel']],
    ['refund', ['pos.payment.reverse']],
    ['difference', ['pos.shift.close']],
    ['pin', ['pos.approval.ok', 'pos.pin.fail']],
  ] as const)('filters by %s', async (type, actions) => {
    await seed();
    const { rows } = await listActivityIn(prisma(), a.id, { type });
    expect(rows.map((r) => r.action)).toEqual(actions);
  });

  it('filters by the person who acted', async () => {
    await seed();
    const { rows } = await listActivityIn(prisma(), a.id, { userId: manager.userId });
    expect(rows.map((r) => r.action)).toEqual(['pos.approval.ok', 'pos.payment.reverse', 'pos.order.cancel']);
  });

  it('pages with next', async () => {
    await seed();
    const first = await listActivityIn(prisma(), a.id, { limit: 3 });
    expect(first.rows).toHaveLength(3);
    expect(first.next).not.toBeNull();
    const second = await listActivityIn(prisma(), a.id, { limit: 3, before: first.next! });
    expect(second.rows.map((r) => r.action)).toEqual(['pos.payment.reverse', 'pos.order.line.cancel', 'pos.order.cancel']);
    const last = await listActivityIn(prisma(), a.id, { limit: 3, before: second.next! });
    expect(last.rows).toHaveLength(2);
    expect(last.next).toBeNull();
  });

  it('never shows another restaurant’s rows', async () => {
    await row(b.id, 'pos.order.cancel', null);
    await row(a.id, 'pos.order.cancel', manager.userId);
    const { rows } = await listActivityIn(prisma(), a.id, {});
    expect(rows).toHaveLength(1);
  });
});

describe('posActivity', () => {
  it('is for those who may view reports', async () => {
    await seed();
    expect(codeOf(await ask(manager, posActivity, {}))).toBe('OK');
    expect(codeOf(await ask(cashier, posActivity, {}))).toBe('FORBIDDEN');
  });

  it('answers with the rows and the staff to filter by', async () => {
    await seed();
    const data = dataOf(await ask(manager, posActivity, { type: 'refund' }));
    expect(data.rows).toHaveLength(1);
    expect(data.staff.map((s) => s.userId)).toEqual(expect.arrayContaining([manager.userId, cashier.userId]));
  });
});
