import { describe, expect, it } from 'vitest';
import { canPos, POS_PERMISSIONS, POS_ROLES, posLanding, posPermissionsOf } from '@/server/domain/pos/permissions';

describe('POS roles and permissions', () => {
  it('has the cashier repo\'s sixteen keys, once each', () => {
    expect([...POS_PERMISSIONS]).toEqual([
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
    ]);
    expect(new Set(POS_PERMISSIONS).size).toBe(POS_PERMISSIONS.length);
  });

  it('OWNER and MANAGER hold every permission', () => {
    for (const role of ['OWNER', 'MANAGER'] as const) {
      expect([...posPermissionsOf(role)].sort()).toEqual([...POS_PERMISSIONS].sort());
    }
  });

  it('CASHIER holds exactly the floor permissions', () => {
    expect([...posPermissionsOf('CASHIER')].sort()).toEqual(
      ['order.handle', 'order.discount', 'order.cancel', 'payment.take', 'shift.use', 'inventory.view'].sort(),
    );
    expect(canPos('CASHIER', 'settings.manage')).toBe(false);
    expect(canPos('CASHIER', 'payment.refund')).toBe(false);
  });

  it('KITCHEN holds exactly kitchen.view', () => {
    expect([...posPermissionsOf('KITCHEN')]).toEqual(['kitchen.view']);
    expect(canPos('KITCHEN', 'order.handle')).toBe(false);
  });

  it('lands the kitchen on its screen and everyone else on the tables', () => {
    expect(posLanding('KITCHEN')).toBe('kitchen');
    for (const role of POS_ROLES.filter((r) => r !== 'KITCHEN')) expect(posLanding(role)).toBe('tables');
  });
});
