import { AUDIT_ACTIONS, type AuditAction } from '@/server/domain/audit-actions';

type RawParams = Record<string, string | string[] | undefined>;

/** The filters of the log, each a parameter of the address; "Clear filters" removes them all. */
export const LIST_PARAMS = ['actor', 'restaurant', 'menu', 'action', 'from', 'to'] as const;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export interface ActivityInput {
  actorId?: string;
  restaurantId?: string;
  menuId?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  page: number;
}

/**
 * The log's filters and page from the address. The address is the person's to edit, so anything that does not parse is
 * left out rather than refused: a typo in a bookmarked link shows the log, not an error.
 */
export function activityInput(raw: RawParams): ActivityInput {
  const text = (name: string) => first(raw[name])?.trim().slice(0, 100) || undefined;
  const action = first(raw.action);
  const from = first(raw.from);
  const to = first(raw.to);
  const page = Number(first(raw.page));
  const actorId = text('actor');
  const restaurantId = text('restaurant');
  const menuId = text('menu');
  return {
    ...(actorId ? { actorId } : {}),
    ...(restaurantId ? { restaurantId } : {}),
    ...(menuId ? { menuId } : {}),
    ...((AUDIT_ACTIONS as readonly string[]).includes(action ?? '') ? { action: action as AuditAction } : {}),
    ...(from && isCalendarDate(from) ? { from } : {}),
    ...(to && isCalendarDate(to) ? { to } : {}),
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}
