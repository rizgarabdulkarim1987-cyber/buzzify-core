import { MENU_STATUSES, type MenuStatus } from '@/server/domain/menu-status';
import type { MenuSort } from '@/server/studio/services/menus';

type RawParams = Record<string, string | string[] | undefined>;

/** The columns the list sorts by, as the query takes them (named here so the browser never loads the service). */
export const SORTS = ['name', 'restaurant', 'status', 'createdAt', 'updatedAt'] as const satisfies readonly MenuSort[];

/** The filters of the list, each a parameter of the address; "Clear filters" removes them all. */
export const LIST_PARAMS = ['q', 'status', 'city', 'restaurant', 'createdFrom', 'createdTo', 'unpublished'] as const;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export interface MenuListInput {
  q?: string;
  status?: MenuStatus;
  city?: string;
  restaurantId?: string;
  createdFrom?: string;
  createdTo?: string;
  unpublished?: true;
  sort: MenuSort;
  dir: 'asc' | 'desc';
  page: number;
}

/**
 * The list's filters, sort and page from the address. The address is the person's to edit, so anything that does not
 * parse is left out rather than refused: a typo in a bookmarked link shows the list, not an error.
 */
export function listInput(raw: RawParams): MenuListInput {
  const text = (name: string, max: number) => first(raw[name])?.trim().slice(0, max) || undefined;
  const status = first(raw.status);
  const from = first(raw.createdFrom);
  const to = first(raw.createdTo);
  const sort = first(raw.sort);
  const page = Number(first(raw.page));
  const q = text('q', 100);
  const city = text('city', 200);
  const restaurantId = text('restaurant', 100);
  return {
    ...(q ? { q } : {}),
    ...(MENU_STATUSES.includes(status as MenuStatus) ? { status: status as MenuStatus } : {}),
    ...(city ? { city } : {}),
    ...(restaurantId ? { restaurantId } : {}),
    ...(from && isCalendarDate(from) ? { createdFrom: from } : {}),
    ...(to && isCalendarDate(to) ? { createdTo: to } : {}),
    ...(first(raw.unpublished) === '1' ? { unpublished: true as const } : {}),
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as MenuSort) : 'name',
    dir: first(raw.dir) === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}
