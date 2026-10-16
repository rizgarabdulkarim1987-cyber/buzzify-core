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

/** Better Auth's tables (accounts, sessions, tokens, its own HTTP rate limits) and the Studio's rate-limit counters. */
export const GLOBAL_MODELS = [
  'Restaurant',
  'User',
  'Session',
  'Account',
  'Verification',
  'TwoFactor',
  'RateLimit',
  'AuthRateLimit',
] as const;

type ScopeColumn = 'menuId' | 'restaurantId';

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
 * A Prisma extension that confines every query on `models` to rows whose `column` equals `id`: reads and writes are
 * filtered, creates are stamped, and an update may change anything except which owner a row belongs to.
 */
function scopeExtension(column: ScopeColumn, models: readonly string[], id: string) {
  if (!id) throw new Error(`Scoping by ${column} requires a value`);
  const scoped = new Set<string>(models);
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

  return Prisma.defineExtension({
    name: `tenant-scope:${column}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!scoped.has(model)) return query(args);
          const input = (args ?? {}) as Args;
          if (UPDATING.has(operation)) {
            const filtered = scopeWhere(input);
            return query({ ...filtered, data: guardUpdate(input.data) } as never);
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
            } as never);
          }
          throw new Error(`Operation ${operation} is not allowed on ${relation}-scoped model ${model}`);
        },
      },
    },
  });
}

/** A client confined to one menu's rows (and, as before, unrestricted on models that are not menu-scoped). */
export function menuDb(prisma: PrismaClient, menuId: string) {
  if (!menuId) throw new Error('menuDb requires a menuId');
  return prisma.$extends(scopeExtension('menuId', MENU_SCOPED_MODELS, menuId));
}

/** A client confined to one restaurant's rows. */
export function restaurantDb(prisma: PrismaClient, restaurantId: string) {
  if (!restaurantId) throw new Error('restaurantDb requires a restaurantId');
  return prisma.$extends(scopeExtension('restaurantId', RESTAURANT_SCOPED_MODELS, restaurantId));
}

export type MenuDb = ReturnType<typeof menuDb>;
export type RestaurantDb = ReturnType<typeof restaurantDb>;

/**
 * A client confined to a menu, a restaurant, or both. Each id that is given applies its own extension, so a client
 * given both scopes menu rows and branches in the same transaction.
 */
export function scopedClient(prisma: PrismaClient, scope: { menuId?: string; restaurantId?: string }) {
  if (scope.menuId === undefined && scope.restaurantId === undefined) {
    throw new Error('scopedClient requires a menuId or a restaurantId');
  }
  // A query extension leaves the client's type as it is, so every combination of scopes shares one type.
  let client: MenuDb = prisma as never;
  if (scope.menuId !== undefined) {
    client = client.$extends(scopeExtension('menuId', MENU_SCOPED_MODELS, scope.menuId)) as never;
  }
  if (scope.restaurantId !== undefined) {
    client = client.$extends(scopeExtension('restaurantId', RESTAURANT_SCOPED_MODELS, scope.restaurantId)) as never;
  }
  return client;
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
