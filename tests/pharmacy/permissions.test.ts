import { describe, expect, it } from 'vitest';
import {
  PH_PERMISSIONS,
  PH_ROLES,
  canPh,
  phPermissionsOf,
  roleMatrix,
  type PhPermission,
} from '@/server/domain/pharmacy/permissions';

describe('pharmacy permissions', () => {
  it('owner holds every permission', () => {
    for (const p of PH_PERMISSIONS) expect(canPh('OWNER', p)).toBe(true);
  });

  it('only the owner holds support.grant', () => {
    for (const role of PH_ROLES) expect(canPh(role, 'support.grant')).toBe(role === 'OWNER');
  });

  it('a cashier cannot see cost or profit', () => {
    expect(canPh('CASHIER', 'cost.view')).toBe(false);
    expect(canPh('CASHIER', 'profit.view')).toBe(false);
  });

  it('an accountant cannot dispense or change stock', () => {
    expect(canPh('ACCOUNTANT', 'rx.dispense')).toBe(false);
    expect(canPh('ACCOUNTANT', 'stock.adjust')).toBe(false);
    expect(canPh('ACCOUNTANT', 'stock.count')).toBe(false);
  });

  it('receiving (purchase.manage) is for managers, the pharmacist in charge, stock and accounts, not pharmacists or cashiers', () => {
    for (const role of PH_ROLES) {
      expect(canPh(role, 'purchase.manage')).toBe(['OWNER', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'STOCK', 'ACCOUNTANT'].includes(role));
      if (canPh(role, 'purchase.manage')) expect(canPh(role, 'cost.view')).toBe(true);
    }
  });

  it('the matrix has a row for every role and every permission key exists in at least one role', () => {
    const rows = roleMatrix();
    expect(rows.map((r) => r.role)).toEqual([...PH_ROLES]);
    for (const p of PH_PERMISSIONS) {
      expect(rows.some((r) => r.permissions.includes(p))).toBe(true);
      expect(phPermissionsOf('OWNER').has(p)).toBe(true);
    }
  });

  it('customers (customer.manage) and credit selling (credit.sell) are for the owner, managers, the pharmacist in charge and, for credit, pharmacists; accountants manage customers but never sell; cashiers and stock do neither', () => {
    const manage = ['OWNER', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'ACCOUNTANT'];
    const sell = ['OWNER', 'BRANCH_MANAGER', 'PHARMACIST_IN_CHARGE', 'PHARMACIST'];
    for (const role of PH_ROLES) {
      expect(canPh(role, 'customer.manage'), `${role} customer.manage`).toBe(manage.includes(role));
      expect(canPh(role, 'credit.sell'), `${role} credit.sell`).toBe(sell.includes(role));
    }
  });

  it('adding the two permissions took nothing from any role: each role holds exactly its phase 6 permissions plus the new ones', () => {
    const before: Record<string, string[]> = {
      CASHIER: ['catalog.view', 'discount.apply', 'shift.use'],
      PHARMACIST: ['catalog.view', 'discount.apply', 'rx.dispense', 'rx.attachment.view', 'shift.use', 'ai.use'],
      STOCK: ['catalog.view', 'catalog.manage', 'cost.view', 'stock.count', 'transfer.manage', 'purchase.manage', 'import.apply'],
      ACCOUNTANT: ['catalog.view', 'cost.view', 'profit.view', 'report.view', 'purchase.manage'],
    };
    const added: Record<string, string[]> = { CASHIER: [], PHARMACIST: ['credit.sell'], STOCK: [], ACCOUNTANT: ['customer.manage'] };
    for (const [role, list] of Object.entries(before)) {
      expect([...phPermissionsOf(role as (typeof PH_ROLES)[number])].sort(), role).toEqual([...list, ...added[role]!].sort());
    }
  });

  it('a permission string not in the list is refused by canPh', () => {
    expect(canPh('OWNER', 'made.up' as PhPermission)).toBe(false);
  });
});
