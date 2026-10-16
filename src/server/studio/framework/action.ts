import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { globalDb, scopedClient, type ScopedClient, type ScopedTx } from '@/server/data/tenant-db';
import type { Permission } from '@/server/domain/permissions';
import type { Actor } from '@/server/studio/auth/actor';
import { admit, checkDefinition, type Access, type CheckedTarget, type SelfTarget, type Target } from './access';
import { describeError, expectedFailure, failure, UNEXPECTED_MESSAGE, type ActionResult } from './result';

export type { CheckedTarget, SelfTarget, Target } from './access';

/** One audit row, as the action describes it. Who, where, when and from which address are added by the framework. */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  /** What changed, field by field. Chosen by the action: never a request body, a password or a token. */
  changes?: Record<string, { before: unknown; after: unknown }>;
}

/** Where the request came from, for the audit log. */
export interface RequestMeta {
  ip: string;
  userAgent: string;
}

/** What an action's handler receives, besides its parsed input. */
export interface ActionContext {
  actor: Actor;
  /** The target's restaurant (a menu's own restaurant for a menu target); null for platform and self targets. */
  restaurantId: string | null;
  menuId: string | null;
  /** What the actor may do at the target. */
  permissions: ReadonlySet<Permission>;
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
   * through `tx`. A nested `include` or write from a filtered row stays inside its owner.
   *
   * The audit entries queued so far are written inside the transaction before it commits; `afterCommit` callbacks run
   * once it has committed. A failed transaction drops the entries and callbacks queued during it. Run one transaction
   * at a time.
   */
  transaction<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T>;
  /** Queues an audit row for the next transaction, or for the end of the action when no transaction follows. */
  audit(entry: AuditEntry): void;
  /** Queues work for after the next commit (or the end of the action), such as expiring a cached menu. */
  afterCommit(fn: () => void): void;
}

// The input type comes from the schema alone (`NoInfer` elsewhere), so a shared target helper that reads fewer fields
// than the schema has does not narrow what the handler sees.
interface ActionFields<I, O> {
  name: string;
  input: z.ZodType<I>;
  run(ctx: ActionContext, input: NoInfer<I>): Promise<O>;
  /** For the steps of enrolling in two-factor (and signing out): a Super Admin without it may still run these. */
  allowWithoutTwoFactor?: boolean;
}

/** An action names a permission and a target that checks it, or `permission: null` and the person's own account. */
export type ActionSpec<I, O> = ActionFields<I, O> &
  (
    | { permission: Permission; target(input: NoInfer<I>): CheckedTarget }
    | { permission: null; target(input: NoInfer<I>): SelfTarget }
  );

export interface ActionDef<I, O> {
  readonly kind: 'action';
  readonly name: string;
  readonly permission: Permission | null;
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

/** One action's run: the audit rows and callbacks it has queued, and the transactions it opens. */
class Work {
  private audits: AuditEntry[] = [];
  private callbacks: Array<() => void> = [];

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
      db: this.prisma,
      transaction: (fn) => this.transaction(fn),
      audit: (entry) => {
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

  private rows(entries: AuditEntry[]): Prisma.AuditLogCreateManyInput[] {
    return entries.map((entry) => ({
      actorId: this.actor.userId,
      restaurantId: this.access.restaurantId,
      menuId: this.access.menuId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      changes: (entry.changes ?? {}) as Prisma.InputJsonValue,
      ip: this.meta.ip,
      userAgent: this.meta.userAgent,
    }));
  }

  async transaction<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
    const auditsBefore = this.audits.length;
    const callbacksBefore = this.callbacks.length;
    let value: T;
    try {
      value = await this.client().$transaction(async (tx) => {
        const result = await fn(tx);
        if (this.audits.length > 0) await tx.auditLog.createMany({ data: this.rows(this.audits) });
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

  /** After the handler has returned: audit rows no transaction took (an export, say), then the remaining callbacks. */
  async finish(): Promise<void> {
    if (this.audits.length > 0) {
      await this.prisma.auditLog.createMany({ data: this.rows(this.audits) });
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
