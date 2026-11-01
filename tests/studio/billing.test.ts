import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { expireMenu } from '@/server/data/cache';
import * as billing from '@/server/studio/actions/billing';
import * as plans from '@/server/studio/actions/plans';
import * as restaurants from '@/server/studio/actions/restaurants';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { createPasswordUser } from '@/server/studio/auth/users';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { runQuery, type QueryDef } from '@/server/studio/framework/query';
import type { ActionResult } from '@/server/studio/framework/result';
import { billingOverview, billingRestaurants, restaurantBilling } from '@/server/studio/queries/billing';
import { seedApplications } from '../../prisma/seed/applications';
import { createMenuFixture, resetTestData, testPrisma } from '../helpers/db';

/**
 * Billing actions and queries (Task 3 of docs/superpowers/plans/2026-10-22-business-core-in-menu.md), ported from
 * Business Core's plans, subscriptions and payments tests. The clock is faked (`Date` only) so each step happens at a
 * known instant on the Asia/Baghdad wall clock.
 */

// A Menu plan change expires the restaurant's cached addresses after commit; the real function does nothing outside Next,
// so the test watches the calls and lets them through.
vi.mock('@/server/data/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/data/cache')>();
  return { ...actual, expireMenu: vi.fn(actual.expireMenu) };
});

const prisma = testPrisma();
const GOOD = 'correct horse battery staple';
const META = { ip: '203.0.113.7', userAgent: 'vitest billing' };
const at = (iso: string) => new Date(iso);

const dataOf = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
};
const codeOf = (result: ActionResult<unknown>) => (result.ok ? 'OK' : result.error.code);

let owner: Actor;
let otherAdmin: Actor;
let restaurantOwner: Actor;
let restaurantId: string;
let menuId: string;

async function superAdmin(email: string, isPlatformOwner: boolean): Promise<Actor> {
  const { userId } = await createPasswordUser(prisma, { email, name: email.split('@')[0]!, password: GOOD, isSuperAdmin: true, isPlatformOwner });
  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return (await loadActor(prisma, userId))!;
}

/** Runs an action as `actor` at the instant `now`. */
function actAt<I, O>(now: Date, def: ActionDef<I, O>, input: unknown, actor: Actor = owner, client = prisma) {
  vi.setSystemTime(now);
  return runAction(client, actor, def, input, META);
}
function readAt<I, O>(now: Date, def: QueryDef<I, O>, input: unknown, actor: Actor = owner) {
  vi.setSystemTime(now);
  return runQuery(prisma, actor, def, input);
}

const trialInput = (extra: Record<string, unknown> = {}) => ({
  restaurantId,
  applicationId: 'menu',
  planCode: 'PRO',
  trialDays: 14,
  period: 'MONTHLY',
  currency: 'IQD',
  ...extra,
});

async function trial(now: Date, extra: Record<string, unknown> = {}): Promise<string> {
  return dataOf(await actAt(now, billing.startTrial, trialInput(extra))).id;
}

const paymentInput = (subscriptionId: string, paidAt: Date, extra: Record<string, unknown> = {}) => ({
  restaurantId,
  subscriptionId,
  amountMinor: 50000,
  method: 'CASH',
  reference: '',
  paidAt: paidAt.toISOString(),
  idempotencyKey: randomUUID(),
  note: '',
  ...extra,
});

async function pay(subscriptionId: string, now: Date) {
  return dataOf(await actAt(now, billing.recordPayment, paymentInput(subscriptionId, now)));
}

const load = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } });
/** The subscription's version as the page would show it now: what the person saw when they opened a dialog. */
const versionOf = async (id: string) => (await load(id)).version;
const events = (id: string) => prisma.subscriptionEvent.findMany({ where: { subscriptionId: id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
const planOf = async (id = restaurantId) => (await prisma.restaurant.findUniqueOrThrow({ where: { id }, select: { plan: true } })).plan;

/** A subscription that started a trial on 31 Jan and was paid at once: ACTIVE to 28 Feb, anchored on the 31st. */
async function paidOnTheThirtyFirst(): Promise<string> {
  const id = await trial(at('2027-01-31T09:00:00+03:00'));
  await pay(id, at('2027-01-31T09:00:00+03:00'));
  return id;
}

async function price(planCode: string, prices: Array<{ currency: string; period: string; amountMinor: number }>) {
  dataOf(await actAt(new Date(), billing.setPrices, { applicationId: 'menu', planCode, prices }));
}

beforeAll(async () => {
  await resetTestData(prisma);
});

beforeEach(async () => {
  vi.useRealTimers();
  await resetTestData(prisma);
  await seedApplications(prisma);
  owner = await superAdmin('owner@buzzify.test', true);
  otherAdmin = await superAdmin('staff@buzzify.test', false);
  const fixture = await createMenuFixture(prisma, 'billing-a');
  restaurantId = fixture.restaurant.id;
  menuId = fixture.menu.id;
  const { userId } = await createPasswordUser(prisma, { email: 'boss@zhamitos.test', name: 'Boss', password: GOOD });
  await prisma.membership.create({ data: { userId, restaurantId, role: 'OWNER' } });
  restaurantOwner = (await loadActor(prisma, userId))!;
  vi.useFakeTimers({ toFake: ['Date'] });
  await price('PRO', [
    { currency: 'IQD', period: 'MONTHLY', amountMinor: 50000 },
    { currency: 'USD', period: 'YEARLY', amountMinor: 39900 },
  ]);
  await price('PREMIUM', [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 80000 }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(expireMenu).mockClear();
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('products and prices', () => {
  it('replaces one plan’s prices, audited once per change', async () => {
    const rows = () => prisma.planPrice.findMany({ where: { planCode: 'PRO' }, orderBy: [{ currency: 'asc' }, { period: 'asc' }] });
    expect((await rows()).map((r) => [r.currency, r.period, r.amountMinor])).toEqual([
      ['IQD', 'MONTHLY', 50000],
      ['USD', 'YEARLY', 39900],
    ]);
    await price('PRO', [{ currency: 'USD', period: 'MONTHLY', amountMinor: 1500 }]);
    expect((await rows()).map((r) => [r.currency, r.amountMinor])).toEqual([['USD', 1500]]);
    // The same list again changes nothing and writes no row.
    await price('PRO', [{ currency: 'USD', period: 'MONTHLY', amountMinor: 1500 }]);
    const audit = await prisma.auditLog.findMany({ where: { action: 'plan_prices.updated', entityId: 'menu:PRO' }, orderBy: { occurredAt: 'asc' } });
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ actorId: owner.userId, entityType: 'PlanPrices', restaurantId: null });
    // Other plans keep theirs.
    expect(await prisma.planPrice.count({ where: { planCode: 'PREMIUM' } })).toBe(1);
  });

  it('refuses a fractional, negative or too large amount, a repeated pair and a plan the product does not sell', async () => {
    const now = new Date();
    const one = (amountMinor: number) => ({ applicationId: 'menu', planCode: 'BASIC', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor }] });
    expect(codeOf(await actAt(now, billing.setPrices, one(12.5)))).toBe('INVALID');
    expect(codeOf(await actAt(now, billing.setPrices, one(-1)))).toBe('INVALID');
    expect(await actAt(now, billing.setPrices, one(2_147_483_648))).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { 'prices.0.amountMinor': expect.any(String) } } });
    expect(codeOf(await actAt(now, billing.setPrices, one(2_147_483_647)))).toBe('OK');
    const dup = { currency: 'IQD', period: 'MONTHLY', amountMinor: 1 };
    expect(codeOf(await actAt(now, billing.setPrices, { applicationId: 'menu', planCode: 'BASIC', prices: [dup, dup] }))).toBe('INVALID');
    expect(await actAt(now, billing.setPrices, { applicationId: 'menu', planCode: 'GOLD', prices: [] })).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    expect(await actAt(now, billing.setPrices, { applicationId: 'cashier', planCode: 'GOLD', prices: [] })).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    expect(codeOf(await actAt(now, billing.setPrices, { applicationId: 'ghost', planCode: 'PRO', prices: [] }))).toBe('INVALID');
    expect((await prisma.planPrice.findMany({ where: { planCode: 'BASIC' } })).map((r) => r.amountMinor)).toEqual([2_147_483_647]);
  });

  it('answers CONFLICT, not a generic error, when another save of the same plan’s prices lands meanwhile', async () => {
    const now = new Date();
    const other = testPrisma();
    let pending: Promise<ActionResult<unknown>> | undefined;
    try {
      // The other save has inserted its row but not committed: this one deletes nothing it can see, then its insert
      // waits on that row and meets the unique key once the other commits.
      await other.$transaction(async (t) => {
        await t.planPrice.create({ data: { applicationId: 'menu', planCode: 'BASIC', currency: 'USD', period: 'MONTHLY', amountMinor: 1 } });
        pending = actAt(now, billing.setPrices, { applicationId: 'menu', planCode: 'BASIC', prices: [{ currency: 'USD', period: 'MONTHLY', amountMinor: 2 }] });
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      expect(await pending).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    } finally {
      await other.$disconnect();
    }
    expect((await prisma.planPrice.findMany({ where: { planCode: 'BASIC' } })).map((r) => r.amountMinor)).toEqual([1]);
    expect(await prisma.auditLog.count({ where: { action: 'plan_prices.updated', entityId: 'menu:BASIC' } })).toBe(0);
  });

  it('sets a product’s names and status, auditing only what changed', async () => {
    const name = { en: 'Cashier', ar: 'الكاشير', ckb: 'کاشێر' };
    expect(dataOf(await actAt(new Date(), billing.setApplication, { applicationId: 'cashier', name, status: 'ACTIVE' }))).toMatchObject({ status: 'ACTIVE' });
    expect(await prisma.application.findUniqueOrThrow({ where: { id: 'cashier' } })).toMatchObject({ status: 'ACTIVE', name });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'application.updated' } });
    expect(audit).toMatchObject({ entityType: 'Application', entityId: 'cashier' });
    expect(audit.changes).toEqual({ status: { before: 'DISABLED', after: 'ACTIVE' } });
    await actAt(new Date(), billing.setApplication, { applicationId: 'cashier', name, status: 'ACTIVE' });
    expect(await prisma.auditLog.count({ where: { action: 'application.updated' } })).toBe(1);
    expect(codeOf(await actAt(new Date(), billing.setApplication, { applicationId: 'cashier', name: { ...name, en: '' }, status: 'ACTIVE' }))).toBe('INVALID');
  });

  it('lists the products with each plan’s prices', async () => {
    const overview = dataOf(await readAt(new Date(), billingOverview, {}));
    expect(overview.canEdit).toBe(true);
    // Menu and Cashier sell the menu and the cashier; the Pharmacy space sells the pharmacy and nothing else.
    expect(overview.applications.map((app) => [app.id, app.status])).toEqual([
      ['menu', 'ACTIVE'],
      ['cashier', 'DISABLED'],
    ]);
    expect(dataOf(await readAt(new Date(), billingOverview, { space: 'pharmacy' })).applications.map((app) => [app.id, app.status])).toEqual([['pharmacy', 'DISABLED']]);
    // The Retail space sells Retail alone; its plans are app plans too, so no FOOD plan code is priced for it.
    const retail = dataOf(await readAt(new Date(), billingOverview, { space: 'retail' }));
    expect(retail.applications.map((app) => [app.id, app.status])).toEqual([['retail', 'DISABLED']]);
    expect(retail.applications[0]!.plans).toEqual([]);
    const menu = overview.applications[0]!;
    expect(menu.plans.map((plan) => [plan.code, plan.prices.map((p) => `${p.currency}/${p.period}/${p.amountMinor}`)])).toEqual([
      ['BASIC', []],
      ['PRO', ['IQD/MONTHLY/50000', 'USD/YEARLY/39900']],
      ['PREMIUM', ['IQD/MONTHLY/80000']],
    ]);
    expect(overview.applications[1]!.plans.map((plan) => [plan.code, plan.prices])).toEqual([['BASIC', []], ['PRO', []], ['PREMIUM', []]]);
    // Pharmacy plans are app plans (AppPlan), not FOOD plan codes, so the FOOD price list has none for it.
    expect(dataOf(await readAt(new Date(), billingOverview, { space: 'pharmacy' })).applications[0]!.plans).toEqual([]);
  });
});

describe('startTrial', () => {
  it('starts a 14-day trial on 31 Jan that ends on 14 Feb at the same time, priced from the plan', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const sub = await load(id);
    expect(sub).toMatchObject({ restaurantId, status: 'TRIAL', planCode: 'PRO', period: 'MONTHLY', currency: 'IQD', priceMinor: 50000, anchorDay: null, version: 1 });
    expect(sub.trialEndsAt?.toISOString()).toBe(at('2027-02-14T09:00:00+03:00').toISOString());
    expect(sub.currentPeriodStart.toISOString()).toBe(at('2027-01-31T09:00:00+03:00').toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(sub.trialEndsAt?.toISOString());
    expect((await events(id)).map((e) => [e.type, e.fromStatus, e.toStatus, e.actorId])).toEqual([['STARTED_TRIAL', null, 'TRIAL', owner.userId]]);
    const audit = await prisma.auditLog.findMany({ where: { action: 'subscription.trial_started' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityType: 'Subscription', entityId: id, restaurantId, actorId: owner.userId });
  });

  it('moves the restaurant to the Menu plan it starts, with the plan-change row, and expires its menus', async () => {
    expect(await planOf()).toBe('PREMIUM');
    vi.mocked(expireMenu).mockClear();
    await trial(at('2027-01-31T09:00:00+03:00'));
    expect(vi.mocked(expireMenu).mock.calls).toEqual([[['billing-a'], menuId]]);
    expect(await planOf()).toBe('PRO');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'restaurant.plan_changed' } });
    expect(audit).toMatchObject({ entityType: 'RestaurantPlan', entityId: restaurantId, restaurantId });
    expect(audit.changes).toEqual({ plan: { before: 'PREMIUM', after: 'PRO' } });
  });

  it('refuses a second live subscription to the same product as CONFLICT', async () => {
    await trial(at('2027-01-31T09:00:00+03:00'));
    vi.mocked(expireMenu).mockClear();
    expect(await actAt(at('2027-02-01T09:00:00+03:00'), billing.startTrial, trialInput())).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    // Refused, so nothing committed and no menu is expired.
    expect(vi.mocked(expireMenu)).not.toHaveBeenCalled();
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'subscription.trial_started' } })).toBe(1);
  });

  it('starts a trial when the live-looking row has lapsed without a sweep, writing the missed steps of that row', async () => {
    const old = await trial(at('2027-01-31T09:00:00+03:00')); // trial to 14 Feb, never swept
    expect(codeOf(await actAt(at('2027-03-01T09:00:00+03:00'), billing.startTrial, trialInput()))).toBe('OK');
    expect(await load(old)).toMatchObject({ status: 'EXPIRED', version: 2 });
    expect((await events(old)).at(-1)).toMatchObject({ type: 'EXPIRED', fromStatus: 'TRIAL', toStatus: 'EXPIRED', actorId: null });
    expect(await prisma.subscription.count({ where: { status: 'TRIAL' } })).toBe(1);
  });

  it('refuses a trial for a restaurant that is suspended or archived, as CONFLICT', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { status } });
      expect(await actAt(at('2027-01-31T09:00:00+03:00'), billing.startTrial, trialInput())).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    }
    expect(await prisma.subscription.count()).toBe(0);
    expect(await planOf()).toBe('PREMIUM');
  });

  it('starts a Cashier trial on the same plans as the Menu without moving the Menu plan', async () => {
    const now = at('2027-01-31T09:00:00+03:00');
    const name = { en: 'Cashier', ar: 'الكاشير', ckb: 'کاشێر' };
    dataOf(await actAt(now, billing.setApplication, { applicationId: 'cashier', name, status: 'ACTIVE' }));
    dataOf(await actAt(now, billing.setPrices, { applicationId: 'cashier', planCode: 'PRO', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 25_000 }] }));
    const before = await planOf();
    expect(codeOf(await actAt(now, billing.startTrial, trialInput({ applicationId: 'cashier' })))).toBe('OK');
    expect(await prisma.subscription.findFirstOrThrow({ where: { applicationId: 'cashier' } })).toMatchObject({ status: 'TRIAL', planCode: 'PRO', priceMinor: 25_000 });
    expect(await planOf()).toBe(before);
  });

  it('refuses a trial of a product that is turned off, as CONFLICT', async () => {
    const now = at('2027-01-31T09:00:00+03:00');
    // The Cashier is seeded turned off; the Menu turned off is refused just the same.
    expect(await actAt(now, billing.startTrial, trialInput({ applicationId: 'cashier' }))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    dataOf(await actAt(now, billing.setApplication, { applicationId: 'menu', name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' }, status: 'DISABLED' }));
    expect(await actAt(now, billing.startTrial, trialInput())).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'This product is turned off. Turn it on before starting a trial.' },
    });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('refuses a plan the product does not sell, a missing price and a bad trial length', async () => {
    const now = at('2027-01-31T09:00:00+03:00');
    expect(await actAt(now, billing.startTrial, trialInput({ planCode: 'GOLD' }))).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    expect(await actAt(now, billing.startTrial, trialInput({ planCode: 'BASIC' }))).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    expect(await actAt(now, billing.startTrial, trialInput({ currency: 'USD' }))).toMatchObject({ ok: false, error: { code: 'INVALID' } });
    expect(codeOf(await actAt(now, billing.startTrial, trialInput({ trialDays: 61 })))).toBe('INVALID');
    expect(codeOf(await actAt(now, billing.startTrial, trialInput({ trialDays: 0 })))).toBe('INVALID');
    expect(codeOf(await actAt(now, billing.startTrial, trialInput({ restaurantId: 'nope' })))).toBe('NOT_FOUND');
    expect(await prisma.subscription.count()).toBe(0);
  });
});

describe('recordPayment', () => {
  it('turns a trial into ACTIVE from the payment date (10 Feb) to 10 Mar', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const now = at('2027-02-10T12:00:00+03:00');
    const result = await pay(id, now);
    const sub = await load(id);
    expect(sub).toMatchObject({ status: 'ACTIVE', anchorDay: 10 });
    expect(sub.currentPeriodStart.toISOString()).toBe(now.toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-03-10T12:00:00+03:00').toISOString());
    expect(result.subscription).toMatchObject({ id, status: 'ACTIVE', currentPeriodEnd: sub.currentPeriodEnd });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment).toMatchObject({ subscriptionId: id, restaurantId, amountMinor: 50000, currency: 'IQD', method: 'CASH', recordedById: owner.userId });
    expect(payment.coversFrom.toISOString()).toBe(now.toISOString());
    expect(payment.coversTo.toISOString()).toBe(sub.currentPeriodEnd.toISOString());
    expect((await events(id)).map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ['STARTED_TRIAL', null, 'TRIAL'],
      ['ACTIVATED', 'TRIAL', 'ACTIVE'],
    ]);
    const audit = await prisma.auditLog.findMany({ where: { action: 'payment.recorded' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ restaurantId, entityType: 'Payment', entityId: result.paymentId });
  });

  it('walks the month ends: 31 Jan -> 28 Feb -> 31 Mar -> 30 Apr, never 3 Mar', async () => {
    const id = await paidOnTheThirtyFirst();
    let sub = await load(id);
    expect(sub.anchorDay).toBe(31);
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-02-28T09:00:00+03:00').toISOString());

    await pay(id, at('2027-02-25T15:00:00+03:00'));
    sub = await load(id);
    expect(sub.currentPeriodStart.toISOString()).toBe(at('2027-02-28T09:00:00+03:00').toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-03-31T09:00:00+03:00').toISOString());

    // Paid on 25 Mar for an ACTIVE subscription ending 31 Mar: continues from the old end, not from the payment date.
    const result = await pay(id, at('2027-03-25T15:00:00+03:00'));
    sub = await load(id);
    expect(sub.currentPeriodStart.toISOString()).toBe(at('2027-03-31T09:00:00+03:00').toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-04-30T09:00:00+03:00').toISOString());
    expect(sub.anchorDay).toBe(31);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    expect(payment.coversFrom.toISOString()).toBe(at('2027-03-31T09:00:00+03:00').toISOString());
    expect(payment.coversTo.toISOString()).toBe(at('2027-04-30T09:00:00+03:00').toISOString());
    expect((await events(id)).filter((e) => e.type === 'RENEWED')).toHaveLength(2);
  });

  it('renews a subscription in grace (ended 31 Mar, paid 3 Apr) from the old end, to 30 Apr', async () => {
    const id = await paidOnTheThirtyFirst();
    await pay(id, at('2027-02-25T15:00:00+03:00')); // to 31 Mar
    await prisma.subscription.update({ where: { id }, data: { status: 'GRACE', version: { increment: 1 } } }); // as the sweep leaves it
    await pay(id, at('2027-04-03T10:00:00+03:00'));
    const sub = await load(id);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-04-30T09:00:00+03:00').toISOString());
    const last = (await events(id)).at(-1)!;
    expect([last.type, last.fromStatus, last.toStatus]).toEqual(['RENEWED', 'GRACE', 'ACTIVE']);
  });

  it('renews an ACTIVE row whose period ended without a sweep as GRACE, writing the missed step', async () => {
    const id = await paidOnTheThirtyFirst(); // to 28 Feb
    await pay(id, at('2027-03-03T10:00:00+03:00'));
    const sub = await load(id);
    expect(sub.currentPeriodStart.toISOString()).toBe(at('2027-02-28T09:00:00+03:00').toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-03-31T09:00:00+03:00').toISOString());
    expect((await events(id)).slice(-2).map((e) => [e.type, e.fromStatus, e.toStatus, e.actorId])).toEqual([
      ['ENTERED_GRACE', 'ACTIVE', 'GRACE', null],
      ['RENEWED', 'GRACE', 'ACTIVE', owner.userId],
    ]);
  });

  it('records a payment sent twice after a lost answer once: the same result, one row, one extension, one audit row', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const now = at('2027-02-10T12:00:00+03:00');
    const input = paymentInput(id, now);
    const first = await actAt(now, billing.recordPayment, input);
    const second = await actAt(at('2027-02-10T12:00:05+03:00'), billing.recordPayment, input);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await prisma.payment.count()).toBe(1);
    const sub = await load(id);
    expect(sub.version).toBe(2);
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-03-10T12:00:00+03:00').toISOString());
    expect(await prisma.subscriptionEvent.count({ where: { type: 'ACTIVATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payment.recorded' } })).toBe(1);
  });

  it('records six simultaneous submissions of one payment once', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const now = at('2027-02-10T12:00:00+03:00');
    const input = paymentInput(id, now);
    // One client per submission, so the transactions overlap rather than queue on one client.
    const clients = Array.from({ length: 6 }, () => testPrisma());
    try {
      vi.setSystemTime(now);
      const results = await Promise.all(clients.map((client) => runAction(client, owner, billing.recordPayment, input, META)));
      expect(results[0]!.ok).toBe(true);
      for (const result of results) expect(result).toEqual(results[0]);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
    expect(await prisma.payment.count()).toBe(1);
    expect((await load(id)).version).toBe(2);
    expect(await prisma.subscriptionEvent.count({ where: { type: 'ACTIVATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payment.recorded' } })).toBe(1);
  });

  it('refuses an idempotency key already used for another restaurant’s subscription as CONFLICT', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    const otherId = dataOf(await actAt(at('2027-01-31T09:00:00+03:00'), billing.startTrial, trialInput({ restaurantId: other.id }))).id;
    const now = at('2027-02-10T12:00:00+03:00');
    const input = paymentInput(id, now);
    expect((await actAt(now, billing.recordPayment, input)).ok).toBe(true);
    expect(await actAt(now, billing.recordPayment, { ...input, restaurantId: other.id, subscriptionId: otherId })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await prisma.payment.count()).toBe(1);
    expect((await load(otherId)).status).toBe('TRIAL');
  });

  it('refuses a CANCELLED subscription, a future paidAt and a bad amount', async () => {
    const id = await paidOnTheThirtyFirst();
    const now = at('2027-02-10T12:00:00+03:00');
    expect(await actAt(now, billing.recordPayment, paymentInput(id, at('2027-02-12T12:00:00+03:00')))).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { paidAt: expect.any(String) } } });
    for (const amountMinor of [0, 12.5, 2_147_483_648]) {
      expect(codeOf(await actAt(now, billing.recordPayment, paymentInput(id, now, { amountMinor }))), String(amountMinor)).toBe('INVALID');
    }
    expect(codeOf(await actAt(now, billing.recordPayment, paymentInput(id, now, { idempotencyKey: 'not-a-uuid' })))).toBe('INVALID');
    expect(codeOf(await actAt(now, billing.recordPayment, paymentInput(id, now, { method: 'CARD' })))).toBe('INVALID');
    expect(codeOf(await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'Closed the shop' }))).toBe('OK');
    expect(await actAt(now, billing.recordPayment, paymentInput(id, now))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await prisma.payment.count()).toBe(1);
  });

  it('takes CASH when no method is given, and accepts a discounted amount, which still buys one full period', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const now = at('2027-02-10T12:00:00+03:00');
    const withoutMethod: Record<string, unknown> = paymentInput(id, now, { amountMinor: 25000, reference: 'ZC-1' });
    delete withoutMethod.method;
    const result = dataOf(await actAt(now, billing.recordPayment, withoutMethod));
    expect((await load(id)).currentPeriodEnd.toISOString()).toBe(at('2027-03-10T12:00:00+03:00').toISOString());
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).toMatchObject({ amountMinor: 25000, method: 'CASH', reference: 'ZC-1' });
  });

  it('restarts an EXPIRED subscription from the payment date on a new anchor', async () => {
    const id = await paidOnTheThirtyFirst(); // ends 28 Feb, grace to 7 Mar
    await prisma.subscription.update({ where: { id }, data: { status: 'EXPIRED', version: { increment: 1 } } }); // as the sweep leaves it
    await pay(id, at('2027-05-15T10:00:00+03:00'));
    const sub = await load(id);
    expect(sub).toMatchObject({ status: 'ACTIVE', anchorDay: 15 });
    expect(sub.currentPeriodStart.toISOString()).toBe(at('2027-05-15T10:00:00+03:00').toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-06-15T10:00:00+03:00').toISOString());
    const last = (await events(id)).at(-1)!;
    expect([last.type, last.fromStatus, last.toStatus]).toEqual(['ACTIVATED', 'EXPIRED', 'ACTIVE']);
  });

  it('refuses to restart an EXPIRED subscription while another one for the same product is live, as CONFLICT', async () => {
    const id = await paidOnTheThirtyFirst(); // ends 28 Feb, grace to 7 Mar, never swept
    const now = at('2027-03-10T10:00:00+03:00');
    await trial(now); // writes the lapsed one as EXPIRED and starts a new trial
    expect((await load(id)).status).toBe('EXPIRED');
    const payments = await prisma.payment.count();
    const audits = await prisma.auditLog.count();
    expect(await actAt(now, billing.recordPayment, paymentInput(id, now))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await prisma.payment.count()).toBe(payments);
    expect(await prisma.auditLog.count()).toBe(audits);
    expect((await load(id)).status).toBe('EXPIRED');
  });

  it('treats an ACTIVE row whose grace passed without a sweep as EXPIRED: starts now, ACTIVATED', async () => {
    const id = await paidOnTheThirtyFirst(); // ends 28 Feb, grace to 7 Mar, never swept
    await pay(id, at('2027-03-20T10:00:00+03:00'));
    const sub = await load(id);
    expect(sub.currentPeriodStart.toISOString()).toBe(at('2027-03-20T10:00:00+03:00').toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-04-20T10:00:00+03:00').toISOString());
    expect((await events(id)).slice(-3).map((e) => [e.type, e.fromStatus, e.toStatus, e.actorId])).toEqual([
      ['ENTERED_GRACE', 'ACTIVE', 'GRACE', null],
      ['EXPIRED', 'GRACE', 'EXPIRED', null],
      ['ACTIVATED', 'EXPIRED', 'ACTIVE', owner.userId],
    ]);
  });

  it('puts the restaurant back on the subscription’s Menu plan', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { plan: 'BASIC' } });
    vi.mocked(expireMenu).mockClear();
    await pay(id, at('2027-02-10T12:00:00+03:00'));
    expect(await planOf()).toBe('PRO');
    expect(vi.mocked(expireMenu).mock.calls).toEqual([[['billing-a'], menuId]]);
    // Paying again on the same plan changes nothing about the plan, so no plan row is written.
    const rows = await prisma.auditLog.count({ where: { action: 'restaurant.plan_changed' } });
    await pay(id, at('2027-02-20T12:00:00+03:00'));
    expect(await prisma.auditLog.count({ where: { action: 'restaurant.plan_changed' } })).toBe(rows);
  });

  it('finds no subscription of another restaurant', async () => {
    const other = await prisma.restaurant.create({ data: { name: 'Other' } });
    const otherId = dataOf(await actAt(at('2027-01-31T09:00:00+03:00'), billing.startTrial, trialInput({ restaurantId: other.id }))).id;
    const now = at('2027-02-10T12:00:00+03:00');
    expect(codeOf(await actAt(now, billing.recordPayment, paymentInput(otherId, now)))).toBe('NOT_FOUND');
    for (const [def, input] of [
      [billing.changePlan, { restaurantId, subscriptionId: otherId, version: 1, planCode: 'PREMIUM', keepPrice: true }],
      [billing.cancel, { restaurantId, subscriptionId: otherId, version: 1 }],
      [billing.reactivate, { restaurantId, subscriptionId: otherId, version: 1 }],
    ] as const) {
      expect(codeOf(await actAt(now, def as ActionDef<unknown, unknown>, input)), def.name).toBe('NOT_FOUND');
    }
    expect(await load(otherId)).toMatchObject({ status: 'TRIAL', planCode: 'PRO', version: 1 });
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe('recordPayment on a cancelled subscription', () => {
  it('restarts a CANCELLED subscription whose paid period has ended like an EXPIRED one: starts now, re-anchors, ACTIVATED', async () => {
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb
    expect(codeOf(await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'Closed for winter' }))).toBe('OK');
    const now = at('2027-04-15T10:00:00+03:00');
    expect(codeOf(await actAt(now, billing.recordPayment, paymentInput(id, now)))).toBe('OK');
    const sub = await load(id);
    expect(sub).toMatchObject({ status: 'ACTIVE', anchorDay: 15, cancelledAt: null });
    expect(sub.currentPeriodStart.toISOString()).toBe(now.toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe(at('2027-05-15T10:00:00+03:00').toISOString());
    const last = (await events(id)).at(-1)!;
    expect([last.type, last.fromStatus, last.toStatus, last.actorId]).toEqual(['ACTIVATED', 'CANCELLED', 'ACTIVE', owner.userId]);
    const audit = await prisma.auditLog.findMany({ where: { action: 'payment.recorded' }, orderBy: { occurredAt: 'asc' } });
    expect(audit).toHaveLength(2);
    expect(audit.at(-1)!.changes).toMatchObject({ status: { before: 'CANCELLED', after: 'ACTIVE' }, cancelledAt: { before: at('2027-02-10T12:00:00+03:00').toISOString(), after: null } });
  });

  it('restarts a cancelled subscription exactly at the end of its paid period', async () => {
    const id = await paidOnTheThirtyFirst();
    await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: '' });
    const end = (await load(id)).currentPeriodEnd;
    expect(codeOf(await actAt(end, billing.recordPayment, paymentInput(id, end)))).toBe('OK');
    expect((await load(id)).currentPeriodStart.toISOString()).toBe(end.toISOString());
  });

  it('still refuses a CANCELLED subscription before its period ends: reactivate it first', async () => {
    const id = await paidOnTheThirtyFirst();
    await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: '' });
    const now = at('2027-02-20T12:00:00+03:00');
    expect(await actAt(now, billing.recordPayment, paymentInput(id, now))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect((await load(id)).status).toBe('CANCELLED');
  });

  it('refuses to restart an ended CANCELLED subscription while a newer live one exists, as CONFLICT', async () => {
    const id = await paidOnTheThirtyFirst();
    await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'switching' });
    const now = at('2027-03-10T10:00:00+03:00');
    await trial(now);
    const audits = await prisma.auditLog.count();
    expect(await actAt(now, billing.recordPayment, paymentInput(id, now))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(await prisma.auditLog.count()).toBe(audits);
    expect((await load(id)).status).toBe('CANCELLED');
  });
});

describe('changePlan', () => {
  it('changes the plan, keeping the price or taking the new plan’s price', async () => {
    const id = await paidOnTheThirtyFirst();
    const now = at('2027-02-10T12:00:00+03:00');
    const change = async (planCode: string, keepPrice: boolean) => actAt(now, billing.changePlan, { restaurantId, subscriptionId: id, version: await versionOf(id), planCode, keepPrice });
    expect(codeOf(await change('PREMIUM', true))).toBe('OK');
    expect(await load(id)).toMatchObject({ planCode: 'PREMIUM', priceMinor: 50000, status: 'ACTIVE' });
    expect(codeOf(await change('PRO', false))).toBe('OK');
    expect(await load(id)).toMatchObject({ planCode: 'PRO', priceMinor: 50000 });
    expect(codeOf(await change('PREMIUM', false))).toBe('OK');
    expect(await load(id)).toMatchObject({ planCode: 'PREMIUM', priceMinor: 80000 });
    expect((await events(id)).filter((e) => e.type === 'PLAN_CHANGED')).toHaveLength(3);
    expect(await prisma.auditLog.count({ where: { action: 'subscription.plan_changed', entityId: id, restaurantId } })).toBe(3);

    expect(await change('GOLD', true)).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    expect(await change('PREMIUM', true)).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } });
    expect(await change('BASIC', false)).toMatchObject({ ok: false, error: { code: 'INVALID', fields: { planCode: expect.any(String) } } }); // no price
    expect(codeOf(await actAt(now, billing.changePlan, { restaurantId, subscriptionId: 'nope', version: 1, planCode: 'PRO', keepPrice: true }))).toBe('NOT_FOUND');
  });

  it('is seen in the restaurant’s Menu plan, with the plan-change row, and the menus expired', async () => {
    const id = await paidOnTheThirtyFirst();
    expect(await planOf()).toBe('PRO');
    vi.mocked(expireMenu).mockClear();
    dataOf(await actAt(at('2027-02-10T12:00:00+03:00'), billing.changePlan, { restaurantId, subscriptionId: id, version: await versionOf(id), planCode: 'BASIC', keepPrice: true }));
    expect(await planOf()).toBe('BASIC');
    expect(vi.mocked(expireMenu).mock.calls).toEqual([[['billing-a'], menuId]]);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'restaurant.plan_changed' }, orderBy: { occurredAt: 'desc' } });
    expect(row.changes).toEqual({ plan: { before: 'PRO', after: 'BASIC' } });
  });

  it('leaves the restaurant’s plan alone when the subscription is no longer live', async () => {
    const id = await paidOnTheThirtyFirst(); // ends 28 Feb, grace to 7 Mar
    dataOf(await actAt(at('2027-03-20T12:00:00+03:00'), billing.changePlan, { restaurantId, subscriptionId: id, version: await versionOf(id), planCode: 'BASIC', keepPrice: true }));
    expect((await load(id)).planCode).toBe('BASIC');
    expect(await planOf()).toBe('PRO');
  });
});

describe('cancel and reactivate', () => {
  it('cancels, then reactivates before currentPeriodEnd; after it, CONFLICT', async () => {
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb
    const now = at('2027-02-10T12:00:00+03:00');
    expect(codeOf(await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'Closed the shop' }))).toBe('OK');
    let sub = await load(id);
    expect(sub.status).toBe('CANCELLED');
    expect(sub.cancelledAt?.toISOString()).toBe(now.toISOString());
    expect(codeOf(await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'again' }))).toBe('CONFLICT');

    expect(codeOf(await actAt(at('2027-03-01T00:00:00+03:00'), billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }))).toBe('CONFLICT');
    expect(codeOf(await actAt(at('2027-02-20T12:00:00+03:00'), billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }))).toBe('OK');
    sub = await load(id);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.cancelledAt).toBeNull();
    expect(codeOf(await actAt(at('2027-02-20T12:00:00+03:00'), billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }))).toBe('CONFLICT');
    expect((await events(id)).slice(-2).map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ['CANCELLED', 'ACTIVE', 'CANCELLED'],
      ['REACTIVATED', 'CANCELLED', 'ACTIVE'],
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'subscription.cancelled', restaurantId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'subscription.reactivated', restaurantId } })).toBe(1);
  });

  it('expires the restaurant’s menus when its Menu subscription is cancelled, since guests lose the menu', async () => {
    const id = await paidOnTheThirtyFirst();
    vi.mocked(expireMenu).mockClear();
    dataOf(await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'stopped' }));
    expect(vi.mocked(expireMenu).mock.calls).toEqual([[['billing-a'], menuId]]);
  });

  it('refuses to cancel a lagged ACTIVE subscription whose grace has passed', async () => {
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb, 7 days of grace; the sweep has not run
    expect(await actAt(at('2027-03-20T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'late' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'This subscription has already expired' },
    });
    expect((await load(id)).status).toBe('ACTIVE');
  });

  it('refuses to reactivate while another live subscription to the product exists', async () => {
    const id = await paidOnTheThirtyFirst();
    const now = at('2027-02-10T12:00:00+03:00');
    await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'switching' });
    await trial(now);
    expect(codeOf(await actAt(now, billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }))).toBe('CONFLICT');
    expect((await load(id)).status).toBe('CANCELLED');
  });

  it('puts the restaurant on the Menu plan the subscription has when it is reactivated', async () => {
    await price('BASIC', [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 20000 }]);
    const id = await paidOnTheThirtyFirst(); // PRO, ACTIVE to 28 Feb
    const now = at('2027-02-10T12:00:00+03:00');
    dataOf(await actAt(now, billing.changePlan, { restaurantId, subscriptionId: id, version: await versionOf(id), planCode: 'PREMIUM', keepPrice: false }));
    expect(await planOf()).toBe('PREMIUM');
    dataOf(await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'pausing' }));
    // Cancelled, so the plan change is not what guests see yet.
    dataOf(await actAt(now, billing.changePlan, { restaurantId, subscriptionId: id, version: await versionOf(id), planCode: 'BASIC', keepPrice: false }));
    expect(await planOf()).toBe('PREMIUM');
    const rows = await prisma.auditLog.count({ where: { action: 'restaurant.plan_changed' } });
    vi.mocked(expireMenu).mockClear();
    dataOf(await actAt(at('2027-02-12T12:00:00+03:00'), billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }));
    expect(await planOf()).toBe('BASIC');
    expect(vi.mocked(expireMenu).mock.calls).toEqual([[['billing-a'], menuId]]);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'restaurant.plan_changed' }, orderBy: { occurredAt: 'desc' } });
    expect(row.changes).toEqual({ plan: { before: 'PREMIUM', after: 'BASIC' } });
    expect(await prisma.auditLog.count({ where: { action: 'restaurant.plan_changed' } })).toBe(rows + 1);
  });

  it('returns a cancelled trial that was never paid to TRIAL, not to ACTIVE', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    const now = at('2027-02-05T12:00:00+03:00');
    await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'not now' });
    expect(dataOf(await actAt(now, billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }))).toEqual({ id, status: 'TRIAL' });
    expect((await load(id)).status).toBe('TRIAL');
  });
});

describe('a plan set on the Plan tab', () => {
  const comp = (now: Date, plan: string) => actAt(now, plans.setRestaurantPlan, { restaurantId, plan, extras: {}, note: 'Comped' });

  it('moves the live Menu subscription too, so the next payment keeps the comped plan', async () => {
    const id = await paidOnTheThirtyFirst(); // PRO, ACTIVE to 28 Feb
    const before = await load(id);
    dataOf(await comp(at('2027-02-10T12:00:00+03:00'), 'PREMIUM'));
    expect(await planOf()).toBe('PREMIUM');
    // Moved like a plan change on the Billing tab: a new version, the price kept, a PLAN_CHANGED event and an audit row.
    expect(await load(id)).toMatchObject({ planCode: 'PREMIUM', priceMinor: before.priceMinor, status: 'ACTIVE', version: before.version + 1 });
    const changed = (await events(id)).filter((e) => e.type === 'PLAN_CHANGED');
    expect(changed.map((e) => [e.fromStatus, e.toStatus, e.actorId, e.data])).toEqual([
      ['ACTIVE', 'ACTIVE', owner.userId, { fromPlanCode: 'PRO', toPlanCode: 'PREMIUM', keepPrice: true, priceMinorBefore: 50000, priceMinorAfter: 50000 }],
    ]);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'subscription.plan_changed', entityId: id } });
    expect(row).toMatchObject({ restaurantId, entityType: 'Subscription', changes: { planCode: { before: 'PRO', after: 'PREMIUM' } } });

    // The routine renewal records money; it does not undo the comp.
    await pay(id, at('2027-02-27T12:00:00+03:00'));
    expect(await planOf()).toBe('PREMIUM');
    expect((await load(id)).planCode).toBe('PREMIUM');
  });

  it('moves a trial the same way', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00')); // PRO
    dataOf(await comp(at('2027-02-01T12:00:00+03:00'), 'BASIC'));
    expect((await load(id)).planCode).toBe('BASIC');
    await pay(id, at('2027-02-02T12:00:00+03:00'));
    expect(await planOf()).toBe('BASIC');
  });

  it('leaves the subscription alone when it is already on that plan, or when none is live', async () => {
    const id = await paidOnTheThirtyFirst(); // PRO
    const before = await load(id);
    dataOf(await actAt(at('2027-02-10T12:00:00+03:00'), plans.setRestaurantPlan, { restaurantId, plan: 'PRO', extras: {}, note: 'Only the note' }));
    expect(await load(id)).toEqual(before);

    dataOf(await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: '' }));
    const cancelled = await load(id);
    dataOf(await comp(at('2027-02-11T12:00:00+03:00'), 'BASIC'));
    expect(await load(id)).toEqual(cancelled);
    expect(await planOf()).toBe('BASIC');
    expect((await events(id)).filter((e) => e.type === 'PLAN_CHANGED')).toHaveLength(0);
  });

  it('changes only the restaurant when it has no subscription', async () => {
    dataOf(await comp(at('2027-02-10T12:00:00+03:00'), 'BASIC'));
    expect(await planOf()).toBe('BASIC');
    expect(await prisma.subscription.count()).toBe(0);
  });
});

describe('the version the person saw', () => {
  it('refuses a plan change, cancel or reactivate made from a stale page as CONFLICT, and writes nothing', async () => {
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb
    const now = at('2027-02-10T12:00:00+03:00');
    // The dialog was opened on this version; a payment recorded in another tab then moved the row on.
    const seen = await versionOf(id);
    await pay(id, now);
    const after = await load(id);
    for (const [def, input] of [
      [billing.changePlan, { restaurantId, subscriptionId: id, version: seen, planCode: 'PREMIUM', keepPrice: true }],
      [billing.cancel, { restaurantId, subscriptionId: id, version: seen, reason: 'stale' }],
    ] as Array<[ActionDef<unknown, unknown>, unknown]>) {
      expect(codeOf(await actAt(now, def, input))).toBe('CONFLICT');
    }
    expect(await load(id)).toEqual(after);

    const cancelledFrom = await versionOf(id);
    dataOf(await actAt(now, billing.cancel, { restaurantId, subscriptionId: id, version: cancelledFrom, reason: 'pausing' }));
    // Reactivate opened before a plan change made in another tab.
    const seenCancelled = await versionOf(id);
    dataOf(await actAt(now, billing.changePlan, { restaurantId, subscriptionId: id, version: seenCancelled, planCode: 'PREMIUM', keepPrice: true }));
    expect(codeOf(await actAt(now, billing.reactivate, { restaurantId, subscriptionId: id, version: seenCancelled }))).toBe('CONFLICT');
    expect((await load(id)).status).toBe('CANCELLED');
  });

  it('requires the version', async () => {
    const id = await paidOnTheThirtyFirst();
    expect(codeOf(await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, reason: '' }))).toBe('INVALID');
  });
});

describe('reactivate, like a trial, needs an active restaurant and product', () => {
  async function cancelled(): Promise<string> {
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb
    dataOf(await actAt(at('2027-02-10T12:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: 'pausing' }));
    return id;
  }

  it('refuses a suspended or archived restaurant as CONFLICT, leaving the subscription cancelled and the plan alone', async () => {
    const id = await cancelled();
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { plan: 'BASIC' } });
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { status } });
      expect(await actAt(at('2027-02-12T12:00:00+03:00'), billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) })).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', message: 'Only an active restaurant can reactivate a subscription. Activate it first.' },
      });
    }
    expect((await load(id)).status).toBe('CANCELLED');
    expect(await planOf()).toBe('BASIC');
  });

  it('refuses a product that is turned off as CONFLICT', async () => {
    const id = await cancelled();
    const now = at('2027-02-12T12:00:00+03:00');
    dataOf(await actAt(now, billing.setApplication, { applicationId: 'menu', name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' }, status: 'DISABLED' }));
    expect(await actAt(now, billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: 'This product is turned off. Turn it on before reactivating.' },
    });
    expect((await load(id)).status).toBe('CANCELLED');
  });
});

describe('billing.restaurant', () => {
  it('shows the restaurant’s subscriptions as they are now, with their events and payments', async () => {
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb, never swept
    const view = dataOf(await readAt(at('2027-03-02T12:00:00+03:00'), restaurantBilling, { restaurantId }));
    expect(view.restaurant).toMatchObject({ id: restaurantId, plan: 'PRO' });
    expect(view.canEdit).toBe(true);
    expect(view.applications.map((app) => [app.id, app.planCodes])).toEqual([
      ['menu', ['BASIC', 'PRO', 'PREMIUM']],
      ['cashier', ['BASIC', 'PRO', 'PREMIUM']],
    ]);
    expect(view.subscriptions).toHaveLength(1);
    expect(view.subscriptions[0]).toMatchObject({ id, storedStatus: 'ACTIVE', status: 'GRACE', planCode: 'PRO' });
    expect(view.subscriptions[0]!.events.map((e) => [e.type, e.actorName])).toEqual([
      ['STARTED_TRIAL', 'owner'],
      ['ACTIVATED', 'owner'],
    ]);
    expect(view.payments).toHaveLength(1);
    expect(view.payments[0]).toMatchObject({ subscriptionId: id, amountMinor: 50000, currency: 'IQD', method: 'CASH', recordedByName: 'owner' });
    expect(dataOf(await readAt(at('2027-03-20T12:00:00+03:00'), restaurantBilling, { restaurantId })).subscriptions[0]!.status).toBe('EXPIRED');
    expect(codeOf(await readAt(new Date(), restaurantBilling, { restaurantId: 'nope' }))).toBe('NOT_FOUND');
  });

  it('offers a retail shop only the Retail product, never Menu or Cashier', async () => {
    const shop = await prisma.restaurant.create({ data: { name: 'Shop billing', sector: 'RETAIL' } });
    const view = dataOf(await readAt(new Date(), restaurantBilling, { restaurantId: shop.id }));
    expect(view.applications.map((app) => [app.id, app.planCodes])).toEqual([['retail', []]]);
  });
});

describe('billing.restaurants', () => {
  it('lists every restaurant with each product’s subscription as it is now and its last payment', async () => {
    const other = await createMenuFixture(prisma, 'billing-b');
    const id = await paidOnTheThirtyFirst(); // ACTIVE to 28 Feb, never swept
    const list = dataOf(await readAt(at('2027-03-02T12:00:00+03:00'), billingRestaurants, {}));

    expect(list.applications.map((app) => app.id)).toEqual(['menu', 'cashier']);
    expect(list.total).toBe(2);
    expect(list.rows.map((row) => row.name)).toEqual(['Restaurant billing-a', 'Restaurant billing-b']);

    const [paid, none] = list.rows;
    expect(paid).toMatchObject({ id: restaurantId, lastPayment: { amountMinor: 50000, currency: 'IQD' } });
    expect(paid!.products).toEqual([
      {
        applicationId: 'menu',
        subscription: {
          id,
          planCode: 'PRO',
          status: 'GRACE',
          currentPeriodEnd: (await load(id)).currentPeriodEnd,
          trial: false,
        },
      },
      { applicationId: 'cashier', subscription: null },
    ]);
    expect(none).toMatchObject({ id: other.restaurant.id, lastPayment: null });
    expect(none!.products.map((product) => product.subscription)).toEqual([null, null]);
  });

  it('lists a retail shop with the Retail product in the Retail space alone', async () => {
    await prisma.restaurant.create({ data: { name: 'Shop billing', sector: 'RETAIL' } });
    const food = dataOf(await readAt(new Date(), billingRestaurants, {}));
    expect(food.applications.map((app) => app.id)).toEqual(['menu', 'cashier']);
    expect(food.rows.map((row) => row.name)).not.toContain('Shop billing');
    const retail = dataOf(await readAt(new Date(), billingRestaurants, { space: 'retail' }));
    expect(retail.applications.map((app) => app.id)).toEqual(['retail']);
    expect(retail.rows.map((row) => [row.name, row.products.map((product) => product.applicationId)])).toEqual([['Shop billing', ['retail']]]);
  });

  it('shows a trial as a trial that ends with its period, and a cancelled one when there is no live one', async () => {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    let row = dataOf(await readAt(at('2027-02-01T09:00:00+03:00'), billingRestaurants, {})).rows[0]!;
    expect(row.products[0]!.subscription).toMatchObject({ id, status: 'TRIAL', trial: true });
    expect(row.lastPayment).toBeNull();

    dataOf(await actAt(at('2027-02-02T09:00:00+03:00'), billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: '' }));
    row = dataOf(await readAt(at('2027-02-03T09:00:00+03:00'), billingRestaurants, {})).rows[0]!;
    expect(row.products[0]!.subscription).toMatchObject({ id, status: 'CANCELLED' });
  });

  it('pages the restaurants by name', async () => {
    for (const slug of ['billing-c', 'billing-d']) await createMenuFixture(prisma, slug);
    const second = dataOf(await readAt(new Date(), billingRestaurants, { page: 2, pageSize: 2 }));
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(second.rows.map((row) => row.name)).toEqual(['Restaurant billing-d']);
  });

  it('is for Super Admins only', async () => {
    expect(dataOf(await readAt(new Date(), billingRestaurants, {}, otherAdmin)).total).toBe(1);
    expect(codeOf(await readAt(new Date(), billingRestaurants, {}, restaurantOwner))).toBe('FORBIDDEN');
  });
});

describe('who may use billing', () => {
  /** Every write, with inputs that would succeed for the platform owner. */
  async function writes(): Promise<Array<[ActionDef<unknown, unknown>, unknown]>> {
    const id = await trial(at('2027-01-31T09:00:00+03:00'));
    return [
      [billing.setApplication, { applicationId: 'cashier', name: { en: 'Till', ar: 'Till', ckb: 'Till' }, status: 'ACTIVE' }],
      [billing.setPrices, { applicationId: 'menu', planCode: 'BASIC', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 1 }] }],
      [billing.startTrial, trialInput({ applicationId: 'menu' })],
      [billing.changePlan, { restaurantId, subscriptionId: id, version: await versionOf(id), planCode: 'PREMIUM', keepPrice: true }],
      [billing.cancel, { restaurantId, subscriptionId: id, version: await versionOf(id), reason: '' }],
      [billing.reactivate, { restaurantId, subscriptionId: id, version: await versionOf(id) }],
      [billing.recordPayment, paymentInput(id, at('2027-02-01T09:00:00+03:00'))],
    ] as Array<[ActionDef<unknown, unknown>, unknown]>;
  }

  it('lets a Super Admin who is not the platform owner read billing, and refuses them every write with FORBIDDEN', async () => {
    const list = await writes();
    const now = at('2027-02-01T09:00:00+03:00');
    const overview = dataOf(await readAt(now, billingOverview, {}, otherAdmin));
    expect(overview.canEdit).toBe(false);
    expect(overview.applications.map((app) => app.id)).toEqual(['menu', 'cashier']);
    expect(dataOf(await readAt(now, restaurantBilling, { restaurantId }, otherAdmin)).canEdit).toBe(false);
    const audits = await prisma.auditLog.count();
    for (const [def, input] of list) expect(codeOf(await actAt(now, def, input, otherAdmin)), def.name).toBe('FORBIDDEN');
    expect(await prisma.auditLog.count()).toBe(audits);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.subscription.findMany({ select: { status: true, planCode: true, version: true } })).toEqual([{ status: 'TRIAL', planCode: 'PRO', version: 1 }]);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: 'cashier' } })).status).toBe('DISABLED');
  });

  it('refuses the restaurant’s own owner every read and write with FORBIDDEN', async () => {
    const list = await writes();
    const now = at('2027-02-01T09:00:00+03:00');
    expect(codeOf(await readAt(now, billingOverview, {}, restaurantOwner))).toBe('FORBIDDEN');
    expect(codeOf(await readAt(now, restaurantBilling, { restaurantId }, restaurantOwner))).toBe('FORBIDDEN');
    for (const [def, input] of list) expect(codeOf(await actAt(now, def, input, restaurantOwner)), def.name).toBe('FORBIDDEN');
    expect(await prisma.payment.count()).toBe(0);
  });
});

describe('deleting a restaurant with billing rows', () => {
  it('is refused with CONFLICT while it has a subscription or a payment, so payment history is never lost', async () => {
    const bare = await prisma.restaurant.create({ data: { name: 'Bare Cafe' } });
    const input = { restaurantId: bare.id, confirmName: 'Bare Cafe' };
    const id = dataOf(await actAt(at('2027-01-31T09:00:00+03:00'), billing.startTrial, trialInput({ restaurantId: bare.id }))).id;
    expect(await actAt(new Date(), restaurants.deleteRestaurant, input)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: expect.stringContaining('never deleted') },
    });
    dataOf(await actAt(at('2027-02-01T09:00:00+03:00'), billing.recordPayment, { ...paymentInput(id, at('2027-02-01T09:00:00+03:00')), restaurantId: bare.id }));
    expect(codeOf(await actAt(new Date(), restaurants.deleteRestaurant, input))).toBe('CONFLICT');
    expect(await prisma.restaurant.findUnique({ where: { id: bare.id } })).not.toBeNull();
    expect(await prisma.payment.count({ where: { restaurantId: bare.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'restaurant.deleted' } })).toBe(0);
    // Refused for its billing rows before being told to delete its menus, which would not help.
    expect(await actAt(new Date(), restaurants.deleteRestaurant, { restaurantId, confirmName: 'Restaurant billing-a' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID', message: 'Delete all of its menus first' },
    });
    dataOf(await actAt(at('2027-01-31T09:00:00+03:00'), billing.startTrial, trialInput()));
    expect(await actAt(new Date(), restaurants.deleteRestaurant, { restaurantId, confirmName: 'Restaurant billing-a' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: expect.stringContaining('never deleted') },
    });
    // A restaurant without billing rows still goes.
    const plain = await prisma.restaurant.create({ data: { name: 'Plain Cafe' } });
    expect(dataOf(await actAt(new Date(), restaurants.deleteRestaurant, { restaurantId: plain.id, confirmName: 'Plain Cafe' }))).toEqual({ deleted: true });
  });
});
