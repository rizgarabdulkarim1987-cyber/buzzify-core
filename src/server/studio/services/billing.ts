import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { APPLICATION_IDS, planCodesFor, type ApplicationId } from '@/server/domain/billing/catalog';
import { MAX_AMOUNT_MINOR } from '@/server/domain/billing/money';
import { addPeriod, BAGHDAD_OFFSET_MS } from '@/server/domain/billing/periods';
import { effectiveStatus, isLive, lifecycleSteps, type LifecycleStep, type SubscriptionStatus } from '@/server/domain/billing/subscriptions';
import type { PlanTier } from '@/server/domain/entitlements';
import type { ActionContext } from '@/server/studio/framework/action';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import { expireMenusAfterCommit } from '@/server/studio/services/restaurants';

/**
 * Billing (docs/superpowers/plans/2026-10-22-business-core-in-menu.md, ported from Business Core's plans, subscriptions
 * and payments services): the products and their prices, and each restaurant's subscriptions and hand-recorded
 * payments. No payment provider is ever called: the platform owner records money they have received.
 *
 * The subscription functions run on a client scoped to the restaurant (`transactionIn`), so a subscription or payment
 * of another restaurant is not found. Times are judged at `now`, passed in by the action.
 */

export const CURRENCIES = ['IQD', 'USD'] as const;
export const PERIODS = ['MONTHLY', 'YEARLY'] as const;
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'ZAINCASH', 'FIB', 'QI_CARD', 'OTHER'] as const;
const LIVE: SubscriptionStatus[] = ['TRIAL', 'ACTIVE', 'GRACE'];
const DAY_MS = 86_400_000;

export const SECOND_LIVE = 'This restaurant already has a live subscription to this product';
const RESTAURANT_NOT_ACTIVE = 'Only an active restaurant can start a trial. Activate it first.';
const PRODUCT_DISABLED = 'This product is turned off. Turn it on before starting a trial.';
const DUPLICATE_KEY = 'This payment was already recorded for another subscription';
const REACTIVATE_RESTAURANT_NOT_ACTIVE = 'Only an active restaurant can reactivate a subscription. Activate it first.';
const REACTIVATE_PRODUCT_DISABLED = 'This product is turned off. Turn it on before reactivating.';

/** What the billing functions need of the action: who acts, and where its audit rows and callbacks go. */
export type BillingWork = Pick<ActionContext, 'actor' | 'audit' | 'afterCommit'>;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

const invalid = (field: string, message: string) => new StudioError('INVALID', 'Check the highlighted fields', { [field]: message });

// Inputs --------------------------------------------------------------------------------------------------------------

const idField = z.string().min(1).max(100);
/** The subscription's version when the person opened the dialog: a row that moved on since is refused as `CONFLICT`. */
const version = z.number().int().positive();
const applicationId = z.enum(APPLICATION_IDS, 'Choose one of the products offered');
const planCode = z.string().trim().min(1, 'Choose a plan').max(40);
const currency = z.enum(CURRENCIES, 'Choose one of the currencies offered');
const period = z.enum(PERIODS, 'Choose one of the periods offered');
const text = z.string().trim().min(1, 'Enter a value').max(80, 'Use at most 80 characters');
const amountMinor = z
  .number('Enter a whole number of minor units')
  .int('Enter a whole number of minor units')
  .max(MAX_AMOUNT_MINOR, 'Enter a smaller amount');

export const applicationInput = z.object({
  applicationId,
  name: z.object({ en: text, ar: text, ckb: text }),
  status: z.enum(['ACTIVE', 'DISABLED'], 'Choose one of the statuses offered'),
});

export const pricesInput = z.object({
  applicationId,
  planCode,
  prices: z
    .array(z.object({ currency, period, amountMinor: amountMinor.min(0, 'Use 0 or more') }))
    .max(CURRENCIES.length * PERIODS.length)
    .refine((list) => new Set(list.map((p) => `${p.currency}/${p.period}`)).size === list.length, 'Each currency and period may appear once'),
});

export const trialInput = z.object({
  restaurantId: idField,
  applicationId,
  planCode,
  trialDays: z.number().int('Enter a whole number of days').min(1, 'Enter 1 to 60 days').max(60, 'Enter 1 to 60 days'),
  period,
  currency,
});

export const changePlanInput = z.object({ restaurantId: idField, subscriptionId: idField, version, planCode, keepPrice: z.boolean() });

export const cancelInput = z.object({
  restaurantId: idField,
  subscriptionId: idField,
  version,
  reason: z.string().trim().max(500, 'Use at most 500 characters').default(''),
});

export const reactivateInput = z.object({ restaurantId: idField, subscriptionId: idField, version });

export const paymentInput = z.object({
  restaurantId: idField,
  subscriptionId: idField,
  amountMinor: amountMinor.min(1, 'Enter an amount above zero'),
  method: z.enum(PAYMENT_METHODS, 'Choose one of the payment methods offered').default('CASH'),
  reference: z.string().trim().max(120, 'Use at most 120 characters').default(''),
  paidAt: z.coerce.date({ error: 'Enter the date the money was received' }),
  idempotencyKey: z.uuid(),
  note: z.string().trim().max(1000, 'Use at most 1,000 characters').default(''),
});

/** A plan code the application sells, or `INVALID` on `planCode`. */
function checkPlanCode(application: ApplicationId, code: string): void {
  if (!planCodesFor(application).includes(code)) throw invalid('planCode', 'Choose one of the plans this product offers');
}

// Products and prices --------------------------------------------------------------------------------------------------

/** Sets a product's names and status; the last save wins (only the platform owner can make it). */
export async function setApplication(tx: ScopedTx, work: BillingWork, input: z.infer<typeof applicationInput>) {
  const before = await tx.application.findUnique({ where: { id: input.applicationId }, select: { name: true, status: true } });
  if (!before) throw new StudioError('NOT_FOUND');
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const was = (before.name ?? {}) as Record<string, unknown>;
  // Compared per language: the stored JSON keeps its keys in its own order.
  if ((['en', 'ar', 'ckb'] as const).some((locale) => was[locale] !== input.name[locale])) changes.name = { before: before.name, after: input.name };
  if (before.status !== input.status) changes.status = { before: before.status, after: input.status };
  if (Object.keys(changes).length > 0) {
    await tx.application.update({ where: { id: input.applicationId }, data: { name: input.name, status: input.status } });
    work.audit({ action: 'application.updated', entityType: 'Application', entityId: input.applicationId, changes });
  }
  return { id: input.applicationId, name: input.name, status: input.status };
}

/** Replaces one plan's prices with the list given (an empty list removes them all). */
export async function setPrices(tx: ScopedTx, work: BillingWork, input: z.infer<typeof pricesInput>) {
  if (!(await tx.application.findUnique({ where: { id: input.applicationId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
  checkPlanCode(input.applicationId, input.planCode);
  const where = { applicationId: input.applicationId, planCode: input.planCode };
  const order: Prisma.PlanPriceOrderByWithRelationInput[] = [{ currency: 'asc' }, { period: 'asc' }];
  const select = { currency: true, period: true, amountMinor: true } as const;
  const before = await tx.planPrice.findMany({ where, orderBy: order, select });
  await tx.planPrice.deleteMany({ where });
  if (input.prices.length > 0) {
    try {
      await tx.planPrice.createMany({ data: input.prices.map((price) => ({ ...where, ...price })) });
    } catch (error) {
      // Two saves of the same plan at once: each deletes only the rows it saw, so the later insert meets the other's row.
      if (isUniqueViolation(error)) throw new StudioError('CONFLICT');
      throw error;
    }
  }
  const after = await tx.planPrice.findMany({ where, orderBy: order, select });
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    work.audit({ action: 'plan_prices.updated', entityType: 'PlanPrices', entityId: `${input.applicationId}:${input.planCode}`, changes: { prices: { before, after } } });
  }
  return { applicationId: input.applicationId, planCode: input.planCode, prices: after };
}

// Subscriptions -------------------------------------------------------------------------------------------------------

/** The plan price for a currency and period, or `INVALID` on `planCode`. */
async function planPrice(tx: ScopedTx, application: string, code: string, currency: (typeof CURRENCIES)[number], period: (typeof PERIODS)[number]) {
  const price = await tx.planPrice.findUnique({
    where: { applicationId_planCode_currency_period: { applicationId: application, planCode: code, currency, period } },
    select: { amountMinor: true },
  });
  if (!price) throw invalid('planCode', 'This plan has no price in this currency and period');
  return price.amountMinor;
}

async function loadSubscription(tx: ScopedTx, subscriptionId: string) {
  const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new StudioError('NOT_FOUND');
  return sub;
}

/** Writes the system's events for `steps` (no actor). */
async function writeLifecycleEvents(tx: ScopedTx, subscriptionId: string, steps: LifecycleStep[], now: Date): Promise<void> {
  if (steps.length === 0) return;
  await tx.subscriptionEvent.createMany({
    data: steps.map((step) => ({ subscriptionId, type: step.type, fromStatus: step.from, toStatus: step.to, actorId: null, occurredAt: now })),
  });
}

/**
 * For the Menu, the plan code is what guests see: it is written to `Restaurant.plan` in the same transaction (with the
 * `restaurant.plan_changed` row when it changed), and every address of the restaurant's menus is expired after commit,
 * as `plans.setRestaurantPlan` does. Other products have no such column.
 */
async function applyMenuPlan(tx: ScopedTx, work: BillingWork, restaurantId: string, application: string, code: string): Promise<void> {
  if (application !== 'menu') return;
  const before = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { plan: true } });
  if (!before) throw new StudioError('NOT_FOUND');
  const plan = code as PlanTier;
  if (before.plan !== plan) {
    await tx.restaurant.update({ where: { id: restaurantId }, data: { plan } });
    work.audit({ action: 'restaurant.plan_changed', entityType: 'RestaurantPlan', entityId: restaurantId, changes: { plan: { before: before.plan, after: plan } } });
  }
  await expireMenusAfterCommit(tx, work.afterCommit);
}

/** Starts a trial of a product for a restaurant, priced from the plan's price in the currency and period given. */
export async function startTrial(tx: ScopedTx, work: BillingWork, input: z.infer<typeof trialInput>, now: Date) {
  const restaurant = await tx.restaurant.findUnique({ where: { id: input.restaurantId }, select: { status: true } });
  if (!restaurant) throw new StudioError('NOT_FOUND');
  // Checked here and not only by hiding the button: a suspended or archived restaurant starts nothing.
  if (restaurant.status !== 'ACTIVE') throw new StudioError('CONFLICT', RESTAURANT_NOT_ACTIVE);
  const application = await tx.application.findUnique({ where: { id: input.applicationId }, select: { status: true } });
  if (!application) throw new StudioError('NOT_FOUND');
  if (application.status !== 'ACTIVE') throw new StudioError('CONFLICT', PRODUCT_DISABLED);
  checkPlanCode(input.applicationId, input.planCode);
  const priceMinor = await planPrice(tx, input.applicationId, input.planCode, input.currency, input.period);

  const live = await tx.subscription.findFirst({
    where: { applicationId: input.applicationId, status: { in: LIVE } },
    select: { id: true, version: true, status: true, trialEndsAt: true, currentPeriodEnd: true, graceDays: true },
  });
  if (live) {
    // A sweep may not have run yet: judge the row as of now. Still live is a second live one; lapsed, it is written as
    // expired here (with the system's events for the steps it missed) and the new trial goes ahead.
    const missed = lifecycleSteps(live, now);
    const to = missed.at(-1)?.to ?? live.status;
    if (isLive(to)) throw new StudioError('CONFLICT', SECOND_LIVE);
    await updateWithVersion(tx.subscription, { id: live.id, version: live.version, data: { status: to }, entityType: 'Subscription' }, tx);
    await writeLifecycleEvents(tx, live.id, missed, now);
  }

  const trialEndsAt = new Date(now.getTime() + input.trialDays * DAY_MS);
  let subscriptionId: string;
  try {
    const created = await tx.subscription.create({
      data: {
        restaurantId: input.restaurantId,
        applicationId: input.applicationId,
        planCode: input.planCode,
        status: 'TRIAL',
        period: input.period,
        currency: input.currency,
        priceMinor,
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        version: 1,
      },
      select: { id: true },
    });
    subscriptionId = created.id;
  } catch (error) {
    // The partial unique index "Subscription_live_key": a concurrent start won.
    if (isUniqueViolation(error)) throw new StudioError('CONFLICT', SECOND_LIVE);
    throw error;
  }

  await tx.subscriptionEvent.create({
    data: {
      subscriptionId,
      type: 'STARTED_TRIAL',
      fromStatus: null,
      toStatus: 'TRIAL',
      data: { planCode: input.planCode, trialDays: input.trialDays, priceMinor, currency: input.currency, period: input.period },
      actorId: work.actor.userId,
      occurredAt: now,
    },
  });
  work.audit({
    action: 'subscription.trial_started',
    entityType: 'Subscription',
    entityId: subscriptionId,
    changes: {
      applicationId: { before: null, after: input.applicationId },
      planCode: { before: null, after: input.planCode },
      status: { before: null, after: 'TRIAL' },
      trialEndsAt: { before: null, after: trialEndsAt.toISOString() },
      priceMinor: { before: null, after: priceMinor },
      currency: { before: null, after: input.currency },
      period: { before: null, after: input.period },
    },
  });
  await applyMenuPlan(tx, work, input.restaurantId, input.applicationId, input.planCode);
  return { id: subscriptionId, trialEndsAt };
}

/**
 * Moves a subscription to another plan of its product, keeping its price or taking the new plan's. For the Menu, a
 * subscription that is live as of now also moves the restaurant's plan; a lapsed or cancelled one does not, so editing
 * an old row never changes what guests see.
 */
export async function changePlan(tx: ScopedTx, work: BillingWork, input: z.infer<typeof changePlanInput>, now: Date) {
  const sub = await loadSubscription(tx, input.subscriptionId);
  checkPlanCode(sub.applicationId as ApplicationId, input.planCode);
  if (input.planCode === sub.planCode) throw invalid('planCode', 'The subscription is already on this plan');
  const priceMinor = input.keepPrice ? sub.priceMinor : await planPrice(tx, sub.applicationId, input.planCode, sub.currency, sub.period);

  await updateWithVersion(tx.subscription, { id: sub.id, version: input.version, data: { planCode: input.planCode, priceMinor }, entityType: 'Subscription' }, tx);
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      type: 'PLAN_CHANGED',
      fromStatus: sub.status,
      toStatus: sub.status,
      data: { fromPlanCode: sub.planCode, toPlanCode: input.planCode, keepPrice: input.keepPrice, priceMinorBefore: sub.priceMinor, priceMinorAfter: priceMinor },
      actorId: work.actor.userId,
      occurredAt: now,
    },
  });
  work.audit({
    action: 'subscription.plan_changed',
    entityType: 'Subscription',
    entityId: sub.id,
    changes: { planCode: { before: sub.planCode, after: input.planCode }, priceMinor: { before: sub.priceMinor, after: priceMinor } },
  });
  if (isLive(effectiveStatus(sub, now))) await applyMenuPlan(tx, work, sub.restaurantId, sub.applicationId, input.planCode);
  return { id: sub.id };
}

export async function cancel(tx: ScopedTx, work: BillingWork, input: z.infer<typeof cancelInput>, now: Date) {
  const sub = await loadSubscription(tx, input.subscriptionId);
  if (!isLive(sub.status)) throw new StudioError('CONFLICT', 'Only a live subscription can be cancelled');
  // The stored status can lag a missed sweep: judge it as of now, so a lapsed row is not cancelled into a dead end.
  if (effectiveStatus(sub, now) === 'EXPIRED') throw new StudioError('CONFLICT', 'This subscription has already expired');

  await updateWithVersion(tx.subscription, { id: sub.id, version: input.version, data: { status: 'CANCELLED', cancelledAt: now }, entityType: 'Subscription' }, tx);
  await tx.subscriptionEvent.create({
    data: { subscriptionId: sub.id, type: 'CANCELLED', fromStatus: sub.status, toStatus: 'CANCELLED', data: { reason: input.reason }, actorId: work.actor.userId, occurredAt: now },
  });
  work.audit({
    action: 'subscription.cancelled',
    entityType: 'Subscription',
    entityId: sub.id,
    changes: { status: { before: sub.status, after: 'CANCELLED' }, cancelledAt: { before: null, after: now.toISOString() }, reason: { before: null, after: input.reason } },
  });
  return { id: sub.id };
}

export async function reactivate(tx: ScopedTx, work: BillingWork, input: z.infer<typeof reactivateInput>, now: Date) {
  const sub = await loadSubscription(tx, input.subscriptionId);
  if (sub.status !== 'CANCELLED') throw new StudioError('CONFLICT', 'Only a cancelled subscription can be reactivated');
  if (!(now < sub.currentPeriodEnd)) throw new StudioError('CONFLICT', 'What was paid for has ended. Record a payment to start a new period.');
  const other = await tx.subscription.findFirst({
    where: { applicationId: sub.applicationId, status: { in: LIVE }, id: { not: sub.id } },
    select: { id: true },
  });
  if (other) throw new StudioError('CONFLICT', SECOND_LIVE);

  // A trial that was never paid for comes back as the trial it was, never as a paid period.
  const to: SubscriptionStatus = sub.anchorDay === null && sub.trialEndsAt !== null ? 'TRIAL' : 'ACTIVE';
  try {
    await updateWithVersion(tx.subscription, { id: sub.id, version: input.version, data: { status: to, cancelledAt: null }, entityType: 'Subscription' }, tx);
  } catch (error) {
    if (isUniqueViolation(error)) throw new StudioError('CONFLICT', SECOND_LIVE);
    throw error;
  }
  await tx.subscriptionEvent.create({
    data: { subscriptionId: sub.id, type: 'REACTIVATED', fromStatus: 'CANCELLED', toStatus: to, data: {}, actorId: work.actor.userId, occurredAt: now },
  });
  work.audit({
    action: 'subscription.reactivated',
    entityType: 'Subscription',
    entityId: sub.id,
    changes: { status: { before: 'CANCELLED', after: to }, cancelledAt: { before: sub.cancelledAt?.toISOString() ?? null, after: null } },
  });
  // Live again: for the Menu, its plan (which may have been changed while it was cancelled) is what guests see.
  await applyMenuPlan(tx, work, sub.restaurantId, sub.applicationId, sub.planCode);
  return { id: sub.id, status: to };
  // As for a trial: a suspended or archived restaurant, or a product turned off, gets nothing live again.
  const restaurant = await tx.restaurant.findUnique({ where: { id: sub.restaurantId }, select: { status: true } });
  if (!restaurant) throw new StudioError('NOT_FOUND');
  if (restaurant.status !== 'ACTIVE') throw new StudioError('CONFLICT', REACTIVATE_RESTAURANT_NOT_ACTIVE);
  const application = await tx.application.findUnique({ where: { id: sub.applicationId }, select: { status: true } });
  if (!application) throw new StudioError('NOT_FOUND');
  if (application.status !== 'ACTIVE') throw new StudioError('CONFLICT', REACTIVATE_PRODUCT_DISABLED);
}

// Payments ------------------------------------------------------------------------------------------------------------

/** The day of the month of an instant on the Asia/Baghdad wall clock. */
const baghdadDay = (instant: Date): number => new Date(instant.getTime() + BAGHDAD_OFFSET_MS).getUTCDate();

export interface RecordedPayment {
  paymentId: string;
  subscription: { id: string; status: 'ACTIVE'; currentPeriodStart: Date; currentPeriodEnd: Date };
}

/** The result of an earlier recording of the same payment, rebuilt from its row: a repeat returns exactly this. */
function replay(payment: { id: string; subscriptionId: string; coversFrom: Date; coversTo: Date }): RecordedPayment {
  return {
    paymentId: payment.id,
    subscription: { id: payment.subscriptionId, status: 'ACTIVE', currentPeriodStart: payment.coversFrom, currentPeriodEnd: payment.coversTo },
  };
}

/** The payment already recorded under this key, as its first result; another subscription's key is `CONFLICT`. */
async function earlier(tx: ScopedTx, idempotencyKey: string, subscriptionId: string): Promise<RecordedPayment | null> {
  const found = await tx.payment.findUnique({ where: { idempotencyKey }, select: { id: true, subscriptionId: true, coversFrom: true, coversTo: true } });
  if (!found) return null;
  if (found.subscriptionId !== subscriptionId) throw new StudioError('CONFLICT', DUPLICATE_KEY);
  return replay(found);
}

/**
 * Records money the platform owner has received and extends the subscription by one full period. ACTIVE and GRACE
 * continue from the old end, so grace days are not free; TRIAL, EXPIRED and a CANCELLED one whose paid period has ended
 * start now on a new anchor. A CANCELLED one with paid time left is refused: reactivate it first. A repeated
 * `idempotencyKey` returns the first result and writes nothing.
 */
export async function recordPayment(tx: ScopedTx, work: BillingWork, input: z.infer<typeof paymentInput>, now: Date): Promise<RecordedPayment> {
  // The subscription is read before the key is looked up, and the order matters. Each statement sees what was committed
  // before it began, and a recording commits its payment and its extension together. So if a concurrent submission of
  // this payment committed before the read below, the lookup after it finds its payment; if it commits later, this read
  // holds the old version and the version-guarded update below refuses to extend twice.
  const sub = await tx.subscription.findUnique({ where: { id: input.subscriptionId } });
  const first = await earlier(tx, input.idempotencyKey, input.subscriptionId);
  if (first) return first;
  if (!sub) throw new StudioError('NOT_FOUND');
  // Cancelled while paid time is left: reactivating gives that time back, so a payment waits for it. Once the paid time
  // has run out there is nothing to reactivate, and a payment starts afresh as after expiry.
  const endedCancel = sub.status === 'CANCELLED' && now.getTime() >= sub.currentPeriodEnd.getTime();
  if (sub.status === 'CANCELLED' && !endedCancel) {
    throw new StudioError('CONFLICT', 'This subscription is cancelled. Reactivate it before recording a payment.');
  }
  if (input.paidAt.getTime() > now.getTime() + DAY_MS) throw invalid('paidAt', 'The payment date cannot be in the future');

  // A sweep may not have run yet: judge the subscription as of now, and write the steps it missed.
  const missed = lifecycleSteps(sub, now);
  const status = effectiveStatus(sub, now);
  const renewal = status === 'ACTIVE' || status === 'GRACE';
  const start = renewal ? sub.currentPeriodEnd : now;
  // A renewal keeps the anchor; a fresh start (from a trial or after expiry) anchors on its own day.
  const anchorDay = renewal ? (sub.anchorDay ?? baghdadDay(start)) : baghdadDay(start);
  const end = addPeriod(start, sub.period, anchorDay);

  if (!renewal) {
    // Restarting an expired (or ended, cancelled) subscription makes it live again: refused while the restaurant has a
    // newer live one for the same product.
    const other = await tx.subscription.findFirst({
      where: { applicationId: sub.applicationId, status: { in: LIVE }, id: { not: sub.id } },
      select: { id: true },
    });
    if (other) throw new StudioError('CONFLICT', SECOND_LIVE);
  }

  try {
    await updateWithVersion(
      tx.subscription,
      {
        id: sub.id,
        version: sub.version,
        data: { status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end, anchorDay, ...(endedCancel ? { cancelledAt: null } : {}) },
        entityType: 'Subscription',
      },
      tx,
    );
  } catch (error) {
    // "Subscription_live_key": another live subscription was started for this restaurant and product meanwhile.
    if (isUniqueViolation(error)) throw new StudioError('CONFLICT', SECOND_LIVE);
    // The row moved on while this ran. When it was this very payment, submitted twice at once, the first one has
    // committed by now (the update waited for its lock), so its result is what the second submission returns.
    if (error instanceof StudioError && error.code === 'CONFLICT') {
      const raced = await earlier(tx, input.idempotencyKey, input.subscriptionId);
      if (raced) return raced;
    }
    throw error;
  }

  let paymentId: string;
  try {
    const payment = await tx.payment.create({
      data: {
        subscriptionId: sub.id,
        restaurantId: sub.restaurantId,
        amountMinor: input.amountMinor,
        currency: sub.currency,
        method: input.method,
        reference: input.reference,
        paidAt: input.paidAt,
        coversFrom: start,
        coversTo: end,
        idempotencyKey: input.idempotencyKey,
        recordedById: work.actor.userId,
        note: input.note,
      },
      select: { id: true },
    });
    paymentId = payment.id;
  } catch (error) {
    // A repeat for this subscription is caught above (the lookup after the read, or the version update), so a clash here
    // is the key being used for another subscription (of this restaurant or another one). The transaction is aborted.
    if (isUniqueViolation(error)) throw new StudioError('CONFLICT', DUPLICATE_KEY);
    throw error;
  }

  await writeLifecycleEvents(tx, sub.id, missed, now);
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: sub.id,
      type: renewal ? 'RENEWED' : 'ACTIVATED',
      fromStatus: status,
      toStatus: 'ACTIVE',
      data: { paymentId, coversFrom: start.toISOString(), coversTo: end.toISOString() },
      actorId: work.actor.userId,
      // After the missed steps, so the history reads in order.
      occurredAt: missed.length > 0 ? new Date(now.getTime() + 1) : now,
    },
  });
  work.audit({
    action: 'payment.recorded',
    entityType: 'Payment',
    entityId: paymentId,
    changes: {
      subscriptionId: { before: null, after: sub.id },
      amountMinor: { before: null, after: input.amountMinor },
      currency: { before: null, after: sub.currency },
      method: { before: null, after: input.method },
      paidAt: { before: null, after: input.paidAt.toISOString() },
      status: { before: sub.status, after: 'ACTIVE' },
      currentPeriodEnd: { before: sub.currentPeriodEnd.toISOString(), after: end.toISOString() },
      anchorDay: { before: sub.anchorDay, after: anchorDay },
      ...(endedCancel ? { cancelledAt: { before: sub.cancelledAt?.toISOString() ?? null, after: null } } : {}),
    },
  });
  await applyMenuPlan(tx, work, sub.restaurantId, sub.applicationId, sub.planCode);
  return replay({ id: paymentId, subscriptionId: sub.id, coversFrom: start, coversTo: end });
}
