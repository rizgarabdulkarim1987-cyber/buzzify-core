import type { ScopedClient } from '@/server/data/tenant-db';
import { normalizeForSearch } from '@/server/domain/pharmacy/product-identity';
import type { ComplaintAnswer } from '@/server/domain/pharmacy/doctor';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '../actor';
import { searchProducts } from '../search';
import { sellItemsByIds } from '../sell-search';

/**
 * Turns the model's ingredient options into what this branch can sell now. The model supplies names only: every price and
 * quantity here is read from the database, by the same reads the Sell screen uses (`sellItemsByIds`: the open price of the
 * unit and `sellableStock`), so the numbers agree with it. Unlike `sellSearch` it needs no open shift or `shift.use`: a
 * clinical helper opened from Home must not depend on a till session. The branch must be one the actor may use.
 *
 * Rules: only OTC products are ever shown. An ingredient that matches ANY RX or RESTRICTED product of the catalog is dropped
 * entirely (not shown as "not in stock", so the screen never hints at a prescription-only medicine). An item needs sellable
 * stock and an open price. No match (or none sellable) is `NOT_IN_STOCK` with the name only. At most 3 items per option.
 */

export const DOCTOR_MAX_ITEMS = 3;
export const DOCTOR_MAX_OPTIONS = 8;
export const DOCTOR_NOTE_MAX = 140;
/** How many catalog hits are read per ingredient to look for RX/RESTRICTED products. */
const SCREEN_LIMIT = 100;

/** One option of a complaint answer; derived from the answer schema so it cannot drift. `tradeNames` is intentionally unused here: the shop's own catalog decides what is shown, never the model's brand names. */
export type ComplaintOption = ComplaintAnswer['options'][number];

const DIGIT = String.raw`[0-9\u0660-\u0669\u06F0-\u06F9]`;
const CURRENCY = String.raw`(?:iqd|usd|\$|دينار|د\.ع|دۆلار|دولار)`;
const MONEY = new RegExp(String.raw`${DIGIT}[0-9\u0660-\u0669\u06F0-\u06F9.,]*\s*${CURRENCY}|${CURRENCY}\s*${DIGIT}`, 'i');
const STOCK_PHRASE = /in\s+stock|متوفر|بەردەست/i;

/** The model's note, kept only when it states no price or quantity (those come from the database alone), cut to 140 characters. */
export function safeNote(note: string): string {
  if (MONEY.test(note) || STOCK_PHRASE.test(note)) return '';
  return note.trim().slice(0, DOCTOR_NOTE_MAX);
}

export interface MatchedItem {
  productId: string;
  unitId: string;
  /** The unit the price and the quantity are for. */
  unitLabel: string;
  baseQty: number;
  tradeName: string;
  strength: string;
  form: string;
  /** Minor units as decimal text, in `currency`. */
  priceMinor: string;
  currency: 'IQD' | 'USD';
  /** How many of `unitLabel` can be sold here now (whole units). */
  sellableQty: number;
}

export interface MatchedOption {
  ingredient: string;
  note: string;
  items: MatchedItem[];
  status: 'IN_STOCK' | 'NOT_IN_STOCK';
}

export async function matchOptions(
  env: { scoped: ScopedClient; ph: PhActor; branchId: string; currency: 'IQD' | 'USD'; now: Date },
  options: readonly ComplaintOption[],
): Promise<MatchedOption[]> {
  const { scoped, ph, branchId, currency, now } = env;
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!ph.branchIds.includes(branchId)) throw new StudioError('FORBIDDEN');

  const out: MatchedOption[] = [];
  const seen = new Set<string>();
  for (const option of options.slice(0, DOCTOR_MAX_OPTIONS)) {
    const key = normalizeForSearch(option.ingredient);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);

    const hits = await searchProducts(scoped, { q: option.ingredient, branchId, limit: SCREEN_LIMIT });
    // Fail closed: a read that hit its limit may have missed a prescription-only product, so the ingredient is dropped.
    if (hits.length >= SCREEN_LIMIT) continue;
    const found = await sellItemsByIds(scoped, { branchId, currency, productIds: hits.map((h) => h.productId), now });
    if (found.some((item) => item.rxLevel !== 'OTC')) continue;

    const items: MatchedItem[] = [];
    for (const item of found) {
      if (items.length >= DOCTOR_MAX_ITEMS) break;
      // The unit the Sell screen starts a line in when none is named (`startUnit`): the smallest sellable one. Stock is in base units.
      const unit = [...item.units].sort((a, b) => a.baseQty - b.baseQty)[0];
      if (!unit || unit.priceMinor === null) continue;
      const qty = Math.floor(item.sellableQty / unit.baseQty);
      if (qty <= 0) continue;
      items.push({
        productId: item.productId,
        unitId: unit.id,
        unitLabel: unit.label,
        baseQty: unit.baseQty,
        tradeName: item.tradeName,
        strength: item.strength,
        form: item.form,
        priceMinor: unit.priceMinor,
        currency: unit.currency,
        sellableQty: qty,
      });
    }
    out.push({ ingredient: option.ingredient, note: safeNote(option.note), items, status: items.length > 0 ? 'IN_STOCK' : 'NOT_IN_STOCK' });
  }
  return out;
}
