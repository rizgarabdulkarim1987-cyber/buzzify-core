import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { globalDb, scopedClient, type ScopedClient, type ScopedTx } from '@/server/data/tenant-db';
import type { FeatureKey } from '@/server/domain/entitlements';
import { assertAuditSafe } from '@/server/domain/pharmacy/audit-fields';
import type { PhPermission } from '@/server/domain/pharmacy/permissions';
import type { Permission } from '@/server/domain/permissions';
import type { PosPermission } from '@/server/domain/pos/permissions';
import type { PhActor } from '@/server/pharmacy/actor';
import type { PosActor } from '@/server/pos/actor';
import type { Actor } from '@/server/studio/auth/actor';
import {
  admit,
  checkDefinition,
  phScopedClient,
  type Access,
  type CheckedTarget,
  type PhTarget,
  type PosTarget,
  type SelfTarget,
  type Target,
} from './access';
import { createId } from './ids';
import { DuplicateOperationError, type OperationClaim } from './operation';
import type { PlanAccess } from './plan';
import { describeError, expectedFailure, failure, StudioError, UNEXPECTED_MESSAGE, type ActionResult } from './result';

export type { CheckedTarget, PhTarget, PosTarget, SelfTarget, Target } from './access';
export { DuplicateOperationError, type OperationClaim } from './operation';

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

/** How long one transaction may run, for the few actions that write many rows (see `ActionContext.transaction`). */
export interface TransactionOptions {
  timeoutMs: number;
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
  /** Who works in the pharmacy, for an action with a `ph` permission; null for every other. */
  ph: PhActor | null;
  /** The application's client, for reads before the transaction and for calling other services. */
  db: PrismaClient;
  /**
   * For a `ph` action, a client confined to the actor's pharmacy and branches, for reads outside the transaction; null for
   * every other. A ph action reads Ph models only through this or `tx`, never `db` (the enforcement test refuses it).
   */
  scoped: ScopedClient | null;
  /**
   * Runs `fn` in one transaction on a client scoped to the target (`scopedClient`, or `globalDb` for platform and self
   * targets). What the scope filters, for top-level queries:
   *
   * - menu target: the menu's catalog and revisions, that one `Menu` row, and its restaurant's branches, `Restaurant`
   *   row and memberships;
   * - restaurant target: its branches, its `Restaurant` row, its menus and its memberships; menu-scoped models are
   *   refused (a menu's rows need a menu target);
   * - ph target: as a restaurant target for the pharmacy, with the branch-scoped models confined to the actor's
   *   branches (every branch for the owner);
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
   *
   * `options.timeoutMs` raises Prisma's interactive-transaction limit (5 s by default) for an action that knowingly
   * writes many rows at once (a catalog import); every other action keeps the default.
   */
  transaction<T>(fn: (tx: ScopedTx) => Promise<T>, options?: TransactionOptions): Promise<T>;
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
   * has committed. A failed transaction drops what was queued during it, as `transaction` does. Not for a `ph` action,
   * which works in its own pharmacy's branches only.
   */
  transactionIn<T>(scope: TransactionScope, fn: (tx: ScopedTx) => Promise<T>): Promise<T>;
  /** A new id for a row the action is about to create, to scope `transactionIn` to a menu that does not exist yet. */
  newId(): string;
  /**
   * Queues an audit row for the next transaction, or for the end of the action when no transaction follows. A `ph`
   * action's entry must pass `assertAuditSafe` (no patient, prescription or customer field), or the action fails.
   */
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
  /** A pharmacy action that still runs while the pharmacy is read-only (an export, say). */
  allowReadOnly?: true;
  input: z.ZodType<I>;
  run(ctx: ActionContext, input: NoInfer<I>): Promise<O>;
  /** For the steps of enrolling in two-factor (and signing out): a Super Admin without it may still run these. */
  allowWithoutTwoFactor?: boolean;
  /** A feature the target restaurant's plan must include; refused with `UPGRADE_REQUIRED` after the permission. */
  feature?: FeatureKey;
}

/**
 * An action names a permission and a target that checks it, or `permission: null` and the person's own account, their
 * till (`pos`) or their pharmacy (`ph`).
 */
export type ActionSpec<I, O> = ActionFields<I, O> &
  (
    | { permission: Permission; pos?: undefined; ph?: undefined; target(input: NoInfer<I>): CheckedTarget }
    | { permission: null; pos?: undefined; ph?: undefined; target(input: NoInfer<I>): SelfTarget }
    | { permission: null; pos: PosPermission; ph?: undefined; target(input: NoInfer<I>): PosTarget }
    | { permission: null; pos?: undefined; ph: PhPermission; target(input: NoInfer<I>): PhTarget }
  );

export interface ActionDef<I, O> {
  readonly kind: 'action';
  readonly name: string;
  readonly permission: Permission | null;
  /** A till permission instead of a Studio one; the target is then the person's own till. */
  readonly pos?: PosPermission;
  readonly allowLapsed?: true;
  /** A pharmacy permission instead of a Studio one; the target is then the person's own pharmacy. */
  readonly ph?: PhPermission;
  readonly allowReadOnly?: true;
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
    ...(spec.ph === undefined ? {} : { ph: spec.ph }),
    ...(spec.allowReadOnly === undefined ? {} : { allowReadOnly: spec.allowReadOnly }),
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
    private readonly claim?: OperationClaim,
  ) {}

  /** Whether the claimed operation's one transaction has run. */
  claimed = false;

  context(): ActionContext {
    return {
      actor: this.actor,
      restaurantId: this.access.restaurantId,
      menuId: this.access.menuId,
      permissions: this.access.permissions,
      plan: this.access.plan,
      pos: this.access.pos ?? null,
      ph: this.access.ph ?? null,
      db: this.prisma,
      scoped: this.access.ph ? phScopedClient(this.prisma, this.access.ph) : null,
      meta: this.meta,
      transaction: (fn, options) => this.targetTransaction(fn, options),
      transactionIn: (scope, fn) => {
        if (this.claim) throw new Error(`${this.name} runs an operation, which takes the target's one transaction`);
        if (this.access.ph) throw new Error(`${this.name} is a pharmacy action, which works in its own pharmacy: use transaction`);
        return this.transactionIn(scope, fn);
      },
      newId: () => {
        const id = createId();
        this.generated.add(id);
        return id;
      },
      audit: (entry) => {
        this.checkAuditRestaurant(entry);
        // A pharmacy's audit log never carries patient data: such an entry is a bug and fails the action.
        if (this.access.ph) assertAuditSafe(entry.entityType, entry.changes);
        this.audits.push(entry);
      },
      afterCommit: (fn) => {
        this.callbacks.push(fn);
      },
    };
  }

  /** The action's transaction on the target; with an operation, its only one, which records the operation too. */
  private targetTransaction<T>(fn: (tx: ScopedTx) => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (!this.claim) return this.run(this.client(), this.access, fn, undefined, undefined, options);
    if (this.claimed) return Promise.reject(new Error(`${this.name} runs an operation, which takes one transaction`));
    return this.run(this.client(), this.access, fn, undefined, this.claim, options).then((value) => {
      // A transaction that failed has recorded nothing, so an action that retries it (a lost race for the next number) may.
      this.claimed = true;
      return value;
    });
  }

  /** The target's client: a menu and its restaurant, a restaurant alone, a pharmacy's branches, or global rows only. */
  private client(): ScopedClient {
    const { restaurantId, menuId, ph } = this.access;
    if (ph) return phScopedClient(this.prisma, ph);
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
    claim?: OperationClaim,
    options?: TransactionOptions,
  ): Promise<T> {
    const auditsBefore = this.audits.length;
    const callbacksBefore = this.callbacks.length;
    let value: T;
    try {
      value = await client.$transaction(
        async (tx) => {
          if (claim) await this.record(tx, claim, place);
          const result = await fn(tx);
          if (check) await check(tx);
          if (claim) await this.complete(tx, claim, place, result);
          if (this.audits.length > 0) await tx.auditLog.createMany({ data: this.rows(this.audits, place) });
          return result;
        },
        // maxWait is the wait for a connection, not the work: kept short so a busy pool still answers soon.
        options ? { timeout: options.timeoutMs, maxWait: Math.min(options.timeoutMs, 10_000) } : undefined,
      );
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

  /** The operation's row, inserted first: a second copy of the same id fails here and none of its change is made. */
  private async record(tx: ScopedTx, claim: OperationClaim, place: Place): Promise<void> {
    if (place.restaurantId === null) throw new Error(`${this.name} runs an operation outside a restaurant`);
    try {
      await tx.posSyncOperation.create({
        data: {
          restaurantId: place.restaurantId,
          userId: this.actor.userId,
          deviceId: claim.deviceId,
          operationId: claim.operationId,
          kind: claim.kind,
          payloadHash: claim.payloadHash,
          result: {},
          clientAt: claim.clientAt,
        },
        select: { id: true },
      });
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'P2002') throw new DuplicateOperationError(claim.operationId);
      throw error;
    }
  }

  /** The action's answer, stored with the change, and the audit row that says which device sent it and when. */
  private async complete(tx: ScopedTx, claim: OperationClaim, place: Place, result: unknown): Promise<void> {
    const stored = JSON.parse(JSON.stringify(result ?? {})) as Prisma.InputJsonObject;
    const updated = await tx.posSyncOperation.updateMany({
      where: { restaurantId: place.restaurantId as string, operationId: claim.operationId },
      data: { result: stored },
    });
    if (updated.count !== 1) throw new Error(`${this.name} lost its operation row`);
    this.audits.push({
      action: 'pos.sync.apply',
      entityType: 'PosSyncOperation',
      entityId: claim.operationId,
      changes: { kind: { before: null, after: claim.kind }, deviceId: { before: null, after: claim.deviceId }, clientAt: { before: null, after: claim.clientAt.toISOString() } },
    });
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
  options: { operation?: OperationClaim } = {},
): Promise<ActionResult<O>> {
  try {
    if (def.kind !== 'action') throw new Error(`Studio ${def.name} is not an action`);
    // `'view'` admits any member; an action always names the permission it needs (defineAction refuses it too).
    if ((def.permission as unknown) === 'view') throw new Error(`Studio action ${def.name} cannot use 'view'`);
    const admitted = await admit(prisma, actor, def, raw);
    if (!admitted.ok) return admitted;
    const work = new Work(prisma, admitted.actor, admitted.access, clampMeta(meta), def.name, options.operation);
    const data = await def.run(work.context(), admitted.input);
    if (options.operation && !work.claimed) throw new Error(`Studio action ${def.name} ran an operation without its transaction`);
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
