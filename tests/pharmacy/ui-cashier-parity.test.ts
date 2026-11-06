// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * Parity of the cashier with the old sale screen it replaces on /sell (plan Task 11): every behaviour the old screen had that the
 * new one lacked is asserted here (see .superpowers/sdd/2026-11-05-pharmacy-cashier-and-fast-entry/task-11-parity.md), with the
 * minor findings carried from Task 10 (the return slip prints once; a refused Retry of a return says why; the header figures are
 * read again after a return).
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/pharmacy/sell' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), sellInfo: vi.fn(), sellCosts: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn(), listSales: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
const returns = vi.hoisted(() => ({ returnableLines: vi.fn(), returnPreview: vi.fn(), createReturn: vi.fn(), cancelSale: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/returns', () => returns);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/customers', () => ({ listCustomers: vi.fn(async () => ({ ok: true, data: { items: [] } })), getCustomer: vi.fn() }));
const receipts = vi.hoisted(() => ({ saleReceipt: vi.fn(), reprintReceipt: vi.fn(), returnSlip: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/receipts', () => receipts);
vi.mock('@/app/pharmacy/_actions/prescriptions', () => ({ createPrescription: vi.fn(), getPrescription: vi.fn() }));
const print = vi.hoisted(() => ({ getPrintSettings: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/print', () => print);
const bridge = vi.hoisted(() => ({ printDoc: vi.fn(async () => ({ ok: true })), kickDrawer: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/app/pos/_ui/print/print-client', () => bridge);

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const { cartReducer, emptyCart } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
const { buildReceipt } = await import('@/server/domain/pharmacy/receipt');
type AddableItem = import('@/app/pharmacy/_ui/sell-logic').AddableItem;
type CartState = import('@/app/pharmacy/_ui/sell-logic').CartState;
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
const click = (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  act(() => el!.click());
};
const typeIn = (testId: string, text: string) => {
  const field = byTest(testId) as HTMLInputElement;
  expect(field).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await tick();
};
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const flowOf = () => byTest('work-panel')!.getAttribute('data-flow');
const message = () => byTest('cashier-message')?.textContent ?? '';
const enter = () => press({ key: 'Enter' }, byTest('cashier-search')!);

const BATCHES = [
  { batchId: 'b1', lot: 'L1', expiryDate: '2026-12-31', available: 5 },
  { batchId: 'b2', lot: 'L2', expiryDate: '2027-03-31', available: 20 },
];
const item = (over: Partial<AddableItem> = {}): AddableItem => ({
  productId: 'p1',
  tradeName: 'Panadol',
  code: '6221010001',
  strength: '500 mg',
  form: 'tablet',
  packLabel: 'strip',
  rxLevel: 'OTC',
  matchedUnitId: null,
  sellableQty: 25,
  units: [{ id: 'strip', label: 'strip', baseQty: 1, priceMinor: '1500' }],
  batches: BATCHES,
  ...over,
});
const sellItem = (over: Partial<AddableItem> & { notSellable?: boolean; noPrice?: boolean; matchedOn?: string } = {}) => ({ genericName: '', matchedOn: 'tradeName', notSellable: false, noPrice: false, ...item(over), ...over });
const INFO = (productId = 'p1') => ({
  ok: true,
  data: {
    productId,
    currency: 'IQD',
    batches: [
      { batchId: 'b1', lot: 'L1', expiryDate: '2026-12-31', expiryPrecision: 'MONTH', available: 5, expired: false, near: true, sellable: true },
      { batchId: 'b2', lot: 'L2', expiryDate: '2027-03-31', expiryPrecision: 'MONTH', available: 20, expired: false, near: false, sellable: true },
    ],
    details: { code: '6221010001', genericName: 'Paracetamol', activeIngredient: 'Paracetamol', lastSales: [], lastPurchase: null },
    substitutes: [],
  },
});
const cartOf = (qty = 3): CartState => {
  const one = cartReducer(emptyCart(), { type: 'add', item: item() });
  return cartReducer(one, { type: 'qty', key: one.lines[0]!.key, qty });
};
const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: true, controlledMaxQty: 10, creditEnabled: true };
const PERMS = { discount: true, batchOverride: false, rx: true, credit: false };
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');

function screenWith(list: Partial<OpenReceipt>[], over: Partial<ComponentProps<typeof CashierScreen>> = {}) {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: list.map((r) => ({ ...newReceipt(), cart: cartOf(), ...r })), active: 0 }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, ...over }));
}
const stored = () => JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as { receipts: OpenReceipt[]; active: number };

const WORKSTATION = {
  paper: 'A4',
  marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
  labelSize: '50x30',
  showPrice: true,
  receiptPrinter: { transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2, drawerOnCash: true },
};
const slipModel = () =>
  buildReceipt(
    { kind: 'return', ret: { number: 'R-1', saleNumber: 'S-77', currency: 'IQD', at: new Date('2026-11-05T09:00:00Z'), refundMinor: 1500n, refundMethod: 'CASH', approverName: 'Sara', lines: [{ name: 'Panadol', strength: '500 mg', baseQty: 10, refundMinor: 1500n, rxLevel: 'OTC' }] } },
    { width: '80', locale: 'en', copy: false, shop: { name: 'Shop' } },
  );
const RETURNABLE = {
  saleId: 'sale-77',
  number: 'S-77',
  status: 'COMPLETED',
  currency: 'IQD',
  totalMinor: '4500',
  refundedMinor: '0',
  returnable: true,
  window: { withinWindow: true, days: 14, needsManager: false, mayOverride: true },
  paidMethods: ['CASH'],
  onAccount: false,
  defaultRefundMethod: 'CASH',
  lines: [{ id: 'sl1', lineNo: 1, productId: 'p1', productName: 'Panadol', unitId: 'strip', unitLabel: 'strip', soldBaseQty: 30, returnedBaseQty: 10, remainingBaseQty: 20, unitPriceMinor: '1500', refundPerUnitPreviewMinor: '150', allocations: [] }],
};
const RETURN_DONE = { id: 'ret-1', number: 'R-1', saleId: 'sale-77', branchId: 'b1', currency: 'IQD', refundMinor: '1500', creditMinor: '0', refundMethod: 'CASH', saleStatus: 'RETURNED_PARTIAL', lineCount: 1, createdAt: '2026-11-05T09:00:00Z', replayed: false };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('ph.print.workstation', 'Counter 1');
  window.history.replaceState({}, '', '/pharmacy/sell');
  for (const fn of [...Object.values(sales), ...Object.values(returns), ...Object.values(receipts), nav.refresh, bridge.printDoc, bridge.kickDrawer]) fn.mockReset();
  sales.listHolds.mockResolvedValue({ ok: true, data: { items: [], hasMore: false } });
  sales.sellInfo.mockImplementation(async ({ productId }: { productId: string }) => INFO(productId));
  bridge.printDoc.mockResolvedValue({ ok: true });
  bridge.kickDrawer.mockResolvedValue({ ok: true });
  print.getPrintSettings.mockResolvedValue({ ok: true, data: { print: { workstations: { 'Counter 1': WORKSTATION } } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// A barcode that matches several products ---------------------------------------------------------------------------------

describe('a barcode that matches several products (old scan "pick")', () => {
  const TWO = [sellItem({ matchedOn: 'barcode' }), sellItem({ productId: 'p2', tradeName: 'Panadol Extra', matchedOn: 'barcode' })];

  it('lists the matches to choose from, inline, and adds the one chosen', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: TWO } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', '6221010001');
    enter();
    await flush();
    expect(message()).toContain('matches several products');
    const rows = allTest('suggestion');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Panadol'), expect.stringContaining('Panadol Extra')]);
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
    click(rows[1]!);
    expect(stored().receipts[0]!.cart.lines.map((l) => l.productId)).toEqual(['p2']);
    expect(allTest('suggestion')).toHaveLength(0);
  });

  it('closes the list with Escape and adds nothing', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: TWO } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', '6221010001');
    enter();
    await flush();
    expect(allTest('suggestion')).toHaveLength(2);
    press({ key: 'Escape' }, byTest('cashier-search')!);
    expect(allTest('suggestion')).toHaveLength(0);
    expect(stored().receipts[0]!.cart.lines).toHaveLength(0);
  });
});

// Choosing the batch (batch.override) ---------------------------------------------------------------------------------------

describe('choosing the batch a line sells from (old batch override)', () => {
  it('is not offered without batch.override', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    await flush();
    expect(byTest('batch-override')).toBeNull();
  });

  it('lets a role with batch.override pick a batch for the selected line, needs a reason before paying, and can go back to automatic', async () => {
    screenWith([{}], { perms: { ...PERMS, batchOverride: true } });
    await flush();
    press({ key: 'ArrowDown' });
    await flush();
    expect(byTest('batch-override')).not.toBeNull();
    expect(byTest('batch-auto')!.getAttribute('aria-pressed')).toBe('true');
    const pick = allTest('batch-pick');
    expect(pick.map((b) => b.getAttribute('data-batch'))).toEqual(['b1', 'b2']);
    click(pick[1]!);
    let line = stored().receipts[0]!.cart.lines[0]!;
    expect([line.batchId, line.batchLot]).toEqual(['b2', 'L2']);
    expect(byTest('batch-reason')).not.toBeNull();
    expect(byTest('batch-override')!.textContent).toContain('at least 3 characters');
    // Paying is held back until the reason is written.
    press({ key: 'F2' });
    expect(byTest('flow-blocked')!.textContent).toContain('at least 3 characters');
    press({ key: 'Escape' });
    typeIn('batch-reason', 'Customer asked for the later expiry');
    line = stored().receipts[0]!.cart.lines[0]!;
    expect(line.batchReason).toBe('Customer asked for the later expiry');
    press({ key: 'F2' });
    expect(byTest('flow-blocked')).toBeNull();
    press({ key: 'Escape' });
    click(byTest('batch-auto'));
    expect(stored().receipts[0]!.cart.lines[0]!.batchId).toBeNull();
    expect(byTest('batch-reason')).toBeNull();
  });
});

// Held receipts that cannot come back ----------------------------------------------------------------------------------------

describe('a held receipt that cannot be resumed (old HoldsDialog refusals)', () => {
  const HOLD = { id: 'h1', branchId: 'b1', currency: 'IQD', lineCount: 1, totalPreviewMinor: '4500', heldById: 'u1', mine: true, createdAt: '2026-11-05T08:30:00Z', heldUntil: '2026-11-06T08:30:00Z' };
  const resumed = (over: Record<string, unknown>) => ({ ok: true, data: { saleId: 'h1', branchId: 'b1', currency: 'IQD', note: '', heldUntil: HOLD.heldUntil, heldById: 'u1', lines: [], items: [], ...over } });

  it.each([
    ['held in another currency', { currency: 'USD', lines: [{ productId: 'p1', unitId: 'strip', qty: 1, tradeName: 'Panadol' }], items: [sellItem()] }, 'pharmacy.sell.holds.otherCurrency'],
    ['with nothing left to put back', { lines: [] }, 'pharmacy.sell.holds.nothing'],
  ])('says so when it was %s and opens no receipt', async (_name, over, key) => {
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [HOLD], hasMore: false } });
    sales.resumeHold.mockResolvedValue(resumed(over));
    screenWith([{ cart: emptyCart() }]);
    await flush();
    click(byTest('tool-held'));
    await flush();
    await act(async () => byTest('held-resume')!.click());
    await flush();
    expect(byTest('held-problem')!.textContent).toBe(STUDIO_MESSAGES.en[key as keyof typeof STUDIO_MESSAGES.en]);
    expect(stored().receipts).toHaveLength(1);
    expect(stored().receipts[0]!.fromHoldId).toBeNull();
  });
});

// Return mode: carried minors ----------------------------------------------------------------------------------------------

describe('return mode (carried from Task 10)', () => {
  const ready = () => {
    sales.listSales.mockResolvedValue({ ok: true, data: { items: [{ id: 'sale-77', number: 'S-77' }], nextCursor: null } });
    returns.returnableLines.mockResolvedValue({ ok: true, data: RETURNABLE });
    returns.returnPreview.mockResolvedValue({ ok: true, data: { refundMinor: '1500', isFinal: true } });
    receipts.returnSlip.mockResolvedValue({ ok: true, data: { html: '<p>slip</p>', text: 'slip', model: slipModel(), copyNumber: 0, replayed: false } });
  };
  const fillAndSend = async () => {
    screenWith([{ cart: emptyCart() }], { canReturn: true });
    await flush();
    click(byTest('tool-return'));
    typeIn('return-number', 'S-77');
    click(byTest('return-find'));
    await flush();
    typeIn('return-qty', '10');
    typeIn('return-reason', 'Wrong strength');
    await wait(300);
    await flush();
    await act(async () => (byTest('return-confirm') as HTMLButtonElement).click());
    await flush();
  };

  it('prints the return slip once, also when return mode is closed and opened again (R1), and reads the header figures again', async () => {
    ready();
    returns.createReturn.mockResolvedValue({ ok: true, data: RETURN_DONE });
    await fillAndSend();
    expect(byTest('return-slip')).not.toBeNull();
    expect(bridge.printDoc).toHaveBeenCalledTimes(1);
    expect(nav.refresh).toHaveBeenCalled();
    press({ key: 'Escape' });
    expect(flowOf()).toBe('idle');
    click(byTest('tool-return'));
    await flush();
    expect(byTest('return-slip')).not.toBeNull();
    expect(bridge.printDoc).toHaveBeenCalledTimes(1);
    // Printing by hand still prints.
    await act(async () => byTest('return-print')!.click());
    await flush();
    expect(bridge.printDoc).toHaveBeenCalledTimes(2);
  });

  it('says why when the Retry of a lost return is refused (R2)', async () => {
    ready();
    returns.createReturn.mockRejectedValueOnce(new Error('offline'));
    await fillAndSend();
    expect(byTest('return-pending')).not.toBeNull();
    returns.createReturn.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'Nothing is left to return', fields: { phCode: 'NOTHING_TO_RETURN' } } });
    await act(async () => byTest('return-retry')!.click());
    await flush();
    expect(byTest('return-pending')).toBeNull();
    expect(byTest('return-problem')!.textContent).toBe(STUDIO_MESSAGES.en['pharmacy.returns.fail.NOTHING_TO_RETURN']);
  });

  it('a second Retry pressed while the first is still being sent is not taken for a refusal (M3)', async () => {
    ready();
    returns.createReturn.mockRejectedValueOnce(new Error('offline'));
    await fillAndSend();
    expect(byTest('return-pending')).not.toBeNull();
    let answer: (value: unknown) => void = () => {};
    returns.createReturn.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const retryButton = byTest('return-retry')!;
    // Two presses before the screen re-renders: the second meets the local lock of the first.
    await act(async () => {
      retryButton.click();
      retryButton.click();
    });
    await flush();
    expect(returns.createReturn).toHaveBeenCalledTimes(2);
    expect(byTest('return-problem')).toBeNull();
    await act(async () => answer({ ok: true, data: RETURN_DONE }));
    await flush();
    expect(byTest('return-slip')).not.toBeNull();
  });
});

// The shift line and the several-matches list (review minors M1, M2) ---------------------------------------------------------

describe('the shift line (old shift-line, M1)', () => {
  it('says the shift is open, in which currency, with its opening cash and when it opened', async () => {
    screenWith([{ cart: emptyCart() }], { shift: { ...SHIFT, openingFloatMinor: '10000' }, pulse: undefined });
    await flush();
    const line = byTest('shift-line')!;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain(STUDIO_MESSAGES.en['pharmacy.cashier.shift.open'].replace('{currency}', 'IQD'));
    expect(line.textContent).toContain('10,000');
    expect(line.textContent).toContain('2026');
  });
});

describe('the several-matches list does not go stale (M2)', () => {
  const TWO = [sellItem({ matchedOn: 'barcode' }), sellItem({ productId: 'p2', tradeName: 'Panadol Extra', matchedOn: 'barcode' })];
  const offered = async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: TWO } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', '6221010001');
    enter();
    await flush();
    expect(allTest('suggestion')).toHaveLength(2);
  };

  it('closes when a new receipt is opened, and stays closed on going back', async () => {
    await offered();
    click(byTest('receipt-new'));
    expect(allTest('suggestion')).toHaveLength(0);
    click(allTest('receipt-tab')[0]!);
    expect(allTest('suggestion')).toHaveLength(0);
  });

  it('closes when a later scan has another outcome', async () => {
    await offered();
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [] } });
    enter();
    await flush();
    expect(message()).toContain('6221010001');
    expect(allTest('suggestion')).toHaveLength(0);
  });
});
