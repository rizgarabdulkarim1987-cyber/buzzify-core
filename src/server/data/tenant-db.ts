import { Prisma, type PrismaClient } from '@/generated/prisma/client';

/** Rows that belong to one menu and carry a required `menuId`. */
export const MENU_SCOPED_MODELS = [
  'BrandConfig',
  'Category',
  'Product',
  'ProductVariant',
  'ModifierGroup',
  'ModifierOption',
  'UpsellRule',
  'PairingRule',
  'Bundle',
  'BundleItem',
  'DaypartSchedule',
  'Table',
  'AnalyticsEvent',
  'MenuRevision',
] as const;

/** Rows that belong to one restaurant and carry a required `restaurantId`. */
export const RESTAURANT_SCOPED_MODELS = ['Branch'] as const;

/** Looked up by slug or host before the tenant is known, so they use the unscoped client. */
export const UNSCOPED_LOOKUP_MODELS = ['Menu', 'MenuSlug', 'MenuDomain'] as const;

/**
 * Global models that reference a restaurant by design, because they are queried across restaurants: a person's
 * memberships are read by user, to learn which restaurants they may open.
 */
export const CROSS_RESTAURANT_MODELS = ['Membership'] as const;

/**
 * Better Auth's tables (accounts, sessions, tokens, its own HTTP rate limits), the Studio's rate-limit counters, and the
 * audit log, which names restaurants and menus by id so it can be read across them and outlive them.
 */
export const GLOBAL_MODELS = [
  'Restaurant',
  'User',
  'Session',
  'Account',
  'Verification',
  'TwoFactor',
  'RateLimit',
  'AuthRateLimit',
  'AuditLog',
] as const;

type ScopeColumn = 'menuId' | 'restaurantId';

/** Which menu and which restaurant a client is confined to. A class of rows whose id is missing is refused outright. */
interface Scope {
  menuId?: string;
  restaurantId?: string;
}

const FILTERED = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const CREATING = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATING = new Set(['update', 'updateMany', 'updateManyAndReturn']);

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

/**
 * The guards for one scoped model: every query on it is confined to rows whose `column` equals `id`. Reads and writes
 * are filtered, creates are stamped, and an update may change anything except which owner a row belongs to.
 */
function confine(column: ScopeColumn, id: string) {
  /** The relation field that mirrors the column: `menuId` is the foreign key of `menu`. */
  const relation = column === 'menuId' ? 'menu' : 'restaurant';

  function guardUpdate(data: unknown): unknown {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row[column] !== undefined && row[column] !== id) {
      throw new Error(`Tenant mismatch: refusing to move a row to another ${relation}`);
    }
    if (row[relation] !== undefined) {
      throw new Error(`Tenant mismatch: a scoped update may not change the owning ${relation}`);
    }
    return data;
  }

  function scopeWhere(args: Args): Args {
    const where = args.where ?? {};
    const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    return { ...args, where: { ...where, AND: [...existing, { [column]: id }] } };
  }

  function scopeData(row: unknown): Record<string, unknown> {
    const data = (row ?? {}) as Record<string, unknown>;
    if (data[column] !== undefined && data[column] !== id) {
      throw new Error(`Tenant mismatch: refusing to write a row for another ${relation}`);
    }
    return { ...data, [column]: id };
  }

  return function run(model: string, operation: string, input: Args, query: (args: unknown) => Promise<unknown>) {
    if (UPDATING.has(operation)) {
      const filtered = scopeWhere(input);
      return query({ ...filtered, data: guardUpdate(input.data) });
    }
    if (FILTERED.has(operation)) return query(scopeWhere(input));
    if (CREATING.has(operation)) {
      const data = input.data;
      const next = Array.isArray(data) ? data.map((row) => scopeData(row)) : scopeData(data);
      return query({ ...input, data: next });
    }
    if (operation === 'upsert') {
      return query({
        ...scopeWhere(input),
        create: scopeData(input.create),
        update: guardUpdate(input.update),
      });
    }
    throw new Error(`Operation ${operation} is not allowed on ${relation}-scoped model ${model}`);
  };
}

const MENU_SCOPED = new Set<string>(MENU_SCOPED_MODELS);
const RESTAURANT_SCOPED = new Set<string>(RESTAURANT_SCOPED_MODELS);

/**
 * A Prisma extension that confines menu-scoped models to `scope.menuId` and restaurant-scoped models to
 * `scope.restaurantId`, and fails closed: a scoped model whose id the scope lacks is refused, never served unscoped. So
 * a client for one menu cannot list every restaurant's branches, and a client for one restaurant cannot list every
 * menu's products. Global and lookup models pass through.
 */
function tenantScope(scope: Scope) {
  const menu = scope.menuId === undefined ? null : confine('menuId', scope.menuId);
  const restaurant = scope.restaurantId === undefined ? null : confine('restaurantId', scope.restaurantId);

  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const input = (args ?? {}) as Args;
          const forward = query as (args: unknown) => Promise<unknown>;
          if (MENU_SCOPED.has(model)) {
            if (!menu) throw new Error(`Tenant scope: ${model} is menu-scoped and this client has no menu`);
            return menu(model, operation, input, forward);
          }
          if (RESTAURANT_SCOPED.has(model)) {
            if (!restaurant) throw new Error(`Tenant scope: ${model} is restaurant-scoped and this client has no restaurant`);
            return restaurant(model, operation, input, forward);
          }
          return query(args);
        },
      },
    },
  });
}

/** A client confined to one menu's rows. Restaurant-scoped models are refused: use `scopedClient` with both ids. */
export function menuDb(prisma: PrismaClient, menuId: string) {
  if (!menuId) throw new Error('menuDb requires a menuId');
  return prisma.$extends(tenantScope({ menuId }));
}

/** A client confined to one restaurant's rows. Menu-scoped models are refused: use `scopedClient` with both ids. */
export function restaurantDb(prisma: PrismaClient, restaurantId: string): MenuDb {
  if (!restaurantId) throw new Error('restaurantDb requires a restaurantId');
  // A query extension leaves the client's type as it is, so every scope shares one type.
  return prisma.$extends(tenantScope({ restaurantId })) as never;
}

export type MenuDb = ReturnType<typeof menuDb>;
export type RestaurantDb = ReturnType<typeof restaurantDb>;

/**
 * A client confined to a menu, a restaurant, or both. Given both, it scopes menu rows by the menu and branches by the
 * restaurant (in the same transaction); given one, it refuses the other class of rows.
 */
export function scopedClient(prisma: PrismaClient, scope: Scope): MenuDb {
  if (scope.menuId === undefined && scope.restaurantId === undefined) {
    throw new Error('scopedClient requires a menuId or a restaurantId');
  }
  if (scope.menuId === '') throw new Error('scopedClient requires a non-empty menuId');
  if (scope.restaurantId === '') throw new Error('scopedClient requires a non-empty restaurantId');
  return prisma.$extends(tenantScope(scope)) as never;
}

/**
 * A client for work that belongs to no restaurant: platform settings, people, a person's own account. It serves global
 * and lookup models and refuses every menu- and restaurant-scoped one.
 */
export function globalDb(prisma: PrismaClient): MenuDb {
  return prisma.$extends(tenantScope({})) as never;
}

export type ScopedClient = ReturnType<typeof scopedClient>;

/** The client a `scopedClient(...).$transaction(async (tx) => ...)` callback receives. */
export type ScopedTx = Omit<ScopedClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/** A scoped client or a transaction of one. */
export type ScopedDb = ScopedClient | ScopedTx;

/**
 * The model delegates every client has: the app's client and its transactions are this type. Code that takes any
 * client declares two overloads, one for `AnyDb` and one for `ScopedDb` (TypeScript cannot check a call against a
 * single union of both kinds: the comparison is too deep), and works through `delegates(db)`. It cannot scope the
 * client further, since a transaction has no `$extends`, so it names the menu in every query's `where` itself.
 */
export type AnyDb = Omit<Prisma.TransactionClient, '$transaction'>;

/** Either kind of client, seen through the delegates they share. The two differ only in their TypeScript types. */
export function delegates(db: AnyDb | ScopedDb): AnyDb {
  return db as unknown as AnyDb;
}
