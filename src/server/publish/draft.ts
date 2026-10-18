import type { BrandConfig, Menu, Prisma } from '@/generated/prisma/client';
import { DEFAULT_PALETTES, sanitizePalette } from '@/lib/brand';
import { isLocale, type Locale } from '@/lib/locale';
import { DEFAULT_FONT_PAIR, isFontPairId } from '@/lib/font-pairs';
import { isRailStyle, resolveRailStyle } from '@/lib/rail';
import { loadDraftCatalog } from '@/server/data/catalog-loader';
import type { BrandFavicon, BrandImage, BrandView } from '@/server/data/tenant';
import { delegates, type AnyDb, type ScopedDb, type ScopedTx } from '@/server/data/tenant-db';
import { resolveEngineConfig } from '@/server/domain/config';
import { slotOf, type SnapshotMotion } from '@/server/domain/menu-motions';
import { buildSnapshot, snapshotHash, type MenuSnapshot, type SnapshotMenu } from '@/server/domain/snapshot';
import { assetImage, draftMediaFromSnapshot, loadAssets, mediaAssetIds, resolveDraftMedia, type ResolvableAsset } from '@/server/media/resolve';
import type { AssetVariants } from '@/server/media/process';
import { getStorage } from '@/server/storage/storage';

// ---------------------------------------------------------------------------------------------------------------------
// Reading the draft
// ---------------------------------------------------------------------------------------------------------------------

/** A language's search text as `Menu.seo` holds it: the image is a library asset, resolved when the snapshot is built. */
type DraftSeo = Partial<Record<Locale, { title: string; description: string; imageAssetId?: string }>>;

/** `Menu.seo` read defensively: languages with a title or a description, and the asset of their image. */
export function seoMap(value: unknown): DraftSeo {
  const seo: DraftSeo = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return seo;
  for (const [locale, entry] of Object.entries(value)) {
    if (!isLocale(locale) || !entry || typeof entry !== 'object') continue;
    const { title, description, imageAssetId } = entry as Record<string, unknown>;
    if (typeof title !== 'string' && typeof description !== 'string' && typeof imageAssetId !== 'string') continue;
    seo[locale] = {
      title: typeof title === 'string' ? title : '',
      description: typeof description === 'string' ? description : '',
      ...(typeof imageAssetId === 'string' && imageAssetId !== '' ? { imageAssetId } : {}),
    };
  }
  return seo;
}

/**
 * The search text guests' pages carry, each image resolved from the library. An image whose asset is gone (or is not
 * the restaurant's or shared) is left out: the title and description still apply.
 */
function resolveSeo(seo: DraftSeo, assets: ReadonlyMap<string, ResolvableAsset>, mediaUrl: (key: string) => string): SnapshotMenu['seo'] {
  const resolved: SnapshotMenu['seo'] = {};
  for (const [locale, entry] of Object.entries(seo) as Array<[Locale, NonNullable<DraftSeo[Locale]>]>) {
    const asset = entry.imageAssetId ? assets.get(entry.imageAssetId) : undefined;
    const image = asset ? assetImage(asset, mediaUrl) : null;
    resolved[locale] = {
      title: entry.title,
      description: entry.description,
      ...(image ? { image: { assetId: asset!.id, url: image.url, width: image.width, height: image.height } } : {}),
    };
  }
  return resolved;
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
    seo: {},
  };
}

/** The brand kit as guests get it. A menu without one gets the default palettes and its restaurant's name as logo. */
/** The library assets a brand kit names: its logos, and the asset its favicon is drawn from. */
function brandAssetIds(brand: BrandConfig | null): string[] {
  if (!brand) return [];
  const favicon = brand.faviconFromLogo ? brand.logoAssetId : brand.faviconAssetId;
  return [brand.logoAssetId, brand.logoDarkAssetId, favicon].filter((id): id is string => id !== null);
}

/** A logo as guests get it: where to load it, its size, and a raster rendition for drawing it on the server. */
function brandImage(asset: ResolvableAsset | undefined, mediaUrl: (key: string) => string): BrandImage | undefined {
  return asset ? { assetId: asset.id, ...assetImage(asset, mediaUrl) } : undefined;
}

/** The favicon PNGs of an asset: those rendered for it, or an icon file as it is. Nothing for an asset without them. */
function brandFavicon(asset: ResolvableAsset | undefined, mediaUrl: (key: string) => string): BrandFavicon | undefined {
  if (!asset) return undefined;
  const variants = asset.variants as unknown as AssetVariants;
  const keys = variants.favicon ?? (asset.kind === 'ICON' ? { '32': variants.original, '180': variants.original, '512': variants.original } : null);
  if (!keys) return undefined;
  return { assetId: asset.id, png32: mediaUrl(keys['32']), png180: mediaUrl(keys['180']), png512: mediaUrl(keys['512']) };
}

/**
 * The brand kit as guests get it. A menu without one gets the default palettes and its restaurant's name as logo. The
 * fields the 2b kit added are left out when unused (the classic pair, no logo), so such a menu hashes as before.
 */
function brandView(
  brand: BrandConfig | null,
  displayName: string,
  assets: ReadonlyMap<string, ResolvableAsset> = new Map(),
  mediaUrl: (key: string) => string = (key) => key,
): BrandView {
  const tokens = (brand?.tokens ?? {}) as { dark?: unknown; light?: unknown };
  const motionIntensity =
    brand?.motionIntensity === 'none' || brand?.motionIntensity === 'expressive' ? brand.motionIntensity : 'subtle';
  const view: BrandView = {
    logoText: brand?.logoText ?? displayName,
    theme: brand?.theme === 'LIGHT' ? 'light' : 'dark',
    motionIntensity,
    railStyle: resolveRailStyle(brand?.railStyle, motionIntensity),
    tokens: {
      dark: sanitizePalette(tokens.dark, DEFAULT_PALETTES.dark),
      light: sanitizePalette(tokens.light, DEFAULT_PALETTES.light),
    },
  };
  if (!brand) return view;
  if (isFontPairId(brand.fontPairId) && brand.fontPairId !== DEFAULT_FONT_PAIR) view.fontPairId = brand.fontPairId;
  // With motion off the rail is plain; the style the brand chose is kept, so turning motion back on brings it back.
  if (isRailStyle(brand.railStyle) && brand.railStyle !== view.railStyle) view.railChoice = brand.railStyle;
  const logo = brandImage(brand.logoAssetId ? assets.get(brand.logoAssetId) : undefined, mediaUrl);
  if (logo) view.logo = logo;
  const logoDark = brandImage(brand.logoDarkAssetId ? assets.get(brand.logoDarkAssetId) : undefined, mediaUrl);
  if (logoDark) view.logoDark = logoDark;
  const faviconId = brand.faviconFromLogo ? brand.logoAssetId : brand.faviconAssetId;
  const favicon = brandFavicon(faviconId ? assets.get(faviconId) : undefined, mediaUrl);
  if (favicon) view.favicon = favicon;
  return view;
}

/**
 * The `BrandConfig` fields a snapshot's brand kit is written back as (restoring a revision, duplicating a menu): the
 * rail style the brand chose, the pair, and the assets, through `assetMap` when they were copied to another library.
 * A favicon drawn from the logo is stored as just that.
 */
export function brandRowFromSnapshot(brand: BrandView, assetMap?: ReadonlyMap<string, string>) {
  const mapped = (id: string | undefined) => (id === undefined ? null : (assetMap?.get(id) ?? id));
  const fromLogo = brand.favicon !== undefined && brand.logo !== undefined && brand.favicon.assetId === brand.logo.assetId;
  return {
    tokens: json(brand.tokens),
    theme: brand.theme === 'light' ? ('LIGHT' as const) : ('DARK' as const),
    motionIntensity: brand.motionIntensity,
    railStyle: brand.railChoice ?? brand.railStyle,
    logoText: brand.logoText,
    fontPairId: brand.fontPairId ?? DEFAULT_FONT_PAIR,
    logoAssetId: mapped(brand.logo?.assetId),
    logoDarkAssetId: mapped(brand.logoDark?.assetId),
    faviconAssetId: fromLogo ? null : mapped(brand.favicon?.assetId),
    faviconFromLogo: fromLogo,
  };
}

/** A placement row as the snapshot's builder reads it: the place comes from the slot, which the service writes with it. */
function motionFromRow(row: { slot: string; categoryId: string | null; motionId: string; params: unknown; texts: unknown }) {
  const place = row.slot.startsWith('category:') ? 'category' : row.slot;
  return { place, ...(row.categoryId ? { categoryId: row.categoryId } : {}), motionId: row.motionId, params: row.params, texts: row.texts };
}

/**
 * A snapshot's motions as draft rows, each category mapped through `categoryIds` when given (a copy has new ones); a
 * motion whose category has no new id is left out.
 */
function motionRows(menuId: string, motions: readonly SnapshotMotion[] = [], categoryIds?: ReadonlyMap<string, string>) {
  return motions.flatMap((motion) => {
    const categoryId = motion.categoryId === undefined ? null : categoryIds ? categoryIds.get(motion.categoryId) : motion.categoryId;
    if (categoryId === undefined) return [];
    return [{ menuId, slot: slotOf(motion.place, categoryId), categoryId, motionId: motion.motionId, params: json(motion.params), texts: json(motion.texts) }];
  });
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
  const motions = await db.menuMotion.findMany({ where: { menuId }, select: { slot: true, categoryId: true, motionId: true, params: true, texts: true } });
  const displayName = menu.restaurant.name;
  const settings = snapshotMenu(menu, displayName);

  // Library photos become the URLs guests load, so the revision never needs the library again.
  const seo = seoMap(menu.seo);
  const productAssets = catalog.products.flatMap((product) => mediaAssetIds(product.media));
  const seoAssets = Object.values(seo).flatMap((entry) => (entry?.imageAssetId ? [entry.imageAssetId] : []));
  const brandAssets = brandAssetIds(brand);
  if (productAssets.length + seoAssets.length + brandAssets.length === 0) {
    settings.seo = resolveSeo(seo, new Map(), (key) => key);
    return buildSnapshot({ menu: settings, brand: brandView(brand, displayName), catalog, motions: motions.map(motionFromRow) });
  }
  const assets = await loadAssets(db, menu.restaurantId, [...productAssets, ...seoAssets, ...brandAssets]);
  const mediaUrl = (key: string) => getStorage().publicUrl(key);
  catalog.products = catalog.products.map((product) => ({
    ...product,
    media: resolveDraftMedia(product.media, assets, settings.defaultLocale, mediaUrl),
  }));
  settings.seo = resolveSeo(seo, assets, mediaUrl);
  return buildSnapshot({ menu: settings, brand: brandView(brand, displayName, assets, mediaUrl), catalog, motions: motions.map(motionFromRow) });
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
 * Replaces a menu's draft catalog, brand kit and motions with a snapshot's, in the caller's transaction. Every row is created
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
  await tx.menuMotion.deleteMany({ where });
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

  // The kit's version moves, so a Brand tab opened before cannot save over what was written.
  const brandFields = brandRowFromSnapshot(brand, assetMap);
  await tx.brandConfig.upsert({
    where: { menuId },
    create: { menuId, typography: {}, ...brandFields },
    update: { ...brandFields, version: { increment: 1 } },
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
  const motions = motionRows(menuId, snapshot.motions, categoryIds);
  if (motions.length > 0) await tx.menuMotion.createMany({ data: motions });

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

// ---------------------------------------------------------------------------------------------------------------------
// Restoring a revision into the draft
// ---------------------------------------------------------------------------------------------------------------------

/** The next version of a row that existed (its old version plus one), or 1 for a row the restore brings back. */
const nextVersion = (versions: ReadonlyMap<string, number>, id: string) => (versions.get(id) ?? 0) + 1;

/**
 * Makes a revision the draft again (2a follow-ups 1 and 3): every catalog row is recreated with the snapshot's own ids,
 * so the draft's hash is the revision's and links to products keep working. What guests see changing live stays as it
 * is now: a product that was sold out or hidden, its stock, an option sold out. Every version moves on (a row the
 * revision brings back starts at 1), so an editor opened before cannot save over the restore. The menu's settings
 * and motions that the snapshot holds come back; its tables, name, slug, notes and rounding step do not.
 */
export function restoreDraftFromSnapshot(db: AnyDb, menuId: string, snapshot: MenuSnapshot): Promise<void>;
export function restoreDraftFromSnapshot(db: ScopedTx, menuId: string, snapshot: MenuSnapshot): Promise<void>;
export async function restoreDraftFromSnapshot(client: AnyDb | ScopedDb, menuId: string, snapshot: MenuSnapshot): Promise<void> {
  const tx = delegates(client);
  const { catalog, brand, menu } = snapshot;
  const where = { menuId };

  // What is live now and how far each row's version has come, read before the rows go.
  const products = await tx.product.findMany({ where, select: { id: true, version: true, isAvailable: true, isHidden: true, stockCount: true } });
  const options = await tx.modifierOption.findMany({ where, select: { id: true, version: true, isAvailable: true } });
  const categories = await tx.category.findMany({ where, select: { id: true, version: true } });
  const variantRows = await tx.productVariant.findMany({ where, select: { id: true, version: true } });
  const groupRows = await tx.modifierGroup.findMany({ where, select: { id: true, version: true } });
  const versions = new Map<string, number>(
    [...products, ...options, ...categories, ...variantRows, ...groupRows].map((row) => [row.id, row.version] as const),
  );
  const productLive = new Map(products.map((row) => [row.id, row]));
  const optionLive = new Map(options.map((row) => [row.id, row.isAvailable]));

  // Children before parents, so nothing relies on a cascade.
  await tx.menuMotion.deleteMany({ where });
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

  if (catalog.categories.length > 0) {
    await tx.category.createMany({
      data: catalog.categories.map((c) => ({
        id: c.id,
        menuId,
        slug: c.slug,
        sortOrder: c.sortOrder,
        translations: json(c.translations),
        version: nextVersion(versions, c.id),
      })),
    });
  }
  if (catalog.products.length > 0) {
    await tx.product.createMany({
      data: catalog.products.map((p) => {
        const live = productLive.get(p.id);
        return {
          id: p.id,
          menuId,
          categoryId: p.categoryId,
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
          media: json(draftMediaFromSnapshot(p.media)),
          translations: json(p.translations),
          sortOrder: p.sortOrder,
          isAvailable: live?.isAvailable ?? true,
          isHidden: live?.isHidden ?? false,
          stockCount: live?.stockCount ?? null,
          version: nextVersion(versions, p.id),
        };
      }),
    });
  }
  const variants = catalog.products.flatMap((p) => p.variants.map((v, index) => ({ v, productId: p.id, sortOrder: index })));
  if (variants.length > 0) {
    await tx.productVariant.createMany({
      data: variants.map(({ v, productId, sortOrder }) => ({
        id: v.id,
        menuId,
        productId,
        priceDelta: v.priceDelta,
        costDelta: v.costDelta,
        isDefault: v.isDefault,
        translations: json(v.translations),
        sortOrder,
        version: nextVersion(versions, v.id),
      })),
    });
  }
  const groups = catalog.products.flatMap((p) => p.groups.map((g, index) => ({ g, productId: p.id, sortOrder: index })));
  if (groups.length > 0) {
    await tx.modifierGroup.createMany({
      data: groups.map(({ g, productId, sortOrder }) => ({
        id: g.id,
        menuId,
        productId,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        translations: json(g.translations),
        sortOrder,
        version: nextVersion(versions, g.id),
      })),
    });
  }
  const optionRows = groups.flatMap(({ g }) => g.options.map((o, index) => ({ o, groupId: g.id, sortOrder: index })));
  if (optionRows.length > 0) {
    await tx.modifierOption.createMany({
      data: optionRows.map(({ o, groupId, sortOrder }) => ({
        id: o.id,
        menuId,
        groupId,
        priceDelta: o.priceDelta,
        costDelta: o.costDelta,
        isSuggested: o.isSuggested,
        suggestPriority: o.suggestPriority,
        visualKey: o.visualKey,
        translations: json(o.translations),
        sortOrder,
        isAvailable: optionLive.get(o.id) ?? true,
        version: nextVersion(versions, o.id),
      })),
    });
  }
  if (catalog.upsellRules.length > 0) {
    await tx.upsellRule.createMany({
      data: catalog.upsellRules.map((r) => ({
        id: r.id,
        menuId,
        sourceProductId: r.sourceProductId,
        targetProductId: r.targetProductId,
        priority: r.priority,
        dayparts: r.dayparts,
        translations: json(r.translations),
      })),
    });
  }
  if (catalog.pairingRules.length > 0) {
    await tx.pairingRule.createMany({
      data: catalog.pairingRules.map((r) => ({
        id: r.id,
        menuId,
        sourceType: r.sourceType,
        sourceProductId: r.sourceProductId,
        sourceCategoryId: r.sourceCategoryId,
        targetProductId: r.targetProductId,
        weight: r.weight,
        dayparts: r.dayparts,
        translations: json(r.translations),
      })),
    });
  }
  if (catalog.bundles.length > 0) {
    await tx.bundle.createMany({
      data: catalog.bundles.map((b) => ({ id: b.id, menuId, slug: b.slug, price: b.price, dayparts: b.dayparts, translations: json(b.translations) })),
    });
    await tx.bundleItem.createMany({
      data: catalog.bundles.flatMap((b) => b.items.map((item) => ({ menuId, bundleId: b.id, ...item }))),
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

  const motions = motionRows(menuId, snapshot.motions);
  if (motions.length > 0) await tx.menuMotion.createMany({ data: motions });

  const brandFields = brandRowFromSnapshot(brand);
  await tx.brandConfig.upsert({
    where: { menuId },
    create: { menuId, typography: {}, ...brandFields },
    update: { ...brandFields, version: { increment: 1 } },
  });

  // The settings the snapshot holds; the search images go back to their assets.
  const seo: Record<string, { title: string; description: string; imageAssetId?: string }> = {};
  for (const [locale, entry] of Object.entries(menu.seo)) {
    if (entry) seo[locale] = { title: entry.title, description: entry.description, ...(entry.image ? { imageAssetId: entry.image.assetId } : {}) };
  }
  await tx.menu.update({
    where: { id: menuId },
    data: {
      currency: menu.currency,
      defaultLocale: menu.defaultLocale,
      locales: menu.locales,
      timezone: menu.timeZone,
      numeralSystem: menu.numeralSystem === 'arab' ? 'ARAB' : 'LATN',
      engineConfig: json(menu.engineConfig),
      seo: json(seo),
      version: { increment: 1 },
    },
  });

  await refreshDraftHash(tx, menuId);
}
