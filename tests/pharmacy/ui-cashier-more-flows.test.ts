// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The cashier's other inline flows (plan Task 9b): the receipt discount (F9), hold (F8) and the held list, the prescription
 * recorded inline, items handed in from other screens (`?add=`, the cart bridge), the in-app leave guard, "all operations"
 * and the copy of the last receipt. No dialog anywhere; every server call is the old sale screen's.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/pharmacy/sell' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));
const customers = vi.hoisted(() => ({ listCustomers: vi.fn(async () => ({ ok: true, data: { items: [] } })), getCustomer: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/customers', () => customers);
const receipts = vi.hoisted(() => ({ saleReceipt: vi.fn(), reprintReceipt: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/receipts', () => receipts);
const rxActions = vi.hoisted(() => ({ createPrescription: vi.fn(), getPrescription: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/prescriptions', () => rxActions);
const print = vi.hoisted(() => ({ getPrintSettings: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/print', () => print);
const bridge = vi.hoisted(() => ({ printDoc: vi.fn(async () => ({ ok: true })), kickDrawer: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/app/pos/_ui/print/print-client', () => bridge);

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const flows = await import('@/app/pharmacy/_ui/cashier/flows-logic');
const cashierLogic = await import('@/app/pharmacy/_ui/cashier/cashier-logic');
const { addToCart } = await import('@/app/pharmacy/_ui/cart-bridge');
const { todayInStudioZone } = await import('@/app/pharmacy/_ui/ph-date');
const { cartReducer, emptyCart, estimateCart } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, receiptsReducer, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
const { buildReceipt } = await import('@/server/domain/pharmacy/receipt');
type AddableItem = import('@/app/pharmacy/_ui/sell-logic').AddableItem;
type CartState = import('@/app/pharmacy/_ui/sell-logic').CartState;
type SaleAttempt = import('@/app/pharmacy/_ui/sell-logic').SaleAttempt;
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
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await settle();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const flowOf = () => byTest('work-panel')!.getAttribute('data-flow');
const message = () => byTest('cashier-message')?.textContent ?? '';

const item = (over: Partial<AddableItem> = {}): AddableItem => ({
  productId: 'p1',
  tradeName: 'Panadol',
  code: '6221010001',
  strength: '500 mg',
  form: 'tablet',
  packLabel: 'strip',
  rxLevel: 'OTC',
  matchedUnitId: null,
  sellableQty: 100,
  units: [{ id: 'strip', label: 'strip', baseQty: 1, priceMinor: '1500' }],
  batches: [{ batchId: 'b1', lot: 'L1', expiryDate: '2027-03-31', available: 40 }],
  ...over,
});
const sellItem = (over: Partial<AddableItem> = {}) => ({ ...item(over), genericName: '', matchedOn: 'unit', notSellable: false, noPrice: false });
/** One line of three strips at 1,500: a total of 4,500. */
const cartOf = (qty = 3, over: Partial<AddableItem> = {}): CartState => {
  const one = cartReducer(emptyCart(), { type: 'add', item: item(over) });
  return cartReducer(one, { type: 'qty', key: one.lines[0]!.key, qty });
};

const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: true, controlledMaxQty: 10, creditEnabled: true };
const PERMS = { discount: true, batchOverride: false, rx: true, credit: false };
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');
const ATTEMPT: SaleAttempt = { sig: 'old-sig', key: 'sale-key-0001', paymentKey: 'pay-key-0001', method: 'CASH', amountMinor: '5000', reference: '', fromHoldId: null };

function screenWith(list: Partial<OpenReceipt>[], over: Partial<ComponentProps<typeof CashierScreen>> = {}, active = 0) {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: list.map((r) => ({ ...newReceipt(), cart: cartOf(), ...r })), active }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, ...over }));
}
const stored = () => JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as { receipts: OpenReceipt[]; active: number };

const SALE = { id: 'sale-1', number: 'S-1', status: 'COMPLETED', branchId: 'b1', currency: 'IQD', subtotalMinor: '4500', discountMinor: '0', roundingMinor: '0', totalMinor: '4500', paidMinor: '5000', changeMinor: '500', lineCount: 1, completedAt: '2026-11-05T09:00:00Z', replayed: false };
const model = (copy = false) =>
  buildReceipt(
    {
      kind: 'sale',
      sale: { number: 'S-1', currency: 'IQD', at: new Date('2026-11-05T09:00:00Z'), subtotalMinor: 4500n, discountMinor: 0n, roundingMinor: 0n, totalMinor: 4500n, paidMinor: 5000n, changeMinor: 500n, cashierName: 'Sara', lines: [{ lineNo: 1, name: 'Panadol', strength: '500 mg', qty: 3, unitLabel: 'strip', unitPriceMinor: 1500n, discountMinor: 0n, totalMinor: 4500n, rxLevel: 'OTC' }], payments: [{ method: 'CASH', amountMinor: 5000n }] },
    },
    { width: '80', locale: 'en', copy, shop: { name: 'Shop' } },
  );
const receiptOf = (copy = false) => ({ ok: true, data: { html: '<p>receipt</p>', text: 'receipt', model: model(copy), copyNumber: copy ? 1 : 0, replayed: false } });
const WORKSTATION = {
  paper: 'A4',
  marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
  labelSize: '50x30',
  showPrice: true,
  receiptPrinter: { transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2, drawerOnCash: true },
};
const drawerFlags = () => (bridge.printDoc.mock.calls as unknown as [unknown, unknown, { drawer: boolean }][]).map((call) => call[2].drawer);
const HOLD = (id: string, over: Record<string, unknown> = {}) => ({ id, branchId: 'b1', currency: 'IQD', lineCount: 1, totalPreviewMinor: '4500', heldById: 'u1', mine: true, createdAt: '2026-11-05T08:30:00Z', heldUntil: '2026-11-06T08:30:00Z', ...over });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('ph.print.workstation', 'Counter 1');
  window.history.replaceState({}, '', '/pharmacy/sell');
  for (const fn of [...Object.values(sales), ...Object.values(receipts), ...Object.values(rxActions), nav.refresh, nav.push, nav.replace, bridge.printDoc, bridge.kickDrawer]) fn.mockReset();
  sales.listHolds.mockResolvedValue({ ok: true, data: { items: [], hasMore: false } });
  bridge.printDoc.mockResolvedValue({ ok: true });
  print.getPrintSettings.mockResolvedValue({ ok: true, data: { print: { workstations: { 'Counter 1': WORKSTATION } } } });
  receipts.saleReceipt.mockResolvedValue(receiptOf());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Pure parts -------------------------------------------------------------------------------------------------------------

describe('the discount limit (pure)', () => {
  it('is over the limit exactly as the server judges it: all discounts against the gross', () => {
    const est = (cart: CartState) => estimateCart(cart, 'IQD', 0);
    const withInvoice = (d: CartState['invoiceDiscount']) => ({ ...cartOf(), invoiceDiscount: d });
    expect(flows.discountOverLimit(est(withInvoice({ kind: 'percent', value: '10' })), 10)).toBe(false);
    expect(flows.discountOverLimit(est(withInvoice({ kind: 'percent', value: '10.5' })), 10)).toBe(true);
    expect(flows.discountOverLimit(est(withInvoice({ kind: 'amount', value: '450' })), 10)).toBe(false);
    expect(flows.discountOverLimit(est(withInvoice({ kind: 'amount', value: '451' })), 10)).toBe(true);
    expect(flows.discountOverLimit(est(cartOf()), 0)).toBe(false);
    const over = withInvoice({ kind: 'percent', value: '20' });
    expect(flows.discountReasonNeeded(over, est(over), 10)).toBe(true);
    expect(flows.discountReasonNeeded({ ...over, discountReason: 'ok' }, est(over), 10)).toBe(true);
    expect(flows.discountReasonNeeded({ ...over, discountReason: 'loyal' }, est(over), 10)).toBe(false);
  });
});

describe('receipts: prescription, reset, empty receipt (pure)', () => {
  const two = () => ({ receipts: [{ ...newReceipt(), key: 'a', cart: cartOf(1, { rxLevel: 'RX' }) }, { ...newReceipt(), key: 'b', cart: cartOf(), attempt: ATTEMPT, fromHoldId: 'h1' }], active: 0 });

  it('records a prescription id on the receipt with that key, never on one with a sale in flight', () => {
    const s = receiptsReducer(two(), { type: 'prescription', receiptKey: 'a', prescriptionId: 'rx-1' });
    expect(s.receipts[0]!.prescriptionId).toBe('rx-1');
    expect(receiptsReducer(s, { type: 'prescription', receiptKey: 'b', prescriptionId: 'rx-2' }).receipts[1]!.prescriptionId).toBeNull();
  });

  it('frees a receipt by key (hold, discard) but never one with a sale in flight', () => {
    const s = receiptsReducer(two(), { type: 'reset', receiptKey: 'a' });
    expect(s.receipts[0]!.key).not.toBe('a');
    expect(s.receipts[0]!.cart.lines).toHaveLength(0);
    expect(receiptsReducer(s, { type: 'reset', receiptKey: 'b' })).toBe(s);
  });

  it('lets go of the hold and the prescription when the lines that needed them are gone', () => {
    const s = { receipts: [{ ...newReceipt(), key: 'a', cart: cartOf(1, { rxLevel: 'RX' }), fromHoldId: 'h1', prescriptionId: 'rx-1' }], active: 0 };
    const line = s.receipts[0]!.cart.lines[0]!.key;
    const next = cashierLogic.cashierReducer(s, { type: 'line', action: { type: 'remove', key: line } });
    expect(next.receipts[0]).toMatchObject({ fromHoldId: null, prescriptionId: null });
  });
});

describe('a receipt being held is frozen (pure)', () => {
  const held = () => ({ receipts: [{ ...newReceipt(), key: 'a', cart: cartOf(), prescriptionId: 'rx-1' }, { ...newReceipt(), key: 'b', cart: cartOf() }], active: 0, holding: 'a' });
  it('refuses every change to the receipt whose hold is being sent, and nothing else', () => {
    const s = held();
    expect(cashierLogic.frozenEdit(s, { type: 'line', action: { type: 'remove', key: s.receipts[0]!.cart.lines[0]!.key } })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'customer', customerId: 'c1' })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'prescription', receiptKey: 'a', prescriptionId: null })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'reset', receiptKey: 'a' })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'close', index: 0 })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'reset', receiptKey: 'b' })).toBe(false);
    expect(cashierLogic.frozenEdit(s, { type: 'switch', index: 1 })).toBe(false);
    expect(cashierLogic.cashierReducer(s, { type: 'reset', receiptKey: 'a' })).toBe(s);
    expect(cashierLogic.cashierReducer(s, { type: 'holding', receiptKey: null }).holding).toBeNull();
  });
  it('sends handed-in items to a new receipt while the active one is being held', () => {
    expect(flows.handInPlace(held())).toBe('new');
  });
});

describe('N2: a receipt being paid refuses a prescription change or a reset, and says so', () => {
  it('counts prescription and reset by key as frozen while the receipt has a sale in flight (pure)', () => {
    const s = { receipts: [{ ...newReceipt(), key: 'a', cart: cartOf(), attempt: ATTEMPT, prescriptionId: 'rx-1' }, { ...newReceipt(), key: 'b', cart: cartOf() }], active: 1 };
    expect(cashierLogic.frozenEdit(s, { type: 'prescription', receiptKey: 'a', prescriptionId: null })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'reset', receiptKey: 'a' })).toBe(true);
    expect(cashierLogic.frozenEdit(s, { type: 'prescription', receiptKey: 'b', prescriptionId: null })).toBe(false);
    expect(cashierLogic.frozenEdit(s, { type: 'reset', receiptKey: 'b' })).toBe(false);
  });

  it('shows the refusal when the prescription is detached from a receipt being paid', async () => {
    screenWith([{ cart: cartOf(1, { rxLevel: 'RX' }), attempt: ATTEMPT, prescriptionId: 'rx-1' }]);
    await flush();
    click(byTest('rx-detach'));
    expect(message()).toContain('F4');
    expect(stored().receipts[0]!.prescriptionId).toBe('rx-1');
  });
});

describe('where items land (pure)', () => {
  const base = (over: Partial<OpenReceipt>[]) => ({ receipts: over.map((r, i) => ({ ...newReceipt(), key: `k${i}`, cart: cartOf(), ...r })), active: 0 });

  it('resumes into the active receipt when it is empty or paid, else a new one, and switches to a hold already open', () => {
    expect(flows.resumePlace(base([{ cart: emptyCart() }]), 'h1')).toBe('active');
    expect(flows.resumePlace(base([{ done: true }]), 'h1')).toBe('active');
    expect(flows.resumePlace(base([{}]), 'h1')).toBe('new');
    expect(flows.resumePlace(base([{ cart: emptyCart(), attempt: ATTEMPT }]), 'h1')).toBe('new');
    expect(flows.resumePlace(base([{}, {}, {}, {}, {}, {}]), 'h1')).toBe('full');
    expect(flows.resumePlace(base([{}, { fromHoldId: 'h1' }]), 'h1')).toEqual({ switchTo: 1 });
  });

  it('hands items to the active receipt, or a new one when the active is frozen', () => {
    expect(flows.handInPlace(base([{}]))).toBe('active');
    expect(flows.handInPlace(base([{ attempt: ATTEMPT }]))).toBe('new');
    expect(flows.handInPlace(base([{ attempt: ATTEMPT }, {}, {}, {}, {}, {}]))).toBe('full');
  });

  it('offers the operations a role may open, as the nav allows them', () => {
    expect(flows.cashierOps(null)).toEqual([]);
    expect(flows.cashierOps('CASHIER').map((o) => o.key)).toEqual(['sales', 'cash', 'closeShift']);
    // The shift screen opens for reports too; cash in or out and closing the shift are only for those who work a shift.
    expect(flows.cashierOps('ACCOUNTANT').map((o) => o.key)).not.toContain('cash');
    expect(flows.cashierOps('ACCOUNTANT').map((o) => o.key)).not.toContain('closeShift');
    expect(flows.cashierOps('OWNER').map((o) => [o.key, o.href])).toEqual([
      ['sales', '/pharmacy/sales'],
      ['returns', '/pharmacy/returns'],
      ['debt', '/pharmacy/customers'],
      ['cash', '/pharmacy/shifts'],
      ['closeShift', '/pharmacy/shifts'],
    ]);
  });
});

// Discount ---------------------------------------------------------------------------------------------------------------

describe('the receipt discount (F9)', () => {
  it('takes F9 only when it acts: lines, not paid, and the discount permission', () => {
    screenWith([{ cart: emptyCart() }]);
    expect(press({ key: 'F9' }).defaultPrevented).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{}], { perms: { ...PERMS, discount: false } });
    expect(press({ key: 'F9' }).defaultPrevented).toBe(false);
    expect(byTest('tool-discount')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{}]);
    expect(press({ key: 'F9' }).defaultPrevented).toBe(true);
    expect(flowOf()).toBe('discount');
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
  });

  it('applies a percent or an amount to the receipt, asks for a reason above the limit and sends it with the sale', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    screenWith([{}]);
    click(byTest('tool-discount'));
    typeIn('disc-value', '5');
    expect(stored().receipts[0]!.cart.invoiceDiscount).toEqual({ kind: 'percent', value: '5' });
    expect(byTest('cashier-discount')!.textContent).toContain('225');
    click(byTest('disc-kind-amount'));
    typeIn('disc-value', '400');
    expect(stored().receipts[0]!.cart.invoiceDiscount).toEqual({ kind: 'amount', value: '400' });
    expect(byTest('disc-reason-needed')).toBeNull();
    click(byTest('disc-kind-percent'));
    typeIn('disc-value', '20');
    expect(byTest('disc-reason-needed')).not.toBeNull();
    typeIn('disc-reason', 'loyal customer');
    expect(byTest('disc-reason-needed')).toBeNull();
    click(byTest('disc-apply'));
    expect(flowOf()).toBe('idle');
    press({ key: 'F2' });
    const confirm = byTest('flow-confirm') as HTMLButtonElement;
    await act(async () => confirm.click());
    await flush();
    const body = sales.createSale.mock.calls[0]![0] as { invoiceDiscount: unknown };
    expect(body.invoiceDiscount).toEqual({ kind: 'percent', value: 20, reason: 'loyal customer' });
  });

  it('gives the selected line its own discount', () => {
    screenWith([{}]);
    press({ key: 'ArrowDown' });
    press({ key: 'F9' });
    typeIn('disc-line-value', '10');
    expect(stored().receipts[0]!.cart.lines[0]!.discount).toEqual({ kind: 'percent', value: '10' });
  });

  it('refuses on a receipt whose sale is in flight, and says so', () => {
    screenWith([{ attempt: ATTEMPT }]);
    expect(press({ key: 'F9' }).defaultPrevented).toBe(true);
    expect(flowOf()).not.toBe('discount');
    expect(message()).toContain('F4');
  });
});

// Hold and the held list ---------------------------------------------------------------------------------------------------

describe('hold (F8)', () => {
  it('sends the old hold request once (a double press is one hold), frees the tab and counts the held receipts again', async () => {
    const answer = deferred<unknown>();
    sales.holdSale.mockReturnValue(answer.promise);
    screenWith([{}]);
    await flush();
    expect(press({ key: 'F8' }).defaultPrevented).toBe(true);
    press({ key: 'F8' });
    click(byTest('tool-hold'));
    expect(sales.holdSale).toHaveBeenCalledTimes(1);
    const req = sales.holdSale.mock.calls[0]![0] as { clientKey: string; currency: string; lines: unknown[] };
    expect(req.clientKey).toMatch(/^hold-/);
    expect(req).toEqual({ clientKey: req.clientKey, currency: 'IQD', lines: [{ productId: 'p1', unitId: 'strip', qty: 3 }] });
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [HOLD('h1')], hasMore: false } });
    await act(async () => answer.resolve({ ok: true, data: { id: 'h1', heldUntil: '2026-11-06T08:30:00Z' } }));
    await flush();
    expect(stored().receipts).toHaveLength(1);
    expect(stored().receipts[0]!.cart.lines).toHaveLength(0);
    expect(allTest('sale-line')).toHaveLength(0);
    expect(message().toLowerCase()).toContain('held');
    expect(byTest('held-count')!.textContent).toBe('1');
    expect(press({ key: 'F8' }).defaultPrevented).toBe(false);
  });

  it('sends the same key again after a lost answer, and drops the hold the receipt came from once held again', async () => {
    sales.holdSale.mockRejectedValueOnce(new TypeError('fetch failed'));
    sales.discardHold.mockResolvedValue({ ok: true, data: {} });
    screenWith([{ fromHoldId: 'old-hold' }]);
    press({ key: 'F8' });
    await flush();
    expect(stored().receipts[0]!.cart.lines).toHaveLength(1);
    sales.holdSale.mockResolvedValueOnce({ ok: true, data: { id: 'h2', heldUntil: '2026-11-06T08:30:00Z' } });
    press({ key: 'F8' });
    await flush();
    const [a, b] = sales.holdSale.mock.calls.map((c) => (c[0] as { clientKey: string }).clientKey);
    expect(b).toBe(a);
    expect(sales.discardHold).toHaveBeenCalledWith({ saleId: 'old-hold' });
    expect(stored().receipts[0]!.cart.lines).toHaveLength(0);
  });

  it('never holds a receipt whose sale is in flight, and says why', async () => {
    screenWith([{ attempt: ATTEMPT }]);
    expect(press({ key: 'F8' }).defaultPrevented).toBe(true);
    await flush();
    expect(sales.holdSale).not.toHaveBeenCalled();
    expect(message()).toContain('cannot be held');
    expect(stored().receipts[0]!.attempt).toMatchObject({ key: ATTEMPT.key });
  });
});

describe('a receipt while its hold is sent', () => {
  it('refuses edits and Pay, sends handed-in items to a new receipt, and frees only the held receipt', async () => {
    const answer = deferred<unknown>();
    sales.holdSale.mockReturnValue(answer.promise);
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ productId: 'p2', tradeName: 'Brufen' })] } });
    screenWith([{}]);
    await flush();
    press({ key: 'F8' });
    expect((byTest('pay-cash') as HTMLButtonElement).disabled).toBe(true);
    expect(press({ key: 'F2' }).defaultPrevented).toBe(true);
    expect(flowOf()).not.toBe('cash');
    expect(message()).toContain('being held');
    press({ key: 'ArrowDown' });
    press({ key: '+' });
    expect(stored().receipts[0]!.cart.lines[0]!.qty).toBe(3);
    expect(byTest('tool-discount')).toBeNull();
    expect((byTest('tool-discard') as HTMLButtonElement).disabled).toBe(true);
    act(() => addToCart({ unitId: 'strip', qty: 1 }));
    await flush();
    expect(stored().receipts).toHaveLength(2);
    expect(stored().receipts[1]!.cart.lines.map((l) => l.productId)).toEqual(['p2']);
    await act(async () => answer.resolve({ ok: true, data: { id: 'h1', heldUntil: '2026-11-06T08:30:00Z' } }));
    await flush();
    const s = stored();
    expect(s.receipts[0]!.cart.lines).toHaveLength(0);
    expect(s.receipts[1]!.cart.lines.map((l) => l.productId)).toEqual(['p2']);
    expect(sales.holdSale).toHaveBeenCalledTimes(1);
  });

  it('stays frozen after a lost answer until it is held again or let go on purpose', async () => {
    sales.holdSale.mockRejectedValueOnce(new TypeError('fetch failed'));
    screenWith([{}]);
    await flush();
    press({ key: 'F8' });
    await flush();
    expect(stored().receipts[0]!.cart.lines).toHaveLength(1);
    expect(press({ key: 'F2' }).defaultPrevented).toBe(true);
    expect(flowOf()).not.toBe('cash');
    const release = byTest('tool-hold-release');
    expect(release).not.toBeNull();
    click(release);
    expect(byTest('tool-hold-release')!.textContent!.toLowerCase()).toContain('again');
    expect(press({ key: 'F2' }).defaultPrevented).toBe(true);
    expect(flowOf()).not.toBe('cash');
    click(byTest('tool-hold-release'));
    expect(byTest('tool-hold-release')).toBeNull();
    press({ key: 'F2' });
    expect(flowOf()).toBe('cash');
    expect(sales.holdSale).toHaveBeenCalledTimes(1);
  });

  it('is free again after a definite refusal', async () => {
    sales.holdSale.mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN', message: 'no' } });
    screenWith([{}]);
    await flush();
    press({ key: 'F8' });
    await flush();
    expect(byTest('tool-hold-release')).toBeNull();
    press({ key: 'F2' });
    expect(flowOf()).toBe('cash');
  });

  it('never offers the receipt discount on a receipt whose sale is in flight', () => {
    screenWith([{ attempt: ATTEMPT }]);
    expect(byTest('tool-discount')).toBeNull();
  });
});

describe('the held list', () => {
  const resumed = (over: Record<string, unknown> = {}) => ({
    ok: true,
    data: { saleId: 'h1', branchId: 'b1', currency: 'IQD', note: '', heldUntil: '2026-11-06T08:30:00Z', heldById: 'u1', lines: [{ productId: 'p2', unitId: 'box', qty: 2, tradeName: 'Brufen' }, { productId: 'gone', unitId: 'u9', qty: 1, tradeName: 'Old thing' }], items: [sellItem({ productId: 'p2', tradeName: 'Brufen', units: [{ id: 'box', label: 'box', baseQty: 1, priceMinor: '2000' }] })], ...over },
  });

  it('shows the count, lists the holds inline and resumes into a NEW tab with the hold id and its blocked lines marked', async () => {
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [HOLD('h1'), HOLD('h2', { mine: false })], hasMore: false } });
    sales.resumeHold.mockResolvedValue(resumed());
    screenWith([{}]);
    await flush();
    expect(byTest('held-count')!.textContent).toBe('2');
    click(byTest('tool-held'));
    await flush();
    expect(flowOf()).toBe('held');
    expect(allTest('held-row')).toHaveLength(2);
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
    await act(async () => allTest('held-resume')[0]!.click());
    await flush();
    expect(sales.resumeHold).toHaveBeenCalledWith({ saleId: 'h1' });
    const s = stored();
    expect(s.receipts).toHaveLength(2);
    expect(s.active).toBe(1);
    expect(s.receipts[0]!.cart.lines[0]!.productId).toBe('p1');
    expect(s.receipts[1]).toMatchObject({ fromHoldId: 'h1' });
    expect(s.receipts[1]!.cart.lines.map((l) => [l.productId, l.qty, l.blocked])).toEqual([
      ['p2', 2, null],
      ['gone', 1, 'GONE'],
    ]);
    expect(allTest('line-blocked')).toHaveLength(1);
    expect(message()).toContain('Old thing');
    expect(flowOf()).toBe('idle');
  });

  it('resumes into the current tab when it is empty, and switches to a hold that is already open', async () => {
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [HOLD('h1')], hasMore: false } });
    sales.resumeHold.mockResolvedValue(resumed({ lines: [{ productId: 'p2', unitId: 'box', qty: 2, tradeName: 'Brufen' }] }));
    screenWith([{ cart: emptyCart() }]);
    click(byTest('tool-held'));
    await flush();
    await act(async () => byTest('held-resume')!.click());
    await flush();
    expect(stored().receipts).toHaveLength(1);
    expect(stored().receipts[0]).toMatchObject({ fromHoldId: 'h1' });
    press({ key: 'F4' });
    click(byTest('tool-held'));
    await flush();
    await act(async () => byTest('held-resume')!.click());
    await flush();
    expect(sales.resumeHold).toHaveBeenCalledTimes(1);
    expect(stored().active).toBe(0);
  });

  it('says there are more held receipts than it counted', async () => {
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [HOLD('h1'), HOLD('h2')], hasMore: true } });
    screenWith([{}]);
    await flush();
    expect(byTest('held-count')!.textContent).toBe('2+');
  });

  it('discards a hold only on the second tap', async () => {
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [HOLD('h1')], hasMore: false } });
    sales.discardHold.mockResolvedValue({ ok: true, data: {} });
    screenWith([{}]);
    click(byTest('tool-held'));
    await flush();
    click(byTest('held-discard'));
    expect(sales.discardHold).not.toHaveBeenCalled();
    expect(byTest('held-discard')!.textContent).toContain('again');
    sales.listHolds.mockResolvedValue({ ok: true, data: { items: [], hasMore: false } });
    await act(async () => byTest('held-discard')!.click());
    await flush();
    expect(sales.discardHold).toHaveBeenCalledTimes(1);
    expect(sales.discardHold).toHaveBeenCalledWith({ saleId: 'h1' });
    expect(allTest('held-row')).toHaveLength(0);
    expect(byTest('held-count')!.textContent).toBe('0');
  });
});

// Prescription -------------------------------------------------------------------------------------------------------------

describe('the prescription, recorded inline', () => {
  it('records it in the work panel, keeps only its id on the receipt and lets the sale go with it', async () => {
    rxActions.createPrescription.mockResolvedValue({ ok: true, data: { id: 'rx-1' } });
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    screenWith([{ cart: cartOf(1, { rxLevel: 'RESTRICTED' }) }]);
    press({ key: 'F2' });
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
    click(byTest('flow-rx'));
    expect(flowOf()).toBe('rx');
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
    typeIn('rx-number', 'N-55');
    typeIn('rx-prescriber', 'Dr. Salim');
    typeIn('rx-patient', 'Huda Kareem');
    typeIn('rx-date', todayInStudioZone());
    await act(async () => byTest('rx-save')!.click());
    await flush();
    expect(rxActions.createPrescription).toHaveBeenCalledTimes(1);
    expect(rxActions.createPrescription.mock.calls[0]![0]).toMatchObject({ number: 'N-55', prescriberName: 'Dr. Salim', patientName: 'Huda Kareem' });
    expect(stored().receipts[0]!.prescriptionId).toBe('rx-1');
    expect(window.localStorage.getItem(STORE)).not.toContain('Huda');
    expect(byTest('rx-attached')!.textContent).toContain('N-55');
    press({ key: 'F2' });
    const confirm = byTest('flow-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    await flush();
    expect(sales.createSale.mock.calls[0]![0]).toMatchObject({ prescriptionId: 'rx-1' });
  });

  it('checks a prescription restored from the device once: gone or used, it is dropped and said', async () => {
    rxActions.getPrescription.mockResolvedValue({ ok: true, data: { number: 'N-1', saleId: 'sold-already' } });
    screenWith([{ cart: cartOf(1, { rxLevel: 'RX' }), prescriptionId: 'rx-9' }, { key: 'paying', cart: cartOf(1, { rxLevel: 'RX' }), prescriptionId: 'rx-8', attempt: ATTEMPT }]);
    await flush();
    expect(rxActions.getPrescription).toHaveBeenCalledTimes(1);
    expect(rxActions.getPrescription).toHaveBeenCalledWith({ prescriptionId: 'rx-9' });
    expect(stored().receipts[0]!.prescriptionId).toBeNull();
    expect(stored().receipts[1]!.prescriptionId).toBe('rx-8');
    expect(message()).toContain('gone');
  });

  it('keeps a restored prescription that is still unused, and shows its number', async () => {
    rxActions.getPrescription.mockResolvedValue({ ok: true, data: { number: 'N-7', saleId: null } });
    screenWith([{ cart: cartOf(1, { rxLevel: 'RX' }), prescriptionId: 'rx-9' }]);
    await flush();
    expect(stored().receipts[0]!.prescriptionId).toBe('rx-9');
    expect(byTest('rx-attached')!.textContent).toContain('N-7');
  });
});

// Hand-in --------------------------------------------------------------------------------------------------------------------

describe('items handed in from other screens', () => {
  it('adds `?add=` to the active receipt, selects the line and clears the parameter', async () => {
    window.history.replaceState({}, '', '/pharmacy/sell?add=strip:2&x=1');
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem()] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    expect(sales.sellSearch).toHaveBeenCalledWith({ q: '', currency: 'IQD', unitIds: ['strip'] });
    expect(nav.replace).toHaveBeenCalledWith('/pharmacy/sell?x=1');
    expect(stored().receipts[0]!.cart.lines.map((l) => [l.productId, l.unitId, l.qty])).toEqual([['p1', 'strip', 2]]);
    expect(allTest('sale-line')[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('adds a bridged item to the active receipt, or to a new one when the active is frozen', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ productId: 'p2', tradeName: 'Brufen' })] } });
    screenWith([{ attempt: ATTEMPT }]);
    await flush();
    act(() => addToCart({ unitId: 'strip', qty: 1 }));
    await flush();
    const s = stored();
    expect(s.receipts).toHaveLength(2);
    expect(s.receipts[0]!.cart.lines.map((l) => l.productId)).toEqual(['p1']);
    expect(s.receipts[1]!.cart.lines.map((l) => l.productId)).toEqual(['p2']);
    expect(s.active).toBe(1);
    act(() => addToCart({ unitId: 'strip', qty: 1 }));
    await flush();
    expect(stored().receipts[1]!.cart.lines[0]!.qty).toBe(2);
  });

  it('refuses visibly when the active receipt is frozen and no receipt can be opened', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ productId: 'p2', tradeName: 'Brufen' })] } });
    screenWith([{ attempt: ATTEMPT }, {}, {}, {}, {}, {}]);
    await flush();
    act(() => addToCart({ unitId: 'strip', qty: 1 }));
    await flush();
    expect(stored().receipts.flatMap((r) => r.cart.lines.map((l) => l.productId))).not.toContain('p2');
    expect(message()).toContain('Brufen');
  });
});

// Leave guard ------------------------------------------------------------------------------------------------------------------

describe('leaving the screen', () => {
  const link = () => {
    const a = document.createElement('a');
    a.href = '/pharmacy/sales';
    a.textContent = 'Sales';
    document.body.appendChild(a);
    return a;
  };
  // True when the guard took the click. The guard also stops it (as the old screen did), so a click it lets through is the one
  // that reaches the bubbling listener, which then keeps jsdom from navigating.
  const clickLink = (a: HTMLAnchorElement) => {
    let reached: boolean | null = null;
    const after = (e: Event) => {
      reached = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener('click', after);
    let passed = true;
    act(() => {
      passed = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    document.removeEventListener('click', after);
    return reached ?? !passed;
  };

  it('stops an in-app link while a receipt has lines and asks inline; Leave goes, Stay stays', () => {
    screenWith([{}]);
    const a = link();
    expect(clickLink(a)).toBe(true);
    expect(byTest('leave-note')).not.toBeNull();
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
    click(byTest('leave-stay'));
    expect(byTest('leave-note')).toBeNull();
    clickLink(a);
    click(byTest('leave-go'));
    expect(nav.push).toHaveBeenCalledWith('/pharmacy/sales');
    a.remove();
  });

  it('lets the link go when every receipt is empty', () => {
    screenWith([{ cart: emptyCart() }]);
    const a = link();
    expect(clickLink(a)).toBe(false);
    expect(byTest('leave-note')).toBeNull();
    a.remove();
  });
});

// All operations ---------------------------------------------------------------------------------------------------------------

describe('all operations', () => {
  it('lists, inline, only the screens the role may open', () => {
    screenWith([{}], { role: 'CASHIER' });
    click(byTest('tool-ops'));
    expect(flowOf()).toBe('ops');
    expect(allTest('ops-link').map((a) => a.getAttribute('href'))).toEqual(['/pharmacy/sales', '/pharmacy/shifts', '/pharmacy/shifts']);
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{}], { role: 'OWNER' });
    click(byTest('tool-ops'));
    expect(allTest('ops-link')).toHaveLength(5);
  });

  it('has no operations button without a role', () => {
    screenWith([{}]);
    expect(byTest('tool-ops')).toBeNull();
  });
});

// Copy of the last receipt -----------------------------------------------------------------------------------------------------

describe('the copy of the last receipt', () => {
  it('is offered only after a sale on this screen, prints a marked copy and never opens the drawer', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    receipts.reprintReceipt.mockResolvedValue(receiptOf(true));
    screenWith([{}]);
    expect(byTest('tool-reprint')).toBeNull();
    press({ key: 'F2' });
    const confirm = byTest('flow-confirm') as HTMLButtonElement;
    await act(async () => confirm.click());
    await flush();
    expect(drawerFlags()).toEqual([true]);
    click(byTest('receipt-next'));
    await act(async () => byTest('tool-reprint')!.click());
    await flush();
    expect(flowOf()).toBe('copy');
    expect(receipts.reprintReceipt).toHaveBeenCalledTimes(1);
    expect(receipts.reprintReceipt.mock.calls[0]![0]).toMatchObject({ saleId: 'sale-1', clientKey: expect.stringMatching(/^rp-/) });
    expect(byTest('copy-number')!.textContent).toContain('1');
    expect(drawerFlags()).toEqual([true, false]);
    expect(bridge.kickDrawer).not.toHaveBeenCalled();
    click(byTest('copy-close'));
    expect(flowOf()).toBe('idle');
  });
});
