import type { Currency } from '@/server/domain/billing/money';
import { isLive, type SubscriptionStatus } from '@/server/domain/billing/subscriptions';
import type { billingOverview, billingRestaurants, restaurantBilling } from '@/server/studio/queries/billing';
import type { FormValues } from './forms';
import { parseAmountInput, type AmountInputProblem } from './money-input';
import type { StatusTone } from './ui/StatusBadge';

/**
 * What the Studio's billing pages (Settings → Billing and a restaurant's Billing tab) work out without the server: which
 * subscription is a product's current one, which actions it takes, and the inputs the forms send. The server checks all
 * of it again (src/server/studio/services/billing.ts).
 */

type Output<Q> = Q extends { run: (...args: never[]) => Promise<infer O> } ? O : never;

export type BillingOverview = Output<typeof billingOverview>;
export type RestaurantBillingView = Output<typeof restaurantBilling>;
export type BillingRestaurants = Output<typeof billingRestaurants>;
export type BillingProduct = BillingOverview['applications'][number];
export type SubscriptionView = RestaurantBillingView['subscriptions'][number];
export type PaymentView = RestaurantBillingView['payments'][number];
export type BillingEvent = SubscriptionView['events'][number];

// The server's lists (services/billing.ts), repeated here: that module reaches the database and never enters a page.
export const CURRENCIES = ['IQD', 'USD'] as const satisfies readonly Currency[];
export const PERIODS = ['MONTHLY', 'YEARLY'] as const;
export type Period = (typeof PERIODS)[number];
/** How the money reached the platform owner. Every payment is recorded by hand: the electronic names are labels only. */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'ZAINCASH', 'FIB', 'QI_CARD', 'OTHER'] as const;

/** A status as a badge: live and paid is green, overdue is red, a trial is black, the ended ones are grey. */
export const SUBSCRIPTION_TONE: Record<SubscriptionStatus, StatusTone> = {
  TRIAL: 'ink',
  ACTIVE: 'success',
  GRACE: 'danger',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
};

/** The product's subscription the tab is about: its live one, else its newest (the list comes newest first). */
export function currentSubscription(subscriptions: readonly SubscriptionView[], applicationId: string): SubscriptionView | null {
  const own = subscriptions.filter((sub) => sub.applicationId === applicationId);
  return own.find((sub) => isLive(sub.status)) ?? own[0] ?? null;
}

export interface SubscriptionActions {
  pay: boolean;
  changePlan: boolean;
  cancel: boolean;
  reactivate: boolean;
}

/**
 * What can be done to a subscription as of `now` (its `status` is already judged as of then). A cancelled one with paid
 * time left is reactivated, not paid; once that time has run out a payment starts it afresh, as after expiry.
 */
export function subscriptionActions(sub: Pick<SubscriptionView, 'status' | 'currentPeriodEnd'>, now: Date, planCount: number): SubscriptionActions {
  const live = isLive(sub.status);
  const periodEnded = now.getTime() >= new Date(sub.currentPeriodEnd).getTime();
  const cancelled = sub.status === 'CANCELLED';
  return {
    pay: !cancelled || periodEnded,
    changePlan: live && planCount > 1,
    cancel: live,
    reactivate: cancelled && !periodEnded,
  };
}

/** Whether a trial of the product can start: it is offered, has plans, the restaurant is active and has no live one. */
export function canStartTrial(
  product: { status: string; planCodes: readonly string[] },
  current: Pick<SubscriptionView, 'status'> | null,
  restaurantStatus: string,
): boolean {
  return product.status === 'ACTIVE' && product.planCodes.length > 0 && restaurantStatus === 'ACTIVE' && !(current && isLive(current.status));
}

/** The plan's price in a currency and period, from Settings → Billing; null when none is set. */
export function priceOf(product: BillingProduct | undefined, planCode: string, currency: Currency, period: Period): number | null {
  const plan = product?.plans.find((candidate) => candidate.code === planCode);
  return plan?.prices.find((price) => price.currency === currency && price.period === period)?.amountMinor ?? null;
}

/** The message key for an amount that cannot be read, worded for the way the currency's amounts are written. */
export function amountProblemKey(reason: AmountInputProblem, currency: Currency): string {
  if (reason === 'NOT_WHOLE' || (reason === 'TOO_PRECISE' && currency === 'IQD')) return 'billing.amount.whole';
  if (reason === 'TOO_PRECISE') return 'billing.amount.cents';
  if (reason === 'NOT_A_NUMBER') return currency === 'IQD' ? 'billing.amount.whole' : 'billing.amount.usdFormat';
  return `billing.amount.${reason}`;
}

const BAGHDAD_OFFSET_MS = 3 * 3_600_000;

/** Today's date on the Asia/Baghdad calendar (UTC+3, no daylight saving), as a date input writes it. */
export function baghdadToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}

/** Noon in Baghdad on a date input's day: the payment's moment, the same day wherever it is read. */
export function baghdadNoon(date: string): string {
  return new Date(`${date}T12:00:00+03:00`).toISOString();
}

export interface PaymentInput {
  restaurantId: string;
  subscriptionId: string;
  amountMinor: number;
  method: string;
  reference: string;
  paidAt: string;
  idempotencyKey: string;
  note: string;
}

/**
 * The payment form's values as the action's input, or messages (keys) by field. The amount is typed in the major unit
 * and sent in minor units; the key is the one made when the form opened, so every resend of this payment carries it.
 */
export function paymentRequest(
  values: FormValues,
  sub: { id: string; currency: Currency },
  restaurantId: string,
  idempotencyKey: string,
): { ok: true; input: PaymentInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const amount = parseAmountInput(values.amountMinor ?? '', sub.currency);
  if (!amount.ok) errors.amountMinor = amountProblemKey(amount.reason, sub.currency);
  else if (amount.minor === 0) errors.amountMinor = 'error.text.billingAmountPositive';
  const paidAt = (values.paidAt ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) errors.paidAt = 'error.text.billingPaidAtEnter';
  if (!amount.ok || Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      restaurantId,
      subscriptionId: sub.id,
      amountMinor: amount.minor,
      method: values.method || 'CASH',
      reference: values.reference ?? '',
      paidAt: baghdadNoon(paidAt),
      idempotencyKey,
      note: values.note ?? '',
    },
  };
}

/** One grid of a product's prices as typed: by plan code, then `CURRENCY/PERIOD`. Empty means not offered. */
export type PriceDraft = Record<string, Record<string, string>>;

export const priceCell = (currency: Currency, period: Period) => `${currency}/${period}`;

/** The stored prices as the grid shows them. */
export function priceDraft(product: BillingProduct, format: (minor: number, currency: Currency) => string): PriceDraft {
  return Object.fromEntries(
    product.plans.map((plan) => [
      plan.code,
      Object.fromEntries(
        CURRENCIES.flatMap((currency) =>
          PERIODS.map((period) => {
            const amount = plan.prices.find((price) => price.currency === currency && price.period === period)?.amountMinor;
            return [priceCell(currency, period), amount === undefined ? '' : format(amount, currency)];
          }),
        ),
      ),
    ]),
  );
}

/**
 * One plan's typed prices as the action's list (an empty cell is no price), or the problem keys by cell. Zero is a price
 * (free); a price below zero is not.
 */
export function pricesToSend(
  cells: Record<string, string>,
): { ok: true; prices: Array<{ currency: Currency; period: Period; amountMinor: number }> } | { ok: false; errors: Record<string, string> } {
  const prices: Array<{ currency: Currency; period: Period; amountMinor: number }> = [];
  const errors: Record<string, string> = {};
  for (const currency of CURRENCIES) {
    for (const period of PERIODS) {
      const cell = priceCell(currency, period);
      const text = (cells[cell] ?? '').trim();
      if (text === '') continue;
      const parsed = parseAmountInput(text, currency);
      if (parsed.ok) prices.push({ currency, period, amountMinor: parsed.minor });
      else errors[cell] = amountProblemKey(parsed.reason, currency);
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, prices };
}

/** Every event of the product's subscriptions, newest first. */
export function eventsNewestFirst(subscriptions: readonly SubscriptionView[]): Array<BillingEvent & { planCode: string }> {
  return subscriptions
    .flatMap((sub) => sub.events.map((event) => ({ ...event, planCode: sub.planCode })))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || (a.id < b.id ? 1 : -1));
}
