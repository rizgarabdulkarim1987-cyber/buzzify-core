import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { globalDb, scopedClient, type ScopedClient, type ScopedTx } from '@/server/data/tenant-db';
import type { FeatureKey } from '@/server/domain/entitlements';
import type { Permission } from '@/server/domain/permissions';
import type { PosPermission } from '@/server/domain/pos/permissions';
import type { PosActor } from '@/server/pos/actor';
import type { Actor } from '@/server/studio/auth/actor';
import { admit, checkDefinition, type Access, type CheckedTarget, type PosTarget, type SelfTarget, type Target } from './access';
import { createId } from './ids';
import type { PlanAccess } from './plan';
import { describeError, expectedFailure, failure, StudioError, UNEXPECTED_MESSAGE, type ActionResult } from './result';

export type { CheckedTarget, PosTarget, SelfTarget, Target } from './access';

/** One audit row, as the action describes it. Who, where, when and from which address are added by the framework. */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  /**
   * The restaurant the row is filed under, for an action whose target is the platform and that acts on one restaurant
   * (creating it, say, so its Activity tab shows that). A restaurant or menu target files every row under its own
   * restaurant, so a value there must be that same restaurant; any other is a bug and fails the action.
   */
  restaurantId?: string;
  /** What changed, field by field. Chosen by the action: never a request body, a password or a token. */
  changes?: Record<string, { before: unknown; after: unknown }>;
}

/** Where the request came from, for the audit log. */
export interface RequestMeta {
  ip: string;
  userAgent: string;
}

/** Where `transactionIn` runs: a restaurant, and optionally one of its menus. */
export interface TransactionScope {
  restaurantId: string;
  menuId?: string;
}

/** What an action's handler receives, besides its parsed input. */
export interface ActionContext {
  actor: Actor;
  /** The target's restaurant (a menu's own restaurant for a menu target); null for platform and self targets. */
  restaurantId: string | null;
  menuId: string | null;
  /** What the actor may do at the target. */
  permissions: ReadonlySet<Permission>;
  /** What the target's restaurant has bought; null for platform and self targets. See `requireFeature`. */
  plan: PlanAccess | null;
  /** Who is at the till, for an action with a `pos` permission; null for every other. */
  pos: PosActor | null;
  /** The application's client, for reads before the transaction and for calling other services. */
  db: PrismaClient;
  /**
   * Runs `fn` in one transaction on a client scoped to the target (`scopedClient`, or `globalDb` for platform and self
   * targets). What the scope filters, for top-level queries:
   *
   * - menu target: the menu's catalog and revisions, that one `Menu` row, and its restaurant's branches, `Restaurant`
   *   row and memberships;
   * - restaurant target: its branches, its `Restaurant` row, its menus and its memberships; menu-scoped models are
   *   refused (a menu's rows need a menu target);
   * - platform and self targets: menu- and restaurant-scoped models are refused, and nothing else is filtered.
   *
   * Never filtered: `MenuSlug`, `MenuDomain`, `User` and the other global models (and `Restaurant`, `Menu`,
   * `Membership` on platform and self targets). A handler keys them by `restaurantId`/`menuId` above or by
   * `actor.userId`, never by ids from its input. Nested writes into models the scope does not filter, and references to
   * other rows (scalar foreign keys, nested `connect` or `set`), are the handler's to check: take such ids from rows read
   * through `tx`. The scope filters top-level queries only: a nested `include`, `select` or write follows its relation
   * unfiltered. From a filtered row, a relation to rows the owner holds (a menu's products, a restaurant's branches)
   * stays inside the owner because their foreign keys name it; one that passes through an unfiltered model does not
   * (`membership` → `user` → `memberships` reaches the person's other restaurants), so never nest through a global model
   * back into restaurant or menu rows.
   *
   * The audit entries queued so far are written inside the transaction before it commits; `afterCommit` callbacks run
   * once it has committed. A failed transaction drops the entries and callbacks queued during it. Run one transaction
   * at a time.
   */
  transaction<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T>;
  /**
   * Like `transaction`, on a client scoped to `scope` instead of the target: for an action that makes a menu (whose rows
   * need a client scoped to it) or that works in another restaurant (a Super Admin duplicating a menu into it).
   *
   * - `restaurantId` is the target's own restaurant, or, for a Super Admin only, any other that exists (`FORBIDDEN` for
   *   anyone else, `NOT_FOUND` when it does not exist).
   * - `menuId`, when given, is the target's own menu, or an id from `newId()` for a menu this transaction creates (the
   *   client lets it create the `Menu` row with that id, and the transaction fails unless it does). Any other menu is a
   *   bug in the action and fails it.
   *
   * Audit rows are written inside it, filed under the scope's restaurant and menu; afterCommit callbacks run once it
   * has committed. A failed transaction drops what was queued during it, as `transaction` does.
   */
  transactionIn<T>(scope: TransactionScope, fn: (tx: ScopedTx) => Promise<T>): Promise<T>;
  /** A new id for a row the action is about to create, to scope `transactionIn` to a menu that does not exist yet. */
  newId(): string;
  /** Queues an audit row for the next transaction, or for the end of the action when no transaction follows. */
  audit(entry: AuditEntry): void;
  /** Queues work for after the next commit (or the end of the action), such as expiring a cached menu. */
  afterCommit(fn: () => void): void;
  /** The request's address and browser: an action that runs others for each of many targets passes them on. */
  meta: RequestMeta;
}

// The input type comes from the schema alone (`NoInfer` elsewhere), so a shared target helper that reads fewer fields
// than the schema has does not narrow what the handler sees.
interface ActionFields<I, O> {
  name: string;
  /** A till definition that still runs when the Cashier subscription has lapsed (closing and reading a shift). */
  allowLapsed?: true;
  input: z.ZodType<I>;
  run(ctx: ActionContext, input: NoInfer<I>): Promise<O>;
  /** For the steps of enrolling in two-factor (and signing out): a Super Admin without it may still run these. */
  allowWithoutTwoFactor?: boolean;
  /** A feature the target restaurant's plan must include; refused with `UPGRADE_REQUIRED` after the permission. */
  feature?: FeatureKey;
}

/** An action names a permission and a target that checks it, or `permission: null` and the person's own account. */
export type ActionSpec<I, O> = ActionFields<I, O> &
  (
    | { permission: Permission; pos?: undefined; target(input: NoInfer<I>): CheckedTarget }
    | { permission: null; pos?: undefined; target(input: NoInfer<I>): SelfTarget }
    | { permission: null; pos: PosPermission; target(input: NoInfer<I>): PosTarget }
  );

export interface ActionDef<I, O> {
  readonly kind: 'action';
  readonly name: string;
  readonly permission: Permission | null;
  /** A till permission instead of a Studio one; the target is then the person's own till. */
  readonly pos?: PosPermission;
  readonly allowLapsed?: true;
  readonly feature?: FeatureKey;
  readonly input: z.ZodType<I>;
  readonly target: (input: I) => Target;
  readonly run: (ctx: ActionContext, input: I) => Promise<O>;
  readonly allowWithoutTwoFactor: boolean;
}

/** Defines a Studio action. Every Server Action and every POST route of the Studio is one of these. */
export function defineAction<I, O>(spec: ActionSpec<I, O>): ActionDef<I, O> {
  checkDefinition('action', spec);
  return Object.freeze({
    kind: 'action',
    name: spec.name,
    permission: spec.permission,
    ...(spec.pos === undefined ? {} : { pos: spec.pos }),
    ...(spec.allowLapsed === undefined ? {} : { allowLapsed: spec.allowLapsed }),
    ...(spec.feature === undefined ? {} : { feature: spec.feature }),
    input: spec.input,
    target: spec.target as (input: I) => Target,
    run: spec.run,
    allowWithoutTwoFactor: spec.allowWithoutTwoFactor ?? false,
  });
}

const MAX_IP = 64;
const MAX_USER_AGENT = 512;

/** The request's address (the first `x-forwarded-for` entry) and browser, capped to what the audit log keeps. */
export function requestMeta(source: Headers): RequestMeta {
  return clampMeta({
    ip: source.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '',
    userAgent: source.get('user-agent') ?? '',
  });
}

/** `meta` capped to what the audit log keeps. */
export function clampMeta(meta: RequestMeta): RequestMeta {
  return { ip: String(meta.ip ?? '').slice(0, MAX_IP), userAgent: String(meta.userAgent ?? '').slice(0, MAX_USER_AGENT) };
}

/** Where audit rows are filed: the target's restaurant and menu, or the scope of `transactionIn`. */
interface Place {
  restaurantId: string | null;
  menuId: string | null;
}

/** One action's run: the audit rows and callbacks it has queued, and the transactions it opens. */
class Work {
  private audits: AuditEntry[] = [];
  private callbacks: Array<() => void> = [];
  /** Ids from `newId()` that no committed transaction has created a menu with yet. */
  private readonly generated = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly actor: Actor,
    private readonly access: Access,
    private readonly meta: RequestMeta,
    private readonly name: string,
  ) {}

  context(): ActionContext {
    return {
      actor: this.actor,
      restaurantId: this.access.restaurantId,
      menuId: this.access.menuId,
      permissions: this.access.permissions,
      plan: this.access.plan,
      pos: this.access.pos ?? null,
      db: this.prisma,
      meta: this.meta,
      transaction: (fn) => this.run(this.client(), this.access, fn),
      transactionIn: (scope, fn) => this.transactionIn(scope, fn),
      newId: () => {
        const id = createId();
        this.generated.add(id);
        return id;
      },
      audit: (entry) => {
        this.checkAuditRestaurant(entry);
        this.audits.push(entry);
      },
      afterCommit: (fn) => {
        this.callbacks.push(fn);
      },
    };
  }

  /** The target's client: a menu and its restaurant, a restaurant alone, or global rows only. */
  private client(): ScopedClient {
    const { restaurantId, menuId } = this.access;
    if (restaurantId === null) return globalDb(this.prisma);
    return scopedClient(this.prisma, menuId === null ? { restaurantId } : { menuId, restaurantId });
  }

  /** A restaurant or menu target files its rows under its own restaurant: an entry may not name another one. */
  private checkAuditRestaurant(entry: AuditEntry): void {
    const own = this.access.restaurantId;
    if (own !== null && entry.restaurantId !== undefined && entry.restaurantId !== own) {
      throw new Error('An audit entry names a restaurant other than its target');
    }
  }

  private rows(entries: AuditEntry[], place: Place): Prisma.AuditLogCreateManyInput[] {
    return entries.map((entry) => ({
      actorId: this.actor.userId,
      restaurantId: place.restaurantId ?? entry.restaurantId ?? null,
      menuId: place.menuId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      changes: (entry.changes ?? {}) as Prisma.InputJsonValue,
      ip: this.meta.ip,
      userAgent: this.meta.userAgent,
    }));
  }

  /**
   * Runs `fn` in one transaction on `client`, writes the queued audit rows (filed under `place`) before it commits, and
   * runs the callbacks once it has. `check` runs last inside the transaction, so a failing check rolls it all back.
   */
  private async run<T>(
    client: ScopedClient,
    place: Place,
    fn: (tx: ScopedTx) => Promise<T>,
    check?: (tx: ScopedTx) => Promise<void>,
  ): Promise<T> {
    const auditsBefore = this.audits.length;
    const callbacksBefore = this.callbacks.length;
    let value: T;
    try {
      value = await client.$transaction(async (tx) => {
        const result = await fn(tx);
        if (check) await check(tx);
        if (this.audits.length > 0) await tx.auditLog.createMany({ data: this.rows(this.audits, place) });
        return result;
      });
    } catch (error) {
      // What was queued during the failed transaction belonged to it; what was queued before waits for the next one.
      this.audits.length = auditsBefore;
      this.callbacks.length = callbacksBefore;
      throw error;
    }
    this.audits = [];
    this.runCallbacks();
    return value;
  }

  private async transactionIn<T>(scope: TransactionScope, fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
    const restaurantId: unknown = scope?.restaurantId;
    const menuId: unknown = scope?.menuId;
    if (typeof restaurantId !== 'string' || restaurantId === '') throw new Error('transactionIn needs a restaurant');
    if (menuId !== undefined && (typeof menuId !== 'string' || menuId === '')) throw new Error('transactionIn needs a menu id or none');

    if (restaurantId !== this.access.restaurantId) {
      // Another restaurant is a Super Admin's to work in, never anyone else's, whatever they belong to.
      if (!this.actor.isSuperAdmin) throw new StudioError('FORBIDDEN');
      const exists = await this.prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
      if (!exists) throw new StudioError('NOT_FOUND');
    }

    let creating: string | null = null;
    if (menuId !== undefined) {
      if (menuId === this.access.menuId) {
        if (restaurantId !== this.access.restaurantId) throw new Error("transactionIn: the target's menu is in the target's restaurant");
      } else if (this.generated.has(menuId)) {
        creating = menuId;
      } else {
        throw new Error('transactionIn: the menu must be the target or one the action created with newId()');
      }
    }

    const client = scopedClient(this.prisma, menuId === undefined ? { restaurantId } : { menuId, restaurantId });
    const created = creating;
    const value = await this.run(client, { restaurantId, menuId: menuId ?? null }, fn, async (tx) => {
      if (created === null) return;
      // The client finds a menu only by its id and restaurant, so this also says it was made where the scope says.
      const menu = await tx.menu.findFirst({ where: { id: created }, select: { id: true } });
      if (!menu) throw new Error(`transactionIn: the menu ${created} was not created in the transaction scoped to it`);
    });
    // The menu exists now: its id names a menu like any other and cannot be scoped to as a new one again.
    if (created !== null) this.generated.delete(created);
    return value;
  }

  /** After the handler has returned: audit rows no transaction took (an export, say), then the remaining callbacks. */
  async finish(): Promise<void> {
    if (this.audits.length > 0) {
      await this.prisma.auditLog.createMany({ data: this.rows(this.audits, this.access) });
      this.audits = [];
    }
    this.runCallbacks();
  }

  /** The change has committed, so a failing callback is logged and does not fail the action. */
  private runCallbacks(): void {
    const callbacks = this.callbacks;
    this.callbacks = [];
    const report = (error: unknown) =>
      console.error(`[studio] An afterCommit callback of ${this.name} failed with ${describeError(error)}`);
    for (const callback of callbacks) {
      try {
        const returned: unknown = callback();
        if (returned instanceof Promise) returned.catch(report);
      } catch (error) {
        report(error);
      }
    }
  }
}

/**
 * Runs an action for `actor` (null when nobody is signed in). The checks run in order (sign-in, two-factor, input,
 * target, permission; see `admit`), then the handler. A `StudioError` it throws becomes the result; anything else is
 * logged with the action's name (never its input) and answered with a generic `INVALID`, so no detail leaves the
 * server. Next's own interrupts (`redirect`, `notFound`) pass through.
 */
export async function runAction<I, O>(
  prisma: PrismaClient,
  actor: Actor | null,
  def: ActionDef<I, O>,
  raw: unknown,
  meta: RequestMeta,
): Promise<ActionResult<O>> {
  try {
    if (def.kind !== 'action') throw new Error(`Studio ${def.name} is not an action`);
    // `'view'` admits any member; an action always names the permission it needs (defineAction refuses it too).
    if ((def.permission as unknown) === 'view') throw new Error(`Studio action ${def.name} cannot use 'view'`);
    const admitted = await admit(prisma, actor, def, raw);
    if (!admitted.ok) return admitted;
    const work = new Work(prisma, admitted.actor, admitted.access, clampMeta(meta), def.name);
    const data = await def.run(work.context(), admitted.input);
    await work.finish();
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    const expected = expectedFailure(error);
    if (expected) return expected;
    console.error(`[studio] Action ${def.name} failed with ${describeError(error)}`);
    return failure('INVALID', UNEXPECTED_MESSAGE);
  }
}
