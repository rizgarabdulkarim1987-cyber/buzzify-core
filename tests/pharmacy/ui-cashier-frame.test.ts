// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The cashier frame (plan Task 6): the open-receipt tabs, the header chips, the keys that switch receipts, the side column
 * first in the grid (so it sits on the physical right in RTL), no dialog anywhere, and the old single-cart draft moved into
 * the receipts once. The Server Actions are stood in for; nothing here talks to a database.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/pharmacy/sell' }));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const logic = await import('@/app/pharmacy/_ui/cashier/cashier-logic');
const { cartReducer, draftKey, emptyCart, serializeDraft } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
type AddableItem = import('@/app/pharmacy/_ui/sell-logic').AddableItem;
type OpenReceipt = import('@/app/pharmacy/_ui/sell-receipts').OpenReceipt;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement, locale: Locale = 'en') {
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
const byTest = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allTest = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Fixtures ----------------------------------------------------------------------------------------------------------------

const item = (over: Partial<AddableItem> = {}): AddableItem => ({
  productId: 'p1',
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  packLabel: 'box of 24',
  rxLevel: 'OTC',
  matchedUnitId: null,
  sellableQty: 100,
  units: [
    { id: 'box', label: 'box', baseQty: 24, priceMinor: '3000' },
    { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '1500' },
  ],
  batches: [{ batchId: 'b1', lot: 'L1', expiryDate: '2027-03-31', available: 40 }],
  ...over,
});

const PLACE = { restaurantId: 'r1', branchId: 'b1', userId: 'u1' };
const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: false, controlledMaxQty: 0, creditEnabled: false };
const PERMS = { discount: true, batchOverride: false, rx: false, credit: false };
const PULSE = {
  shiftNetMinor: '125000',
  receiptsDone: 7,
  drawerCashMinor: '90000',
  nearExpiry: { count: 3, firstProductName: 'Betadine 10% solution', firstProductId: 'p9' },
  lowStock: { count: 2, firstProductName: 'Panadol Extra', firstProductId: 'p8' },
  usdRate: 1450,
};

const screen = (over: Partial<ComponentProps<typeof CashierScreen>> = {}) => createElement(CashierScreen, { ...PLACE, shift: SHIFT, settings: SETTINGS, perms: PERMS, pulse: PULSE, ...over });

const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');
const LEGACY = draftKey('r1', 'b1', 'u1', 'IQD');
const filled = (qty = 1): OpenReceipt => ({ ...newReceipt(), cart: cartReducer(emptyCart(), { type: 'add', item: item(), qty }) });
const store = (receipts: OpenReceipt[], active = 0) => window.localStorage.setItem(STORE, serializeReceipts({ receipts, active }));
const tabs = () => allTest('receipt-tab');

// The tabs ------------------------------------------------------------------------------------------------------------------

describe('the receipt tabs', () => {
  it('shows one tab per open receipt with its number, running total and item count', () => {
    store([filled(2), newReceipt(), filled(1)], 0);
    mount(screen());
    expect(tabs()).toHaveLength(3);
    expect(tabs()[0]!.textContent).toContain('1');
    expect(tabs()[0]!.textContent).toContain('3,000');
    expect(tabs()[0]!.textContent).toContain('1 item');
    expect(tabs()[1]!.textContent).toContain('Empty');
    expect(tabs()[2]!.textContent).toContain('1,500');
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(byTest('receipt-tabs')!.getAttribute('role')).toBe('tablist');
  });

  it('offers ＋ below six receipts and none at six', () => {
    store([newReceipt(), newReceipt(), newReceipt()]);
    mount(screen());
    expect(byTest('receipt-new')).not.toBeNull();
    act(() => byTest('receipt-new')!.click());
    expect(tabs()).toHaveLength(4);
    expect(tabs()[3]!.getAttribute('aria-selected')).toBe('true');
  });

  it('has no ＋ at six open receipts, and F4 there says the limit inline', () => {
    store(Array.from({ length: 6 }, () => newReceipt()));
    mount(screen());
    expect(tabs()).toHaveLength(6);
    expect(byTest('receipt-new')).toBeNull();
    const event = press({ key: 'F4' });
    expect(event.defaultPrevented).toBe(true);
    expect(tabs()).toHaveLength(6);
    expect(byTest('cashier-message')!.textContent).toContain('6');
  });

  it('disables the X of a receipt with items and closes an empty one', () => {
    store([filled(), newReceipt()]);
    mount(screen());
    const closes = allTest('receipt-close') as HTMLButtonElement[];
    expect(closes[0]!.disabled).toBe(true);
    expect(closes[1]!.disabled).toBe(false);
    act(() => closes[1]!.click());
    expect(tabs()).toHaveLength(1);
  });

  it('switches with Alt+2 and Alt+Arrow (left is next in RTL), and keeps the choice on the device', () => {
    store([newReceipt(), newReceipt(), newReceipt()]);
    mount(screen());
    const event = press({ key: '2', altKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    press({ key: 'ArrowLeft', altKey: true });
    expect(tabs()[2]!.getAttribute('aria-selected')).toBe('true');
    press({ key: 'ArrowRight', altKey: true });
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(JSON.parse(window.localStorage.getItem(STORE)!).active).toBe(1);
  });

  it('switches by click', () => {
    store([newReceipt(), newReceipt()]);
    mount(screen());
    act(() => tabs()[1]!.click());
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
  });
});

// Keys --------------------------------------------------------------------------------------------------------------------

describe('the cashier keys', () => {
  it('prevents the browser default for every function key the cashier uses', () => {
    mount(screen());
    for (const key of ['F2', 'F3', 'F6', 'F7', 'F8', 'F9']) expect(press({ key }).defaultPrevented, key).toBe(true);
    expect(press({ key: 'F5' }).defaultPrevented).toBe(false);
  });

  it('reads an empty search from the field itself at the moment of the key', () => {
    mount(screen());
    const search = byTest('cashier-search') as HTMLInputElement;
    // The value is in the field but React has not been told yet: `/` must still count as typed text, not focus-scan.
    search.value = 'pan';
    expect(logic.keyContextOf(search, search).searchEmpty).toBe(false);
    search.value = '';
    expect(logic.keyContextOf(search, search)).toEqual({ inSearch: true, inTextField: true, searchEmpty: true, modalOpen: false });
    expect(logic.keyContextOf(document.body, search).inTextField).toBe(false);
  });

  it('focuses the scan field with / outside a text field', () => {
    mount(screen());
    (document.activeElement as HTMLElement | null)?.blur();
    const event = press({ key: '/' }, document.body);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byTest('cashier-search'));
  });
});

// Layout ------------------------------------------------------------------------------------------------------------------

describe('the frame', () => {
  it('puts the side column first in the grid (physically right in RTL) and opens no dialog', () => {
    mount(screen(), 'ar');
    const grid = byTest('cashier-grid')!;
    expect(grid.firstElementChild?.getAttribute('data-testid')).toBe('cashier-side');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('dialog')).toBeNull();
  });

  it('gates on an open shift', () => {
    mount(screen({ shift: null }));
    expect(byTest('open-shift')).not.toBeNull();
    expect(byTest('cashier-grid')).toBeNull();
  });
});

// Header chips ------------------------------------------------------------------------------------------------------------

describe('the header chips', () => {
  it('shows the six chips and the dollar rate', () => {
    mount(screen());
    expect(container.querySelectorAll('[data-pulse-chip]')).toHaveLength(6);
    expect(byTest('pulse')!.textContent).toContain('125,000');
    expect(byTest('pulse')!.textContent).toContain('7');
    expect(byTest('pulse')!.textContent).toContain('90,000');
    expect(byTest('pulse-rate')!.textContent).toContain('1450');
  });

  it('puts the warned product name in the search field when its chip is clicked', () => {
    mount(screen());
    act(() => byTest('pulse-near-expiry')!.click());
    expect((byTest('cashier-search') as HTMLInputElement).value).toBe('Betadine 10% solution');
    act(() => byTest('pulse-low-stock')!.click());
    expect((byTest('cashier-search') as HTMLInputElement).value).toBe('Panadol Extra');
  });

  it('a warning chip with nothing to warn about is not a button', () => {
    mount(screen({ pulse: { ...PULSE, lowStock: { count: 0, firstProductName: null, firstProductId: null } } }));
    expect(byTest('pulse-low-stock')!.tagName).not.toBe('BUTTON');
  });
});

// The old single-cart draft -----------------------------------------------------------------------------------------------

describe('the old single-cart draft', () => {
  const legacy = (attempt: unknown = null) => {
    const raw = JSON.parse(serializeDraft('IQD', filled(3).cart, null, 'hold-1', null)) as Record<string, unknown>;
    return JSON.stringify({ ...raw, attempt });
  };
  const ATTEMPT = { sig: 's', key: 'sale-key-12345', paymentKey: 'pay-key-12345', method: 'CASH', amountMinor: '4500', reference: '', fromHoldId: null };

  it('is migrated only when no sale was in flight', () => {
    expect(logic.migratableDraft(legacy())).toBe(legacy());
    expect(logic.migratableDraft(legacy(ATTEMPT))).toBeNull();
    expect(logic.migratableDraft('not json')).toBeNull();
    expect(logic.migratableDraft(null)).toBeNull();
  });

  it('restores into receipt 1 and says so; a stored set of receipts wins over it', () => {
    const moved = logic.restoreReceipts(null, legacy());
    expect(moved.migrated).toBe(true);
    expect(moved.state.receipts[0]!.cart.lines[0]!.qty).toBe(3);
    expect(moved.state.receipts[0]!.fromHoldId).toBe('hold-1');
    const own = serializeReceipts({ receipts: [filled(1), newReceipt()], active: 1 });
    const kept = logic.restoreReceipts(own, legacy());
    expect(kept.migrated).toBe(false);
    expect(kept.state.receipts).toHaveLength(2);
    expect(logic.restoreReceipts(null, legacy(ATTEMPT)).migrated).toBe(false);
  });

  it('the screen moves it into the tabs and deletes the old key so it cannot come back', () => {
    window.localStorage.setItem(LEGACY, legacy());
    mount(screen());
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.textContent).toContain('4,500');
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
    expect(byTest('cashier-restored')).not.toBeNull();
  });

  it('leaves a draft with a sale in flight to the old screen', () => {
    window.localStorage.setItem(LEGACY, legacy(ATTEMPT));
    mount(screen());
    expect(tabs()[0]!.textContent).toContain('Empty');
    expect(window.localStorage.getItem(LEGACY)).not.toBeNull();
  });
});
