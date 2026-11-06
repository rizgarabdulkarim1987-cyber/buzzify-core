// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The cashier's sale-lines table (plan Task 7): the 13 columns of the spec (15 with cost and profit for those who may see
 * them), blocked lines marked inline, the selected row, a 200-line cart in its own scroll container, a long name that
 * truncates, and the line keys acting on the selected line in the screen.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/pharmacy/sell' }));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn(async () => ({ ok: true, data: { items: [], hasMore: false } })) }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const { SaleLinesTable } = await import('@/app/pharmacy/_ui/cashier/SaleLinesTable');
const { cartReducer, emptyCart, estimateCart } = await import('@/app/pharmacy/_ui/sell-logic');
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
const noop = () => {};
function table(cart: CartState, over: Partial<ComponentProps<typeof SaleLinesTable>> = {}) {
  const estimate = estimateCart(cart, 'IQD', 0);
  return createElement(SaleLinesTable, {
    lines: cart.lines,
    results: estimate.lines,
    currency: 'IQD',
    selected: null,
    onSelect: noop,
    onRemove: noop,
    canSeeCost: false,
    canEditPrice: false,
    ...over,
  });
}

describe('the sale-lines table', () => {
  it('has the 13 columns of the spec for a cashier', () => {
    mount(table(cartOf(item())));
    const heads = [...container.querySelectorAll('thead th')];
    expect(heads).toHaveLength(13);
    expect(heads[2]!.textContent).toBe('Item name');
    expect(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')).toHaveLength(13);
  });

  it('shows the Arabic labels of the prototype, in its order', () => {
    mount(table(cartOf(item())), 'ar');
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toEqual(['ت', 'رقم المادة', 'اسم المادة', 'العدد', 'الوحدة', 'سعر الوحدة', 'الكلي', 'الخصم', 'الوحدة بعد الخصم', 'الكلي بعد الخصم', 'الدفعة', 'الانتهاء', 'الرصيد']);
  });

  it('adds cost and profit (15 columns) only when canSeeCost', () => {
    const cart = cartOf(item());
    mount(table(cart, { canSeeCost: true }));
    expect(container.querySelectorAll('thead th')).toHaveLength(15);
    expect(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')).toHaveLength(15);
    mount(table(cart, { canSeeCost: false }));
    expect(container.querySelectorAll('thead th')).toHaveLength(13);
  });

  it('fills one line with its numbers: unit, price, total, batch, expiry, balance', () => {
    mount(table(cartOf(item())));
    const cells = [...container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells[0]).toBe('1');
    expect(cells[1]).toBe('6221010001');
    expect(cells[2]).toContain('Panadol');
    expect(cells[3]).toBe('1');
    expect(cells[4]).toBe('tablet');
    expect(cells[5]).toBe('1,500');
    expect(cells[6]).toBe('1,500');
    expect(cells[10]).toBe('L1');
    expect(cells[11]).toBe('03/2027');
    expect(cells[12]).toBe('100');
  });

  it('shows the dash for a line kept before codes existed', () => {
    const cart = cartOf(item());
    const old: CartState = { ...cart, lines: cart.lines.map((l) => ({ ...l, code: '' })) };
    mount(table(old));
    expect(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[1]!.textContent).toBe('—');
  });

  it('shows the unit price after discount exactly when it divides, else with ≈', () => {
    const exact = cartReducer(emptyCart(), { type: 'add', item: item(), qty: 3 });
    mount(table(exact));
    expect(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[8]!.textContent).toBe('1,500');
    const cut = { ...exact, lines: exact.lines.map((l) => ({ ...l, discount: { kind: 'amount' as const, value: '1' } })) };
    mount(table(cut));
    // 4,500 - 1 = 4,499 over 3 units: 1,499.67, shown rounded down with the approximate sign
    expect(container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')[8]!.textContent).toBe('≈ 1,499');
  });

  it('shows the balance in the unit of the line', () => {
    mount(table(cartReducer(emptyCart(), { type: 'add', item: item(), unitId: 'box' })));
    const cells = [...container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells[4]).toBe('box');
    expect(cells[12]).toBe('4');
  });

  it('marks a blocked line inline', () => {
    const cart = cartOf(item());
    const blocked: CartState = { ...cart, lines: cart.lines.map((l) => ({ ...l, blocked: 'GONE' as const })) };
    mount(table(blocked));
    expect(byTest('line-blocked')).not.toBeNull();
    expect(byTest('line-blocked')!.textContent!.length).toBeGreaterThan(3);
    expect(byTest('sale-line')!.getAttribute('data-blocked')).toBe('GONE');
  });

  it('marks a line over the stock it has', () => {
    mount(table(cartOf(item()), { over: new Set(['p1']) }));
    expect(byTest('line-over')).not.toBeNull();
  });

  it('puts aria-selected on the selected row only', () => {
    const cart = cartOf(item(), item({ productId: 'p2', tradeName: 'Aspirin' }));
    mount(table(cart, { selected: cart.lines[1]!.key }));
    const rows = allTest('sale-line');
    expect(rows.map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  it('selects a row on click and removes by its button', () => {
    const cart = cartOf(item());
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    mount(table(cart, { onSelect, onRemove }));
    act(() => byTest('sale-line')!.click());
    expect(onSelect).toHaveBeenCalledWith(cart.lines[0]!.key);
    act(() => byTest('line-remove')!.click());
    expect(onRemove).toHaveBeenCalledWith(cart.lines[0]!.key);
  });

  it('renders a 200-line cart inside its own scroll container', () => {
    let cart = emptyCart();
    for (let i = 0; i < 200; i += 1) cart = cartReducer(cart, { type: 'add', item: item({ productId: `p${i}`, tradeName: `Item ${i}` }) });
    mount(table(cart));
    expect(allTest('sale-line')).toHaveLength(200);
    const scroll = byTest('sale-lines-scroll')!;
    expect(scroll.className).toMatch(/overflow-auto/);
    expect(scroll.className).toMatch(/max-h-/);
    expect(scroll.contains(container.querySelector('table'))).toBe(true);
  });

  it('truncates a very long name without widening the table', () => {
    const name = 'Paracetamol '.repeat(40);
    mount(table(cartOf(item({ tradeName: name }))));
    const nameEl = byTest('line-name')!;
    expect(nameEl.className).toMatch(/\btruncate\b/);
    expect(nameEl.getAttribute('title')).toContain('Paracetamol');
    expect(container.querySelector('table')!.className).toMatch(/table-fixed/);
  });

  it('keeps the remove button at 44px and uses tabular figures', () => {
    mount(table(cartOf(item())));
    expect(byTest('line-remove')!.className).toMatch(/min-h-11/);
    expect(byTest('line-remove')!.className).toMatch(/min-w-11/);
    expect(container.querySelector('table')!.className).toMatch(/tabular-nums/);
  });
});

// The keys in the screen -----------------------------------------------------------------------------------------------

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
function screenWith(cart: CartState) {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: [{ ...newReceipt(), cart }], active: 0 }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, pulse: PULSE }));
}
const selectedName = () => container.querySelector('[data-testid="sale-line"][aria-selected="true"] [data-testid="line-name"]')?.textContent ?? null;
const qtys = () => allTest('sale-line').map((r) => r.querySelectorAll('td')[3]!.querySelector('input')?.value);
const three = () => cartOf(item({ productId: 'a', tradeName: 'Alpha' }), item({ productId: 'b', tradeName: 'Beta' }), item({ productId: 'c', tradeName: 'Gamma' }));

describe('the line keys in the cashier screen', () => {
  it('moves the selection with the arrows, stopping at both ends', () => {
    screenWith(three());
    expect(selectedName()).toBeNull();
    press({ key: 'ArrowDown' });
    expect(selectedName()).toBe('Alpha');
    press({ key: 'ArrowDown' });
    expect(selectedName()).toBe('Beta');
    press({ key: 'ArrowDown' });
    press({ key: 'ArrowDown' });
    expect(selectedName()).toBe('Gamma');
    press({ key: 'ArrowUp' });
    expect(selectedName()).toBe('Beta');
    press({ key: 'ArrowUp' });
    press({ key: 'ArrowUp' });
    expect(selectedName()).toBe('Alpha');
  });

  it('changes the selected line quantity by one with + and -, never below 1', () => {
    screenWith(three());
    press({ key: 'ArrowDown' });
    press({ key: 'ArrowDown' });
    press({ key: '+' });
    press({ key: '+' });
    expect(qtys()).toEqual(['1', '3', '1']);
    press({ key: '-' });
    press({ key: '-' });
    press({ key: '-' });
    expect(qtys()).toEqual(['1', '1', '1']);
  });

  it('removes the selected line with Delete and keeps a neighbour selected', () => {
    screenWith(three());
    press({ key: 'ArrowDown' });
    press({ key: 'ArrowDown' });
    press({ key: 'Delete' });
    expect(allTest('sale-line')).toHaveLength(2);
    expect(selectedName()).toBe('Gamma');
    press({ key: 'Delete' });
    expect(selectedName()).toBe('Alpha');
    press({ key: 'Delete' });
    expect(allTest('sale-line')).toHaveLength(0);
  });

  it('does not touch the lines while typing in the scan field', () => {
    screenWith(three());
    const search = byTest('cashier-search') as HTMLInputElement;
    press({ key: 'ArrowDown' }, search);
    press({ key: 'Delete' }, search);
    expect(allTest('sale-line')).toHaveLength(3);
    expect(selectedName()).toBeNull();
  });

  it('leaves the default alone for keys that do nothing now', () => {
    screenWith(cartOf());
    expect(press({ key: 'ArrowDown' }).defaultPrevented).toBe(false);
    expect(press({ key: '+' }).defaultPrevented).toBe(false);
    expect(press({ key: 'Delete' }).defaultPrevented).toBe(false);
    expect(press({ key: 'F2' }).defaultPrevented).toBe(false);
    expect(press({ key: 'F4' }).defaultPrevented).toBe(true);
  });

  it('prevents the default for a line key that acts', () => {
    screenWith(three());
    expect(press({ key: 'ArrowDown' }).defaultPrevented).toBe(true);
  });

  it('leaves the default alone for an arrow that cannot move', () => {
    screenWith(three());
    press({ key: 'ArrowDown' });
    expect(press({ key: 'ArrowUp' }).defaultPrevented).toBe(false);
    press({ key: 'ArrowDown' });
    press({ key: 'ArrowDown' });
    expect(selectedName()).toBe('Gamma');
    expect(press({ key: 'ArrowDown' }).defaultPrevented).toBe(false);
  });

  it('takes a key from the browser exactly when it did something (every wired key, none forgotten)', () => {
    screenWith(three());
    // Wired and acting: prevented. Not acting: left to the browser. A new wiring in run() is prevented by construction (run says true).
    // F3 (credit) needs the credit permission this screen does not have. F8 holds (its answer never comes here) and F9 opens the discount.
    sales.holdSale.mockReturnValue(new Promise(() => {}));
    expect(press({ key: 'F3' }).defaultPrevented, 'F3').toBe(false);
    for (const key of ['F9', 'F2', 'F6', 'F7']) expect(press({ key }).defaultPrevented, key).toBe(true);
    expect(press({ key: 'F8' }).defaultPrevented, 'F8').toBe(true);
    for (const key of ['ArrowDown', '+', '-']) expect(press({ key }).defaultPrevented, key).toBe(true);
    for (const key of ['/', 'Escape', 'F4']) expect(press({ key }).defaultPrevented, key).toBe(true);
  });
});
