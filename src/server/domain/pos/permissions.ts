/**
 * What each cashier role may do (ported from the cashier repo's `permissions.ts`), as pure data and functions. These are
 * separate from the Studio's `MemberRole` and permissions (`../permissions.ts`): a cashier role never gives access to
 * the Studio, and a Studio role never gives access to the till, except that a restaurant's OWNER member is its cashier
 * OWNER (`src/server/pos/actor.ts`).
 */

export const POS_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'CAPTAIN'] as const;
export type PosRole = (typeof POS_ROLES)[number];

export const POS_PERMISSIONS = [
  'catalog.manage',
  'staff.manage',
  'settings.manage',
  'order.handle',
  'order.discount',
  'order.cancel',
  'payment.take',
  'payment.refund',
  'shift.use',
  'report.view',
  'kitchen.view',
  'inventory.view',
  'inventory.manage',
  'purchase.manage',
  'complaint.view',
  'complaint.manage',
  /** See guest orders and bill calls that came from the table QR codes. */
  'request.handle',
  /** Approve or reject a guest order or a bill call. */
  'request.approve',
  /** Take an order at the table as a captain. */
  'captain.order',
  /** Set one's own quick sign-in PIN. Held by every role. */
  'pin.own',
] as const;
export type PosPermission = (typeof POS_PERMISSIONS)[number];

/** Who may hold which permission. OWNER and MANAGER hold all of them. */
const MATRIX: Record<PosRole, readonly PosPermission[]> = {
  OWNER: POS_PERMISSIONS,
  MANAGER: POS_PERMISSIONS,
  CASHIER: ['order.handle', 'order.discount', 'order.cancel', 'payment.take', 'shift.use', 'inventory.view', 'request.handle', 'pin.own'],
  KITCHEN: ['kitchen.view', 'pin.own'],
  CAPTAIN: ['request.handle', 'request.approve', 'captain.order', 'pin.own'],
};

export function canPos(role: PosRole, permission: PosPermission): boolean {
  return MATRIX[role].includes(permission);
}

/** The roles with what each may do, in `POS_ROLES` order: the read-only table on the staff page. */
export function roleMatrix(): { role: PosRole; permissions: PosPermission[] }[] {
  return POS_ROLES.map((role) => ({ role, permissions: [...MATRIX[role]] }));
}

export function posPermissionsOf(role: PosRole): ReadonlySet<PosPermission> {
  return new Set(MATRIX[role]);
}

/** Where a signed-in person starts: the kitchen screen for the kitchen, the captain page for the captain, the tables board for everyone else. */
export function posLanding(role: PosRole): 'tables' | 'kitchen' | 'captain' {
  if (role === 'KITCHEN') return 'kitchen';
  return role === 'CAPTAIN' ? 'captain' : 'tables';
}
