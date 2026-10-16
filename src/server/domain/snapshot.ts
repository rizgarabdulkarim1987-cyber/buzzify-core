import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RAIL_STYLES } from '@/lib/rail';
import type { BrandView } from '@/server/data/tenant';
import type { EngineConfig } from './config';
import {
  DAYPARTS,
  LOCALES,
  type Catalog,
  type CatalogGroup,
  type CatalogOption,
  type CatalogProduct,
  type Locale,
} from './types';

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** The settings of a menu that guests see through, frozen at publish. */
export interface SnapshotMenu {
  /** The menu's own name. */
  name: string;
  /** The name guests see. */
  displayName: string;
  currency: string;
  defaultLocale: Locale;
  locales: Locale[];
  timeZone: string;
  numeralSystem: 'latn' | 'arab';
  engineConfig: EngineConfig;
  seo: Partial<Record<Locale, { title: string; description: string }>>;
}

/** An option as published: its availability is live, so it is not part of what publishing freezes. */
export type SnapshotOption = Omit<CatalogOption, 'isAvailable'>;

export interface SnapshotGroup extends Omit<CatalogGroup, 'options'> {
  options: SnapshotOption[];
}

/** A product as published: whether it is available, hidden or in stock changes without a publish. */
export type SnapshotProduct = Omit<CatalogProduct, 'isAvailable' | 'isHidden' | 'stockCount' | 'groups'> & {
  groups: SnapshotGroup[];
};

export type SnapshotCatalog = Omit<Catalog, 'menuId' | 'products'> & { products: SnapshotProduct[] };

export interface MenuSnapshot {
  schemaVersion: 1;
  menu: SnapshotMenu;
  brand: BrandView;
  catalog: SnapshotCatalog;
}

/** What changes without a publish: sold-out and hidden products, stock, and sold-out options. */
export interface LiveOverlay {
  products: Record<string, { isAvailable: boolean; isHidden: boolean; stockCount: number | null }>;
  options: Record<string, { isAvailable: boolean }>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------

const locale = z.enum(LOCALES);
const daypart = z.enum(DAYPARTS);
const translations = z.partialRecord(locale, z.record(z.string(), z.string()));
const nullableNumber = z.number().nullable();

const palette = z.object({
  bg: z.string(),
  surface: z.string(),
  raised: z.string(),
  accent: z.string(),
  text: z.string(),
  muted: z.string(),
  line: z.string(),
  onAccent: z.string(),
});

const engineConfig = z.object({
  upsellMaxOffers: z.number(),
  upsellDeltaCapRatio: z.number(),
  pairingMaxOffers: z.number(),
  cartPairingMaxOffers: z.number(),
  weights: z.object({
    rulePriority: z.number(),
    margin: z.number(),
    popularity: z.number(),
    priority: z.number(),
    daypart: z.number(),
    stockPenalty: z.number(),
  }),
});

const snapshotMenu = z.object({
  name: z.string(),
  displayName: z.string(),
  currency: z.string(),
  defaultLocale: locale,
  locales: z.array(locale),
  timeZone: z.string(),
  numeralSystem: z.enum(['latn', 'arab']),
  engineConfig,
  seo: z.partialRecord(locale, z.object({ title: z.string(), description: z.string() })),
});

const brandView = z.object({
  logoText: z.string(),
  theme: z.enum(['dark', 'light']),
  motionIntensity: z.enum(['none', 'subtle', 'expressive']),
  railStyle: z.enum(RAIL_STYLES),
  tokens: z.object({ dark: palette, light: palette }),
});

const snapshotOption = z.object({
  id: z.string(),
  groupId: z.string(),
  priceDelta: z.number(),
  costDelta: nullableNumber,
  isSuggested: z.boolean(),
  suggestPriority: z.number(),
  visualKey: z.enum(['cheese', 'patty', 'bacon']).nullable(),
  translations,
});

const snapshotGroup = z.object({
  id: z.string(),
  productId: z.string(),
  minSelect: z.number(),
  maxSelect: z.number(),
  translations,
  options: z.array(snapshotOption),
});

const snapshotVariant = z.object({
  id: z.string(),
  productId: z.string(),
  priceDelta: z.number(),
  costDelta: nullableNumber,
  isDefault: z.boolean(),
  translations,
});

const snapshotProduct = z.object({
  id: z.string(),
  categoryId: z.string(),
  slug: z.string(),
  basePrice: z.number(),
  cost: nullableNumber,
  popularity: z.number(),
  priority: z.number(),
  isSignature: z.boolean(),
  isFeatured: z.boolean(),
  lowStockThreshold: nullableNumber,
  dayparts: z.array(daypart),
  hideOutsideDaypart: z.boolean(),
  slot: z.string().nullable(),
  translations,
  groups: z.array(snapshotGroup),
  variants: z.array(snapshotVariant),
  media: z.array(z.unknown()),
  allergens: z.array(z.string()),
  dietary: z.array(z.string()),
  calories: nullableNumber,
  badges: z.array(z.string()),
  ingredients: z.partialRecord(locale, z.array(z.string())),
  sortOrder: z.number(),
});

const snapshotCatalog = z.object({
  currency: z.string(),
  timeZone: z.string(),
  defaultLocale: locale,
  categories: z.array(z.object({ id: z.string(), slug: z.string(), sortOrder: z.number(), translations })),
  products: z.array(snapshotProduct),
  upsellRules: z.array(
    z.object({
      id: z.string(),
      sourceProductId: z.string(),
      targetProductId: z.string(),
      priority: z.number(),
      dayparts: z.array(daypart),
      translations,
    }),
  ),
  pairingRules: z.array(
    z.object({
      id: z.string(),
      sourceType: z.enum(['PRODUCT', 'CATEGORY']),
      sourceProductId: z.string().nullable(),
      sourceCategoryId: z.string().nullable(),
      targetProductId: z.string(),
      weight: z.number(),
      dayparts: z.array(daypart),
      translations,
    }),
  ),
  bundles: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      price: z.number(),
      dayparts: z.array(daypart),
      translations,
      items: z.array(z.object({ productId: z.string(), variantId: z.string().nullable(), quantity: z.number() })),
    }),
  ),
  schedule: z.array(
    z.object({ daypart, startMinute: z.number(), endMinute: z.number(), daysOfWeek: z.number() }),
  ),
});

const snapshotSchema: z.ZodType<MenuSnapshot> = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  menu: snapshotMenu,
  brand: brandView,
  catalog: snapshotCatalog,
});

/** Reads a stored snapshot. A snapshot of a version this code does not know is refused, never guessed at. */
export function parseSnapshot(json: unknown): MenuSnapshot {
  const version = typeof json === 'object' && json !== null ? (json as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== SNAPSHOT_SCHEMA_VERSION) throw new Error(`Unsupported snapshot schema version ${String(version)}`);
  return snapshotSchema.parse(json);
}

// ---------------------------------------------------------------------------------------------------------------------
// Building and hashing
// ---------------------------------------------------------------------------------------------------------------------

/** Code-unit order, so the same rows sort the same way on every machine and locale. */
function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const bySortOrderThenId = <T extends { sortOrder: number; id: string }>(a: T, b: T) =>
  compare(a.sortOrder, b.sortOrder) || compare(a.id, b.id);

const byId = <T extends { id: string }>(a: T, b: T) => compare(a.id, b.id);

function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

function freezeProduct(product: CatalogProduct): SnapshotProduct {
  const frozen = omit(product, 'isAvailable', 'isHidden', 'stockCount');
  return {
    ...frozen,
    groups: product.groups.map((group) => ({
      ...group,
      options: group.options.map((option): SnapshotOption => omit(option, 'isAvailable')),
    })),
  };
}

/**
 * Freezes a draft into the form publishing stores: the live fields (availability, hidden, stock) are dropped and every
 * list gets a fixed order, so the same menu always hashes the same. Categories and products go by sort order, then id;
 * rules by id; bundles by slug, then id; the schedule by start. Variants, groups and options have no sort order of their
 * own in the catalog (the loader already puts them in the editor's order), so they keep the order they came in.
 */
export function buildSnapshot(input: { menu: SnapshotMenu; brand: BrandView; catalog: Catalog }): MenuSnapshot {
  const { catalog } = input;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    menu: input.menu,
    brand: input.brand,
    catalog: {
      currency: catalog.currency,
      timeZone: catalog.timeZone,
      defaultLocale: catalog.defaultLocale,
      categories: [...catalog.categories].sort(bySortOrderThenId),
      products: [...catalog.products].sort(bySortOrderThenId).map(freezeProduct),
      upsellRules: [...catalog.upsellRules].sort(byId),
      pairingRules: [...catalog.pairingRules].sort(byId),
      bundles: [...catalog.bundles].sort((a, b) => compare(a.slug, b.slug) || compare(a.id, b.id)),
      schedule: [...catalog.schedule].sort(
        (a, b) => compare(a.startMinute, b.startMinute) || compare(a.daypart, b.daypart),
      ),
    },
  };
}

/** JSON with every object's keys in order, so equal data is equal text however it was assembled. */
function canonicalJson(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry) ?? 'null').join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort(compare)) {
      const entry = canonicalJson((value as Record<string, unknown>)[key]);
      if (entry !== undefined) parts.push(`${JSON.stringify(key)}:${entry}`);
    }
    return `{${parts.join(',')}}`;
  }
  // Like JSON.stringify, an undefined value leaves an object key out and becomes null in an array.
  return JSON.stringify(value) as string | undefined;
}

export function snapshotHash(snapshot: MenuSnapshot): string {
  return createHash('sha256')
    .update(canonicalJson(snapshot) ?? 'null')
    .digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading back
// ---------------------------------------------------------------------------------------------------------------------

const LIVE_DEFAULT = { isAvailable: true, isHidden: false, stockCount: null } as const;

/**
 * The catalog guests are served: the frozen snapshot with today's live state laid over it. Ids the overlay does not
 * mention are available, not hidden and not counted. A hidden product is removed along with every bundle that contains
 * it and every rule that has it as its source or its target.
 */
export function toCatalog(menuId: string, snapshot: MenuSnapshot, overlay: LiveOverlay): Catalog {
  const { catalog } = snapshot;
  const live = (id: string) => overlay.products[id] ?? LIVE_DEFAULT;

  const hidden = new Set(catalog.products.filter((p) => live(p.id).isHidden).map((p) => p.id));
  const isShown = (productId: string) => !hidden.has(productId);

  return {
    menuId,
    currency: catalog.currency,
    timeZone: catalog.timeZone,
    defaultLocale: catalog.defaultLocale,
    categories: catalog.categories,
    products: catalog.products
      .filter((p) => isShown(p.id))
      .map<CatalogProduct>((p) => {
        const { isAvailable, isHidden, stockCount } = live(p.id);
        return {
          ...p,
          isAvailable,
          isHidden,
          stockCount,
          groups: p.groups.map((group) => ({
            ...group,
            options: group.options.map((o) => ({ ...o, isAvailable: overlay.options[o.id]?.isAvailable ?? true })),
          })),
        };
      }),
    upsellRules: catalog.upsellRules.filter((rule) => isShown(rule.sourceProductId) && isShown(rule.targetProductId)),
    pairingRules: catalog.pairingRules.filter(
      (rule) => isShown(rule.targetProductId) && (rule.sourceProductId === null || isShown(rule.sourceProductId)),
    ),
    bundles: catalog.bundles.filter((bundle) => bundle.items.every((item) => isShown(item.productId))),
    schedule: catalog.schedule,
  };
}
