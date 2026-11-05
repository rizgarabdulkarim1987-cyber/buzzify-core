// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The cashier's scan bar, unit button, side column and keypad (plan Task 8): the keypad sets the selected line's quantity,
 * the unit button converts (a button, never a dropdown) and says when there is nothing to convert to, the dollar figure is
 * total / rate, credit needs its permission, the digits read 1 2 3 left to right, and F6 / `*` act on the unit.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/pharmacy/sell' }));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/customers', () => ({ listCustomers: vi.fn(async () => ({ ok: true, data: { items: [] } })) }));

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const logic = await import('@/app/pharmacy/_ui/cashier/cashier-logic');
const { cartReducer, emptyCart } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
type AddableItem = import('@/app/pharmacy/_ui/sell-logic').AddableItem;
type CartState = import('@/app/pharmacy/_ui/sell-logic').CartState;

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
const click = (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  act(() => el!.click());
};

beforeEach(() => {
  window.localStorage.clear();
  sales.sellSearch.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const item = (over: Partial<AddableItem> = {}): AddableItem => ({
  productId: 'p1',
  tradeName: 'Panadol',
  code: '6221010001',
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
const cartOf = (...items: AddableItem[]): CartState => items.reduce((cart, it) => cartReducer(cart, { type: 'add', item: it }), emptyCart());

const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: false, controlledMaxQty: 0, creditEnabled: false };
const PERMS = { discount: true, batchOverride: false, rx: false, credit: false };
const PULSE = {
  shiftNetMinor: '0',
  receiptsDone: 0,
  drawerCashMinor: '0',
  nearExpiry: { count: 0, firstProductName: null, firstProductId: null },
  lowStock: { count: 0, firstProductName: null, firstProductId: null },
  usdRate: 1450,
};
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');
function screenWith(cart: CartState, over: Partial<ComponentProps<typeof CashierScreen>> = {}) {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: [{ ...newReceipt(), cart }], active: 0 }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, pulse: PULSE, ...over }));
}
const lineUnit = () => allTest('sale-line')[0]!.querySelectorAll('td')[4]!.textContent;
const lineQty = () => allTest('sale-line')[0]!.querySelectorAll('td')[3]!.textContent;
const selectFirst = () => press({ key: 'ArrowDown' });
const digit = (d: string) => click(allTest('key-digit').find((b) => b.textContent === d) ?? null);

describe('the pure side-column helpers', () => {
  it('builds the pad text: digits append, zeros lead nowhere, six at most, C clears', () => {
    expect(logic.padText('', '0')).toBe('');
    expect(logic.padText('', '1')).toBe('1');
    expect(logic.padText('1', '0')).toBe('10');
    expect(logic.padText('123456', '7')).toBe('123456');
    expect(logic.padText('12', 'C')).toBe('');
    expect(logic.padText('12', '.')).toBe('12');
  });

  it('computes the dollar figure as total / rate, only for a dinar sale with a rate', () => {
    expect(logic.usdEquivalent(14500n, 'IQD', 1450)).toBe('10.00');
    expect(logic.usdEquivalent(14500n, 'IQD', null)).toBeNull();
    expect(logic.usdEquivalent(14500n, 'IQD', 0)).toBeNull();
    expect(logic.usdEquivalent(1000n, 'USD', 1450)).toBeNull();
  });

  it('turns the next-item unit preference and picks the unit by size, a barcode-named unit winning', () => {
    expect(logic.nextScanUnitPref('default')).toBe('largest');
    expect(logic.nextScanUnitPref('largest')).toBe('smallest');
    expect(logic.nextScanUnitPref('smallest')).toBe('default');
    expect(logic.scanUnitId(item(), 'largest')).toBe('box');
    expect(logic.scanUnitId(item(), 'smallest')).toBe('tab');
    expect(logic.scanUnitId(item(), 'default')).toBeUndefined();
    expect(logic.scanUnitId(item({ matchedUnitId: 'tab' }), 'largest')).toBeUndefined();
  });
});

describe('the keypad', () => {
  it('sets the selected line quantity through parseQtyText when the enter key is pressed', () => {
    screenWith(cartOf(item()));
    selectFirst();
    digit('1');
    digit('2');
    expect(byTest('keypad-display')!.textContent).toBe('12');
    expect(lineQty()).toBe('1');
    click(byTest('keypad-enter'));
    expect(lineQty()).toBe('12');
    expect(byTest('keypad-display')!.textContent).toBe('');
  });

  it('clears with C and says so when no line is selected', () => {
    screenWith(cartOf(item()));
    digit('5');
    click(byTest('keypad-clear'));
    expect(byTest('keypad-display')!.textContent).toBe('');
    digit('5');
    click(byTest('keypad-enter'));
    expect(lineQty()).toBe('1');
    expect(byTest('cashier-message')!.textContent).toMatch(/line/i);
  });

  it('lays the digits out 1 2 3 left to right inside an ltr container, with 44px keys', () => {
    screenWith(cartOf(item()));
    const pad = byTest('keypad')!;
    expect(pad.closest('[dir="ltr"]')).not.toBeNull();
    expect(allTest('key-digit').map((b) => b.textContent).slice(0, 9)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(allTest('key-digit')[0]!.className).toMatch(/min-h-11/);
  });
});

describe('the unit button', () => {
  it('is a button, not a select, and shows the selected line unit and its price', () => {
    screenWith(cartOf(item()));
    expect(container.querySelector('select')).toBeNull();
    selectFirst();
    expect(byTest('unit-button')!.tagName).toBe('BUTTON');
    expect(byTest('unit-label')!.textContent).toBe('tablet');
    expect(byTest('unit-price')!.textContent).toMatch(/1,?500/);
  });

  it('changes the selected line to its next unit and shows the new unit price', () => {
    screenWith(cartOf(item()));
    selectFirst();
    expect(lineUnit()).toContain('tablet');
    click(byTest('unit-button'));
    expect(lineUnit()).toContain('box');
    expect(byTest('unit-label')!.textContent).toBe('box');
    expect(byTest('unit-price')!.textContent).toMatch(/3,?000/);
  });

  it('says there is nothing to cycle and leaves the line unchanged', () => {
    screenWith(cartOf(item({ units: [{ id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '1500' }, { id: 'box', label: 'box', baseQty: 24, priceMinor: null }] })));
    selectFirst();
    click(byTest('unit-button'));
    expect(lineUnit()).toContain('tablet');
    expect(byTest('cashier-message')!.textContent).toMatch(/no other/i);
  });

  it('with no line selected, turns the unit the next scanned item starts in', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [{ ...item(), matchedOn: 'barcode', notSellable: false, noPrice: false }] } });
    screenWith(emptyCart());
    expect(byTest('unit-label')!.textContent).toMatch(/default|usual/i);
    click(byTest('unit-button'));
    expect(byTest('unit-label')!.textContent).toMatch(/largest/i);
    const search = byTest('cashier-search') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(search, '6221010001');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(lineUnit()).toContain('box');
  });

  it('F6 and * cycle the unit, taking the key only when they acted', () => {
    screenWith(cartOf(item()));
    selectFirst();
    const f6 = press({ key: 'F6' });
    expect(f6.defaultPrevented).toBe(true);
    expect(lineUnit()).toContain('box');
    const star = press({ key: '*' });
    expect(star.defaultPrevented).toBe(true);
    expect(lineUnit()).toContain('tablet');
  });

  it('leaves * to the browser inside a filled search field', () => {
    screenWith(cartOf(item()));
    selectFirst();
    const search = byTest('cashier-search') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setValue.call(search, 'pana');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const star = press({ key: '*' }, search);
    expect(star.defaultPrevented).toBe(false);
    expect(lineUnit()).toContain('tablet');
  });
});

describe('the inquiry button', () => {
  it('only toggles a highlighted mode (F7 too)', () => {
    screenWith(cartOf(item()));
    expect(byTest('inquiry-button')!.getAttribute('aria-pressed')).toBe('false');
    expect(press({ key: 'F7' }).defaultPrevented).toBe(true);
    expect(byTest('inquiry-button')!.getAttribute('aria-pressed')).toBe('true');
    click(byTest('inquiry-button'));
    expect(byTest('inquiry-button')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the side column', () => {
  it('is the first grid child, with no dialog anywhere', () => {
    screenWith(cartOf(item()));
    const grid = byTest('cashier-grid')!;
    expect(grid.firstElementChild).toBe(byTest('cashier-side'));
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
  });

  it('shows the total, the dollar figure (total / rate), the discount, the count and the receipt number', () => {
    screenWith(cartOf(item(), item({ productId: 'p2', tradeName: 'Adol' })));
    // Two lines of 1,500 (the tablet) each.
    expect(byTest('cashier-total')!.textContent).toMatch(/3,?000/);
    expect(byTest('cashier-usd')!.textContent).toContain((3000 / 1450).toFixed(2));
    expect(byTest('cashier-count')!.textContent).toContain('2');
    expect(byTest('cashier-discount')).not.toBeNull();
    expect(byTest('receipt-no')!.textContent).toContain('1');
  });

  it('hides the dollar line without a pulse', () => {
    screenWith(cartOf(item()), { pulse: undefined as unknown as ComponentProps<typeof CashierScreen>['pulse'] });
    expect(byTest('cashier-usd')).toBeNull();
  });

  it('disables credit without the credit permission and enables it with it', () => {
    screenWith(cartOf(item()));
    expect((byTest('pay-credit') as HTMLButtonElement).disabled).toBe(true);
    expect(press({ key: 'F3' }).defaultPrevented).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    screenWith(cartOf(item()), { perms: { ...PERMS, credit: true } });
    expect((byTest('pay-credit') as HTMLButtonElement).disabled).toBe(false);
    expect(press({ key: 'F3' }).defaultPrevented).toBe(true);
    expect(byTest('pay-credit')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('F2 and the cash button set the cash flow and call no server action', () => {
    screenWith(cartOf(item()));
    expect(press({ key: 'F2' }).defaultPrevented).toBe(true);
    expect(byTest('pay-cash')!.getAttribute('aria-pressed')).toBe('true');
    expect(sales.createSale).not.toHaveBeenCalled();
    expect(sales.holdSale).not.toHaveBeenCalled();
  });

  it('leaves F2 to the browser when the receipt is empty', () => {
    screenWith(emptyCart());
    expect((byTest('pay-cash') as HTMLButtonElement).disabled).toBe(true);
    expect(press({ key: 'F2' }).defaultPrevented).toBe(false);
  });
});
