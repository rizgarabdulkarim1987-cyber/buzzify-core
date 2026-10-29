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

/** A business with three branches, one product with one batch, and a second business with a branch, product and batch. */
async function world() {
  const biz = await pharmacy('A', { branches: 3 });
  const other = await pharmacy('B', { branches: 2 });
  const mk = async (restaurantId: string, tag: string) => {
    const product = await prisma().phProduct.create({
      data: {
        restaurantId,
        tradeName: 'Panadol',
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
  const b = await mk(other.id, 'B');
  const [b1, b2, b3] = biz.branchIds as [string, string, string];
  return { biz, other, b1, b2, b3, ...a, otherProductId: b.productId, otherBatchId: b.batchId, otherBranchId: other.branchId, otherBranchId2: other.branchIds[1]! };
}
type World = Awaited<ReturnType<typeof world>>;

const transferOf = (w: World, over: Data = {}) =>
  prisma().phTransfer.create({
    data: {
      restaurantId: w.biz.id,
      fromBranchId: w.b1,
      toBranchId: w.b2,
      clientKey: `tr-${next()}`,
      payloadHash: `h-${next()}`,
      requestedById: 'u1',
      ...over,
    } as never,
    select: { id: true },
  });

const lineOf = (w: World, transferId: string, over: Data = {}) =>
  prisma().phTransferLine.create({
    data: { restaurantId: w.biz.id, transferId, lineNo: next(), productId: w.productId, requestedQty: 10, ...over } as never,
    select: { id: true },
  });

const T0 = new Date('2026-10-31T08:00:00.000Z');
const T1 = new Date('2026-10-31T12:00:00.000Z');

describe('the transfer', () => {
  it('starts as a request with a version and no number, and one clientKey is one transfer per business', async () => {
    const w = await world();
    const t = await transferOf(w, { clientKey: 'same-key-1' });
    const row = await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe('REQUESTED');
    expect(row.number).toBeNull();
    expect(row.version).toBe(1);
    expect(row.note).toBe('');
    await expect(transferOf(w, { clientKey: 'same-key-1' })).rejects.toMatchObject({ code: 'P2002' });
    // the same key in another business is a different transfer
    await expect(
      prisma().phTransfer.create({
        data: { restaurantId: w.other.id, fromBranchId: w.otherBranchId, toBranchId: w.otherBranchId2, clientKey: 'same-key-1', payloadHash: 'h', requestedById: 'u1' },
      }),
    ).resolves.toHaveProperty('id');
  });

  it('goes from one branch to a different one', async () => {
    const w = await world();
    await expect(transferOf(w, { fromBranchId: w.b1, toBranchId: w.b1 })).rejects.toThrow(/PhTransfer_two_branches/);
    await expect(transferOf(w, { fromBranchId: w.b1, toBranchId: w.b3 })).resolves.toHaveProperty('id');
    await expect(transferOf(w, { fromBranchId: w.b3, toBranchId: w.b1 })).resolves.toHaveProperty('id');
  });

  it('numbers each sending branch separately, once', async () => {
    const w = await world();
    await transferOf(w, { number: 'T-1-000001' });
    await expect(transferOf(w, { number: 'T-1-000001' })).rejects.toMatchObject({ code: 'P2002' });
    await expect(transferOf(w, { fromBranchId: w.b2, toBranchId: w.b1, number: 'T-1-000001' })).resolves.toHaveProperty('id');
    // requests without a number do not collide
    await transferOf(w);
    await expect(transferOf(w)).resolves.toHaveProperty('id');
  });

  it('keeps a note to 500 characters', async () => {
    const w = await world();
    await expect(transferOf(w, { note: 'x'.repeat(500) })).resolves.toHaveProperty('id');
    await expect(transferOf(w, { note: 'x'.repeat(501) })).rejects.toThrow(/PhTransfer_note_length/);
  });

  it('is sent only with a sender and a send time', async () => {
    const w = await world();
    for (const status of ['SENT', 'RECEIVED', 'PARTIAL']) {
      const recv = status === 'SENT' ? {} : { receivedAt: T1 };
      await expect(transferOf(w, { status, ...recv })).rejects.toThrow(/PhTransfer_sent_needs_sender/);
      await expect(transferOf(w, { status, sentAt: T0, ...recv })).rejects.toThrow(/PhTransfer_sent_needs_sender/);
      await expect(transferOf(w, { status, sentById: 'u1', ...recv })).rejects.toThrow(/PhTransfer_sent_needs_sender/);
      await expect(transferOf(w, { status, sentAt: T0, sentById: 'u1', ...recv })).resolves.toHaveProperty('id');
    }
  });

  it('is received or partial only with a receive time', async () => {
    const w = await world();
    const sent = { sentAt: T0, sentById: 'u1' };
    for (const status of ['RECEIVED', 'PARTIAL']) {
      await expect(transferOf(w, { status, ...sent })).rejects.toThrow(/PhTransfer_received_needs_time/);
      await expect(transferOf(w, { status, ...sent, receivedAt: T1, receivedById: 'u2' })).resolves.toHaveProperty('id');
    }
  });

  it('is cancelled only with a cancel time and never after it was sent', async () => {
    const w = await world();
    await expect(transferOf(w, { status: 'CANCELLED' })).rejects.toThrow(/PhTransfer_cancelled_never_sent/);
    await expect(transferOf(w, { status: 'CANCELLED', cancelledAt: T1, sentAt: T0, sentById: 'u1' })).rejects.toThrow(/PhTransfer_cancelled_never_sent/);
    await expect(transferOf(w, { status: 'CANCELLED', cancelledAt: T1, cancelledById: 'u1' })).resolves.toHaveProperty('id');
  });

  it('is a request while it has neither been sent nor received', async () => {
    const w = await world();
    await expect(transferOf(w, { status: 'REQUESTED', sentAt: T0 })).rejects.toThrow(/PhTransfer_requested_not_sent/);
    await expect(transferOf(w, { status: 'REQUESTED', receivedAt: T1 })).rejects.toThrow(/PhTransfer_requested_not_sent/);
    await expect(transferOf(w, { status: 'REQUESTED' })).resolves.toHaveProperty('id');
  });

  it('refuses a branch of another business at either end', async () => {
    const w = await world();
    await expect(transferOf(w, { toBranchId: w.otherBranchId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(transferOf(w, { fromBranchId: w.otherBranchId })).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('the transfer line', () => {
  it('starts requested with nothing sent, and is numbered once per transfer', async () => {
    const w = await world();
    const t = await transferOf(w);
    const l = await lineOf(w, t.id, { lineNo: 1 });
    const row = await prisma().phTransferLine.findUniqueOrThrow({ where: { id: l.id } });
    expect(row).toMatchObject({ batchId: null, sentQty: 0, receivedQty: 0, lostQty: 0, damagedQty: 0, diffReason: null, quarantine: false });
    await expect(lineOf(w, t.id, { lineNo: 1 })).rejects.toMatchObject({ code: 'P2002' });
    // the same number on another transfer is fine
    const t2 = await transferOf(w);
    await expect(lineOf(w, t2.id, { lineNo: 1 })).resolves.toHaveProperty('id');
  });

  it('counts lines from 1 and requests at least one unit', async () => {
    const w = await world();
    const t = await transferOf(w);
    await expect(lineOf(w, t.id, { lineNo: 0 })).rejects.toThrow(/PhTransferLine_lineNo_positive/);
    await expect(lineOf(w, t.id, { lineNo: 1 })).resolves.toHaveProperty('id');
    await expect(lineOf(w, t.id, { requestedQty: 0 })).rejects.toThrow(/PhTransferLine_requestedQty_positive/);
    await expect(lineOf(w, t.id, { requestedQty: -3 })).rejects.toThrow(/PhTransferLine_requestedQty_positive/);
    await expect(lineOf(w, t.id, { requestedQty: 1 })).resolves.toHaveProperty('id');
  });

  it('holds no negative quantity', async () => {
    const w = await world();
    const t = await transferOf(w);
    for (const field of ['sentQty', 'receivedQty', 'lostQty', 'damagedQty']) {
      await expect(lineOf(w, t.id, { batchId: w.batchId, diffReason: 'OTHER', [field]: -1 })).rejects.toThrow(/PhTransferLine_qty_not_negative|PhTransferLine_accounted_within_sent/);
    }
    // the check itself, on a row the other rules would let through
    await expect(lineOf(w, t.id, { batchId: w.batchId, sentQty: 5, receivedQty: 6, lostQty: -1, diffReason: 'LOST' })).rejects.toThrow(/PhTransferLine_qty_not_negative/);
  });

  it('never accounts for more than was sent', async () => {
    const w = await world();
    const t = await transferOf(w);
    const sent = { batchId: w.batchId, sentQty: 10 };
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 11 })).rejects.toThrow(/PhTransferLine_accounted_within_sent/);
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 8, lostQty: 3, diffReason: 'LOST' })).rejects.toThrow(/PhTransferLine_accounted_within_sent/);
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 7, lostQty: 1, damagedQty: 3, diffReason: 'DAMAGED_IN_TRANSIT' })).rejects.toThrow(/PhTransferLine_accounted_within_sent/);
    // the boundary: exactly everything, in every split
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 10 })).resolves.toHaveProperty('id');
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 8, lostQty: 2, diffReason: 'LOST' })).resolves.toHaveProperty('id');
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 6, lostQty: 1, damagedQty: 3, diffReason: 'OTHER' })).resolves.toHaveProperty('id');
    await expect(lineOf(w, t.id, { ...sent, damagedQty: 10, diffReason: 'DAMAGED_IN_TRANSIT' })).resolves.toHaveProperty('id');
  });

  it('gives a reason for a lost or damaged quantity', async () => {
    const w = await world();
    const t = await transferOf(w);
    const sent = { batchId: w.batchId, sentQty: 10, receivedQty: 5 };
    await expect(lineOf(w, t.id, { ...sent, lostQty: 5 })).rejects.toThrow(/PhTransferLine_loss_needs_reason/);
    await expect(lineOf(w, t.id, { ...sent, damagedQty: 5 })).rejects.toThrow(/PhTransferLine_loss_needs_reason/);
    await expect(lineOf(w, t.id, { ...sent, lostQty: 5, diffReason: 'LOST' })).resolves.toHaveProperty('id');
    // a shortfall not yet booked (still in transit) needs no reason; nor does a reason with no quantity
    await expect(lineOf(w, t.id, { ...sent })).resolves.toHaveProperty('id');
    await expect(lineOf(w, t.id, { ...sent, receivedQty: 10, diffReason: 'OTHER' })).resolves.toHaveProperty('id');
  });

  it('has sent nothing while it has no batch', async () => {
    const w = await world();
    const t = await transferOf(w);
    await expect(lineOf(w, t.id, { sentQty: 1 })).rejects.toThrow(/PhTransferLine_unsent_has_no_batch/);
    await expect(lineOf(w, t.id, { batchId: w.batchId, sentQty: 1 })).resolves.toHaveProperty('id');
    // one requested product may be sent from several batches: one line per batch
    await expect(lineOf(w, t.id, { batchId: w.batchId, sentQty: 4 })).resolves.toHaveProperty('id');
  });

  it('refuses a product or a batch of another business, and a transfer of another business', async () => {
    const w = await world();
    const t = await transferOf(w);
    await expect(lineOf(w, t.id, { productId: w.otherProductId })).rejects.toMatchObject({ code: 'P2003' });
    await expect(lineOf(w, t.id, { batchId: w.otherBatchId, sentQty: 1 })).rejects.toMatchObject({ code: 'P2003' });
    await expect(lineOf(w, t.id, { restaurantId: w.other.id, productId: w.otherProductId })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('goes with its transfer when the business goes, and a line keeps its batch from being deleted', async () => {
    const w = await world();
    const t = await transferOf(w);
    await lineOf(w, t.id, { batchId: w.batchId, sentQty: 2 });
    await expect(prisma().phBatch.delete({ where: { id: w.batchId } })).rejects.toMatchObject({ code: 'P2003' });
    await prisma().subscription.deleteMany({ where: { restaurantId: w.biz.id } });
    await prisma().restaurant.delete({ where: { id: w.biz.id } });
    expect(await prisma().phTransferLine.count({ where: { restaurantId: w.biz.id } })).toBe(0);
    expect(await prisma().phTransfer.count({ where: { restaurantId: w.biz.id } })).toBe(0);
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
        'PhTransferLine_transferId_lineNo_key',
        'PhTransfer_fromBranchId_number_key',
        'PhTransfer_pkey',
        'PhTransfer_restaurantId_clientKey_key',
        'PhTransfer_restaurantId_fromBranchId_status_idx',
        'PhTransfer_restaurantId_id_key',
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

  it('confines the transfer by either end, not by a single branchId, and the line through its transfer', () => {
    expect(PHARMACY_EITHER_BRANCH_MODELS).toEqual(['PhTransfer']);
    // it has no branchId, so it is not on the single-branch list; the line has neither
    expect(PHARMACY_BRANCH_SCOPED_MODELS).not.toContain('PhTransfer');
    expect(PHARMACY_BRANCH_SCOPED_MODELS).not.toContain('PhTransferLine');
    expect(PHARMACY_EITHER_BRANCH_MODELS).not.toContain('PhTransferLine');
  });
});

describe('who sees a transfer', () => {
  it('shows it to the sender and the receiver, and to nobody on a third branch or in another business', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    await lineOf(w, t.id);
    const as = (restaurantId: string, branchIds: string[]) => scopedClient(prisma(), { restaurantId, branchIds });

    for (const ends of [[w.b1], [w.b2], [w.b1, w.b3], [w.b3, w.b2]]) {
      const db = as(w.biz.id, ends);
      expect(await db.phTransfer.count(), ends.join()).toBe(1);
      expect((await db.phTransfer.findMany()).map((r) => r.id)).toEqual([t.id]);
      expect((await db.phTransfer.findUnique({ where: { id: t.id } }))?.id).toBe(t.id);
      expect((await db.phTransfer.aggregate({ _count: true }))._count).toBe(1);
    }
    // a third branch's actor sees nothing: reads, counts, groupings, and writes
    const third = as(w.biz.id, [w.b3]);
    expect(await third.phTransfer.count()).toBe(0);
    expect(await third.phTransfer.findMany()).toEqual([]);
    expect(await third.phTransfer.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await third.phTransfer.groupBy({ by: ['status'], _count: true })).toEqual([]);
    await expect(third.phTransfer.update({ where: { id: t.id }, data: { note: 'x' } })).rejects.toThrow();
    expect((await third.phTransfer.updateMany({ where: {}, data: { note: 'x' } })).count).toBe(0);
    expect((await third.phTransfer.deleteMany({})).count).toBe(0);
    expect(await prisma().phTransfer.count({ where: { id: t.id, note: '' } })).toBe(1);
    // no branches at all matches nothing; another business's client, even with the same branch ids, sees nothing
    expect(await as(w.biz.id, []).phTransfer.count()).toBe(0);
    expect(await as(w.other.id, [w.b1, w.b2]).phTransfer.count()).toBe(0);
    // the owner's client reads every branch of its own business, and only that
    expect(await scopedClient(prisma(), { restaurantId: w.biz.id, allBranches: true }).phTransfer.count()).toBe(1);
    expect(await scopedClient(prisma(), { restaurantId: w.other.id, allBranches: true }).phTransfer.count()).toBe(0);
  });

  it('lets either end update the transfer but never move it', async () => {
    const w = await world();
    const t = await transferOf(w, { fromBranchId: w.b1, toBranchId: w.b2 });
    for (const end of [w.b1, w.b2]) {
      const db = scopedClient(prisma(), { restaurantId: w.biz.id, branchIds: [end] });
      await expect(db.phTransfer.update({ where: { id: t.id }, data: { note: `by ${end}` } })).resolves.toHaveProperty('note', `by ${end}`);
    }
    const db = scopedClient(prisma(), { restaurantId: w.biz.id, branchIds: [w.b1] });
    await expect(db.phTransfer.update({ where: { id: t.id }, data: { toBranchId: w.b3 } })).rejects.toThrow(/may not change the branches/);
    await expect(db.phTransfer.update({ where: { id: t.id }, data: { fromBranchId: w.b3 } })).rejects.toThrow(/may not change the branches/);
    await expect(db.phTransfer.updateMany({ where: {}, data: { toBranch: { connect: { id: w.b3 } } } as never })).rejects.toThrow(/may not change the branches/);
    expect((await prisma().phTransfer.findUniqueOrThrow({ where: { id: t.id } })).toBranchId).toBe(w.b2);
  });

  it('creates a transfer only when it names both ends and one of them is in scope', async () => {
    const w = await world();
    const base = { restaurantId: w.biz.id, payloadHash: 'h', requestedById: 'u1' };
    const mine = scopedClient(prisma(), { restaurantId: w.biz.id, branchIds: [w.b1] });
    // the sender asks, or the receiver asks: either end may request
    await expect(mine.phTransfer.create({ data: { ...base, clientKey: 'k-1', fromBranchId: w.b1, toBranchId: w.b2 } })).resolves.toHaveProperty('id');
    await expect(mine.phTransfer.create({ data: { ...base, clientKey: 'k-2', fromBranchId: w.b3, toBranchId: w.b1 } })).resolves.toHaveProperty('id');
    // two other branches, or a missing end, is refused
    await expect(mine.phTransfer.create({ data: { ...base, clientKey: 'k-3', fromBranchId: w.b2, toBranchId: w.b3 } })).rejects.toThrow(/outside the scope/);
    await expect(mine.phTransfer.create({ data: { ...base, clientKey: 'k-4', fromBranchId: w.b1 } as never })).rejects.toThrow(/both its branches/);
    await expect(
      mine.phTransfer.createMany({ data: [{ ...base, clientKey: 'k-5', fromBranchId: w.b1, toBranchId: w.b2 }, { ...base, clientKey: 'k-6', fromBranchId: w.b2, toBranchId: w.b3 }] }),
    ).rejects.toThrow(/outside the scope/);
    expect(await prisma().phTransfer.count({ where: { clientKey: { in: ['k-3', 'k-4', 'k-5', 'k-6'] } } })).toBe(0);
    // another business's id is refused, whatever the branches
    await expect(mine.phTransfer.create({ data: { ...base, restaurantId: w.other.id, clientKey: 'k-7', fromBranchId: w.b1, toBranchId: w.b2 } })).rejects.toThrow(/another restaurant/);
  });

  it('refuses the model to a client with neither branches nor allBranches', async () => {
    const w = await world();
    await transferOf(w);
    const bare = scopedClient(prisma(), { restaurantId: w.biz.id });
    await expect(bare.phTransfer.findMany()).rejects.toThrow(/branch-scoped/);
    await expect(bare.phTransfer.count()).rejects.toThrow(/branch-scoped/);
  });

  it('shows the lines of a transfer through the restaurant, as for receipt lines', async () => {
    const w = await world();
    const t = await transferOf(w);
    await lineOf(w, t.id);
    expect(await scopedClient(prisma(), { restaurantId: w.biz.id, branchIds: [w.b3] }).phTransferLine.count()).toBe(1);
    expect(await scopedClient(prisma(), { restaurantId: w.other.id, branchIds: [w.b3] }).phTransferLine.count()).toBe(0);
  });
});
