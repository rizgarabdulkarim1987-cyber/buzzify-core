import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { scopedClient } from '@/server/data/tenant-db';
import { priceAt } from '@/server/pharmacy/prices';
import * as priceActions from '@/server/pharmacy/actions/prices';
import * as productActions from '@/server/pharmacy/actions/products';
import * as priceQueries from '@/server/pharmacy/queries/prices';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { DAY, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase, type Person } from './fixture';

const META = { ip: '203.0.113.20', userAgent: 'vitest' };

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);
const phCodeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : (result.error.fields?.phCode ?? result.error.code));
const actorOf = async (who: Person): Promise<Actor> => (await loadActor(prisma(), who.userId)) as Actor;
const act = async <I, O>(who: Person, def: ActionDef<I, O>, input: unknown) => runAction(prisma(), await actorOf(who), def, input, META);
const ask = async <I, O>(who: Person, def: QueryDef<I, O>, input: unknown) => runQuery(prisma(), await actorOf(who), def, input);
const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected OK, got ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields)}`);
  return result.data;
};
const days = (n: number) => new Date(NOW.getTime() + n * DAY);

const LADDER = [
  { level: 0, label: 'tablet', baseQty: 1, sellable: true },
  { level: 1, label: 'box', baseQty: 20, sellable: true },
];

interface World {
  a: { id: string; branchId: string; branchIds: string[] };
  owner: Person;
}

/** A pharmacy (IQD only unless told otherwise) and its owner. */
async function world(opts: { branches?: number; currencies?: ('IQD' | 'USD')[] } = {}): Promise<World> {
  const a = await pharmacy('A', { branches: opts.branches ?? 1 });
  await prisma().phSettings.create({ data: { restaurantId: a.id, enabledCurrencies: opts.currencies ?? ['IQD'], defaultCurrency: 'IQD' } });
  const owner = await person('owner', { membership: [a.id, 'OWNER'] });
  return { a, owner };
}

/** A product of the business with its box unit (the unit priced in these tests). */
async function product(w: World, tradeName: string): Promise<{ productId: string; unitId: string }> {
  const created = dataOf(
    await act(w.owner, productActions.create, { restaurantId: w.a.id, tradeName, strength: '500 mg', form: 'tablet', manufacturer: 'GSK', levels: LADDER }),
  );
  const unit = await prisma().phProductUnit.findFirstOrThrow({ where: { productId: created.id, level: 1 } });
  return { productId: created.id, unitId: unit.id };
}

const setInput = (w: World, p: { productId: string; unitId: string }, amount: string, validFrom: Date, over: Record<string, unknown> = {}) => ({
  restaurantId: w.a.id,
  ...p,
  currency: 'IQD',
  amount,
  validFrom,
  reason: 'Supplier price list',
  ...over,
});

const openRows = () => prisma().phPrice.findMany({ where: { validTo: null }, orderBy: { productId: 'asc' } });
const scoped = (w: World) => scopedClient(prisma(), { restaurantId: w.a.id, allBranches: true });

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

describe('pharmacy prices', () => {
  it('setting a price closes the previous one at the new validFrom and keeps it in history', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    const first = dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1,000', days(-10))));
    const second = dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1250', days(-1), { reason: '  New list  ' })));

    const rows = await prisma().phPrice.findMany({ orderBy: { validFrom: 'asc' } });
    expect(rows.map((r) => [r.id, r.amountMinor, r.validFrom, r.validTo, r.restaurantId, r.branchId, r.changedById, r.reason])).toEqual([
      [first.id, 1000n, days(-10), days(-1), w.a.id, null, w.owner.userId, 'Supplier price list'],
      [second.id, 1250n, days(-1), null, w.a.id, null, w.owner.userId, 'New list'],
    ]);

    const history = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, productId: p.productId }));
    expect(history.items.map((h) => [h.id, h.amountMinor, h.validTo])).toEqual([
      [second.id, '1250', null],
      [first.id, '1000', days(-1).toISOString()],
    ]);

    // Audited in the same transaction, with ids, amounts and currency only (the reason text stays on the price row).
    expect(await prisma().auditLog.count({ where: { action: 'ph.price.set' } })).toBe(2);
    const audit = await prisma().auditLog.findFirstOrThrow({ where: { action: 'ph.price.set', entityId: second.id } });
    expect(audit).toMatchObject({ restaurantId: w.a.id, actorId: w.owner.userId, entityType: 'PhPrice' });
    expect(audit.changes).toEqual({
      productId: { before: null, after: p.productId },
      unitId: { before: null, after: p.unitId },
      branchId: { before: null, after: null },
      currency: { before: null, after: 'IQD' },
      amountMinor: { before: '1000', after: '1250' },
      validFrom: { before: days(-10).toISOString(), after: days(-1).toISOString() },
    });
  });

  it('priceAt returns the price that was valid at a past date', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-10))));
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1250', days(-1))));
    // A price set for the future is allowed: the current one closes at that instant.
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1500', days(5))));

    const at = (when: Date) => priceAt(scoped(w), { ...p, branchId: null, currency: 'IQD', at: when });
    expect(await at(days(-20))).toBeNull();
    expect(await at(days(-10))).toEqual({ amount: 1000n, currency: 'IQD' });
    expect(await at(days(-5))).toEqual({ amount: 1000n, currency: 'IQD' });
    // validTo is exclusive: at the instant of a change, the new price holds.
    expect(await at(days(-1))).toEqual({ amount: 1250n, currency: 'IQD' });
    expect(await at(NOW)).toEqual({ amount: 1250n, currency: 'IQD' });
    expect(await at(days(6))).toEqual({ amount: 1500n, currency: 'IQD' });
    // Another currency has no price; another business sees none.
    expect(await priceAt(scoped(w), { ...p, branchId: null, currency: 'USD', at: NOW })).toBeNull();
    const b = await pharmacy('B');
    expect(await priceAt(scopedClient(prisma(), { restaurantId: b.id, allBranches: true }), { ...p, branchId: null, currency: 'IQD', at: NOW })).toBeNull();
  });

  it('a branch price overrides the business price only in that branch', async () => {
    const w = await world({ branches: 2 });
    const [one, two] = w.a.branchIds as [string, string];
    const p = await product(w, 'Panadol');
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-10))));
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1200', days(-5), { branchId: one })));

    const at = (branchId: string | null, when = NOW) => priceAt(scoped(w), { ...p, branchId, currency: 'IQD', at: when });
    expect(await at(one)).toEqual({ amount: 1200n, currency: 'IQD' });
    expect(await at(two)).toEqual({ amount: 1000n, currency: 'IQD' });
    expect(await at(null)).toEqual({ amount: 1000n, currency: 'IQD' });
    // Before the branch price began, the branch had the business price.
    expect(await at(one, days(-7))).toEqual({ amount: 1000n, currency: 'IQD' });
    // The branch price did not close the business price: they are separate keys.
    expect(await openRows()).toHaveLength(2);
  });

  it('a USD price on an IQD-only business is refused', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    const refused = await act(w.owner, priceActions.set, setInput(w, p, '12.50', days(-1), { currency: 'USD' }));
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { phCode: 'CURRENCY_NOT_ENABLED', currency: expect.any(String) } } });
    expect(await prisma().phPrice.count()).toBe(0);

    // With USD enabled, the same price is stored in cents.
    await prisma().phSettings.update({ where: { restaurantId: w.a.id }, data: { enabledCurrencies: ['IQD', 'USD'] } });
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '12.50', days(-1), { currency: 'USD' })));
    expect((await prisma().phPrice.findFirstOrThrow()).amountMinor).toBe(1250n);
  });

  it('a negative amount is refused', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    for (const amount of ['-500', '−500', '1e3', '12,50', '', '12.5']) {
      const refused = await act(w.owner, priceActions.set, setInput(w, p, amount, days(-1)));
      expect(refused, amount).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { amount: expect.any(String) } } });
    }
    expect(await prisma().phPrice.count()).toBe(0);
    // Zero is a price (a free sample).
    expect(codeOf(await act(w.owner, priceActions.set, setInput(w, p, '0', days(-1))))).toBe('OK');
  });

  it('a price without a reason is refused', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    const withoutReason: Record<string, unknown> = setInput(w, p, '1000', days(-1));
    delete withoutReason.reason;
    expect(codeOf(await act(w.owner, priceActions.set, withoutReason))).toBe('INVALID');
    for (const reason of ['', '   ', ' ab ', 'x'.repeat(201)]) {
      const refused = await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-1), { reason }));
      expect(refused, reason).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { reason: expect.any(String) } } });
    }
    expect(await prisma().phPrice.count()).toBe(0);
  });

  it("a price change never updates an old row's amount (assert by reading history)", async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-10))));
    const before = await prisma().phPrice.findFirstOrThrow();
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1250', days(-5))));
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1500', days(-1))));

    // A back-dated price (at or before the open one's start) is refused: it would rewrite a closed window.
    for (const when of [days(-1), days(-3), days(-20)]) {
      expect(phCodeOf(await act(w.owner, priceActions.set, setInput(w, p, '9999', when)))).toBe('PRICE_BACKDATED');
    }

    const history = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, productId: p.productId, unitId: p.unitId }));
    expect(history.items.map((h) => [h.amountMinor, h.validFrom, h.validTo])).toEqual([
      ['1500', days(-1).toISOString(), null],
      ['1250', days(-5).toISOString(), days(-1).toISOString()],
      ['1000', days(-10).toISOString(), days(-5).toISOString()],
    ]);
    // The first row is the same row as when it was written, but for its validTo.
    const after = await prisma().phPrice.findUniqueOrThrow({ where: { id: before.id } });
    expect({ ...after, validTo: null }).toEqual(before);
    expect(await prisma().phPrice.count()).toBe(3);
  });

  it('a cashier cannot set a price', async () => {
    const w = await world();
    const cashier = await person('cashier', { staff: [w.a.id, 'CASHIER', [w.a.branchId]] });
    const p = await product(w, 'Panadol');
    expect(codeOf(await act(cashier, priceActions.set, setInput(w, p, '1000', days(-1), { branchId: w.a.branchId })))).toBe('FORBIDDEN');
    expect(await prisma().phPrice.count()).toBe(0);

    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-1))));
    const bulk = { restaurantId: w.a.id, currency: 'IQD', change: { kind: 'percent', basisPoints: 1000 }, rounding: { step: '250', mode: 'nearest' }, validFrom: NOW, reason: 'Yearly rise' };
    expect(codeOf(await act(cashier, priceActions.previewBulk, { ...bulk, branchId: w.a.branchId }))).toBe('FORBIDDEN');
    const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulk));
    expect(codeOf(await act(cashier, priceActions.applyBulk, { restaurantId: w.a.id, batchId: preview.batchId, previewHash: preview.previewHash }))).toBe('FORBIDDEN');
    expect(await prisma().phPrice.count()).toBe(1);

    // The cashier may read the history (catalog.view).
    expect(dataOf(await ask(cashier, priceQueries.history, { restaurantId: w.a.id, productId: p.productId })).items).toHaveLength(1);
  });

  describe('bulk', () => {
    const bulkInput = (w: World, over: Record<string, unknown> = {}) => ({
      restaurantId: w.a.id,
      currency: 'IQD',
      change: { kind: 'percent', basisPoints: 1000 },
      rounding: { step: '250', mode: 'nearest' },
      validFrom: days(1),
      reason: 'Yearly rise',
      ...over,
    });

    it('previews, stores the batch and applies it', async () => {
      const w = await world();
      const p1 = await product(w, 'Panadol');
      const p2 = await product(w, 'Brufen');
      dataOf(await act(w.owner, priceActions.set, setInput(w, p1, '1250', days(-10))));
      dataOf(await act(w.owner, priceActions.set, setInput(w, p2, '2000', days(-10))));

      const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulkInput(w)));
      const expected = [
        { ...p1, before: '1250', after: '1500' },
        { ...p2, before: '2000', after: '2250' },
      ].sort((x, y) => x.productId.localeCompare(y.productId));
      expect(preview.rows.map((r) => ({ productId: r.productId, unitId: r.unitId, before: r.before, after: r.after }))).toEqual(expected);
      const batch = await prisma().phPriceChangeBatch.findUniqueOrThrow({ where: { id: preview.batchId } });
      expect(batch).toMatchObject({ restaurantId: w.a.id, status: 'PREVIEW', previewHash: preview.previewHash, validFrom: days(1), createdById: w.owner.userId });
      // The preview changes no price.
      expect(await prisma().phPrice.count()).toBe(2);

      const applied = dataOf(await act(w.owner, priceActions.applyBulk, { restaurantId: w.a.id, batchId: preview.batchId, previewHash: preview.previewHash }));
      expect(applied).toEqual({ batchId: preview.batchId, changed: 2, alreadyApplied: false });
      expect((await openRows()).map((r) => [r.productId, r.amountMinor, r.validFrom, r.reason, r.changedById])).toEqual(
        [
          [p1.productId, 1500n, days(1), 'Yearly rise', w.owner.userId],
          [p2.productId, 2250n, days(1), 'Yearly rise', w.owner.userId],
        ].sort((x, y) => (x[0] as string).localeCompare(y[0] as string)),
      );
      expect((await prisma().phPriceChangeBatch.findUniqueOrThrow({ where: { id: preview.batchId } })).status).toBe('APPLIED');
      expect(await prisma().auditLog.count({ where: { action: 'ph.price.bulkPreview', entityId: preview.batchId } })).toBe(1);
      expect(await prisma().auditLog.count({ where: { action: 'ph.price.bulkApply', entityId: preview.batchId } })).toBe(1);
    });

    it('a bulk apply with a stale preview hash is refused and changes nothing', async () => {
      const w = await world();
      const p1 = await product(w, 'Panadol');
      const p2 = await product(w, 'Brufen');
      dataOf(await act(w.owner, priceActions.set, setInput(w, p1, '1250', days(-10))));
      dataOf(await act(w.owner, priceActions.set, setInput(w, p2, '2000', days(-10))));
      const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulkInput(w)));

      // A hash other than the one previewed.
      const wrong = await act(w.owner, priceActions.applyBulk, { restaurantId: w.a.id, batchId: preview.batchId, previewHash: 'f'.repeat(64) });
      expect(wrong).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'PREVIEW_STALE' } } });

      // A price changed since the preview: what the person saw is no longer what would happen.
      dataOf(await act(w.owner, priceActions.set, setInput(w, p2, '2100', days(-2))));
      const countBefore = await prisma().phPrice.count();
      const stale = await act(w.owner, priceActions.applyBulk, { restaurantId: w.a.id, batchId: preview.batchId, previewHash: preview.previewHash });
      expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'PREVIEW_STALE' } } });
      expect(await prisma().phPrice.count()).toBe(countBefore);
      expect((await openRows()).map((r) => r.amountMinor).sort()).toEqual([1250n, 2100n].sort());
      expect((await prisma().phPriceChangeBatch.findUniqueOrThrow({ where: { id: preview.batchId } })).status).toBe('PREVIEW');
      expect(await prisma().auditLog.count({ where: { action: 'ph.price.bulkApply' } })).toBe(0);
    });

    it('a bulk apply is all or nothing (one failing row leaves every price unchanged)', async () => {
      const w = await world();
      const made = [await product(w, 'Panadol'), await product(w, 'Brufen')];
      // Rows are applied in product id order: the failing one is the second, after the first was written.
      const [first, second] = [...made].sort((x, y) => x.productId.localeCompare(y.productId)) as [typeof made[0], typeof made[0]];
      dataOf(await act(w.owner, priceActions.set, setInput(w, first, '1250', days(-10))));
      dataOf(await act(w.owner, priceActions.set, setInput(w, second, '2000', days(-10))));
      const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulkInput(w, { validFrom: days(1) })));

      // The second product gets the same amount again from a later date: the preview still matches (same amounts), but
      // the batch's date is now before that row's start, so its row cannot be applied.
      dataOf(await act(w.owner, priceActions.set, setInput(w, second, '2000', days(2))));
      const openBefore = await openRows();
      const countBefore = await prisma().phPrice.count();

      const refused = await act(w.owner, priceActions.applyBulk, { restaurantId: w.a.id, batchId: preview.batchId, previewHash: preview.previewHash });
      expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { phCode: 'PRICE_BACKDATED', productId: second.productId } } });
      expect(await openRows()).toEqual(openBefore);
      expect(await prisma().phPrice.count()).toBe(countBefore);
      expect((await prisma().phPriceChangeBatch.findUniqueOrThrow({ where: { id: preview.batchId } })).status).toBe('PREVIEW');

      // A change that would take a price below zero is refused at the preview, and no batch is stored.
      const negative = await act(w.owner, priceActions.previewBulk, bulkInput(w, { change: { kind: 'fixed', amount: '-1,500' }, validFrom: days(3) }));
      expect(negative).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { phCode: 'NEGATIVE_PRICE', productId: first.productId } } });
      expect(await prisma().phPriceChangeBatch.count()).toBe(1);
    });

    it('applying the same batch twice changes prices once', async () => {
      const w = await world();
      const p1 = await product(w, 'Panadol');
      dataOf(await act(w.owner, priceActions.set, setInput(w, p1, '1250', days(-10))));
      const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulkInput(w)));
      const apply = { restaurantId: w.a.id, batchId: preview.batchId, previewHash: preview.previewHash };

      expect(dataOf(await act(w.owner, priceActions.applyBulk, apply))).toEqual({ batchId: preview.batchId, changed: 1, alreadyApplied: false });
      expect(dataOf(await act(w.owner, priceActions.applyBulk, apply))).toEqual({ batchId: preview.batchId, changed: 0, alreadyApplied: true });
      expect(await prisma().phPrice.count()).toBe(2);
      expect(await prisma().auditLog.count({ where: { action: 'ph.price.bulkApply' } })).toBe(1);

      // Two applies at the same moment: one applies, the other finds it applied.
      const again = dataOf(await act(w.owner, priceActions.previewBulk, bulkInput(w, { validFrom: days(2) })));
      const actor = await actorOf(w.owner);
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          runAction(prisma(), actor, priceActions.applyBulk, { restaurantId: w.a.id, batchId: again.batchId, previewHash: again.previewHash }, META),
        ),
      );
      expect(results.map((r) => dataOf(r).changed).sort()).toEqual([0, 0, 0, 1]);
      expect(await prisma().phPrice.count()).toBe(3);
      expect((await openRows()).map((r) => r.amountMinor)).toEqual([1750n]);
    });

    it('a batch from another business is NOT_FOUND', async () => {
      const w = await world();
      const p1 = await product(w, 'Panadol');
      dataOf(await act(w.owner, priceActions.set, setInput(w, p1, '1250', days(-10))));
      const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulkInput(w)));

      const b = await pharmacy('B');
      await prisma().phSettings.create({ data: { restaurantId: b.id } });
      const ownerB = await person('ownerB', { membership: [b.id, 'OWNER'] });
      const refused = await act(ownerB, priceActions.applyBulk, { restaurantId: b.id, batchId: preview.batchId, previewHash: preview.previewHash });
      expect(codeOf(refused)).toBe('NOT_FOUND');
      expect(await prisma().phPrice.count()).toBe(1);
      expect((await prisma().phPriceChangeBatch.findUniqueOrThrow({ where: { id: preview.batchId } })).status).toBe('PREVIEW');
    });
  });

  it('a branch manager sets prices only in their own branches', async () => {
    const w = await world({ branches: 2 });
    const [one, two] = w.a.branchIds as [string, string];
    const manager = await person('manager', { staff: [w.a.id, 'BRANCH_MANAGER', [one]] });
    const p = await product(w, 'Panadol');

    // Another branch, and the business-wide price (every branch), are not theirs to set.
    expect(codeOf(await act(manager, priceActions.set, setInput(w, p, '1000', days(-1), { branchId: two })))).toBe('FORBIDDEN');
    expect(codeOf(await act(manager, priceActions.set, setInput(w, p, '1000', days(-1))))).toBe('FORBIDDEN');
    expect(await prisma().phPrice.count()).toBe(0);
    dataOf(await act(manager, priceActions.set, setInput(w, p, '1100', days(-1), { branchId: one })));
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-2))));
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1300', days(-2), { branchId: two })));

    const bulk = { restaurantId: w.a.id, currency: 'IQD', change: { kind: 'fixed', amount: '250' }, rounding: { step: '1', mode: 'nearest' }, validFrom: NOW, reason: 'Rise' };
    expect(codeOf(await act(manager, priceActions.previewBulk, { ...bulk, branchId: two }))).toBe('FORBIDDEN');
    expect(codeOf(await act(manager, priceActions.previewBulk, bulk))).toBe('FORBIDDEN');
    // A business-wide batch the owner previewed cannot be applied by the manager.
    const ownerBatch = dataOf(await act(w.owner, priceActions.previewBulk, bulk));
    const applied = await act(manager, priceActions.applyBulk, { restaurantId: w.a.id, branchId: one, batchId: ownerBatch.batchId, previewHash: ownerBatch.previewHash });
    expect(codeOf(applied)).toBe('FORBIDDEN');
    expect(await prisma().phPrice.count()).toBe(3);
    // Their own branch's batch changes only their branch's row.
    const own = dataOf(await act(manager, priceActions.previewBulk, { ...bulk, branchId: one }));
    expect(own.rows.map((r) => r.before)).toEqual(['1100']);
    dataOf(await act(manager, priceActions.applyBulk, { restaurantId: w.a.id, branchId: one, batchId: own.batchId, previewHash: own.previewHash }));
    expect((await openRows()).map((r) => [r.branchId, r.amountMinor]).sort()).toEqual(
      [
        [one, 1350n],
        [two, 1300n],
        [null, 1000n],
      ].sort(),
    );

    // The manager's history shows their branch and the business-wide rows, never another branch's.
    const seen = dataOf(await ask(manager, priceQueries.history, { restaurantId: w.a.id, productId: p.productId }));
    expect(new Set(seen.items.map((h) => h.branchId))).toEqual(new Set([one, null]));
    const ownerSees = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, productId: p.productId }));
    expect(new Set(ownerSees.items.map((h) => h.branchId))).toEqual(new Set([one, two, null]));
    // Narrowed to one branch: that branch's rows and the business-wide ones.
    const narrowed = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, branchId: two, productId: p.productId }));
    expect(new Set(narrowed.items.map((h) => h.branchId))).toEqual(new Set([two, null]));
  });

  it('a support actor reads price history and changes nothing', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    dataOf(await act(w.owner, priceActions.set, setInput(w, p, '1000', days(-1))));
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, w.a.id, { scopes: ['catalog.read'] });

    expect(dataOf(await ask(admin, priceQueries.history, { restaurantId: w.a.id, productId: p.productId })).items).toHaveLength(1);
    expect(codeOf(await act(admin, priceActions.set, setInput(w, p, '2000', NOW)))).toBe('FORBIDDEN');
    const bulk = { restaurantId: w.a.id, currency: 'IQD', change: { kind: 'percent', basisPoints: 1000 }, rounding: { step: '1', mode: 'up' }, validFrom: NOW, reason: 'Rise' };
    expect(codeOf(await act(admin, priceActions.previewBulk, bulk))).toBe('FORBIDDEN');
    const preview = dataOf(await act(w.owner, priceActions.previewBulk, bulk));
    expect(codeOf(await act(admin, priceActions.applyBulk, { restaurantId: w.a.id, batchId: preview.batchId, previewHash: preview.previewHash }))).toBe('FORBIDDEN');
    expect(await prisma().phPrice.count()).toBe(1);
  });

  it('pages the history newest first', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    for (let i = 0; i < 5; i += 1) dataOf(await act(w.owner, priceActions.set, setInput(w, p, `${1000 + i}`, days(-10 + i))));
    const first = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, productId: p.productId, pageSize: 2 }));
    expect(first.items.map((h) => h.amountMinor)).toEqual(['1004', '1003']);
    const second = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, productId: p.productId, pageSize: 2, cursor: first.nextCursor }));
    expect(second.items.map((h) => h.amountMinor)).toEqual(['1002', '1001']);
    const third = dataOf(await ask(w.owner, priceQueries.history, { restaurantId: w.a.id, productId: p.productId, pageSize: 2, cursor: second.nextCursor }));
    expect(third.items.map((h) => h.amountMinor)).toEqual(['1000']);
    expect(third.nextCursor).toBeNull();
  });

  it('two simultaneous sets for the same key end with one open row and a clear refusal for the loser', async () => {
    const w = await world();
    const p = await product(w, 'Panadol');
    const actor = await actorOf(w.owner);

    // No price yet: every save inserts, and the database keeps one open row.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => runAction(prisma(), actor, priceActions.set, setInput(w, p, `${1000 + i}`, days(-1)), META)),
    );
    expect(await openRows()).toHaveLength(1);
    expect(await prisma().phPrice.count()).toBe(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) {
      expect(['PRICE_CONFLICT', 'PRICE_BACKDATED']).toContain(phCodeOf(r));
    }

    // An open price: every save closes it, and only one may.
    const closing = await Promise.all(
      Array.from({ length: 5 }, (_, i) => runAction(prisma(), actor, priceActions.set, setInput(w, p, `${2000 + i}`, NOW), META)),
    );
    expect(await openRows()).toHaveLength(1);
    expect(await prisma().phPrice.count()).toBe(2);
    expect(closing.filter((r) => r.ok)).toHaveLength(1);
    for (const r of closing.filter((x) => !x.ok)) {
      expect(['PRICE_CONFLICT', 'PRICE_BACKDATED']).toContain(phCodeOf(r));
    }

    // The race made certain: another save holds an open row for a new key uncommitted while this one checks (finding
    // nothing) and then waits on the index; when the other commits, this one is refused PRICE_CONFLICT, never an
    // internal error.
    const usdKey = await product(w, 'Brufen');
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const holding = new Promise<void>((resolve) => (inserted = resolve));
    const other = prisma().$transaction(
      async (tx) => {
        await tx.phPrice.create({
          data: { restaurantId: w.a.id, ...usdKey, currency: 'IQD', amountMinor: 500n, validFrom: days(-1), reason: 'Held', changedById: w.owner.userId },
        });
        inserted();
        await held;
      },
      { timeout: 20_000 },
    );
    await holding;
    const losing = runAction(prisma(), actor, priceActions.set, setInput(w, usdKey, '700', days(-1)), META);
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await other;
    const lost = await losing;
    expect(lost).toMatchObject({ ok: false, error: { code: 'CONFLICT', fields: { phCode: 'PRICE_CONFLICT' } } });
    expect(await prisma().phPrice.findMany({ where: { productId: usdKey.productId } })).toHaveLength(1);
  });
});
