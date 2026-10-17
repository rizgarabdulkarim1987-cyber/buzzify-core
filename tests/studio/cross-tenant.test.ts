/// <reference types="vite/client" />
import { randomBytes } from 'node:crypto';
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
 * the first test. A's client policy grants every grantable permission to both roles, so a refusal in B is never owed to a
 * permission A's people lack.
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
  await prisma().product.create({
    data: { menuId: menu.id, categoryId: category.id, slug: `${label}-stew`, basePrice: 900, translations: { en: { name: `${title} stew`, description: 'Slow' } } },
  });
  await publishFixture(prisma(), menu.id);
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
  };
}

async function buildWorld(): Promise<World> {
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
    }),
  );
}

/** What of B's a result must never show: its ids, its client ID, and its names (every one of them says Bravo). */
function tracesOfB(w: World, value: unknown): string[] {
  const text = JSON.stringify(value) ?? '';
  const { b } = w;
  const markers = [b.restaurantId, b.menuId, b.branchId, b.invitationId, b.staffInvitationId, b.ownerSessionId, b.ownerId, b.designerId, b.clientId];
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

/** Definitions that act on, or read, restaurants and menus: each is run against B. */
const SWEPT: Record<string, Case[]> = {
  // Menus
  'menus.create': [c("in B's restaurant", (w) => ({ restaurantId: w.b.restaurantId, name: 'Planted', slug: 'planted-menu' }))],
  'menus.publish': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
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
  'restaurants.update': [c('B', (w) => ({ restaurantId: w.b.restaurantId, version: 1, name: 'Hijacked', type: 'RESTAURANT' }))],
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

  // Reads of one restaurant or menu
  'menus.get': [c("B's menu", (w) => ({ menuId: w.b.menuId }))],
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
  'restaurants.create': [c('a restaurant', () => ({ name: 'Bravo Annex', type: 'CAFE' }), ONLY_FORBIDDEN)],
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
  'settings.get': [c('the settings', () => ({}), ONLY_FORBIDDEN)],
  'activity.list': [c("B's activity", (w) => ({ restaurantId: w.b.restaurantId }), ONLY_FORBIDDEN)],
  'search.people': [c("B's people", () => ({ q: 'bravo' }), ONLY_FORBIDDEN)],
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

describe('the cross-tenant sweep', () => {
  it('has an entry for every Studio action and query, in exactly one table, and none for one that does not exist', () => {
    expect(DEFINITIONS.size).toBeGreaterThan(50);
    const tables = [SWEPT, PLATFORM_ONLY, SELF].map((table) => Object.keys(table));
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
