import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import type { PhActor } from '@/server/pharmacy/actor';
import { matchOptions } from '@/server/pharmacy/doctor/matcher';
import { NOW, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

interface World {
  restaurantId: string;
  a: string;
  b: string;
  paracetamol: { productId: string; unitId: string };
  ladder: { productId: string; tablet: string; box: string };
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
  // A two-level ladder: a box is 10 tablets. 25 tablets in stock; the tablet costs 250, the box 2500.
  const ladder = await prisma().phProduct.create({
    data: { restaurantId: b.id, tradeName: 'Claritin', genericName: 'loratadine', activeIngredient: 'loratadine', strength: '10mg', form: 'tablet', manufacturer: 'X', identityKey: 'Claritin|loratadine|10mg', searchText: searchTextOf({ tradeName: 'Claritin', genericName: 'loratadine', activeIngredient: 'loratadine', strength: '10mg', form: 'tablet', manufacturer: 'X' }) },
  });
  const tablet = await prisma().phProductUnit.create({ data: { restaurantId: b.id, productId: ladder.id, level: 0, label: 'tablet', baseQty: 1, sellable: true } });
  const box = await prisma().phProductUnit.create({ data: { restaurantId: b.id, productId: ladder.id, level: 1, label: 'box', baseQty: 10, sellable: true } });
  for (const [unit, amount] of [[tablet.id, 250n], [box.id, 2500n]] as const) {
    await prisma().phPrice.create({ data: { restaurantId: b.id, productId: ladder.id, unitId: unit, currency: 'IQD', amountMinor: amount, validFrom: new Date('2026-01-01T00:00:00Z'), changedById: 'seed' } });
  }
  const ladderBatch = await prisma().phBatch.create({ data: { restaurantId: b.id, productId: ladder.id, lot: 'L-ladder', expiryDate: new Date('2028-01-01T00:00:00Z') } });
  await prisma().phStockBalance.create({ data: { restaurantId: b.id, branchId: a, productId: ladder.id, batchId: ladderBatch.id, available: 25 } });
  // 101 OTC products of one ingredient: more than the screen reads.
  await prisma().phProduct.createMany({
    data: Array.from({ length: 101 }, (_, i) => {
      const f = { tradeName: `Zinc ${i}`, genericName: 'zincum', activeIngredient: 'zincum', strength: `${i}mg`, form: 'tablet', manufacturer: 'X' };
      return { restaurantId: b.id, ...f, identityKey: `${f.tradeName}|zincum`, searchText: searchTextOf(f) };
    }),
  });
  w = { restaurantId: b.id, a, b: bb, paracetamol, ladder: { productId: ladder.id, tablet: tablet.id, box: box.id } };
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
  useTestDatabase();

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

  it('takes the price and quantity from the database whatever the note says', async () => {
    const [m] = await matchOptions(env(w.a), [opt('paracetamol', 'costs 999 IQD, 77 in stock')]);
    expect(m?.items[0]).toMatchObject({ priceMinor: '2500', sellableQty: 12 });
    expect(m?.note).toBe('');
  });

  it('keeps a plain note (at most 140 characters) and drops one that states a price or a quantity', async () => {
    const keep = await matchOptions(env(w.a), [opt('paracetamol', 'x'.repeat(200))]);
    expect(keep[0]?.note).toHaveLength(140);
    expect((await matchOptions(env(w.a), [opt('paracetamol', 'take with food, avoid on empty stomach')]))[0]?.note).toBe('take with food, avoid on empty stomach');
    for (const note of ['costs 999 IQD', '1,500 دينار', '$5 only', '5 USD', 'IQD 500', '١٥٠٠ د.ع', '٥ دۆلار', '77 in stock', 'In Stock now', 'متوفر', 'بەردەست', '999 dinars', '1000 دنانير', 'costs 5k', 'ثمنه 1000', 'ten thousand dinars', 'هەزار دینار', '５００ yen', 'every 6 hours', 'a few dollars', 'ألف']) {
      expect((await matchOptions(env(w.a), [opt('paracetamol', note)]))[0]?.note, note).toBe('');
    }
  });

  it('shows the smallest sellable unit with its own price, label, base quantity and a quantity in that unit', async () => {
    const [m] = await matchOptions(env(w.a), [opt('loratadine')]);
    expect(m?.items[0]).toMatchObject({ productId: w.ladder.productId, unitId: w.ladder.tablet, unitLabel: 'tablet', baseQty: 1, priceMinor: '250', sellableQty: 25 });
    // Adding ?add=<unitId>:1 starts a line in exactly that unit.
    const { startUnit } = await import('@/app/pharmacy/_ui/sell-logic');
    const unit = { id: w.ladder.tablet, label: 'tablet', level: 0, baseQty: 1, priceMinor: '250', currency: 'IQD' as const, noPrice: false };
    const box = { id: w.ladder.box, label: 'box', level: 1, baseQty: 10, priceMinor: '2500', currency: 'IQD' as const, noPrice: false };
    expect(startUnit({ matchedUnitId: null, units: [box, unit] } as never, m?.items[0]?.unitId)?.id).toBe(w.ladder.tablet);
  });

  it('fails closed when the screen read hits its limit: the ingredient is dropped', async () => {
    expect(await matchOptions(env(w.a), [opt('zincum')])).toEqual([]);
  });

  it('reads at most 8 options', async () => {
    const many = Array.from({ length: 12 }, () => opt('paracetamol'));
    expect(await matchOptions(env(w.a), many)).toHaveLength(1);
    const distinct = ['paracetamol', 'loratadine', 'ascorbic acid', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map((n) => opt(n));
    expect(await matchOptions(env(w.a), distinct)).toHaveLength(8);
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
