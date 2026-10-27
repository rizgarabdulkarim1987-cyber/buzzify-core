import { PLAN_TIERS, type PlanTier } from '@/server/domain/entitlements';
import { BUSINESS_SECTORS, RESTAURANT_STATUSES, RESTAURANT_TYPES, type BusinessSector, type RestaurantStatus, type RestaurantType } from '@/server/domain/restaurant-profile';

type RawParams = Record<string, string | string[] | undefined>;

export const LIST_PARAMS = ['q', 'city', 'type', 'sector', 'status', 'plan', 'createdFrom', 'createdTo'] as const;

export type SortKey = 'name' | 'createdAt' | 'city';

const SORTS: readonly SortKey[] = ['name', 'createdAt', 'city'];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export interface ListInput {
  q?: string;
  city?: string;
  type?: RestaurantType;
  sector?: BusinessSector;
  status?: RestaurantStatus;
  plan?: PlanTier;
  createdFrom?: string;
  createdTo?: string;
  sort: SortKey;
  dir: 'asc' | 'desc';
  page: number;
}

/**
 * The list's filters, sort and page from the address. The address is the person's to edit, so anything that does not
 * parse is left out rather than refused: a typo in a bookmarked link shows the list, not an error.
 */
export function listInput(raw: RawParams): ListInput {
  const text = (name: string, max: number) => first(raw[name])?.trim().slice(0, max) || undefined;
  const type = first(raw.type);
  const sector = first(raw.sector);
  const status = first(raw.status);
  const plan = first(raw.plan);
  const from = first(raw.createdFrom);
  const to = first(raw.createdTo);
  const sort = first(raw.sort);
  const page = Number(first(raw.page));
  const q = text('q', 100);
  const city = text('city', 200);
  return {
    ...(q ? { q } : {}),
    ...(city ? { city } : {}),
    ...(RESTAURANT_TYPES.includes(type as RestaurantType) ? { type: type as RestaurantType } : {}),
    ...(BUSINESS_SECTORS.includes(sector as BusinessSector) ? { sector: sector as BusinessSector } : {}),
    ...(RESTAURANT_STATUSES.includes(status as RestaurantStatus) ? { status: status as RestaurantStatus } : {}),
    ...(PLAN_TIERS.includes(plan as PlanTier) ? { plan: plan as PlanTier } : {}),
    ...(from && isCalendarDate(from) ? { createdFrom: from } : {}),
    ...(to && isCalendarDate(to) ? { createdTo: to } : {}),
    sort: SORTS.includes(sort as SortKey) ? (sort as SortKey) : 'name',
    dir: first(raw.dir) === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}
