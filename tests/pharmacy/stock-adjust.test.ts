import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as stockActions from '@/server/pharmacy/actions/stock';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import { NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';
import { act, balanceOf, codeOf, dataOf, makeBatch, makeProduct, phCodeOf, stockInto } from './stock-helpers';

beforeAll(() => {
  useTestDatabase();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(resetWorld);

let seq = 0;
const key = () => `adjust-key-${(seq += 1)}`;

async function world(batchOpts: Parameters<typeof makeBatch>[3] = { buckets: { available: 100 } }) {
  const a = await pharmacy('A', { branches: 2 });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  const p = await makeProduct(a.id);
  const batchId = await makeBatch(a.id, a.branchId, p.id, batchOpts);
  const at = { restaurantId: a.id, branchId: a.branchId };
  return { a, owner, p, batchId, at };
}

const movements = () => prisma().phStockMovement.findMany({ orderBy: { createdAt: 'asc' } });

describe('ph.stock.adjust', () => {
  it('out: removes from a bucket as one ADJUST movement and audits it', async () => {
    const { owner, at, batchId } = await world();
    const done = dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 30, reason: 'Lost in the shop', clientKey: key() }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 70, reserved: 0, quarantine: 0, damaged: 0 });
    const row = await prisma().phStockMovement.findUniqueOrThrow({ where: { id: done.id } });
    expect(row).toMatchObject({ type: 'ADJUST', availableDelta: -30, reason: 'Lost in the shop', branchId: at.branchId });
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.stock.adjust', entityId: done.id } });
    expect(JSON.stringify(audit.changes)).not.toContain('Lost in the shop');
  });

  it('in: adds to available; a unit and qty are converted with toBase', async () => {
    const { owner, at, batchId, p } = await world();
    dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', unitId: p.strip, qty: 3, reason: 'Found on a shelf', clientKey: key() }));
    expect((await balanceOf(batchId, at.branchId))!.available).toBe(130);
  });

  it('move: one movement with two deltas, atomic', async () => {
    const { owner, at, batchId } = await world();
    const done = dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'move', bucketFrom: 'available', bucketTo: 'reserved', baseQty: 40, reason: 'Held for an order', clientKey: key() }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 60, reserved: 40, quarantine: 0, damaged: 0 });
    const mine = (await movements()).filter((r) => r.id === done.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ availableDelta: -40, reservedDelta: 40 });
    // Too much: refused, nothing written.
    const before = (await movements()).length;
    const over = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'move', bucketFrom: 'available', bucketTo: 'damaged', baseQty: 61, reason: 'Too much', clientKey: key() });
    expect(phCodeOf(over)).toBe('INSUFFICIENT_STOCK');
    expect((await movements()).length).toBe(before);
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 60, reserved: 40, quarantine: 0, damaged: 0 });
  });

  it('refuses more than a bucket holds and writes nothing', async () => {
    const { owner, at, batchId } = await world();
    const before = (await movements()).length;
    const r = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'quarantine', baseQty: 1, reason: 'Nothing there', clientKey: key() });
    expect(phCodeOf(r)).toBe('INSUFFICIENT_STOCK');
    expect((await movements()).length).toBe(before);
    expect(await prisma().auditLog.count({ where: { action: 'ph.stock.adjust' } })).toBe(0);
  });

  it('needs a reason of 3 to 300 characters, a direction-fitting bucket and exactly one quantity form', async () => {
    const { owner, at, batchId, p } = await world();
    const base = { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 1 };
    for (const reason of ['', '  ', 'ab', 'x'.repeat(301)]) {
      const r = await act(owner, stockActions.adjust, { ...base, reason, clientKey: key() });
      expect(codeOf(r), reason).toBe('INVALID');
      expect(r.ok ? null : r.error.fields).toHaveProperty('reason');
    }
    const cases: Record<string, unknown>[] = [
      { baseQty: 0 },
      { baseQty: 1.5 },
      { baseQty: undefined },
      { baseQty: 5, unitId: p.strip, qty: 1 },
      { baseQty: undefined, unitId: p.strip },
      { direction: 'move', bucketTo: 'available' },
      { direction: 'move', bucketFrom: 'available', bucketTo: 'available' },
      { direction: 'in', bucketFrom: 'available' },
      { direction: 'out', bucketFrom: undefined, bucketTo: 'available' },
    ];
    for (const over of cases) {
      const r = await act(owner, stockActions.adjust, { ...base, reason: 'Valid reason', clientKey: key(), ...over });
      expect(codeOf(r), JSON.stringify(over)).toBe('INVALID');
    }
    expect(await movements()).toHaveLength(1);
  });

  it('refuses a unit of another product', async () => {
    const { a, owner, at, batchId } = await world();
    const other = await makeProduct(a.id, 'Brufen');
    const r = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', unitId: other.strip, qty: 1, reason: 'Wrong unit', clientKey: key() });
    expect(codeOf(r)).toBe('INVALID');
    expect(r.ok ? null : r.error.fields).toHaveProperty('unitId');
  });

  it('needs a branch in the place', async () => {
    const { a, owner, batchId } = await world();
    const r = await act(owner, stockActions.adjust, { restaurantId: a.id, batchId, direction: 'in', baseQty: 1, reason: 'No branch', clientKey: key() });
    expect(codeOf(r)).toBe('INVALID');
    expect(r.ok ? null : r.error.fields).toHaveProperty('branchId');
  });

  it('is idempotent by clientKey; the same key with another payload is a CONFLICT', async () => {
    const { owner, at, batchId } = await world();
    const input = { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 10, reason: 'Broken box', clientKey: 'idem-key-1' };
    const first = dataOf(await act(owner, stockActions.adjust, input));
    const again = dataOf(await act(owner, stockActions.adjust, input));
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    expect((await balanceOf(batchId, at.branchId))!.available).toBe(90);
    expect(await prisma().auditLog.count({ where: { action: 'ph.stock.adjust' } })).toBe(1);
    const other = await act(owner, stockActions.adjust, { ...input, baseQty: 11 });
    expect(phCodeOf(other)).toBe('CLIENT_KEY_MISMATCH');
    expect(codeOf(other)).toBe('CONFLICT');
    expect((await balanceOf(batchId, at.branchId))!.available).toBe(90);
    const parallel = await Promise.all([1, 2, 3, 4].map(() => act(owner, stockActions.adjust, { ...input, clientKey: 'idem-key-2' })));
    expect(new Set(parallel.map((r) => dataOf(r).id)).size).toBe(1);
    expect((await balanceOf(batchId, at.branchId))!.available).toBe(80);
  });

  it('refuses a batch of another business', async () => {
    const { owner, at } = await world();
    const b = await pharmacy('B');
    const bp = await makeProduct(b.id);
    const bBatch = await makeBatch(b.id, b.branchId, bp.id, { buckets: { available: 5 } });
    const r = await act(owner, stockActions.adjust, { ...at, batchId: bBatch, direction: 'out', bucketFrom: 'available', baseQty: 1, reason: 'Not mine', clientKey: key() });
    expect(codeOf(r)).toBe('NOT_FOUND');
    expect((await balanceOf(bBatch, b.branchId))!.available).toBe(5);
  });

  it('refuses to put stock into available of an expired batch, but lets it be written off', async () => {
    const { owner, at, batchId } = await world({ expiry: '2026-10-01', buckets: { available: 10, quarantine: 5 } });
    const r = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'move', bucketFrom: 'quarantine', bucketTo: 'available', baseQty: 5, reason: 'Back to sale', clientKey: key() });
    expect(phCodeOf(r)).toBe('EXPIRED');
    const out = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 10, reason: 'Destroyed', clientKey: key() });
    expect(codeOf(out)).toBe('OK');
  });
});

describe('fix round: in, reverse guard, replay, branches', () => {
  it('in may target quarantine or damaged (found expired stock), available stays guarded', async () => {
    const { owner, at, batchId } = await world({ expiry: '2026-10-01', buckets: { available: 1 } });
    dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', bucketTo: 'quarantine', baseQty: 4, reason: 'Found expired', clientKey: key() }));
    dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', bucketTo: 'damaged', baseQty: 2, reason: 'Found broken', clientKey: key() }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 1, reserved: 0, quarantine: 4, damaged: 2 });
    const r = await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', bucketTo: 'available', baseQty: 1, reason: 'Found expired', clientKey: key() });
    expect(phCodeOf(r)).toBe('EXPIRED');
    expect(phCodeOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', baseQty: 1, reason: 'Found expired', clientKey: key() }))).toBe('EXPIRED');
  });

  it('reversing a DAMAGE of an expired batch (it would add to available) is refused', async () => {
    const { owner, at, batchId } = await world({ expiry: '2026-10-01', buckets: { available: 10 } });
    const dmg = dataOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'available', baseQty: 5, reason: 'Dropped' }));
    const r = await act(owner, stockActions.reverse, { ...at, movementId: dmg.id, reason: 'Not damaged after all' });
    expect(phCodeOf(r)).toBe('EXPIRED');
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ available: 5, damaged: 5 });
  });

  it('a replay after the movement was reversed says reversed: true', async () => {
    const { owner, at, batchId } = await world();
    const input = { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 3, reason: 'Broken box', clientKey: 'idem-rev-2' };
    const first = dataOf(await act(owner, stockActions.adjust, input));
    expect(first.reversed).toBe(false);
    expect(dataOf(await act(owner, stockActions.adjust, input))).toMatchObject({ replayed: true, reversed: false });
    dataOf(await act(owner, stockActions.reverse, { ...at, movementId: first.id, reason: 'Undo it' }));
    expect(dataOf(await act(owner, stockActions.adjust, input))).toMatchObject({ id: first.id, replayed: true, reversed: true });
  });

  it('the same clientKey in two different branches succeeds in both', async () => {
    const { a, owner, batchId, at } = await world();
    const other = a.branchIds[1]!;
    await stockInto(a.id, other, batchId, { available: 20 });
    const base = { restaurantId: a.id, batchId, direction: 'out', bucketFrom: 'available', baseQty: 2, reason: 'Same key', clientKey: 'shared-key-1' };
    const one = dataOf(await act(owner, stockActions.adjust, { ...base, branchId: at.branchId }));
    const two = dataOf(await act(owner, stockActions.adjust, { ...base, branchId: other }));
    expect(two.id).not.toBe(one.id);
    expect(two.replayed).toBe(false);
  });
});

describe('ph.stock.damage', () => {
  it('moves available to damaged as a DAMAGE movement', async () => {
    const { owner, at, batchId } = await world();
    const done = dataOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'available', baseQty: 7, reason: 'Dropped box' }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 93, reserved: 0, quarantine: 0, damaged: 7 });
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ type: 'DAMAGE', availableDelta: -7, damagedDelta: 7 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.stock.damage', entityId: done.id } })).toBe(1);
  });

  it('moves quarantine to damaged; refuses reserved as the source and an empty reason', async () => {
    const { owner, at, batchId } = await world({ buckets: { available: 10, quarantine: 4, reserved: 3 } });
    dataOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'quarantine', baseQty: 4, reason: 'Leaked' }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 10, reserved: 3, quarantine: 0, damaged: 4 });
    expect(codeOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'reserved', baseQty: 1, reason: 'Nope' }))).toBe('INVALID');
    expect(codeOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'available', baseQty: 1, reason: '' }))).toBe('INVALID');
    expect(phCodeOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'quarantine', baseQty: 1, reason: 'Empty now' }))).toBe('INSUFFICIENT_STOCK');
  });

  it('is idempotent by an optional clientKey', async () => {
    const { owner, at, batchId } = await world();
    const input = { ...at, batchId, fromBucket: 'available', baseQty: 2, reason: 'Dropped box', clientKey: 'damage-key-1' };
    const first = dataOf(await act(owner, stockActions.damage, input));
    expect(dataOf(await act(owner, stockActions.damage, input)).id).toBe(first.id);
    expect((await balanceOf(batchId, at.branchId))!.damaged).toBe(2);
  });
});

describe('ph.stock.quarantineRelease', () => {
  it('RESTOCK moves quarantine to available (QUARANTINE_RELEASE)', async () => {
    const { owner, at, batchId } = await world({ buckets: { available: 10, quarantine: 6 } });
    const done = dataOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId, decision: 'RESTOCK', baseQty: 4, reason: 'Checked and fine' }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 14, reserved: 0, quarantine: 2, damaged: 0 });
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ type: 'QUARANTINE_RELEASE', quarantineDelta: -4, availableDelta: 4 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.stock.quarantine.release', entityId: done.id } })).toBe(1);
  });

  it('DAMAGE moves quarantine to damaged (DAMAGE)', async () => {
    const { owner, at, batchId } = await world({ buckets: { quarantine: 6 } });
    const done = dataOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId, decision: 'DAMAGE', baseQty: 6, reason: 'Failed inspection' }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 0, reserved: 0, quarantine: 0, damaged: 6 });
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ type: 'DAMAGE', quarantineDelta: -6, damagedDelta: 6 });
  });

  it('refuses RESTOCK of an expired batch (R2-5) and of a recalled one, but lets DAMAGE through', async () => {
    const { owner, at, batchId, p } = await world({ expiry: '2026-10-26', buckets: { quarantine: 6 } });
    const r = await act(owner, stockActions.quarantineRelease, { ...at, batchId, decision: 'RESTOCK', baseQty: 1, reason: 'Back to sale' });
    expect(phCodeOf(r)).toBe('EXPIRED');
    expect(await balanceOf(batchId, at.branchId)).toMatchObject({ quarantine: 6, available: 0 });
    expect(codeOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId, decision: 'DAMAGE', baseQty: 1, reason: 'Destroy it' }))).toBe('OK');
    const recalled = await makeBatch(at.restaurantId, at.branchId, p.id, { lot: 'R1', status: 'RECALLED', buckets: { quarantine: 2 } });
    expect(phCodeOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId: recalled, decision: 'RESTOCK', baseQty: 1, reason: 'Back to sale' }))).toBe('BATCH_NOT_ACTIVE');
  });

  it('refuses an unknown decision', async () => {
    const { owner, at, batchId } = await world({ buckets: { quarantine: 6 } });
    expect(codeOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId, decision: 'KEEP', baseQty: 1, reason: 'What?' }))).toBe('INVALID');
  });
});

describe('ph.stock.reverse', () => {
  it('reverses an ADJUST, a DAMAGE and a release; once only', async () => {
    const { owner, at, batchId } = await world({ buckets: { available: 50, quarantine: 5 } });
    const adj = dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 10, reason: 'Counted wrong', clientKey: key() }));
    const rev = dataOf(await act(owner, stockActions.reverse, { ...at, movementId: adj.id, reason: 'It was my mistake' }));
    expect((await balanceOf(batchId, at.branchId))!.available).toBe(50);
    expect(await prisma().phStockMovement.findUniqueOrThrow({ where: { id: rev.id } })).toMatchObject({ reversesId: adj.id, type: 'ADJUST', availableDelta: 10 });
    expect(await prisma().auditLog.count({ where: { action: 'ph.stock.reverse', entityId: rev.id } })).toBe(1);
    expect(phCodeOf(await act(owner, stockActions.reverse, { ...at, movementId: adj.id, reason: 'Again please' }))).toBe('ALREADY_REVERSED');
    expect(phCodeOf(await act(owner, stockActions.reverse, { ...at, movementId: rev.id, reason: 'Undo the undo' }))).toBe('REVERSAL_OF_REVERSAL');

    const dmg = dataOf(await act(owner, stockActions.damage, { ...at, batchId, fromBucket: 'available', baseQty: 5, reason: 'Dropped' }));
    dataOf(await act(owner, stockActions.reverse, { ...at, movementId: dmg.id, reason: 'Not damaged after all' }));
    const rel = dataOf(await act(owner, stockActions.quarantineRelease, { ...at, batchId, decision: 'RESTOCK', baseQty: 5, reason: 'Fine' }));
    dataOf(await act(owner, stockActions.reverse, { ...at, movementId: rel.id, reason: 'Release was wrong' }));
    expect(await balanceOf(batchId, at.branchId)).toEqual({ available: 50, reserved: 0, quarantine: 5, damaged: 0 });
  });

  it('the same clientKey can be used again after its movement was reversed (a reversal copies the key)', async () => {
    const { owner, at, batchId } = await world();
    const input = { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 10, reason: 'Broken box', clientKey: 'idem-rev-1' };
    const first = dataOf(await act(owner, stockActions.adjust, input));
    dataOf(await act(owner, stockActions.reverse, { ...at, movementId: first.id, reason: 'Undo it' }));
    const replay = dataOf(await act(owner, stockActions.adjust, input));
    expect(replay.id).toBe(first.id);
    expect(replay.replayed).toBe(true);
  });

  it('needs a reason; reversal fails when the stock is gone', async () => {
    const { owner, at, batchId } = await world({ buckets: { available: 10 } });
    const adj = dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'in', baseQty: 5, reason: 'Found', clientKey: key() }));
    expect(codeOf(await act(owner, stockActions.reverse, { ...at, movementId: adj.id, reason: '' }))).toBe('INVALID');
    dataOf(await act(owner, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 15, reason: 'All gone', clientKey: key() }));
    expect(phCodeOf(await act(owner, stockActions.reverse, { ...at, movementId: adj.id, reason: 'Not found after all' }))).toBe('INSUFFICIENT_STOCK');
  });

  it('refuses a SALE, a COUNT, and every other type with REVERSE_NOT_ALLOWED', async () => {
    const { a, owner, at, batchId, p } = await world({ buckets: { available: 10 } });
    for (const type of ['SALE', 'COUNT', 'RETURN_IN', 'TRANSFER_OUT', 'SUPPLIER_RETURN'] as const) {
      const row = await prisma().phStockMovement.create({
        data: { restaurantId: a.id, branchId: at.branchId, productId: p.id, batchId, type, availableDelta: type === 'SALE' ? -1 : 1, reason: 'x', userId: 'u' },
      });
      const r = await act(owner, stockActions.reverse, { ...at, movementId: row.id, reason: 'Try to undo' });
      expect(codeOf(r), type).toBe('CONFLICT');
      expect(phCodeOf(r), type).toBe('REVERSE_NOT_ALLOWED');
    }
  });

  it('reverses a receipt movement', async () => {
    const { a, owner, at } = await world();
    const p = await makeProduct(a.id, 'Brufen');
    const made = dataOf(
      await act(owner, receiptActions.create, {
        ...at,
        clientKey: 'receipt-key-1',
        receivedOn: '2026-10-27',
        lines: [{ productId: p.id, unitId: p.strip, qty: 5, lot: 'N1', expiry: '2028-03-15', unitCostMinor: 2500n, currency: 'IQD' }],
      }),
    );
    dataOf(await act(owner, receiptActions.confirm, { ...at, receiptId: made.id }));
    const movement = await prisma().phStockMovement.findFirstOrThrow({ where: { receiptId: made.id, type: 'RECEIPT' } });
    expect(codeOf(await act(owner, stockActions.reverse, { ...at, movementId: movement.id, reason: '' }))).toBe('INVALID');
    dataOf(await act(owner, stockActions.reverse, { ...at, movementId: movement.id, reason: 'Wrong delivery' }));
    expect((await balanceOf(movement.batchId, at.branchId))!.available).toBe(0);
  });

  it('refuses a movement of another business', async () => {
    const { owner, at } = await world();
    const b = await pharmacy('B');
    const bp = await makeProduct(b.id);
    const bBatch = await makeBatch(b.id, b.branchId, bp.id, { buckets: { available: 5 } });
    const bm = await prisma().phStockMovement.findFirstOrThrow({ where: { batchId: bBatch, type: 'RECEIPT' } });
    expect(codeOf(await act(owner, stockActions.reverse, { ...at, movementId: bm.id, reason: 'Not mine' }))).toBe('NOT_FOUND');
  });
});

describe('who may adjust', () => {
  it('matrix: only the holders of stock.adjust (OWNER, BRANCH_MANAGER, PHARMACIST_IN_CHARGE)', async () => {
    const { a, at, batchId } = await world();
    const allowed = ['BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE'] as const;
    const denied = ['PHARMACIST', 'CASHIER', 'STOCK', 'ACCOUNTANT'] as const;
    for (const role of allowed) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [a.branchId]] });
      const r = await act(who, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 1, reason: 'Allowed role', clientKey: key() });
      expect(codeOf(r), role).toBe('OK');
    }
    for (const role of denied) {
      const who = await person(role.toLowerCase(), { staff: [a.id, role, [a.branchId]] });
      const before = (await movements()).length;
      const results = [
        await act(who, stockActions.adjust, { ...at, batchId, direction: 'out', bucketFrom: 'available', baseQty: 1, reason: 'Denied role', clientKey: key() }),
        await act(who, stockActions.damage, { ...at, batchId, fromBucket: 'available', baseQty: 1, reason: 'Denied role' }),
        await act(who, stockActions.quarantineRelease, { ...at, batchId, decision: 'DAMAGE', baseQty: 1, reason: 'Denied role' }),
        await act(who, stockActions.reverse, { ...at, movementId: (await movements())[0]!.id, reason: 'Denied role' }),
      ];
      for (const result of results) expect(codeOf(result), role).toBe('FORBIDDEN');
      expect((await movements()).length, role).toBe(before);
    }
  });

  it('a branch-limited actor acts only in their own branches', async () => {
    const { a, at, batchId, p } = await world();
    const manager = await person('mgr', { staff: [a.id, 'BRANCH_MANAGER', [a.branchId]] });
    const otherBranch = a.branchIds[1]!;
    const otherBatch = await makeBatch(a.id, otherBranch, p.id, { lot: 'O1', buckets: { available: 20 } });
    const r = await act(manager, stockActions.adjust, { restaurantId: a.id, branchId: otherBranch, batchId: otherBatch, direction: 'out', bucketFrom: 'available', baseQty: 1, reason: 'Wrong branch', clientKey: key() });
    expect(codeOf(r)).toBe('FORBIDDEN');
    expect((await balanceOf(otherBatch, otherBranch))!.available).toBe(20);
    // A movement of the other branch cannot be reversed from here either, even with the own branch in the place.
    const theirs = await prisma().phStockMovement.findFirstOrThrow({ where: { batchId: otherBatch } });
    expect(codeOf(await act(manager, stockActions.reverse, { ...at, movementId: theirs.id, reason: 'Not mine' }))).toBe('NOT_FOUND');
    expect(codeOf(await act(manager, stockActions.adjust, { ...at, batchId, direction: 'in', baseQty: 1, reason: 'Own branch', clientKey: key() }))).toBe('OK');
  });
});
