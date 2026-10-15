import type { PrismaClient } from '@/generated/prisma/client';

export const TENANT_SCOPED_MODELS = [
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
] as const;

/** Looked up by host before the tenant is known, so they use the unscoped client. */
export const UNSCOPED_LOOKUP_MODELS = ['RestaurantDomain'] as const;

export const GLOBAL_MODELS = ['Restaurant'] as const;

const SCOPED = new Set<string>(TENANT_SCOPED_MODELS);
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

/** An update may change anything except which restaurant owns the row. */
function guardUpdate(data: unknown, restaurantId: string): unknown {
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.restaurantId !== undefined && row.restaurantId !== restaurantId) {
    throw new Error('Tenant mismatch: refusing to move a row to another restaurant');
  }
  if (row.restaurant !== undefined) {
    throw new Error('Tenant mismatch: a scoped update may not change the owning restaurant');
  }
  return data;
}

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

function scopeWhere(args: Args, restaurantId: string): Args {
  const where = args.where ?? {};
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...args, where: { ...where, AND: [...existing, { restaurantId }] } };
}

function scopeData(row: unknown, restaurantId: string): Record<string, unknown> {
  const data = (row ?? {}) as Record<string, unknown>;
  if (data.restaurantId !== undefined && data.restaurantId !== restaurantId) {
    throw new Error('Tenant mismatch: refusing to write a row for another restaurant');
  }
  return { ...data, restaurantId };
}

export function scopedDb(prisma: PrismaClient, restaurantId: string) {
  if (!restaurantId) throw new Error('scopedDb requires a restaurantId');
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SCOPED.has(model)) return query(args);
          const input = (args ?? {}) as Args;
          if (UPDATING.has(operation)) {
            const scoped = scopeWhere(input, restaurantId);
            return query({ ...scoped, data: guardUpdate(input.data, restaurantId) } as never);
          }
          if (FILTERED.has(operation)) return query(scopeWhere(input, restaurantId));
          if (CREATING.has(operation)) {
            const data = input.data;
            const next = Array.isArray(data)
              ? data.map((row) => scopeData(row, restaurantId))
              : scopeData(data, restaurantId);
            return query({ ...input, data: next });
          }
          if (operation === 'upsert') {
            return query({
              ...scopeWhere(input, restaurantId),
              create: scopeData(input.create, restaurantId),
              update: guardUpdate(input.update, restaurantId),
            } as never);
          }
          throw new Error(`Operation ${operation} is not allowed on tenant-scoped model ${model}`);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
