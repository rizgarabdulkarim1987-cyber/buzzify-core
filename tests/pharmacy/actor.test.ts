import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { phGate } from '@/server/pharmacy/actor';
import { asPh, DAY, grant, NOW, person, pharmacy, prisma, resetWorld, useTestDatabase } from './fixture';

beforeAll(() => useTestDatabase());
beforeEach(resetWorld);

describe('resolvePhActor', () => {
  it('an owner member is the pharmacy owner of all branches', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const owner = await person('owner', { membership: [a.id, 'OWNER'] });
    const actor = await asPh(owner.userId, a.id);
    expect(actor).toMatchObject({ role: 'OWNER', allBranches: true, viaMembership: true, support: null, restaurantId: a.id });
    expect([...actor!.branchIds].sort()).toEqual([...a.branchIds].sort());
  });

  it('a staff member sees only the branches they were given', async () => {
    const a = await pharmacy('A', { branches: 2 });
    const nurse = await person('staff', { staff: [a.id, 'PHARMACIST', [a.branchIds[1]!]] });
    const actor = await asPh(nurse.userId, a.id);
    expect(actor).toMatchObject({ role: 'PHARMACIST', allBranches: false, branchIds: [a.branchIds[1]], viaMembership: false });
    expect(await asPh(nurse.userId, a.id, a.branchIds[0])).toBeNull();
    expect(await asPh(nurse.userId, a.id, a.branchIds[1])).not.toBeNull();
  });

  it('a staff row with no branch gives no actor', async () => {
    const a = await pharmacy('A');
    const nobody = await person('nobranch', { staff: [a.id, 'CASHIER', []] });
    expect(await asPh(nobody.userId, a.id)).toBeNull();
  });

  it('a staff member of pharmacy A has no actor in pharmacy B', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const staff = await person('staff', { staff: [a.id, 'CASHIER', [a.branchId]] });
    expect(await asPh(staff.userId, a.id)).not.toBeNull();
    expect(await asPh(staff.userId, b.id)).toBeNull();
  });

  it('a Studio DESIGNER alone has no pharmacy actor', async () => {
    const a = await pharmacy('A');
    const designer = await person('designer', { membership: [a.id, 'DESIGNER'] });
    expect(await asPh(designer.userId, a.id)).toBeNull();
  });

  it('a cashier-only staff row of a FOOD restaurant gives no pharmacy actor', async () => {
    const food = await pharmacy('Food', { sector: 'FOOD' });
    const till = await person('till', { posStaff: [food.id, 'CASHIER'], staff: [food.id, 'CASHIER', [food.branchId]] });
    expect(await asPh(till.userId, food.id)).toBeNull();
    const owner = await person('foodowner', { membership: [food.id, 'OWNER'] });
    expect(await asPh(owner.userId, food.id)).toBeNull();
  });

  it('a super admin has no actor without a grant', async () => {
    const a = await pharmacy('A');
    const admin = await person('admin', { superAdmin: true });
    expect(await asPh(admin.userId, a.id)).toBeNull();
  });

  it("a super admin with an active grant has an actor with role null and the grant's scopes", async () => {
    const a = await pharmacy('A', { branches: 2 });
    const admin = await person('admin', { superAdmin: true });
    const g = await grant(admin, a.id, { scopes: ['catalog.read', 'sales.read'] });
    const actor = await asPh(admin.userId, a.id);
    expect(actor?.role).toBeNull();
    expect(actor?.viaMembership).toBe(false);
    expect(actor?.support?.grantId).toBe(g.id);
    expect([...actor!.support!.scopes].sort()).toEqual(['catalog.read', 'sales.read']);
    expect(actor?.support?.expiresAt).toEqual(g.expiresAt);
  });

  it('an expired, revoked or not yet started grant gives no actor', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const c = await pharmacy('C');
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id, { startsAt: new Date(NOW.getTime() - 2 * DAY), expiresAt: new Date(NOW.getTime() - DAY) });
    await grant(admin, b.id, { revokedAt: new Date(NOW.getTime() - 60_000) });
    await grant(admin, c.id, { startsAt: new Date(NOW.getTime() + DAY), expiresAt: new Date(NOW.getTime() + 2 * DAY) });
    expect(await asPh(admin.userId, a.id)).toBeNull();
    expect(await asPh(admin.userId, b.id)).toBeNull();
    expect(await asPh(admin.userId, c.id)).toBeNull();
  });

  it('a grant for pharmacy A gives no actor in pharmacy B', async () => {
    const a = await pharmacy('A');
    const b = await pharmacy('B');
    const admin = await person('admin', { superAdmin: true });
    await grant(admin, a.id);
    expect(await asPh(admin.userId, a.id)).not.toBeNull();
    expect(await asPh(admin.userId, b.id)).toBeNull();
  });

  it('a deactivated user has none', async () => {
    const a = await pharmacy('A');
    const owner = await person('owner', { membership: [a.id, 'OWNER'], deactivated: true });
    expect(await asPh(owner.userId, a.id)).toBeNull();
  });

  it('a deactivated staff row has none', async () => {
    const a = await pharmacy('A');
    const staff = await person('staff', { staff: [a.id, 'CASHIER', [a.branchId]] });
    await prisma().phStaff.updateMany({ where: { userId: staff.userId }, data: { deactivatedAt: NOW } });
    expect(await asPh(staff.userId, a.id)).toBeNull();
  });
});

describe('phGate', () => {
  const gate = (id: string) => phGate(prisma(), id, NOW);

  it('trial, active and grace are open', async () => {
    const trial = await pharmacy('T', { subscription: 'TRIAL', periodEndsInDays: 5 });
    const active = await pharmacy('A');
    const grace = await pharmacy('G', { subscription: 'ACTIVE', periodEndsInDays: -2, graceDays: 7 });
    expect(await gate(trial.id)).toEqual({ state: 'open' });
    expect(await gate(active.id)).toEqual({ state: 'open' });
    expect(await gate(grace.id)).toEqual({ state: 'open' });
  });

  it('expired the day after grace is readOnly', async () => {
    const p = await pharmacy('E', { subscription: 'ACTIVE', periodEndsInDays: -8, graceDays: 7 });
    const graceEnd = new Date(NOW.getTime() - DAY);
    expect(await gate(p.id)).toEqual({ state: 'readOnly', until: new Date(graceEnd.getTime() + 90 * DAY) });
  });

  it('expired 91 days after grace is archived', async () => {
    const p = await pharmacy('E', { subscription: 'ACTIVE', periodEndsInDays: -98, graceDays: 7 });
    expect(await gate(p.id)).toEqual({ state: 'closed', reason: 'archived' });
  });

  it('cancelled counts from cancelledAt', async () => {
    const recent = await pharmacy('C1', {
      subscription: 'CANCELLED',
      periodEndsInDays: -200,
      cancelledAt: new Date(NOW.getTime() - 10 * DAY),
    });
    const old = await pharmacy('C2', {
      subscription: 'CANCELLED',
      periodEndsInDays: -5,
      cancelledAt: new Date(NOW.getTime() - 100 * DAY),
    });
    expect(await gate(recent.id)).toEqual({ state: 'readOnly', until: new Date(NOW.getTime() + 80 * DAY) });
    expect(await gate(old.id)).toEqual({ state: 'closed', reason: 'archived' });
  });

  it('cancelled without cancelledAt counts from the period end', async () => {
    const p = await pharmacy('C3', { subscription: 'CANCELLED', periodEndsInDays: -20 });
    expect(await gate(p.id)).toEqual({ state: 'readOnly', until: new Date(NOW.getTime() + 70 * DAY) });
  });

  it('suspended restaurant is closed', async () => {
    const p = await pharmacy('S', { status: 'SUSPENDED' });
    expect(await gate(p.id)).toEqual({ state: 'closed', reason: 'restaurantInactive' });
  });

  it('a FOOD restaurant is closed notPharmacy', async () => {
    const p = await pharmacy('F', { sector: 'FOOD' });
    expect(await gate(p.id)).toEqual({ state: 'closed', reason: 'notPharmacy' });
  });

  it('no pharmacy subscription is closed planInactive', async () => {
    const p = await pharmacy('N', { subscription: 'none' });
    expect(await gate(p.id)).toEqual({ state: 'closed', reason: 'planInactive' });
  });

  it('a disabled pharmacy application closes every pharmacy (kill switch), a FOOD restaurant is not asked', async () => {
    const p = await pharmacy('K');
    const food = await pharmacy('Diner', { sector: 'FOOD' });
    expect(await gate(p.id)).toEqual({ state: 'open' });
    await prisma().application.update({ where: { id: 'pharmacy' }, data: { status: 'DISABLED' } });
    expect(await gate(p.id)).toEqual({ state: 'closed', reason: 'applicationDisabled' });
    expect(await gate(food.id)).toEqual({ state: 'closed', reason: 'notPharmacy' });
    await prisma().application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
    expect(await gate(p.id)).toEqual({ state: 'open' });
  });

  describe('several pharmacy subscription rows (billing starts a new one after a lapse)', () => {
    const extra = (restaurantId: string, status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED', endsInDays: number, createdAt: Date) =>
      prisma().subscription.create({
        data: {
          restaurantId,
          applicationId: 'pharmacy',
          planCode: 'standard',
          status,
          period: 'MONTHLY',
          currency: 'IQD',
          priceMinor: 0,
          trialEndsAt: status === 'TRIAL' ? new Date(NOW.getTime() + endsInDays * DAY) : null,
          currentPeriodStart: new Date(NOW.getTime() + (endsInDays - 30) * DAY),
          currentPeriodEnd: new Date(NOW.getTime() + endsInDays * DAY),
          graceDays: 7,
          version: 1,
          createdAt,
        },
      });

    it('an old EXPIRED row beside a newer ACTIVE row is open, whichever the database returns first', async () => {
      const p = await pharmacy('M1', { subscription: 'EXPIRED', periodEndsInDays: -200 });
      await prisma().subscription.updateMany({ where: { restaurantId: p.id }, data: { createdAt: new Date(NOW.getTime() - 300 * DAY) } });
      await extra(p.id, 'ACTIVE', 20, new Date(NOW.getTime() - DAY));
      expect(await gate(p.id)).toEqual({ state: 'open' });
    });

    it('a live row wins even when it is the older one', async () => {
      const p = await pharmacy('M2', { subscription: 'ACTIVE', periodEndsInDays: 20 });
      await prisma().subscription.updateMany({ where: { restaurantId: p.id }, data: { createdAt: new Date(NOW.getTime() - 100 * DAY) } });
      await extra(p.id, 'EXPIRED', -200, new Date(NOW.getTime() - DAY));
      expect(await gate(p.id)).toEqual({ state: 'open' });
    });

    it('only lapsed rows: the most recently created decides the read-only window', async () => {
      const p = await pharmacy('M3', { subscription: 'EXPIRED', periodEndsInDays: -300 });
      await prisma().subscription.updateMany({ where: { restaurantId: p.id }, data: { createdAt: new Date(NOW.getTime() - 400 * DAY) } });
      await extra(p.id, 'EXPIRED', -20, new Date(NOW.getTime() - 50 * DAY)); // grace ended 13 days ago
      expect(await gate(p.id)).toEqual({ state: 'readOnly', until: new Date(NOW.getTime() - 13 * DAY + 90 * DAY) });
    });
  });

  it('a retention setting of 30 days changes the archive boundary', async () => {
    const p = await pharmacy('R', { subscription: 'ACTIVE', periodEndsInDays: -48, graceDays: 7 }); // grace ended 41 days ago
    expect(await gate(p.id)).toMatchObject({ state: 'readOnly' });
    await prisma().platformSetting.create({ data: { key: 'pharmacyRetentionDays', value: 30 } });
    expect(await gate(p.id)).toEqual({ state: 'closed', reason: 'archived' });
  });
});
