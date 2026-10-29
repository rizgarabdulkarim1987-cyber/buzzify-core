import { describe, expect, it } from 'vitest';
import { canPos, POS_PERMISSIONS, POS_ROLES, posLanding, posPermissionsOf, roleMatrix } from '@/server/domain/pos/permissions';

describe('POS roles and permissions', () => {
  it('has the cashier repo\'s sixteen keys plus the request and captain keys and pin.own, once each', () => {
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
      'request.handle',
      'request.approve',
      'captain.order',
      'pin.own',
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
      ['order.handle', 'order.discount', 'order.cancel', 'payment.take', 'shift.use', 'inventory.view', 'request.handle', 'pin.own'].sort(),
    );
    expect(canPos('CASHIER', 'settings.manage')).toBe(false);
    expect(canPos('CASHIER', 'payment.refund')).toBe(false);
  });

  it('KITCHEN holds exactly kitchen.view', () => {
    expect([...posPermissionsOf('KITCHEN')].sort()).toEqual(['kitchen.view', 'pin.own']);
    expect(canPos('KITCHEN', 'order.handle')).toBe(false);
  });

  it('lets every role set its own quick sign-in PIN, and only OWNER and MANAGER refund', () => {
    for (const role of POS_ROLES) expect(canPos(role, 'pin.own'), role).toBe(true);
    expect(POS_ROLES.filter((role) => canPos(role, 'payment.refund'))).toEqual(['OWNER', 'MANAGER']);
  });

  it('roleMatrix lists the four roles in order and agrees with canPos for every cell', () => {
    const rows = roleMatrix();
    expect(rows.map((row) => row.role)).toEqual([...POS_ROLES]);
    for (const row of rows) {
      for (const permission of POS_PERMISSIONS) expect(row.permissions.includes(permission), `${row.role} ${permission}`).toBe(canPos(row.role, permission));
    }
  });

  it('lands the kitchen on its screen, the captain on the captain page and everyone else on the tables', () => {
    expect(posLanding('KITCHEN')).toBe('kitchen');
    expect(posLanding('CAPTAIN')).toBe('captain');
    for (const role of POS_ROLES.filter((r) => r !== 'KITCHEN' && r !== 'CAPTAIN')) expect(posLanding(role)).toBe('tables');
  });

  it('gives the captain the request and captain keys and no money or report keys', () => {
    expect([...posPermissionsOf('CAPTAIN')].sort()).toEqual(['request.handle', 'request.approve', 'captain.order', 'pin.own'].sort());
    expect(canPos('CAPTAIN', 'request.approve')).toBe(true);
    expect(canPos('CAPTAIN', 'payment.take')).toBe(false);
    expect(canPos('CAPTAIN', 'report.view')).toBe(false);
  });

  it('lets the cashier handle guest requests but not approve them; the kitchen neither', () => {
    expect(canPos('CASHIER', 'request.handle')).toBe(true);
    expect(canPos('CASHIER', 'request.approve')).toBe(false);
    expect(canPos('CASHIER', 'captain.order')).toBe(false);
    expect(canPos('KITCHEN', 'request.handle')).toBe(false);
    expect(canPos('MANAGER', 'request.approve')).toBe(true);
    expect(canPos('OWNER', 'request.approve')).toBe(true);
  });
});
