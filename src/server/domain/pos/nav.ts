import { canPos, type PosPermission, type PosRole } from './permissions';

/** The pages of the till, each behind the permission that opens it (the same one its queries ask for). */
export const TILL_PAGES = [
  { key: 'tables', href: '/pos/tables', permission: 'order.handle' },
  { key: 'shift', href: '/pos/shift', permission: 'shift.use' },
  { key: 'kitchen', href: '/pos/kitchen', permission: 'kitchen.view' },
  { key: 'report', href: '/pos/report', permission: 'report.view' },
  { key: 'floor', href: '/pos/floor', permission: 'settings.manage' },
  { key: 'catalog', href: '/pos/catalog', permission: 'catalog.manage' },
  { key: 'staff', href: '/pos/staff', permission: 'staff.manage' },
  { key: 'settings', href: '/pos/settings', permission: 'settings.manage' },
] as const satisfies ReadonlyArray<{ key: string; href: string; permission: PosPermission }>;

export type TillPageKey = (typeof TILL_PAGES)[number]['key'];

/** The pages this role may open, in menu order: nothing is listed that would answer 404 or refuse. */
export function tillNav(role: PosRole): ReadonlyArray<{ key: TillPageKey; href: string }> {
  return TILL_PAGES.filter((page) => canPos(role, page.permission)).map(({ key, href }) => ({ key, href }));
}
