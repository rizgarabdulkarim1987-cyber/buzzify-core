import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import type { Currency, PhMoney } from '@/server/domain/pharmacy/money';
import { normalizeForSearch, SEARCH_FIELD_SEPARATOR } from '@/server/domain/pharmacy/product-identity';
import { pricesAt } from './prices';
import { packLabelOf } from './products';

/**
 * The central product search: one box for a scanned barcode, a trade name, a generic name or an active ingredient, in
 * Latin or Arabic letters and digits. Every read goes through the scoped client it is given, so another business's
 * products are never seen. The order is: exact barcode, then trade names that start with the query, then every other
 * product whose search text contains each word of the query, best field first.
 *
 * Name matching reads `PhProduct.searchText` (the normalised fields, `searchTextOf`) with `LIKE`, which the trigram GIN
 * index `PhProduct_searchText_trgm` serves; the query is normalised the same way (`normalizeForSearch`), so letter
 * variants, Arabic-Indic digits and unit spellings meet. Ranking within the matches is done here, not in SQL.
 */

/** A query longer than this is cut: no product name needs more, and it bounds the work on hostile input. */
export const SEARCH_MAX_QUERY = 100;
/** At most this many words of the query are matched; each one is one more condition. */
const MAX_WORDS = 8;
export const SEARCH_DEFAULT_LIMIT = 30;
export const SEARCH_MAX_LIMIT = 100;
/** How many name matches beyond the prefix ones are read and ranked. */
const CANDIDATES = 200;

export const searchInput = z.object({
  // Longer input is cut, not refused, so a scanner that sends a long string still gets an answer.
  q: z.string().max(10_000),
  limit: z.number().int().optional(),
  includeInactive: z.boolean().optional(),
});

export type MatchedOn = 'barcode' | 'tradeName' | 'genericName' | 'activeIngredient';

export interface SearchResult {
  productId: string;
  /** The barcode's unit for a barcode hit; otherwise the product's largest sellable unit (the one its price is for). */
  unitId?: string;
  matchedOn: MatchedOn;
  /** The trade name as entered. */
  label: string;
  strength: string;
  form: string;
  packLabel: string;
  /** The unit's price now, in the business's default currency, the branch's own price winning; null when it has none. */
  price: PhMoney | null;
}

export interface SearchInput {
  q: string;
  /**
   * The branch whose prices to show; without it, the business-wide prices. The caller must have checked it is one the
   * actor may see (`ph.products.search` does, through the framework's target check and again in its handler).
   */
  branchId?: string;
  limit?: number;
  includeInactive?: boolean;
}

const PRODUCT = {
  id: true,
  tradeName: true,
  strength: true,
  form: true,
  searchText: true,
  units: { select: { id: true, level: true, label: true, baseQty: true, sellable: true } },
} as const;

interface Row {
  id: string;
  tradeName: string;
  strength: string;
  form: string;
  searchText: string;
  units: { id: string; level: number; label: string; baseQty: number; sellable: boolean }[];
}

/** `LIKE` treats `%`, `_` and `\` as pattern characters; a query means them literally. */
const literal = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const FIELDS: readonly MatchedOn[] = ['tradeName', 'genericName', 'activeIngredient'];

/** Which of the three name fields the words matched, best first, and how well (lower is better). */
function scoreOf(searchText: string, words: readonly string[]): { matchedOn: MatchedOn; score: number } {
  const fields = searchText.split(SEARCH_FIELD_SEPARATOR);
  for (let i = 0; i < FIELDS.length; i += 1) {
    const field = fields[i] ?? '';
    if (words.some((w) => field.includes(w))) {
      // Within a field: the field starting with the first word, then a word of it starting with it, then anywhere.
      const first = words[0]!;
      const at = field.startsWith(first) ? 0 : field.includes(` ${first}`) ? 1 : 2;
      return { matchedOn: FIELDS[i]!, score: i * 3 + at };
    }
  }
  // The words matched only strength, form or manufacturer: the product is named by its trade name.
  return { matchedOn: 'tradeName', score: FIELDS.length * 3 };
}

/** The unit a name hit is priced and sold in: the largest sellable one. */
const saleUnitOf = (units: Row['units']) => [...units].filter((u) => u.sellable).sort((a, b) => b.level - a.level)[0];

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const tradeOf = (row: Row) => row.searchText.split(SEARCH_FIELD_SEPARATOR, 1)[0] ?? '';
/** Trade name, then the other fields (generic name, ingredient, strength...), then id: the same order every time. */
const byText = (a: Row, b: Row) => cmp(tradeOf(a), tradeOf(b)) || cmp(a.searchText, b.searchText) || cmp(a.id, b.id);

/**
 * Searches the business's catalog. An empty query (or one that normalises to nothing) answers `[]`, never the whole
 * catalog. `limit` defaults to 30 and is clamped to 1..100; archived products are left out unless `includeInactive`.
 * Never throws on the query's content. `scoped` is the restaurant-scoped client (named so for enforcement rule 8), not a
 * transaction: its reads run side by side, which one transaction's single connection cannot do.
 */
export async function searchProducts(scoped: ScopedClient, input: SearchInput): Promise<SearchResult[]> {
  const raw = typeof input.q === 'string' ? input.q.slice(0, SEARCH_MAX_QUERY) : '';
  const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.trunc(Number.isFinite(input.limit) ? input.limit! : SEARCH_DEFAULT_LIMIT)));
  const text = normalizeForSearch(raw);
  const code = normalizeScan(raw);
  if (text === '' && code === '') return [];
  const words = [...new Set(text.split(' ').filter(Boolean))].slice(0, MAX_WORDS);
  const active = input.includeInactive ? {} : { active: true };

  const [settings, barcodes, prefixed, containing] = await Promise.all([
    scoped.phSettings.findFirst({ select: { defaultCurrency: true } }),
    code === ''
      ? []
      : scoped.phBarcode.findMany({
          where: { code, product: active },
          select: { unitId: true, product: { select: PRODUCT } },
          orderBy: [{ productId: 'asc' }, { unitId: 'asc' }],
          take: limit,
        }),
    text === ''
      ? []
      : scoped.phProduct.findMany({
          where: { ...active, searchText: { startsWith: literal(text) } },
          select: PRODUCT,
          orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
          take: limit,
        }),
    words.length === 0
      ? []
      : scoped.phProduct.findMany({
          where: { ...active, AND: words.map((w) => ({ searchText: { contains: literal(w) } })) },
          select: PRODUCT,
          orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
          take: CANDIDATES,
        }),
  ]);

  const picked: { row: Row; unitId: string | undefined; matchedOn: MatchedOn }[] = [];
  const seen = new Set<string>();
  const add = (row: Row, unitId: string | undefined, matchedOn: MatchedOn) => {
    if (seen.has(row.id) || picked.length >= limit) return;
    seen.add(row.id);
    picked.push({ row, unitId, matchedOn });
  };
  for (const hit of [...barcodes].sort((a, b) => byText(a.product, b.product))) add(hit.product, hit.unitId, 'barcode');
  for (const row of [...prefixed].sort(byText)) add(row, saleUnitOf(row.units)?.id, 'tradeName');
  const ranked = containing
    .filter((row) => !seen.has(row.id))
    .map((row) => ({ row, ...scoreOf(row.searchText, words) }))
    .sort((a, b) => a.score - b.score || byText(a.row, b.row));
  for (const r of ranked) add(r.row, saleUnitOf(r.row.units)?.id, r.matchedOn);

  const currency: Currency = settings?.defaultCurrency ?? 'IQD';
  const priced = picked.filter((p) => p.unitId !== undefined).map((p) => ({ productId: p.row.id, unitId: p.unitId! }));
  const prices = await pricesAt(scoped, { units: priced, branchId: input.branchId ?? null, currency, at: new Date() });

  return picked.map(({ row, unitId, matchedOn }) => ({
    productId: row.id,
    ...(unitId !== undefined ? { unitId } : {}),
    matchedOn,
    label: row.tradeName,
    strength: row.strength,
    form: row.form,
    packLabel: packLabelOf(row.units),
    price: unitId === undefined ? null : (prices.get(`${row.id}:${unitId}`) ?? null),
  }));
}
