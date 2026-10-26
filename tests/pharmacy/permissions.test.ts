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

  it('the matrix has a row for every role and every permission key exists in at least one role', () => {
    const rows = roleMatrix();
    expect(rows.map((r) => r.role)).toEqual([...PH_ROLES]);
    for (const p of PH_PERMISSIONS) {
      expect(rows.some((r) => r.permissions.includes(p))).toBe(true);
      expect(phPermissionsOf('OWNER').has(p)).toBe(true);
    }
  });

  it('a permission string not in the list is refused by canPh', () => {
    expect(canPh('OWNER', 'made.up' as PhPermission)).toBe(false);
  });
});
