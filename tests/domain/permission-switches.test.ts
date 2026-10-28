import { describe, expect, it } from 'vitest';
import { effectivePermissions, MEMBER_ROLES, NEVER_GRANTABLE, PERMISSIONS, ROLE_DEFAULTS, type PermissionPolicy } from '@/server/domain/permissions';
import { GRANTABLE_AREAS, GRANTABLE_KEYS, policyToSave, switchState, withSwitch } from '@/server/domain/permission-switches';

describe('the grantable keys', () => {
  it('are every key except the never-grantable ones, each in exactly one area', () => {
    expect(GRANTABLE_KEYS).toEqual(PERMISSIONS.filter((key) => !NEVER_GRANTABLE.includes(key)));
    expect(GRANTABLE_KEYS).toHaveLength(PERMISSIONS.length - NEVER_GRANTABLE.length);
    const listed = GRANTABLE_AREAS.flatMap((area) => area.keys);
    expect([...listed].sort()).toEqual([...GRANTABLE_KEYS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('are grouped by the spec areas, in its order, without an area that has none to grant', () => {
    expect(GRANTABLE_AREAS.map((area) => area.area)).toEqual(['restaurants', 'menus', 'content', 'design', 'publishing', 'data', 'media']);
    expect(GRANTABLE_AREAS.find((area) => area.area === 'restaurants')!.keys).toEqual(['restaurant.edit', 'restaurant.status']);
    expect(GRANTABLE_AREAS.every((area) => area.keys.length > 0)).toBe(true);
  });
});

describe('switchState', () => {
  it('is the role default, not marked, while the client has no policy', () => {
    for (const role of MEMBER_ROLES) {
      for (const key of GRANTABLE_KEYS) {
        expect(switchState(role, key, {}), `${role} ${key}`).toEqual({ on: ROLE_DEFAULTS[role].includes(key), overridden: false });
      }
    }
  });

  it('is the default plus the grants minus the revokes, marked only where it differs from the default', () => {
    const policy: PermissionPolicy = {
      OWNER: { grant: ['export.run', 'content.edit'], revoke: ['publish.now', 'menu.create'] },
      DESIGNER: { grant: [], revoke: ['publish.now'] },
    };
    // Granted beyond the default.
    expect(switchState('OWNER', 'export.run', policy)).toEqual({ on: true, overridden: true });
    // Revoked from the default.
    expect(switchState('OWNER', 'publish.now', policy)).toEqual({ on: false, overridden: true });
    expect(switchState('DESIGNER', 'publish.now', policy)).toEqual({ on: false, overridden: true });
    // A grant of what is already on, and a revoke of what is already off, change nothing and are not marked.
    expect(switchState('OWNER', 'content.edit', policy)).toEqual({ on: true, overridden: false });
    expect(switchState('OWNER', 'menu.create', policy)).toEqual({ on: false, overridden: false });
    // Another role's entry is not this role's.
    expect(switchState('OWNER', 'publish.schedule', policy)).toEqual({ on: false, overridden: false });
    expect(switchState('DESIGNER', 'export.run', policy)).toEqual({ on: true, overridden: false });
    // A revoke wins over a grant.
    expect(switchState('OWNER', 'brand.edit', { OWNER: { grant: ['brand.edit'], revoke: ['brand.edit'] } })).toEqual({ on: false, overridden: false });
  });

  it('agrees with the permission resolver for every role, key and kind of entry', () => {
    for (const role of MEMBER_ROLES) {
      for (const key of GRANTABLE_KEYS) {
        for (const entry of [{ grant: [], revoke: [] }, { grant: [key], revoke: [] }, { grant: [], revoke: [key] }, { grant: [key], revoke: [key] }]) {
          const policy: PermissionPolicy = { [role]: entry };
          const resolved = effectivePermissions({ isSuperAdmin: false, role, policy }).has(key);
          expect(switchState(role, key, policy).on, `${role} ${key} ${JSON.stringify(entry)}`).toBe(resolved);
        }
      }
    }
  });
});

describe('withSwitch', () => {
  it('turns an off key on as a grant, and back to the default as no entry at all', () => {
    const on = withSwitch({}, 'OWNER', 'export.run', true);
    expect(on.OWNER).toEqual({ grant: ['export.run'], revoke: [] });
    expect(switchState('OWNER', 'export.run', on)).toEqual({ on: true, overridden: true });
    const back = withSwitch(on, 'OWNER', 'export.run', false);
    expect(back.OWNER).toEqual({ grant: [], revoke: [] });
    expect(switchState('OWNER', 'export.run', back)).toEqual({ on: false, overridden: false });
  });

  it('turns an on key off as a revoke, and back to the default as no entry at all', () => {
    const off = withSwitch({}, 'OWNER', 'publish.now', false);
    expect(off.OWNER).toEqual({ grant: [], revoke: ['publish.now'] });
    expect(switchState('OWNER', 'publish.now', off)).toEqual({ on: false, overridden: true });
    expect(withSwitch(off, 'OWNER', 'publish.now', true).OWNER).toEqual({ grant: [], revoke: [] });
  });

  it('moves a key between grant and revoke, and leaves other keys and the other role alone', () => {
    let policy: PermissionPolicy = { DESIGNER: { grant: [], revoke: ['qr.manage'] }, OWNER: { grant: ['export.run'], revoke: ['publish.now'] } };
    policy = withSwitch(policy, 'OWNER', 'export.run', false);
    policy = withSwitch(policy, 'OWNER', 'menu.create', true);
    expect(policy.OWNER).toEqual({ grant: ['menu.create'], revoke: ['publish.now'] });
    expect(policy.DESIGNER).toEqual({ grant: [], revoke: ['qr.manage'] });
  });

  it('does not change the policy it was given', () => {
    const policy: PermissionPolicy = { OWNER: { grant: ['export.run'], revoke: [] } };
    withSwitch(policy, 'OWNER', 'menu.create', true);
    expect(policy).toEqual({ OWNER: { grant: ['export.run'], revoke: [] } });
  });

  it('refuses a key no policy can grant', () => {
    for (const key of NEVER_GRANTABLE) {
      expect(() => withSwitch({}, 'OWNER', key, true), key).toThrow();
      expect(() => switchState('OWNER', key, {}), key).toThrow();
    }
  });

  it('keeps the resolver and the switches in step through any sequence of toggles', () => {
    let policy: PermissionPolicy = {};
    const keys = GRANTABLE_KEYS;
    for (let step = 0; step < 200; step += 1) {
      const role = MEMBER_ROLES[step % 2]!;
      const key = keys[(step * 7) % keys.length]!;
      const on = (step * 13) % 3 !== 0;
      policy = withSwitch(policy, role, key, on);
      expect(switchState(role, key, policy).on).toBe(on);
      expect(effectivePermissions({ isSuperAdmin: false, role, policy }).has(key)).toBe(on);
    }
  });
});

describe('policyToSave', () => {
  it('sends both roles with their grants and revokes, even when there are none', () => {
    expect(policyToSave({})).toEqual({ DESIGNER: { grant: [], revoke: [] }, OWNER: { grant: [], revoke: [] } });
    expect(policyToSave({ OWNER: { grant: ['export.run'], revoke: ['publish.now'] } })).toEqual({
      DESIGNER: { grant: [], revoke: [] },
      OWNER: { grant: ['export.run'], revoke: ['publish.now'] },
    });
  });
});
