import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PHARMACY_BRANCH_SCOPED_MODELS,
  PHARMACY_EITHER_BRANCH_MODELS,
  RESTAURANT_SCOPED_MODELS,
  scopedClient,
} from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

const globalForPrisma = globalThis as unknown as { __prisma?: unknown };

beforeAll(() => {
  useTestDatabase();
  delete globalForPrisma.__prisma;
});
afterAll(async () => {
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
});
beforeEach(resetWorld);

type Data = Record<string, unknown>;

let seq = 0;
const next = () => (seq += 1);

const REQUESTED_AT = new Date('2026-10-30T00:00:00.000Z');
const T0 = new Date('2026-10-31T08:00:00.000Z');
const T1 = new Date('2026-10-31T12:00:00.000Z');

/** A business with three branches, two products with a batch each, and a second business with its own. */
async function world() {
  const biz = await pharmacy('A', { branches: 3 });
  const other = await pharmacy('B', { branches: 2 });
  const mk = async (restaurantId: string, tag: string) => {
    const product = await prisma().phProduct.create({
      data: {
        restaurantId,
        tradeName: `Panadol ${tag}`,
        identityKey: `paracetamol|500mg|tablet|${tag}`,
        searchText: searchTextOf({ tradeName: 'Panadol', genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
      },
      select: { id: true },
    });
    const batch = await prisma().phBatch.create({
      data: { restaurantId, productId: product.id, lot: `L-${tag}`, expiryDate: new Date('2027-06-30T00:00:00.000Z') },
      select: { id: true },
    });
    return { productId: product.id, batchId: batch.id };
  };
  const a = await mk(biz.id, 'A');
  const a2 = await mk(biz.id, 'A2');
  const b = await mk(other.id, 'B');
  const [b1, b2, b3] = biz.branchIds as [string, string, string];
  return {
    biz,
    other,
    b1,
    b2,
    b3,
    ...a,
    product2Id: a2.productId,
    batch2Id: a2.batchId,
    otherProductId: b.productId,
    otherBatchId: b.batchId,
    otherBranchId: other.branchId,
    otherBranchId2: other.branchIds[1]!,
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** A request (b1 to b2 unless said) with a number, made at a fixed time before every other timestamp of these tests. */
const transferOf = (w: World, over: Data = {}) =>
  prisma().phTransfer.create({
    data: {
      restaurantId: w.biz.id,
      fromBranchId: w.b1,
      toBranchId: w.b2,
      number: `T-${next()}`,
      clientKey: `tr-${next()}`,
      payloadHash: `h-${next()}`,
      requestedById: 'u1',
      requestedAt: REQUESTED_AT,
      ...over,
    } as never,
    select: { id: true, fromBranchId: true, toBranchId: true },
  });

const SENT = () => ({ status: 'SENT', sentAt: T0, sentById: 'u1', sendKey: `sk-${next()}`, sendHash: 'sh' });
const CLOSED = (status: 'RECEIVED' | 'PARTIAL' = 'RECEIVED') => ({ ...SENT(), status, receivedAt: T1, receivedById: 'u2', receiveKey: `rk-${next()}`, receiveHash: 'rh' });

/** A request line of a transfer: what was asked of a product. Its ends follow the transfer's. */
const requestLine = (w: World, t: { id: string; fromBranchId: string; toBranchId: string }, over: Data = {}) =>
  prisma().phTransferLine.create({
    data: { restaurantId: w.biz.id, transferId: t.id, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId, lineNo: next(), productId: w.productId, requestedQty: 10, ...over } as never,
    select: { id: true },
  });

/** A sent line: one batch FEFO took from, under its request line. */
const sentLine = (w: World, t: { id: string; fromBranchId: string; toBranchId: string }, requestLineId: string, over: Data = {}) =>
  prisma().phTransferLine.create({
    data: {
      restaurantId: w.biz.id,
      transferId: t.id,
      fromBranchId: t.fromBranchId,
      toBranchId: t.toBranchId,
      lineNo: next(),
      productId: w.productId,
      batchId: w.batchId,
      requestLineId,
      requestedQty: 0,
      sentQty: 5,
      ...over,
    } as never,
    select: { id: true },
  });

const markSent = (id: string) => prisma().phTransfer.update({ where: { id }, data: SENT() as never });

/** A SENT transfer b1 to b2 with one request line of 10 and one sent line of 10, as the service leaves it. */
async function sentTransfer(w: World) {
  const t = await transferOf(w);
  const r = await requestLine(w, t);
  const s = await sentLine(w, t, r.id, { sentQty: 10 });
  await markSent(t.id);
  return { t, r, s };
}

describe('the transfer', () => {
  it('starts as a request with a version, and one clientKey is one transfer per business', async () => {
    const w = await world();
    const t = await transferOf(w, { clientKey: 'same-key-1' });
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: 'REQUESTED', version: 1, note: '', sendKey: null, receiveKey: null });
    await expect(transferOf(w, { clientKey: 'same-key-1' })).rejects.toMatchObject({ code: 'P2002' });
    // the same key in another business is a different transfer
    await expect(
      prisma().phTransfer.create({
        data: { restaurantId: w.other.id, fromBranchId: w.otherBranchId, toBranchId: w.otherBranchId2, number: 'T-1', clientKey: 'same-key-1', payloadHash: 'h', requestedById: 'u1' },
      }),
    ).resolves.toHaveProperty('id');
  });

  it('goes from one branch to a different one', async () => {
    const w = await world();
    await expect(transferOf(w, { fromBranchId: w.b1, toBranchId: w.b1 })).rejects.toThrow(/PhTransfer_two_branches/);
    await expect(transferOf(w, { fromBranchId: w.b1, toBranchId: w.b3 })).resolves.toHaveProperty('id');
    await expect(transferOf(w, { fromBranchId: w.b3, toBranchId: w.b1 })).resolves.toHaveProperty('id');
  });

  it('has a number from the start, unique per sending branch', async () => {
    const w = await world();
    await expect(transferOf(w, { number: null })).rejects.toThrow(/PhTransfer_number_set/);
    await expect(transferOf(w, { number: '' })).rejects.toThrow(/PhTransfer_number_set/);
    await transferOf(w, { number: 'T-1-000001' });
    await expect(transferOf(w, { number: 'T-1-000001' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(transferOf(w, { fromBranchId: w.b2, toBranchId: w.b1, number: 'T-1-000001' })).resolves.toHaveProperty('id');
  });

  it('keeps a note to 500 characters', async () => {
    const w = await world();
    await expect(transferOf(w, { note: 'x'.repeat(500) })).resolves.toHaveProperty('id');
    await expect(transferOf(w, { note: 'x'.repeat(501) })).rejects.toThrow(/PhTransfer_note_length/);
  });

  it('has exactly the shape of its status: who and when, nothing stray, nothing missing', async () => {
    const w = await world();
    const sent = SENT();
    const closed = CLOSED();
    // every status in its own shape is accepted
    await expect(transferOf(w, { status: 'REQUESTED' })).resolves.toHaveProperty('id');
    await expect(transferOf(w, sent)).resolves.toHaveProperty('id');
    await expect(transferOf(w, CLOSED('RECEIVED'))).resolves.toHaveProperty('id');
    await expect(transferOf(w, CLOSED('PARTIAL'))).resolves.toHaveProperty('id');
    await expect(transferOf(w, { status: 'CANCELLED', cancelledAt: T1, cancelledById: 'u1' })).resolves.toHaveProperty('id');
    const refused: [string, Data][] = [
      ['a request that was sent', { sentAt: T0 }],
      ['a request that was received', { receivedAt: T1 }],
      ['a request that was cancelled', { cancelledAt: T1 }],
      ['a request with a canceller', { cancelledById: 'u1' }],
      ['a sent transfer without a time', { ...SENT(), sentAt: null }],
      ['a sent transfer without a sender', { ...SENT(), sentById: null }],
      ['a sent transfer with a receive time', { ...SENT(), receivedAt: T1 }],
      ['a sent transfer with a receiver', { ...SENT(), receivedById: 'u2' }],
      ['a sent transfer that was cancelled', { ...SENT(), cancelledAt: T1, cancelledById: 'u1' }],
      ['a received transfer without a receive time', { ...closed, receivedAt: null }],
      ['a received transfer without a receiver', { ...closed, receivedById: null }],
      ['a received transfer that was cancelled', { ...CLOSED(), cancelledAt: T1 }],
      ['a partial transfer without a receiver', { ...CLOSED('PARTIAL'), receivedById: null }],
      ['a cancelled transfer without a time', { status: 'CANCELLED', cancelledById: 'u1' }],
      ['a cancelled transfer without a canceller', { status: 'CANCELLED', cancelledAt: T1 }],
      ['a cancelled transfer that was sent', { status: 'CANCELLED', cancelledAt: T1, cancelledById: 'u1', sentAt: T0, sentById: 'u1' }],
      ['a cancelled transfer that was received', { status: 'CANCELLED', cancelledAt: T1, cancelledById: 'u1', receivedAt: T1 }],
    ];
    for (const [label, data] of refused) await expect(transferOf(w, data), label).rejects.toThrow(/PhTransfer_(status_shape|keys_by_status|send_key_pair|receive_key_pair)/);
  });

  it('keeps its times in order', async () => {
    const w = await world();
    await expect(transferOf(w, { ...SENT(), sentAt: new Date('2026-10-29T00:00:00.000Z') })).rejects.toThrow(/PhTransfer_times_ordered/);
    await expect(transferOf(w, { ...CLOSED(), sentAt: T1, receivedAt: T0 })).rejects.toThrow(/PhTransfer_times_ordered/);
    await expect(transferOf(w, { status: 'CANCELLED', cancelledById: 'u1', cancelledAt: new Date('2026-10-29T00:00:00.000Z') })).rejects.toThrow(/PhTransfer_times_ordered/);
    await expect(transferOf(w, { ...CLOSED(), sentAt: T0, receivedAt: T0 })).resolves.toHaveProperty('id');
  });

  it('stores the key and payload hash of the send and of the receive, each once per business', async () => {
    const w = await world();
    // a key comes with its hash, and only a sent (or closed) transfer has one
    await expect(transferOf(w, { ...SENT(), sendHash: null })).rejects.toThrow(/PhTransfer_send_key_pair/);
    await expect(transferOf(w, { ...CLOSED(), receiveHash: null })).rejects.toThrow(/PhTransfer_receive_key_pair/);
    await expect(transferOf(w, { sendKey: 'k', sendHash: 'h' })).rejects.toThrow(/PhTransfer_keys_by_status/);
    await expect(transferOf(w, { ...SENT(), receiveKey: 'k', receiveHash: 'h' })).rejects.toThrow(/PhTransfer_keys_by_status/);
    await expect(transferOf(w, { ...CLOSED(), sendKey: null, sendHash: null })).rejects.toThrow(/PhTransfer_keys_by_status/);
    await transferOf(w, { ...CLOSED(), sendKey: 'send-key-1', receiveKey: 'recv-key-1' });
    await expect(transferOf(w, { ...CLOSED(), sendKey: 'send-key-1' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(transferOf(w, { ...CLOSED(), receiveKey: 'recv-key-1' })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a branch of another business at either end', async () => {
    const w = await world();
    await expect(transferOf(w, { toBranchId: w.otherBranchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(transferOf(w, { fromBranchId: w.otherBranchId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('a transfer once it was sent', () => {
  it('cannot be deleted, with its lines, but a request or a cancelled one can', async () => {
    const w = await world();
    const { t, r, s } = await sentTransfer(w);
    await expect(prisma().phTransfer.delete({ where: { id: t.id } })).rejects.toThrow(/a sent transfer cannot be deleted/);
    await expect(prisma().phTransfer.deleteMany({ where: { id: t.id } })).rejects.toThrow(/a sent transfer cannot be deleted/);
    await expect(prisma().phTransferLine.delete({ where: { id: s.id } })).rejects.toThrow(/lines of a sent transfer cannot be deleted/);
    await expect(prisma().phTransferLine.deleteMany({ where: { transferId: t.id } })).rejects.toThrow(/lines of a sent transfer cannot be deleted/);
    expect(await prisma().phTransferLine.count({ where: { transferId: t.id } })).toBe(2);
    expect(r.id).toBeTruthy();
    // a closed one neither
    await prisma().phTransfer.update({ where: { id: t.id }, data: { status: 'RECEIVED', receivedAt: T1, receivedById: 'u2', receiveKey: 'rk', receiveHash: 'rh' } });
    await expect(prisma().phTransfer.delete({ where: { id: t.id } })).rejects.toThrow(/a sent transfer cannot be deleted/);
    // a request goes with its lines; so does a cancelled one
    const req = await transferOf(w);
    await requestLine(w, req);
    await expect(prisma().phTransfer.delete({ where: { id: req.id } })).resolves.toHaveProperty('id');
    expect(await prisma().phTransferLine.count({ where: { transferId: req.id } })).toBe(0);
    const cancelled = await transferOf(w);
    await requestLine(w, cancelled);
    await prisma().phTransfer.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED', cancelledAt: T1, cancelledById: 'u1' } });
    await expect(prisma().phTransfer.delete({ where: { id: cancelled.id } })).resolves.toHaveProperty('id');
  });

  it('only moves forward: REQUESTED to SENT or CANCELLED, SENT to RECEIVED or PARTIAL', async () => {
    const w = await world();
    const { t } = await sentTransfer(w);
    const back = { status: 'REQUESTED', sentAt: null, sentById: null, sendKey: null, sendHash: null };
    await expect(prisma().phTransfer.update({ where: { id: t.id }, data: back as never })).rejects.toThrow(/a sent transfer is received/);
    await expect(prisma().phTransfer.update({ where: { id: t.id }, data: { status: 'CANCELLED', sentAt: null, sentById: null, sendKey: null, sendHash: null, cancelledAt: T1, cancelledById: 'u1' } })).rejects.toThrow(/a sent transfer is received/);
    await expect(prisma().phTransfer.update({ where: { id: t.id }, data: { note: 'edited' } })).rejects.toThrow(/a sent transfer is received/);
    await expect(prisma().phTransfer.update({ where: { id: t.id }, data: { sentAt: T1, status: 'PARTIAL', receivedAt: T1, receivedById: 'u2', receiveKey: 'rk', receiveHash: 'rh' } })).rejects.toThrow(/the send of a transfer never changes/);
    await expect(prisma().phTransfer.update({ where: { id: t.id }, data: { status: 'PARTIAL', receivedAt: T1, receivedById: 'u2', receiveKey: 'rk', receiveHash: 'rh' } })).resolves.toHaveProperty('status', 'PARTIAL');
    // a closed transfer never changes again
    for (const data of [{ status: 'SENT' }, { status: 'RECEIVED' }, { note: 'x' }]) {
      await expect(prisma().phTransfer.update({ where: { id: t.id }, data: data as never }), JSON.stringify(data)).rejects.toThrow(/a closed transfer cannot change/);
    }
    const open = await transferOf(w);
    await expect(prisma().phTransfer.update({ where: { id: open.id }, data: { status: 'RECEIVED', sentAt: T0, sentById: 'u1', sendKey: 'k1', sendHash: 'h', receivedAt: T1, receivedById: 'u2', receiveKey: 'k2', receiveHash: 'h' } })).rejects.toThrow(/a request is sent or cancelled/);
  });

  it('never changes its ends, its keys, its number or its request', async () => {
    const w = await world();
    const t = await transferOf(w);
    for (const data of [{ toBranchId: w.b3 }, { fromBranchId: w.b3 }, { clientKey: 'other-key' }, { payloadHash: 'other' }, { number: 'T-X' }, { requestedById: 'u9' }, { requestedAt: T0 }]) {
      await expect(prisma().phTransfer.update({ where: { id: t.id }, data }), JSON.stringify(data)).rejects.toThrow(/never change/);
    }
    await expect(prisma().phTransfer.update({ where: { id: t.id }, data: { note: 'fine', version: { increment: 1 } } })).resolves.toHaveProperty('note', 'fine');
  });

  it('goes with its business when the business is deleted, sent or not', async () => {
    const w = await world();
    await sentTransfer(w);
    await prisma().subscription.deleteMany({ where: { restaurantId: w.biz.id } });
    await prisma().restaurant.delete({ where: { id: w.biz.id } });
    expect(await prisma().phTransferLine.count({ where: { restaurantId: w.biz.id } })).toBe(0);
    expect(await prisma().phTransfer.count({ where: { restaurantId: w.biz.id } })).toBe(0);
  });
});

describe('the transfer line', () => {
  it('is a request line: a product and a quantity of at least one, no batch, nothing sent, numbered once per transfer', async () => {
    const w = await world();
    const t = await transferOf(w);
    const l = await requestLine(w, t, { lineNo: 1 });
    const row = await prisma().phTransferLine.findUniqueOrThrow({ where: { id: l.id } });
    expect(row).toMatchObject({ batchId: null, requestLineId: null, sentQty: 0, receivedQty: 0, lostQty: 0, damagedQty: 0, lostReason: null, quarantine: false, fromBranchId: w.b1, toBranchId: w.b2 });
    await expect(requestLine(w, t, { lineNo: 1 })).rejects.toMatchObject({ code: 'P2002' });
    await expect(requestLine(w, await transferOf(w), { lineNo: 1 })).resolves.toHaveProperty('id');
    await expect(requestLine(w, t, { lineNo: 0 })).rejects.toThrow(/PhTransferLine_lineNo_positive/);
    await expect(requestLine(w, t, { requestedQty: 0 })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(requestLine(w, t, { requestedQty: -3 })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(requestLine(w, t, { requestedQty: 1 })).resolves.toHaveProperty('id');
  });

  it('is told apart from a sent line by its shape', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t);
    // a request line carries no batch, no sent or received quantity
    await expect(requestLine(w, t, { batchId: w.batchId })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(requestLine(w, t, { sentQty: 1 })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(requestLine(w, t, { quarantine: true })).rejects.toThrow(/PhTransferLine_kind_shape/);
    // a sent line names its request line and its batch, asks for nothing itself, and sent at least one unit
    await expect(sentLine(w, t, r.id, { requestLineId: null })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(sentLine(w, t, r.id, { batchId: null })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(sentLine(w, t, r.id, { requestedQty: 1 })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(sentLine(w, t, r.id, { sentQty: 0 })).rejects.toThrow(/PhTransferLine_kind_shape/);
    await expect(sentLine(w, t, r.id)).resolves.toHaveProperty('id');
  });

  it('never sends more than was requested, over any number of batches, and of the requested product', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t, { requestedQty: 30 });
    const second = await prisma().phBatch.create({ data: { restaurantId: w.biz.id, productId: w.productId, lot: 'L2', expiryDate: new Date('2028-01-31T00:00:00.000Z') }, select: { id: true } });
    const third = await prisma().phBatch.create({ data: { restaurantId: w.biz.id, productId: w.productId, lot: 'L3', expiryDate: new Date('2028-02-29T00:00:00.000Z') }, select: { id: true } });
    await sentLine(w, t, r.id, { sentQty: 18 });
    await expect(sentLine(w, t, r.id, { batchId: second.id, sentQty: 13 })).rejects.toThrow(/more was sent than was requested/);
    await expect(sentLine(w, t, r.id, { batchId: second.id, sentQty: 12 })).resolves.toHaveProperty('id');
    await expect(sentLine(w, t, r.id, { batchId: third.id, sentQty: 1 })).rejects.toThrow(/more was sent than was requested/);
    // another product's batch under this request line: the batch is not of the line's product
    const t3 = await transferOf(w);
    const r3 = await requestLine(w, t3);
    await expect(sentLine(w, t3, r3.id, { batchId: w.batch2Id, sentQty: 1 })).rejects.toMatchObject({ code: 'P2003' });
    // the line's product must be the request line's
    const t2 = await transferOf(w);
    const r2 = await requestLine(w, t2);
    await expect(sentLine(w, t2, r2.id, { productId: w.product2Id, batchId: w.batch2Id })).rejects.toThrow(/of the product that was requested/);
  });

  it('refuses a batch of another product, even one of the same business', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t);
    await expect(sentLine(w, t, r.id, { batchId: w.batch2Id })).rejects.toMatchObject({ code: 'P2003' });
    await expect(sentLine(w, t, r.id)).resolves.toHaveProperty('id');
  });

  it('puts a batch on one line of a transfer only, and the same batch may be on another transfer', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t, { requestedQty: 20 });
    await sentLine(w, t, r.id, { sentQty: 4 });
    await expect(sentLine(w, t, r.id, { sentQty: 4 })).rejects.toMatchObject({ code: 'P2002' });
    const t2 = await transferOf(w);
    const r2 = await requestLine(w, t2);
    await expect(sentLine(w, t2, r2.id)).resolves.toHaveProperty('id');
    // several request lines of other batches are fine
    const second = await prisma().phBatch.create({ data: { restaurantId: w.biz.id, productId: w.productId, lot: 'L2', expiryDate: new Date('2028-01-31T00:00:00.000Z') }, select: { id: true } });
    await expect(sentLine(w, t, r.id, { batchId: second.id, sentQty: 4 })).resolves.toHaveProperty('id');
  });

  it('holds no negative quantity and never accounts for more than was sent', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t, { requestedQty: 100 });
    const sent = { sentQty: 10 };
    // each quantity on its own below zero
    for (const field of ['receivedQty', 'lostQty', 'damagedQty']) {
      await expect(sentLine(w, t, r.id, { ...sent, [field]: -1 }), field).rejects.toThrow(/PhTransferLine_qty_not_negative/);
    }
    await expect(sentLine(w, t, r.id, { sentQty: -1 })).rejects.toThrow(/PhTransferLine_(qty_not_negative|kind_shape|accounted_within_sent)/);
    const second = await prisma().phBatch.create({ data: { restaurantId: w.biz.id, productId: w.productId, lot: 'L2', expiryDate: new Date('2028-01-31T00:00:00.000Z') }, select: { id: true } });
    const ids = [second.id];
    for (let i = 0; i < 5; i += 1) ids.push((await prisma().phBatch.create({ data: { restaurantId: w.biz.id, productId: w.productId, lot: `LX${i}`, expiryDate: new Date('2028-03-31T00:00:00.000Z') }, select: { id: true } })).id);
    const again = (over: Data) => sentLine(w, t, r.id, { ...sent, batchId: ids.shift(), ...over });
    await expect(again({ receivedQty: 11 })).rejects.toThrow(/PhTransferLine_accounted_within_sent/);
    await expect(again({ receivedQty: 8, lostQty: 3, lostReason: 'LOST' })).rejects.toThrow(/PhTransferLine_accounted_within_sent/);
    await expect(again({ receivedQty: 7, lostQty: 1, lostReason: 'LOST', damagedQty: 3 })).rejects.toThrow(/PhTransferLine_accounted_within_sent/);
    // the boundary: exactly everything, in every split
    await expect(again({ receivedQty: 10 })).resolves.toHaveProperty('id');
    await expect(again({ receivedQty: 8, lostQty: 2, lostReason: 'LOST' })).resolves.toHaveProperty('id');
    await expect(again({ receivedQty: 6, lostQty: 1, lostReason: 'OTHER', damagedQty: 3 })).resolves.toHaveProperty('id');
  });

  it('gives a lost quantity its reason, and a reason only with a lost quantity; a damaged quantity needs none', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t, { requestedQty: 100 });
    const batches: string[] = [];
    for (let i = 0; i < 6; i += 1) batches.push((await prisma().phBatch.create({ data: { restaurantId: w.biz.id, productId: w.productId, lot: `LR${i}`, expiryDate: new Date('2028-03-31T00:00:00.000Z') }, select: { id: true } })).id);
    const line = (over: Data) => sentLine(w, t, r.id, { sentQty: 10, receivedQty: 5, batchId: batches.shift(), ...over });
    await expect(line({ lostQty: 5 })).rejects.toThrow(/PhTransferLine_lost_reason/);
    await expect(line({ lostQty: 0, lostReason: 'LOST' })).rejects.toThrow(/PhTransferLine_lost_reason/);
    await expect(line({ lostQty: 5, lostReason: 'LOST' })).resolves.toHaveProperty('id');
    await expect(line({ lostQty: 5, lostReason: 'OTHER' })).resolves.toHaveProperty('id');
    await expect(line({ damagedQty: 5 })).resolves.toHaveProperty('id');
    // a shortfall not yet booked (still in transit) needs no reason
    await expect(line({})).resolves.toHaveProperty('id');
    // DAMAGED_IN_TRANSIT is no longer a reason
    await expect(line({ lostQty: 5, lostReason: 'DAMAGED_IN_TRANSIT' })).rejects.toThrow();
  });

  it('copies its transfer ends, and refuses ends that are not the transfer', async () => {
    const w = await world();
    const t = await transferOf(w);
    await expect(requestLine(w, t, { toBranchId: w.b3 })).rejects.toMatchObject({ code: 'P2003' });
    await expect(requestLine(w, t, { fromBranchId: w.b2, toBranchId: w.b1 })).rejects.toMatchObject({ code: 'P2003' });
    await expect(requestLine(w, t, { fromBranchId: w.otherBranchId })).rejects.toMatchObject({ code: 'P2003' });
    // a line cannot be moved to other ends either (ON UPDATE of the line, not of the transfer)
    const l = await requestLine(w, t);
    await expect(prisma().phTransferLine.update({ where: { id: l.id }, data: { toBranchId: w.b3 } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('refuses a product or a batch of another business, and a transfer of another business', async () => {
    const w = await world();
    const t = await transferOf(w);
    await expect(requestLine(w, t, { productId: w.otherProductId })).rejects.toMatchObject({ code: 'P2003' });
    const r = await requestLine(w, t);
    await expect(sentLine(w, t, r.id, { batchId: w.otherBatchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(requestLine(w, t, { restaurantId: w.other.id, productId: w.otherProductId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('keeps its batch from being deleted', async () => {
    const w = await world();
    await sentTransfer(w);
    await expect(prisma().phBatch.delete({ where: { id: w.batchId } })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the lines of a transfer follow its status', () => {
  it('are added and replaced while it is a request, not after it was sent', async () => {
    const w = await world();
    const t = await transferOf(w);
    const r = await requestLine(w, t);
    await expect(prisma().phTransferLine.update({ where: { id: r.id }, data: { requestedQty: 12 } })).resolves.toHaveProperty('requestedQty', 12);
    await expect(prisma().phTransferLine.delete({ where: { id: r.id } })).resolves.toHaveProperty('id');
    const r2 = await requestLine(w, t);
    await sentLine(w, t, r2.id);
    await markSent(t.id);
    await expect(requestLine(w, t)).rejects.toThrow(/lines are added while the transfer is a request/);
    await expect(sentLine(w, t, r2.id, { batchId: w.batchId })).rejects.toThrow(/lines are added while the transfer is a request/);
  });

  it('change only their receive columns while SENT', async () => {
    const w = await world();
    const { t, r, s } = await sentTransfer(w);
    for (const data of [{ sentQty: 9 }, { sentQty: 11 }, { batchId: null }, { requestedQty: 3 }, { lineNo: 99 }, { productId: w.product2Id }, { requestLineId: null }]) {
      await expect(prisma().phTransferLine.update({ where: { id: s.id }, data: data as never }), JSON.stringify(data)).rejects.toThrow();
    }
    await expect(prisma().phTransferLine.update({ where: { id: r.id }, data: { requestedQty: 99 } })).rejects.toThrow(/only the receive columns/);
    await expect(prisma().phTransferLine.update({ where: { id: s.id }, data: { receivedQty: 7, lostQty: 3, lostReason: 'LOST', quarantine: true } })).resolves.toMatchObject({ receivedQty: 7, lostQty: 3, quarantine: true });
    await prisma().phTransfer.update({ where: { id: t.id }, data: { status: 'PARTIAL', receivedAt: T1, receivedById: 'u2', receiveKey: 'rk', receiveHash: 'rh' } });
    // closed: nothing changes any more
    await expect(prisma().phTransferLine.update({ where: { id: s.id }, data: { receivedQty: 10, lostQty: 0, lostReason: null } })).rejects.toThrow(/lines of a closed transfer cannot change/);
  });
});

describe('the indexes', () => {
  it('has the lookups the transfer screens and the in-transit report use', async () => {
    // eslint-disable-next-line no-restricted-properties -- reads the catalog (pg_indexes), no tenant rows
    const rows = await prisma().$queryRaw<{ tablename: string; indexname: string }[]>`
      SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('PhTransfer', 'PhTransferLine')`;
    const names = rows.map((r) => r.indexname).sort();
    expect(names).toEqual(
      [
        'PhTransferLine_pkey',
        'PhTransferLine_restaurantId_batchId_idx',
        'PhTransferLine_restaurantId_id_key',
        'PhTransferLine_restaurantId_productId_idx',
        'PhTransferLine_restaurantId_transferId_id_key',
        'PhTransferLine_transferId_lineNo_key',
        'PhTransferLine_transfer_batch_key',
        'PhTransfer_fromBranchId_number_key',
        'PhTransfer_pkey',
        'PhTransfer_restaurantId_clientKey_key',
        'PhTransfer_restaurantId_fromBranchId_status_idx',
        'PhTransfer_restaurantId_id_fromBranchId_toBranchId_key',
        'PhTransfer_restaurantId_id_key',
        'PhTransfer_restaurantId_receiveKey_key',
        'PhTransfer_restaurantId_sendKey_key',
        'PhTransfer_restaurantId_status_sentAt_idx',
        'PhTransfer_restaurantId_toBranchId_status_idx',
      ].sort(),
    );
  });
});

describe('the report index', () => {
  it('has the completed-day scan per branch that the sales reports use', async () => {
    // eslint-disable-next-line no-restricted-properties -- reads the catalog (pg_indexes), no tenant rows
    const rows = await prisma().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'PhSale_restaurantId_branchId_completedAt_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain('("restaurantId", "branchId", "completedAt")');
  });
});

describe('the tenant registries', () => {
  it('scopes both models by restaurant', () => {
    for (const model of ['PhTransfer', 'PhTransferLine']) expect(RESTAURANT_SCOPED_MODELS as readonly string[], model).toContain(model);
  });

  it('confines the transfer and its line by either end, not by a single branchId', () => {
    expect(PHARMACY_EITHER_BRANCH_MODELS).toEqual(['PhTransfer', 'PhTransferLine']);
    expect(PHARMACY_BRANCH_SCOPED_MODELS).not.toContain('PhTransfer');
    expect(PHARMACY_BRANCH_SCOPED_MODELS).not.toContain('PhTransferLine');
  });
});

describe('who sees a transfer and its lines', () => {
  const as = (restaurantId: string, branchIds: string[]) => scopedClient(prisma(), { restaurantId, branchIds });

  it('shows it to the sender and the receiver, and to nobody on a third branch or in another business', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    const r = await requestLine(w, t);

    for (const ends of [[w.b1], [w.b2], [w.b1, w.b3], [w.b3, w.b2]]) {
      const db = as(w.biz.id, ends);
      expect(await db.phTransfer.count(), ends.join()).toBe(1);
      expect((await db.phTransfer.findMany()).map((x) => x.id)).toEqual([t.id]);
      expect((await db.phTransfer.findFirst({ where: { id: t.id } }))?.id).toBe(t.id);
      expect((await db.phTransfer.findUnique({ where: { id: t.id } }))?.id).toBe(t.id);
      expect((await db.phTransfer.aggregate({ _count: true }))._count).toBe(1);
      expect(await db.phTransferLine.count(), ends.join()).toBe(1);
      expect((await db.phTransferLine.findFirst({ where: { id: r.id }, include: { transfer: true } }))?.transfer.id).toBe(t.id);
    }
    // a third branch's actor sees nothing: reads, counts, groupings and includes, of the transfer and of its lines
    const third = as(w.biz.id, [w.b3]);
    expect(await third.phTransfer.count()).toBe(0);
    expect(await third.phTransfer.findMany()).toEqual([]);
    expect(await third.phTransfer.findFirst()).toBeNull();
    expect(await third.phTransfer.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await third.phTransfer.groupBy({ by: ['status'], _count: true })).toEqual([]);
    expect(await third.phTransferLine.count()).toBe(0);
    expect(await third.phTransferLine.findMany({ include: { transfer: true } })).toEqual([]);
    expect(await third.phTransferLine.findFirst({ where: { id: r.id } })).toBeNull();
    expect(await third.phTransferLine.findUnique({ where: { id: r.id } })).toBeNull();
    expect(await third.phTransferLine.aggregate({ _sum: { requestedQty: true } })).toMatchObject({ _sum: { requestedQty: null } });
    expect(await third.phTransferLine.groupBy({ by: ['productId'], _count: true })).toEqual([]);
    // no branches at all matches nothing; another business's client, even with the same branch ids, sees nothing
    expect(await as(w.biz.id, []).phTransfer.count()).toBe(0);
    expect(await as(w.biz.id, []).phTransferLine.count()).toBe(0);
    expect(await as(w.other.id, [w.b1, w.b2]).phTransfer.count()).toBe(0);
    expect(await as(w.other.id, [w.b1, w.b2]).phTransferLine.count()).toBe(0);
    // the owner's client reads every branch of its own business, and only that
    expect(await scopedClient(prisma(), { restaurantId: w.biz.id, allBranches: true }).phTransferLine.count()).toBe(1);
    expect(await scopedClient(prisma(), { restaurantId: w.other.id, allBranches: true }).phTransferLine.count()).toBe(0);
  });

  it('gives a third branch no way to write a transfer or a line: update, updateMany, delete, deleteMany, create, upsert', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    const r = await requestLine(w, t);
    const third = as(w.biz.id, [w.b3]);
    await expect(third.phTransfer.update({ where: { id: t.id }, data: { note: 'x' } })).rejects.toThrow();
    await expect(third.phTransfer.delete({ where: { id: t.id } })).rejects.toThrow();
    expect((await third.phTransfer.updateMany({ where: {}, data: { note: 'x' } })).count).toBe(0);
    expect((await third.phTransfer.deleteMany({})).count).toBe(0);
    await expect(third.phTransferLine.update({ where: { id: r.id }, data: { requestedQty: 99 } })).rejects.toThrow();
    await expect(third.phTransferLine.delete({ where: { id: r.id } })).rejects.toThrow();
    expect((await third.phTransferLine.updateMany({ where: {}, data: { requestedQty: 99 } })).count).toBe(0);
    expect((await third.phTransferLine.deleteMany({})).count).toBe(0);
    // creating a line of a foreign transfer: the ends must be in scope, and the database ties them to the transfer's
    const line = { restaurantId: w.biz.id, transferId: t.id, lineNo: 50, productId: w.productId, requestedQty: 1 };
    await expect(third.phTransferLine.create({ data: { ...line, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId } as never })).rejects.toThrow(/outside the scope/);
    await expect(third.phTransferLine.create({ data: { ...line, fromBranchId: w.b3, toBranchId: w.b1 } as never })).rejects.toMatchObject({ code: 'P2003' });
    await expect(third.phTransferLine.createMany({ data: [{ ...line, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId }] as never })).rejects.toThrow(/outside the scope/);
    await expect(third.phTransferLine.createManyAndReturn({ data: [{ ...line, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId }] as never })).rejects.toThrow(/outside the scope/);
    await expect(
      third.phTransferLine.upsert({ where: { id: r.id }, create: { ...line, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId } as never, update: { requestedQty: 99 } }),
    ).rejects.toThrow();
    expect(await prisma().phTransferLine.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ requestedQty: 10 });
    expect(await prisma().phTransferLine.count({ where: { transferId: t.id } })).toBe(1);
    expect(await prisma().phTransfer.count({ where: { id: t.id, note: '' } })).toBe(1);
  });

  it('refuses a nested write that would reach a transfer or its ends through a relation', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    const r = await requestLine(w, t);
    // a client of the SENDER's own branch: the nested paths are refused outright, not only for strangers
    const mine = as(w.biz.id, [w.b1]);
    await expect(mine.phTransferLine.update({ where: { id: r.id }, data: { transfer: { update: { status: 'CANCELLED', fromBranch: { connect: { id: w.b1 } } } } } as never })).rejects.toThrow(/through a relation/);
    await expect(mine.phTransferLine.update({ where: { id: r.id }, data: { transfer: { update: { note: 'x' } } } as never })).rejects.toThrow(/through a relation/);
    await expect(mine.phTransferLine.updateMany({ where: {}, data: { requestLine: { disconnect: true } } as never })).rejects.toThrow(/through a relation/);
    await expect(mine.phTransfer.update({ where: { id: t.id }, data: { lines: { deleteMany: {} } } as never })).rejects.toThrow(/through a relation/);
    await expect(mine.phTransfer.update({ where: { id: t.id }, data: { lines: { updateMany: { where: {}, data: { requestedQty: 1 } } } } as never })).rejects.toThrow(/through a relation/);
    await expect(mine.phTransfer.update({ where: { id: t.id }, data: { toBranch: { connect: { id: w.b3 } } } as never })).rejects.toThrow(/may not change the branches/);
    await expect(
      mine.phTransfer.create({ data: { restaurantId: w.biz.id, fromBranchId: w.b1, toBranchId: w.b2, number: 'T-N', clientKey: 'nested-1', payloadHash: 'h', requestedById: 'u1', lines: { create: [{ restaurantId: w.biz.id, lineNo: 1, productId: w.productId, requestedQty: 1 }] } } as never }),
    ).rejects.toThrow(/through a relation/);
    await expect(
      mine.phTransferLine.create({ data: { restaurantId: w.biz.id, fromBranchId: w.b1, toBranchId: w.b2, lineNo: 9, productId: w.productId, requestedQty: 1, transfer: { connect: { id: t.id } } } as never }),
    ).rejects.toThrow(/through a relation/);
    expect(await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: 'REQUESTED', fromBranchId: w.b1, toBranchId: w.b2, note: '' });
    expect(await prisma().phTransferLine.count({ where: { transferId: t.id } })).toBe(1);
  });

  it('refuses the relations into transfers from branches, batches and products in a client limited to branches', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    await sentLine(w, t, (await requestLine(w, t)).id);
    const third = as(w.biz.id, [w.b3]);
    const refusal = /through the transfer models only/;
    await expect(third.branch.findMany({ include: { phTransfersFrom: true } })).rejects.toThrow(refusal);
    await expect(third.branch.findMany({ select: { phTransfersTo: { select: { id: true } } } })).rejects.toThrow(refusal);
    await expect(third.branch.findMany({ include: { _count: { select: { phTransfersFrom: true } } } })).rejects.toThrow(refusal);
    await expect(third.branch.findMany({ where: { phTransfersFrom: { some: {} } } })).rejects.toThrow(refusal);
    await expect(third.phBatch.findMany({ include: { transferLines: true } })).rejects.toThrow(refusal);
    await expect(third.phProduct.findMany({ include: { transferLines: { include: { transfer: true } } } })).rejects.toThrow(refusal);
    await expect(third.branch.update({ where: { id: w.b1 }, data: { phTransfersFrom: { updateMany: { where: {}, data: { note: 'x' } } } } as never })).rejects.toThrow(refusal);
    await expect(third.phBatch.update({ where: { id: w.batchId }, data: { transferLines: { deleteMany: {} } } as never })).rejects.toThrow(refusal);
    // the same models without those relations still work, and an owner's client (all branches of its own business) may use them
    expect(await third.branch.count()).toBeGreaterThan(0);
    expect(await third.phBatch.count()).toBeGreaterThan(0);
    const owner = scopedClient(prisma(), { restaurantId: w.biz.id, allBranches: true });
    expect((await owner.phBatch.findMany({ where: { id: w.batchId }, include: { transferLines: true } }))[0]!.transferLines).toHaveLength(1);
    expect((await owner.branch.findMany({ where: { id: w.b1 }, include: { phTransfersFrom: true } }))[0]!.phTransfersFrom).toHaveLength(1);
    // the nothing-moved proof
    expect(await prisma().phTransfer.count({ where: { note: '' } })).toBe(1);
  });

  it('lets either end update the transfer but never move it; a sent transfer only moves forward', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    for (const end of [w.b1, w.b2]) {
      await expect(as(w.biz.id, [end]).phTransfer.update({ where: { id: t.id }, data: { note: `by ${end}` } })).resolves.toHaveProperty('note', `by ${end}`);
    }
    const db = as(w.biz.id, [w.b1]);
    await expect(db.phTransfer.update({ where: { id: t.id }, data: { toBranchId: w.b3 } })).rejects.toThrow(/may not change the branches/);
    await expect(db.phTransfer.update({ where: { id: t.id }, data: { fromBranchId: w.b3 } })).rejects.toThrow(/may not change the branches/);
    await expect(db.phTransfer.updateMany({ where: {}, data: { toBranch: { connect: { id: w.b3 } } } as never })).rejects.toThrow(/may not change the branches/);
    await expect(db.phTransferLine.updateMany({ where: {}, data: { toBranchId: w.b3 } })).rejects.toThrow(/may not change the branches/);
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } })).toBranchId).toBe(w.b2);
    // an end cannot erase a sent transfer or its lines either (the database refuses, whoever asks)
    const { t: sent } = await sentTransfer(w);
    await expect(db.phTransfer.deleteMany({ where: { id: sent.id } })).rejects.toThrow(/a sent transfer cannot be deleted/);
    await expect(as(w.biz.id, [w.b2]).phTransferLine.deleteMany({ where: { transferId: sent.id } })).rejects.toThrow(/lines of a sent transfer cannot be deleted/);
  });

  it('creates a transfer only when it names both ends and one of them is in scope, and upserts under the same rule', async () => {
    const w = await world();
    const base = { restaurantId: w.biz.id, payloadHash: 'h', requestedById: 'u1', number: 'T-1' };
    const mine = as(w.biz.id, [w.b1]);
    // the sender asks, or the receiver asks: either end may request
    await expect(mine.phTransfer.create({ data: { ...base, number: 'T-1', clientKey: 'k-1', fromBranchId: w.b1, toBranchId: w.b2 } })).resolves.toHaveProperty('id');
    await expect(mine.phTransfer.create({ data: { ...base, number: 'T-2', clientKey: 'k-2', fromBranchId: w.b3, toBranchId: w.b1 } })).resolves.toHaveProperty('id');
    // two other branches, or a missing end, is refused
    await expect(mine.phTransfer.create({ data: { ...base, clientKey: 'k-3', fromBranchId: w.b2, toBranchId: w.b3 } })).rejects.toThrow(/outside the scope/);
    await expect(mine.phTransfer.create({ data: { ...base, clientKey: 'k-4', fromBranchId: w.b1 } as never })).rejects.toThrow(/both its branches/);
    await expect(
      mine.phTransfer.createMany({ data: [{ ...base, clientKey: 'k-5', fromBranchId: w.b1, toBranchId: w.b2 }, { ...base, clientKey: 'k-6', fromBranchId: w.b2, toBranchId: w.b3 }] }),
    ).rejects.toThrow(/outside the scope/);
    await expect(mine.phTransfer.createManyAndReturn({ data: [{ ...base, clientKey: 'k-8', fromBranchId: w.b2, toBranchId: w.b3 }] })).rejects.toThrow(/outside the scope/);
    expect(await prisma().phTransfer.count({ where: { clientKey: { in: ['k-3', 'k-4', 'k-5', 'k-6', 'k-8'] } } })).toBe(0);
    // another business's id is refused, whatever the branches
    await expect(mine.phTransfer.create({ data: { ...base, restaurantId: w.other.id, clientKey: 'k-7', fromBranchId: w.b1, toBranchId: w.b2 } })).rejects.toThrow(/another restaurant/);
    // upsert: an in-scope create works, an out-of-scope create is refused, an end in the update is refused, a foreign where finds nothing
    await expect(
      mine.phTransfer.upsert({ where: { restaurantId_clientKey: { restaurantId: w.biz.id, clientKey: 'k-u1' } }, create: { ...base, number: 'T-3', clientKey: 'k-u1', fromBranchId: w.b1, toBranchId: w.b3 }, update: {} }),
    ).resolves.toHaveProperty('id');
    await expect(
      mine.phTransfer.upsert({ where: { restaurantId_clientKey: { restaurantId: w.biz.id, clientKey: 'k-u2' } }, create: { ...base, clientKey: 'k-u2', fromBranchId: w.b2, toBranchId: w.b3 }, update: {} }),
    ).rejects.toThrow(/outside the scope/);
    await expect(
      mine.phTransfer.upsert({ where: { restaurantId_clientKey: { restaurantId: w.biz.id, clientKey: 'k-u1' } }, create: { ...base, clientKey: 'k-u1', fromBranchId: w.b1, toBranchId: w.b3 }, update: { toBranchId: w.b2 } }),
    ).rejects.toThrow(/may not change the branches/);
    const foreign = await transferOf(w, { fromBranchId: w.b2, toBranchId: w.b3, clientKey: 'k-foreign' });
    await expect(
      mine.phTransfer.upsert({ where: { id: foreign.id }, create: { ...base, number: 'T-9', clientKey: 'k-u3', fromBranchId: w.b1, toBranchId: w.b2 }, update: { note: 'x' } }),
    ).resolves.toBeTruthy();
    expect(await prisma().phTransfer.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({ note: '' });
  });

  it('refuses the models to a client with neither branches nor allBranches', async () => {
    const w = await world();
    await transferOf(w);
    const bare = scopedClient(prisma(), { restaurantId: w.biz.id });
    await expect(bare.phTransfer.findMany()).rejects.toThrow(/branch-scoped/);
    await expect(bare.phTransfer.count()).rejects.toThrow(/branch-scoped/);
    await expect(bare.phTransferLine.findMany()).rejects.toThrow(/branch-scoped/);
  });
});

// Every way into a transfer, from the schema ---------------------------------------------------------------------------------

type Rel = { name: string; type: string; list: boolean };
type Delegates = Record<string, Record<string, (args: unknown) => Promise<unknown>>>;

/** The models of schema.prisma with their relation fields (name, target model, list or not). */
function schemaRelations(): Map<string, Rel[]> {
  const text = readFileSync('prisma/schema.prisma', 'utf8');
  const names = new Set([...text.matchAll(/^model (\w+) \{/gm)].map((m) => m[1] as string));
  const out = new Map<string, Rel[]>();
  for (const m of text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fields = [...(m[2] as string).matchAll(/^\s*(\w+)\s+(\w+)(\[\])?\??(?:[ \t]+@relation|[ \t]*$)/gm)]
      .filter((f) => names.has(f[2] as string))
      .map((f) => ({ name: f[1] as string, type: f[2] as string, list: f[3] !== undefined }));
    out.set(m[1] as string, fields);
  }
  return out;
}
const delegateOf = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

describe('every relation that reaches a transfer, from the schema', () => {
  const as = (restaurantId: string, branchIds: string[]) => scopedClient(prisma(), { restaurantId, branchIds }) as unknown as Delegates;
  const through = /through the transfer models only/;
  const nested = /(may not go through a relation|may not set a branch by relation|may not change the branches|Tenant mismatch)/;
  const TRANSFER = new Set(['PhTransfer', 'PhTransferLine']);
  const relations = schemaRelations();
  const into = (model: string) => (relations.get(model) ?? []).filter((f) => TRANSFER.has(f.type));

  it('finds the relations the registry blocks', () => {
    const found = [...relations.keys()].filter((m) => !TRANSFER.has(m)).flatMap((m) => into(m).map((f) => `${m}.${f.name}`));
    expect(found.sort()).toEqual(['Branch.phTransfersFrom', 'Branch.phTransfersTo', 'PhBatch.transferLines', 'PhProduct.transferLines', 'Restaurant.phTransferLines', 'Restaurant.phTransfers']);
  });

  it('refuses each of them to a client limited to branches: include, select, count, where, and every nested write', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b3 });
    const r = await requestLine(w, t);
    for (const ends of [[w.b3], [w.b1], [w.b2]]) {
      const db = as(w.biz.id, ends);
      for (const model of relations.keys()) {
        if (TRANSFER.has(model)) continue;
        for (const f of into(model)) {
          const label = `${model}.${f.name} for ${ends.join()}`;
          const d = db[delegateOf(model)]!;
          await expect(d.findMany!({ include: { [f.name]: true } }), label).rejects.toThrow(through);
          await expect(d.findMany!({ select: { [f.name]: { select: { id: true } } } }), label).rejects.toThrow(through);
          await expect(d.findMany!({ include: { _count: { select: { [f.name]: true } } } }), label).rejects.toThrow(through);
          await expect(d.findFirst!({ where: { [f.name]: { some: {} } } }), label).rejects.toThrow(through);
          await expect(d.findFirst!({ include: { [f.name]: { include: { lines: true } } } }), label).rejects.toThrow(through);
          for (const op of ['update', 'updateMany', 'upsert']) {
            const call = (data: unknown) => (op === 'upsert' ? d.upsert!({ where: { id: 'x' }, create: data, update: data }) : d[op]!({ where: { id: 'x' }, data }));
            for (const write of [{ deleteMany: {} }, { updateMany: { where: {}, data: { requestedQty: 999 } } }, { create: {} }, { connect: { id: r.id } }, { delete: { id: r.id } }, { disconnect: true }]) {
              await expect(call({ [f.name]: write }), `${label} ${op}`).rejects.toThrow(through);
            }
          }
          await expect(d.create!({ data: { [f.name]: { create: {} } } }), label).rejects.toThrow(through);
        }
      }
    }
    // nothing moved
    expect(await prisma().phTransferLine.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ requestedQty: 10 });
    expect(await prisma().phTransfer.count()).toBe(1);
  });

  it('refuses a chain from a transfer through its restaurant, branches, product or batch back into other transfers', async () => {
    const w = await world();
    const visible = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    await requestLine(w, visible);
    const hidden = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b3 });
    await requestLine(w, hidden);
    const db = as(w.biz.id, [w.b2]);
    expect((await db.phTransfer!.findMany!({})) as unknown[]).toHaveLength(1);
    let chains = 0;
    for (const model of TRANSFER) {
      for (const hop of (relations.get(model) ?? []).filter((f) => !TRANSFER.has(f.type))) {
        for (const back of into(hop.type)) {
          chains += 1;
          const label = `${model}.${hop.name}.${back.name}`;
          await expect(db[delegateOf(model)]!.findMany!({ include: { [hop.name]: { include: { [back.name]: true } } } }), label).rejects.toThrow(through);
          await expect(db[delegateOf(model)]!.findMany!({ select: { [hop.name]: { select: { [back.name]: { select: { id: true } } } } } }), label).rejects.toThrow(through);
        }
      }
    }
    expect(chains).toBeGreaterThanOrEqual(8);
    // reading its own lines and ends is fine: they are the visible transfer's
    const own = (await db.phTransfer!.findMany!({ include: { lines: true, fromBranch: { select: { name: true } } } })) as { lines: unknown[] }[];
    expect(own).toHaveLength(1);
    expect(own[0]!.lines).toHaveLength(1);
  });

  it('refuses a write to a transfer or a line that carries any of their relations, however it is spelled', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    const r = await requestLine(w, t);
    const db = as(w.biz.id, [w.b1]);
    for (const model of TRANSFER) {
      const d = db[delegateOf(model)]!;
      const id = model === 'PhTransfer' ? t.id : r.id;
      for (const f of relations.get(model) ?? []) {
        for (const write of [{ update: { note: 'x' } }, { updateMany: { where: {}, data: {} } }, { deleteMany: {} }, { delete: true }, { connect: { id: 'x' } }, { create: {} }, { upsert: {} }, { set: [] }]) {
          const label = `${model}.${f.name} ${Object.keys(write)[0]}`;
          await expect(d.update!({ where: { id }, data: { [f.name]: write } }), label).rejects.toThrow(nested);
          await expect(d.updateMany!({ where: { id }, data: { [f.name]: write } }), label).rejects.toThrow(nested);
          await expect(d.upsert!({ where: { id }, create: { [f.name]: write }, update: { [f.name]: write } }), label).rejects.toThrow(nested);
          await expect(d.create!({ data: { [f.name]: write } }), label).rejects.toThrow(nested);
        }
      }
    }
    expect(await prisma().phTransferLine.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ requestedQty: 10 });
  });

  it('still lets an owner client (all branches of its business) use them', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b3 });
    await requestLine(w, t);
    const owner = scopedClient(prisma(), { restaurantId: w.biz.id, allBranches: true });
    const restaurant = await owner.restaurant.findFirstOrThrow({ include: { phTransfers: { include: { lines: true } } } });
    expect(restaurant.phTransfers).toHaveLength(1);
  });
});
