// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingProduct, RestaurantBillingView, SubscriptionView } from '@/studio/billing';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The billing pages mounted in a browser-like document and used as a person would: typing, clicking, sending. The static
 * renders of billing-ui.test.ts cannot show what a component keeps between two sends.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN_NAMES = {
  BASIC: { en: 'Basic', ar: 'الأساسية', ckb: 'بنەڕەتی' },
  PRO: { en: 'Pro', ar: 'الاحترافية', ckb: 'پرۆ' },
  PREMIUM: { en: 'Premium', ar: 'المميزة', ckb: 'پرێمیەم' },
};

const MENU: BillingProduct = {
  id: 'menu',
  name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' },
  status: 'ACTIVE',
  sortOrder: 1,
  plans: [
    { code: 'BASIC', prices: [] },
    { code: 'PRO', prices: [{ currency: 'IQD', period: 'MONTHLY', amountMinor: 25000 }] },
    { code: 'PREMIUM', prices: [] },
  ],
};

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement) {
  const props = { locale: 'en', messages: STUDIO_MESSAGES.en } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}

/** Types into a controlled input the way a keystroke does, so React's onChange sees it. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

const byLabel = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

describe('a price save refused partway', () => {
  it('keeps the refusal and what was typed: the page is not refreshed, so the section is not remounted', async () => {
    // The first plan saves, the second is refused.
    actions.setPrices
      .mockResolvedValueOnce({ ok: true, data: {} })
      .mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'Someone else changed this. Reload to see it.' } });
    mount(createElement(BillingSettings, { products: [MENU], planNames: PLAN_NAMES, canEdit: true }));

    const label = (plan: string) => en('billingSettings.priceLabel', { plan, currency: 'IQD', period: en('billing.period.MONTHLY') });
    type(byLabel(label('Basic')), '10.000');
    type(byLabel(label('Pro')), '30.000');
    await click(button(en('billingSettings.savePrices', { product: 'Menu' })));

    expect(actions.setPrices).toHaveBeenCalledTimes(2);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(byLabel(label('Pro')).value).toBe('30.000');

    // A retry sends both again (saving the first plan's prices again changes nothing), then the page is refreshed.
    actions.setPrices.mockResolvedValue({ ok: true, data: {} });
    await click(button(en('billingSettings.savePrices', { product: 'Menu' })));
    expect(actions.setPrices).toHaveBeenCalledTimes(4);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('the payment dialog', () => {
  const subscription = {
    id: 'sub-1',
    applicationId: 'menu',
    planCode: 'PRO',
    storedStatus: 'ACTIVE',
    status: 'ACTIVE',
    period: 'MONTHLY',
    currency: 'IQD',
    priceMinor: 25000,
    trialEndsAt: null,
    currentPeriodStart: new Date('2026-10-01T09:00:00Z'),
    currentPeriodEnd: new Date('2026-11-01T09:00:00Z'),
    anchorDay: 1,
    graceDays: 7,
    cancelledAt: null,
    version: 3,
    events: [],
  } as unknown as SubscriptionView;
  const view = {
    restaurant: { id: 'r1', name: 'Zhamitos', status: 'ACTIVE', plan: 'PRO' },
    applications: [{ id: 'menu', name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' }, status: 'ACTIVE', planCodes: ['BASIC', 'PRO', 'PREMIUM'] }],
    subscriptions: [subscription],
    payments: [],
    now: new Date('2026-10-23T09:00:00Z'),
    canEdit: true,
  } as unknown as RestaurantBillingView;

  it('sends its own idempotency key again when the first answer is lost, and the amount in minor units', async () => {
    actions.recordPayment.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: true, data: { paymentId: 'p1' } });
    mount(createElement(RestaurantBilling, { view, products: [MENU], planNames: PLAN_NAMES }));
    await click(button(en('billing.recordPayment')));

    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    expect(form).toBeTruthy();
    const send = async () => {
      await act(async () => {
        form.requestSubmit();
      });
    };
    await send();
    // The lost answer leaves the dialog open with the network message.
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(en('error.network'));
    await send();

    const sent = actions.recordPayment.mock.calls.map(([input]) => input as { idempotencyKey: string; amountMinor: unknown });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[1]!.idempotencyKey).toBe(sent[0]!.idempotencyKey);
    expect(sent.map((input) => input.amountMinor)).toEqual([25000, 25000]);
  });
});
