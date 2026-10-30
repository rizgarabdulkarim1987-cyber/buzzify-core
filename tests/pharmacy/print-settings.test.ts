import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSTATION } from '@/server/domain/pharmacy/print-settings';
import * as printActions from '@/server/pharmacy/actions/print-settings';
import * as printQueries from '@/server/pharmacy/queries/print-settings';
import { NOW, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, ask, codeOf, dataOf } from './stock-helpers';
import { creditWorld, type CreditWorld } from './credit-world';

/** Printing settings per workstation (phase 7, task 6): the owner's, strict, versioned, no personal data in the audit. */

let w: CreditWorld;
const at = () => ({ restaurantId: w.a.id, branchId: w.b1 });
type View = { print: { workstations: Record<string, typeof DEFAULT_WORKSTATION> }; version: number };

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  await resetWorld();
  w = await creditWorld();
});

describe('print settings', () => {
  it('is readable by every role, written by the owner alone, and saved with the version it started from', async () => {
    const got = dataOf(await ask(w.cashier, printQueries.get, at())) as View;
    expect(got.print).toEqual({ workstations: {} });
    const wanted = { ...DEFAULT_WORKSTATION, paper: 'A5' as const, labelSize: '58' as const, showPrice: false };
    for (const who of [w.manager, w.cashier, w.pharmacist]) {
      expect(codeOf(await act(who, printActions.set, { ...at(), workstation: 'Counter 1', settings: wanted, version: got.version }))).toBe('FORBIDDEN');
    }
    const saved = dataOf(await act(w.owner, printActions.set, { ...at(), workstation: 'Counter 1', settings: wanted, version: got.version })) as View;
    expect(saved.version).toBe(got.version + 1);
    expect(saved.print.workstations['Counter 1']).toEqual(wanted);
    expect(codeOf(await act(w.owner, printActions.set, { ...at(), workstation: 'Counter 1', settings: wanted, version: got.version }))).toBe('CONFLICT');
    const reread = dataOf(await ask(w.cashier, printQueries.get, at())) as View;
    expect(reread.print.workstations['Counter 1']).toEqual(wanted);
    // Another workstation keeps its own values next to it.
    const second = dataOf(await act(w.owner, printActions.set, { ...at(), workstation: 'Counter 2', settings: DEFAULT_WORKSTATION, version: saved.version })) as View;
    expect(Object.keys(second.print.workstations).sort()).toEqual(['Counter 1', 'Counter 2']);
  });

  it('refuses unknown keys, out-of-range numbers, unknown sizes and a 21st workstation, and changes nothing', async () => {
    const got = dataOf(await ask(w.owner, printQueries.get, at())) as View;
    const bad: unknown[] = [
      { ...DEFAULT_WORKSTATION, silent: true },
      { ...DEFAULT_WORKSTATION, marginMm: { ...DEFAULT_WORKSTATION.marginMm, top: 41 } },
      { ...DEFAULT_WORKSTATION, marginMm: { ...DEFAULT_WORKSTATION.marginMm, top: 1.5 } },
      { ...DEFAULT_WORKSTATION, labelSize: '99' },
      { ...DEFAULT_WORKSTATION, paper: 'A3' },
    ];
    for (const settings of bad) expect(codeOf(await act(w.owner, printActions.set, { ...at(), workstation: 'W', settings, version: got.version })), JSON.stringify(settings)).toBe('INVALID');
    expect(codeOf(await act(w.owner, printActions.set, { ...at(), workstation: '', settings: DEFAULT_WORKSTATION, version: got.version }))).toBe('INVALID');
    let version = got.version;
    for (let i = 0; i < 20; i++) version = (dataOf(await act(w.owner, printActions.set, { ...at(), workstation: `WS ${i}`, settings: DEFAULT_WORKSTATION, version })) as View).version;
    expect(codeOf(await act(w.owner, printActions.set, { ...at(), workstation: 'WS 21', settings: DEFAULT_WORKSTATION, version }))).toBe('INVALID');
    const row = await prisma().phSettings.findFirstOrThrow({ where: { restaurantId: w.a.id }, select: { print: true } });
    expect(Object.keys((row.print as { workstations: object }).workstations)).toHaveLength(20);
  });

  it('writes an audit row with the name and the values, and never touches another business', async () => {
    const got = dataOf(await ask(w.owner, printQueries.get, at())) as View;
    await act(w.owner, printActions.set, { ...at(), workstation: 'Counter 1', settings: DEFAULT_WORKSTATION, version: got.version });
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.print.settings.set', restaurantId: w.a.id } });
    expect(JSON.stringify(audit.changes)).toContain('Counter 1');
    const other = await prisma().phSettings.findFirst({ where: { restaurantId: w.b.id }, select: { print: true } });
    expect(other?.print ?? null).toBeNull();
  });

  it('reads a stored value that no longer fits as none', async () => {
    await prisma().phSettings.updateMany({ where: { restaurantId: w.a.id }, data: { print: { workstations: { X: { paper: 'huge' } } } } });
    expect(dataOf(await ask(w.owner, printQueries.get, at()))).toMatchObject({ print: { workstations: {} } });
  });
});
