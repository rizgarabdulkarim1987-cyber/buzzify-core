import { describe, expect, it } from 'vitest';
import {
  NEVER_GRANTABLE,
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  ROLE_DEFAULTS,
  effectivePermissions,
  parsePolicy,
  type MemberRole,
  type Permission,
} from '@/server/domain/permissions';

/** Spec 9.2, with the `content.*` and `publish.*` wildcards written out. */
const EXPECTED: Record<MemberRole, Permission[]> = {
  DESIGNER: [
    'restaurant.edit',
    'menu.create',
    'menu.duplicate',
    'menu.settings',
    'menu.status',
    'content.edit',
    'content.prices',
    'content.media',
    'content.availability',
    'brand.edit',
    'qr.manage',
    'publish.now',
    'publish.schedule',
    'publish.rollback',
    'import.run',
    'export.run',
    'prices.bulk',
    'media.manage',
  ],
  OWNER: ['content.edit', 'content.prices', 'content.media', 'content.availability', 'publish.now', 'prices.bulk'],
};

describe('permission keys', () => {
  it('lists the 27 keys of spec 9.1, in the spec order and without duplicates', () => {
    expect(PERMISSIONS).toEqual([
      'restaurant.create',
      'restaurant.edit',
      'restaurant.status',
      'restaurant.delete',
      'menu.create',
      'menu.duplicate',
      'menu.settings',
      'menu.status',
      'menu.delete',
      'content.edit',
      'content.prices',
      'content.media',
      'content.availability',
      'brand.edit',
      'qr.manage',
      'publish.now',
      'publish.schedule',
      'publish.rollback',
      'import.run',
      'export.run',
      'prices.bulk',
      'media.manage',
      'people.invite',
      'people.manage',
      'permissions.manage',
      'audit.view',
      'platform.settings',
    ]);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    expect(PERMISSIONS).toHaveLength(27);
  });

  it('lists the keys that can never be granted, and the ones only Super Admins hold at platform level', () => {
    expect([...NEVER_GRANTABLE].sort()).toEqual(
      [
        'restaurant.create',
        'restaurant.delete',
        'menu.delete',
        'people.manage',
        'permissions.manage',
        'audit.view',
        'platform.settings',
      ].sort(),
    );
    expect([...PLATFORM_PERMISSIONS].sort()).toEqual(
      ['restaurant.create', 'people.manage', 'audit.view', 'platform.settings'].sort(),
    );
  });

  it('keeps platform keys and never-grantable keys out of every role default', () => {
    for (const role of ['DESIGNER', 'OWNER'] as const) {
      for (const key of [...NEVER_GRANTABLE, ...PLATFORM_PERMISSIONS]) {
        expect(ROLE_DEFAULTS[role]).not.toContain(key);
      }
    }
    for (const key of PLATFORM_PERMISSIONS) expect(NEVER_GRANTABLE).toContain(key);
  });
});

describe('role defaults', () => {
  it.each(PERMISSIONS.flatMap((p) => (['DESIGNER', 'OWNER'] as const).map((r) => [r, p] as const)))(
    '%s default for %s',
    (role, permission) => {
      expect(effectivePermissions({ isSuperAdmin: false, role, policy: {} }).has(permission)).toBe(
        EXPECTED[role].includes(permission),
      );
    },
  );

  it('gives Super Admins every key', () => {
    const all = effectivePermissions({ isSuperAdmin: true, role: null, policy: {} });
    expect(all.size).toBe(PERMISSIONS.length);
    for (const permission of PERMISSIONS) expect(all.has(permission)).toBe(true);
  });

  it('gives Super Admins every key whatever the client policy revokes', () => {
    const policy = parsePolicy({ OWNER: { grant: [], revoke: ['publish.now'] }, DESIGNER: { grant: [], revoke: ['content.edit'] } });
    expect(effectivePermissions({ isSuperAdmin: true, role: 'OWNER', policy }).size).toBe(PERMISSIONS.length);
  });

  it('gives nothing without a role', () => {
    expect(effectivePermissions({ isSuperAdmin: false, role: null, policy: {} }).size).toBe(0);
  });

  it('gives nothing without a role even when a policy grants keys', () => {
    const policy = parsePolicy({ OWNER: { grant: ['people.invite'], revoke: [] } });
    expect(effectivePermissions({ isSuperAdmin: false, role: null, policy }).size).toBe(0);
  });
});

describe('client policy', () => {
  it('applies a client policy', () => {
    const policy = parsePolicy({ OWNER: { grant: ['people.invite'], revoke: ['publish.now'] } });
    const set = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy });
    expect(set.has('people.invite')).toBe(true);
    expect(set.has('publish.now')).toBe(false);
  });

  it('only applies the policy of the actor role', () => {
    const policy = parsePolicy({ OWNER: { grant: ['people.invite'], revoke: ['publish.now'] } });
    const designer = effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy });
    expect(designer.has('people.invite')).toBe(false);
    expect(designer.has('publish.now')).toBe(true);
  });

  it('lets a revoke win over a grant of the same key', () => {
    const policy = parsePolicy({ OWNER: { grant: ['publish.schedule'], revoke: ['publish.schedule'] } });
    expect(effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy }).has('publish.schedule')).toBe(false);
  });

  it('never grants a never-grantable key', () => {
    expect(parsePolicy({ DESIGNER: { grant: ['menu.delete', 'nonsense'], revoke: [] } })).toEqual({
      DESIGNER: { grant: [], revoke: [] },
    });
  });

  it('keeps every never-grantable key out of the effective set even for a policy that was not parsed', () => {
    const policy = { OWNER: { grant: [...NEVER_GRANTABLE], revoke: [] } };
    const set = effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy });
    for (const key of NEVER_GRANTABLE) expect(set.has(key)).toBe(false);
    expect([...set].sort()).toEqual([...EXPECTED.OWNER].sort());
  });

  it('drops unknown keys, unknown roles and repeats, and keeps valid grants and revokes', () => {
    expect(
      parsePolicy({
        OWNER: { grant: ['people.invite', 'people.invite', 'bogus.key', 42], revoke: ['publish.now', 'nope'] },
        SUPER_ADMIN: { grant: ['people.invite'], revoke: [] },
      }),
    ).toEqual({ OWNER: { grant: ['people.invite'], revoke: ['publish.now'] } });
  });

  it('tolerates garbage input by returning an empty policy for that part', () => {
    for (const garbage of [null, undefined, 'OWNER', 7, true, [], [{ OWNER: { grant: [], revoke: [] } }]]) {
      expect(parsePolicy(garbage)).toEqual({});
    }
    expect(parsePolicy({ OWNER: null, DESIGNER: 'grant everything' })).toEqual({});
    expect(parsePolicy({ OWNER: ['people.invite'] })).toEqual({});
    expect(parsePolicy({ OWNER: { grant: 'people.invite', revoke: { 0: 'publish.now' } } })).toEqual({
      OWNER: { grant: [], revoke: [] },
    });
    expect(parsePolicy({ OWNER: { revoke: ['publish.now'] }, DESIGNER: { grant: 'qr.manage' } })).toEqual({
      OWNER: { grant: [], revoke: ['publish.now'] },
      DESIGNER: { grant: [], revoke: [] },
    });
  });
});
