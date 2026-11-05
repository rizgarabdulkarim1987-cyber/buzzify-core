import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import type { PhActor } from '@/server/pharmacy/actor';
import { matchOptions } from '@/server/pharmacy/doctor/matcher';
import { NOW, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

useTestDatabase();

interface World {
  restaurantId: string;
  a: string;
  b: string;
  paracetamol: { productId: string; unitId: string };
}

async function product(
  restaurantId: string,
  spec: { tradeName: string; genericName: string; rxLevel?: 'OTC' | 'RX' | 'RESTRICTED'; priced?: boolean; stock?: Array<[string, number]>; strength?: string },
) {
  const fields = { tradeName: spec.tradeName, genericName: spec.genericName, activeIngredient: spec.genericName, strength: spec.strength ?? '500mg', form: 'tablet', manufacturer: 'X' };
  const p = await prisma().phProduct.create({
    data: { restaurantId, ...fields, rxLevel: spec.rxLevel ?? 'OTC', identityKey: `${spec.tradeName}|${spec.genericName}|${fields.strength}`, searchText: searchTextOf(fields) },
  });
  const unit = await prisma().phProductUnit.create({ data: { restaurantId, productId: p.id, level: 0, label: 'box', baseQty: 1, sellable: true } });
  if (spec.priced !== false) {
    await prisma().phPrice.create({
      data: { restaurantId, productId: p.id, unitId: unit.id, currency: 'IQD', amountMinor: 2500n, validFrom: new Date('2026-01-01T00:00:00Z'), changedById: 'seed' },
    });
  }
  for (const [branchId, qty] of spec.stock ?? []) {
    const batch = await prisma().phBatch.create({ data: { restaurantId, productId: p.id, lot: `L-${spec.tradeName}`, expiryDate: new Date('2028-01-01T00:00:00Z') } });
    await prisma().phStockBalance.create({ data: { restaurantId, branchId, productId: p.id, batchId: batch.id, available: qty } });
  }
  return { productId: p.id, unitId: unit.id };
}

let w: World;
beforeAll(async () => {
  await resetWorld();
  const b = await pharmacy('Matcher', { branches: 2 });
  const [a, bb] = b.branchIds as [string, string];
  await prisma().phSettings.create({ data: { restaurantId: b.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' } });
  const paracetamol = await product(b.id, { tradeName: 'Panadol', genericName: 'paracetamol', stock: [[a, 12]] });
  await product(b.id, { tradeName: 'Amoxil', genericName: 'amoxicillin', rxLevel: 'RX', stock: [[a, 5]] });
  await product(b.id, { tradeName: 'Codeine Linctus', genericName: 'codeine', rxLevel: 'RESTRICTED', stock: [[a, 5]] });
  // An OTC ibuprofen is in stock, but another ibuprofen product is RX: the whole ingredient is dropped.
  await product(b.id, { tradeName: 'Brufen', genericName: 'ibuprofen', stock: [[a, 5]] });
  await product(b.id, { tradeName: 'Ibuprofen 800', genericName: 'ibuprofen', rxLevel: 'RX', strength: '800mg' });
  await product(b.id, { tradeName: 'Cetrizine Plain', genericName: 'cetirizine', priced: false, stock: [[a, 5]] });
  for (const n of ['One', 'Two', 'Three', 'Four']) await product(b.id, { tradeName: `Vit C ${n}`, genericName: 'ascorbic acid', stock: [[a, 3]], strength: `${n}mg` });
  w = { restaurantId: b.id, a, b: bb, paracetamol };
});
afterAll(resetWorld);

const actorFor = (branchIds: string[], over: Partial<PhActor> = {}): PhActor => ({
  userId: 'u',
  name: 'U',
  restaurantId: w.restaurantId,
  restaurantName: 'Matcher',
  role: 'PHARMACIST',
  allBranches: false,
  branchIds,
  viaMembership: false,
  aiDoctor: true,
  support: null,
  locale: 'en',
  ...over,
});
const env = (branchId: string, ph = actorFor([w.a, w.b])) => ({ scoped: scopedClient(prisma(), { restaurantId: w.restaurantId, branchIds: ph.branchIds }), ph, branchId, currency: 'IQD' as const, now: NOW });
const opt = (ingredient: string, note = 'one tablet') => ({ ingredient, tradeNames: [] as string[], note });

describe('matchOptions', () => {
  it('shows an in-stock OTC option with the price and quantity from the database', async () => {
    const [m] = await matchOptions(env(w.a), [opt('paracetamol')]);
    expect(m?.status).toBe('IN_STOCK');
    expect(m?.items).toHaveLength(1);
    expect(m?.items[0]).toMatchObject({ productId: w.paracetamol.productId, unitId: w.paracetamol.unitId, tradeName: 'Panadol', priceMinor: '2500', currency: 'IQD', sellableQty: 12 });
  });

  it('shows NOT_IN_STOCK with the name only at a branch with no stock', async () => {
    const [m] = await matchOptions(env(w.b), [opt('paracetamol')]);
    expect(m).toMatchObject({ ingredient: 'paracetamol', status: 'NOT_IN_STOCK', items: [] });
  });

  it('shows NOT_IN_STOCK when nothing in the catalog matches', async () => {
    const [m] = await matchOptions(env(w.a), [opt('guaifenesin')]);
    expect(m).toMatchObject({ status: 'NOT_IN_STOCK', items: [] });
  });

  it('drops an RX or RESTRICTED ingredient entirely', async () => {
    const out = await matchOptions(env(w.a), [opt('amoxicillin'), opt('codeine'), opt('paracetamol')]);
    expect(out.map((o) => o.ingredient)).toEqual(['paracetamol']);
  });

  it('drops an ingredient when any product of it is RX, even if an OTC one is in stock', async () => {
    expect(await matchOptions(env(w.a), [opt('ibuprofen')])).toEqual([]);
  });

  it('leaves out a product with no price', async () => {
    const [m] = await matchOptions(env(w.a), [opt('cetirizine')]);
    expect(m).toMatchObject({ status: 'NOT_IN_STOCK', items: [] });
  });

  it('shows at most 3 items per option', async () => {
    const [m] = await matchOptions(env(w.a), [opt('ascorbic acid')]);
    expect(m?.status).toBe('IN_STOCK');
    expect(m?.items).toHaveLength(3);
  });

  it('keeps the note as given and never takes a price or quantity from the model text', async () => {
    const [m] = await matchOptions(env(w.a), [opt('paracetamol', 'costs 999 IQD, 77 in stock')]);
    expect(m?.items[0]).toMatchObject({ priceMinor: '2500', sellableQty: 12 });
    expect(JSON.stringify(m?.items)).not.toMatch(/999|77/);
  });

  it('refuses a branch the actor may not use, and a support actor', async () => {
    await expect(matchOptions(env(w.a, actorFor([w.b])), [opt('paracetamol')])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const support = actorFor([w.a], { role: null, support: { grantId: 'g', scopes: new Set(), expiresAt: NOW } });
    await expect(matchOptions(env(w.a, support), [opt('paracetamol')])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs no open shift (none is open here)', async () => {
    const [m] = await matchOptions(env(w.a, actorFor([w.a], { role: 'PHARMACIST' })), [opt('paracetamol')]);
    expect(m?.status).toBe('IN_STOCK');
  });
});
