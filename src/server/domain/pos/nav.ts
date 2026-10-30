import { canPos, type PosPermission, type PosRole } from './permissions';

/** The pages of the till, each behind the permission that opens it (the same one its queries ask for). */
export const TILL_PAGES = [
  { key: 'tables', href: '/pos/tables', permission: 'order.handle' },
  { key: 'captain', href: '/pos/captain', permission: 'captain.order', needsCaptainSwitch: true },
  { key: 'requests', href: '/pos/requests', permission: 'request.handle', needsQr: true },
  { key: 'shift', href: '/pos/shift', permission: 'shift.use' },
  { key: 'kitchen', href: '/pos/kitchen', permission: 'kitchen.view' },
  { key: 'report', href: '/pos/report', permission: 'report.view' },
  { key: 'activity', href: '/pos/activity', permission: 'report.view' },
  { key: 'ai', href: '/pos/ai', permission: 'report.view', needsAi: true },
  { key: 'inventory', href: '/pos/inventory', permission: 'inventory.view' },
  { key: 'purchases', href: '/pos/purchases', permission: 'purchase.manage' },
  { key: 'complaints', href: '/pos/complaints', permission: 'complaint.view', needsComplaints: true },
  { key: 'floor', href: '/pos/floor', permission: 'settings.manage' },
  { key: 'catalog', href: '/pos/catalog', permission: 'catalog.manage' },
  { key: 'staff', href: '/pos/staff', permission: 'staff.manage' },
  { key: 'qr', href: '/pos/qr', permission: 'settings.manage', needsQr: true },
  { key: 'delivery', href: '/pos/delivery', permission: 'settings.manage', needsDelivery: true },
  { key: 'settings', href: '/pos/settings', permission: 'settings.manage' },
] as const satisfies ReadonlyArray<{ key: string; href: string; permission: PosPermission; needsQr?: true; needsDelivery?: true; needsComplaints?: true; needsAi?: true; needsCaptainSwitch?: true }>;

export type TillPageKey = (typeof TILL_PAGES)[number]['key'];

/**
 * The pages this role may open, in menu order: nothing is listed that would answer 404 or refuse. The pages of QR ordering,
 * of delivery and of the AI package are listed only while the restaurant has switched them on. The captain page is the
 * captain's own and always theirs; owners and managers, who may also place a captain's order, see it only while captain
 * approval is on (it stays reachable by its address).
 */
export function tillNav(role: PosRole, options: { qrOrdering?: boolean; delivery?: boolean; complaints?: boolean; ai?: boolean; captainApproval?: boolean } = {}): ReadonlyArray<{ key: TillPageKey; href: string }> {
  return TILL_PAGES.filter(
    (page) =>
      canPos(role, page.permission) &&
      (!('needsQr' in page) || options.qrOrdering === true) &&
      (!('needsDelivery' in page) || options.delivery === true) &&
      (!('needsComplaints' in page) || options.complaints === true) &&
      (!('needsAi' in page) || options.ai === true) &&
      (!('needsCaptainSwitch' in page) || role === 'CAPTAIN' || options.captainApproval === true),
  ).map(({ key, href }) => ({ key, href }));
}

/** Whether a role may open a till page by its address: the nav hides a page, this is what the page itself checks. */
export function canOpenTillPage(role: PosRole, key: TillPageKey): boolean {
  const page = TILL_PAGES.find((candidate) => candidate.key === key);
  return page !== undefined && canPos(role, page.permission);
}
