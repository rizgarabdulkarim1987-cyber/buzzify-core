/// <reference types="vite/client" />
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@/server/data/prisma';
import { NEVER_GRANTABLE, PERMISSIONS } from '@/server/domain/permissions';
import { formatClientId } from '@/server/domain/restaurant-profile';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { invokePublic } from '@/server/studio/framework/invoke';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import * as session from '@/server/studio/public-actions/session';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { Browser } from '../helpers/browser';
import { seedApplications } from '../../prisma/seed/applications';
import { publishFixture, requireTestDb, resetTestData } from '../helpers/db';
import { devMail } from '../helpers/mail';

/**
 * Spec 16: an owner of restaurant A cannot read or write restaurant B through any Studio action. This sweep loads every
 * module in `src/server/studio/actions/` and `src/server/studio/queries/`, and runs every definition in them as an owner
 * and as a designer of A, with inputs that name B's restaurant, menu, branch, invitations, people and session (and, where
 * an input carries two ids, A's target with B's other id smuggled in). Every run must be refused (`NOT_FOUND` or
 * `FORBIDDEN`), or, for a read across the person's own restaurants, answer without a trace of B; and no row of B, or of
 * the audit log about B, may change.
 *
 * Every definition must have an entry in exactly one of the three tables below: a new action or query without one fails
 * the first test. A's client policy grants every grantable permission to both roles, so for the definitions in `SWEPT` a
 * refusal in B is never owed to a permission A's people lack: it is the tenant check. The definitions in `PLATFORM_ONLY`
 * need a permission no client policy can grant (`NEVER_GRANTABLE`), so their refusal is the permission check, and this
 * sweep cannot tell from it whether the tenant check would also have held; their own tests cover what a Super Admin may do.
 */

vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const GOOD = 'correct horse battery staple';
const META = { ip: '203.0.113.9', userAgent: 'vitest cross-tenant' };
const globalForPrisma = globalThis as unknown as { __prisma?: unknown };
const prisma = () => getPrisma();
const { address, quiet, clean } = devMail();

type Definition = ActionDef<unknown, unknown> | QueryDef<unknown, unknown>;

/** Every definition the Studio has, by name, from every module of the two folders. */
function allDefinitions(): Map<string, Definition> {
  const modules = import.meta.glob<Record<string, unknown>>(['/src/server/studio/actions/*.ts', '/src/server/studio/queries/*.ts'], {
    eager: true,
  });
  const found = new Map<string, Definition>();
  for (const exported of Object.values(modules)) {
    for (const value of Object.values(exported)) {
      const kind = (value as { kind?: unknown } | null)?.kind;
      if (kind !== 'action' && kind !== 'query') continue;
      const def = value as Definition;
      if (found.has(def.name)) throw new Error(`Two Studio definitions are called ${def.name}`);
      found.set(def.name, def);
    }
  }
  return found;
}

const DEFINITIONS = allDefinitions();

// The world -----------------------------------------------------------------------------------------------------------

interface Side {
  restaurantId: string;
  restaurantName: string;
  clientId: string;
  menuId: string;
  menuName: string;
  slug: string;
  branchId: string;
  ownerId: string;
  ownerEmail: string;
  designerId: string;
  invitationId: string;
  assetId: string;
  /** A GLB model in the restaurant's library. */
  sceneAssetId: string;
  categoryId: string;
  productId: string;
  variantId: string;
  optionId: string;
  /** The live revision, and one waiting to go live. */
  revisionId: string;
  pendingRevisionId: string;
  /** A QR code printed for table 1. */
  qrCodeId: string;
  /** A sheet read for an import, not applied. */
  importJobId: string;
  /** A second dish, and the sales rules between the two (docs/superpowers/plans/2026-10-18-sales-tools.md). */
  sideProductId: string;
  upgradeId: string;
  pairingId: string;
  setId: string;
  offerId: string;
  /** A design the restaurant saved from a template preset. */
  designTemplateId: string;
  /** A paid Menu subscription and its payment (docs/superpowers/plans/2026-10-22-business-core-in-menu.md). */
  subscriptionId: string;
  paymentId: string;
}

interface World {
  a: Side;
  b: Side & { staffInvitationId: string; ownerSessionId: string };
}

/** Every grantable permission, for both roles: what A's people may do is limited only by where they are members. */
const GRANT_ALL = (() => {
  const grant = PERMISSIONS.filter((key) => !NEVER_GRANTABLE.includes(key));
  return { OWNER: { grant, revoke: [] }, DESIGNER: { grant, revoke: [] } };
})();

async function person(label: string, name: string, superAdmin = false): Promise<{ id: string; email: string }> {
  const email = address(label);
  const { userId } = await createPasswordUser(prisma(), { email, name, password: GOOD, isSuperAdmin: superAdmin });
  if (superAdmin) await prisma().user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return { id: userId, email };
}

/** A restaurant with one published menu, one branch, an owner, a designer and an owner invitation. */
async function side(label: 'alpha' | 'bravo', city: string, adminId: string): Promise<Side> {
  const title = label === 'alpha' ? 'Alpha' : 'Bravo';
  const restaurant = await prisma().restaurant.create({
    data: { name: `Shared ${title} Kitchen`, city, permissionPolicy: GRANT_ALL },
    select: { id: true, name: true, clientNumber: true },
  });
  const slug = `${label}-supper`;
  const menu = await prisma().menu.create({
    data: { restaurantId: restaurant.id, name: `${title} Supper`, slug, locales: ['en'], timezone: 'Asia/Baghdad' },
  });
  await prisma().menuSlug.create({ data: { slug, menuId: menu.id } });
  const category = await prisma().category.create({ data: { menuId: menu.id, slug: 'mains', translations: { en: { name: `${title} mains` } } } });
  const product = await prisma().product.create({
    data: { menuId: menu.id, categoryId: category.id, slug: `${label}-stew`, basePrice: 900, translations: { en: { name: `${title} stew`, description: 'Slow' } } },
  });
  const variant = await prisma().productVariant.create({
    data: { menuId: menu.id, productId: product.id, isDefault: true, translations: { en: { name: `${title} bowl` } } },
  });
  const group = await prisma().modifierGroup.create({
    data: { menuId: menu.id, productId: product.id, translations: { en: { name: `${title} sides` } } },
  });
  const option = await prisma().modifierOption.create({
    data: { menuId: menu.id, groupId: group.id, translations: { en: { name: `${title} bread` } } },
  });
  const sideDish = await prisma().product.create({
    data: { menuId: menu.id, categoryId: category.id, slug: `${label}-salad`, basePrice: 500, sortOrder: 1, translations: { en: { name: `${title} salad`, description: 'Fresh' } } },
  });
  const upgrade = await prisma().upsellRule.create({ data: { menuId: menu.id, sourceProductId: product.id, targetProductId: sideDish.id, translations: {} } });
  const pairing = await prisma().pairingRule.create({ data: { menuId: menu.id, sourceType: 'CATEGORY', sourceCategoryId: category.id, targetProductId: sideDish.id, translations: {} } });
  const set = await prisma().bundle.create({ data: { menuId: menu.id, slug: `${label}-set`, price: 1000, translations: { en: { name: `${title} set` } } } });
  await prisma().bundleItem.createMany({
    data: [
      { menuId: menu.id, bundleId: set.id, productId: product.id },
      { menuId: menu.id, bundleId: set.id, productId: sideDish.id },
    ],
  });
  const offer = await prisma().promotion.create({ data: { menuId: menu.id, kind: 'SPECIAL', productIds: [product.id], translations: { en: { title: `${title} special` } } } });
  const published = await publishFixture(prisma(), menu.id);
  const live = await prisma().menuRevision.findUniqueOrThrow({ where: { id: published.revisionId } });
  const pending = await prisma().menuRevision.create({
    data: { menuId: menu.id, number: 2, schemaVersion: live.schemaVersion, snapshot: live.snapshot as object, snapshotHash: live.snapshotHash, goLiveAt: new Date(Date.now() + 86_400_000) },
  });
  const branch = await prisma().branch.create({ data: { restaurantId: restaurant.id, name: `${title} Riverside` } });
  const owner = await person(`${label}-owner`, `${title} Owner`);
  const designer = await person(`${label}-designer`, `${title} Designer`);
  await prisma().membership.create({ data: { userId: owner.id, restaurantId: restaurant.id, role: 'OWNER' } });
  await prisma().membership.create({ data: { userId: designer.id, restaurantId: restaurant.id, role: 'DESIGNER' } });
  const invitation = await prisma().invitation.create({
    data: {
      email: address(`${label}-invitee`),
      restaurantId: restaurant.id,
      role: 'OWNER',
      tokenHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: adminId,
    },
  });
  // A file in the restaurant's media library.
  const asset = await prisma().mediaAsset.create({
    data: {
      restaurantId: restaurant.id,
      kind: 'IMAGE',
      storageKey: `r/${restaurant.id}/${label}hash`,
      contentHash: `${label}hash`,
      mime: 'image/png',
      bytes: 10,
      storedBytes: 30,
      alt: { en: `${title} logo` },
      variants: { original: `r/${restaurant.id}/${label}hash/original.png` },
    },
  });
  // A scene file (Template Studio stage 2), which a menu of the restaurant may draw as its background.
  const sceneAsset = await prisma().mediaAsset.create({
    data: {
      restaurantId: restaurant.id,
      kind: 'MODEL',
      storageKey: `r/${restaurant.id}/${label}scene`,
      contentHash: `${label}scene`,
      mime: 'model/gltf-binary',
      bytes: 10,
      storedBytes: 10,
      variants: { original: `r/${restaurant.id}/${label}scene/original.glb` },
    },
  });
  const importJob = await prisma().importJob.create({
    data: { menuId: menu.id, fileName: 'menu.csv', rowCount: 0, draftHash: '', preview: { rows: [], newCategories: [], missing: [], summary: { new: 0, changed: 0, unchanged: 0, invalid: 0, hidden: 0 } } },
  });
  const qrCode = await prisma().qrCode.create({ data: { menuId: menu.id, label: `${title} table 1`, tableNumber: 1 } });
  const designTemplate = await prisma().designTemplate.create({ data: { restaurantId: restaurant.id, name: `${title} house look`, basePresetId: 'kyoto-ink', overrides: {} } });
  const periodStart = new Date(Date.now() - 86_400_000);
  const periodEnd = new Date(Date.now() + 29 * 86_400_000);
  const subscription = await prisma().subscription.create({
    data: {
      restaurantId: restaurant.id,
      applicationId: 'menu',
      planCode: 'PREMIUM',
      status: 'ACTIVE',
      period: 'MONTHLY',
      currency: 'IQD',
      priceMinor: 50000,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      anchorDay: periodEnd.getUTCDate(),
      version: 1,
    },
  });
  const payment = await prisma().payment.create({
    data: {
      subscriptionId: subscription.id,
      restaurantId: restaurant.id,
      amountMinor: 50000,
      currency: 'IQD',
      paidAt: periodStart,
      coversFrom: periodStart,
      coversTo: periodEnd,
      idempotencyKey: randomUUID(),
      recordedById: adminId,
    },
  });
  // Something in the restaurant's activity, which a leak would show.
  await prisma().auditLog.create({
    data: { actorId: owner.id, restaurantId: restaurant.id, menuId: menu.id, action: 'menu.published', entityType: 'Menu', entityId: menu.id },
  });
  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    clientId: formatClientId(restaurant.clientNumber),
    menuId: menu.id,
    menuName: menu.name,
    slug,
    branchId: branch.id,
    ownerId: owner.id,
    ownerEmail: owner.email,
    designerId: designer.id,
    invitationId: invitation.id,
    assetId: asset.id,
    sceneAssetId: sceneAsset.id,
    categoryId: category.id,
    productId: product.id,
    variantId: variant.id,
    optionId: option.id,
    revisionId: published.revisionId,
    pendingRevisionId: pending.id,
    qrCodeId: qrCode.id,
    importJobId: importJob.id,
    sideProductId: sideDish.id,
    upgradeId: upgrade.id,
    pairingId: pairing.id,
    setId: set.id,
    offerId: offer.id,
    designTemplateId: designTemplate.id,
    subscriptionId: subscription.id,
    paymentId: payment.id,
  };
}

async function buildWorld(): Promise<World> {
  await seedApplications(prisma());
  const admin = await person('root', 'Root Admin', true);
  const a = await side('alpha', 'Alphaville', admin.id);
  const b = await side('bravo', 'Bravoville', admin.id);
  // A staff invitation (no restaurant) for an address of B's, and a session of B's owner.
  const staff = await prisma().invitation.create({
    data: { email: address('bravo-staff'), tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 86_400_000), invitedById: admin.id },
  });
  const ownerSession = await prisma().session.create({
    data: { id: `bravo-session-${randomBytes(6).toString('hex')}`, token: randomBytes(24).toString('hex'), userId: b.ownerId, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return { a, b: { ...b, staffInvitationId: staff.id, ownerSessionId: ownerSession.id } };
}

/** Everything of B's, and every audit row about B, as one comparable value. */
async function snapshotOfB(w: World): Promise<unknown> {
  const db = prisma();
  const { b } = w;
  const people = [b.ownerId, b.designerId];
  const menus = await db.menu.findMany({ where: { restaurantId: b.restaurantId }, orderBy: { id: 'asc' } });
  const menuIds = menus.map((menu) => menu.id);
  const ids = [b.restaurantId, b.menuId, b.branchId, b.invitationId, b.staffInvitationId, b.ownerSessionId, ...people];
  return JSON.parse(
    JSON.stringify({
      restaurant: await db.restaurant.findUnique({ where: { id: b.restaurantId } }),
      menus,
      slugs: await db.menuSlug.findMany({ where: { OR: [{ menuId: { in: menuIds } }, { slug: b.slug }] }, orderBy: { slug: 'asc' } }),
      revisions: await db.menuRevision.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      brand: await db.brandConfig.findMany({ where: { menuId: { in: menuIds } } }),
      categories: await db.category.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      products: await db.product.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      variants: await db.productVariant.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      groups: await db.modifierGroup.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      options: await db.modifierOption.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      importJobs: await db.importJob.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      qrCodes: await db.qrCode.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      upgrades: await db.upsellRule.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      pairings: await db.pairingRule.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      sets: await db.bundle.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' }, include: { items: { orderBy: { id: 'asc' } } } }),
      offers: await db.promotion.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      tables: await db.table.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      schedule: await db.daypartSchedule.findMany({ where: { menuId: { in: menuIds } }, orderBy: { id: 'asc' } }),
      branches: await db.branch.findMany({ where: { restaurantId: b.restaurantId }, orderBy: { id: 'asc' } }),
      memberships: await db.membership.findMany({ where: { OR: [{ restaurantId: b.restaurantId }, { userId: { in: people } }] }, orderBy: { id: 'asc' } }),
      invitations: await db.invitation.findMany({
        where: { OR: [{ restaurantId: b.restaurantId }, { id: b.staffInvitationId }] },
        orderBy: { id: 'asc' },
      }),
      users: await db.user.findMany({ where: { id: { in: people } }, orderBy: { id: 'asc' } }),
      sessions: await db.session.findMany({ where: { userId: { in: people } }, orderBy: { id: 'asc' } }),
      accounts: await db.account.findMany({ where: { userId: { in: people } }, orderBy: { id: 'asc' } }),
      twoFactor: await db.twoFactor.findMany({ where: { userId: { in: people } } }),
      audit: await db.auditLog.findMany({
        where: { OR: [{ restaurantId: b.restaurantId }, { menuId: { in: menuIds } }, { entityId: { in: ids } }, { actorId: { in: people } }] },
        orderBy: { id: 'asc' },
      }),
      platformSettings: await db.platformSetting.findMany({ orderBy: { key: 'asc' } }),
      media: await db.mediaAsset.findMany({ where: { restaurantId: b.restaurantId }, orderBy: { id: 'asc' } }),
      subscriptions: await db.subscription.findMany({ where: { restaurantId: b.restaurantId }, orderBy: { id: 'asc' } }),
      subscriptionEvents: await db.subscriptionEvent.findMany({ where: { subscription: { restaurantId: b.restaurantId } }, orderBy: { id: 'asc' } }),
      payments: await db.payment.findMany({ where: { restaurantId: b.restaurantId }, orderBy: { id: 'asc' } }),
      supportGrants: await db.supportAccessGrant.findMany({ where: { restaurantId: b.restaurantId }, orderBy: { id: 'asc' } }),
    }),
  );
}

/** What of B's a result must never show: its ids, its client ID, and its names (every one of them says Bravo). */
function tracesOfB(w: World, value: unknown): string[] {
  const text = JSON.stringify(value) ?? '';
  const { b } = w;
  const markers = [b.restaurantId, b.menuId, b.branchId, b.invitationId, b.staffInvitationId, b.ownerSessionId, b.ownerId, b.designerId, b.clientId, b.assetId, b.sceneAssetId, b.categoryId, b.productId, b.variantId, b.optionId, b.revisionId, b.pendingRevisionId];
  return [...markers.filter((marker) => text.includes(marker)), ...(/bravo/i.test(text) ? ['a name of B'] : [])];
}

// What each definition is run with --------------------------------------------------------------------------------------

/**
 * - `refused`: `NOT_FOUND` or `FORBIDDEN` (or the codes given, for a case that is refused for another reason first).
 * - `scoped`: a read across the person's own restaurants answers, with nothing of B; `showsOwn` also needs A in it, so the
 *   check cannot pass on an empty answer.
 * - `perItem`: an action over many menus answers with every item refused.
 * - `self`: the person's own account; whatever it answers, it touches nothing of B and shows nothing of B.
 */
type Expectation =
  | { kind: 'refused'; codes?: readonly string[] }
  | { kind: 'scoped'; showsOwn?: boolean }
  | { kind: 'perItem' }
  | { kind: 'self'; code?: string };

interface Case {
  label: string;
  input: (w: World) => unknown;
  expect?: Expectation;
}

const REFUSED: Expectation = { kind: 'refused' };
const SCOPED: Expectation = { kind: 'scoped' };
const SHOWS_OWN: Expectation = { kind: 'scoped', showsOwn: true };
const ONLY_FORBIDDEN: Expectation = { kind: 'refused', codes: ['FORBIDDEN'] };

const c = (label: string, input: (w: World) => unknown, expectation: Expectation = REFUSED): Case => ({ label, input, expect: expectation });

/** A brand kit as the Brand tab saves it. */
const brandKit = () => ({
  version: 1,
  theme: 'dark',
  palette: { bg: '#0e0e0f', surface: '#1b1a19', raised: '#2a2826', accent: '#d6bc8a', text: '#ede8df', muted: '#a7a096', line: '#3a3633', onAccent: '#0e0e0f' },
  logoAssetId: null,
  logoDarkAssetId: null,
  favicon: { kind: 'none' },
  fontPairId: 'classic',
  railStyle: 'grains',
  motionIntensity: 'subtle',
  logoText: 'Planted',
});

/** The Sales tab's saves, between the dishes and categories given. */
const upgradeSave = (sourceProductId: string, targetProductId: string) => ({
  sourceProductId,
  targetProductId,
  pitch: { en: 'Planted' },
  effect: {},
  priority: 50,
  dayparts: [],
  isActive: true,
});
const pairingSave = (categoryId: string, targetProductId: string) => ({
  source: { kind: 'CATEGORY', id: categoryId },
  targetProductId,
  reason: { en: 'Planted' },
  weight: 50,
  dayparts: [],
  isActive: true,
});
const setSave = (first: string, second: string) => ({
  names: { en: 'Planted' },
  descriptions: {},
  price: 1,
  items: [
    { productId: first, variantId: null, quantity: 1 },
    { productId: second, variantId: null, quantity: 1 },
  ],
  dayparts: [],
  isActive: true,
});
const offerSave = (productIds: string[], categoryIds: string[]) => ({
  kind: 'SPECIAL',
  percentOff: null,
  productIds,
  categoryIds,
  startsOn: null,
  endsOn: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: 127,
  title: { en: 'Planted' },
  text: {},
  isActive: true,
});
const salesSettings = (mealCategoryIds: string[]) => ({
  version: 1,
  priceStyle: 'plain',
  showMostOrdered: true,
  showLowStock: true,
  upsellMaxOffers: 3,
  pairingMaxOffers: 3,
  upsellDeltaCapRatio: 0.75,
  cartPairingMaxOffers: 2,
  mealCategoryIds,
});

/** A QR code's style as the QR tab saves it. */
const qrStyle = () => ({ foreground: '#000000', background: '#FFFFFF', logo: false, frameText: 'Planted' });

/** A menu's settings as the Settings tab saves them (version 1 is stale for a published menu, which the checks precede). */
const menuSettings = () => ({
  version: 1,
  name: 'Planted',
  locales: ['en'],
  defaultLocale: 'en',
  currency: 'USD',
  timezone: 'Asia/Baghdad',
  numeralSystem: 'LATN',
  seo: {},
  notes: '',
  priceStep: null,
});

/** A whole product as the Content tab's drawer saves it, with the given product and category. */
const productSave = (menuId: string, productId: string, categoryId: string) => ({
  menuId,
  productId,
  version: 1,
  slug: 'planted',
  categoryId,
  names: { en: 'Planted' },
  descriptions: {},
  price: 900,
  isSignature: false,
  isFeatured: false,
  allergens: [],
  dietary: [],
  badges: [],
  calories: null,
  media: [],
  variants: [],
  groups: [],
});

/** Definitions that act on, or read, restaurants and menus: each is run against B. */
const SWEPT: Record<string, Case[]> = {
  // Menus
  'menus.create': [c("in B's restaurant", (w) => ({ restaurantId: w.b.restaurantId, name: 'Planted', slug: 'planted-menu' }))],
  'menus.publish': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'menus.settings': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  // The Brand tab
  'brand.get': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  // The Motion tab
  'motions.list': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'motions.save': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, place: 'hero', motionId: 'golden-particles', params: {}, texts: {}, version: null })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, place: 'category', categoryId: w.b.categoryId, motionId: 'coffee-steam', params: {}, texts: {}, version: null })),
  ],
  'motions.remove': [c("B's menu", (w) => ({ menuId: w.b.menuId, place: 'hero', version: 1 }))],
  // Plans: the tab reads B's plan; the change is the platform owner's alone, so anyone else is refused before B is found
  'plans.forRestaurant': [c("B's restaurant", (w) => ({ restaurantId: w.b.restaurantId }))],
  'plans.setRestaurantPlan': [c("B's restaurant", (w) => ({ restaurantId: w.b.restaurantId, plan: 'BASIC', extras: {}, note: 'Planted' }))],
  // QR codes
  'qr.list': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'qr.create': [c("in B's menu", (w) => ({ menuId: w.b.menuId, label: 'Planted', tableNumber: 40 }))],
  'qr.createForTables': [c("in B's menu", (w) => ({ menuId: w.b.menuId, from: 40, to: 42 }))],
  'qr.update': [
    c("B's code, in B", (w) => ({ menuId: w.b.menuId, qrCodeId: w.b.qrCodeId, version: 1, label: 'Planted', style: qrStyle() })),
    c("B's code, through A", (w) => ({ menuId: w.a.menuId, qrCodeId: w.b.qrCodeId, version: 1, label: 'Planted', style: qrStyle() })),
  ],
  'qr.delete': [
    c("B's code, in B", (w) => ({ menuId: w.b.menuId, qrCodeId: w.b.qrCodeId })),
    c("B's code, through A", (w) => ({ menuId: w.a.menuId, qrCodeId: w.b.qrCodeId })),
  ],
  'qr.download': [
    c("B's code, in B", (w) => ({ menuId: w.b.menuId, qrCodeId: w.b.qrCodeId, format: 'svg' })),
    c("B's code, through A", (w) => ({ menuId: w.a.menuId, qrCodeId: w.b.qrCodeId, format: 'png', size: 512 })),
  ],
  'qr.downloadTables': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  // Import and export
  'import.requestUpload': [c("B's menu", (w) => ({ menuId: w.b.menuId, fileName: 'menu.csv', bytes: 10 }))],
  'import.parse': [
    c("B's upload, in B", (w) => ({ menuId: w.b.menuId, uploadKey: `imports/${w.b.menuId}/planted`, fileName: 'menu.csv', hideMissing: false })),
    c("B's upload, through A", (w) => ({ menuId: w.a.menuId, uploadKey: `imports/${w.b.menuId}/planted`, fileName: 'menu.csv', hideMissing: true })),
  ],
  'import.aiPhotos': [
    c("B's import, in B", (w) => ({ menuId: w.b.menuId, importJobId: w.b.importJobId })),
    c("B's import, through A", (w) => ({ menuId: w.a.menuId, importJobId: w.b.importJobId })),
  ],
  'import.aiTranslate': [
    c("B's import, in B", (w) => ({ menuId: w.b.menuId, importJobId: w.b.importJobId })),
    c("B's import, through A", (w) => ({ menuId: w.a.menuId, importJobId: w.b.importJobId })),
  ],
  'import.aiRead': [c("B's menu", (w) => ({ menuId: w.b.menuId, source: { kind: 'link', url: 'https://menu.example.com/m' } }))],
  'import.apply': [
    c("B's import, in B", (w) => ({ menuId: w.b.menuId, importJobId: w.b.importJobId })),
    c("B's import, through A", (w) => ({ menuId: w.a.menuId, importJobId: w.b.importJobId })),
  ],
  'import.discard': [
    c("B's import, in B", (w) => ({ menuId: w.b.menuId, importJobId: w.b.importJobId })),
    c("B's import, through A", (w) => ({ menuId: w.a.menuId, importJobId: w.b.importJobId })),
  ],
  'import.job': [
    c("B's import, in B", (w) => ({ menuId: w.b.menuId, importJobId: w.b.importJobId })),
    c("B's import, through A", (w) => ({ menuId: w.a.menuId, importJobId: w.b.importJobId })),
  ],
  'export.download': [c("B's menu", (w) => ({ menuId: w.b.menuId, format: 'csv' }))],
  'qr.preview': [
    c("B's code, in B", (w) => ({ menuId: w.b.menuId, qrCodeId: w.b.qrCodeId, style: qrStyle() })),
    c("B's code, through A", (w) => ({ menuId: w.a.menuId, qrCodeId: w.b.qrCodeId, style: qrStyle() })),
  ],
  'qr.applyStyle': [
    c("B's code, in B", (w) => ({ menuId: w.b.menuId, qrCodeId: w.b.qrCodeId })),
    c("B's code, through A", (w) => ({ menuId: w.a.menuId, qrCodeId: w.b.qrCodeId })),
  ],
  // Revisions
  'revisions.list': [c("B's menu", (w) => ({ menuId: w.b.menuId, page: 1 }))],
  'revisions.view': [
    c("B's revision, in B", (w) => ({ menuId: w.b.menuId, revisionId: w.b.revisionId, locale: 'en' })),
    c("B's revision, through A", (w) => ({ menuId: w.a.menuId, revisionId: w.b.revisionId, locale: 'en' })),
  ],
  'revisions.rollback': [
    c("B's revision, in B", (w) => ({ menuId: w.b.menuId, revisionId: w.b.revisionId })),
    c("B's revision, through A", (w) => ({ menuId: w.a.menuId, revisionId: w.b.revisionId })),
  ],
  'revisions.restore': [
    c("B's revision, in B", (w) => ({ menuId: w.b.menuId, revisionId: w.b.revisionId, expectedDraftHash: null })),
    c("B's revision, through A", (w) => ({ menuId: w.a.menuId, revisionId: w.b.revisionId, expectedDraftHash: null })),
  ],
  'revisions.schedule': [c("B's menu", (w) => ({ menuId: w.b.menuId, goLiveAt: new Date(Date.now() + 3_600_000).toISOString(), replacePending: true }))],
  'revisions.cancelSchedule': [
    c("B's pending revision, in B", (w) => ({ menuId: w.b.menuId, revisionId: w.b.pendingRevisionId })),
    c("B's pending revision, through A", (w) => ({ menuId: w.a.menuId, revisionId: w.b.pendingRevisionId })),
  ],
  'brand.update': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, ...brandKit() })),
    c("B's logo, through A", (w) => ({ menuId: w.a.menuId, ...brandKit(), logoAssetId: w.b.assetId })),
    c("B's favicon, through A", (w) => ({ menuId: w.a.menuId, ...brandKit(), favicon: { kind: 'asset', assetId: w.b.assetId } })),
  ],
  // Template designs
  'design.get': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'design.apply': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, version: 1, choice: { kind: 'preset', templateId: 'copper-roast' } })),
    c("B's saved design, through A", (w) => ({ menuId: w.a.menuId, version: 1, choice: { kind: 'custom', customTemplateId: w.b.designTemplateId } })),
  ],
  'design.update': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, version: 1, overrides: { paletteId: 'crema' } })),
    c("B's scene file, through A", (w) => ({ menuId: w.a.menuId, version: 1, overrides: { sceneAsset: { assetId: w.b.sceneAssetId } } })),
  ],
  'design.reset': [c("B's menu", (w) => ({ menuId: w.b.menuId, version: 1 }))],
  'design.save': [c("B's menu", (w) => ({ menuId: w.b.menuId, name: 'Planted', shared: false, from: 'copper-roast' }))],
  'design.delete': [
    c("B's saved design, in B", (w) => ({ menuId: w.b.menuId, id: w.b.designTemplateId })),
    c("B's saved design, through A", (w) => ({ menuId: w.a.menuId, id: w.b.designTemplateId })),
  ],
  'design.poweredBy': [c('B', (w) => ({ restaurantId: w.b.restaurantId, show: false }))],
  'brand.suggestFromLogo': [
    c("B's logo, in B", (w) => ({ menuId: w.b.menuId, assetId: w.b.assetId, theme: 'light' })),
    c("B's logo, through A", (w) => ({ menuId: w.a.menuId, assetId: w.b.assetId, theme: 'light' })),
  ],
  'menus.updateSettings': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, ...menuSettings() })),
    c("B's image, through A", (w) => ({ menuId: w.a.menuId, ...menuSettings(), seo: { en: { title: 'Planted', description: '', imageAssetId: w.b.assetId } } })),
  ],
  'menus.changeStatus': [
    c("suspends B's menu", (w) => ({ menuId: w.b.menuId, action: 'suspend' })),
    c("archives B's menu", (w) => ({ menuId: w.b.menuId, action: 'archive' })),
  ],
  'menus.changeSlug': [
    c("moves B's menu", (w) => ({ menuId: w.b.menuId, slug: 'stolen-address', version: 1 })),
    // A's own menu, asking for B's address: refused as taken (or for its version), and B keeps it.
    c("gives A's menu B's address", (w) => ({ menuId: w.a.menuId, slug: w.b.slug, version: 1 }), { kind: 'refused', codes: ['INVALID', 'CONFLICT'] }),
  ],
  'menus.duplicate': [
    c("copies B's menu", (w) => ({ menuId: w.b.menuId, name: 'Copy', slug: 'copy-of-b' })),
    c("copies A's menu into B", (w) => ({ menuId: w.a.menuId, name: 'Copy', slug: 'copy-into-b', targetRestaurantId: w.b.restaurantId })),
    c("copies B's menu into A", (w) => ({ menuId: w.b.menuId, name: 'Copy', slug: 'copy-out-of-b', targetRestaurantId: w.a.restaurantId })),
  ],
  'menus.delete': [c("B's menu", (w) => ({ menuId: w.b.menuId, confirmName: w.b.menuName }))],
  // The guests' complaints and suggestions box
  'menus.setFeedback': [
    c("switches on B's box", (w) => ({ menuId: w.b.menuId, enabled: true })),
    c("switches off B's box", (w) => ({ menuId: w.b.menuId, enabled: false })),
  ],
  // The intro page before the menu: B's menu, B's asset smuggled into A's, and B's advert through A.
  'menus.setIntroEnabled': [c("switches on B's intro", (w) => ({ menuId: w.b.menuId, enabled: true }))],
  'menus.saveIntro': [
    c("B's intro", (w) => ({ menuId: w.b.menuId, backgroundAssetId: null, overlay: 50, showLogo: true, showContact: true })),
    c("B's picture as A's background", (w) => ({ menuId: w.a.menuId, backgroundAssetId: w.b.assetId, overlay: 50, showLogo: true, showContact: true })),
  ],
  'menus.saveIntroAdvert': [
    c("an advert on B's intro", (w) => ({ menuId: w.b.menuId, imageAssetId: w.b.assetId, alts: {}, href: '', startsAt: null, endsAt: null, active: true })),
    c("B's picture as A's advert", (w) => ({ menuId: w.a.menuId, imageAssetId: w.b.assetId, alts: {}, href: '', startsAt: null, endsAt: null, active: true })),
  ],
  'menus.reorderIntroAdverts': [c("B's adverts", (w) => ({ menuId: w.b.menuId, ids: [] }))],
  'menus.deleteIntroAdvert': [c("B's advert, in B", (w) => ({ menuId: w.b.menuId, advertId: 'nope' }))],
  'menus.intro': [c("B's intro", (w) => ({ menuId: w.b.menuId }))],
  // The About page: B's menu, B's picture and B's dish smuggled into A's, and B's offer through A.
  'menus.setAboutEnabled': [c("switches on B's About page", (w) => ({ menuId: w.b.menuId, enabled: true }))],
  'menus.saveAbout': [
    c("B's About page", (w) => ({ menuId: w.b.menuId, titles: {}, coverAssetId: null, story: {}, galleryAssetIds: [], showHours: true, showContact: true })),
    c("B's picture as A's cover", (w) => ({ menuId: w.a.menuId, titles: {}, coverAssetId: w.b.assetId, story: {}, galleryAssetIds: [], showHours: true, showContact: true })),
    c("B's picture in A's gallery", (w) => ({ menuId: w.a.menuId, titles: {}, coverAssetId: null, story: {}, galleryAssetIds: [w.b.assetId], showHours: true, showContact: true })),
  ],
  'menus.saveAboutOffer': [
    c("an offer on B's page", (w) => ({ menuId: w.b.menuId, titles: {}, bodies: {}, label: {}, imageAssetId: null, startsAt: null, endsAt: null, active: true, productId: null, categoryId: null })),
    c("B's picture on A's offer", (w) => ({ menuId: w.a.menuId, titles: {}, bodies: {}, label: {}, imageAssetId: w.b.assetId, startsAt: null, endsAt: null, active: true, productId: null, categoryId: null })),
  ],
  'menus.reorderAboutOffers': [c("B's offers", (w) => ({ menuId: w.b.menuId, ids: [] }))],
  'menus.deleteAboutOffer': [c("B's offer, in B", (w) => ({ menuId: w.b.menuId, offerId: 'nope' }))],
  'menus.about': [c("B's About page", (w) => ({ menuId: w.b.menuId }))],
  // The wheel: B's menu through A's session.
  'menus.setWheelEnabled': [c("switches on B's wheel", (w) => ({ menuId: w.b.menuId, enabled: true }))],
  'menus.saveWheel': [c("B's wheel", (w) => ({ menuId: w.b.menuId, spinsPerDay: 1, startsAt: null, endsAt: null, title: {}, slices: [] }))],
  'menus.wheel': [c("B's wheel", (w) => ({ menuId: w.b.menuId }))],
  // A self target that names menus by id: each one is run as its own action, and each must be refused.
  'menus.bulk': ['publish', 'suspend', 'archive', 'restore'].map((action) =>
    c(`${action}s B's menu`, (w) => ({ menuIds: [w.b.menuId], action }), { kind: 'perItem' }),
  ),

  // People
  'people.inviteOwner': [c('into B', (w) => ({ restaurantId: w.b.restaurantId, email: address('planted-owner') }))],
  'people.revokeInvitation': [
    c("B's invitation, in B", (w) => ({ invitationId: w.b.invitationId, restaurantId: w.b.restaurantId })),
    c("B's invitation, through A", (w) => ({ invitationId: w.b.invitationId, restaurantId: w.a.restaurantId })),
    c("B's invitation, on the platform", (w) => ({ invitationId: w.b.invitationId })),
    c('a staff invitation, through A', (w) => ({ invitationId: w.b.staffInvitationId, restaurantId: w.a.restaurantId })),
    c('a staff invitation, on the platform', (w) => ({ invitationId: w.b.staffInvitationId })),
  ],
  'people.resendInvitation': [
    c("B's invitation, in B", (w) => ({ invitationId: w.b.invitationId, restaurantId: w.b.restaurantId })),
    c("B's invitation, through A", (w) => ({ invitationId: w.b.invitationId, restaurantId: w.a.restaurantId })),
    c("B's invitation, on the platform", (w) => ({ invitationId: w.b.invitationId })),
    c('a staff invitation, through A', (w) => ({ invitationId: w.b.staffInvitationId, restaurantId: w.a.restaurantId })),
  ],
  'people.assignDesigner': [
    c("B's designer, in B", (w) => ({ userId: w.b.designerId, restaurantId: w.b.restaurantId })),
    c("B's owner, into A", (w) => ({ userId: w.b.ownerId, restaurantId: w.a.restaurantId })),
  ],
  'people.unassignMember': [
    c("B's owner, from B", (w) => ({ userId: w.b.ownerId, restaurantId: w.b.restaurantId })),
    c("B's owner, through A", (w) => ({ userId: w.b.ownerId, restaurantId: w.a.restaurantId })),
  ],
  'people.setPermissionPolicy': [
    c("B's policy", (w) => ({ restaurantId: w.b.restaurantId, version: 1, policy: { OWNER: { grant: [], revoke: ['publish.now'] } } })),
  ],

  // Restaurants and branches
  'restaurants.update': [
    c('B', (w) => ({ restaurantId: w.b.restaurantId, version: 1, name: 'Hijacked', type: 'RESTAURANT' })),
    c("B's logo, through A", (w) => ({ restaurantId: w.a.restaurantId, version: 1, name: 'Shared Alpha Kitchen', type: 'RESTAURANT', logoAssetId: w.b.assetId })),
  ],
  'restaurants.setStatus': [c('B', (w) => ({ restaurantId: w.b.restaurantId, status: 'SUSPENDED' }))],
  'restaurants.delete': [c('B', (w) => ({ restaurantId: w.b.restaurantId, confirmName: w.b.restaurantName }))],
  'restaurants.createBranch': [c('in B', (w) => ({ restaurantId: w.b.restaurantId, name: 'Planted' }))],
  'restaurants.updateBranch': [
    c("B's branch, in B", (w) => ({ restaurantId: w.b.restaurantId, branchId: w.b.branchId, version: 1, name: 'Hijacked' })),
    c("B's branch, through A", (w) => ({ restaurantId: w.a.restaurantId, branchId: w.b.branchId, version: 1, name: 'Hijacked' })),
  ],
  'restaurants.deleteBranch': [
    c("B's branch, in B", (w) => ({ restaurantId: w.b.restaurantId, branchId: w.b.branchId })),
    c("B's branch, through A", (w) => ({ restaurantId: w.a.restaurantId, branchId: w.b.branchId })),
  ],
  'restaurants.reorderBranches': [
    c("B's branches, in B", (w) => ({ restaurantId: w.b.restaurantId, order: [w.b.branchId] })),
    c("B's branch, through A", (w) => ({ restaurantId: w.a.restaurantId, order: [w.b.branchId] })),
    c("A's and B's branches, through A", (w) => ({ restaurantId: w.a.restaurantId, order: [w.a.branchId, w.b.branchId] })),
  ],

  // Media
  'media.requestUpload': [c('into B', (w) => ({ restaurantId: w.b.restaurantId, fileName: 'p.png', mime: 'image/png', bytes: 10 }))],
  'media.finalize': [
    c("B's upload, in B", (w) => ({ restaurantId: w.b.restaurantId, uploadKey: `uploads/${w.b.restaurantId}/planted` })),
    c("B's upload, through A", (w) => ({ restaurantId: w.a.restaurantId, uploadKey: `uploads/${w.b.restaurantId}/planted` })),
    c('a shared upload, through A', (w) => ({ restaurantId: w.a.restaurantId, uploadKey: 'uploads/shared/planted' })),
  ],
  'media.update': [
    c("B's asset, in B", (w) => ({ restaurantId: w.b.restaurantId, assetId: w.b.assetId, version: 1, alt: {}, folder: 'x', tags: [] })),
    c("B's asset, through A", (w) => ({ restaurantId: w.a.restaurantId, assetId: w.b.assetId, version: 1, alt: {}, folder: 'x', tags: [] })),
  ],
  'media.delete': [
    c("B's asset, in B", (w) => ({ restaurantId: w.b.restaurantId, assetId: w.b.assetId })),
    c("B's asset, through A", (w) => ({ restaurantId: w.a.restaurantId, assetId: w.b.assetId })),
  ],
  'media.usage': [
    c("B's asset, in B", (w) => ({ restaurantId: w.b.restaurantId, assetId: w.b.assetId })),
    c("B's asset, through A", (w) => ({ restaurantId: w.a.restaurantId, assetId: w.b.assetId })),
  ],
  'media.list': [
    c("B's library", (w) => ({ restaurantId: w.b.restaurantId })),
    c("B's library alone", (w) => ({ restaurantId: w.b.restaurantId, own: true })),
    c("B's scene files", (w) => ({ restaurantId: w.b.restaurantId, kinds: 'scene' })),
    c("A's library", (w) => ({ restaurantId: w.a.restaurantId }), SHOWS_OWN),
    c("A's scene files", (w) => ({ restaurantId: w.a.restaurantId, kinds: 'all' }), SHOWS_OWN),
    c('the shared library', () => ({}), SCOPED),
  ],

  // The shared library is the platform's: `media.manage` there is a Super Admin's alone, whatever a restaurant grants.
  'media.requestSharedUpload': [c('a shared upload', () => ({ fileName: 'p.png', mime: 'image/png', bytes: 10 }))],
  'media.finalizeShared': [c("B's upload as shared", (w) => ({ uploadKey: `uploads/${w.b.restaurantId}/planted` }))],
  'media.updateShared': [c("B's asset as shared", (w) => ({ assetId: w.b.assetId, version: 1, alt: {}, folder: 'x', tags: [] }))],
  'media.deleteShared': [c("B's asset as shared", (w) => ({ assetId: w.b.assetId }))],
  'media.sharedUsage': [c("B's asset", (w) => ({ assetId: w.b.assetId }))],

  // The Content tab
  'content.createCategory': [c("in B's menu", (w) => ({ menuId: w.b.menuId, names: { en: 'Planted' } }))],
  'content.updateCategory': [
    c("B's category, in B", (w) => ({ menuId: w.b.menuId, categoryId: w.b.categoryId, version: 1, names: { en: 'Planted' }, slug: 'planted', isActive: false })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, categoryId: w.b.categoryId, version: 1, names: { en: 'Planted' }, slug: 'planted', isActive: false })),
  ],
  'content.deleteCategory': [
    c("B's category, in B", (w) => ({ menuId: w.b.menuId, categoryId: w.b.categoryId, version: 1 })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, categoryId: w.b.categoryId, version: 1 })),
  ],
  'content.reorderCategories': [
    c("B's categories, in B", (w) => ({ menuId: w.b.menuId, order: [w.b.categoryId] })),
    c("A's and B's categories, through A", (w) => ({ menuId: w.a.menuId, order: [w.a.categoryId, w.b.categoryId] })),
  ],
  'content.createProduct': [
    c("in B's category, in B", (w) => ({ menuId: w.b.menuId, categoryId: w.b.categoryId, names: { en: 'Planted' }, price: 100 })),
    c("in B's category, through A", (w) => ({ menuId: w.a.menuId, categoryId: w.b.categoryId, names: { en: 'Planted' }, price: 100 })),
  ],
  'content.saveProduct': [
    c("B's product, in B", (w) => productSave(w.b.menuId, w.b.productId, w.b.categoryId)),
    c("B's product, through A", (w) => productSave(w.a.menuId, w.b.productId, w.a.categoryId)),
    c("A's product into B's category", (w) => productSave(w.a.menuId, w.a.productId, w.b.categoryId)),
    c("A's product with B's size", (w) => ({
      ...productSave(w.a.menuId, w.a.productId, w.a.categoryId),
      variants: [{ id: w.b.variantId, version: 1, names: { en: 'Planted' }, priceDelta: 0, isDefault: true }],
    })),
    c("A's product with B's picture", (w) => ({ ...productSave(w.a.menuId, w.a.productId, w.a.categoryId), media: [{ kind: 'asset', assetId: w.b.assetId }] })),
  ],
  'content.deleteProduct': [
    c("B's product, in B", (w) => ({ menuId: w.b.menuId, productId: w.b.productId, version: 1 })),
    c("B's product, through A", (w) => ({ menuId: w.a.menuId, productId: w.b.productId, version: 1 })),
  ],
  'content.moveProduct': [
    c("B's product, in B", (w) => ({ menuId: w.b.menuId, productId: w.b.productId, categoryId: w.b.categoryId, index: 0 })),
    c("B's product into A's category", (w) => ({ menuId: w.a.menuId, productId: w.b.productId, categoryId: w.a.categoryId, index: 0 })),
    c("A's product into B's category", (w) => ({ menuId: w.a.menuId, productId: w.a.productId, categoryId: w.b.categoryId, index: 0 })),
  ],
  'content.tree': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],

  // The Availability tab
  'availability.setProduct': [
    c("B's product, in B", (w) => ({ menuId: w.b.menuId, productId: w.b.productId, isAvailable: false })),
    c("B's product, through A", (w) => ({ menuId: w.a.menuId, productId: w.b.productId, isHidden: true })),
  ],
  'availability.setOption': [
    c("B's option, in B", (w) => ({ menuId: w.b.menuId, optionId: w.b.optionId, isAvailable: false })),
    c("B's option, through A", (w) => ({ menuId: w.a.menuId, optionId: w.b.optionId, isAvailable: false })),
  ],
  'availability.board': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'availability.setStock': [
    c("B's product, in B", (w) => ({ menuId: w.b.menuId, productId: w.b.productId, stockCount: 1 })),
    c("B's product, through A", (w) => ({ menuId: w.a.menuId, productId: w.b.productId, stockCount: 1 })),
  ],

  // The Sales tab
  'sales.rules': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'sales.settings': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'sales.overview': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'sales.saveUpgrade': [
    c("in B's menu", (w) => ({ menuId: w.b.menuId, ...upgradeSave(w.b.productId, w.b.sideProductId) })),
    c("B's dishes, through A", (w) => ({ menuId: w.a.menuId, ...upgradeSave(w.b.productId, w.b.sideProductId) })),
    c("B's rule, through A", (w) => ({ menuId: w.a.menuId, ruleId: w.b.upgradeId, version: 1, ...upgradeSave(w.a.sideProductId, w.a.productId) })),
  ],
  'sales.deleteUpgrade': [
    c("B's rule, in B", (w) => ({ menuId: w.b.menuId, ruleId: w.b.upgradeId, version: 1 })),
    c("B's rule, through A", (w) => ({ menuId: w.a.menuId, ruleId: w.b.upgradeId, version: 1 })),
  ],
  'sales.savePairing': [
    c("in B's menu", (w) => ({ menuId: w.b.menuId, ...pairingSave(w.b.categoryId, w.b.sideProductId) })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, ...pairingSave(w.b.categoryId, w.a.sideProductId) })),
    c("B's rule, through A", (w) => ({ menuId: w.a.menuId, ruleId: w.b.pairingId, version: 1, ...pairingSave(w.a.categoryId, w.a.sideProductId) })),
  ],
  'sales.deletePairing': [
    c("B's rule, in B", (w) => ({ menuId: w.b.menuId, ruleId: w.b.pairingId, version: 1 })),
    c("B's rule, through A", (w) => ({ menuId: w.a.menuId, ruleId: w.b.pairingId, version: 1 })),
  ],
  'sales.saveSet': [
    c("in B's menu", (w) => ({ menuId: w.b.menuId, ...setSave(w.b.productId, w.b.sideProductId) })),
    c("B's dishes, through A", (w) => ({ menuId: w.a.menuId, ...setSave(w.b.productId, w.b.sideProductId) })),
    c("B's set, through A", (w) => ({ menuId: w.a.menuId, bundleId: w.b.setId, version: 1, ...setSave(w.a.productId, w.a.sideProductId) })),
  ],
  'sales.deleteSet': [
    c("B's set, in B", (w) => ({ menuId: w.b.menuId, bundleId: w.b.setId, version: 1 })),
    c("B's set, through A", (w) => ({ menuId: w.a.menuId, bundleId: w.b.setId, version: 1 })),
  ],
  'sales.saveOffer': [
    c("in B's menu", (w) => ({ menuId: w.b.menuId, ...offerSave([w.b.productId], []) })),
    c("B's dish, through A", (w) => ({ menuId: w.a.menuId, ...offerSave([w.b.productId], []) })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, ...offerSave([], [w.b.categoryId]) })),
    c("B's offer, through A", (w) => ({ menuId: w.a.menuId, offerId: w.b.offerId, version: 1, ...offerSave([w.a.productId], []) })),
  ],
  'sales.deleteOffer': [
    c("B's offer, in B", (w) => ({ menuId: w.b.menuId, offerId: w.b.offerId, version: 1 })),
    c("B's offer, through A", (w) => ({ menuId: w.a.menuId, offerId: w.b.offerId, version: 1 })),
  ],
  'sales.reorderOffers': [
    c("B's offers, in B", (w) => ({ menuId: w.b.menuId, order: [w.b.offerId] })),
    c("B's offer, through A", (w) => ({ menuId: w.a.menuId, order: [w.b.offerId] })),
  ],
  'sales.saveSettings': [
    c("in B's menu", (w) => ({ menuId: w.b.menuId, ...salesSettings([]) })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, ...salesSettings([w.b.categoryId]) })),
  ],

  // The Prices tab
  'prices.set': [
    c("B's product, in B", (w) => ({ menuId: w.b.menuId, target: { kind: 'product', id: w.b.productId, version: 1 }, price: 1 })),
    c("B's product, through A", (w) => ({ menuId: w.a.menuId, target: { kind: 'product', id: w.b.productId, version: 1 }, price: 1 })),
    c("B's size, through A", (w) => ({ menuId: w.a.menuId, target: { kind: 'variant', id: w.b.variantId, version: 1 }, price: 1 })),
  ],
  'prices.grid': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'prices.previewBulk': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, ...{ selection: {}, operation: { kind: 'percent', basisPoints: 1000 }, includeVariants: true } })),
    c("B's products, through A", (w) => ({ menuId: w.a.menuId, ...{ selection: { productIds: [w.b.productId] }, operation: { kind: 'percent', basisPoints: 1000 }, includeVariants: true } })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, ...{ selection: { categoryId: w.b.categoryId }, operation: { kind: 'percent', basisPoints: 1000 }, includeVariants: true } })),
  ],
  'prices.applyBulk': [
    c("B's menu", (w) => ({ menuId: w.b.menuId, ...{ selection: {}, operation: { kind: 'percent', basisPoints: 1000 }, includeVariants: true }, expectedDraftHash: '' })),
    c("B's products, through A", (w) => ({ menuId: w.a.menuId, ...{ selection: { productIds: [w.b.productId] }, operation: { kind: 'percent', basisPoints: 1000 }, includeVariants: true }, expectedDraftHash: '' })),
    c("B's category, through A", (w) => ({ menuId: w.a.menuId, ...{ selection: { categoryId: w.b.categoryId }, operation: { kind: 'percent', basisPoints: 1000 }, includeVariants: true }, expectedDraftHash: '' })),
  ],
  'content.product': [
    c("B's product, in B", (w) => ({ menuId: w.b.menuId, productId: w.b.productId })),
    c("B's product, through A", (w) => ({ menuId: w.a.menuId, productId: w.b.productId })),
  ],

  // Reads of one restaurant or menu
  'menus.get': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
  'preview.draft': [c("B's draft", (w) => ({ menuId: w.b.menuId, locale: 'en' }))],
  'preview.planNote': [c("B's draft", (w) => ({ menuId: w.b.menuId }))],
  'menus.slugAvailability': [c("for B's menu", (w) => ({ slug: 'some-new-address', menuId: w.b.menuId }))],
  'people.listPeople': [
    c("B's people", (w) => ({ restaurantId: w.b.restaurantId })),
    c('everyone, on the platform', () => ({})),
    c("everyone, on the platform, searching for B's", () => ({ q: 'bravo' })),
    c("A's people", (w) => ({ restaurantId: w.a.restaurantId }), SHOWS_OWN),
    c("A's people, searching for B's owner", (w) => ({ restaurantId: w.a.restaurantId, q: w.b.ownerEmail }), SCOPED),
  ],
  'people.listInvitations': [
    c("B's invitations", (w) => ({ restaurantId: w.b.restaurantId, status: 'all' })),
    c('every invitation, on the platform', () => ({ status: 'all' })),
    c("A's invitations", (w) => ({ restaurantId: w.a.restaurantId, status: 'all' }), SHOWS_OWN),
  ],
  'people.restaurantMembers': [c("B's members", (w) => ({ restaurantId: w.b.restaurantId }))],
  'people.restaurantPolicy': [c("B's policy", (w) => ({ restaurantId: w.b.restaurantId }))],
  'restaurants.get': [c('B', (w) => ({ restaurantId: w.b.restaurantId }))],
  'restaurants.branches': [c("B's branches", (w) => ({ restaurantId: w.b.restaurantId }))],
  'restaurants.menus': [c("B's menus", (w) => ({ restaurantId: w.b.restaurantId }))],
  'restaurants.activity': [c("B's activity", (w) => ({ restaurantId: w.b.restaurantId }))],
  'restaurants.feedback': [
    c("B's guest messages", (w) => ({ restaurantId: w.b.restaurantId })),
    c("A's guest messages", (w) => ({ restaurantId: w.a.restaurantId }), SHOWS_OWN),
  ],

  // Support access to a pharmacy (`ph` target, `support.grant`, the pharmacy owner's alone). The target is always the
  // named restaurant, never a fallback, so naming B's must be refused: A's people hold no pharmacy role in B. Both sides
  // of this world are FOOD restaurants, so the refusal here is the ph actor check on the named restaurant; isolation
  // between two pharmacies' grants is proven in tests/pharmacy/support.test.ts.
  'support.grant': [
    c('for B', (w) => ({ restaurantId: w.b.restaurantId, granteeEmail: address('root'), scopes: ['catalog.read'], reason: 'Planted', hours: 2 })),
  ],
  'support.revoke': [c('a grant, in B', (w) => ({ restaurantId: w.b.restaurantId, grantId: 'planted-grant' }))],
  'support.listGrants': [c("B's grants", (w) => ({ restaurantId: w.b.restaurantId }))],

  // Reads across the person's own restaurants: they answer, without B
  'menus.list': [
    c('every menu', () => ({}), SHOWS_OWN),
    c("filtered to B's restaurant", (w) => ({ restaurantId: w.b.restaurantId }), SCOPED),
    c("searching for B's name", () => ({ q: 'Bravo' }), SCOPED),
    c("searching for B's client ID", (w) => ({ q: w.b.clientId }), SCOPED),
    c("searching for a name A and B share", () => ({ q: 'Shared' }), SHOWS_OWN),
    c('with unpublished changes, in any status', () => ({ unpublished: true, status: 'PUBLISHED' }), SCOPED),
    c("in B's city", () => ({ city: 'Bravoville' }), SCOPED),
  ],
  'menus.newOptions': [c('the restaurants to create in', () => ({}), SHOWS_OWN)],
  'media.libraries': [c('the libraries to manage', () => ({}), SHOWS_OWN)],
  'overview.get': [c('the overview', () => ({}), SCOPED)],
  'restaurants.list': [
    c('every restaurant', () => ({}), SHOWS_OWN),
    c("searching for B's name", () => ({ q: 'Bravo' }), SCOPED),
    c("searching for B's client ID", (w) => ({ q: w.b.clientId }), SCOPED),
    c("in B's city", () => ({ city: 'Bravoville' }), SCOPED),
  ],
  'search.jump': [
    c('a name A and B share', () => ({ q: 'Shared' }), SHOWS_OWN),
    c("B's client ID", (w) => ({ q: w.b.clientId }), SCOPED),
    c("B's address", (w) => ({ q: w.b.slug }), SCOPED),
  ],
  'search.restaurants': [c('everything', () => ({ q: '' }), SHOWS_OWN), c("B's name", () => ({ q: 'Bravo' }), SCOPED)],
  'search.menus': [c('everything', () => ({ q: '' }), SHOWS_OWN), c("B's name", () => ({ q: 'Bravo' }), SCOPED)],
};

/**
 * Exempt from the sweep: platform-only definitions. They name no restaurant of their own and need a permission only
 * Super Admins hold (no client policy can grant it), so they are refused outright for anyone else, here with inputs that
 * name B.
 */
const PLATFORM_ONLY: Record<string, Case[]> = {
  'billing.restaurants': [c('the billing list', () => ({}), ONLY_FORBIDDEN)],
  'pos.overview': [c('the cashier overview', () => ({}), ONLY_FORBIDDEN)],
  // The platform's pharmacy list (`platform.settings`): it names no restaurant, so A's people are refused it outright.
  'pharmacies.list': [c('the pharmacy list', () => ({}), ONLY_FORBIDDEN)],
  'pos.setAiPackage': [c("switching on B's AI package", (w) => ({ restaurantId: w.b.restaurantId, enabled: true, monthlyLimit: 1000 }), ONLY_FORBIDDEN)],
  'restaurants.create': [c('a restaurant', () => ({ name: 'Bravo Annex', type: 'CAFE' }), ONLY_FORBIDDEN)],
  // The platform's intro background and adverts (`platform.settings`).
  'platform.intro': [c('the platform intro', () => ({}), ONLY_FORBIDDEN)],
  'platform.saveIntroDefault': [c('a default background', (w) => ({ backgroundAssetId: w.b.assetId }), ONLY_FORBIDDEN)],
  'platform.savePlatformAdvert': [c('an advert for B', (w) => ({ imageAssetId: w.b.assetId, alts: {}, href: '', startsAt: null, endsAt: null, active: true, restaurantIds: [w.b.restaurantId] }), ONLY_FORBIDDEN)],
  'platform.reorderPlatformAdverts': [c('the adverts', () => ({ ids: [] }), ONLY_FORBIDDEN)],
  'platform.deletePlatformAdvert': [c('an advert', () => ({ advertId: 'nope' }), ONLY_FORBIDDEN)],
  'restaurants.newAccess': [c('the new restaurant form', () => ({}), ONLY_FORBIDDEN)],
  'people.inviteStaff': [c('a Super Admin', () => ({ email: address('planted-admin'), asSuperAdmin: true }), ONLY_FORBIDDEN)],
  'people.deactivateUser': [c("B's owner", (w) => ({ userId: w.b.ownerId }), ONLY_FORBIDDEN)],
  'people.reactivateUser': [c("B's owner", (w) => ({ userId: w.b.ownerId }), ONLY_FORBIDDEN)],
  'people.changeUserEmail': [c("B's owner", (w) => ({ userId: w.b.ownerId, email: address('planted-email') }), ONLY_FORBIDDEN)],
  'settings.update': [
    c(
      "reserving B's address",
      (w) => ({
        reservedSlugs: [w.b.slug],
        emailSenderName: 'Planted Sender',
        defaults: { locales: ['en'], defaultLocale: 'en', currency: 'USD', timezone: 'Asia/Baghdad' },
      }),
      ONLY_FORBIDDEN,
    ),
  ],
  'announcements.list': [c('the announcements', () => ({}), ONLY_FORBIDDEN)],
  'announcement.create': [c('an announcement', () => ({ titles: { en: 'Planted' }, bodies: { en: 'Planted' } }), ONLY_FORBIDDEN)],
  'announcement.update': [c('an announcement', () => ({ id: 'nope', titles: { en: 'Planted' }, bodies: { en: 'Planted' } }), ONLY_FORBIDDEN)],
  'announcement.archive': [c('an announcement', () => ({ id: 'nope' }), ONLY_FORBIDDEN)],
  'settings.get': [c('the settings', () => ({}), ONLY_FORBIDDEN)],
  'plans.get': [c('the plans', () => ({}), ONLY_FORBIDDEN)],
  'plans.update': [c('giving Basic Explore', () => ({ plans: { BASIC: { features: { 'immersive.explore': true } } }, whatsapp: '' }), ONLY_FORBIDDEN)],
  'activity.list': [c("B's activity", (w) => ({ restaurantId: w.b.restaurantId }), ONLY_FORBIDDEN)],
  'search.people': [c("B's people", () => ({ q: 'bravo' }), ONLY_FORBIDDEN)],
  // The pharmacy plans: the platform owner's alone to write (`plans.manage`), any Super Admin's to read
  'appPlans.list': [c('the pharmacy plans', () => ({}), ONLY_FORBIDDEN)],
  'appPlans.upsert': [
    c(
      'a pharmacy plan',
      () => ({ code: 'planted', name: { en: 'Planted', ar: 'Planted', ckb: 'Planted' }, limits: { branches: 1, users: 1, storageMb: 1, aiMonthlyBudgetMinor: 0 } }),
      ONLY_FORBIDDEN,
    ),
  ],
  'appPlans.deactivate': [c('a pharmacy plan', () => ({ code: 'planted', version: 1 }), ONLY_FORBIDDEN)],
  // Platform staff recording a pharmacy owner's written consent (`people.manage`), here for B
  'support.recordConsent': [
    c(
      'a support grant for B',
      (w) => ({ restaurantId: w.b.restaurantId, granteeEmail: address('root'), scopes: ['catalog.read'], reason: 'Planted', hours: 2, consentRef: 'Planted consent 0001' }),
      ONLY_FORBIDDEN,
    ),
  ],
  // Billing: the platform owner's alone (`plans.manage`) or any Super Admin's to read (`platform.settings`)
  'ai.settings': [c('the AI provider settings', () => ({}), ONLY_FORBIDDEN)],
  'billing.overview': [c('the products and prices', () => ({}), ONLY_FORBIDDEN)],
  'billing.restaurant': [c("B's subscriptions and payments", (w) => ({ restaurantId: w.b.restaurantId }), ONLY_FORBIDDEN)],
  'ai.saveSettings': [c('saving a key', () => ({ provider: 'openai', anthropic: {}, openai: { apiKey: 'sk-planted-key-0000000000000' } }), ONLY_FORBIDDEN)],
  'ai.testProvider': [c('testing the provider', () => ({}), ONLY_FORBIDDEN)],
  'billing.setApplication': [c('turning the Menu off', () => ({ applicationId: 'menu', name: { en: 'Planted', ar: 'Planted', ckb: 'Planted' }, status: 'DISABLED' }), ONLY_FORBIDDEN)],
  'billing.setPrices': [c("B's plan's prices", () => ({ applicationId: 'menu', planCode: 'PREMIUM', prices: [] }), ONLY_FORBIDDEN)],
  'billing.startTrial': [
    c("a trial for B's restaurant", (w) => ({ restaurantId: w.b.restaurantId, applicationId: 'menu', planCode: 'BASIC', trialDays: 14, period: 'MONTHLY', currency: 'IQD' }), ONLY_FORBIDDEN),
  ],
  'billing.changePlan': [
    c("B's subscription", (w) => ({ restaurantId: w.b.restaurantId, subscriptionId: w.b.subscriptionId, version: 1, planCode: 'BASIC', keepPrice: true }), ONLY_FORBIDDEN),
    c("B's subscription, through A", (w) => ({ restaurantId: w.a.restaurantId, subscriptionId: w.b.subscriptionId, version: 1, planCode: 'BASIC', keepPrice: true }), ONLY_FORBIDDEN),
  ],
  'billing.cancel': [c("B's subscription", (w) => ({ restaurantId: w.b.restaurantId, subscriptionId: w.b.subscriptionId, version: 1, reason: 'Planted' }), ONLY_FORBIDDEN)],
  'billing.reactivate': [c("B's subscription", (w) => ({ restaurantId: w.b.restaurantId, subscriptionId: w.b.subscriptionId, version: 1 }), ONLY_FORBIDDEN)],
  'billing.recordPayment': [
    c(
      "a payment for B's subscription",
      (w) => ({ restaurantId: w.b.restaurantId, subscriptionId: w.b.subscriptionId, amountMinor: 1, paidAt: new Date().toISOString(), idempotencyKey: randomUUID() }),
      ONLY_FORBIDDEN,
    ),
  ],
};

/**
 * Exempt from the sweep: the person's own account (`self` target, `permission: null`). They are keyed by the actor and
 * the request's own session, never by an id from the input, so they are run with inputs that name B and must touch and
 * show nothing of B.
 */
const SELF: Record<string, Case[]> = {
  'account.startTwoFactorSetup': [c('with a wrong password', () => ({ password: 'not the password at all' }), { kind: 'self' })],
  'account.confirmTwoFactor': [c('with a code', () => ({ code: '123456' }), { kind: 'self' })],
  'account.regenerateRecoveryCodes': [c('with a wrong password', () => ({ password: 'not the password at all' }), { kind: 'self' })],
  'account.disableTwoFactor': [c('with a wrong password', () => ({ password: 'not the password at all' }), { kind: 'self' })],
  'account.changePassword': [c('with a wrong password', () => ({ current: 'not the password at all', next: 'another long passphrase 2027' }), { kind: 'self' })],
  'account.requestEmailChange': [c("to B's owner's address", (w) => ({ newEmail: w.b.ownerEmail }), { kind: 'self' })],
  'account.setAppearance': [c('a look', () => ({ font: 'serif', bg: '#ffffff', text: '#111111', button: '#000000', buttonText: '#ffffff', shape: 'round' }), { kind: 'self', code: 'OK' })],
  'account.resetAppearance': [c('the default look', () => ({}), { kind: 'self', code: 'OK' })],
  'announcements.active': [c('the active announcements', () => ({}), { kind: 'self', code: 'OK' })],
  'account.setStudioLanguage': [c('to Arabic', () => ({ locale: 'ar' }), { kind: 'self', code: 'OK' })],
  'account.endSession': [c("B's owner's session", (w) => ({ sessionId: w.b.ownerSessionId }), { kind: 'self', code: 'NOT_FOUND' })],
  'account.endOtherSessions': [c('the other sessions', () => ({}), { kind: 'self', code: 'OK' })],
  'account.myRestaurants': [c('my restaurants', () => ({}), { kind: 'self', code: 'OK' })],
  'account.listMySessions': [c('my sessions', () => ({}), { kind: 'self', code: 'OK' })],
};

// Running -------------------------------------------------------------------------------------------------------------

let world: World;
const actors: Record<'owner' | 'designer', Actor> = {} as never;
const browsers: Record<'owner' | 'designer', Browser> = {} as never;

const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

function runAs(actor: Actor, def: Definition, input: unknown): Promise<ActionResult<unknown>> {
  return def.kind === 'action' ? runAction(prisma(), actor, def, input, META) : runQuery(prisma(), actor, def, input);
}

/** Runs one case as the owner and as the designer of A, and checks what it answered and that B is as it was. */
async function check(name: string, testCase: Case): Promise<void> {
  const def = DEFINITIONS.get(name);
  if (!def) throw new Error(`No Studio definition is called ${name}`);
  const expectation = testCase.expect ?? REFUSED;
  for (const who of ['owner', 'designer'] as const) {
    const label = `${name} (${testCase.label}) as the ${who} of A`;
    browsers[who].activate();
    const before = await snapshotOfB(world);
    const result = await runAs(actors[who], def, testCase.input(world));
    const code = codeOf(result);

    // What the result says, less what it only repeats from the input: each item of a many-menu result names its menu.
    let shown: unknown = result;
    switch (expectation.kind) {
      case 'refused':
        expect(expectation.codes ?? ['NOT_FOUND', 'FORBIDDEN'], `${label} answered ${code}`).toContain(code);
        break;
      case 'scoped':
        expect(code, label).toBe('OK');
        if (expectation.showsOwn) expect(JSON.stringify(result), `${label} shows nothing of A`).toMatch(/Alpha/);
        break;
      case 'perItem': {
        expect(code, label).toBe('OK');
        const { results } = (result as { data: { results: Array<{ menuId: string; ok: boolean; code?: string }> } }).data;
        expect(results.length, label).toBeGreaterThan(0);
        for (const item of results) expect(['NOT_FOUND', 'FORBIDDEN'], `${label}: an item answered ${item.code ?? 'OK'}`).toContain(item.code);
        shown = results.map((item) => ({ ok: item.ok, code: item.code }));
        break;
      }
      case 'self':
        if (expectation.code) expect(code, label).toBe(expectation.code);
        break;
    }
    expect(tracesOfB(world, shown), `${label} shows something of B`).toEqual([]);
    expect(await snapshotOfB(world), `${label} changed something of B`).toEqual(before);
  }
}

beforeAll(async () => {
  requireTestDb();
  vi.stubEnv('DATABASE_URL', databaseUrl(TEST_DB));
  vi.stubEnv('RESEND_API_KEY', '');
  await resetTestData(prisma());
  world = await buildWorld();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Signed in, in browsers of their own: the account actions work on the session the request carries.
  for (const [who, id] of [['owner', world.a.ownerId], ['designer', world.a.designerId]] as const) {
    browsers[who] = new Browser(who === 'owner' ? '198.51.100.71' : '198.51.100.72', `vitest ${who}`).activate();
    const email = (await prisma().user.findUniqueOrThrow({ where: { id } })).email;
    const signedIn = await invokePublic(session.signIn, { email, password: GOOD });
    if (!signedIn.ok) throw new Error(`The ${who} of A could not sign in: ${JSON.stringify(signedIn.error)}`);
    actors[who] = (await loadActor(prisma(), id)) as Actor;
  }
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await quiet();
  await clean();
  await resetTestData(prisma());
  await prisma().$disconnect();
  delete globalForPrisma.__prisma;
  vi.unstubAllEnvs();
});

/**
 * The till's definitions take no restaurant from their input: the framework resolves it from the person's own staff row or
 * membership. Their cross-tenant behavior (another restaurant's staff ids, settings that follow the actor) is proven in
 * tests/pos/staff.test.ts and tests/pos/settings.test.ts.
 */
const TILL = ['pos.updateSettings', 'pos.createStaff', 'pos.changeStaffRole', 'pos.setStaffActive', 'pos.settings', 'pos.staff', 'pos.ensureCatalogMenu', 'pos.chooseCatalogMenu', 'pos.catalogMenu',
  'pos.createCategory', 'pos.updateCategory', 'pos.deleteCategory', 'pos.createProduct', 'pos.saveProductBasics', 'pos.deleteProduct', 'pos.setAvailability',
  'pos.createKitchenSection', 'pos.renameKitchenSection', 'pos.deleteKitchenSection', 'pos.setCategorySection', 'pos.setProductSetting', 'pos.catalogEditor',
  'pos.importPreview', 'pos.importAiPreview', 'pos.importAiPhotos', 'pos.importAiTranslate', 'pos.importApply', 'pos.importDiscard',
  'pos.createArea', 'pos.renameArea', 'pos.deleteArea', 'pos.createTables', 'pos.deleteTable', 'pos.moveTable', 'pos.floor',
  'pos.openShift', 'pos.addExpense', 'pos.closeShift', 'pos.myShift', 'pos.shift', 'pos.openShifts', 'pos.sendToKitchen', 'pos.markReady', 'pos.acknowledgeCancellations', 'pos.kitchenScope', 'pos.kitchenQueue', 'pos.kitchenTicket', 'pos.orderKitchenTicket', 'pos.shiftReport', 'pos.dailyReport', 'pos.board', 'pos.tillCatalog', 'pos.payOrder', 'pos.reversePayment', 'pos.setOwnPin', 'pos.clearStaffPin', 'pos.registerDevice', 'pos.revokeDevice', 'pos.devices', 'pos.receipt', 'pos.openOrder', 'pos.addLine', 'pos.updateLine', 'pos.cancelLine', 'pos.setInvoiceDiscount', 'pos.requestBill', 'pos.cancelOrder', 'pos.moveOrderToTable', 'pos.order', 'pos.acceptRequest', 'pos.rejectRequest', 'pos.setRequestLineQuantity', 'pos.removeRequestLine', 'pos.requests', 'pos.request', 'pos.ensureMenuTables', 'pos.qrSheet', 'pos.qrFlags', 'pos.createZone', 'pos.updateZone', 'pos.deleteZone', 'pos.createDriver', 'pos.updateDriver', 'pos.deliverySetup', 'pos.deliveryOptions', 'pos.approvers', 'pos.breakdown', 'pos.idleMinutes', 'pos.activity', 'pos.mergeOrders', 'pos.openOffPremiseOrder', 'pos.updateOffPremiseDetails', 'pos.recentCustomer', 'pos.advanceFulfillment', 'pos.assignDriver', 'pos.offPremiseBoard', 'pos.offPremiseFlags', 'pos.createItem', 'pos.updateItem', 'pos.adjustStock', 'pos.recordWaste', 'pos.recordStockCount', 'pos.setRecipe', 'pos.createSupplier', 'pos.updateSupplier', 'pos.createPurchase', 'pos.voidPurchase', 'pos.setPurchasePaid', 'pos.inventoryItems', 'pos.lowStock', 'pos.inventoryItem', 'pos.suppliers', 'pos.purchases', 'pos.purchase', 'pos.recipes', 'pos.recipe', 'pos.rangeReport', 'pos.setComplaintStatus', 'pos.addComplaintNote', 'pos.removeComplaintContact', 'pos.complaints', 'pos.complaint', 'pos.complaintBadge',
  'pos.aiAsk', 'pos.aiPhraseSummary', 'pos.aiLabelComplaints', 'pos.aiSupplyExtract', 'pos.aiState', 'pos.aiSummary', 'pos.aiAlerts', 'pos.aiComplaintLabels',
  'pos.syncSnapshot', 'pos.discardSyncOperation', 'pos.restaurantLogo',
  'pos.savePrinter', 'pos.removePrinter', 'pos.openDrawer', 'pos.logReprint', 'pos.setProductBarcode', 'pos.printers', 'pos.sectionList', 'pos.expo',
];

describe('the cross-tenant sweep', () => {
  it('has an entry for every Studio action and query, in exactly one table, and none for one that does not exist', () => {
    expect(DEFINITIONS.size).toBeGreaterThan(50);
    const tables = [SWEPT, PLATFORM_ONLY, SELF].map((table) => Object.keys(table)).concat([TILL]);
    const listed = tables.flat();
    expect([...DEFINITIONS.keys()].filter((name) => !listed.includes(name)), 'definitions without an entry').toEqual([]);
    expect(listed.filter((name) => !DEFINITIONS.has(name)), 'entries for no definition').toEqual([]);
    expect(listed.filter((name, index) => listed.indexOf(name) !== index), 'entries in two tables').toEqual([]);
  });

  it('lists as platform-only only what needs a permission no client policy grants, on the platform', () => {
    for (const name of Object.keys(PLATFORM_ONLY)) {
      const def = DEFINITIONS.get(name)!;
      expect(def.target({} as never), name).toEqual({ kind: 'platform' });
      expect(NEVER_GRANTABLE, name).toContain(def.permission);
    }
  });

  it('lists as till only what names a till permission and the pos target', () => {
    for (const name of TILL) {
      const def = DEFINITIONS.get(name) as unknown as { pos?: string; permission: unknown; target(input: never): unknown };
      expect(def.pos, name).toBeTruthy();
      expect(def.permission, name).toBeNull();
      expect(def.target(undefined as never), name).toMatchObject({ kind: 'pos' });
    }
  });

  it('lists as self only what works on the person’s own account', () => {
    for (const name of Object.keys(SELF)) {
      const def = DEFINITIONS.get(name)!;
      expect(def.permission, name).toBeNull();
      expect(def.target(undefined as never), name).toEqual({ kind: 'self' });
    }
  });

  it.each(Object.keys(SWEPT))('refuses %s anything of B, as an owner and as a designer of A', async (name) => {
    for (const testCase of SWEPT[name]!) await check(name, testCase);
  });

  it.each(Object.keys(PLATFORM_ONLY))('refuses %s to owners and designers (platform only)', async (name) => {
    for (const testCase of PLATFORM_ONLY[name]!) await check(name, testCase);
  });

  it.each(Object.keys(SELF))('lets %s touch only the person’s own account', async (name) => {
    for (const testCase of SELF[name]!) await check(name, testCase);
  });

  it('is not passing because A can do nothing: the same people may act in A', async () => {
    browsers.owner.activate();
    const created = await runAs(actors.owner, DEFINITIONS.get('restaurants.createBranch')!, { restaurantId: world.a.restaurantId, name: 'Alpha Annex' });
    expect(codeOf(created)).toBe('OK');
    const read = await runAs(actors.designer, DEFINITIONS.get('menus.get')!, { menuId: world.a.menuId });
    expect(codeOf(read)).toBe('OK');
  });
});
