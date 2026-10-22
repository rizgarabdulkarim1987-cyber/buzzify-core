import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import type { ActionResult } from '@/server/studio/framework/result';
import {
  canStartTrial,
  currentSubscription,
  eventsNewestFirst,
  paymentRequest,
  pricesToSend,
  subscriptionActions,
  type BillingProduct,
  type RestaurantBillingView,
  type SubscriptionView,
} from '@/studio/billing';
import { describeFailure } from '@/studio/errors';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';
import { NETWORK_FAILURE, settle } from '@/studio/settle';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
const actions = vi.hoisted(() => ({
  setApplication: vi.fn(),
  setPrices: vi.fn(),
  startTrial: vi.fn(),
  changePlan: vi.fn(),
  cancelSubscription: vi.fn(),
  reactivateSubscription: vi.fn(),
  recordPayment: vi.fn(),
}));
vi.mock('@/app/studio/_actions/billing', () => actions);

const { BillingSettings } = await import('@/app/studio/(studio)/(app)/settings/billing/BillingSettings');
const { RestaurantBilling } = await import('@/app/studio/(studio)/(app)/restaurants/[id]/billing/RestaurantBilling');

const en = getStudioTranslator('en');

function render(element: ReactElement, locale: Locale = 'en'): string {
  // The children go as createElement's third argument; its props type still asks for them.
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  return renderToStaticMarkup(createElement(StudioI18nProvider, props, element));
}

const PLAN_NAMES = {
  BASIC: { en: 'Basic', ar: 'الأساسية', ckb: 'بنەڕەتی' },
  PRO: { en: 'Pro', ar: 'الاحترافية', ckb: 'پرۆ' },
  PREMIUM: { en: 'Premium', ar: 'المميزة', ckb: 'پرێمیەم' },
};

const PRODUCTS: BillingProduct[] = [
  {
    id: 'menu',
    name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' },
    status: 'ACTIVE',
    sortOrder: 1,
    plans: [
      { code: 'BASIC', prices: [] },
      {
        code: 'PRO',
        prices: [
          { currency: 'IQD', period: 'MONTHLY', amountMinor: 25000 },
          { currency: 'USD', period: 'MONTHLY', amountMinor: 1999 },
        ],
      },
      { code: 'PREMIUM', prices: [] },
    ],
  },
  { id: 'cashier', name: { en: 'Cashier', ar: 'الكاشير', ckb: 'کاشێر' }, status: 'DISABLED', sortOrder: 2, plans: [] },
];

const NOW = new Date('2026-10-23T09:00:00Z');

function subscription(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    id: 'sub-1',
    applicationId: 'menu',
    planCode: 'PRO',
    storedStatus: 'TRIAL',
    status: 'TRIAL',
    period: 'MONTHLY',
    currency: 'IQD',
    priceMinor: 25000,
    trialEndsAt: new Date('2026-10-31T22:30:00Z'),
    currentPeriodStart: new Date('2026-10-17T22:30:00Z'),
    // Half past ten at night in UTC is already the next day in Baghdad.
    currentPeriodEnd: new Date('2026-10-31T22:30:00Z'),
    anchorDay: null,
    graceDays: 7,
    cancelledAt: null,
    version: 1,
    events: [
      { id: 'e1', type: 'STARTED_TRIAL', fromStatus: null, toStatus: 'TRIAL', data: {}, actorName: 'Rizgar', occurredAt: new Date('2026-10-17T22:30:00Z') },
    ],
    ...overrides,
  } as SubscriptionView;
}

function view(overrides: Partial<RestaurantBillingView> = {}): RestaurantBillingView {
  return {
    restaurant: { id: 'r1', name: 'Zhamitos', status: 'ACTIVE', plan: 'PRO' },
    applications: [
      { id: 'menu', name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' }, status: 'ACTIVE', planCodes: ['BASIC', 'PRO', 'PREMIUM'] },
      { id: 'cashier', name: { en: 'Cashier', ar: 'الكاشير', ckb: 'کاشێر' }, status: 'DISABLED', planCodes: [] },
    ],
    subscriptions: [subscription()],
    payments: [],
    now: NOW,
    canEdit: true,
    ...overrides,
  } as RestaurantBillingView;
}

beforeEach(() => vi.clearAllMocks());

describe('Settings → Billing', () => {
  const settings = (canEdit: boolean, locale: Locale = 'en') =>
    render(createElement(BillingSettings, { products: PRODUCTS, planNames: PLAN_NAMES, canEdit }), locale);

  it('gives the platform owner the controls, with the stored prices in the major unit', () => {
    const html = settings(true);
    expect(html).toContain(en('billingSettings.savePrices', { product: 'Menu' }));
    expect(html).toContain(en('billingSettings.saveProduct', { product: 'Menu' }));
    expect(html).not.toContain(en('billingSettings.readOnly'));
    // PRO's IQD monthly is whole dinars; its USD monthly is dollars and cents.
    expect(html).toContain('value="25000"');
    expect(html).toContain('value="19.99"');
    // The plans are named as in Settings → Plans.
    expect(html).toContain('Premium');
    expect(html).not.toMatch(/<input[^>]* readOnly=""/);
  });

  it('shows another Super Admin the same page read-only', () => {
    const html = settings(false);
    expect(html).toContain(en('billingSettings.readOnly'));
    expect(html).not.toContain(en('billingSettings.savePrices', { product: 'Menu' }));
    expect(html).not.toContain(en('billingSettings.saveProduct', { product: 'Menu' }));
    expect(html).toContain('value="19.99"');
    expect(html).toMatch(/<input[^>]* readOnly=""/);
  });

  it('shows the Cashier with its status and the note that its plans come with it', () => {
    const html = settings(true);
    expect(html).toContain('Cashier');
    expect(html).toContain(en('billingSettings.noPlans'));
    expect(html).toContain(en('billingSettings.saveProduct', { product: 'Cashier' }));
  });

  it('reads right to left in Arabic and Sorani, with the product names of the language', () => {
    expect(settings(true, 'ar')).toContain('المنيو');
    expect(settings(false, 'ckb')).toContain(STUDIO_MESSAGES.ckb['billingSettings.readOnly']);
  });
});

describe('a restaurant’s Billing tab', () => {
  const tab = (data: RestaurantBillingView, locale: Locale = 'en') =>
    render(createElement(RestaurantBilling, { view: data, products: PRODUCTS, planNames: PLAN_NAMES }), locale);

  it('gives the platform owner the actions a trial takes, its plan, price and end on the Baghdad calendar', () => {
    const html = tab(view());
    expect(html).toContain(en('billing.recordPayment'));
    expect(html).toContain(en('billing.changePlan'));
    expect(html).toContain(en('billing.cancel'));
    expect(html).not.toContain(en('billing.startTrial'));
    expect(html).not.toContain(en('billing.reactivate'));
    expect(html).toContain(en('billing.status.TRIAL'));
    expect(html).toContain('Pro');
    expect(html).toContain('Nov 1, 2026');
    expect(html).toContain(en('billing.trialEnds'));
  });

  it('shows another Super Admin the same tab without a single control', () => {
    const html = tab(view({ canEdit: false }));
    expect(html).toContain(en('billing.readOnly'));
    for (const key of ['billing.recordPayment', 'billing.changePlan', 'billing.cancel', 'billing.startTrial', 'billing.reactivate']) {
      expect(html, key).not.toContain(`>${en(key)}<`);
    }
    expect(html).toContain(en('billing.status.TRIAL'));
  });

  it('offers a trial when the product has no live subscription, and none for the Cashier', () => {
    const html = tab(view({ subscriptions: [] }));
    expect(html.split(en('billing.startTrial')).length - 1).toBe(1);
    expect(html).toContain(en('billing.none'));
    expect(html).toContain(en('billingSettings.noPlans'));
  });

  it('offers no trial at a suspended restaurant, and says why', () => {
    const html = tab(view({ subscriptions: [], restaurant: { id: 'r1', name: 'Zhamitos', status: 'SUSPENDED', plan: 'PRO' } as RestaurantBillingView['restaurant'] }));
    expect(html).not.toContain(en('billing.startTrial'));
    expect(html).toContain(en('billing.trialRestaurantInactive'));
  });

  it('lists the payments and the history newest first', () => {
    const paid = subscription({
      status: 'ACTIVE',
      storedStatus: 'ACTIVE',
      anchorDay: 23,
      currentPeriodEnd: new Date('2026-11-23T09:00:00Z'),
      events: [
        { id: 'e1', type: 'STARTED_TRIAL', fromStatus: null, toStatus: 'TRIAL', data: {}, actorName: 'Rizgar', occurredAt: new Date('2026-10-17T09:00:00Z') },
        { id: 'e2', type: 'ACTIVATED', fromStatus: 'TRIAL', toStatus: 'ACTIVE', data: {}, actorName: 'Rizgar', occurredAt: new Date('2026-10-23T09:00:00Z') },
      ],
    } as Partial<SubscriptionView>);
    const html = tab(
      view({
        subscriptions: [paid],
        payments: [
          {
            id: 'p1',
            subscriptionId: 'sub-1',
            amountMinor: 25000,
            currency: 'IQD',
            method: 'CASH',
            reference: '',
            paidAt: new Date('2026-10-23T09:00:00Z'),
            coversFrom: new Date('2026-10-23T09:00:00Z'),
            coversTo: new Date('2026-11-23T09:00:00Z'),
            note: '',
            recordedByName: 'Rizgar',
            createdAt: new Date('2026-10-23T09:00:00Z'),
          },
        ] as RestaurantBillingView['payments'],
      }),
    );
    expect(html).toContain(en('billing.method.CASH'));
    expect(html).toContain('IQD');
    expect(html).toContain(en('billing.paidUntil'));
    expect(html).toContain(en('billing.graceEnds'));
    expect(html.indexOf(en('billing.event.ACTIVATED'))).toBeLessThan(html.indexOf(en('billing.event.STARTED_TRIAL')));
  });

  it('reads in Arabic and Sorani', () => {
    expect(tab(view(), 'ar')).toContain(STUDIO_MESSAGES.ar['billing.recordPayment']);
    expect(tab(view({ canEdit: false }), 'ckb')).toContain(STUDIO_MESSAGES.ckb['billing.readOnly']);
  });
});

describe('what a subscription can do', () => {
  const end = new Date('2026-11-01T00:00:00Z');
  it.each([
    ['TRIAL', end, { pay: true, changePlan: true, cancel: true, reactivate: false }],
    ['ACTIVE', end, { pay: true, changePlan: true, cancel: true, reactivate: false }],
    ['GRACE', new Date('2026-10-20T00:00:00Z'), { pay: true, changePlan: true, cancel: true, reactivate: false }],
    ['EXPIRED', new Date('2026-10-01T00:00:00Z'), { pay: true, changePlan: false, cancel: false, reactivate: false }],
    ['CANCELLED', end, { pay: false, changePlan: false, cancel: false, reactivate: true }],
    ['CANCELLED', new Date('2026-10-01T00:00:00Z'), { pay: true, changePlan: false, cancel: false, reactivate: false }],
  ] as const)('%s ending %s', (status, currentPeriodEnd, expected) => {
    expect(subscriptionActions({ status, currentPeriodEnd }, NOW, 3)).toEqual(expected);
  });

  it('has no plan to change to when the product sells one plan', () => {
    expect(subscriptionActions({ status: 'ACTIVE', currentPeriodEnd: end }, NOW, 1).changePlan).toBe(false);
  });

  it('starts a trial only for an offered product with plans, at an active restaurant with no live subscription', () => {
    const menu = { status: 'ACTIVE', planCodes: ['BASIC'] };
    expect(canStartTrial(menu, null, 'ACTIVE')).toBe(true);
    expect(canStartTrial(menu, { status: 'EXPIRED' }, 'ACTIVE')).toBe(true);
    expect(canStartTrial(menu, { status: 'GRACE' }, 'ACTIVE')).toBe(false);
    expect(canStartTrial(menu, null, 'SUSPENDED')).toBe(false);
    expect(canStartTrial({ status: 'DISABLED', planCodes: ['BASIC'] }, null, 'ACTIVE')).toBe(false);
    expect(canStartTrial({ status: 'ACTIVE', planCodes: [] }, null, 'ACTIVE')).toBe(false);
  });

  it('takes the live subscription as the current one, else the newest', () => {
    const old = subscription({ id: 'old', status: 'EXPIRED' });
    const live = subscription({ id: 'live', status: 'ACTIVE' });
    expect(currentSubscription([old, live], 'menu')?.id).toBe('live');
    expect(currentSubscription([old], 'menu')?.id).toBe('old');
    expect(currentSubscription([old], 'cashier')).toBeNull();
  });

  it('puts the events of every subscription of the product newest first', () => {
    const a = subscription({ id: 'a', events: [{ id: 'x', type: 'STARTED_TRIAL', fromStatus: null, toStatus: 'TRIAL', data: {}, actorName: null, occurredAt: new Date('2026-01-01') }] } as Partial<SubscriptionView>);
    const b = subscription({ id: 'b', events: [{ id: 'y', type: 'EXPIRED', fromStatus: 'TRIAL', toStatus: 'EXPIRED', data: {}, actorName: null, occurredAt: new Date('2026-02-01') }] } as Partial<SubscriptionView>);
    expect(eventsNewestFirst([a, b]).map((event) => event.id)).toEqual(['y', 'x']);
  });
});

describe('the payment form', () => {
  const sub = { id: 'sub-1', currency: 'USD' as const };
  const values = { amountMinor: '19.99', paidAt: '2026-10-23', method: 'CASH', reference: '', note: '' };

  it('sends USD with two decimals and IQD in whole dinars, as minor units', () => {
    const usd = paymentRequest(values, sub, 'r1', 'key');
    expect(usd.ok && usd.input.amountMinor).toBe(1999);
    const iqd = paymentRequest({ ...values, amountMinor: '25,000' }, { id: 'sub-1', currency: 'IQD' }, 'r1', 'key');
    expect(iqd.ok && iqd.input.amountMinor).toBe(25000);
    const arabic = paymentRequest({ ...values, amountMinor: '١٩٫٩٩' }, sub, 'r1', 'key');
    expect(arabic.ok && arabic.input.amountMinor).toBe(1999);
  });

  it('refuses fils, a third decimal, zero and a missing date before sending', () => {
    expect(paymentRequest({ ...values, amountMinor: '1.5' }, { id: 'sub-1', currency: 'IQD' }, 'r1', 'key')).toEqual({ ok: false, errors: { amountMinor: 'billing.amount.whole' } });
    expect(paymentRequest({ ...values, amountMinor: '1.999' }, sub, 'r1', 'key')).toEqual({ ok: false, errors: { amountMinor: 'billing.amount.cents' } });
    expect(paymentRequest({ ...values, amountMinor: '0' }, sub, 'r1', 'key')).toEqual({ ok: false, errors: { amountMinor: 'error.text.billingAmountPositive' } });
    expect(paymentRequest({ ...values, paidAt: '' }, sub, 'r1', 'key')).toEqual({ ok: false, errors: { paidAt: 'error.text.billingPaidAtEnter' } });
    for (const key of ['billing.amount.whole', 'billing.amount.cents']) expect(STUDIO_MESSAGES.en[key]).toBeTruthy();
  });

  it('dates the payment at noon in Baghdad on the day chosen, and says cash when no method is chosen', () => {
    const request = paymentRequest({ ...values, method: '' }, sub, 'r1', 'key');
    expect(request.ok && request.input.paidAt).toBe('2026-10-23T09:00:00.000Z');
    expect(request.ok && request.input.method).toBe('CASH');
  });

  it('keeps the idempotency key when the answer is lost and the payment is sent again', async () => {
    const key = crypto.randomUUID();
    actions.recordPayment.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true, data: { paymentId: 'p1' } });
    const send = async () => {
      const request = paymentRequest(values, sub, 'r1', key);
      if (!request.ok) throw new Error('the form refused its own values');
      return settle(() => actions.recordPayment(request.input) as Promise<ActionResult<{ paymentId: string }>>);
    };

    const lost = await send();
    expect(lost).toEqual({ ok: false, error: { code: 'INVALID', message: NETWORK_FAILURE } });
    expect(lost.ok ? null : describeFailure(en, 'en', lost.error).message).toBe(en('error.network'));
    expect(await send()).toEqual({ ok: true, data: { paymentId: 'p1' } });
    expect(actions.recordPayment.mock.calls.map(([input]) => (input as { idempotencyKey: string }).idempotencyKey)).toEqual([key, key]);
  });
});

describe('the price grid', () => {
  it('sends the typed prices in minor units and leaves empty cells out', () => {
    expect(pricesToSend({ 'IQD/MONTHLY': '25,000', 'IQD/YEARLY': '', 'USD/MONTHLY': '19.99', 'USD/YEARLY': '0' })).toEqual({
      ok: true,
      prices: [
        { currency: 'IQD', period: 'MONTHLY', amountMinor: 25000 },
        { currency: 'USD', period: 'MONTHLY', amountMinor: 1999 },
        { currency: 'USD', period: 'YEARLY', amountMinor: 0 },
      ],
    });
  });

  it('names each cell that cannot be read', () => {
    expect(pricesToSend({ 'IQD/MONTHLY': '25.5', 'USD/YEARLY': 'abc' })).toEqual({
      ok: false,
      errors: { 'IQD/MONTHLY': 'billing.amount.whole', 'USD/YEARLY': 'billing.amount.NOT_A_NUMBER' },
    });
  });
});
