import type { BrandConfig, Menu, Prisma } from '@/generated/prisma/client';
import { DEFAULT_PALETTES, sanitizePalette } from '@/lib/brand';
import { isLocale } from '@/lib/locale';
import { resolveRailStyle } from '@/lib/rail';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import type { BrandView } from '@/server/data/tenant';
import { delegates, type AnyDb, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import { resolveEngineConfig } from '@/server/domain/config';
import { buildSnapshot, snapshotHash, type MenuSnapshot, type SnapshotMenu } from '@/server/domain/snapshot';
import { draftMediaFromSnapshot, loadAssets, mediaAssetIds, resolveDraftMedia } from '@/server/media/resolve';
import { getStorage } from '@/server/storage/storage';

// ---------------------------------------------------------------------------------------------------------------------
// Reading the draft
// ---------------------------------------------------------------------------------------------------------------------

function seoMap(value: unknown): SnapshotMenu['seo'] {
  const seo: SnapshotMenu['seo'] = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return seo;
  for (const [locale, entry] of Object.entries(value)) {
    if (!isLocale(locale) || !entry || typeof entry !== 'object') continue;
    const { title, description } = entry as Record<string, unknown>;
    if (typeof title !== 'string' && typeof description !== 'string') continue;
    seo[locale] = {
      title: typeof title === 'string' ? title : '',
      description: typeof description === 'string' ? description : '',
    };
  }
  return seo;
}

function snapshotMenu(menu: Menu, displayName: string): SnapshotMenu {
  const locales = menu.locales.filter(isLocale);
  return {
    name: menu.name,
    displayName,
    currency: menu.currency,
    defaultLocale: isLocale(menu.defaultLocale) ? menu.defaultLocale : 'en',
    locales: locales.length > 0 ? locales : ['en'],
    timeZone: menu.timezone,
    numeralSystem: menu.numeralSystem === 'ARAB' ? 'arab' : 'latn',
    engineConfig: resolveEngineConfig(menu.engineConfig),
    seo: seoMap(menu.seo),
  };
}

/** The brand kit as guests get it. A menu without one gets the default palettes and its restaurant's name as logo. */
function brandView(brand: BrandConfig | null, displayName: string): BrandView {
  const tokens = (brand?.tokens ?? {}) as { dark?: unknown; light?: unknown };
  const motionIntensity =
    brand?.motionIntensity === 'none' || brand?.motionIntensity === 'expressive' ? brand.motionIntensity : 'subtle';
  return {
    logoText: brand?.logoText ?? displayName,
    theme: brand?.theme === 'LIGHT' ? 'light' : 'dark',
    motionIntensity,
    railStyle: resolveRailStyle(brand?.railStyle, motionIntensity),
    tokens: {
      dark: sanitizePalette(tokens.dark, DEFAULT_PALETTES.dark),
      light: sanitizePalette(tokens.light, DEFAULT_PALETTES.light),
    },
  };
}

/**
 * The menu as it would be published now: its settings, its restaurant's name (what guests see), its brand kit and its
 * draft catalog. Works on any client, including the transaction a publish runs in.
 */
export function loadDraftSnapshot(db: AnyDb, menuId: string): Promise<MenuSnapshot>;
export function loadDraftSnapshot(db: ScopedDb, menuId: string): Promise<MenuSnapshot>;
export async function loadDraftSnapshot(client: AnyDb | ScopedDb, menuId: string): Promise<MenuSnapshot> {
  const db = delegates(client);
  // One query at a time: inside a transaction they share one connection.
  const menu = await db.menu.findUniqueOrThrow({ where: { id: menuId }, include: { restaurant: { select: { name: true } } } });
  const brand = await db.brandConfig.findUnique({ where: { menuId } });
  const catalog = await loadDraftCatalog(db, menuId);
  const displayName = menu.restaurant.name;
  const settings = snapshotMenu(menu, displayName);

  // Library photos become the URLs guests load, so the revision never needs the library again.
  const assetIds = catalog.products.flatMap((product) => mediaAssetIds(product.media));
  if (assetIds.length > 0) {
    const assets = await loadAssets(db, menu.restaurantId, assetIds);
    const mediaUrl = (key: string) => getStorage().publicUrl(key);
    catalog.products = catalog.products.map((product) => ({
      ...product,
      media: resolveDraftMedia(product.media, assets, settings.defaultLocale, mediaUrl),
    }));
  }
  return buildSnapshot({ menu: settings, brand: brandView(brand, displayName), catalog });
}

/**
 * Recomputes the hash of the menu's draft and stores it as `Menu.draftHash`. Call it after every draft edit: the
 * Studio shows "unpublished changes" while it differs from `liveHash`.
 */
export function refreshDraftHash(db: AnyDb, menuId: string): Promise<string>;
export function refreshDraftHash(db: ScopedDb, menuId: string): Promise<string>;
export async function refreshDraftHash(client: AnyDb | ScopedDb, menuId: string): Promise<string> {
  const db = delegates(client);
  const hash = snapshotHash(await loadDraftSnapshot(db, menuId));
  await db.menu.update({ where: { id: menuId }, data: { draftHash: hash } });
  return hash;
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing a snapshot back as a draft
// ---------------------------------------------------------------------------------------------------------------------

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Looks up the new id for an old one; a reference the snapshot cannot resolve means the snapshot is corrupt. */
function remapped(ids: Map<string, string>, id: string, what: string): string {
  const next = ids.get(id);
  if (next === undefined) throw new Error(`Snapshot ${what} ${id} refers to something the snapshot does not contain`);
  return next;
}

/** The new id for an old one, `null` for `null`, or `undefined` when the snapshot does not contain it. */
function optional(ids: Map<string, string>, id: string | null): string | null | undefined {
  return id === null ? null : ids.get(id);
}

/** Old id to new id, for rows created from `before` and returned as `after`, matched by a key both sides share. */
function idMap<A extends { id: string }, B extends { id: string }>(
  before: A[],
  keyBefore: (row: A) => string,
  after: B[],
  keyAfter: (row: B) => string,
): Map<string, string> {
  const created = new Map(after.map((row) => [keyAfter(row), row.id]));
  return new Map(
    before.map((row) => {
      const id = created.get(keyBefore(row));
      if (id === undefined) throw new Error(`No row was created for ${keyBefore(row)}`);
      return [row.id, id];
    }),
  );
}

/**
 * Replaces a menu's draft catalog and brand kit with a snapshot's, in the caller's transaction. Every row is created
 * with a new id and every reference is remapped, so a snapshot can be written into its own menu (restore) or into
 * another one (duplicate). Products and options start available, shown and uncounted. Tables are left alone, and the
 * brand kit keeps what a snapshot does not carry (typography, navigation style). Finally the draft hash is refreshed.
 *
 * A snapshot taken from a draft rather than a publish can hold rules and bundles that refer to products outside it
 * (in a deactivated category, say); those are left out, since guests could never have been offered them. Any other
 * reference that does not resolve throws.
 */
export function writeDraftFromSnapshot(
  tx: AnyDb,
  menuId: string,
  snapshot: MenuSnapshot,
  assetMap?: ReadonlyMap<string, string>,
): Promise<void>;
export function writeDraftFromSnapshot(
  tx: ScopedTx,
  menuId: string,
  snapshot: MenuSnapshot,
  assetMap?: ReadonlyMap<string, string>,
): Promise<void>;
export async function writeDraftFromSnapshot(
  client: AnyDb | ScopedDb,
  menuId: string,
  snapshot: MenuSnapshot,
  assetMap?: ReadonlyMap<string, string>,
): Promise<void> {
  const tx = delegates(client);
  const { catalog, brand } = snapshot;
  const where = { menuId };

  // Children before parents, so nothing relies on a cascade.
  await tx.bundleItem.deleteMany({ where });
  await tx.bundle.deleteMany({ where });
  await tx.upsellRule.deleteMany({ where });
  await tx.pairingRule.deleteMany({ where });
  await tx.modifierOption.deleteMany({ where });
  await tx.modifierGroup.deleteMany({ where });
  await tx.productVariant.deleteMany({ where });
  await tx.product.deleteMany({ where });
  await tx.category.deleteMany({ where });
  await tx.daypartSchedule.deleteMany({ where });

  const brandFields = {
    tokens: json(brand.tokens),
    theme: brand.theme === 'light' ? ('LIGHT' as const) : ('DARK' as const),
    motionIntensity: brand.motionIntensity,
    railStyle: brand.railStyle,
    logoText: brand.logoText,
  };
  await tx.brandConfig.upsert({
    where: { menuId },
    create: { menuId, typography: {}, ...brandFields },
    update: brandFields,
  });

  const categories =
    catalog.categories.length === 0
      ? []
      : await tx.category.createManyAndReturn({
          data: catalog.categories.map((c) => ({
            menuId,
            slug: c.slug,
            sortOrder: c.sortOrder,
            translations: json(c.translations),
          })),
          select: { id: true, slug: true },
        });
  const categoryIds = idMap(catalog.categories, (c) => c.slug, categories, (c) => c.slug);

  const products =
    catalog.products.length === 0
      ? []
      : await tx.product.createManyAndReturn({
          data: catalog.products.map((p) => ({
            menuId,
            categoryId: remapped(categoryIds, p.categoryId, `product ${p.slug} category`),
            slug: p.slug,
            basePrice: p.basePrice,
            cost: p.cost,
            popularity: p.popularity,
            priority: p.priority,
            isSignature: p.isSignature,
            isFeatured: p.isFeatured,
            lowStockThreshold: p.lowStockThreshold,
            dayparts: p.dayparts,
            hideOutsideDaypart: p.hideOutsideDaypart,
            slot: p.slot,
            allergens: p.allergens,
            dietary: p.dietary,
            calories: p.calories,
            badges: p.badges,
            ingredients: json(p.ingredients),
            // Library photos go back to the assets they came from (copies of them, for another restaurant).
            media: json(draftMediaFromSnapshot(p.media, assetMap)),
            translations: json(p.translations),
            sortOrder: p.sortOrder,
          })),
          select: { id: true, slug: true },
        });
  const productIds = idMap(catalog.products, (p) => p.slug, products, (p) => p.slug);

  // Variants, groups and options keep their snapshot order as their sort order, which also identifies them below.
  const variants = catalog.products.flatMap((p) =>
    p.variants.map((v, index) => ({ old: v, productId: productIds.get(p.id)!, sortOrder: index })),
  );
  const createdVariants =
    variants.length === 0
      ? []
      : await tx.productVariant.createManyAndReturn({
          data: variants.map(({ old, productId, sortOrder }) => ({
            menuId,
            productId,
            priceDelta: old.priceDelta,
            costDelta: old.costDelta,
            isDefault: old.isDefault,
            translations: json(old.translations),
            sortOrder,
          })),
          select: { id: true, productId: true, sortOrder: true },
        });
  const variantIds = idMap(
    variants.map((v) => ({ id: v.old.id, key: `${v.productId}:${v.sortOrder}` })),
    (v) => v.key,
    createdVariants,
    (v) => `${v.productId}:${v.sortOrder}`,
  );

  const groups = catalog.products.flatMap((p) =>
    p.groups.map((g, index) => ({ old: g, productId: productIds.get(p.id)!, sortOrder: index })),
  );
  const createdGroups =
    groups.length === 0
      ? []
      : await tx.modifierGroup.createManyAndReturn({
          data: groups.map(({ old, productId, sortOrder }) => ({
            menuId,
            productId,
            minSelect: old.minSelect,
            maxSelect: old.maxSelect,
            translations: json(old.translations),
            sortOrder,
          })),
          select: { id: true, productId: true, sortOrder: true },
        });
  const groupIds = idMap(
    groups.map((g) => ({ id: g.old.id, key: `${g.productId}:${g.sortOrder}` })),
    (g) => g.key,
    createdGroups,
    (g) => `${g.productId}:${g.sortOrder}`,
  );

  const options = groups.flatMap(({ old }) =>
    old.options.map((o, index) => ({ old: o, groupId: groupIds.get(old.id)!, sortOrder: index })),
  );
  if (options.length > 0) {
    await tx.modifierOption.createMany({
      data: options.map(({ old, groupId, sortOrder }) => ({
        menuId,
        groupId,
        priceDelta: old.priceDelta,
        costDelta: old.costDelta,
        isSuggested: old.isSuggested,
        suggestPriority: old.suggestPriority,
        visualKey: old.visualKey,
        translations: json(old.translations),
        sortOrder,
      })),
    });
  }

  const upsellRules = catalog.upsellRules.flatMap((r) => {
    const sourceProductId = productIds.get(r.sourceProductId);
    const targetProductId = productIds.get(r.targetProductId);
    if (sourceProductId === undefined || targetProductId === undefined) return [];
    return [
      {
        menuId,
        sourceProductId,
        targetProductId,
        priority: r.priority,
        dayparts: r.dayparts,
        translations: json(r.translations),
      },
    ];
  });
  if (upsellRules.length > 0) await tx.upsellRule.createMany({ data: upsellRules });

  const pairingRules = catalog.pairingRules.flatMap((r) => {
    const sourceProductId = optional(productIds, r.sourceProductId);
    const sourceCategoryId = optional(categoryIds, r.sourceCategoryId);
    const targetProductId = productIds.get(r.targetProductId);
    if (sourceProductId === undefined || sourceCategoryId === undefined || targetProductId === undefined) return [];
    return [
      {
        menuId,
        sourceType: r.sourceType,
        sourceProductId,
        sourceCategoryId,
        targetProductId,
        weight: r.weight,
        dayparts: r.dayparts,
        translations: json(r.translations),
      },
    ];
  });
  if (pairingRules.length > 0) await tx.pairingRule.createMany({ data: pairingRules });

  // A bundle is written whole or not at all: one with an item the snapshot cannot resolve is left out.
  const bundles = catalog.bundles.flatMap((b) => {
    const items = b.items.map((item) => ({
      productId: productIds.get(item.productId),
      variantId: optional(variantIds, item.variantId),
      quantity: item.quantity,
    }));
    if (items.some((item) => item.productId === undefined || item.variantId === undefined)) return [];
    return [{ old: b, items: items as Array<{ productId: string; variantId: string | null; quantity: number }> }];
  });
  if (bundles.length > 0) {
    const createdBundles = await tx.bundle.createManyAndReturn({
      data: bundles.map(({ old }) => ({
        menuId,
        slug: old.slug,
        price: old.price,
        dayparts: old.dayparts,
        translations: json(old.translations),
      })),
      select: { id: true, slug: true },
    });
    const bundleIds = new Map(createdBundles.map((b) => [b.slug, b.id]));
    await tx.bundleItem.createMany({
      data: bundles.flatMap(({ old, items }) =>
        items.map((item) => ({ menuId, bundleId: remapped(bundleIds, old.slug, 'bundle'), ...item })),
      ),
    });
  }

  if (catalog.schedule.length > 0) {
    await tx.daypartSchedule.createMany({
      data: catalog.schedule.map((window) => ({
        menuId,
        daypart: window.daypart,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        daysOfWeek: window.daysOfWeek,
      })),
    });
  }

  await refreshDraftHash(tx, menuId);
}
