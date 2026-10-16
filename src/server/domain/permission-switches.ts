import { MEMBER_ROLES, NEVER_GRANTABLE, PERMISSIONS, ROLE_DEFAULTS, type MemberRole, type Permission, type PermissionPolicy } from './permissions';

/**
 * The per-client permission switches (spec 9.3) as plain data and pure functions: which keys a client's policy can
 * change, how they are grouped on the People screen, what a switch shows for a role (the role's default, then the
 * client's grants and revokes), and how flipping one changes the policy. The People screen and its tests share it, and
 * `effectivePermissions` stays the one resolver the server uses: `switchState` must agree with it, and a test holds them
 * to that.
 */

/** The areas of spec 9.1, in its order, and the key prefix or keys that belong to each. */
const AREA_OF: ReadonlyArray<{ area: string; has: (key: Permission) => boolean }> = [
  { area: 'restaurants', has: (key) => key.startsWith('restaurant.') },
  { area: 'menus', has: (key) => key.startsWith('menu.') },
  { area: 'content', has: (key) => key.startsWith('content.') },
  { area: 'design', has: (key) => key === 'brand.edit' || key === 'qr.manage' },
  { area: 'publishing', has: (key) => key.startsWith('publish.') },
  { area: 'data', has: (key) => key === 'import.run' || key === 'export.run' || key === 'prices.bulk' },
  { area: 'media', has: (key) => key === 'media.manage' },
  { area: 'people', has: (key) => key.startsWith('people.') || key === 'permissions.manage' },
  { area: 'platform', has: (key) => key === 'audit.view' || key === 'platform.settings' },
];

const NEVER = new Set<Permission>(NEVER_GRANTABLE);

/** Whether a client's policy can grant `key` to a designer or an owner. */
export const isGrantable = (key: Permission): boolean => !NEVER.has(key);

/** Every key a policy can change: all of them but the never-grantable ones. */
export const GRANTABLE_KEYS: readonly Permission[] = PERMISSIONS.filter(isGrantable);

/** The grantable keys by area, in the order of spec 9.1; an area with nothing to grant (Platform) is left out. */
export const GRANTABLE_AREAS: ReadonlyArray<{ area: string; keys: readonly Permission[] }> = AREA_OF.map(({ area, has }) => ({
  area,
  keys: GRANTABLE_KEYS.filter(has),
})).filter(({ keys }) => keys.length > 0);

function assertGrantable(key: Permission): void {
  if (!isGrantable(key)) throw new Error(`${key} can never be granted by a client policy, so it has no switch`);
}

/** What a switch shows: whether the role holds `key` at this client, and whether that differs from the role's default. */
export function switchState(role: MemberRole, key: Permission, policy: PermissionPolicy): { on: boolean; overridden: boolean } {
  assertGrantable(key);
  const byDefault = ROLE_DEFAULTS[role].includes(key);
  const entry = policy[role];
  // As `effectivePermissions` reads it: the default, plus the grants, minus the revokes (a revoke wins over a grant).
  const on = (byDefault || Boolean(entry?.grant.includes(key))) && !entry?.revoke.includes(key);
  return { on, overridden: on !== byDefault };
}

/**
 * The policy with `key` switched on or off for `role`, as the smallest entry that says it: back to the role's default
 * leaves no trace in either list, above it a grant, below it a revoke. Other keys and the other role are untouched, and
 * the policy given is not changed.
 */
export function withSwitch(policy: PermissionPolicy, role: MemberRole, key: Permission, on: boolean): PermissionPolicy {
  assertGrantable(key);
  const byDefault = ROLE_DEFAULTS[role].includes(key);
  const entry = policy[role] ?? { grant: [], revoke: [] };
  const grant = entry.grant.filter((other) => other !== key);
  const revoke = entry.revoke.filter((other) => other !== key);
  if (on && !byDefault) grant.push(key);
  if (!on && byDefault) revoke.push(key);
  return { ...policy, [role]: { grant, revoke } };
}

/** The whole policy as `setPermissionPolicy` takes it: both roles, each with its grants and revokes. */
export function policyToSave(policy: PermissionPolicy): Record<MemberRole, { grant: Permission[]; revoke: Permission[] }> {
  return Object.fromEntries(
    MEMBER_ROLES.map((role) => [role, { grant: [...(policy[role]?.grant ?? [])], revoke: [...(policy[role]?.revoke ?? [])] }]),
  ) as Record<MemberRole, { grant: Permission[]; revoke: Permission[] }>;
}
