import type { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { allows, isFeatureKey, lowestPlanWith, type FeatureKey, type PlanTier } from '@/server/domain/entitlements';
import { effectivePermissions, parsePolicy, PERMISSIONS, type Permission } from '@/server/domain/permissions';
import type { Actor } from '@/server/studio/auth/actor';
import { entitlementsOf, readPlans } from '@/server/studio/services/plans';
import type { PlanAccess } from './plan';
import { failure, invalidInput, type StudioFailure } from './result';

/**
 * What an action or query works on. A menu resolves to its restaurant before anything runs. `self` is the signed-in
 * person's own account: it needs no permission, and it is the only target a definition with `permission: null` may name.
 */
export type Target =
  | { kind: 'platform' }
  | { kind: 'restaurant'; restaurantId: string }
  | { kind: 'menu'; menuId: string }
  | { kind: 'self' };

export type SelfTarget = Extract<Target, { kind: 'self' }>;

/** Every target whose permission is checked: all of them but `self`. */
export type CheckedTarget = Exclude<Target, SelfTarget>;

/** What a definition requires: a permission key, `'view'` (queries: Super Admin or member), or nothing (`self` only). */
export type Requirement = Permission | 'view' | null;

/** Where the checks placed the work, what the actor may do there, and what the restaurant has bought. */
export interface Access {
  restaurantId: string | null;
  menuId: string | null;
  permissions: ReadonlySet<Permission>;
  /** The restaurant's plan; null on platform and self targets. */
  plan: PlanAccess | null;
}

/** The parts of an action or query definition the checks read. */
export interface Guarded<I> {
  name: string;
  permission: Requirement;
  /** A feature the target restaurant's plan must include, checked after the permission. */
  feature?: FeatureKey;
  input: z.ZodType<I>;
  target: (input: I) => Target;
  allowWithoutTwoFactor: boolean;
}

const KNOWN = new Set<string>(PERMISSIONS);

const isSelf = (target: unknown) => (target as { kind?: unknown } | null)?.kind === 'self';

/**
 * Checks a definition when it is made, so a mistake fails when the module loads rather than when someone uses it: the
 * name, a known permission key, and `permission: null` only with a target that is always `self`. The target is called
 * once without input to check the last point; a `self` target must not depend on the input.
 */
export function checkDefinition(
  kind: 'action' | 'query',
  def: { name: unknown; permission: unknown; feature?: unknown; input: unknown; target: unknown; run: unknown },
): void {
  if (typeof def.name !== 'string' || def.name === '') throw new Error(`A Studio ${kind} needs a name`);
  const label = `Studio ${kind} ${def.name}`;
  if (typeof def.target !== 'function' || typeof def.run !== 'function') {
    throw new Error(`${label} needs a target and a run function`);
  }
  if (typeof (def.input as { safeParseAsync?: unknown } | null)?.safeParseAsync !== 'function') {
    throw new Error(`${label} needs a Zod input schema`);
  }
  const permission = def.permission;
  const allowed = permission === null || (typeof permission === 'string' && (KNOWN.has(permission) || (kind === 'query' && permission === 'view')));
  if (!allowed) throw new Error(`${label} names an unknown permission: ${String(permission)}`);
  if (def.feature !== undefined && !isFeatureKey(def.feature)) throw new Error(`${label} names an unknown feature: ${String(def.feature)}`);
  if (def.feature !== undefined && permission === null) throw new Error(`${label} needs a feature, which a self target has no plan for`);
  if (permission === null) {
    let target: unknown;
    try {
      target = (def.target as (input: unknown) => unknown)(undefined);
    } catch {
      target = undefined;
    }
    if (!isSelf(target)) {
      throw new Error(`${label} has permission null, which is only allowed with a self target that ignores the input`);
    }
  }
}

/** Everything a Super Admin holds, and nothing for anyone else: the permissions that apply outside a restaurant. */
function platformPermissions(actor: Actor): ReadonlySet<Permission> {
  return effectivePermissions({ isSuperAdmin: actor.isSuperAdmin, isPlatformOwner: actor.isPlatformOwner, role: null, policy: {} });
}

/** What `locate` reads of a target's restaurant: the client's stored policy, and what it has bought. */
const RESTAURANT_ACCESS = { permissionPolicy: true, plan: true, planExtras: true } as const;

interface Place {
  restaurantId: string;
  menuId: string | null;
  policy: unknown;
  plan: PlanTier;
  planExtras: unknown;
}

/** The restaurant (and menu) a target names, with the client's stored policy and plan; null when it does not exist. */
async function locate(prisma: PrismaClient, target: Extract<Target, { kind: 'restaurant' | 'menu' }>): Promise<Place | null> {
  if (target.kind === 'restaurant') {
    const id: unknown = target.restaurantId;
    if (typeof id !== 'string' || id === '') return null;
    const restaurant = await prisma.restaurant.findUnique({ where: { id }, select: { id: true, ...RESTAURANT_ACCESS } });
    return (
      restaurant && { restaurantId: restaurant.id, menuId: null, policy: restaurant.permissionPolicy, plan: restaurant.plan, planExtras: restaurant.planExtras }
    );
  }
  const id: unknown = target.menuId;
  if (typeof id !== 'string' || id === '') return null;
  const menu = await prisma.menu.findUnique({
    where: { id },
    select: { id: true, restaurantId: true, restaurant: { select: RESTAURANT_ACCESS } },
  });
  return (
    menu && {
      restaurantId: menu.restaurantId,
      menuId: menu.id,
      policy: menu.restaurant.permissionPolicy,
      plan: menu.restaurant.plan,
      planExtras: menu.restaurant.planExtras,
    }
  );
}

/**
 * Resolves the target and checks the requirement, then the feature the target restaurant's plan must include (after the
 * permission, so someone who may not use a tool never sees an upgrade hint for it). A restaurant or menu that does not
 * exist and one the actor has no part in are the same `NOT_FOUND`, so the answer never reveals what exists. A definition
 * whose permission, feature and target do not fit together throws: it is a bug, not a refusal.
 */
export async function resolveAccess(
  prisma: PrismaClient,
  actor: Actor,
  target: Target,
  required: Requirement,
  name: string,
  feature?: FeatureKey,
): Promise<Access | { ok: false; error: StudioFailure }> {
  const kind: unknown = (target as { kind?: unknown } | null)?.kind;
  if (feature !== undefined && kind !== 'restaurant' && kind !== 'menu') {
    throw new Error(`Studio ${name}: a feature needs a restaurant or menu target, whose plan includes it or not`);
  }
  if (kind === 'self') {
    if (required !== null) throw new Error(`Studio ${name}: a self target takes permission null, not ${required}`);
    return { restaurantId: null, menuId: null, permissions: platformPermissions(actor), plan: null };
  }
  if (required === null) throw new Error(`Studio ${name}: permission null is only allowed with a self target`);
  if (required !== 'view' && !KNOWN.has(required)) throw new Error(`Studio ${name}: unknown permission ${String(required)}`);

  if (kind === 'platform') {
    const permissions = platformPermissions(actor);
    if (required !== 'view' && !permissions.has(required)) return failure('FORBIDDEN');
    return { restaurantId: null, menuId: null, permissions, plan: null };
  }
  if (kind !== 'restaurant' && kind !== 'menu') throw new Error(`Studio ${name}: unknown target ${String(kind)}`);

  const place = await locate(prisma, target as Extract<Target, { kind: 'restaurant' | 'menu' }>);
  if (!place) return failure('NOT_FOUND');
  const membership = actor.memberships.find((m) => m.restaurantId === place.restaurantId);
  if (!actor.isSuperAdmin && !membership) return failure('NOT_FOUND');

  const permissions = effectivePermissions({
    isSuperAdmin: actor.isSuperAdmin,
    isPlatformOwner: actor.isPlatformOwner,
    role: membership?.role ?? null,
    policy: parsePolicy(place.policy),
  });
  if (required !== 'view' && !permissions.has(required)) return failure('FORBIDDEN');

  const plans = await readPlans(prisma);
  const plan: PlanAccess = { entitlements: entitlementsOf(place, plans), plans };
  if (feature !== undefined && !allows(plan.entitlements, feature)) {
    return failure('UPGRADE_REQUIRED', undefined, undefined, undefined, { feature, plan: lowestPlanWith(plans, feature) });
  }
  return { restaurantId: place.restaurantId, menuId: place.menuId, permissions, plan };
}

/**
 * Everything that happens before a handler runs, in order: an actor; two-factor for a Super Admin (unless the
 * definition is part of enrolling); valid input; the target and the permission.
 */
export async function admit<I>(
  prisma: PrismaClient,
  actor: Actor | null,
  def: Guarded<I>,
  raw: unknown,
): Promise<{ ok: true; actor: Actor; input: I; access: Access } | { ok: false; error: StudioFailure }> {
  if (!actor) return failure('UNAUTHENTICATED');
  if (actor.isSuperAdmin && !actor.twoFactorEnabled && !def.allowWithoutTwoFactor) return failure('TWO_FACTOR_REQUIRED');

  const parsed = await def.input.safeParseAsync(raw);
  if (!parsed.success) return invalidInput(parsed.error);

  const access = await resolveAccess(prisma, actor, def.target(parsed.data), def.permission, def.name, def.feature);
  if ('ok' in access) return access;
  return { ok: true, actor, input: parsed.data, access };
}
