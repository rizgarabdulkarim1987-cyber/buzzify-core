import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import * as exportQueries from '@/server/pharmacy/queries/exports';
import * as reports from '@/server/pharmacy/queries/reports';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, dataOf as typedDataOf, makeBatch, makeProduct } from './stock-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any -- report answers are read off the wire and checked by value */

/**
 * Phase 6 whole-phase review, I2 (rulings R6-17 and R6-17a).
 *  - a: the transfers report and the damaged report count the units lost or damaged in transit by the day the transfer was RECEIVED,
 *    so for one window they say the same figure;
 *  - b: a branch the person does not work in is "other branch" (no id, no name) in every report and export that names a transfer's end.
 * World (hand): P stock 50 at A, 50 at C. T1 A -> C 10 units, requested and sent 2026-10-27, received 2026-10-29: 8 + 2 lost.
 * T2 C -> A 6 units, requested, sent and received 2026-10-28: 4 + 1 damaged + 1 lost.
 */

const dataOf = (r: Parameters<typeof typedDataOf>[0]): any => typedDataOf(r);
let seq = 0;
const key = (l: string) => `${l}-${(seq += 1)}-${'x'.repeat(8)}`;
const at = (day: number, h = 9) => new Date(`2026-10-${day}T${String(h).padStart(2, '0')}:00:00.000Z`);

let rid = '';
let A = '';
let B = '';
let C = '';
let owner: Person;
let mgrAB: Person;

async function move(who: Person, from: string, to: string, qty: number, sentDay: number, receivedDay: number, line: Record<string, unknown>) {
  const productId = (await prisma().phProduct.findFirstOrThrow({ where: { restaurantId: rid } })).id;
  vi.setSystemTime(at(sentDay));
  const t = dataOf(await act(who, transferActions.request, { restaurantId: rid, clientKey: key('req'), fromBranchId: from, toBranchId: to, lines: [{ productId, qty }] }));
  const sent = dataOf(await act(who, transferActions.send, { restaurantId: rid, transferId: t.id, version: t.version, clientKey: key('send') }));
  vi.setSystemTime(at(receivedDay));
  const lineId = sent.lines.map((l: any) => l.lineId)[0];
  dataOf(await act(who, transferActions.receive, { restaurantId: rid, transferId: t.id, version: sent.version, clientKey: key('recv'), lines: [{ lineId, ...line }] }));
}

beforeAll(async () => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetWorld();
  const a = await pharmacy('Axis', { branches: 3 });
  [A, B, C] = a.branchIds as [string, string, string];
  rid = a.id;
  owner = await person('ownerAxis', { membership: [rid, 'OWNER'] });
  mgrAB = await person('mgrABAxis', { staff: [rid, 'BRANCH_MANAGER', [A, B]] });
  const P = await makeProduct(rid, 'Panadol');
  await prisma().phSettings.create({ data: { restaurantId: rid } });
  await makeBatch(rid, A, P.id, { lot: 'AX1', buckets: { available: 50 } });
  await makeBatch(rid, C, P.id, { lot: 'CX1', buckets: { available: 50 } });
  await move(owner, A, C, 10, 27, 29, { receivedQty: 8, lostQty: 2, lostReason: 'LOST' });
  await move(owner, C, A, 6, 28, 28, { receivedQty: 4, damagedQty: 1, lostQty: 1, lostReason: 'OTHER' });
  vi.setSystemTime(at(30));
}, 120_000);
afterAll(() => vi.useRealTimers());

const transfers = async (who: Person, from: string, to: string) => dataOf(await ask(who, reports.transfers, { restaurantId: rid, from, to }));
const damaged = async (who: Person, from: string, to: string) => dataOf(await ask(who, reports.damaged, { restaurantId: rid, from, to }));

describe('R6-17a: lost and damaged in transit are counted on the day of receipt, in both reports', () => {
  it.each([
    ['2026-10-27', '2026-10-28', 1, 1], // only T2 was received in the window
    ['2026-10-29', '2026-10-30', 2, 0], // only T1
    ['2026-10-27', '2026-10-30', 3, 1],
    ['2026-10-30', '2026-10-30', 0, 0],
  ])('window %s..%s: lost %i, damaged %i in both', async (from, to, lost, dmg) => {
    const t = await transfers(owner, from, to);
    const d = await damaged(owner, from, to);
    expect([t.lost.lostQty, t.lost.damagedQty]).toEqual([lost, dmg]);
    expect([d.transfers.totals.lostQty, d.transfers.totals.damagedQty]).toEqual([lost, dmg]);
  });

  it('a transfer requested before the window and received inside it counts its loss there, but is not in the transfer count', async () => {
    const t = await transfers(owner, '2026-10-29', '2026-10-30');
    expect(t.total).toBe(0);
    expect(t.lost.lostQty).toBe(2);
    expect(t.lost.byReason).toEqual([{ reason: 'LOST', lostQty: 2 }]);
    // sent 10-27 09:00, received 10-29 09:00 = 48 hours
    expect(t.avgTransitSeconds).toBe(172_800);
  });
});

describe('R6-17: a branch outside the person reach is "other branch" (no id, no name)', () => {
  it('the owner sees every end by name', async () => {
    const t = await transfers(owner, '2026-10-27', '2026-10-30');
    expect(t.rows.map((r: any) => [r.fromBranchId, r.toBranchId]).sort()).toEqual([[A, C], [C, A]].sort());
    expect(t.rows.every((r: any) => r.fromBranchName !== '' && r.toBranchName !== '')).toBe(true);
  });

  it('a person of A and B gets C blanked in the rows, by sender, by route and in the damaged report', async () => {
    const t = await transfers(mgrAB, '2026-10-27', '2026-10-30');
    expect(t.total).toBe(2);
    const ends = t.rows.map((r: any) => [r.fromBranchId === A ? 'A' : r.fromBranchId, r.fromBranchId === A ? 'named' : r.fromBranchName, r.toBranchId === A ? 'A' : r.toBranchId, r.toBranchId === A ? 'named' : r.toBranchName]);
    expect(ends.sort()).toEqual([['', '', 'A', 'named'], ['A', 'named', '', '']].sort());
    expect(t.byBranch.map((r: any) => r.branchId).sort()).toEqual(['', A].sort());
    expect(t.byRoute.map((r: any) => [r.fromBranchId, r.toBranchId]).sort()).toEqual([['', A], [A, '']].sort());
    const d = await damaged(mgrAB, '2026-10-27', '2026-10-30');
    expect(d.transfers.byRoute.every((r: any) => r.fromBranchId === '' || r.toBranchId === '')).toBe(true);
    expect(JSON.stringify([t, d])).not.toContain(C);
    expect(JSON.stringify([t, d])).not.toContain('Axis branch 3');
  });

  it('the transfers and damaged exports name no id and no name of C for that person, and the owner file does', async () => {
    for (const report of ['transfers', 'damaged']) {
      const file = dataOf(await ask(mgrAB, exportQueries.report, { restaurantId: rid, report, format: 'csv', from: '2026-10-27', to: '2026-10-30' }));
      const text = Buffer.from(file.base64, 'base64').toString('utf8');
      expect(text, report).not.toContain(C);
      expect(text, report).not.toContain('Axis branch 3');
      expect(text.length).toBeGreaterThan(50);
    }
    const owned = dataOf(await ask(owner, exportQueries.report, { restaurantId: rid, report: 'transfers', format: 'csv', from: '2026-10-27', to: '2026-10-30' }));
    expect(Buffer.from(owned.base64, 'base64').toString('utf8')).toContain('Axis branch 3');
  });
});

void B;
