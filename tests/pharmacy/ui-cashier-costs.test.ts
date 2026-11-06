// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * Cost and profit at the cashier (plan Task 7b). The lines' cost comes from the server (`ph.sell.costs`), which gives it only to
 * a role with `cost.view`: the screen asks only when it may show cost, once the cart has been still for a moment, and drops an
 * answer for a cart that has changed since. The table fills the cost and profit cells only from that answer; the details panel
 * shows the selected line's cost and profit.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/pharmacy/sell' }));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), sellInfo: vi.fn(), sellCosts: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn(), listSales: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const { SaleLinesTable } = await import('@/app/pharmacy/_ui/cashier/SaleLinesTable');
const { LinePanels } = await import('@/app/pharmacy/_ui/cashier/LinePanels');
const { COST_DEBOUNCE_MS, costLinesOf, useLineCosts } = await import('@/app/pharmacy/_ui/cashier/use-line-costs');
const { cartReducer, emptyCart, estimateCart } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
type AddableItem = import('@/app/pharmacy/_ui/sell-logic').AddableItem;
type CartState = import('@/app/pharmacy/_ui/sell-logic').CartState;
type LineCost = import('@/app/pharmacy/_ui/cashier/SaleLinesTable').LineCost;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement, locale: Locale = 'en') {
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
const byTest = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

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
  units: [{ id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '1500' }],
  batches: [{ batchId: 'b1', lot: 'L1', expiryDate: '2027-03-31', available: 40 }],
  ...over,
});
const cartOf = (qty = 2): CartState => {
  const one = cartReducer(emptyCart(), { type: 'add', item: item() });
  return cartReducer(one, { type: 'qty', key: one.lines[0]!.key, qty });
};
const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: true, controlledMaxQty: 10, creditEnabled: true };
const PERMS = { discount: true, batchOverride: false, rx: true, credit: false };
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');

function screen(cart: CartState, canSeeCost: boolean) {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: [{ ...newReceipt(), cart }], active: 0 }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, canSeeCost }));
}

/** Renders what the hook gives for a cart, as text. */
function Probe({ cart, enabled }: { cart: CartState; enabled: boolean }) {
  const costs = useLineCosts({ enabled, lines: cart.lines, results: estimateCart(cart, 'IQD', 0).lines, currency: 'IQD' });
  return createElement('output', { 'data-testid': 'probe' }, costs ? JSON.stringify(costs) : 'none');
}
const probe = () => byTest('probe')!.textContent;

beforeEach(() => {
  window.localStorage.clear();
  for (const fn of Object.values(sales)) fn.mockReset();
  sales.listHolds.mockResolvedValue({ ok: true, data: { items: [], hasMore: false } });
  sales.sellInfo.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('what the screen asks for (pure)', () => {
  it('sends each priced line with its unit price and its own discount, and skips a line that cannot be priced', () => {
    const cart = cartReducer(cartOf(2), { type: 'add', item: item({ productId: 'p2', units: [{ id: 'u', label: 'u', baseQty: 1, priceMinor: null }] }) });
    const lines = costLinesOf(cart.lines, estimateCart(cart, 'IQD', 0).lines);
    expect(lines).toEqual([{ key: cart.lines[0]!.key, productId: 'p1', unitId: 'tab', qty: 2, unitPriceMinor: '1500', discountMinor: '0' }]);
  });
});

describe('useLineCosts', () => {
  it('never asks without cost permission', async () => {
    mount(createElement(Probe, { cart: cartOf(), enabled: false }));
    await wait(COST_DEBOUNCE_MS + 50);
    expect(sales.sellCosts).not.toHaveBeenCalled();
    expect(probe()).toBe('none');
  });

  it('asks once the cart is still, and gives the cost and profit by line key', async () => {
    const cart = cartOf();
    const key = cart.lines[0]!.key;
    sales.sellCosts.mockResolvedValue({ ok: true, data: { lines: [{ key, costMinor: '1000', profitMinor: '2000' }] } });
    mount(createElement(Probe, { cart, enabled: true }));
    expect(sales.sellCosts).not.toHaveBeenCalled();
    await wait(COST_DEBOUNCE_MS + 50);
    expect(sales.sellCosts).toHaveBeenCalledTimes(1);
    expect(sales.sellCosts).toHaveBeenCalledWith({ currency: 'IQD', lines: [{ key, productId: 'p1', unitId: 'tab', qty: 2, unitPriceMinor: '1500', discountMinor: '0' }] });
    expect(JSON.parse(probe()!)).toEqual({ [key]: { costMinor: '1000', profitMinor: '2000' } });
  });

  it('drops an answer for a cart that changed meanwhile', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    sales.sellCosts.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const two = cartOf(2);
    const key = two.lines[0]!.key;
    mount(createElement(Probe, { cart: two, enabled: true }));
    await wait(COST_DEBOUNCE_MS + 50);
    mount(createElement(Probe, { cart: cartReducer(two, { type: 'qty', key, qty: 3 }), enabled: true }));
    await wait(COST_DEBOUNCE_MS + 50);
    expect(sales.sellCosts).toHaveBeenCalledTimes(2);
    second.resolve({ ok: true, data: { lines: [{ key, costMinor: '1500', profitMinor: '3000' }] } });
    await wait(0);
    first.resolve({ ok: true, data: { lines: [{ key, costMinor: '1000', profitMinor: '2000' }] } });
    await wait(0);
    expect(JSON.parse(probe()!)).toEqual({ [key]: { costMinor: '1500', profitMinor: '3000' } });
  });

  it('keeps a line whose cost is unknown out of the map, and a profit the role may not see out of it', async () => {
    const cart = cartReducer(cartOf(2), { type: 'add', item: item({ productId: 'p2' }) });
    const [a, b] = cart.lines.map((l) => l.key) as [string, string];
    sales.sellCosts.mockResolvedValue({ ok: true, data: { lines: [{ key: a, costMinor: null, profitMinor: null }, { key: b, costMinor: '700' }] } });
    mount(createElement(Probe, { cart, enabled: true }));
    await wait(COST_DEBOUNCE_MS + 50);
    expect(JSON.parse(probe()!)).toEqual({ [b]: { costMinor: '700' } });
  });
});

describe('the cost cells', () => {
  const table = (cart: CartState, costs?: Record<string, LineCost>) => {
    const estimate = estimateCart(cart, 'IQD', 0);
    return createElement(SaleLinesTable, { lines: cart.lines, results: estimate.lines, currency: 'IQD', selected: null, onSelect: () => {}, onRemove: () => {}, canSeeCost: true, canEditPrice: false, costs });
  };
  const cells = () => [...container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')].map((td) => td.textContent);

  it('stay empty without data and show cost and profit (a loss with its sign) with it', () => {
    const cart = cartOf();
    mount(table(cart));
    expect(cells().slice(13)).toEqual(['', '']);
    mount(table(cart, { [cart.lines[0]!.key]: { costMinor: '3500', profitMinor: '-500' } }));
    expect(cells()[13]).toBe('3,500');
    expect(cells()[14]).toMatch(/^-\s?500$/);
  });

  it('leave the profit empty when the role may not see it', () => {
    const cart = cartOf();
    mount(table(cart, { [cart.lines[0]!.key]: { costMinor: '3500' } }));
    expect(cells().slice(13)).toEqual(['3,500', '']);
  });
});

describe('the details panel', () => {
  it('shows the selected line cost and profit when the role may see cost', () => {
    const line = cartOf().lines[0]!;
    mount(createElement(LinePanels, { line, currency: 'IQD', canSeeCost: true, cost: { costMinor: '1200', profitMinor: '1800' }, onSubstitute: () => undefined }));
    // The info read fails here; the cost comes from the cart's own answer, so it still shows.
    expect(byTest('panel-cost')!.textContent).toContain('1,200');
    expect(byTest('panel-profit')!.textContent).toContain('1,800');
    expect(byTest('panel-cost-hidden')).toBeNull();
  });

  it('says hidden, with no number, for a role without cost', async () => {
    sales.sellInfo.mockResolvedValue({ ok: true, data: { productId: 'p1', currency: 'IQD', batches: [], details: { code: '', genericName: '', activeIngredient: '', lastSales: [], lastPurchase: null }, substitutes: [] } });
    const line = cartOf().lines[0]!;
    mount(createElement(LinePanels, { line, currency: 'IQD', canSeeCost: false, onSubstitute: () => undefined }));
    await wait(0);
    expect(byTest('panel-cost')).toBeNull();
    expect(byTest('panel-cost-hidden')).not.toBeNull();
  });
});

describe('the cashier screen', () => {
  it('never asks for cost for a role without it', async () => {
    screen(cartOf(), false);
    await wait(COST_DEBOUNCE_MS + 50);
    expect(sales.sellCosts).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Profit/);
  });

  it('fills the cost and profit cells from the server for a role with it', async () => {
    const cart = cartOf();
    sales.sellCosts.mockResolvedValue({ ok: true, data: { lines: [{ key: cart.lines[0]!.key, costMinor: '1000', profitMinor: '2000' }] } });
    screen(cart, true);
    await wait(COST_DEBOUNCE_MS + 50);
    await wait(0);
    const cells = [...container.querySelectorAll('tbody tr')[0]!.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells.slice(13)).toEqual(['1,000', '2,000']);
  });
});
