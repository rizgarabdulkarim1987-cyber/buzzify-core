import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scopedClient, type ScopedTx } from '@/server/data/tenant-db';
import { lockOrder, applyMovement, reverseMovement, type MovementInput } from '@/server/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
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

const EXPIRY = new Date('2027-03-31T00:00:00.000Z');

async function stocked(name = 'A') {
  const biz = await pharmacy(name);
  const product = await prisma().phProduct.create({
    data: {
      restaurantId: biz.id,
      tradeName: 'Panadol',
      identityKey: `paracetamol|500mg|tablet|${name}`,
      searchText: searchTextOf({ tradeName: 'Panadol', genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }),
    },
    select: { id: true },
  });
  const batch = await prisma().phBatch.create({
    data: { restaurantId: biz.id, productId: product.id, lot: 'L1', expiryDate: EXPIRY },
    select: { id: true },
  });
  const scoped = scopedClient(prisma(), { restaurantId: biz.id, allBranches: true });
  const input = (over: Partial<MovementInput> = {}): MovementInput => ({
    restaurantId: biz.id,
    branchId: biz.branchId,
    batchId: batch.id,
    type: 'RECEIPT',
    deltas: { available: 5 },
    reason: '',
    userId: 'actor-1',
    ...over,
  });
  const run = <T>(work: (tx: ScopedTx) => Promise<T>) => scoped.$transaction(work);
  const bal = () => prisma().phStockBalance.findFirst({ where: { batchId: batch.id, branchId: biz.branchId } });
  return { biz, productId: product.id, batchId: batch.id, scoped, input, run, bal };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as StudioError;
  }
  throw new Error('expected a refusal');
};

describe('applyMovement', () => {
  it('creates the balance on first use and writes a movement with the batch product', async () => {
    const s = await stocked();
    const m = await s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 7 } })));
    expect(await s.bal()).toMatchObject({ available: 7, reserved: 0, quarantine: 0, damaged: 0, productId: s.productId });
    const row = await prisma().phStockMovement.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ availableDelta: 7, productId: s.productId, type: 'RECEIPT', userId: 'actor-1' });
  });

  it('decrements, and moves between buckets', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    await s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -2 } })));
    await s.run((tx) => applyMovement(tx, s.input({ type: 'DAMAGE', deltas: { available: -1, damaged: 1 }, reason: 'dropped' })));
    expect(await s.bal()).toMatchObject({ available: 2, damaged: 1 });
  });

  it('refuses an insufficient decrement naming the bucket, and writes nothing', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    const before = await prisma().phStockMovement.count();
    const error = await refusal(s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -6 } }))));
    expect(error).toBeInstanceOf(StudioError);
    expect(error.code).toBe('CONFLICT');
    expect(error.fields).toMatchObject({ phCode: 'INSUFFICIENT_STOCK', bucket: 'available', have: '5' });
    expect(await prisma().phStockMovement.count()).toBe(before);
    expect(await s.bal()).toMatchObject({ available: 5 });
  });

  it('applies no bucket of a movement when a later bucket is short', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    await refusal(s.run((tx) => applyMovement(tx, s.input({ type: 'ADJUST', deltas: { available: 1, damaged: -1 }, reason: 'x' }))));
    expect(await s.bal()).toMatchObject({ available: 5, damaged: 0 });
  });

  it('refuses a decrement on a balance that does not exist yet', async () => {
    const s = await stocked();
    const error = await refusal(s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -1 } }))));
    expect(error.fields).toMatchObject({ phCode: 'INSUFFICIENT_STOCK' });
    expect(await prisma().phStockMovement.count()).toBe(0);
  });

  it('under 20 parallel decrements of 1 on a balance of 5, exactly 5 succeed and the rest are refused', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -1 } })))),
    );
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(failed).toHaveLength(15);
    for (const f of failed) expect((f.reason as StudioError).fields?.phCode).toBe('INSUFFICIENT_STOCK');
    expect(await s.bal()).toMatchObject({ available: 0 });
    expect(await prisma().phStockMovement.count({ where: { type: 'SALE' } })).toBe(5);
  });

  it('two parallel first-use creations of the same balance both succeed', async () => {
    const s = await stocked();
    const results = await Promise.allSettled([
      s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 3 } }))),
      s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 4 } }))),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await prisma().phStockBalance.count({ where: { batchId: s.batchId } })).toBe(1);
    expect(await s.bal()).toMatchObject({ available: 7 });
  });

  it('refuses a batch of another business and a branch of another business', async () => {
    const a = await stocked('A');
    const b = await stocked('B');
    const batchError = await refusal(a.run((tx) => applyMovement(tx, a.input({ batchId: b.batchId }))));
    expect(batchError.code).toBe('NOT_FOUND');
    const branchError = await refusal(a.run((tx) => applyMovement(tx, a.input({ branchId: b.biz.branchId }))));
    expect(branchError.code).toBe('NOT_FOUND');
    expect(await prisma().phStockMovement.count()).toBe(0);
    expect(await prisma().phStockBalance.count()).toBe(0);
  });

  it('refuses a movement that changes nothing', async () => {
    const s = await stocked();
    const error = await refusal(s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 0 } }))));
    expect(error.code).toBe('INVALID');
    expect((await refusal(s.run((tx) => applyMovement(tx, s.input({ deltas: {} }))))).code).toBe('INVALID');
  });

  it('refuses a fractional delta', async () => {
    const s = await stocked();
    expect((await refusal(s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 1.5 } }))))).code).toBe('INVALID');
  });

  it.each(['ADJUST', 'DAMAGE', 'COUNT', 'SUPPLIER_RETURN', 'QUARANTINE_RELEASE'] as const)('requires a reason for %s', async (type) => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 9 } })));
    const error = await refusal(s.run((tx) => applyMovement(tx, s.input({ type, deltas: { available: -1 }, reason: '   ' }))));
    expect(error.code).toBe('INVALID');
    expect(error.fields).toHaveProperty('reason');
    await s.run((tx) => applyMovement(tx, s.input({ type, deltas: { available: -1 }, reason: 'because' })));
  });

  it('does not require a reason for a sale', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    await s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -1 } })));
  });

  it('undoes the balance when the movement insert fails after the balance update', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    await expect(s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -2 }, receiptId: 'no-such-receipt' })))).rejects.toThrow();
    expect(await s.bal()).toMatchObject({ available: 5 });
    expect(await prisma().phStockMovement.count()).toBe(1);
  });

  it('ignores a smuggled reversesId and cannot lift the receipt rule with it', async () => {
    const s = await stocked();
    const first = await s.run((tx) => applyMovement(tx, s.input()));
    const smuggled = { ...s.input({ type: 'RECEIPT', deltas: { available: -1 } }), reversesId: first.id } as MovementInput;
    expect((await refusal(s.run((tx) => applyMovement(tx, smuggled)))).code).toBe('INVALID');
    const ok = { ...s.input({ type: 'ADJUST', deltas: { available: 1 }, reason: 'x' }), reversesId: first.id } as MovementInput;
    const m = await s.run((tx) => applyMovement(tx, ok));
    expect((await prisma().phStockMovement.findUniqueOrThrow({ where: { id: m.id } })).reversesId).toBeNull();
  });

  it.each([
    ['SALE', { available: 1 }],
    ['DAMAGE', { available: 1 }],
    ['SUPPLIER_RETURN', { available: 1 }],
    ['TRANSFER_OUT', { available: 1 }],
    ['RECEIPT', { available: -1 }],
    ['RETURN_IN', { available: -1 }],
    ['TRANSFER_IN', { available: -1 }],
    ['RECEIPT', { available: 1, damaged: 1 }],
  ] as const)('refuses a %s with deltas that contradict its type', async (type, deltas) => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 5 } })));
    expect((await refusal(s.run((tx) => applyMovement(tx, s.input({ type, deltas, reason: 'r' }))))).code).toBe('INVALID');
  });

  it('refuses a delta beyond the 32-bit range', async () => {
    const s = await stocked();
    expect((await refusal(s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 2147483648 } }))))).code).toBe('INVALID');
    expect((await refusal(s.run((tx) => applyMovement(tx, s.input({ type: 'ADJUST', reason: 'r', deltas: { available: -2147483648 } }))))).code).toBe('INVALID');
  });

  it('refuses a branch outside a branch-limited client with a StudioError', async () => {
    const biz = await pharmacy('C', { branches: 2 });
    const product = await prisma().phProduct.create({
      data: { restaurantId: biz.id, tradeName: 'P', identityKey: 'c|1', searchText: 'p' },
      select: { id: true },
    });
    const batch = await prisma().phBatch.create({ data: { restaurantId: biz.id, productId: product.id, lot: 'L', expiryDate: EXPIRY }, select: { id: true } });
    const limited = scopedClient(prisma(), { restaurantId: biz.id, branchIds: [biz.branchIds[0]!] });
    const base: MovementInput = { restaurantId: biz.id, branchId: biz.branchIds[1]!, batchId: batch.id, type: 'RECEIPT', deltas: { available: 1 }, reason: '', userId: 'u' };
    const error = await refusal(limited.$transaction((tx) => applyMovement(tx, base)));
    expect(error).toBeInstanceOf(StudioError);
    expect(error.code).toBe('FORBIDDEN');
    await limited.$transaction((tx) => applyMovement(tx, { ...base, branchId: biz.branchIds[0]! }));
  });

  it('lockOrder sorts by batch id without changing its input', () => {
    const rows = [{ batchId: 'b' }, { batchId: 'a' }, { batchId: 'c' }];
    expect(lockOrder(rows).map((r) => r.batchId)).toEqual(['a', 'b', 'c']);
    expect(rows[0]!.batchId).toBe('b');
  });
});

describe('reverseMovement', () => {
  it('restores the balances with a new movement that names the original', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input()));
    const sale = await s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -3 } })));
    const rev = await s.run((tx) => reverseMovement(tx, sale.id, { userId: 'actor-2', reason: 'mistake' }));
    expect(await s.bal()).toMatchObject({ available: 5 });
    const row = await prisma().phStockMovement.findUniqueOrThrow({ where: { id: rev.id } });
    expect(row).toMatchObject({ reversesId: sale.id, availableDelta: 3, type: 'SALE', batchId: s.batchId, userId: 'actor-2', reason: 'mistake' });
  });

  it('reverses a receipt while the stock is still there', async () => {
    const s = await stocked();
    const receipt = await s.run((tx) => applyMovement(tx, s.input()));
    await s.run((tx) => reverseMovement(tx, receipt.id, { userId: 'u', reason: 'wrong receipt' }));
    expect(await s.bal()).toMatchObject({ available: 0 });
  });

  it('refuses a second reversal', async () => {
    const s = await stocked();
    const first = await s.run((tx) => applyMovement(tx, s.input()));
    await s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 5 } })));
    await s.run((tx) => reverseMovement(tx, first.id, { userId: 'u', reason: 'r' }));
    const error = await refusal(s.run((tx) => reverseMovement(tx, first.id, { userId: 'u', reason: 'r' })));
    expect(error.code).toBe('CONFLICT');
    expect(error.fields).toMatchObject({ phCode: 'ALREADY_REVERSED' });
  });

  it('allows only one of two parallel reversals', async () => {
    const s = await stocked();
    const m = await s.run((tx) => applyMovement(tx, s.input()));
    const results = await Promise.allSettled([
      s.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: 'r' })),
      s.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: 'r' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect((failure.reason as StudioError).fields?.phCode).toBe('ALREADY_REVERSED');
    expect(await s.bal()).toMatchObject({ available: 0 });
  });

  it('with enough stock, of two parallel reversals one wins and the other is ALREADY_REVERSED', async () => {
    const s = await stocked();
    await s.run((tx) => applyMovement(tx, s.input({ deltas: { available: 10 } })));
    const m = await s.run((tx) => applyMovement(tx, s.input()));
    const results = await Promise.allSettled([
      s.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: 'r' })),
      s.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: 'r' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect((failure.reason as StudioError).fields?.phCode).toBe('ALREADY_REVERSED');
    expect(await s.bal()).toMatchObject({ available: 10 });
  });

  it('refuses reversing a reversal', async () => {
    const s = await stocked();
    const m = await s.run((tx) => applyMovement(tx, s.input()));
    const rev = await s.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: 'r' }));
    const error = await refusal(s.run((tx) => reverseMovement(tx, rev.id, { userId: 'u', reason: 'r' })));
    expect(error.code).toBe('CONFLICT');
    expect(error.fields).toMatchObject({ phCode: 'REVERSAL_OF_REVERSAL' });
  });

  it('fails when the stock was already sold', async () => {
    const s = await stocked();
    const receipt = await s.run((tx) => applyMovement(tx, s.input()));
    await s.run((tx) => applyMovement(tx, s.input({ type: 'SALE', deltas: { available: -4 } })));
    const error = await refusal(s.run((tx) => reverseMovement(tx, receipt.id, { userId: 'u', reason: 'r' })));
    expect(error.fields).toMatchObject({ phCode: 'INSUFFICIENT_STOCK', bucket: 'available', have: '1' });
    expect(await s.bal()).toMatchObject({ available: 1 });
    expect(await prisma().phStockMovement.count({ where: { reversesId: receipt.id } })).toBe(0);
  });

  it('requires a reason, and refuses a movement of another business', async () => {
    const a = await stocked('A');
    const b = await stocked('B');
    const m = await a.run((tx) => applyMovement(tx, a.input()));
    expect((await refusal(a.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: ' ' })))).code).toBe('INVALID');
    expect((await refusal(b.run((tx) => reverseMovement(tx, m.id, { userId: 'u', reason: 'r' })))).code).toBe('NOT_FOUND');
  });
});
