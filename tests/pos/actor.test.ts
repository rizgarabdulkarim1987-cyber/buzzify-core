import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { effectivePermissions } from '@/server/domain/permissions';
import { posGate, resolvePosActor } from '@/server/pos/actor';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { deleteBillingRows, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

const NOW = new Date('2026-10-24T12:00:00Z');
const DAY = 86_400_000;

let a = '';
let b = '';

async function subscribe(restaurantId: string, status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'CANCELLED', periodEnd = new Date(NOW.getTime() + 20 * DAY), applicationId = 'cashier') {
  await prisma.subscription.create({
    data: {
      restaurantId,
      applicationId,
      planCode: 'standard',
      status,
      period: 'MONTHLY',
      currency: 'IQD',
      priceMinor: 0,
      currentPeriodStart: new Date(periodEnd.getTime() - 30 * DAY),
      currentPeriodEnd: periodEnd,
      version: 1,
    },
  });
}

beforeAll(async () => {
  await resetTestData(prisma);
  await prisma.application.createMany({
    data: [
      { id: 'menu', name: { en: 'Menu' } },
      { id: 'cashier', name: { en: 'Cashier' } },
    ],
  });
  a = (await prisma.restaurant.create({ data: { name: 'Actor A' } })).id;
  b = (await prisma.restaurant.create({ data: { name: 'Actor B' } })).id;
  await prisma.user.createMany({
    data: [
      { id: 'act-owner', name: 'Owner', email: 'owner@act.test', locale: 'ar' },
      { id: 'act-staff', name: 'Staff', email: 'staff@act.test' },
      { id: 'act-designer', name: 'Designer', email: 'designer@act.test' },
      { id: 'act-gone', name: 'Gone', email: 'gone@act.test', deactivatedAt: new Date() },
      { id: 'act-admin', name: 'Admin', email: 'admin@act.test', isSuperAdmin: true },
      { id: 'act-both', name: 'Both', email: 'both@act.test' },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { userId: 'act-owner', restaurantId: a, role: 'OWNER' },
      { userId: 'act-designer', restaurantId: a, role: 'DESIGNER' },
      { userId: 'act-both', restaurantId: a, role: 'DESIGNER' },
    ],
  });
  await prisma.posStaff.createMany({
    data: [
      { restaurantId: a, userId: 'act-staff', role: 'CASHIER', createdAt: new Date('2026-01-01') },
      { restaurantId: b, userId: 'act-staff', role: 'KITCHEN', createdAt: new Date('2026-02-01') },
      { restaurantId: a, userId: 'act-gone', role: 'MANAGER' },
      { restaurantId: a, userId: 'act-admin', role: 'MANAGER' },
      { restaurantId: b, userId: 'act-both', role: 'CASHIER' },
    ],
  });
});

afterAll(async () => {
  await deleteBillingRows(prisma, [a, b]);
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('resolvePosActor', () => {
  it('an OWNER member with no staff row is the cashier OWNER, through the membership', async () => {
    expect(await resolvePosActor(prisma, 'act-owner')).toEqual({
      userId: 'act-owner',
      name: 'Owner',
      restaurantId: a,
      restaurantName: 'Actor A',
      role: 'OWNER',
      viaMembership: true,
      locale: 'ar',
    });
  });

  it('a staff row resolves with its own role', async () => {
    const actor = await resolvePosActor(prisma, 'act-staff', a);
    expect(actor).toMatchObject({ restaurantId: a, role: 'CASHIER', viaMembership: false });
  });

  it('a user of two restaurants resolves the one named, and refuses one they do not belong to', async () => {
    expect(await resolvePosActor(prisma, 'act-staff', b)).toMatchObject({ restaurantId: b, role: 'KITCHEN' });
    expect(await resolvePosActor(prisma, 'act-owner', b)).toBeNull();
  });

  it('without a restaurant named, the first restaurant they joined', async () => {
    expect((await resolvePosActor(prisma, 'act-staff'))?.restaurantId).toBe(a);
  });

  it('without a restaurant named, prefers one whose till is open over the one they joined first', async () => {
    const c = (await prisma.restaurant.create({ data: { name: 'Actor C' } })).id;
    const d = (await prisma.restaurant.create({ data: { name: 'Actor D' } })).id;
    await prisma.user.create({ data: { id: 'act-two', name: 'Two', email: 'two@act.test' } });
    await prisma.posStaff.createMany({
      data: [
        { restaurantId: c, userId: 'act-two', role: 'CASHIER', createdAt: new Date('2025-01-01') },
        { restaurantId: d, userId: 'act-two', role: 'CASHIER', createdAt: new Date('2026-01-01') },
      ],
    });
    expect((await resolvePosActor(prisma, 'act-two'))?.restaurantId).toBe(c);
    await subscribe(d, 'ACTIVE', new Date(Date.now() + 20 * DAY));
    expect((await resolvePosActor(prisma, 'act-two'))?.restaurantId).toBe(d);
    await deleteBillingRows(prisma, [c, d]);
    await prisma.posStaff.deleteMany({ where: { userId: 'act-two' } });
    await prisma.user.delete({ where: { id: 'act-two' } });
    await prisma.restaurant.deleteMany({ where: { id: { in: [c, d] } } });
  });

  it('a Studio DESIGNER alone has no till', async () => {
    expect(await resolvePosActor(prisma, 'act-designer')).toBeNull();
  });

  it('a designer of one restaurant who is a cashier of another has the till only of the second', async () => {
    expect(await resolvePosActor(prisma, 'act-both', a)).toBeNull();
    expect(await resolvePosActor(prisma, 'act-both', b)).toMatchObject({ role: 'CASHIER' });
  });

  it('a deactivated staff row or user resolves to nothing; a Super Admin uses the Studio', async () => {
    await prisma.posStaff.updateMany({ where: { userId: 'act-staff', restaurantId: b }, data: { deactivatedAt: new Date() } });
    expect(await resolvePosActor(prisma, 'act-staff', b)).toBeNull();
    expect(await resolvePosActor(prisma, 'act-gone')).toBeNull();
    expect(await resolvePosActor(prisma, 'act-admin')).toBeNull();
    expect(await resolvePosActor(prisma, 'nobody')).toBeNull();
  });

  it('an owner whose staff row was deactivated is still the owner through the membership', async () => {
    await prisma.posStaff.create({ data: { restaurantId: a, userId: 'act-owner', role: 'CASHIER', deactivatedAt: new Date() } });
    expect(await resolvePosActor(prisma, 'act-owner', a)).toMatchObject({ role: 'OWNER', viaMembership: true });
  });
});

describe('posGate', () => {
  it('is open for an ACTIVE restaurant with a live cashier subscription', async () => {
    await subscribe(a, 'ACTIVE');
    expect(await posGate(prisma, a, NOW)).toEqual({ open: true });
  });

  it.each(['TRIAL', 'GRACE'] as const)('is open while the subscription is %s', async (status) => {
    await deleteBillingRows(prisma, [b]);
    await subscribe(b, status);
    expect(await posGate(prisma, b, NOW)).toEqual({ open: true });
  });

  it.each(['EXPIRED', 'CANCELLED'] as const)('is closed when the subscription is %s', async (status) => {
    await deleteBillingRows(prisma, [b]);
    await subscribe(b, status);
    expect(await posGate(prisma, b, NOW)).toEqual({ open: false, reason: 'cashierPlanInactive' });
  });

  it('counts an ACTIVE subscription whose grace is long over as closed, as the billing sweep will', async () => {
    await deleteBillingRows(prisma, [b]);
    await subscribe(b, 'ACTIVE', new Date(NOW.getTime() - 60 * DAY));
    expect(await posGate(prisma, b, NOW)).toEqual({ open: false, reason: 'cashierPlanInactive' });
  });

  it('is closed with no cashier subscription, even when the menu is subscribed', async () => {
    await deleteBillingRows(prisma, [b]);
    await subscribe(b, 'ACTIVE', undefined, 'menu');
    expect(await posGate(prisma, b, NOW)).toEqual({ open: false, reason: 'cashierPlanInactive' });
  });

  it('is closed for a suspended restaurant, whatever it pays', async () => {
    await prisma.restaurant.update({ where: { id: a }, data: { status: 'SUSPENDED' } });
    expect(await posGate(prisma, a, NOW)).toEqual({ open: false, reason: 'restaurantInactive' });
    await prisma.restaurant.update({ where: { id: a }, data: { status: 'ACTIVE' } });
  });

  it('is closed for a restaurant that does not exist', async () => {
    expect(await posGate(prisma, 'missing', NOW)).toEqual({ open: false, reason: 'restaurantInactive' });
  });
});

describe('the Studio permissions did not move (golden)', () => {
  const sorted = (set: ReadonlySet<string>) => [...set].sort();
  it('DESIGNER', () => {
    expect(sorted(effectivePermissions({ isSuperAdmin: false, role: 'DESIGNER', policy: {} }))).toEqual(
      [
        'restaurant.edit', 'menu.create', 'menu.duplicate', 'menu.settings', 'menu.status', 'content.edit', 'content.prices',
        'content.media', 'content.availability', 'brand.edit', 'qr.manage', 'publish.now', 'publish.schedule', 'publish.rollback',
        'import.run', 'export.run', 'prices.bulk', 'media.manage',
      ].sort(),
    );
  });
  it('OWNER', () => {
    expect(sorted(effectivePermissions({ isSuperAdmin: false, role: 'OWNER', policy: {} }))).toEqual(
      ['content.edit', 'content.prices', 'content.media', 'content.availability', 'publish.now', 'prices.bulk'].sort(),
    );
  });
  it('no role holds nothing', () => {
    expect(sorted(effectivePermissions({ isSuperAdmin: false, role: null, policy: {} }))).toEqual([]);
  });
});
