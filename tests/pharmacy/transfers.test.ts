import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as saleActions from '@/server/pharmacy/actions/sales';
import * as transferActions from '@/server/pharmacy/actions/transfers';
import * as transferQueries from '@/server/pharmacy/queries/transfers';
import { DAY, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';
import { act, ask, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf } from './stock-helpers';

/**
 * Transfers (phase 6, task 2): request, update, cancel, send (FEFO, picks, override), receive (received, damaged, lost,
 * quarantine), the either-end rules, idempotency, races and conservation of stock. Hand figures: 30 units asked of branch 1 by
 * branch 2 are sent as 18 + 12 (FEFO), 25 arrive and 5 are lost.
 */

let seq = 0;
const key = (label: string) => `${label}-${(seq += 1)}-${'x'.repeat(8)}`;

interface World {
  a: { id: string; branchIds: string[] };
  b1: string;
  b2: string;
  b3: string;
  owner: Person;
  senderMgr: Person;
  destMgr: Person;
  thirdMgr: Person;
  stock1: Person;
  stock2: Person;
  pharmacist: Person;
  cashier: Person;
  p: { id: string; tablet: string; strip: string };
}

async function world(label = 'A'): Promise<World> {
  const a = await pharmacy(label, { branches: 3 });
  const [b1, b2, b3] = a.branchIds as [string, string, string];
  const staff = (name: string, role: 'BRANCH_MANAGER' | 'STOCK' | 'PHARMACIST' | 'CASHIER', branches: string[]) => person(`${name}${label}`, { staff: [a.id, role, branches] });
  const owner = await person(`owner${label}`, { membership: [a.id, 'OWNER'] });
  const w = {
    a,
    b1,
    b2,
    b3,
    owner,
    senderMgr: await staff('senderMgr', 'BRANCH_MANAGER', [b1]),
    destMgr: await staff('destMgr', 'BRANCH_MANAGER', [b2]),
    thirdMgr: await staff('thirdMgr', 'BRANCH_MANAGER', [b3]),
    stock1: await staff('stock1', 'STOCK', [b1]),
    stock2: await staff('stock2', 'STOCK', [b2]),
    pharmacist: await staff('pharmacist', 'PHARMACIST', [b1, b2]),
    cashier: await staff('cashier', 'CASHIER', [b1, b2]),
    p: await makeProduct(a.id, 'Panadol'),
  };
  await prisma().phSettings.create({ data: { restaurantId: a.id } });
  return w;
}

/** A batch of the world's product at a branch with the given available stock. */
const batch = (w: World, branchId: string, available: number, over: { lot?: string; expiry?: string; status?: 'ACTIVE' | 'RECALLED' | 'BLOCKED'; buckets?: Record<string, number>; productId?: string } = {}) =>
  makeBatch(w.a.id, branchId, over.productId ?? w.p.id, {
    lot: over.lot ?? key('lot'),
    expiry: over.expiry ?? '2028-03-31',
    status: over.status ?? 'ACTIVE',
    buckets: over.buckets ?? { available },
  });

const place = (w: World) => ({ restaurantId: w.a.id });
const request = (w: World, who: Person, over: Record<string, unknown> = {}) =>
  act(who, transferActions.request, { ...place(w), clientKey: key('req'), fromBranchId: w.b1, toBranchId: w.b2, lines: [{ productId: w.p.id, qty: 30 }], ...over });
const requested = async (w: World, over: Record<string, unknown> = {}) => dataOf(await request(w, w.destMgr, over));
const send = (w: World, who: Person, t: { id: string; version: number }, over: Record<string, unknown> = {}) =>
  act(who, transferActions.send, { ...place(w), transferId: t.id, version: t.version, clientKey: key('send'), ...over });
const receive = (w: World, who: Person, t: { id: string; version: number }, lines: unknown[], over: Record<string, unknown> = {}) =>
  act(who, transferActions.receive, { ...place(w), transferId: t.id, version: t.version, clientKey: key('recv'), lines, ...over });
const cancel = (w: World, who: Person, t: { id: string; version: number }) => act(who, transferActions.cancel, { ...place(w), transferId: t.id, version: t.version });
const update = (w: World, who: Person, t: { id: string; version: number }, over: Record<string, unknown> = {}) =>
  act(who, transferActions.update, { ...place(w), transferId: t.id, version: t.version, lines: [{ productId: w.p.id, qty: 5 }], ...over });
const get = (w: World, who: Person, id: string) => ask(who, transferQueries.get, { ...place(w), transferId: id });
const list = (w: World, who: Person, over: Record<string, unknown> = {}) => ask(who, transferQueries.list, { ...place(w), ...over });
const onTheRoad = (w: World, who: Person, over: Record<string, unknown> = {}) => ask(who, transferQueries.inTransit, { ...place(w), ...over });

/** The sent lines of a transfer, by batch. */
const sentLines = async (id: string) => (await prisma().phTransferLine.findMany({ where: { transferId: id, requestLineId: { not: null } }, orderBy: { lineNo: 'asc' } }));
const avail = async (batchId: string, branchId: string) => (await balanceOf(batchId, branchId))?.available ?? 0;

/** Units anywhere, by independent SQL: every bucket of every branch, what is on the road, and what was lost. */
async function conserved(restaurantId: string): Promise<{ held: number; road: number; lost: number; total: number }> {
  // eslint-disable-next-line no-restricted-properties -- the test sums the stock tables of one business directly, as an independent check
  const held = await prisma().$queryRaw<{ n: bigint }[]>`SELECT COALESCE(SUM("available" + "reserved" + "quarantine" + "damaged"), 0)::bigint AS n FROM "PhStockBalance" WHERE "restaurantId" = ${restaurantId}`;
  // eslint-disable-next-line no-restricted-properties -- as above, over the sent lines of transfers still on the road
  const road = await prisma().$queryRaw<{ n: bigint }[]>`SELECT COALESCE(SUM(l."sentQty" - l."receivedQty" - l."damagedQty" - l."lostQty"), 0)::bigint AS n FROM "PhTransferLine" l JOIN "PhTransfer" t ON t."id" = l."transferId" WHERE t."restaurantId" = ${restaurantId} AND t."status" = 'SENT' AND l."requestLineId" IS NOT NULL`;
  // eslint-disable-next-line no-restricted-properties -- as above, over the units recorded as lost
  const lost = await prisma().$queryRaw<{ n: bigint }[]>`SELECT COALESCE(SUM("lostQty"), 0)::bigint AS n FROM "PhTransferLine" WHERE "restaurantId" = ${restaurantId}`;
  const [h, r, l] = [Number(held[0]!.n), Number(road[0]!.n), Number(lost[0]!.n)];
  return { held: h, road: r, lost: l, total: h + r + l };
}

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);
afterEach(() => {
  vi.setSystemTime(NOW);
});

describe('the hand figures: 30 asked, 18 + 12 sent, 25 received and 5 lost', () => {
  it('moves the stock through the road and conserves every unit', async () => {
    const w = await world();
    const early = await batch(w, w.b1, 18, { lot: 'EARLY', expiry: '2027-06-30' });
    const late = await batch(w, w.b1, 20, { lot: 'LATE', expiry: '2028-03-31' });
    expect((await conserved(w.a.id)).total).toBe(38);

    const t = await requested(w);
    expect(t).toMatchObject({ number: 'T-20261027-000001', status: 'REQUESTED', fromBranchId: w.b1, toBranchId: w.b2, version: 1, replayed: false });
    expect(t.lines).toEqual([{ lineNo: 1, productId: w.p.id, requestedQty: 30 }]);
    expect((await conserved(w.a.id)).total).toBe(38);

    const sent = dataOf(await send(w, w.senderMgr, t));
    expect(sent).toMatchObject({ status: 'SENT', totalQty: 30, override: false, version: 2, replayed: false });
    expect(sent.lines.map((l) => [l.batchId, l.sentQty]).sort()).toEqual([[early, 18], [late, 12]].sort());
    expect(await avail(early, w.b1)).toBe(0);
    expect(await avail(late, w.b1)).toBe(8);
    expect(await balanceOf(early, w.b2)).toBeNull();
    const out = await prisma().phStockMovement.findMany({ where: { type: 'TRANSFER_OUT' }, orderBy: { availableDelta: 'asc' } });
    expect(out.map((m) => [m.availableDelta, m.branchId, m.batchId, m.refType, m.refId, m.userId])).toEqual([
      [-18, w.b1, early, 'PhTransfer', t.id, w.senderMgr.userId],
      [-12, w.b1, late, 'PhTransfer', t.id, w.senderMgr.userId],
    ]);
    expect(await conserved(w.a.id)).toEqual({ held: 8, road: 30, lost: 0, total: 38 });
    const road = dataOf(await onTheRoad(w, w.destMgr));
    expect(road.map((r) => [r.batchId, r.lot, r.fromBranchId, r.toBranchId, r.qty]).sort()).toEqual([[early, 'EARLY', w.b1, w.b2, 18], [late, 'LATE', w.b1, w.b2, 12]].sort());

    const lines = await sentLines(t.id);
    const done = dataOf(
      await receive(w, w.destMgr, { id: t.id, version: sent.version }, [
        { lineId: lines.find((l) => l.batchId === early)!.id, receivedQty: 18 },
        { lineId: lines.find((l) => l.batchId === late)!.id, receivedQty: 7, lostQty: 5, lostReason: 'LOST' },
      ]),
    );
    expect(done).toMatchObject({ status: 'PARTIAL', receivedQty: 25, damagedQty: 0, lostQty: 5, version: 3, replayed: false });
    expect(await avail(early, w.b2)).toBe(18);
    expect(await avail(late, w.b2)).toBe(7);
    expect(await conserved(w.a.id)).toEqual({ held: 33, road: 0, lost: 5, total: 38 });
    expect(dataOf(await onTheRoad(w, w.destMgr))).toEqual([]);
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: 'PARTIAL', sentById: w.senderMgr.userId, receivedById: w.destMgr.userId, version: 3 });
    expect(row.sentAt!.toISOString()).toBe(NOW.toISOString());
    expect(row.receivedAt!.toISOString()).toBe(NOW.toISOString());
    const lost = (await sentLines(t.id)).find((l) => l.batchId === late)!;
    expect(lost).toMatchObject({ receivedQty: 7, lostQty: 5, lostReason: 'LOST', damagedQty: 0 });
  });

  it('closes RECEIVED when every line comes in full, and the detail shows request lines and sent lines', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 40, { lot: 'ONLY' });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 25 }] });
    const sent = dataOf(await send(w, w.owner, t));
    const detail = dataOf(await get(w, w.destMgr, t.id));
    expect(detail).toMatchObject({ status: 'SENT', number: 'T-20261027-000001', requestedQty: 25, sentQty: 25, inTransitQty: 25, lineCount: 1 });
    expect(detail.requestLines).toEqual([expect.objectContaining({ productName: 'Panadol', requestedQty: 25, sentQty: 25 })]);
    expect(detail.sentLines).toEqual([expect.objectContaining({ batchId: b, lot: 'ONLY', expiryDate: '2028-03-31', sentQty: 25, inTransitQty: 25 })]);
    const done = dataOf(await receive(w, w.owner, { id: t.id, version: sent.version }, [{ lineId: sent.lines[0]!.lineId, receivedQty: 25 }]));
    expect(done.status).toBe('RECEIVED');
    expect(dataOf(await get(w, w.destMgr, t.id))).toMatchObject({ status: 'RECEIVED', inTransitQty: 0 });
  });
});

describe('receiving damaged, lost and quarantined units', () => {
  const sentFor = async (qty = 30) => {
    const w = await world();
    const b = await batch(w, w.b1, 50, { lot: 'ONE' });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty }] });
    const sent = dataOf(await send(w, w.senderMgr, t));
    return { w, b, t, sent, line: sent.lines[0]!.lineId };
  };

  it('books damaged units into the damaged bucket with no reason and no report right', async () => {
    const { w, b, t, sent, line } = await sentFor();
    const done = dataOf(await receive(w, w.stock2, { id: t.id, version: sent.version }, [{ lineId: line, receivedQty: 25, damagedQty: 5 }]));
    expect(done).toMatchObject({ status: 'PARTIAL', receivedQty: 25, damagedQty: 5, lostQty: 0 });
    expect(await balanceOf(b, w.b2)).toEqual({ available: 25, reserved: 0, quarantine: 0, damaged: 5 });
    const moves = await prisma().phStockMovement.findMany({ where: { type: 'TRANSFER_IN' }, orderBy: { damagedDelta: 'asc' } });
    expect(moves.map((m) => [m.availableDelta, m.damagedDelta, m.branchId, m.refId])).toEqual([[25, 0, w.b2, t.id], [0, 5, w.b2, t.id]]);
    expect(await conserved(w.a.id)).toMatchObject({ held: 50, road: 0, lost: 0, total: 50 });
  });

  it('needs report.view and a reason to close with lost units, and leaves nothing behind when refused', async () => {
    const { w, b, t, sent, line } = await sentFor();
    const before = await prisma().phStockMovement.count();
    const refused = await receive(w, w.stock2, { id: t.id, version: sent.version }, [{ lineId: line, receivedQty: 25, lostQty: 5, lostReason: 'OTHER' }]);
    expect(phCodeOf(refused)).toBe('LOSS_NEEDS_REPORT_VIEW');
    expect(codeOf(refused)).toBe('FORBIDDEN');
    expect(phCodeOf(await receive(w, w.destMgr, { id: t.id, version: sent.version }, [{ lineId: line, receivedQty: 25, lostQty: 5 }]))).toBe('REASON_REQUIRED');
    expect(await prisma().phStockMovement.count()).toBe(before);
    expect(await balanceOf(b, w.b2)).toBeNull();
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('SENT');
    expect(codeOf(await receive(w, w.destMgr, { id: t.id, version: sent.version }, [{ lineId: line, receivedQty: 25, lostQty: 5, lostReason: 'OTHER' }]))).toBe('OK');
  });

  it('puts received units into quarantine when flagged, and when the batch was recalled on the road', async () => {
    const { w, b, t, sent, line } = await sentFor();
    expect(codeOf(await receive(w, w.destMgr, { id: t.id, version: sent.version }, [{ lineId: line, receivedQty: 30, quarantine: true }]))).toBe('OK');
    expect(await balanceOf(b, w.b2)).toMatchObject({ available: 0, quarantine: 30 });

    const w2 = await world('B');
    const b2 = await batch(w2, w2.b1, 20);
    const t2 = await requested(w2, { lines: [{ productId: w2.p.id, qty: 20 }] });
    const sent2 = dataOf(await send(w2, w2.senderMgr, t2));
    await prisma().phBatch.update({ where: { id: b2 }, data: { status: 'RECALLED' } });
    expect(codeOf(await receive(w2, w2.destMgr, { id: t2.id, version: sent2.version }, [{ lineId: sent2.lines[0]!.lineId, receivedQty: 20 }]))).toBe('OK');
    expect(await balanceOf(b2, w2.b2)).toMatchObject({ available: 0, quarantine: 20 });
  });

  it('refuses a receipt that does not account for every unit, or every line, or names more than was sent', async () => {
    const { w, t, sent, line } = await sentFor();
    const body = { id: t.id, version: sent.version };
    expect(phCodeOf(await receive(w, w.destMgr, body, [{ lineId: line, receivedQty: 20 }]))).toBe('UNACCOUNTED');
    expect(phCodeOf(await receive(w, w.destMgr, body, [{ lineId: line, receivedQty: 31 }]))).toBe('OVER_SENT');
    expect(phCodeOf(await receive(w, w.destMgr, body, [{ lineId: 'nope', receivedQty: 30 }]))).toBe('LINES_MISMATCH');
    expect(phCodeOf(await receive(w, w.destMgr, body, [{ lineId: line, receivedQty: 15 }, { lineId: line, receivedQty: 15 }]))).toBe('LINES_MISMATCH');
    expect(codeOf(await receive(w, w.destMgr, body, [{ lineId: line, receivedQty: -1 }]))).toBe('INVALID');
    expect(codeOf(await receive(w, w.destMgr, body, []))).toBe('INVALID');
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('SENT');
  });
});

describe('sending', () => {
  it('sends all or nothing: a short product fails the send and names the product', async () => {
    const w = await world();
    const other = await makeProduct(w.a.id, 'Brufen');
    await batch(w, w.b1, 50);
    await batch(w, w.b1, 4, { productId: other.id });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 30 }, { productId: other.id, qty: 10 }] });
    const before = await prisma().phStockMovement.count();
    const short = await send(w, w.senderMgr, t);
    expect(phCodeOf(short)).toBe('INSUFFICIENT_STOCK');
    expect(!short.ok && short.error.fields).toMatchObject({ productId: other.id, requested: '10', available: '4' });
    expect(await prisma().phStockMovement.count()).toBe(before);
    expect(await sentLines(t.id)).toEqual([]);
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('REQUESTED');
  });

  it('does not send expired, recalled, blocked or quarantined stock', async () => {
    const w = await world();
    const expired = await batch(w, w.b1, 50, { expiry: '2026-01-31' });
    await batch(w, w.b1, 50, { status: 'RECALLED' });
    await batch(w, w.b1, 50, { status: 'BLOCKED' });
    await batch(w, w.b1, 0, { buckets: { quarantine: 50 } });
    await batch(w, w.b1, 5);
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 10 }] });
    const short = await send(w, w.senderMgr, t);
    expect(phCodeOf(short)).toBe('INSUFFICIENT_STOCK');
    expect(!short.ok && short.error.fields).toMatchObject({ available: '5' });
    const line = (await prisma().phTransferLine.findFirstOrThrow({ where: { transferId: t.id } })).id;
    expect(phCodeOf(await send(w, w.owner, t, { picks: [{ lineId: line, batchId: expired, qty: 5 }] }))).toBe('BATCH_NOT_SENDABLE');
  });

  it('sends less than requested when told to, never more, and at least one unit', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 50, { lot: 'ONE' });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 30 }] });
    const line = (await prisma().phTransferLine.findFirstOrThrow({ where: { transferId: t.id } })).id;
    expect(phCodeOf(await send(w, w.senderMgr, t, { picks: [{ lineId: line, batchId: b, qty: 31 }] }))).toBe('OVER_REQUESTED');
    expect(phCodeOf(await send(w, w.senderMgr, t, { picks: [{ lineId: line, batchId: b, qty: 0 }] }))).toBe('NOTHING_TO_SEND');
    expect(phCodeOf(await send(w, w.senderMgr, t, { picks: [{ lineId: 'nope', batchId: b, qty: 1 }] }))).toBe('PICK_LINE_UNKNOWN');
    expect(phCodeOf(await send(w, w.senderMgr, t, { picks: [{ lineId: line, batchId: b, qty: 1 }, { lineId: line, batchId: b, qty: 2 }] }))).toBe('DUPLICATE_PICK');
    const sent = dataOf(await send(w, w.senderMgr, t, { picks: [{ lineId: line, batchId: b, qty: 10 }] }));
    expect(sent).toMatchObject({ totalQty: 10, override: false });
    expect(await avail(b, w.b1)).toBe(40);
    expect(dataOf(await onTheRoad(w, w.destMgr)).map((r) => r.qty)).toEqual([10]);
  });

  it('needs batch.override to send out of FEFO order, and flags it', async () => {
    const w = await world();
    const early = await batch(w, w.b1, 20, { expiry: '2027-06-30' });
    const late = await batch(w, w.b1, 20, { expiry: '2028-03-31' });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 10 }] });
    const line = (await prisma().phTransferLine.findFirstOrThrow({ where: { transferId: t.id } })).id;
    const picks = [{ lineId: line, batchId: late, qty: 10 }];
    const clerk = await send(w, w.stock1, t, { picks });
    expect(phCodeOf(clerk)).toBe('OVERRIDE_NEEDED');
    expect(await avail(late, w.b1)).toBe(20);
    const manager = dataOf(await send(w, w.senderMgr, t, { picks }));
    expect(manager.override).toBe(true);
    expect(await avail(late, w.b1)).toBe(10);
    expect(await avail(early, w.b1)).toBe(20);
  });

  it('keeps in-transit stock away from the sale screen and from every branch', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 10, { lot: 'ONE' });
    await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: w.p.id, unitId: w.p.tablet, branchId: null, currency: 'IQD', amountMinor: 100n, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
    for (const branchId of [w.b1, w.b2]) await prisma().phShift.create({ data: { restaurantId: w.a.id, branchId, userId: w.cashier.userId, currency: 'IQD', openingFloatMinor: 0n } });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 6 }] });
    dataOf(await send(w, w.senderMgr, t));
    const sell = (branchId: string, qty: number) =>
      act(w.cashier, saleActions.create, { ...place(w), branchId, clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty }], payments: [{ method: 'CASH', amountMinor: BigInt(qty * 100), clientKey: key('pay') }] });
    expect(phCodeOf(await sell(w.b1, 5))).toBe('INSUFFICIENT_STOCK');
    expect(phCodeOf(await sell(w.b2, 1))).toBe('INSUFFICIENT_STOCK');
    expect(codeOf(await sell(w.b1, 4))).toBe('OK');
    expect(await avail(b, w.b1)).toBe(0);
  });
});

describe('who may act at each end', () => {
  it('lets stock clerks, branch managers and the owner work transfers, and refuses cashiers and pharmacists', async () => {
    const w = await world();
    for (const who of [w.cashier, w.pharmacist]) expect(codeOf(await request(w, who))).toBe('FORBIDDEN');
    for (const who of [w.stock1, w.stock2, w.senderMgr, w.destMgr, w.owner]) expect(codeOf(await request(w, who))).toBe('OK');
    for (const who of [w.cashier, w.pharmacist]) {
      expect(codeOf(await list(w, who))).toBe('FORBIDDEN');
      expect(codeOf(await onTheRoad(w, who))).toBe('FORBIDDEN');
    }
  });

  it('lets only the sender send and only the destination receive', async () => {
    const w = await world();
    await batch(w, w.b1, 50);
    const t = await requested(w);
    expect(phCodeOf(await send(w, w.destMgr, t))).toBe('NOT_SENDER');
    expect(phCodeOf(await send(w, w.stock2, t))).toBe('NOT_SENDER');
    const sent = dataOf(await send(w, w.senderMgr, t));
    const lines = [{ lineId: sent.lines[0]!.lineId, receivedQty: 30 }];
    expect(phCodeOf(await receive(w, w.senderMgr, { id: t.id, version: sent.version }, lines))).toBe('NOT_RECEIVER');
    expect(phCodeOf(await receive(w, w.stock1, { id: t.id, version: sent.version }, lines))).toBe('NOT_RECEIVER');
    expect(codeOf(await receive(w, w.stock2, { id: t.id, version: sent.version }, lines))).toBe('OK');
  });

  it('lets a person who works at both ends do both, and the owner everything', async () => {
    const w = await world();
    await batch(w, w.b1, 50);
    const t = await requested(w, {}, );
    const sent = dataOf(await send(w, w.owner, t));
    expect(codeOf(await receive(w, w.owner, { id: t.id, version: sent.version }, [{ lineId: sent.lines[0]!.lineId, receivedQty: 30 }]))).toBe('OK');
  });

  it('hides a transfer from a manager of a third branch in every way', async () => {
    const w = await world();
    await batch(w, w.b1, 50);
    const t = await requested(w);
    const stranger = w.thirdMgr;
    expect(dataOf(await list(w, stranger)).items).toEqual([]);
    expect(codeOf(await get(w, stranger, t.id))).toBe('NOT_FOUND');
    expect(dataOf(await onTheRoad(w, stranger))).toEqual([]);
    expect(codeOf(await update(w, stranger, t))).toBe('NOT_FOUND');
    expect(codeOf(await cancel(w, stranger, t))).toBe('NOT_FOUND');
    expect(codeOf(await send(w, stranger, t))).toBe('NOT_FOUND');
    expect(codeOf(await request(w, stranger))).toBe('FORBIDDEN');
    const sent = dataOf(await send(w, w.senderMgr, t));
    expect(codeOf(await receive(w, stranger, { id: t.id, version: sent.version }, [{ lineId: sent.lines[0]!.lineId, receivedQty: 30 }]))).toBe('NOT_FOUND');
    expect(dataOf(await onTheRoad(w, stranger))).toEqual([]);
    // They can still ask for a transfer that touches their own branch.
    expect(codeOf(await request(w, stranger, { fromBranchId: w.b3, toBranchId: w.b1 }))).toBe('OK');
  });

  it('shows another business nothing', async () => {
    const w = await world('A');
    const other = await world('B');
    await batch(w, w.b1, 50);
    const t = await requested(w);
    expect(dataOf(await list(other, other.owner)).items).toEqual([]);
    expect(codeOf(await ask(other.owner, transferQueries.get, { restaurantId: other.a.id, transferId: t.id }))).toBe('NOT_FOUND');
    expect(codeOf(await act(other.owner, transferActions.cancel, { restaurantId: other.a.id, transferId: t.id, version: 1 }))).toBe('NOT_FOUND');
    expect(codeOf(await act(other.owner, transferActions.request, { restaurantId: other.a.id, clientKey: key('x'), fromBranchId: w.b1, toBranchId: w.b2, lines: [{ productId: w.p.id, qty: 1 }] }))).not.toBe('OK');
  });

  it('filters the list by direction, status and branch', async () => {
    const w = await world();
    const a = await requested(w);
    await requested(w, { fromBranchId: w.b2, toBranchId: w.b1 });
    const c = await requested(w);
    dataOf(await cancel(w, w.destMgr, c));
    const ids = async (who: Person, over: Record<string, unknown>) => dataOf(await list(w, who, over)).items.map((i) => i.id).sort();
    expect((await ids(w.owner, {})).length).toBe(3);
    expect(await ids(w.senderMgr, { direction: 'out' })).toHaveLength(2);
    expect(await ids(w.senderMgr, { direction: 'in' })).toHaveLength(1);
    expect(await ids(w.destMgr, { status: 'CANCELLED' })).toEqual([c.id]);
    expect(await ids(w.owner, { branchId: w.b3 })).toEqual([]);
    expect(await ids(w.owner, { status: 'REQUESTED', direction: 'out', branchId: w.b1 })).toContain(a.id);
  });

  it('pages the list with a keyset cursor, newest first, without a gap or a repeat', async () => {
    const w = await world();
    const total = 53;
    for (let i = 0; i < total; i += 1) {
      const made = await prisma().phTransfer.create({
        data: { restaurantId: w.a.id, fromBranchId: w.b1, toBranchId: w.b2, number: `T-X-${String(i).padStart(3, '0')}`, clientKey: key('seed'), payloadHash: 'h', requestedById: 'seed', requestedAt: new Date(NOW.getTime() - (i % 5) * 1000 - Math.floor(i / 5) * 60_000) },
        select: { id: true },
      });
      await prisma().phTransferLine.create({ data: { restaurantId: w.a.id, transferId: made.id, fromBranchId: w.b1, toBranchId: w.b2, lineNo: 1, productId: w.p.id, requestedQty: 1 } });
    }
    const first = dataOf(await list(w, w.owner));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = dataOf(await list(w, w.owner, { cursor: first.nextCursor }));
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(total);
    const stamps = [...first.items, ...second.items].map((i) => i.requestedAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });
});

describe('requesting, changing and cancelling', () => {
  it('numbers per sending branch and per UTC day, also in parallel', async () => {
    const w = await world();
    expect((await requested(w)).number).toBe('T-20261027-000001');
    expect((await requested(w)).number).toBe('T-20261027-000002');
    expect((await requested(w, { fromBranchId: w.b2, toBranchId: w.b1 })).number).toBe('T-20261027-000001');
    vi.setSystemTime(new Date(NOW.getTime() + DAY));
    expect((await requested(w)).number).toBe('T-20261028-000001');
    const results = await Promise.all([1, 2, 3, 4].map(() => request(w, w.owner)));
    expect(results.map((r) => dataOf(r).number).sort()).toEqual(['T-20261028-000002', 'T-20261028-000003', 'T-20261028-000004', 'T-20261028-000005']);
  });

  it('checks the branches, the products and the lines', async () => {
    const w = await world();
    const other = await world('B');
    expect(codeOf(await request(w, w.owner, { toBranchId: w.b1 }))).toBe('INVALID');
    expect(codeOf(await request(w, w.owner, { toBranchId: 'nope' }))).toBe('NOT_FOUND');
    expect(codeOf(await request(w, w.owner, { toBranchId: other.b1 }))).toBe('NOT_FOUND');
    expect(codeOf(await request(w, w.owner, { lines: [{ productId: 'nope', qty: 1 }] }))).toBe('NOT_FOUND');
    expect(codeOf(await request(w, w.owner, { lines: [{ productId: other.p.id, qty: 1 }] }))).toBe('NOT_FOUND');
    expect(phCodeOf(await request(w, w.owner, { lines: [{ productId: w.p.id, qty: 1 }, { productId: w.p.id, qty: 2 }] }))).toBe('DUPLICATE_LINE');
    expect(codeOf(await request(w, w.owner, { lines: [] }))).toBe('INVALID');
    expect(codeOf(await request(w, w.owner, { lines: [{ productId: w.p.id, qty: 0 }] }))).toBe('INVALID');
    expect(codeOf(await request(w, w.owner, { lines: [{ productId: w.p.id, qty: 1.5 }] }))).toBe('INVALID');
    expect(codeOf(await request(w, w.owner, { clientKey: 'short' }))).toBe('INVALID');
    expect(await prisma().phTransfer.count()).toBe(0);
  });

  it('changes a requested transfer under its version and then refuses a stale one', async () => {
    const w = await world();
    const t = await requested(w);
    const changed = dataOf(await update(w, w.senderMgr, t, { note: 'Urgent', lines: [{ productId: w.p.id, qty: 5 }] }));
    expect(changed).toMatchObject({ status: 'REQUESTED', version: 2, lineCount: 1 });
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id }, include: { lines: true } });
    expect(row.note).toBe('Urgent');
    expect(row.lines.map((l) => l.requestedQty)).toEqual([5]);
    expect(phCodeOf(await update(w, w.destMgr, t))).toBe('VERSION_CONFLICT');
    expect(phCodeOf(await cancel(w, w.destMgr, t))).toBe('VERSION_CONFLICT');
    expect(codeOf(await cancel(w, w.destMgr, { id: t.id, version: 2 }))).toBe('OK');
  });

  it('never changes or cancels a transfer that was sent, received or cancelled', async () => {
    const w = await world();
    await batch(w, w.b1, 50);
    const t = await requested(w);
    const sent = dataOf(await send(w, w.senderMgr, t));
    expect(phCodeOf(await cancel(w, w.owner, { id: t.id, version: sent.version }))).toBe('NOT_REQUESTED');
    expect(phCodeOf(await update(w, w.owner, { id: t.id, version: sent.version }))).toBe('NOT_REQUESTED');
    expect(phCodeOf(await send(w, w.owner, { id: t.id, version: sent.version }))).toBe('NOT_REQUESTED');
    const done = dataOf(await receive(w, w.owner, { id: t.id, version: sent.version }, [{ lineId: sent.lines[0]!.lineId, receivedQty: 30 }]));
    expect(phCodeOf(await receive(w, w.owner, { id: t.id, version: done.version }, [{ lineId: sent.lines[0]!.lineId, receivedQty: 30 }]))).toBe('NOT_SENT');
    const c = await requested(w);
    const gone = dataOf(await cancel(w, w.owner, c));
    expect(phCodeOf(await send(w, w.owner, { id: c.id, version: gone.version }))).toBe('NOT_REQUESTED');
    expect(await prisma().phTransfer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: 'CANCELLED', cancelledById: w.owner.userId });
  });
});

describe('keys, replays and races', () => {
  it('returns the same transfer for the same key, person and payload, and refuses any other use of the key', async () => {
    const w = await world();
    const key1 = key('req');
    const first = dataOf(await request(w, w.destMgr, { clientKey: key1 }));
    const again = dataOf(await request(w, w.destMgr, { clientKey: key1 }));
    expect(again).toMatchObject({ id: first.id, number: first.number, replayed: true });
    expect(await prisma().phTransfer.count()).toBe(1);
    expect(phCodeOf(await request(w, w.destMgr, { clientKey: key1, lines: [{ productId: w.p.id, qty: 31 }] }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await request(w, w.owner, { clientKey: key1 }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await prisma().auditLog.count({ where: { action: 'ph.transfer.request' } })).toBe(1);
  });

  it('replays a send and a receive without moving stock twice, and refuses a changed or foreign repeat', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 50);
    const t = await requested(w);
    const sendKey = key('send');
    const sent = dataOf(await send(w, w.senderMgr, t, { clientKey: sendKey }));
    const movements = await prisma().phStockMovement.count();
    const again = dataOf(await send(w, w.senderMgr, t, { clientKey: sendKey }));
    expect(again).toMatchObject({ id: t.id, status: 'SENT', replayed: true, totalQty: 30 });
    expect(await prisma().phStockMovement.count()).toBe(movements);
    expect(phCodeOf(await send(w, w.owner, t, { clientKey: sendKey }))).toBe('CLIENT_KEY_MISMATCH');
    const line = sent.lines[0]!.lineId;
    expect(phCodeOf(await send(w, w.senderMgr, t, { clientKey: sendKey, picks: [{ lineId: line, batchId: b, qty: 5 }] }))).toBe('CLIENT_KEY_MISMATCH');

    const recvKey = key('recv');
    const lines = [{ lineId: line, receivedQty: 30 }];
    const done = dataOf(await receive(w, w.destMgr, { id: t.id, version: sent.version }, lines, { clientKey: recvKey }));
    const afterReceive = await prisma().phStockMovement.count();
    expect(dataOf(await receive(w, w.destMgr, { id: t.id, version: sent.version }, lines, { clientKey: recvKey }))).toMatchObject({ id: t.id, status: done.status, replayed: true });
    expect(await prisma().phStockMovement.count()).toBe(afterReceive);
    expect(phCodeOf(await receive(w, w.owner, { id: t.id, version: sent.version }, lines, { clientKey: recvKey }))).toBe('CLIENT_KEY_MISMATCH');
    expect(phCodeOf(await receive(w, w.destMgr, { id: t.id, version: sent.version }, [{ lineId: line, receivedQty: 29, damagedQty: 1 }], { clientKey: recvKey }))).toBe('CLIENT_KEY_MISMATCH');
    expect(await avail(b, w.b2)).toBe(30);
  });

  it('makes one transfer of two requests with one key at once', async () => {
    const w = await world();
    const k = key('req');
    const results = await Promise.all([request(w, w.destMgr, { clientKey: k }), request(w, w.destMgr, { clientKey: k })]);
    expect(results.map((r) => codeOf(r))).toEqual(['OK', 'OK']);
    expect(new Set(results.map((r) => dataOf(r).id)).size).toBe(1);
    expect(await prisma().phTransfer.count()).toBe(1);
  });

  it('lets exactly one of two receives (different keys) take effect', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 50);
    const t = await requested(w);
    const sent = dataOf(await send(w, w.senderMgr, t));
    const lines = [{ lineId: sent.lines[0]!.lineId, receivedQty: 30 }];
    const results = await Promise.all([receive(w, w.destMgr, { id: t.id, version: sent.version }, lines), receive(w, w.stock2, { id: t.id, version: sent.version }, lines)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await avail(b, w.b2)).toBe(30);
    expect(await prisma().phStockMovement.count({ where: { type: 'TRANSFER_IN' } })).toBe(1);
  });

  it('lets exactly one of a send and a cancel win', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 50);
    const t = await requested(w);
    const [sent, cancelled] = await Promise.all([send(w, w.senderMgr, t), cancel(w, w.destMgr, t)]);
    expect([sent.ok, cancelled.ok].filter(Boolean)).toHaveLength(1);
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } });
    if (sent.ok) {
      expect(row.status).toBe('SENT');
      expect(await avail(b, w.b1)).toBe(20);
    } else {
      expect(row.status).toBe('CANCELLED');
      expect(await avail(b, w.b1)).toBe(50);
      expect(await prisma().phStockMovement.count({ where: { type: 'TRANSFER_OUT' } })).toBe(0);
    }
  });

  it('lets exactly one of a send and a sale of the last units win', async () => {
    const w = await world();
    const b = await batch(w, w.b1, 10, { lot: 'LAST' });
    await prisma().phPrice.create({ data: { restaurantId: w.a.id, productId: w.p.id, unitId: w.p.tablet, branchId: null, currency: 'IQD', amountMinor: 100n, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
    await prisma().phShift.create({ data: { restaurantId: w.a.id, branchId: w.b1, userId: w.cashier.userId, currency: 'IQD', openingFloatMinor: 0n } });
    const t = await requested(w, { lines: [{ productId: w.p.id, qty: 10 }] });
    const sale = act(w.cashier, saleActions.create, { ...place(w), branchId: w.b1, clientKey: key('sale'), currency: 'IQD', lines: [{ productId: w.p.id, unitId: w.p.tablet, qty: 10 }], payments: [{ method: 'CASH', amountMinor: 1000n, clientKey: key('pay') }] });
    const [soldResult, sentResult] = await Promise.all([sale, send(w, w.senderMgr, t)]);
    expect([soldResult.ok, sentResult.ok].filter(Boolean)).toHaveLength(1);
    expect(await avail(b, w.b1)).toBe(0);
    const c = await conserved(w.a.id);
    expect(c.held + c.road).toBe(soldResult.ok ? 0 : 10);
  });
});

describe('what the audit keeps', () => {
  it('records ids, numbers, counts and movements, and never the note', async () => {
    const w = await world();
    await batch(w, w.b1, 50);
    const secret = 'Collect from the back door, ask for Dr Karim';
    const t = await requested(w, { note: secret });
    dataOf(await update(w, w.destMgr, t, { note: secret }));
    const fresh = await requested(w, { note: secret });
    dataOf(await cancel(w, w.destMgr, fresh));
    const t2 = await requested(w, { note: secret });
    const sent = dataOf(await send(w, w.senderMgr, t2));
    dataOf(await receive(w, w.destMgr, { id: t2.id, version: sent.version }, [{ lineId: sent.lines[0]!.lineId, receivedQty: 25, lostQty: 5, lostReason: 'LOST' }]));
    const rows = await prisma().auditLog.findMany({ where: { action: { startsWith: 'ph.transfer.' } } });
    expect(rows.map((r) => r.action).sort()).toEqual(['ph.transfer.cancel', 'ph.transfer.receive', 'ph.transfer.request', 'ph.transfer.request', 'ph.transfer.request', 'ph.transfer.send', 'ph.transfer.update']);
    for (const r of rows) {
      expect(JSON.stringify(r)).not.toContain('Karim');
      expect(JSON.stringify(r)).not.toContain('back door');
      expect(r.entityType).toBe('PhTransfer');
    }
    const receiveRow = rows.find((r) => r.action === 'ph.transfer.receive')!;
    expect(receiveRow.entityId).toBe(t2.id);
    expect(JSON.stringify(receiveRow.changes)).toContain('PARTIAL');
    expect(rows.find((r) => r.action === 'ph.transfer.send')!.entityId).toBe(t2.id);
  });
});
