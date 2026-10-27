import type { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { allows, isFeatureKey, lowestPlanWith, type FeatureKey, type PlanTier } from '@/server/domain/entitlements';
import { effectivePermissions, parsePolicy, PERMISSIONS, type Permission } from '@/server/domain/permissions';
import { canPh, PH_PERMISSIONS, type PhPermission } from '@/server/domain/pharmacy/permissions';
import { supportReadScope } from '@/server/domain/pharmacy/support-grant';
import { canPos, POS_PERMISSIONS, type PosPermission } from '@/server/domain/pos/permissions';
import { phGate, resolvePhActor, type PhActor } from '@/server/pharmacy/actor';
import { posGate, resolvePosActor, type PosActor } from '@/server/pos/actor';
import type { Actor } from '@/server/studio/auth/actor';
import { entitlementsOf, readPlans } from '@/server/data/plans';
import { scopedClient, type ScopedClient } from '@/server/data/tenant-db';
import type { PlanAccess } from './plan';
import { failure, invalidInput, type StudioFailure } from './result';

/**
 * What an action or query works on. A menu resolves to its restaurant before anything runs. `self` is the signed-in
 * person's own account: it needs no permission, and it is the only target a definition with `permission: null` may name.
 * `pos` is the till of the restaurant the person works in: the restaurant comes from their staff row or membership, never
 * from the input, and it is the only target a definition with a `pos` permission may name. With `catalog: true` the work
 * is also confined to the restaurant's product-list menu (refused until it exists), and the person holds the Studio's
 * content permissions there and nowhere else: the product list is edited by the Studio's own services.
 * `ph` names one pharmacy (`restaurantId`) and, optionally, a branch: the person's identity there is resolved from their
 * membership, staff row or support grant for that pharmacy alone, never another one they also work in; `branchId` must
 * be one of their branches there. Server code builds it from the validated chosen place (`currentPhPlaceInput`). It is
 * the only target a definition with a `ph` permission may name.
 */
export type Target =
  | { kind: 'platform' }
  | { kind: 'restaurant'; restaurantId: string }
  | { kind: 'menu'; menuId: string }
  | { kind: 'self' }
  | { kind: 'pos'; catalog?: boolean }
  | { kind: 'ph'; restaurantId: string; branchId?: string };

export type PosTarget = Extract<Target, { kind: 'pos' }>;

export type PhTarget = Extract<Target, { kind: 'ph' }>;

export type SelfTarget = Extract<Target, { kind: 'self' }>;

/** Every target whose Studio permission is checked: all of them but `self`, `pos` and `ph`. */
export type CheckedTarget = Exclude<Target, SelfTarget | PosTarget | PhTarget>;

/** What a definition requires: a permission key, `'view'` (queries: Super Admin or member), or nothing (`self` only). */
export type Requirement = Permission | 'view' | null;

/** Where the checks placed the work, what the actor may do there, and what the restaurant has bought. */
export interface Access {
  restaurantId: string | null;
  menuId: string | null;
  permissions: ReadonlySet<Permission>;
  /** The restaurant's plan; null on platform and self targets. */
  plan: PlanAccess | null;
  /** Who is at the till, on a `pos` target; null otherwise. */
  pos?: PosActor | null;
  /** Who works in the pharmacy, on a `ph` target; null otherwise. */
  ph?: PhActor | null;
}

/** The parts of an action or query definition the checks read. */
export interface Guarded<I> {
  /** Whether the definition writes (an action) or only reads (a query); treated as an action when missing. */
  kind?: 'action' | 'query';
  name: string;
  permission: Requirement;
  /** A till permission instead of a Studio one: the target is then `pos`, and `permission` is null. */
  pos?: PosPermission;
  /** A till definition that still works when the Cashier subscription has lapsed (closing and reading a shift). */
  allowLapsed?: true;
  /** A pharmacy permission instead of a Studio one: the target is then `ph`, and `permission` is null. */
  ph?: PhPermission;
  /** A pharmacy action that still runs while the pharmacy is read-only (a lapsed subscription); queries always do. */
  allowReadOnly?: true;
  /** A feature the target restaurant's plan must include, checked after the permission. */
  feature?: FeatureKey;
  input: z.ZodType<I>;
  target: (input: I) => Target;
  allowWithoutTwoFactor: boolean;
}

const KNOWN = new Set<string>(PERMISSIONS);

const isSelf = (target: unknown) => (target as { kind?: unknown } | null)?.kind === 'self';

/** Input whose every field is missing: a `ph` target reads `restaurantId` and `branchId` from the input, so it is called with this. */
const EMPTY_INPUT: unknown = new Proxy({}, { get: () => undefined });

/** The kind of target a definition's target function names for an input with no fields; undefined when it throws. */
function probeKind(target: unknown): unknown {
  try {
    return ((target as (input: unknown) => unknown)(EMPTY_INPUT) as { kind?: unknown } | null)?.kind;
  } catch {
    return undefined;
  }
}

/**
 * Checks a definition when it is made, so a mistake fails when the module loads rather than when someone uses it: the
 * name, a known permission key, and `permission: null` only with a target that is always `self`. The target is called
 * once without input to check the last point; a `self` target must not depend on the input. A `ph` permission and a
 * `ph` target go together, each refused without the other.
 */
export function checkDefinition(
  kind: 'action' | 'query',
  def: {
    name: unknown;
    permission: unknown;
    pos?: unknown;
    allowLapsed?: unknown;
    ph?: unknown;
    allowReadOnly?: unknown;
    allowWithoutTwoFactor?: unknown;
    feature?: unknown;
    input: unknown;
    target: unknown;
    run: unknown;
  },
): void {
  if (typeof def.name !== 'string' || def.name === '') throw new Error(`A Studio ${kind} needs a name`);
  const label = `Studio ${kind} ${def.name}`;
  if (typeof def.target !== 'function' || typeof def.run !== 'function') {
    throw new Error(`${label} needs a target and a run function`);
  }
  if (typeof (def.input as { safeParseAsync?: unknown } | null)?.safeParseAsync !== 'function') {
    throw new Error(`${label} needs a Zod input schema`);
  }
  if (def.allowLapsed !== undefined && (def.allowLapsed !== true || def.pos === undefined)) {
    throw new Error(`${label} allows a lapsed subscription, which only a till definition (pos) can`);
  }
  if (def.allowReadOnly !== undefined && (def.allowReadOnly !== true || def.ph === undefined)) {
    throw new Error(`${label} sets allowReadOnly, which only a pharmacy definition (ph) can`);
  }
  if (def.ph !== undefined) {
    if (def.pos !== undefined) throw new Error(`${label} names both a till and a pharmacy permission`);
    if (typeof def.ph !== 'string' || !(PH_PERMISSIONS as readonly string[]).includes(def.ph)) {
      throw new Error(`${label} names an unknown pharmacy permission: ${String(def.ph)}`);
    }
    if (def.permission !== null) throw new Error(`${label} names a pharmacy permission, so its Studio permission is null`);
    if (def.feature !== undefined) throw new Error(`${label} needs a feature, which a pharmacy target has no plan for`);
    // Enrolling in two-factor is the Studio's own work: a Super Admin without it never reaches pharmacy data.
    if (def.allowWithoutTwoFactor !== undefined && def.allowWithoutTwoFactor !== false) {
      throw new Error(`${label} sets allowWithoutTwoFactor, which a pharmacy definition never may`);
    }
    if (probeKind(def.target) !== 'ph') {
      throw new Error(`${label} names a pharmacy permission, which is only allowed with a ph target`);
    }
    return;
  }
  if (probeKind(def.target) === 'ph') throw new Error(`${label} names the ph target, which needs a pharmacy permission (ph)`);
  if (def.pos !== undefined) {
    if (kind !== 'action' && kind !== 'query') throw new Error(`${label} is not an action or a query`);
    if (typeof def.pos !== 'string' || !(POS_PERMISSIONS as readonly string[]).includes(def.pos)) {
      throw new Error(`${label} names an unknown till permission: ${String(def.pos)}`);
    }
    if (def.permission !== null) throw new Error(`${label} names a till permission, so its Studio permission is null`);
    if (def.feature !== undefined) throw new Error(`${label} needs a feature, which a till target has no plan for`);
    let target: unknown;
    try {
      target = (def.target as (input: unknown) => unknown)(undefined);
    } catch {
      target = undefined;
    }
    if ((target as { kind?: unknown } | null)?.kind !== 'pos') {
      throw new Error(`${label} names a till permission, which is only allowed with a pos target that ignores the input`);
    }
    return;
  }
  try {
    if (((def.target as (input: unknown) => unknown)(undefined) as { kind?: unknown } | null)?.kind === 'pos') {
      throw new Error(`${label} names the pos target, which needs a till permission (pos)`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('pos target')) throw error;
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
 * The till check: the person's restaurant and role come from the database, the till must be open for that restaurant (it
 * is active and has a live Cashier subscription), and the role must hold the permission. Somebody with no till at all
 * and a closed till are refused alike as far as the answer goes: no one learns what exists.
 */
export async function resolvePosAccess(
  prisma: PrismaClient,
  actor: Actor,
  required: PosPermission,
  target: PosTarget,
  allowLapsed = false,
): Promise<Access | { ok: false; error: StudioFailure }> {
  const posActor = await resolvePosActor(prisma, actor.userId, actor.posRestaurantId);
  if (!posActor) return failure('NOT_FOUND');
  // A lapsed Cashier subscription still lets a definition marked `allowLapsed` run; an inactive restaurant never does.
  const gate = await posGate(prisma, posActor.restaurantId);
  if (!gate.open && !(allowLapsed && gate.reason === 'cashierPlanInactive')) return failure('FORBIDDEN');
  if (!canPos(posActor.role, required)) return failure('FORBIDDEN');
  const place = await locate(prisma, { kind: 'restaurant', restaurantId: posActor.restaurantId });
  if (!place) return failure('NOT_FOUND');
  const plans = await readPlans(prisma);
  const plan: PlanAccess = { entitlements: entitlementsOf(place, plans), plans };
  if (target.catalog !== true) {
    // A till role grants no Studio permission: the till's work goes through the till's own checks.
    return { restaurantId: place.restaurantId, menuId: null, permissions: new Set(), plan, pos: posActor };
  }
  const settings = await prisma.posSettings.findUnique({ where: { restaurantId: place.restaurantId }, select: { catalogMenuId: true } });
  const menu = settings?.catalogMenuId
    ? await prisma.menu.findFirst({ where: { id: settings.catalogMenuId, restaurantId: place.restaurantId }, select: { id: true } })
    : null;
  if (!menu) return failure('NOT_FOUND');
  // `catalog.manage` is the till's word for editing the product list, which the Studio's services check as these three.
  const content = new Set<Permission>(['content.edit', 'content.prices', 'content.availability']);
  return { restaurantId: place.restaurantId, menuId: menu.id, permissions: content, plan, pos: posActor };
}

/**
 * The pharmacy check, for a `ph` target. The person's role and branches in the target's pharmacy come from the database
 * (`resolvePhActor` for that `restaurantId` only), and that pharmacy must not be closed (`phGate`); while it is read-only (a lapsed subscription
 * inside its retention window) only work that `allowReadOnly` passes runs. Staff need the permission in their role. A
 * support actor (a Super Admin with a live grant) holds no role: it may run a query whose permission maps to a read scope
 * its grant covers (`supportReadScope`), and never an action. A `branchId` must be one of the person's branches. No
 * pharmacy at all, a closed one and every refusal answer `FORBIDDEN` alike, so the answer never tells what exists.
 */
export async function resolvePhAccess(
  prisma: PrismaClient,
  actor: Actor,
  required: PhPermission,
  target: PhTarget,
  allowReadOnly: boolean,
  kind: 'action' | 'query' = 'action',
): Promise<Access | { ok: false; error: StudioFailure }> {
  if ((target as { kind?: unknown } | null)?.kind !== 'ph') throw new Error('resolvePhAccess: the target is not ph');
  // One clock for the actor (whose grant may expire this instant) and the gate.
  const now = new Date();
  // Always the named pharmacy: never a fallback to another one the person works in.
  const restaurantId: unknown = (target as { restaurantId?: unknown }).restaurantId;
  if (typeof restaurantId !== 'string' || restaurantId === '') return failure('FORBIDDEN');
  const phActor = await resolvePhActor(prisma, actor.userId, { restaurantId, now });
  if (!phActor) return failure('FORBIDDEN');
  const gate = await phGate(prisma, phActor.restaurantId, now);
  if (gate.state === 'closed') return failure('FORBIDDEN');
  if (gate.state === 'readOnly' && !allowReadOnly) return failure('FORBIDDEN');

  if (phActor.support !== null) {
    // Rights come from the grant's scopes alone, never from `role` or `allBranches`.
    const scope = supportReadScope(required);
    if (kind !== 'query' || scope === null || !phActor.support.scopes.has(scope)) return failure('FORBIDDEN');
  } else if (phActor.role === null || !canPh(phActor.role, required)) {
    return failure('FORBIDDEN');
  }

  const branchId: unknown = target.branchId;
  if (branchId !== undefined && (typeof branchId !== 'string' || !phActor.branchIds.includes(branchId))) {
    return failure('FORBIDDEN');
  }
  // A pharmacy role grants no Studio permission, and the pharmacy has no Studio plan.
  return { restaurantId: phActor.restaurantId, menuId: null, permissions: new Set(), plan: null, ph: phActor };
}

/**
 * The client a `ph` definition works through: confined to the actor's pharmacy, and its branch-scoped models to the
 * actor's branches (every branch of it for an all-branches actor). `ctx.transaction` of a ph action runs on this client,
 * and `ctx.scoped` of a ph action or query is this client.
 */
export function phScopedClient(prisma: PrismaClient, ph: PhActor): ScopedClient {
  return scopedClient(
    prisma,
    ph.allBranches ? { restaurantId: ph.restaurantId, allBranches: true } : { restaurantId: ph.restaurantId, branchIds: ph.branchIds },
  );
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

  const isQuery = def.kind === 'query';
  const access =
    def.ph !== undefined
      ? await resolvePhAccess(
          prisma,
          actor,
          def.ph,
          def.target(parsed.data) as PhTarget,
          // Reading is always allowed while the pharmacy is read-only; an action only when it says so.
          isQuery || def.allowReadOnly === true,
          isQuery ? 'query' : 'action',
        )
      : def.pos !== undefined
        ? await resolvePosAccess(prisma, actor, def.pos, def.target(parsed.data) as PosTarget, def.allowLapsed === true)
        : await resolveAccess(prisma, actor, def.target(parsed.data), def.permission, def.name, def.feature);
  if ('ok' in access) return access;
  return { ok: true, actor, input: parsed.data, access };
}
