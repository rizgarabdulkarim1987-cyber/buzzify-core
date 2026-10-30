import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import type { FeatureKey } from '@/server/domain/entitlements';
import type { PhPermission } from '@/server/domain/pharmacy/permissions';
import type { Permission } from '@/server/domain/permissions';
import type { PosPermission } from '@/server/domain/pos/permissions';
import type { PhActor } from '@/server/pharmacy/actor';
import { auditSupportRead } from '@/server/pharmacy/support';
import type { PosActor } from '@/server/pos/actor';
import type { Actor } from '@/server/studio/auth/actor';
import type { ScopedClient } from '@/server/data/tenant-db';
import { admit, checkDefinition, type KnownPhAccess, phScopedClient, type CheckedTarget, type PhTarget, type PosTarget, type SelfTarget, type Target } from './access';
import type { PlanAccess } from './plan';
import { describeError, expectedFailure, failure, UNEXPECTED_MESSAGE, type ActionResult } from './result';

/** Which restaurants an actor can see across the platform: all of them for a Super Admin, else their own. */
export type ActorScope = { kind: 'all' } | { kind: 'restaurants'; ids: string[] };

export function actorScope(actor: Actor): ActorScope {
  if (actor.isSuperAdmin) return { kind: 'all' };
  return { kind: 'restaurants', ids: [...new Set(actor.memberships.map((m) => m.restaurantId))] };
}

/** What a query's handler receives, besides its parsed input. */
export interface QueryContext {
  actor: Actor;
  /**
   * The application's client. The checks have admitted the actor to the target, so a query on a restaurant or menu
   * reads by the target's ids (`restaurantId`, `menuId` below); a platform query limits its rows to `scope`.
   */
  db: PrismaClient;
  scope: ActorScope;
  /** What the actor may do at the target, for showing or hiding what the page offers. */
  permissions: ReadonlySet<Permission>;
  /** What the target's restaurant has bought, for showing locks; null for platform and self targets. */
  plan: PlanAccess | null;
  restaurantId: string | null;
  menuId: string | null;
  /** Who is at the till, for a query with a `pos` permission; null for every other. */
  pos: PosActor | null;
  /** Who works in the pharmacy, for a query with a `ph` permission; null for every other. */
  ph: PhActor | null;
  /**
   * For a `ph` query, a client confined to the actor's pharmacy and branches; null for every other. A ph query reads Ph
   * models only through this, never `db` (the enforcement test refuses it).
   */
  scoped: ScopedClient | null;
}

// As for actions, the input type comes from the schema alone.
interface QueryFields<I, O> {
  name: string;
  /** A till definition that still runs when the Cashier subscription has lapsed (closing and reading a shift). */
  allowLapsed?: true;
  /** A pharmacy query runs while the pharmacy is read-only whether or not it says so; this only states it. */
  allowReadOnly?: true;
  input: z.ZodType<I>;
  run(ctx: QueryContext, input: NoInfer<I>): Promise<O>;
  allowWithoutTwoFactor?: boolean;
  /** A feature the target restaurant's plan must include; refused with `UPGRADE_REQUIRED` after the permission. */
  feature?: FeatureKey;
}

/**
 * A query names a permission, or `'view'`: a Super Admin or a member of the target's restaurant (on a platform target,
 * anyone signed in, with rows limited by `scope`). `permission: null` is for the person's own account, their till
 * (`pos`) or their pharmacy (`ph`).
 */
export type QuerySpec<I, O> = QueryFields<I, O> &
  (
    | { permission: Permission | 'view'; pos?: undefined; ph?: undefined; target(input: NoInfer<I>): CheckedTarget }
    | { permission: null; pos?: undefined; ph?: undefined; target(input: NoInfer<I>): SelfTarget }
    | { permission: null; pos: PosPermission; ph?: undefined; target(input: NoInfer<I>): PosTarget }
    | { permission: null; pos?: undefined; ph: PhPermission; target(input: NoInfer<I>): PhTarget }
  );

export interface QueryDef<I, O> {
  readonly kind: 'query';
  readonly name: string;
  readonly permission: Permission | 'view' | null;
  /** A till permission instead of a Studio one; the target is then the person's own till. */
  readonly pos?: PosPermission;
  readonly allowLapsed?: true;
  /** A pharmacy permission instead of a Studio one; the target is then the person's own pharmacy. */
  readonly ph?: PhPermission;
  readonly allowReadOnly?: true;
  readonly feature?: FeatureKey;
  readonly input: z.ZodType<I>;
  readonly target: (input: I) => Target;
  readonly run: (ctx: QueryContext, input: I) => Promise<O>;
  readonly allowWithoutTwoFactor: boolean;
}

/** Defines a Studio read. Every page, every read-only Server Action and every GET route of the Studio uses one. */
export function defineQuery<I, O>(spec: QuerySpec<I, O>): QueryDef<I, O> {
  checkDefinition('query', spec);
  return Object.freeze({
    kind: 'query',
    name: spec.name,
    permission: spec.permission,
    ...(spec.pos === undefined ? {} : { pos: spec.pos }),
    ...(spec.allowLapsed === undefined ? {} : { allowLapsed: spec.allowLapsed }),
    ...(spec.ph === undefined ? {} : { ph: spec.ph }),
    ...(spec.allowReadOnly === undefined ? {} : { allowReadOnly: spec.allowReadOnly }),
    ...(spec.feature === undefined ? {} : { feature: spec.feature }),
    input: spec.input,
    target: spec.target as (input: I) => Target,
    run: spec.run,
    allowWithoutTwoFactor: spec.allowWithoutTwoFactor ?? false,
  });
}

/**
 * Like `runQuery`, but an unexpected error is thrown rather than answered: a page lets its error boundary show it and
 * Next log it. Refusals (and a `StudioError` from the handler) are still results.
 */
export async function runQueryForPage<I, O>(
  prisma: PrismaClient,
  actor: Actor | null,
  def: QueryDef<I, O>,
  raw: unknown,
  options: { phAccess?: KnownPhAccess } = {},
): Promise<ActionResult<O>> {
  try {
    if (def.kind !== 'query') throw new Error(`Studio ${def.name} is not a query`);
    const admitted = await admit(prisma, actor, def, raw, options.phAccess);
    if (!admitted.ok) return admitted;
    const { access } = admitted;
    // Every read a support actor makes is audited here, before the handler runs, whatever the handler does.
    if (access.ph?.support) await auditSupportRead(prisma, access.ph, def.name);
    const data = await def.run(
      {
        actor: admitted.actor,
        db: prisma,
        scope: actorScope(admitted.actor),
        permissions: access.permissions,
        plan: access.plan,
        restaurantId: access.restaurantId,
        menuId: access.menuId,
        pos: access.pos ?? null,
        ph: access.ph ?? null,
        scoped: access.ph ? phScopedClient(prisma, access.ph) : null,
      },
      admitted.input,
    );
    return { ok: true, data };
  } catch (error) {
    const expected = expectedFailure(error);
    if (expected) return expected;
    throw error;
  }
}

/** Runs a query with the same checks as an action; no transaction and no audit. Unexpected errors as in `runAction`. */
export async function runQuery<I, O>(
  prisma: PrismaClient,
  actor: Actor | null,
  def: QueryDef<I, O>,
  raw: unknown,
  options: { phAccess?: KnownPhAccess } = {},
): Promise<ActionResult<O>> {
  try {
    return await runQueryForPage(prisma, actor, def, raw, options);
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[studio] Query ${def.name} failed with ${describeError(error)}`);
    return failure('INVALID', UNEXPECTED_MESSAGE);
  }
}
