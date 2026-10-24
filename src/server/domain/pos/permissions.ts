/**
 * What each cashier role may do (ported from the cashier repo's `permissions.ts`), as pure data and functions. These are
 * separate from the Studio's `MemberRole` and permissions (`../permissions.ts`): a cashier role never gives access to
 * the Studio, and a Studio role never gives access to the till, except that a restaurant's OWNER member is its cashier
 * OWNER (`src/server/pos/actor.ts`).
 */

export const POS_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'] as const;
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
] as const;
export type PosPermission = (typeof POS_PERMISSIONS)[number];

/** Who may hold which permission. OWNER and MANAGER hold all of them. */
const MATRIX: Record<PosRole, readonly PosPermission[]> = {
  OWNER: POS_PERMISSIONS,
  MANAGER: POS_PERMISSIONS,
  CASHIER: ['order.handle', 'order.discount', 'order.cancel', 'payment.take', 'shift.use', 'inventory.view'],
  KITCHEN: ['kitchen.view'],
};

export function canPos(role: PosRole, permission: PosPermission): boolean {
  return MATRIX[role].includes(permission);
}

export function posPermissionsOf(role: PosRole): ReadonlySet<PosPermission> {
  return new Set(MATRIX[role]);
}

/** Where a signed-in person starts: the kitchen screen for the kitchen, the tables board for everyone else. */
export function posLanding(role: PosRole): 'tables' | 'kitchen' {
  return role === 'KITCHEN' ? 'kitchen' : 'tables';
}
