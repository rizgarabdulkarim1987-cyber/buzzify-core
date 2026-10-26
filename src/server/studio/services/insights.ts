import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale } from '@/lib/locale';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import { adviseMenu, type Advice } from '@/server/domain/advisor';
import { unitPrice } from '@/server/domain/catalog';
import { classifyDishes, type DishPerformance } from '@/server/domain/engineering';
import { textsOf, type Names } from './content';

/**
 * The Sales tab's Overview (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.4): the menu engineering classes
 * from the last 30 days of real guest sessions and the dishes' costs, how often guests took each kind of suggestion,
 * and the advisor's checklist for the draft.
 */

export const INSIGHT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type SuggestionKind = 'upgrade' | 'pairing' | 'set' | 'meal';
const KINDS: readonly SuggestionKind[] = ['upgrade', 'pairing', 'set', 'meal'];

/** A suggestion's kind from the prefix of its id (`up:`, `pair:`, `bundle:`, `meal:`). */
function kindOf(suggestionId: string): SuggestionKind | null {
  if (suggestionId.startsWith('up:')) return 'upgrade';
  if (suggestionId.startsWith('pair:')) return 'pairing';
  if (suggestionId.startsWith('bundle:')) return 'set';
  if (suggestionId.startsWith('meal:')) return 'meal';
  return null;
}

const SHOWN = ['UPSELL_IMPRESSION', 'PAIRING_IMPRESSION', 'BUNDLE_IMPRESSION'] as const;
const TAKEN = ['UPSELL_ACCEPT', 'PAIRING_ADD', 'BUNDLE_ACCEPT'] as const;
const ADDED = ['ADD_TO_CART', 'PAIRING_ADD'] as const;

export interface SalesOverview {
  currency: string;
  defaultLocale: string;
  /** The first day the numbers count, ISO 8601. */
  since: string;
  /** Guest sessions that added anything in the window. */
  totalSessions: number;
  insightsAllowed: boolean;
  dishes: Array<DishPerformance & { names: Names }>;
  suggestions: Array<{ kind: SuggestionKind; shown: number; accepted: number }>;
  advice: Advice[];
}

export async function salesOverview(db: PrismaClient, menuId: string, now: Date, insightsAllowed: boolean): Promise<SalesOverview> {
  const since = new Date(now.getTime() - INSIGHT_WINDOW_DAYS * DAY_MS);
  const menu = await db.menu.findUniqueOrThrow({ where: { id: menuId }, select: { locales: true, currency: true, defaultLocale: true } });
  const about = { currency: menu.currency, defaultLocale: menu.defaultLocale };
  const catalog = await loadDraftCatalog(db, menuId);
  const advice = adviseMenu(catalog, menu.locales.filter(isLocale));
  if (!insightsAllowed) return { ...about, since: since.toISOString(), totalSessions: 0, insightsAllowed, dishes: [], suggestions: [], advice };

  const window = { menuId, occurredAt: { gte: since } };
  const added = await db.analyticsEvent.findMany({
    where: { ...window, type: { in: [...ADDED] }, productId: { not: null } },
    distinct: ['productId', 'anonymousSessionId'],
    select: { productId: true, anonymousSessionId: true },
  });
  const sessionsByDish = new Map<string, number>();
  for (const row of added) sessionsByDish.set(row.productId!, (sessionsByDish.get(row.productId!) ?? 0) + 1);
  const totalSessions = new Set(added.map((row) => row.anonymousSessionId)).size;

  const names = new Map(catalog.products.map((product) => [product.id, textsOf(product.translations, 'name')]));
  const dishes = classifyDishes(
    catalog.products.map((product) => ({
      productId: product.id,
      price: unitPrice(product, null, []).price,
      cost: unitPrice(product, null, []).cost,
      sessions: sessionsByDish.get(product.id) ?? 0,
    })),
  ).map((dish) => ({ ...dish, names: names.get(dish.productId) ?? {} }));

  const seen = await db.analyticsEvent.findMany({
    where: { ...window, type: { in: [...SHOWN, ...TAKEN] }, suggestionId: { not: null } },
    distinct: ['suggestionId', 'type', 'anonymousSessionId'],
    select: { suggestionId: true, type: true, anonymousSessionId: true },
  });
  const shown = new Map<SuggestionKind, Set<string>>(KINDS.map((kind) => [kind, new Set<string>()]));
  const accepted = new Map<SuggestionKind, Set<string>>(KINDS.map((kind) => [kind, new Set<string>()]));
  for (const row of seen) {
    const kind = kindOf(row.suggestionId!);
    if (!kind) continue;
    ((SHOWN as readonly string[]).includes(row.type) ? shown : accepted).get(kind)!.add(row.anonymousSessionId);
  }

  return {
    ...about,
    since: since.toISOString(),
    totalSessions,
    insightsAllowed,
    dishes,
    suggestions: KINDS.map((kind) => ({ kind, shown: shown.get(kind)!.size, accepted: accepted.get(kind)!.size })),
    advice,
  };
}
