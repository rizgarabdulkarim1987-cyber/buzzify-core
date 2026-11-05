import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { daysToExpiry, isExpired, utcToday } from '@/server/domain/pharmacy/expiry';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { fefoOrder, sellableStock } from '@/server/domain/pharmacy/stock';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { sellItemsByIds, type SellItem } from './sell-search';

/**
 * What the cashier shows about ONE product beside the sale (`ph.sell.info`): the inquiry panel (F7) and the three panels under
 * the sale lines. Who may read it is who may search at the sale screen (`shift.use` or `report.view`); the branch is the place's.
 *  - batches: every batch with stock on the shelf here (`available` > 0), nearest expiry first (FEFO), each marked expired and
 *    sellable the way the sale judges it (`sellableStock`): an expired or recalled batch is listed, never sold;
 *  - details: the item code, the generic name and active ingredient, the last three sale prices of this product here (in the
 *    sale currency) and the last batch received into this branch (date and supplier). No cost and no profit is ever part of the answer;
 *  - substitutes: other active products with the SAME active ingredient (never matched by name), in stock here, sellable and
 *    priced, as the sale screen's items (so one can be put on the receipt as it is).
 */

export const NEAR_EXPIRY_DAYS = 90;
export const SUBSTITUTES_MAX = 10;
const LAST_SALES = 3;

export const sellInfoInput = z.object({
  productId: z.string().min(1).max(64),
  currency: z.enum(['IQD', 'USD'], 'Choose IQD or USD').optional(),
});

export interface InfoBatch {
  batchId: string;
  lot: string;
  expiryDate: string;
  available: number;
  expired: boolean;
  /** Within NEAR_EXPIRY_DAYS and not expired. */
  near: boolean;
  /** The sale may take from it (ACTIVE and not expired). */
  sellable: boolean;
}

export interface InfoDetails {
  code: string;
  genericName: string;
  activeIngredient: string;
  /** Newest first: the unit sold and its price (minor units as text) in `currency`. */
  lastSales: { unitLabel: string; unitPriceMinor: string; at: string }[];
  lastPurchase: { at: string; supplierName: string } | null;
}

export interface SellInfo {
  productId: string;
  currency: 'IQD' | 'USD';
  batches: InfoBatch[];
  details: InfoDetails;
  substitutes: SellItem[];
}

const SOLD = ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] as const;

/** The same active ingredient, any case and surrounding spaces; an empty ingredient matches nothing. */
export const sameIngredient = (a: string, b: string): boolean => a.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase();

export async function sellInfo(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof sellInfoInput> & { branchId?: string }, now: Date = new Date()): Promise<SellInfo> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'shift.use') && !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
  const branchId = input.branchId;
  if (!branchId) throw new StudioError('INVALID', 'Choose the branch', { branchId: 'Choose the branch' });
  if (!ph.branchIds.includes(branchId)) throw new StudioError('FORBIDDEN');

  const product = await scoped.phProduct.findFirst({ where: { id: input.productId, active: true }, select: { id: true, genericName: true, activeIngredient: true } });
  if (!product) throw new StudioError('NOT_FOUND');
  const settings = await scoped.phSettings.findFirst({ select: { defaultCurrency: true } });
  const currency = input.currency ?? settings?.defaultCurrency ?? 'IQD';
  const today = utcToday(now);

  const [balances, barcode, sold, received] = await Promise.all([
    scoped.phStockBalance.findMany({ where: { branchId, productId: product.id, available: { gt: 0 } }, select: { available: true, batch: { select: { id: true, lot: true, status: true, expiryDate: true, expiryPrecision: true } } } }),
    scoped.phBarcode.findFirst({ where: { productId: product.id }, orderBy: { code: 'asc' }, select: { code: true } }),
    scoped.phSaleLine.findMany({
      where: { productId: product.id, sale: { branchId, currency, status: { in: [...SOLD] } } },
      orderBy: [{ sale: { completedAt: 'desc' } }, { lineNo: 'asc' }],
      take: LAST_SALES,
      select: { unitPriceMinor: true, unit: { select: { label: true } }, sale: { select: { completedAt: true, createdAt: true } } },
    }),
    scoped.phBatch.findFirst({ where: { productId: product.id, balances: { some: { branchId } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true, supplierName: true } }),
  ]);

  const batches: InfoBatch[] = balances
    .map(({ available, batch }) => {
      const fefo = { id: batch.id, lot: batch.lot, expiryDate: batch.expiryDate.toISOString().slice(0, 10), expiryPrecision: batch.expiryPrecision };
      const expired = isExpired(fefo, today);
      return { fefo, row: { batchId: batch.id, lot: batch.lot, expiryDate: fefo.expiryDate, available, expired, near: !expired && daysToExpiry(fefo, today) <= NEAR_EXPIRY_DAYS, sellable: sellableStock({ available, reserved: 0, quarantine: 0, damaged: 0 }, { status: batch.status, expiryDate: fefo.expiryDate }, today) > 0 } };
    })
    .sort((a, b) => fefoOrder(a.fefo, b.fefo))
    .map((b) => b.row);

  return {
    productId: product.id,
    currency,
    batches,
    details: {
      code: barcode?.code ?? '',
      genericName: product.genericName,
      activeIngredient: product.activeIngredient,
      lastSales: sold.map((l) => ({ unitLabel: l.unit.label, unitPriceMinor: String(l.unitPriceMinor), at: (l.sale.completedAt ?? l.sale.createdAt).toISOString() })),
      lastPurchase: received ? { at: received.createdAt.toISOString().slice(0, 10), supplierName: received.supplierName } : null,
    },
    substitutes: await substitutesOf(scoped, { branchId, currency, productId: product.id, ingredient: product.activeIngredient, now }),
  };
}

/** The products with the same active ingredient as this one (itself excluded) that can be sold here now: in stock, sellable, priced. */
async function substitutesOf(scoped: ScopedClient, a: { branchId: string; currency: 'IQD' | 'USD'; productId: string; ingredient: string; now: Date }): Promise<SellItem[]> {
  const ingredient = a.ingredient.trim();
  if (ingredient === '') return [];
  const rows = await scoped.phProduct.findMany({
    where: { active: true, id: { not: a.productId }, activeIngredient: { contains: ingredient, mode: 'insensitive' } },
    orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, activeIngredient: true },
  });
  const ids = rows.filter((r) => sameIngredient(r.activeIngredient, ingredient)).map((r) => r.id);
  const items = await sellItemsByIds(scoped, { branchId: a.branchId, currency: a.currency, productIds: ids, now: a.now });
  return items.filter((i) => !i.notSellable && !i.noPrice && i.sellableQty > 0).slice(0, SUBSTITUTES_MAX);
}
