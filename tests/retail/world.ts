import { DAY, NOW, person, pharmacy, prisma, type Person } from '../pharmacy/fixture';

/** Retail fixtures: a linked shop, its plan and its owner, written straight to the database. */

export const RETAIL_LIMITS = { branches: 2, users: 5, terminals: 3, storageMb: 500, aiMonthly: 100 };
export const RETAIL_NAME = { en: 'Shop Starter', ar: 'متجر مبتدئ', ckb: 'فرۆشگا دەستپێک' };

export async function retailPlan(code = 'shop', over: { limits?: unknown; name?: unknown; active?: boolean } = {}) {
  return prisma().appPlan.create({
    data: {
      applicationId: 'retail',
      code,
      name: (over.name ?? RETAIL_NAME) as object,
      limits: (over.limits ?? RETAIL_LIMITS) as object,
      active: over.active ?? true,
    },
  });
}

export interface ShopOpts {
  /** The `retail` subscription; `none` for no row. */
  subscription?: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED' | 'none';
  planCode?: string;
  periodEndsInDays?: number;
  branches?: number;
  /** An owner membership for a new person; false for none. */
  owner?: boolean;
  aiIntake?: boolean;
}

/** A RETAIL business with its `RetailLink`, two branches, an owner and a live `retail` subscription unless told otherwise. */
export async function retailShop(
  name: string,
  opts: ShopOpts = {},
): Promise<{ id: string; branchIds: string[]; owner: Person | null; subscriptionId: string | null }> {
  const shop = await pharmacy(name, { sector: 'RETAIL', subscription: 'none', branches: opts.branches ?? 2 });
  await prisma().retailLink.create({ data: { restaurantId: shop.id, currencies: ['IQD', 'USD'], aiIntake: opts.aiIntake ?? false } });
  let subscriptionId: string | null = null;
  const state = opts.subscription ?? 'ACTIVE';
  if (state !== 'none') {
    const end = new Date(NOW.getTime() + (opts.periodEndsInDays ?? 25) * DAY);
    const created = await prisma().subscription.create({
      data: {
        restaurantId: shop.id,
        applicationId: 'retail',
        planCode: opts.planCode ?? 'shop',
        status: state,
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        trialEndsAt: state === 'TRIAL' ? end : null,
        currentPeriodStart: new Date(end.getTime() - 30 * DAY),
        currentPeriodEnd: end,
        graceDays: 7,
        version: 1,
      },
      select: { id: true },
    });
    subscriptionId = created.id;
  }
  const owner = opts.owner === false ? null : await person(`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-owner`, { membership: [shop.id, 'OWNER'] });
  return { id: shop.id, branchIds: shop.branchIds, owner, subscriptionId };
}

export const linkOf = (restaurantId: string) => prisma().retailLink.findUniqueOrThrow({ where: { restaurantId } });
export const outboxOf = (restaurantId: string) => prisma().retailOutbox.findUnique({ where: { restaurantId } });
