/**
 * What each pharmacy role may do, as pure data and functions (mirrors `../pos/permissions.ts`). The roles match the
 * `PhRole` enum in the Prisma schema. These are separate from the Studio's and the cashier's roles and permissions.
 */

export const PH_ROLES = [
  'OWNER',
  'BRANCH_MANAGER',
  'PHARMACIST_IN_CHARGE',
  'PHARMACIST',
  'CASHIER',
  'STOCK',
  'ACCOUNTANT',
] as const;
export type PhRole = (typeof PH_ROLES)[number];

export const PH_PERMISSIONS = [
  'catalog.view',
  'catalog.manage',
  'price.change',
  'cost.view',
  'profit.view',
  'discount.apply',
  'discount.over_limit',
  'rx.dispense',
  'rx.attachment.view',
  'batch.override',
  'return.approve',
  'stock.adjust',
  'stock.count',
  'transfer.manage',
  'purchase.manage',
  'shift.use',
  'report.view',
  'ai.use',
  'import.apply',
  'staff.manage',
  'settings.manage',
  'support.grant',
] as const;
export type PhPermission = (typeof PH_PERMISSIONS)[number];

/** Who may hold which permission. The owner holds all; only the owner may grant support access. */
const MATRIX: Record<PhRole, readonly PhPermission[]> = {
  OWNER: PH_PERMISSIONS,
  BRANCH_MANAGER: PH_PERMISSIONS.filter((p) => p !== 'support.grant' && p !== 'settings.manage'),
  PHARMACIST_IN_CHARGE: [
    'catalog.view',
    'catalog.manage',
    'price.change',
    'cost.view',
    'discount.apply',
    'discount.over_limit',
    'rx.dispense',
    'rx.attachment.view',
    'batch.override',
    'return.approve',
    'stock.adjust',
    'stock.count',
    'purchase.manage',
    'shift.use',
    'report.view',
    'ai.use',
    'import.apply',
  ],
  PHARMACIST: ['catalog.view', 'discount.apply', 'rx.dispense', 'rx.attachment.view', 'shift.use', 'ai.use'],
  CASHIER: ['catalog.view', 'discount.apply', 'shift.use'],
  STOCK: [
    'catalog.view',
    'catalog.manage',
    'cost.view',
    'stock.count',
    'transfer.manage',
    'purchase.manage',
    'import.apply',
  ],
  ACCOUNTANT: ['catalog.view', 'cost.view', 'profit.view', 'report.view', 'purchase.manage'],
};

export function canPh(role: PhRole, permission: PhPermission): boolean {
  return MATRIX[role].includes(permission);
}

export function phPermissionsOf(role: PhRole): ReadonlySet<PhPermission> {
  return new Set(MATRIX[role]);
}

/** The roles with what each may do, in `PH_ROLES` order: the read-only table on the staff page. */
export function roleMatrix(): { role: PhRole; permissions: PhPermission[] }[] {
  return PH_ROLES.map((role) => ({ role, permissions: [...MATRIX[role]] }));
}
