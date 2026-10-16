import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_PALETTES } from '@/lib/brand';
import type { ArtKind } from '@/lib/media';
import { resolveRailStyle } from '@/lib/rail';
import type { BrandView } from '@/server/data/tenant';
import { resolveEngineConfig } from '@/server/domain/config';
import { validateForPublish } from '@/server/domain/publish-rules';
import { buildSnapshot, SNAPSHOT_SCHEMA_VERSION, snapshotHash, type MenuSnapshot } from '@/server/domain/snapshot';
import { LOCALES, type Catalog, type CatalogProduct, type TranslationMap } from '@/server/domain/types';
import { createId } from '@/server/studio/framework/ids';

/**
 * The load seed: a platform the size the Studio's lists have to stay fast at, 1,000 restaurants with a published menu
 * each (and 20,000 audit rows over them). It is for measuring, not for looking at: every menu is the same five products.
 * `npm run db:seed:load` runs it against the development database; `tests/load/studio-lists.load.ts` against the test one.
 */

/** Restaurants are spread over these, so the city filter and the cities it offers have something to do. */
export const LOAD_CITIES = ['Baghdad', 'Erbil', 'Duhok', 'Sulaymaniyah', 'Basra', 'Mosul', 'Kirkuk', 'Najaf'] as const;

/** Two restaurants have Arabic names, for the search tests: their numbers, and the names. */
export const LOAD_ARABIC_NAMES: ReadonlyMap<number, string> = new Map([
  [3, 'مطعم مازو'],
  [4, 'مقهى الربيع'],
]);

/** Every nth menu has changes made since it was published, so the "unpublished changes" filter has rows. */
export const LOAD_UNPUBLISHED_EVERY = 10;

const BATCH_SIZE = 50;
const AUDIT_BATCH_SIZE = 1000;
const AUDIT_ROWS_PER_MENU = 20;
const MINUTE_MS = 60_000;

/** The slug prefix and the restaurant name prefix that mark what this seed made (and so what it removes before it runs). */
const SLUG_PREFIX = 'load-';
const NAME_PREFIX = 'Load Test';

/** A number as the four digits the names and slugs use: `0007`. */
const tag = (n: number) => String(n).padStart(4, '0');

export const loadSlug = (n: number) => `${SLUG_PREFIX}${tag(n)}`;
export const loadRestaurantName = (n: number) => LOAD_ARABIC_NAMES.get(n) ?? `${NAME_PREFIX} ${tag(n)}`;

type Tri = Record<(typeof LOCALES)[number], string>;

/** The one catalog every load menu has: a category and five products, named in all three languages. */
const SHAPE: {
  category: { slug: string; name: Tri };
  products: Array<{ slug: string; price: number; cost: number; art: ArtKind; tone: string; name: Tri; description: Tri }>;
} = {
  category: { slug: 'favourites', name: { en: 'Favourites', ar: 'المفضلة', ckb: 'دڵخوازەکان' } },
  products: [
    {
      slug: 'espresso',
      price: 2500,
      cost: 900,
      art: 'cup',
      tone: '#6B4423',
      name: { en: 'Espresso', ar: 'إسبريسو', ckb: 'ئێسپرێسۆ' },
      description: { en: 'A short, strong shot', ar: 'جرعة قصيرة وقوية', ckb: 'قومێکی کورت و بەهێز' },
    },
    {
      slug: 'latte',
      price: 4000,
      cost: 1400,
      art: 'cup',
      tone: '#B08D6A',
      name: { en: 'Latte', ar: 'لاتيه', ckb: 'لاتێ' },
      description: { en: 'Espresso with steamed milk', ar: 'إسبريسو مع حليب مبخر', ckb: 'ئێسپرێسۆ لەگەڵ شیری هەڵمکراو' },
    },
    {
      slug: 'black-tea',
      price: 1500,
      cost: 400,
      art: 'glass',
      tone: '#9A3B1E',
      name: { en: 'Black tea', ar: 'شاي أسود', ckb: 'چای ڕەش' },
      description: { en: 'Strong tea in a small glass', ar: 'شاي قوي في كأس صغير', ckb: 'چایەکی بەهێز لە پەرداخێکی بچووک' },
    },
    {
      slug: 'croissant',
      price: 3000,
      cost: 1100,
      art: 'pastry',
      tone: '#D4A24C',
      name: { en: 'Croissant', ar: 'كرواسان', ckb: 'کرواسان' },
      description: { en: 'Buttery, baked this morning', ar: 'بالزبدة ومخبوز هذا الصباح', ckb: 'بە کەرە و ئەمڕۆ بەیانی برژاوە' },
    },
    {
      slug: 'cheesecake',
      price: 6000,
      cost: 2200,
      art: 'plate',
      tone: '#C9A98B',
      name: { en: 'Cheesecake', ar: 'تشيز كيك', ckb: 'چیزکەیک' },
      description: { en: 'Baked cheesecake with berries', ar: 'تشيز كيك مخبوز مع التوت', ckb: 'چیزکەیکی برژاو لەگەڵ توو' },
    },
  ],
};

/** Every audit row a load menu gets cycles through these: what the Studio really writes, with the kind of row it names. */
const AUDIT_CYCLE = [
  ['menu.created', 'Menu'],
  ['menu.published', 'Menu'],
  ['menu.status_changed', 'MenuStatus'],
  ['menu.published', 'Menu'],
  ['restaurant.updated', 'Restaurant'],
  ['menu.slug_changed', 'Menu'],
  ['menu.published', 'Menu'],
  ['branch.updated', 'Branch'],
  ['menu.status_changed', 'MenuStatus'],
  ['menu.published', 'Menu'],
] as const;

const json = (value: unknown) => value as Prisma.InputJsonValue;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function translations(tri: Tri, field: string): TranslationMap {
  const out: TranslationMap = {};
  for (const locale of LOCALES) out[locale] = { [field]: tri[locale] };
  return out;
}

/** The brand kit every load menu has, as guests get it (`brandView` in the draft loader reads the same rows). */
function brandFor(logoText: string): BrandView {
  return {
    logoText,
    theme: 'dark',
    motionIntensity: 'subtle',
    railStyle: resolveRailStyle('grains', 'subtle'),
    tokens: { dark: { ...DEFAULT_PALETTES.dark }, light: { ...DEFAULT_PALETTES.light } },
  };
}

/** The catalog of one load menu: the shared shape under this menu's own ids. */
function catalogFor(menuId: string): Catalog {
  const categoryId = createId();
  const products = SHAPE.products.map<CatalogProduct>((product, index) => ({
    id: createId(),
    categoryId,
    slug: product.slug,
    basePrice: product.price,
    cost: product.cost,
    popularity: 50,
    priority: 50,
    isSignature: false,
    isFeatured: false,
    isAvailable: true,
    isHidden: false,
    stockCount: null,
    lowStockThreshold: null,
    dayparts: [],
    hideOutsideDaypart: false,
    slot: null,
    translations: {
      en: { name: product.name.en, description: product.description.en },
      ar: { name: product.name.ar, description: product.description.ar },
      ckb: { name: product.name.ckb, description: product.description.ckb },
    },
    groups: [],
    variants: [],
    media: [{ kind: 'art', art: product.art, tone: product.tone }],
    allergens: [],
    dietary: [],
    calories: null,
    badges: [],
    ingredients: {},
    sortOrder: index,
  }));
  return {
    menuId,
    currency: 'IQD',
    timeZone: 'Asia/Baghdad',
    defaultLocale: 'en',
    categories: [{ id: categoryId, slug: SHAPE.category.slug, sortOrder: 0, translations: translations(SHAPE.category.name, 'name') }],
    products,
    upsellRules: [],
    pairingRules: [],
    bundles: [],
    schedule: [],
  };
}

/** The snapshot publishing would freeze for a load menu: the same one `loadDraftSnapshot` reads back from its rows. */
function snapshotFor(name: string, catalog: Catalog): MenuSnapshot {
  return buildSnapshot({
    menu: {
      name,
      displayName: name,
      currency: catalog.currency,
      defaultLocale: 'en',
      locales: [...LOCALES],
      timeZone: catalog.timeZone,
      numeralSystem: 'latn',
      engineConfig: resolveEngineConfig({}),
      seo: {},
    },
    brand: brandFor(name),
    catalog,
  });
}

/**
 * Removes what an earlier run made: the menus whose slug starts with `load-` (their catalogs, revisions and brand go
 * with them), those slugs' reserved rows, the audit rows that name them, and the restaurants called `Load Test ...` or
 * that held only load menus. A restaurant that still has a menu of any other kind stays.
 */
async function clearLoadData(prisma: PrismaClient): Promise<void> {
  const menus = await prisma.menu.findMany({ where: { slug: { startsWith: SLUG_PREFIX } }, select: { id: true, restaurantId: true } });
  const menuIds = menus.map((menu) => menu.id);
  const ownerIds = [...new Set(menus.map((menu) => menu.restaurantId))];

  for (const ids of chunks(menuIds, 500)) {
    await prisma.auditLog.deleteMany({ where: { menuId: { in: ids } } });
    await prisma.menu.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.menuSlug.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });

  // Restaurants last: a menu holds its restaurant. The audit log names them by id, so its rows go first.
  const restaurants = await prisma.restaurant.findMany({
    where: { OR: [{ name: { startsWith: NAME_PREFIX } }, { id: { in: ownerIds } }], menus: { none: {} } },
    select: { id: true },
  });
  for (const ids of chunks(restaurants.map((restaurant) => restaurant.id), 500)) {
    await prisma.auditLog.deleteMany({ where: { restaurantId: { in: ids } } });
    await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
  }
}

export interface LoadSeedResult {
  restaurants: number;
  menus: number;
  auditRows: number;
}

/**
 * Seeds `count` restaurants, `Load Test 0001` and on, each with one published menu `load-0001` and on. A menu has one
 * category and five products in English, Arabic and Kurdish, a brand kit, its reserved slug and revision 1, so a guest
 * opens it through the normal read path. Every {@link LOAD_UNPUBLISHED_EVERY}th menu has changes since that publish.
 * Each menu also gets 20 audit rows, spread over about three months.
 *
 * Idempotent: what an earlier run made is removed first. Rows go in with `createMany`, 50 menus to a transaction, and
 * the revision is built once from the shared catalog shape rather than by publishing a thousand times (`publishMenu`
 * reads the whole draft back and takes a lock per menu): its snapshot and hash are exactly what a publish would store.
 */
export async function seedLoad(prisma: PrismaClient, count = 1000): Promise<LoadSeedResult> {
  await clearLoadData(prisma);

  const now = Date.now();
  const refs: Array<{ menuId: string; restaurantId: string }> = [];
  let first = true;

  for (let start = 1; start <= count; start += BATCH_SIZE) {
    const numbers = Array.from({ length: Math.min(BATCH_SIZE, count - start + 1) }, (_, i) => start + i);
    const built = numbers.map((n) => {
      const restaurantId = createId();
      const menuId = createId();
      const name = loadRestaurantName(n);
      const slug = loadSlug(n);
      const catalog = catalogFor(menuId);
      const snapshot = snapshotFor(name, catalog);
      if (first) {
        // The shape is checked once: a catalog a publish would refuse is no use as a load menu.
        const blocking = validateForPublish(snapshot).filter((issue) => issue.severity === 'block');
        if (blocking.length > 0) throw new Error(`The load menu cannot be published: ${JSON.stringify(blocking)}`);
        first = false;
      }
      const liveHash = snapshotHash(snapshot);
      const createdAt = new Date(now - (count - n) * 60 * MINUTE_MS);
      return { n, restaurantId, menuId, name, slug, catalog, snapshot, liveHash, createdAt, revisionId: createId() };
    });

    await prisma.$transaction([
      prisma.restaurant.createMany({
        data: built.map((b) => ({
          id: b.restaurantId,
          name: b.name,
          type: b.n % 2 === 1 ? 'RESTAURANT' : 'CAFE',
          city: LOAD_CITIES[(b.n - 1) % LOAD_CITIES.length]!,
          country: 'Iraq',
          createdAt: b.createdAt,
        })),
      }),
      prisma.menu.createMany({
        data: built.map((b) => ({
          id: b.menuId,
          restaurantId: b.restaurantId,
          name: b.name,
          slug: b.slug,
          status: 'PUBLISHED' as const,
          currency: b.catalog.currency,
          defaultLocale: 'en',
          locales: [...LOCALES],
          timezone: b.catalog.timeZone,
          createdAt: b.createdAt,
        })),
      }),
      prisma.menuSlug.createMany({ data: built.map((b) => ({ slug: b.slug, menuId: b.menuId })) }),
      prisma.brandConfig.createMany({
        data: built.map((b) => ({
          menuId: b.menuId,
          tokens: json(DEFAULT_PALETTES),
          typography: json({ display: 'Bodoni Moda', text: 'Hanken Grotesk', arabic: 'Noto Naskh Arabic' }),
          theme: 'DARK' as const,
          motionIntensity: 'subtle',
          navStyle: 'rail',
          railStyle: 'grains',
          logoText: b.name,
        })),
      }),
      prisma.category.createMany({
        data: built.flatMap((b) =>
          b.catalog.categories.map((category) => ({
            id: category.id,
            menuId: b.menuId,
            slug: category.slug,
            sortOrder: category.sortOrder,
            translations: json(category.translations),
          })),
        ),
      }),
      prisma.product.createMany({
        data: built.flatMap((b) =>
          b.catalog.products.map((product) => ({
            id: product.id,
            menuId: b.menuId,
            categoryId: product.categoryId,
            slug: product.slug,
            basePrice: product.basePrice,
            cost: product.cost,
            popularity: product.popularity,
            priority: product.priority,
            media: json(product.media),
            translations: json(product.translations),
            sortOrder: product.sortOrder,
          })),
        ),
      }),
      prisma.menuRevision.createMany({
        data: built.map((b) => ({
          id: b.revisionId,
          menuId: b.menuId,
          number: 1,
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          snapshot: json(b.snapshot),
          snapshotHash: b.liveHash,
          wentLiveAt: b.createdAt,
          note: 'Load seed',
        })),
      }),
      // The menu and its revision refer to each other, so the menu goes first and learns its live revision here.
      ...built.map((b) =>
        prisma.menu.update({
          where: { id: b.menuId },
          data: {
            liveRevisionId: b.revisionId,
            liveHash: b.liveHash,
            // A draft that differs from the live revision is what the Studio calls "unpublished changes".
            draftHash:
              b.n % LOAD_UNPUBLISHED_EVERY === 0 ? createHash('sha256').update(`${b.liveHash}:edited`).digest('hex') : b.liveHash,
          },
          select: { id: true },
        }),
      ),
    ]);
    for (const b of built) refs.push({ menuId: b.menuId, restaurantId: b.restaurantId });
  }

  // Audit rows. A menu's rows are spread over the whole period (a row every seven minutes platform-wide), not
  // clumped, so a menu filter reads rows from all over the log and the newest page mixes every menu.
  const total = refs.length * AUDIT_ROWS_PER_MENU;
  const rows: Prisma.AuditLogCreateManyInput[] = [];
  for (let k = 0; k < AUDIT_ROWS_PER_MENU; k += 1) {
    for (const [index, ref] of refs.entries()) {
      const [action, entityType] = AUDIT_CYCLE[(index + k) % AUDIT_CYCLE.length]!;
      const onRestaurant = entityType === 'Restaurant' || entityType === 'Branch';
      rows.push({
        id: createId(),
        restaurantId: ref.restaurantId,
        menuId: onRestaurant ? null : ref.menuId,
        action,
        entityType,
        entityId: onRestaurant ? ref.restaurantId : ref.menuId,
        occurredAt: new Date(now - (k * refs.length + index) * 7 * MINUTE_MS),
      });
    }
  }
  for (const batch of chunks(rows, AUDIT_BATCH_SIZE)) await prisma.auditLog.createMany({ data: batch });

  return { restaurants: refs.length, menus: refs.length, auditRows: total };
}
