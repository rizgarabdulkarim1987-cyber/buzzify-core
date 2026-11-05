import type { ScopedClient } from '@/server/data/tenant-db';
import { normalizeForSearch } from '@/server/domain/pharmacy/product-identity';
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
/** How many catalog hits are read per ingredient to look for RX/RESTRICTED products. */
const SCREEN_LIMIT = 100;

export interface ComplaintOption {
  ingredient: string;
  tradeNames: string[];
  note: string;
}

export interface MatchedItem {
  productId: string;
  unitId: string;
  tradeName: string;
  strength: string;
  form: string;
  /** Minor units as decimal text, in `currency`. */
  priceMinor: string;
  currency: 'IQD' | 'USD';
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
  for (const option of options) {
    const key = normalizeForSearch(option.ingredient);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);

    const hits = await searchProducts(scoped, { q: option.ingredient, branchId, limit: SCREEN_LIMIT });
    const found = await sellItemsByIds(scoped, { branchId, currency, productIds: hits.map((h) => h.productId), now });
    if (found.some((item) => item.rxLevel !== 'OTC')) continue;

    const items: MatchedItem[] = [];
    for (const item of found) {
      if (items.length >= DOCTOR_MAX_ITEMS) break;
      const unit = item.units.find((u) => u.id === item.matchedUnitId);
      if (!unit || unit.priceMinor === null || item.sellableQty <= 0) continue;
      items.push({
        productId: item.productId,
        unitId: unit.id,
        tradeName: item.tradeName,
        strength: item.strength,
        form: item.form,
        priceMinor: unit.priceMinor,
        currency: unit.currency,
        sellableQty: item.sellableQty,
      });
    }
    out.push({ ingredient: option.ingredient, note: option.note, items, status: items.length > 0 ? 'IN_STOCK' : 'NOT_IN_STOCK' });
  }
  return out;
}
