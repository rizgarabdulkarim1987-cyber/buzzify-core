// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The cashier's payment flows (plan Task 9a): cash and credit inline in the work panel (never a dialog), Pay held back with the
 * reason in words, one sale attempt per receipt kept on the device (a lost answer retries with the SAME keys, a refusal drops
 * them), the receipt after the sale inline, and the drawer opened only by the first print of an original sale that took cash.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/pharmacy/sell' }));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn(async () => ({ ok: true, data: { items: [], hasMore: false } })) }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));
const customers = vi.hoisted(() => ({ listCustomers: vi.fn(async () => ({ ok: true, data: { items: [] } })), getCustomer: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/customers', () => customers);
const receipts = vi.hoisted(() => ({ saleReceipt: vi.fn(), reprintReceipt: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/receipts', () => receipts);
const print = vi.hoisted(() => ({ getPrintSettings: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/print', () => print);
const bridge = vi.hoisted(() => ({ printDoc: vi.fn(async () => ({ ok: true })), kickDrawer: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/app/pos/_ui/print/print-client', () => bridge);

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const flowLogic = await import('@/app/pharmacy/_ui/cashier/sale-flow-logic');
const cashierLogic = await import('@/app/pharmacy/_ui/cashier/cashier-logic');
const { cartReducer, draftKey, emptyCart, estimateCart, serializeDraft } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, parseReceipts, receiptsKey, receiptsReducer, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
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
const confirm = async () => {
  const button = byTest('flow-confirm') as HTMLButtonElement;
  expect(button).not.toBeNull();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  await flush();
};

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
/** One line of three strips at 1,500: a total of 4,500. */
const cartOf = (qty = 3, over: Partial<AddableItem> = {}): CartState => {
  const one = cartReducer(emptyCart(), { type: 'add', item: item(over) });
  return cartReducer(one, { type: 'qty', key: one.lines[0]!.key, qty });
};

const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: true, controlledMaxQty: 10, creditEnabled: true };
const PERMS = { discount: true, batchOverride: false, rx: true, credit: false };
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');
const LEGACY = draftKey('r1', 'b1', 'u1', 'IQD');
const ATTEMPT: SaleAttempt = { sig: 'old-sig', key: 'sale-key-0001', paymentKey: 'pay-key-0001', method: 'CASH', amountMinor: '5000', reference: '', fromHoldId: null };

function screenWith(list: Partial<OpenReceipt>[], over: Partial<ComponentProps<typeof CashierScreen>> = {}, active = 0) {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: list.map((r) => ({ ...newReceipt(), cart: cartOf(), ...r })), active }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, ...over }));
}
const stored = () => JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as { receipts: OpenReceipt[]; active: number };

const SALE = { id: 'sale-1', number: 'S-1', status: 'COMPLETED', branchId: 'b1', currency: 'IQD', subtotalMinor: '4500', discountMinor: '0', roundingMinor: '0', totalMinor: '4500', paidMinor: '5000', changeMinor: '500', lineCount: 1, completedAt: '2026-11-05T09:00:00Z', replayed: false };
const model = (payments: { method: 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL' | 'CREDIT'; amountMinor: bigint }[], copy = false) =>
  buildReceipt(
    {
      kind: 'sale',
      sale: { number: 'S-1', currency: 'IQD', at: new Date('2026-11-05T09:00:00Z'), subtotalMinor: 4500n, discountMinor: 0n, roundingMinor: 0n, totalMinor: 4500n, paidMinor: 5000n, changeMinor: 500n, cashierName: 'Sara', lines: [{ lineNo: 1, name: 'Panadol', strength: '500 mg', qty: 3, unitLabel: 'strip', unitPriceMinor: 1500n, discountMinor: 0n, totalMinor: 4500n, rxLevel: 'OTC' }], payments },
    },
    { width: '80', locale: 'en', copy, shop: { name: 'Shop' } },
  );
const receiptOf = (payments: Parameters<typeof model>[0], copy = false) => ({ ok: true, data: { html: '<p>receipt</p>', text: 'receipt', model: model(payments, copy), copyNumber: copy ? 1 : 0, replayed: false } });
const WORKSTATION = {
  paper: 'A4',
  marginMm: { top: 10, right: 10, bottom: 10, left: 10 },
  labelSize: '50x30',
  showPrice: true,
  receiptPrinter: { transport: 'NETWORK', address: '10.0.0.5:9100', paperWidth: 80, cut: true, drawerPin: 2, drawerOnCash: true },
};
const drawerFlags = () => (bridge.printDoc.mock.calls as unknown as [unknown, unknown, { drawer: boolean }][]).map((call) => call[2].drawer);
const CUSTOMER = { id: 'c1', name: 'Ali Hassan', currency: 'IQD', creditLimitMinor: '10000', balanceMinor: '2000', availableMinor: '8000', active: true };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('ph.print.workstation', 'Counter 1');
  for (const fn of [...Object.values(sales), ...Object.values(receipts), nav.refresh, customers.getCustomer, bridge.printDoc, bridge.kickDrawer]) fn.mockReset();
  bridge.printDoc.mockResolvedValue({ ok: true });
  sales.listHolds.mockResolvedValue({ ok: true, data: { items: [], hasMore: false } });
  print.getPrintSettings.mockResolvedValue({ ok: true, data: { print: { workstations: { 'Counter 1': WORKSTATION } } } });
  receipts.saleReceipt.mockResolvedValue(receiptOf([{ method: 'CASH', amountMinor: 5000n }]));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Pure parts -------------------------------------------------------------------------------------------------------------

describe('why Pay is held back', () => {
  const block = (cart: CartState, over: Partial<Parameters<typeof flowLogic.payBlockKey>[2]> = {}) =>
    flowLogic.payBlockKey(cart, estimateCart(cart, 'IQD', 0), { mayDispense: true, prescriptionId: null, controlledMaxQty: 10, controlledEnabled: true, ...over });

  it('lets a plain cart be paid', () => {
    expect(block(cartOf())).toBeNull();
  });
  it('names an empty receipt, a blocked line, a line with no price and a line over the stock', () => {
    expect(block(emptyCart())).toBe('pharmacy.sell.blocked.empty');
    const c = cartOf();
    expect(block({ ...c, lines: [{ ...c.lines[0]!, blocked: 'GONE' }] })).toBe('pharmacy.sell.blocked.heldLines');
    expect(block({ ...c, lines: [{ ...c.lines[0]!, units: [{ ...c.lines[0]!.units[0]!, priceMinor: null }] }] })).toBe('pharmacy.sell.blocked.unpriced');
    expect(block(cartOf(5, { sellableQty: 4 }))).toBe('pharmacy.cashier.blocked.overStock');
  });
  it('needs the recorded prescription for a controlled line, and the dispensing permission for any prescription line', () => {
    const controlled = cartOf(1, { rxLevel: 'RESTRICTED' });
    expect(block(controlled)).toBe('pharmacy.sell.blocked.rxMissing');
    expect(block(controlled, { prescriptionId: 'rx-1' })).toBeNull();
    expect(block(cartOf(1, { rxLevel: 'RX' }), { mayDispense: false })).toBe('pharmacy.sell.blocked.rx');
  });
});

describe('the credit payment', () => {
  it('puts the whole total on the account when nothing is paid now, and the rest when part is paid in cash', () => {
    expect(flowLogic.creditDraftOf({ method: 'CASH', now: '', reference: '' }, 'c1', 4500n, 'IQD')).toEqual({ method: 'CASH', tendered: '', reference: '', credit: { customerId: 'c1', amount: '4500' } });
    expect(flowLogic.creditDraftOf({ method: 'CASH', now: '1,000', reference: '' }, 'c1', 4500n, 'IQD')).toEqual({ method: 'CASH', tendered: '1000', reference: '', credit: { customerId: 'c1', amount: '3500' } });
    expect(flowLogic.creditDraftOf({ method: 'CASH', now: 'x', reference: '' }, 'c1', 4500n, 'IQD')).toBeNull();
  });
  it('builds the same request as the old screen: the cash part first, then CREDIT, each with its own key, and the customer', () => {
    const cart = cartOf();
    const draft = flowLogic.creditDraftOf({ method: 'CASH', now: '1000', reference: '' }, 'c1', 4500n, 'IQD')!;
    const attempt = { ...ATTEMPT, creditKey: 'credit-key-01' };
    const body = flowLogic.saleRequestOf(cart, 'IQD', attempt, draft, 1000n, { minor: 3500n }, null, 'hold-1');
    expect(body).toMatchObject({ clientKey: 'sale-key-0001', currency: 'IQD', customerId: 'c1', fromHoldId: 'hold-1' });
    expect(body!.payments).toEqual([
      { method: 'CASH', amountMinor: '1000', reference: '', clientKey: 'pay-key-0001' },
      { method: 'CREDIT', amountMinor: '3500', reference: '', clientKey: 'credit-key-01' },
    ]);
    const cash = flowLogic.saleRequestOf(cart, 'IQD', ATTEMPT, { method: 'CASH', tendered: '5000', reference: '' }, 5000n, null, 'rx-9', null);
    expect(cash!.payments).toEqual([{ method: 'CASH', amountMinor: '5000', reference: '', clientKey: 'pay-key-0001' }]);
    expect(cash).toMatchObject({ prescriptionId: 'rx-9' });
    expect(cash).not.toHaveProperty('customerId');
  });
});

describe('the sale attempt lives on its receipt', () => {
  const two = () => ({ receipts: [{ ...newReceipt(), key: 'a', cart: cartOf() }, { ...newReceipt(), key: 'b', cart: cartOf(2) }], active: 0 });

  it('is set on the receipt it was made for, cleared by a refusal, and a sale marks that receipt done without an attempt', () => {
    let s = receiptsReducer(two(), { type: 'attempt', receiptKey: 'b', attempt: ATTEMPT });
    expect(s.receipts.map((r) => r.attempt)).toEqual([null, ATTEMPT]);
    s = receiptsReducer(s, { type: 'attempt', receiptKey: 'b', attempt: null });
    expect(s.receipts[1]!.attempt).toBeNull();
    s = receiptsReducer(receiptsReducer(s, { type: 'attempt', receiptKey: 'a', attempt: ATTEMPT }), { type: 'sold', receiptKey: 'a' });
    expect(s.receipts[0]).toMatchObject({ done: true, attempt: null });
    expect(receiptsReducer(s, { type: 'attempt', receiptKey: 'a', attempt: ATTEMPT })).toBe(s);
  });

  it('is kept on the device with its receipt, and an old stored receipt without one reads as none', () => {
    const s = receiptsReducer(two(), { type: 'attempt', receiptKey: 'b', attempt: { ...ATTEMPT, creditKey: 'credit-key-01', credit: { customerId: 'c1', amount: '3000' } } });
    expect(parseReceipts(serializeReceipts(s), null)).toEqual(s);
    const old = JSON.parse(serializeReceipts(two())) as { receipts: Record<string, unknown>[] };
    for (const r of old.receipts) delete r.attempt;
    expect(parseReceipts(JSON.stringify(old), null).receipts.map((r) => r.attempt)).toEqual([null, null]);
    const damaged = JSON.parse(serializeReceipts(s)) as { receipts: Record<string, unknown>[] };
    damaged.receipts[1]!.attempt = { key: 'x' };
    expect(parseReceipts(JSON.stringify(damaged), null).receipts[1]).toMatchObject({ attempt: null, key: 'b' });
  });

  it('moves a legacy single-cart draft with a sale in flight into receipt 1, attempt and all', () => {
    const legacy = serializeDraft('IQD', cartOf(), ATTEMPT, 'hold-1', null);
    expect(cashierLogic.migratableDraft(legacy)).toBe(legacy);
    const moved = cashierLogic.restoreReceipts(null, legacy);
    expect(moved.migrated).toBe(true);
    expect(moved.state.receipts[0]).toMatchObject({ attempt: ATTEMPT, fromHoldId: 'hold-1' });
  });
});

// The screen -------------------------------------------------------------------------------------------------------------

describe('the cash flow', () => {
  it('opens inline with F2 (taken from the browser only when it acts), shows the change due and the cash shortcuts', () => {
    screenWith([{ cart: emptyCart() }]);
    expect(press({ key: 'F2' }).defaultPrevented).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{}]);
    expect(press({ key: 'F2' }).defaultPrevented).toBe(true);
    expect(byTest('work-panel')!.getAttribute('data-flow')).toBe('cash');
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
    expect(byTest('pay-cash')!.getAttribute('aria-pressed')).toBe('true');
    expect(allTest('flow-quick').map((b) => b.textContent)).toEqual(['5,000', '10,000', '25,000', '50,000']);
    typeIn('flow-tendered', '5000');
    expect(byTest('flow-change')!.textContent).toContain('500');
    typeIn('flow-tendered', '4000');
    expect(byTest('flow-change')!.textContent).toContain('Short');
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
    click(allTest('flow-quick')[1]!);
    expect((byTest('flow-tendered') as HTMLInputElement).value).toBe('10000');
    expect(byTest('flow-change')!.textContent).toContain('5,500');
    press({ key: 'Escape' });
    expect(byTest('work-panel')!.getAttribute('data-flow')).toBe('idle');
  });

  it('F3 opens credit only with the permission', () => {
    screenWith([{}]);
    expect(press({ key: 'F3' }).defaultPrevented).toBe(false);
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{}], { perms: { ...PERMS, credit: true } });
    expect(press({ key: 'F3' }).defaultPrevented).toBe(true);
    expect(byTest('work-panel')!.getAttribute('data-flow')).toBe('credit');
    expect(byTest('flow-need-customer')).not.toBeNull();
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['a blocked line', () => ({ ...cartOf(), lines: [{ ...cartOf().lines[0]!, blocked: 'GONE' as const }] }), 'cannot be sold'],
    ['a line over the stock', () => cartOf(5, { sellableQty: 4 }), 'more than'],
    ['a controlled line without its prescription', () => cartOf(1, { rxLevel: 'RESTRICTED' }), 'prescription'],
  ])('holds Pay back with %s and says why', (_name, cart, words) => {
    screenWith([{ cart: cart() }]);
    press({ key: 'F2' });
    expect(byTest('flow-blocked')!.textContent!.toLowerCase()).toContain(words);
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a sale', () => {
  it('sends the old request, marks the tab done, shows the receipt inline, refreshes the shift figures and opens the drawer for cash', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    screenWith([{}]);
    press({ key: 'F2' });
    typeIn('flow-tendered', '5000');
    await confirm();
    expect(sales.createSale).toHaveBeenCalledTimes(1);
    const body = sales.createSale.mock.calls[0]![0] as { clientKey: string; payments: { method: string; amountMinor: string; clientKey: string }[]; lines: unknown[] };
    expect(body.clientKey).toMatch(/^sale-/);
    expect(body.payments).toEqual([{ method: 'CASH', amountMinor: '5000', reference: '', clientKey: expect.stringMatching(/^pay-/) }]);
    expect(body.lines).toEqual([{ productId: 'p1', unitId: 'strip', qty: 3 }]);
    expect(byTest('work-panel')!.getAttribute('data-flow')).toBe('receipt');
    expect(byTest('sale-total')!.textContent).toContain('4,500');
    expect(byTest('sale-change')!.textContent).toContain('500');
    expect(byTest('receipt-tab')!.textContent).toContain('Paid');
    expect(stored().receipts.every((r) => r.attempt === null)).toBe(true);
    expect(nav.refresh).toHaveBeenCalled();
    expect(drawerFlags()).toEqual([true]);
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
    // The next receipt replaces the done one.
    click(byTest('receipt-next'));
    expect(allTest('receipt-tab')).toHaveLength(1);
    expect(byTest('receipt-tab')!.textContent).not.toContain('Paid');
    expect(byTest('work-panel')!.getAttribute('data-flow')).toBe('idle');
  });

  it('never opens the drawer for a card-only sale, nor for a copy', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: { ...SALE, paidMinor: '4500', changeMinor: '0' } });
    receipts.saleReceipt.mockResolvedValue(receiptOf([{ method: 'CARD_MANUAL', amountMinor: 4500n }]));
    receipts.reprintReceipt.mockResolvedValue(receiptOf([{ method: 'CASH', amountMinor: 5000n }], true));
    screenWith([{}]);
    press({ key: 'F2' });
    click(byTest('pay-method-CARD_MANUAL'));
    await confirm();
    expect((sales.createSale.mock.calls[0]![0] as { payments: { method: string }[] }).payments[0]!.method).toBe('CARD_MANUAL');
    expect(drawerFlags()).toEqual([false]);
    await act(async () => byTest('receipt-reprint')!.click());
    await flush();
    expect(receipts.reprintReceipt).toHaveBeenCalledTimes(1);
    expect(drawerFlags()).toEqual([false, false]);
  });

  it('prints nothing and opens no drawer when "no print" is ticked', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    screenWith([{}]);
    press({ key: 'F2' });
    click(byTest('flow-no-print'));
    await confirm();
    expect(byTest('receipt-no-print')).not.toBeNull();
    expect(bridge.printDoc).not.toHaveBeenCalled();
  });

  it('retries a lost answer with the same keys, kept on the receipt across a reload, so the sale is recorded once', async () => {
    sales.createSale.mockRejectedValueOnce(new TypeError('fetch failed'));
    screenWith([{}]);
    press({ key: 'F2' });
    typeIn('flow-tendered', '5000');
    await confirm();
    expect(byTest('flow-problem')!.textContent).toContain('may or may not');
    const first = sales.createSale.mock.calls[0]![0] as { clientKey: string; payments: { clientKey: string }[] };
    expect(stored().receipts[0]!.attempt).toMatchObject({ key: first.clientKey, paymentKey: first.payments[0]!.clientKey, amountMinor: '5000' });
    // A reload: the attempt comes back on its receipt and the payment is filled in as it was sent.
    act(() => root.unmount());
    root = createRoot(container);
    mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS }));
    expect(byTest('attempt-unknown')).not.toBeNull();
    press({ key: 'F2' });
    expect((byTest('flow-tendered') as HTMLInputElement).value).toBe('5000');
    sales.createSale.mockResolvedValueOnce({ ok: true, data: { ...SALE, replayed: true } });
    await confirm();
    expect(sales.createSale).toHaveBeenCalledTimes(2);
    const second = sales.createSale.mock.calls[1]![0] as typeof first;
    expect(second.clientKey).toBe(first.clientKey);
    expect(second.payments[0]!.clientKey).toBe(first.payments[0]!.clientKey);
    expect(byTest('sale-done')!.textContent).toContain('already');
    expect(byTest('receipt-tab')!.textContent).toContain('Paid');
  });

  it('drops the attempt on a refusal, so the next try is a new sale with new keys', async () => {
    sales.createSale.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'Not enough stock', fields: { phCode: 'NOT_ENOUGH_STOCK' } } });
    screenWith([{}]);
    press({ key: 'F2' });
    await confirm();
    expect(byTest('flow-problem')).not.toBeNull();
    expect(stored().receipts[0]!.attempt).toBeNull();
    sales.createSale.mockResolvedValueOnce({ ok: true, data: SALE });
    await confirm();
    const [a, b] = sales.createSale.mock.calls.map((c) => (c[0] as { clientKey: string }).clientKey);
    expect(a).not.toBe(b);
  });

  it.each([
    ['HOLD_EXPIRED', 'This held cart has expired', 'pay now as a new sale'],
    ['HOLD_NOT_AVAILABLE', 'This held cart was already used or discarded', 'check the sales list'],
  ])('lets go of a dead hold (%s) but keeps the lines, so the next Pay is a plain sale with new keys', async (phCode, message, said) => {
    sales.createSale.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message, fields: { phCode } } });
    screenWith([{ fromHoldId: 'hold-1' }]);
    press({ key: 'F2' });
    await confirm();
    const first = sales.createSale.mock.calls[0]![0] as { clientKey: string; fromHoldId?: string };
    expect(first.fromHoldId).toBe('hold-1');
    expect(byTest('flow-problem')!.textContent).toContain(said);
    // The refusal recorded nothing: the attempt is gone, and so is the dead hold; the lines stay.
    expect(stored().receipts[0]).toMatchObject({ attempt: null, fromHoldId: null });
    expect(stored().receipts[0]!.cart.lines).toHaveLength(1);
    sales.createSale.mockResolvedValueOnce({ ok: true, data: SALE });
    await confirm();
    const second = sales.createSale.mock.calls[1]![0] as typeof first;
    expect(second).not.toHaveProperty('fromHoldId');
    expect(second.clientKey).not.toBe(first.clientKey);
    expect(byTest('receipt-tab')!.textContent).toContain('Paid');
  });

  it('keeps the hold on any other refusal', async () => {
    sales.createSale.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'Not enough stock', fields: { phCode: 'NOT_ENOUGH_STOCK' } } });
    screenWith([{ fromHoldId: 'hold-1' }]);
    press({ key: 'F2' });
    await confirm();
    expect(stored().receipts[0]).toMatchObject({ attempt: null, fromHoldId: 'hold-1' });
  });

  it('restores an attempt on the receipt it belongs to, not on the others', () => {
    screenWith([{ key: 'rc-one' }, { key: 'rc-two', attempt: ATTEMPT }], {}, 0);
    expect(byTest('attempt-unknown')).toBeNull();
    press({ key: '2', altKey: true });
    expect(byTest('attempt-unknown')).not.toBeNull();
    // Asked for cash on the receipt whose attempt was credit or cash, the flow is the attempt's own, filled in as it was sent.
    press({ key: 'F2' });
    expect((byTest('flow-tendered') as HTMLInputElement).value).toBe('5000');
    press({ key: '1', altKey: true });
    expect(byTest('attempt-unknown')).toBeNull();
  });

  it('moves a legacy draft with a sale in flight into the tabs with its attempt and deletes the old key', async () => {
    window.localStorage.setItem(LEGACY, serializeDraft('IQD', cartOf(), ATTEMPT, null, null));
    mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS }));
    expect(byTest('attempt-unknown')).not.toBeNull();
    expect(window.localStorage.getItem(LEGACY)).toBeNull();
    expect(stored().receipts[0]!.attempt).toMatchObject({ key: ATTEMPT.key });
  });
});

describe('a credit sale', () => {
  it('takes part in cash now and the rest on the account, and the cash part opens the drawer', async () => {
    customers.getCustomer.mockResolvedValue({ ok: true, data: CUSTOMER });
    sales.createSale.mockResolvedValue({ ok: true, data: { ...SALE, paidMinor: '4500', changeMinor: '0' } });
    receipts.saleReceipt.mockResolvedValue(receiptOf([{ method: 'CASH', amountMinor: 1000n }, { method: 'CREDIT', amountMinor: 3500n }]));
    screenWith([{ customerId: 'c1' }], { perms: { ...PERMS, credit: true } });
    press({ key: 'F3' });
    await flush();
    expect(customers.getCustomer).toHaveBeenCalledWith({ customerId: 'c1' });
    expect(byTest('flow-debt')!.textContent).toContain('4,500');
    typeIn('flow-now', '1000');
    expect(byTest('flow-debt')!.textContent).toContain('3,500');
    typeIn('flow-now', '');
    typeIn('flow-now', '0');
    typeIn('flow-now', '1000');
    await confirm();
    const body = sales.createSale.mock.calls[0]![0] as { customerId: string; payments: { method: string; amountMinor: string; clientKey: string }[] };
    expect(body.customerId).toBe('c1');
    expect(body.payments.map((p) => [p.method, p.amountMinor])).toEqual([
      ['CASH', '1000'],
      ['CREDIT', '3500'],
    ]);
    expect(new Set(body.payments.map((p) => p.clientKey)).size).toBe(2);
    expect(byTest('sale-credit')!.textContent).toContain('3,500');
    expect(drawerFlags()).toEqual([true]);
  });

  it('refuses a debt above the customer’s room before anything is sent', async () => {
    customers.getCustomer.mockResolvedValue({ ok: true, data: { ...CUSTOMER, balanceMinor: '9000', availableMinor: '1000' } });
    screenWith([{ customerId: 'c1' }], { perms: { ...PERMS, credit: true } });
    press({ key: 'F3' });
    await flush();
    expect(byTest('flow-debt')!.textContent).toContain('limit');
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
    typeIn('flow-now', '3500');
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(false);
    expect(sales.createSale).not.toHaveBeenCalled();
  });
});

// Fix round 1: the receipt is frozen while it is being paid ------------------------------------------------------------

const setSearch = (text: string) => typeIn('cashier-search', text);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const qtyOf = () => allTest('sale-line').map((r) => r.querySelectorAll('td')[3]!.querySelector('input')?.value);
const startPay = async () => {
  press({ key: 'F2' });
  const button = byTest('flow-confirm') as HTMLButtonElement;
  await act(async () => button.click());
};

describe('the frozen receipt (pure)', () => {
  const state = () => ({ receipts: [{ ...newReceipt(), key: 'a', cart: cartOf(), attempt: ATTEMPT }, { ...newReceipt(), key: 'b', cart: cartOf() }], active: 0 });

  it('ignores every change to the lines or the customer of a receipt with an attempt, and nothing else', () => {
    const s = state();
    const line = s.receipts[0]!.cart.lines[0]!.key;
    expect(cashierLogic.frozenEdit(s, { type: 'line', action: { type: 'qty', key: line, qty: 9 } })).toBe(true);
    expect(cashierLogic.cashierReducer(s, { type: 'line', action: { type: 'qty', key: line, qty: 9 } })).toBe(s);
    expect(cashierLogic.cashierReducer(s, { type: 'line', action: { type: 'add', item: item({ productId: 'p2' }) } })).toBe(s);
    expect(cashierLogic.cashierReducer(s, { type: 'cart', cart: emptyCart() })).toBe(s);
    expect(cashierLogic.cashierReducer(s, { type: 'customer', customerId: 'c9' })).toBe(s);
    expect(cashierLogic.frozenEdit(s, { type: 'customer', customerId: null })).toBe(false);
    const other = { ...s, active: 1 };
    const otherLine = other.receipts[1]!.cart.lines[0]!.key;
    expect(cashierLogic.frozenEdit(other, { type: 'line', action: { type: 'qty', key: otherLine, qty: 9 } })).toBe(false);
    expect(cashierLogic.cashierReducer(other, { type: 'line', action: { type: 'qty', key: otherLine, qty: 9 } }).receipts[1]!.cart.lines[0]!.qty).toBe(9);
    const freed = cashierLogic.cashierReducer(s, { type: 'attempt', receiptKey: 'a', attempt: null });
    expect(cashierLogic.cashierReducer(freed, { type: 'line', action: { type: 'qty', key: line, qty: 9 } }).receipts[0]!.cart.lines[0]!.qty).toBe(9);
  });
});

describe('the frozen receipt (screen)', () => {
  it('refuses scans, keys and the keypad while the sale is being sent, then sells exactly the paid lines', async () => {
    const answer = deferred<unknown>();
    sales.createSale.mockReturnValue(answer.promise);
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [{ ...item({ productId: 'p2', tradeName: 'Brufen', code: '999' }), matchedOn: 'barcode', notSellable: false, noPrice: false }] } });
    screenWith([{}]);
    press({ key: 'ArrowDown' });
    await startPay();
    const sent = sales.createSale.mock.calls[0]![0] as { lines: unknown[] };
    setSearch('999');
    await act(async () => {
      byTest('cashier-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await flush();
    expect(byTest('cashier-message')!.textContent).toContain('F4');
    press({ key: '+' });
    press({ key: 'Delete' });
    click(allTest('key-digit').find((b) => b.textContent === '7')!);
    click(byTest('keypad-enter'));
    expect(qtyOf()).toEqual(['3']);
    expect(byTest('flow-attempt')).toBeNull();
    await act(async () => answer.resolve({ ok: true, data: SALE }));
    await flush();
    expect(byTest('receipt-tab')!.textContent).toContain('Paid');
    expect(qtyOf()).toEqual(['3']);
    expect(sent.lines).toEqual([{ productId: 'p1', unitId: 'strip', qty: 3 }]);
  });

  it('keeps another receipt editable and holds its Confirm back with a reason while a sale is in flight', async () => {
    sales.createSale.mockReturnValue(deferred<unknown>().promise);
    screenWith([{ key: 'rc-a' }, { key: 'rc-b' }]);
    await startPay();
    press({ key: '2', altKey: true });
    press({ key: 'ArrowDown' });
    press({ key: '+' });
    expect(qtyOf()).toEqual(['4']);
    press({ key: 'F2' });
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(byTest('flow-blocked')!.textContent).toContain('another receipt');
  });

  it('after a lost answer stays frozen, retries with the same keys, or lets the attempt go with an armed two-tap and a warning', async () => {
    sales.createSale.mockRejectedValue(new TypeError('fetch failed'));
    screenWith([{}]);
    await startPay();
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: '+' });
    expect(qtyOf()).toEqual(['3']);
    await act(async () => byTest('flow-retry')!.click());
    await flush();
    const [a, b] = sales.createSale.mock.calls.map((c) => c[0] as { clientKey: string; payments: { clientKey: string }[] });
    expect(b!.clientKey).toBe(a!.clientKey);
    expect(b!.payments[0]!.clientKey).toBe(a!.payments[0]!.clientKey);
    click(byTest('flow-discard'));
    expect(stored().receipts[0]!.attempt).not.toBeNull();
    expect(byTest('flow-discard-warning')!.textContent).toContain('Sales');
    click(byTest('flow-discard'));
    expect(stored().receipts[0]!.attempt).toBeNull();
    // Unfrozen, but the cash panel is still open: + changes nothing until it is closed (round 3, M1).
    press({ key: '+' });
    expect(qtyOf()).toEqual(['3']);
    press({ key: 'Escape' });
    press({ key: '+' });
    expect(qtyOf()).toEqual(['4']);
    press({ key: 'F2' });
    sales.createSale.mockResolvedValueOnce({ ok: true, data: SALE });
    await confirm();
    expect((sales.createSale.mock.calls[2]![0] as { clientKey: string }).clientKey).not.toBe(a!.clientKey);
  });

  it('keeps the receipt frozen while moved prices are read again, then fits the current lines to them', async () => {
    sales.createSale.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'short', fields: { phCode: 'PAYMENT_SHORT', totalMinor: '6000' } } });
    const fresh = deferred<unknown>();
    sales.sellSearch.mockReturnValue(fresh.promise);
    screenWith([{}]);
    await startPay();
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: '+' });
    expect(qtyOf()).toEqual(['3']);
    await act(async () => fresh.resolve({ ok: true, data: { items: [{ ...item({ units: [{ id: 'strip', label: 'strip', baseQty: 1, priceMinor: '2000' }] }), matchedOn: 'id', notSellable: false, noPrice: false }] } }));
    await flush();
    expect(byTest('flow-problem')!.textContent).toContain('6,000');
    expect(stored().receipts[0]!.attempt).toBeNull();
    expect(byTest('receipt-tab')!.textContent).toContain('6,000');
    press({ key: '+' });
    expect(qtyOf()).toEqual(['3']);
    press({ key: 'Escape' });
    press({ key: '+' });
    expect(qtyOf()).toEqual(['4']);
  });
});

describe('no print', () => {
  it('opens the drawer without paper for a cash sale', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    screenWith([{}]);
    press({ key: 'F2' });
    click(byTest('flow-no-print'));
    await confirm();
    expect(bridge.printDoc).not.toHaveBeenCalled();
    expect(bridge.kickDrawer).toHaveBeenCalledTimes(1);
    expect(byTest('receipt-no-print')).not.toBeNull();
  });

  it('does neither for a card-only sale', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    receipts.saleReceipt.mockResolvedValue(receiptOf([{ method: 'CARD_MANUAL', amountMinor: 4500n }]));
    screenWith([{}]);
    press({ key: 'F2' });
    click(byTest('pay-method-CARD_MANUAL'));
    click(byTest('flow-no-print'));
    await confirm();
    expect(bridge.printDoc).not.toHaveBeenCalled();
    expect(bridge.kickDrawer).not.toHaveBeenCalled();
  });

  it('does not carry over to the next sale', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    screenWith([{}, {}]);
    press({ key: 'F2' });
    click(byTest('flow-no-print'));
    await confirm();
    press({ key: '2', altKey: true });
    press({ key: 'F2' });
    expect((byTest('flow-no-print') as HTMLInputElement).checked).toBe(false);
  });
});

// Fix round 2: a stuck sale can only be retried or explicitly discarded --------------------------------------------------

type SentSale = { clientKey: string; payments: { method: string; amountMinor: string; reference: string; clientKey: string }[] };
const sentAt = (i: number) => sales.createSale.mock.calls[i]![0] as SentSale;
const confirmButton = () => byTest('flow-confirm') as HTMLButtonElement;
const lostSale = async () => {
  sales.createSale.mockRejectedValue(new TypeError('fetch failed'));
};

describe('the stuck sale (pure)', () => {
  const OTHER: SaleAttempt = { ...ATTEMPT, sig: 'new-sig', key: 'sale-key-0002', paymentKey: 'pay-key-0002' };
  const one = () => ({ receipts: [{ ...newReceipt(), key: 'a', cart: cartOf(), attempt: ATTEMPT }], active: 0 });

  it('never lets an attempt of another signature replace the pending one; only refused, sold and an explicit discard clear it', () => {
    const s = one();
    expect(receiptsReducer(s, { type: 'attempt', receiptKey: 'a', attempt: OTHER })).toBe(s);
    expect(cashierLogic.cashierReducer(s, { type: 'attempt', receiptKey: 'a', attempt: OTHER })).toBe(s);
    expect(receiptsReducer(s, { type: 'attempt', receiptKey: 'a', attempt: { ...ATTEMPT } }).receipts[0]!.attempt).toEqual(ATTEMPT);
    expect(receiptsReducer(s, { type: 'attempt', receiptKey: 'a', attempt: null }).receipts[0]!.attempt).toBeNull();
    expect(receiptsReducer(s, { type: 'refused', receiptKey: 'a' }).receipts[0]!.attempt).toBeNull();
    expect(receiptsReducer(s, { type: 'sold', receiptKey: 'a' }).receipts[0]).toMatchObject({ done: true, attempt: null });
    const freed = receiptsReducer(s, { type: 'attempt', receiptKey: 'a', attempt: null });
    expect(receiptsReducer(freed, { type: 'attempt', receiptKey: 'a', attempt: OTHER }).receipts[0]!.attempt).toEqual(OTHER);
  });

  it('marks a receipt with an attempt done only through the sale', () => {
    const s = one();
    expect(cashierLogic.frozenEdit(s, { type: 'done' })).toBe(true);
    expect(cashierLogic.cashierReducer(s, { type: 'done' })).toBe(s);
    expect(cashierLogic.cashierReducer(s, { type: 'sold', receiptKey: 'a' }).receipts[0]!.done).toBe(true);
  });

  it('keeps an attempt for the largest possible sale through the device round trip', async () => {
    const { saleSignature, saleAttemptFor, MAX_LINES, MAX_SIG_LENGTH } = await import('@/app/pharmacy/_ui/sell-logic');
    const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const base = cartOf(999).lines[0]!;
    const reason = '"'.repeat(300);
    const lines = Array.from({ length: MAX_LINES }, (_, i) => ({
      ...base,
      key: `line-${i}`,
      productId: uuid(i),
      units: [{ ...base.units[0]!, id: uuid(100_000 + i) }],
      unitId: uuid(100_000 + i),
      batchId: uuid(200_000 + i),
      batchLot: 'L'.repeat(40),
      batchReason: reason,
      discount: { kind: 'percent' as const, value: '10' },
    }));
    const cart: CartState = { ...cartOf(), lines, discountReason: reason, invoiceDiscount: { kind: 'percent', value: '5' } };
    const draft = { method: 'TRANSFER_MANUAL' as const, tendered: '', reference: 'R'.repeat(200), credit: { customerId: uuid(9), amount: '999999999999' } };
    const sig = saleSignature(cart, 'IQD', draft, 999_999_999_999n, uuid(7), uuid(8))!;
    expect(sig.length).toBeGreaterThan(100_000);
    expect(sig.length).toBeLessThanOrEqual(MAX_SIG_LENGTH);
    const attempt = saleAttemptFor(null, sig, draft, 999_999_999_999n, uuid(7), undefined, uuid(8));
    const back = parseReceipts(serializeReceipts({ receipts: [{ ...newReceipt(), cart, attempt }], active: 0 }), null);
    expect(back.receipts[0]!.attempt).toEqual(attempt);
  });
});

describe('the stuck sale (screen)', () => {
  it('locks the cash fields, method and quick cash; Confirm sends the same keys again; Discard frees them for a new sale', async () => {
    await lostSale();
    screenWith([{}]);
    press({ key: 'F2' });
    typeIn('flow-tendered', '5000');
    await confirm();
    const before = stored().receipts[0]!.attempt;
    typeIn('flow-tendered', '9000');
    expect((byTest('flow-tendered') as HTMLInputElement).value).toBe('5000');
    expect((byTest('flow-tendered') as HTMLInputElement).readOnly).toBe(true);
    expect(allTest('flow-quick').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect((byTest('pay-method-CARD_MANUAL') as HTMLButtonElement).disabled).toBe(true);
    click(byTest('pay-method-CARD_MANUAL'));
    expect(byTest('pay-method-CASH')!.getAttribute('aria-pressed')).toBe('true');
    expect(stored().receipts[0]!.attempt).toEqual(before);
    expect(confirmButton().textContent).toContain('Send again');
    await confirm();
    expect(sentAt(1)).toEqual(sentAt(0));
    click(byTest('flow-discard'));
    click(byTest('flow-discard'));
    expect((byTest('flow-tendered') as HTMLInputElement).readOnly).toBe(false);
    typeIn('flow-tendered', '6000');
    sales.createSale.mockResolvedValueOnce({ ok: true, data: SALE });
    await confirm();
    expect(sentAt(2).clientKey).not.toBe(sentAt(0).clientKey);
    expect(sentAt(2).payments[0]!.amountMinor).toBe('6000');
  });

  it('locks the reference of a card payment while stuck', async () => {
    await lostSale();
    screenWith([{}]);
    press({ key: 'F2' });
    click(byTest('pay-method-CARD_MANUAL'));
    typeIn('flow-reference', 'R1');
    await confirm();
    typeIn('flow-reference', 'R2');
    expect((byTest('flow-reference') as HTMLInputElement).value).toBe('R1');
    await confirm();
    expect(sentAt(1)).toEqual(sentAt(0));
    expect(sentAt(1).payments[0]!.reference).toBe('R1');
  });

  it('locks the credit fields while stuck and Confirm sends the same three keys again', async () => {
    customers.getCustomer.mockResolvedValue({ ok: true, data: CUSTOMER });
    await lostSale();
    screenWith([{ customerId: 'c1' }], { perms: { ...PERMS, credit: true } });
    press({ key: 'F3' });
    await flush();
    typeIn('flow-now', '1000');
    await confirm();
    typeIn('flow-now', '2000');
    expect((byTest('flow-now') as HTMLInputElement).value).toBe('1000');
    expect((byTest('pay-method-CARD_MANUAL') as HTMLButtonElement).disabled).toBe(true);
    await confirm();
    expect(sentAt(1)).toEqual(sentAt(0));
  });

  it('comes back disarmed after Retry and after a new lost answer', async () => {
    await lostSale();
    screenWith([{}]);
    await startPay();
    await flush();
    click(byTest('flow-discard'));
    expect(byTest('flow-discard')!.getAttribute('aria-pressed')).toBe('true');
    await act(async () => byTest('flow-retry')!.click());
    await flush();
    expect(byTest('flow-discard')!.getAttribute('aria-pressed')).toBe('false');
    expect(byTest('flow-discard-warning')).toBeNull();
    click(byTest('flow-discard'));
    await confirm();
    expect(byTest('flow-discard')!.getAttribute('aria-pressed')).toBe('false');
    expect(stored().receipts[0]!.attempt).not.toBeNull();
  });

  it('holds Retry and Discard back, with the reason, while another receipt is sending', async () => {
    await lostSale();
    screenWith([{ key: 'rc-a' }, { key: 'rc-b' }]);
    await startPay();
    await flush();
    sales.createSale.mockReturnValue(deferred<unknown>().promise);
    press({ key: '2', altKey: true });
    await startPay();
    press({ key: '1', altKey: true });
    press({ key: 'F2' });
    const discard = byTest('flow-discard') as HTMLButtonElement;
    expect(discard.disabled).toBe(true);
    expect((byTest('flow-retry') as HTMLButtonElement).disabled).toBe(true);
    expect(byTest('flow-blocked')!.textContent).toContain('another receipt');
    expect(document.getElementById(discard.getAttribute('aria-describedby') ?? '')?.textContent).toContain('another receipt');
    expect(stored().receipts.find((r) => r.key === 'rc-a')!.attempt).not.toBeNull();
  });
});

describe('no print across receipts', () => {
  it('a finished sale clears only the tick it took', async () => {
    const answer = deferred<unknown>();
    sales.createSale.mockReturnValue(answer.promise);
    screenWith([{ key: 'rc-a' }, { key: 'rc-b' }]);
    await startPay();
    press({ key: '2', altKey: true });
    press({ key: 'F2' });
    click(byTest('flow-no-print'));
    await act(async () => answer.resolve({ ok: true, data: SALE }));
    await flush();
    expect((byTest('flow-no-print') as HTMLInputElement).checked).toBe(true);
  });
});
