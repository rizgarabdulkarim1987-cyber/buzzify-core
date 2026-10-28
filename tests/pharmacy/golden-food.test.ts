import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { getCatalog, resolvePublicMenu } from '@/server/data/public-menu';
import { effectivePermissions, PERMISSIONS, type MemberRole, type PermissionPolicy } from '@/server/domain/permissions';
import type { Actor } from '@/server/studio/auth/actor';
import { visibleNav } from '@/studio/nav';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createMenuFixture } from '../helpers/db';
import { posGate, resolvePosActor } from '@/server/pos/actor';
import { DAY, person as fixturePerson, pharmacy, resetWorld, useTestDatabase } from './fixture';

/** Queries a FOOD till's actor and gate took before the pharmacy plan (59d9cf5's src/server/pos/actor.ts). */
const POS_QUERIES = { actor: 4, gate: 2 };

// The golden snapshots of what a menu-only or cashier-only restaurant (sector FOOD) does today. They were computed
// from the permission and navigation code before the pharmacy plan touched anything, and are stored here as literals:
// a change to any of them is a change to FOOD behaviour and must be a decision, not a side effect.

const SET_1: string[] = ['audit.view', 'brand.edit', 'content.availability', 'content.edit', 'content.media', 'content.prices', 'export.run', 'import.run', 'media.manage', 'menu.create', 'menu.delete', 'menu.duplicate', 'menu.settings', 'menu.status', 'people.invite', 'people.manage', 'permissions.manage', 'platform.settings', 'prices.bulk', 'publish.now', 'publish.rollback', 'publish.schedule', 'qr.manage', 'restaurant.create', 'restaurant.delete', 'restaurant.edit', 'restaurant.status'];
const SET_2: string[] = ['audit.view', 'brand.edit', 'content.availability', 'content.edit', 'content.media', 'content.prices', 'export.run', 'import.run', 'media.manage', 'menu.create', 'menu.delete', 'menu.duplicate', 'menu.settings', 'menu.status', 'people.invite', 'people.manage', 'permissions.manage', 'plans.manage', 'platform.settings', 'prices.bulk', 'publish.now', 'publish.rollback', 'publish.schedule', 'qr.manage', 'restaurant.create', 'restaurant.delete', 'restaurant.edit', 'restaurant.status'];
const SET_3: string[] = ['brand.edit', 'content.availability', 'content.edit', 'content.media', 'content.prices', 'export.run', 'import.run', 'media.manage', 'menu.create', 'menu.duplicate', 'menu.settings', 'menu.status', 'prices.bulk', 'publish.now', 'publish.rollback', 'publish.schedule', 'qr.manage', 'restaurant.edit'];
const SET_4: string[] = ['brand.edit', 'content.availability', 'content.edit', 'content.media', 'content.prices', 'export.run', 'import.run', 'media.manage', 'menu.create', 'menu.duplicate', 'menu.settings', 'menu.status', 'prices.bulk', 'publish.now', 'publish.rollback', 'publish.schedule', 'qr.manage', 'restaurant.edit', 'restaurant.status'];
const SET_5: string[] = ['brand.edit', 'content.availability', 'content.edit', 'content.media', 'content.prices', 'export.run', 'import.run', 'media.manage', 'menu.create', 'menu.duplicate', 'menu.settings', 'menu.status', 'prices.bulk', 'publish.rollback', 'publish.schedule', 'restaurant.edit'];
const SET_6: string[] = ['content.availability', 'content.edit', 'content.media', 'content.prices', 'prices.bulk', 'publish.now'];
const SET_7: string[] = ['content.availability', 'content.edit', 'content.media', 'content.prices', 'menu.create', 'publish.now', 'publish.schedule'];

/** Keyed role|superAdmin|platformOwner|policy; each value is the sorted list of permissions held. */
const GOLDEN: Record<string, string[]> = {
  'none|sa=false|po=false|none': [],
  'none|sa=false|po=false|grantAll': [],
  'none|sa=false|po=false|revokeAll': [],
  'none|sa=false|po=false|mixed': [],
  'none|sa=false|po=true|none': [],
  'none|sa=false|po=true|grantAll': [],
  'none|sa=false|po=true|revokeAll': [],
  'none|sa=false|po=true|mixed': [],
  'none|sa=true|po=false|none': SET_1,
  'none|sa=true|po=false|grantAll': SET_1,
  'none|sa=true|po=false|revokeAll': SET_1,
  'none|sa=true|po=false|mixed': SET_1,
  'none|sa=true|po=true|none': SET_2,
  'none|sa=true|po=true|grantAll': SET_2,
  'none|sa=true|po=true|revokeAll': SET_2,
  'none|sa=true|po=true|mixed': SET_2,
  'DESIGNER|sa=false|po=false|none': SET_3,
  'DESIGNER|sa=false|po=false|grantAll': SET_4,
  'DESIGNER|sa=false|po=false|revokeAll': [],
  'DESIGNER|sa=false|po=false|mixed': SET_5,
  'DESIGNER|sa=false|po=true|none': SET_3,
  'DESIGNER|sa=false|po=true|grantAll': SET_4,
  'DESIGNER|sa=false|po=true|revokeAll': [],
  'DESIGNER|sa=false|po=true|mixed': SET_5,
  'DESIGNER|sa=true|po=false|none': SET_1,
  'DESIGNER|sa=true|po=false|grantAll': SET_1,
  'DESIGNER|sa=true|po=false|revokeAll': SET_1,
  'DESIGNER|sa=true|po=false|mixed': SET_1,
  'DESIGNER|sa=true|po=true|none': SET_2,
  'DESIGNER|sa=true|po=true|grantAll': SET_2,
  'DESIGNER|sa=true|po=true|revokeAll': SET_2,
  'DESIGNER|sa=true|po=true|mixed': SET_2,
  'OWNER|sa=false|po=false|none': SET_6,
  'OWNER|sa=false|po=false|grantAll': SET_4,
  'OWNER|sa=false|po=false|revokeAll': [],
  'OWNER|sa=false|po=false|mixed': SET_7,
  'OWNER|sa=false|po=true|none': SET_6,
  'OWNER|sa=false|po=true|grantAll': SET_4,
  'OWNER|sa=false|po=true|revokeAll': [],
  'OWNER|sa=false|po=true|mixed': SET_7,
  'OWNER|sa=true|po=false|none': SET_1,
  'OWNER|sa=true|po=false|grantAll': SET_1,
  'OWNER|sa=true|po=false|revokeAll': SET_1,
  'OWNER|sa=true|po=false|mixed': SET_1,
  'OWNER|sa=true|po=true|none': SET_2,
  'OWNER|sa=true|po=true|grantAll': SET_2,
  'OWNER|sa=true|po=true|revokeAll': SET_2,
  'OWNER|sa=true|po=true|mixed': SET_2,
};

const POLICIES: Record<string, PermissionPolicy> = {
  none: {},
  grantAll: { DESIGNER: { grant: [...PERMISSIONS], revoke: [] }, OWNER: { grant: [...PERMISSIONS], revoke: [] } },
  revokeAll: { DESIGNER: { grant: [], revoke: [...PERMISSIONS] }, OWNER: { grant: [], revoke: [...PERMISSIONS] } },
  mixed: {
    DESIGNER: { grant: ['restaurant.delete', 'audit.view'], revoke: ['qr.manage', 'publish.now'] },
    OWNER: { grant: ['menu.create', 'brand.edit', 'publish.schedule'], revoke: ['prices.bulk', 'brand.edit'] },
  },
};

describe('golden: permissions', () => {
  it('golden: effectivePermissions for every existing role and flag combination is unchanged', () => {
    const actual: Record<string, string[]> = {};
    for (const role of [null, 'DESIGNER', 'OWNER'] as (MemberRole | null)[]) {
      for (const sa of [false, true]) {
        for (const po of [false, true]) {
          for (const [policyName, policy] of Object.entries(POLICIES)) {
            const held = effectivePermissions({ isSuperAdmin: sa, isPlatformOwner: po, role, policy });
            actual[`${role ?? 'none'}|sa=${sa}|po=${po}|${policyName}`] = [...held].sort();
          }
        }
      }
    }
    expect(actual).toEqual(GOLDEN);
  });
});

const base = { userId: 'u', email: 'e@x.test', name: 'P', twoFactorEnabled: true, locale: 'en', isPlatformOwner: false } as const;
const person = (over: Partial<Actor>): Actor => ({ ...base, isSuperAdmin: false, memberships: [], ...over });

describe('golden: the Studio navigation', () => {
  it('golden: the Studio nav items for a Super Admin, an owner and a designer of a FOOD restaurant are unchanged', () => {
    expect(visibleNav(person({ isSuperAdmin: true }))).toEqual(
      [
    {
      key: 'overview',
      href: '/studio',
      labelKey: 'nav.overview',
      icon: 'overview',
      exact: true
    },
    {
      key: 'restaurants',
      href: '/studio/restaurants',
      labelKey: 'nav.restaurants',
      icon: 'restaurants'
    },
    {
      key: 'billing',
      href: '/studio/billing',
      labelKey: 'nav.billing',
      icon: 'billing'
    },
    {
      key: 'cashierOverview',
      href: '/studio/cashier',
      labelKey: 'nav.cashierOverview',
      icon: 'store'
    },
    // Added deliberately on 2026-10-27 (feat(studio): Pharmacy section in the sidebar): the Super Admin's one new
    // item. The owner's and the designer's navigation below are unchanged.
    {
      key: 'pharmacies',
      href: '/studio/pharmacies',
      labelKey: 'nav.pharmacies',
      icon: 'pharmacy'
    },
    {
      key: 'menus',
      href: '/studio/menus',
      labelKey: 'nav.menus',
      icon: 'menus'
    },
    {
      key: 'media',
      href: '/studio/media',
      labelKey: 'nav.media',
      icon: 'media'
    },
    {
      key: 'motion',
      href: '/studio/motion',
      labelKey: 'nav.motion',
      icon: 'motion'
    },
    {
      key: 'people',
      href: '/studio/people',
      labelKey: 'nav.people',
      icon: 'people'
    },
    // Added on main by the announcements feature (docs/superpowers/specs/2026-10-26-staff-appearance-logo-announcements-design.md): a Super Admin area.
    {
      key: 'announcements',
      href: '/studio/announcements',
      labelKey: 'nav.announcements',
      icon: 'announcements'
    },
    // Added by the menu intro feature (docs/superpowers/specs/2026-10-29-menu-intro-design.md): the Super Admin's adverts page.
    {
      key: 'platformIntro',
      href: '/studio/platform/intro',
      labelKey: 'nav.platformIntro',
      icon: 'media'
    },
    {
      key: 'activity',
      href: '/studio/activity',
      labelKey: 'nav.activity',
      icon: 'activity'
    },
    {
      key: 'settings',
      href: '/studio/settings',
      labelKey: 'nav.settings',
      icon: 'settings'
    }
  ],
    );
    expect(visibleNav(person({ memberships: [{ restaurantId: 'r1', role: 'OWNER' }] }), [{ id: 'r1', name: 'Bistro', menuIds: ['m1'] }])).toEqual(
      [
    {
      key: 'myRestaurant',
      href: '/studio/menus/m1',
      labelKey: 'nav.myRestaurant',
      icon: 'store',
      match: [
        '/studio/restaurants/r1',
        '/studio/menus/m1'
      ]
    }
  ],
    );
    expect(visibleNav(person({ memberships: [{ restaurantId: 'r1', role: 'DESIGNER' }] }))).toEqual(
      [
    {
      key: 'overview',
      href: '/studio',
      labelKey: 'nav.overview',
      icon: 'overview',
      exact: true
    },
    {
      key: 'restaurants',
      href: '/studio/restaurants',
      labelKey: 'nav.restaurants',
      icon: 'restaurants'
    },
    {
      key: 'menus',
      href: '/studio/menus',
      labelKey: 'nav.menus',
      icon: 'menus'
    },
    {
      key: 'media',
      href: '/studio/media',
      labelKey: 'nav.media',
      icon: 'media'
    },
    {
      key: 'motion',
      href: '/studio/motion',
      labelKey: 'nav.motion',
      icon: 'motion'
    }
  ],
    );
  });
});

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const makeLogged = () =>
  new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl(TEST_DB) }), log: [{ emit: 'event' as const, level: 'query' as const }] });
let logged: ReturnType<typeof makeLogged>;
const queries: string[] = [];

describe('golden: the public menu', () => {
  beforeAll(() => {
    useTestDatabase();
    logged = makeLogged();
    logged.$on('query', (event) => queries.push(event.query));
    globalForPrisma.__prisma = logged;
  });
  beforeEach(resetWorld);
  afterAll(async () => {
    await logged.$disconnect();
    delete globalForPrisma.__prisma;
  });

  it("golden: a FOOD restaurant's public menu loader issues no query on a Ph table", async () => {
    await createMenuFixture(logged, 'golden-food');
    queries.length = 0;
    const resolved = await resolvePublicMenu('golden-food');
    expect(resolved.kind).toBe('live');
    if (resolved.kind !== 'live') return;
    await getCatalog(resolved.tenant);
    // The log is live: the loader did query, and none of it touched a pharmacy table.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.filter((sql) => /"Ph[A-Z][A-Za-z]*"/.test(sql))).toEqual([]);
  });

  // The counts are those of the code before the pharmacy plan (59d9cf5): the till of a FOOD restaurant must not pay a
  // round trip for the pharmacy sector.
  it("golden: a FOOD till resolves its actor and gate in the same number of queries as before the pharmacy plan", async () => {
    const cafe = await pharmacy('Golden cafe', { sector: 'FOOD', subscription: 'none' });
    await logged.subscription.create({
      data: {
        restaurantId: cafe.id,
        applicationId: 'cashier',
        planCode: 'standard',
        status: 'ACTIVE',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(Date.now() - 5 * DAY),
        currentPeriodEnd: new Date(Date.now() + 25 * DAY),
        graceDays: 7,
        version: 1,
      },
    });
    const owner = await fixturePerson('golden-owner', { membership: [cafe.id, 'OWNER'] });
    const cashier = await fixturePerson('golden-cashier', { posStaff: [cafe.id, 'CASHIER'] });

    for (const [who, restaurantId] of [
      [owner, cafe.id],
      [owner, undefined],
      [cashier, undefined],
    ] as const) {
      queries.length = 0;
      const actor = await resolvePosActor(logged, who.userId, restaurantId);
      expect(actor?.restaurantId).toBe(cafe.id);
      const afterActor = queries.length;
      expect(await posGate(logged, cafe.id)).toEqual({ open: true });
      expect({ actor: afterActor, gate: queries.length - afterActor }).toEqual(POS_QUERIES);
    }
  });
});
