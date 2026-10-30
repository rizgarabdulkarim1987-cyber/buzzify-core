/**
 * The Studio permission model (spec section 9), as pure functions. Every Studio action names one permission; whether
 * an actor holds it is computed here from their role, the client's policy and the Super Admin flag, and nowhere else.
 */

export const PERMISSIONS = [
  // Restaurants
  'restaurant.create',
  'restaurant.edit',
  'restaurant.status',
  'restaurant.delete',
  // Menus
  'menu.create',
  'menu.duplicate',
  'menu.settings',
  'menu.status',
  'menu.delete',
  // Content
  'content.edit',
  'content.prices',
  'content.media',
  'content.availability',
  // Design
  'brand.edit',
  'qr.manage',
  // Publishing
  'publish.now',
  'publish.schedule',
  'publish.rollback',
  // Data
  'import.run',
  'export.run',
  'prices.bulk',
  // Media library
  'media.manage',
  // People
  'people.invite',
  'people.manage',
  'permissions.manage',
  // Platform
  'audit.view',
  'platform.settings',
  // Plans: what each restaurant has bought. The platform owner's alone (spec: plans and entitlements, 2.1).
  'plans.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The two roles held inside a restaurant. Super Admin is a platform flag, not a membership role. */
export const MEMBER_ROLES = ['DESIGNER', 'OWNER'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_DEFAULTS: Record<MemberRole, readonly Permission[]> = {
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

/**
 * Keys a client policy can never hand to a designer or an owner. `people.invite` is here because accounts are made by
 * the Super Admin alone: no policy lets an owner invite, or see who has been invited.
 */
export const NEVER_GRANTABLE: readonly Permission[] = [
  'restaurant.create',
  'restaurant.delete',
  'menu.delete',
  'people.invite',
  'people.manage',
  'permissions.manage',
  'audit.view',
  'platform.settings',
  'plans.manage',
];

/**
 * Keys only the platform owner holds: the one account that sells, which may change a restaurant's plan and what the
 * plans hold. Every other Super Admin holds every other key.
 */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ['plans.manage'];

/** Keys that act on the platform rather than on one restaurant: only Super Admins hold them. */
export const PLATFORM_PERMISSIONS: readonly Permission[] = [
  'restaurant.create',
  'people.manage',
  'audit.view',
  'platform.settings',
];

/** What one client changes for one role: keys granted on top of the defaults, keys revoked from them. */
export type PermissionPolicy = Partial<Record<MemberRole, { grant: Permission[]; revoke: Permission[] }>>;

const KNOWN = new Set<string>(PERMISSIONS);
const BLOCKED = new Set<string>(NEVER_GRANTABLE);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && KNOWN.has(value);
}

/** The known keys of a stored list, without repeats and in first-seen order; anything else is dropped. */
function knownKeys(value: unknown, allow: (key: Permission) => boolean): Permission[] {
  if (!Array.isArray(value)) return [];
  const keys: Permission[] = [];
  for (const item of value) {
    if (isPermission(item) && allow(item) && !keys.includes(item)) keys.push(item);
  }
  return keys;
}

/**
 * Reads `Restaurant.permissionPolicy`. The stored JSON is untrusted: unknown roles and keys are dropped, grants of a
 * never-grantable key are dropped, and anything malformed reads as an empty policy for that part.
 */
export function parsePolicy(json: unknown): PermissionPolicy {
  const policy: PermissionPolicy = {};
  if (!isRecord(json)) return policy;
  for (const role of MEMBER_ROLES) {
    const entry = json[role];
    if (!isRecord(entry)) continue;
    policy[role] = {
      grant: knownKeys(entry.grant, (key) => !BLOCKED.has(key)),
      revoke: knownKeys(entry.revoke, () => true),
    };
  }
  return policy;
}

const OWNER_ONLY = new Set<Permission>(OWNER_ONLY_PERMISSIONS);

/**
 * Every permission an actor holds: all of them for a Super Admin (the owner-only ones for the platform owner alone), none
 * without a role, otherwise the role defaults plus the client's grants minus its revokes. A revoke wins over a grant,
 * and a never-grantable key is not granted even by a policy that skipped `parsePolicy`.
 */
export function effectivePermissions(args: {
  isSuperAdmin: boolean;
  /** The one account that sells; counts only for a Super Admin. */
  isPlatformOwner?: boolean;
  role: MemberRole | null;
  policy: PermissionPolicy;
}): ReadonlySet<Permission> {
  if (args.isSuperAdmin) return new Set(args.isPlatformOwner ? PERMISSIONS : PERMISSIONS.filter((key) => !OWNER_ONLY.has(key)));
  if (args.role === null) return new Set();
  const set = new Set<Permission>(ROLE_DEFAULTS[args.role]);
  const entry = args.policy[args.role];
  if (entry) {
    for (const key of entry.grant) if (!BLOCKED.has(key)) set.add(key);
    for (const key of entry.revoke) set.delete(key);
  }
  return set;
}
