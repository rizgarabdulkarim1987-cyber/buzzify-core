import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { fefoOrder, sellableStock, type FefoBatch } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { priceRowsAt } from './prices';
import { searchProducts } from './search';

/**
 * What the sale screen shows after a scan or a word (`ph.sell.search`): the catalog search (barcode first, kept as text so
 * leading zeros survive; then trade name, generic name, active ingredient) with, per product, what a seller needs at the
 * counter: the units with their open price in the sale currency (`noPrice` when there is none), the sellable quantity in
 * the actor's branch, and the five nearest-expiry batches in FEFO order. The sellable quantity is the one definition of the
 * stock layer (`sellableStock`: `available` only, in an ACTIVE, not-expired batch). A RESTRICTED product is shown and flagged
 * `notSellable`. The branch is the place's, never an input of its own. No cost field is ever part of the answer.
 */

export const SELL_SEARCH_MAX = 30;
export const BATCH_STRIP = 5;

export const sellSearchInput = z.object({
  q: z.string().max(10_000),
  limit: z.number('Enter a whole number').int('Enter a whole number').min(1, 'Use 1 or more').max(SELL_SEARCH_MAX, 'Enter a smaller number').default(SELL_SEARCH_MAX),
  /** The currency the sale is in; the pharmacy's default when absent. */
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD').optional(),
});

export interface SellUnit {
  id: string;
  label: string;
  level: number;
  baseQty: number;
  /** Minor units as decimal text; null when the unit has no open price in `currency` here. */
  priceMinor: string | null;
  currency: 'IQD' | 'USD';
  noPrice: boolean;
}

export interface SellBatch {
  batchId: string;
  lot: string;
  expiryDate: string;
  available: number;
}

/** What the sale screen needs to show a total the way the sale will make it (display only; the sale judges them again). */
export interface SellSettings {
  defaultCurrency: 'IQD' | 'USD';
  enabledCurrencies: ('IQD' | 'USD')[];
  /** Invoice rounding step in minor units, as text; "0" = none. */
  roundingStepMinor: string;
  maxDiscountPercent: number;
}

export interface SellItem {
  productId: string;
  tradeName: string;
  genericName: string;
  strength: string;
  form: string;
  packLabel: string;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
  matchedOn: string;
  /** The unit a barcode named, else the product's largest sellable unit. */
  matchedUnitId: string | null;
  sellableQty: number;
  notSellable: boolean;
  notSellableReason: 'RESTRICTED' | null;
  noPrice: boolean;
  units: SellUnit[];
  batches: SellBatch[];
}

const fefoOf = (b: { id: string; lot: string; expiryDate: Date; expiryPrecision: FefoBatch['expiryPrecision'] }): FefoBatch => ({
  id: b.id,
  lot: b.lot,
  expiryDate: b.expiryDate.toISOString().slice(0, 10),
  expiryPrecision: b.expiryPrecision,
});

export async function sellSearch(
  scoped: ScopedClient,
  ph: PhActor,
  input: z.infer<typeof sellSearchInput> & { branchId?: string },
  now: Date = new Date(),
): Promise<{ branchId: string; currency: 'IQD' | 'USD'; settings: SellSettings; items: SellItem[] }> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'shift.use') && !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
  const branchId = input.branchId;
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  if (!ph.branchIds.includes(branchId)) throw new StudioError('FORBIDDEN');

  const settings = await scoped.phSettings.findFirst({ select: { defaultCurrency: true, enabledCurrencies: true, roundingStepMinor: true, maxDiscountPercent: true } });
  const currency = input.currency ?? settings?.defaultCurrency ?? 'IQD';
  const sellSettings: SellSettings = {
    defaultCurrency: settings?.defaultCurrency ?? 'IQD',
    enabledCurrencies: settings?.enabledCurrencies ?? ['IQD'],
    roundingStepMinor: String(settings?.roundingStepMinor ?? 0n),
    maxDiscountPercent: settings?.maxDiscountPercent ?? 5,
  };
  const found = await searchProducts(scoped, { q: input.q, branchId, limit: input.limit });
  if (found.length === 0) return { branchId, currency, settings: sellSettings, items: [] };

  const ids = found.map((f) => f.productId);
  const [products, balances] = await Promise.all([
    scoped.phProduct.findMany({
      where: { id: { in: ids } },
      select: { id: true, genericName: true, rxLevel: true, units: { where: { sellable: true }, select: { id: true, label: true, level: true, baseQty: true }, orderBy: { level: 'asc' } } },
    }),
    scoped.phStockBalance.findMany({ where: { branchId, productId: { in: ids }, available: { gt: 0 } }, select: { productId: true, batchId: true, available: true } }),
  ]);
  const batches = await scoped.phBatch.findMany({
    where: { id: { in: [...new Set(balances.map((b) => b.batchId))] } },
    select: { id: true, lot: true, status: true, expiryDate: true, expiryPrecision: true },
  });
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const prices = await priceRowsAt(scoped, {
    units: products.flatMap((p) => p.units.map((u) => ({ productId: p.id, unitId: u.id }))),
    branchId,
    currency,
    at: now,
  });

  const today = utcToday(now);
  const stockOf = new Map<string, { total: number; list: { fefo: FefoBatch; available: number }[] }>();
  for (const row of balances) {
    const batch = batchById.get(row.batchId);
    if (!batch) continue;
    const fefo = fefoOf(batch);
    const sellable = sellableStock({ available: row.available, reserved: 0, quarantine: 0, damaged: 0 }, { status: batch.status, expiryDate: fefo.expiryDate }, today);
    if (sellable <= 0) continue;
    const entry = stockOf.get(row.productId) ?? { total: 0, list: [] };
    entry.total += sellable;
    entry.list.push({ fefo, available: sellable });
    stockOf.set(row.productId, entry);
  }

  const items: SellItem[] = [];
  for (const hit of found) {
    const product = productById.get(hit.productId);
    if (!product) continue;
    const stock = stockOf.get(product.id);
    const units: SellUnit[] = product.units.map((u) => {
      const row = prices.get(`${product.id}:${u.id}`);
      return { id: u.id, label: u.label, level: u.level, baseQty: u.baseQty, priceMinor: row ? String(row.amount) : null, currency, noPrice: !row };
    });
    items.push({
      productId: product.id,
      tradeName: hit.label,
      genericName: product.genericName,
      strength: hit.strength,
      form: hit.form,
      packLabel: hit.packLabel,
      rxLevel: product.rxLevel,
      matchedOn: hit.matchedOn,
      matchedUnitId: hit.unitId ?? null,
      sellableQty: stock?.total ?? 0,
      notSellable: product.rxLevel === 'RESTRICTED',
      notSellableReason: product.rxLevel === 'RESTRICTED' ? 'RESTRICTED' : null,
      noPrice: units.every((u) => u.noPrice),
      units,
      batches: (stock?.list ?? [])
        .sort((a, b) => fefoOrder(a.fefo, b.fefo))
        .slice(0, BATCH_STRIP)
        .map((b) => ({ batchId: b.fefo.id, lot: b.fefo.lot, expiryDate: b.fefo.expiryDate, available: b.available })),
    });
  }
  return { branchId, currency, settings: sellSettings, items };
}
