// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The cashier's inquiry mode (F7), the three panels under the sale lines (batches nearest expiry first, item details,
 * substitutes by active ingredient) and the return mode against an original sale (plan Task 10). Inquiry never touches a
 * receipt unless "add" is chosen; a return goes through the existing return actions, prints a return slip and never opens
 * the drawer.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/pharmacy/sell' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), sellInfo: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn(), listSales: vi.fn() }));
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
const panels = await import('@/app/pharmacy/_ui/cashier/panels-logic');
const { cartReducer, emptyCart } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
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
const typeIn = (testId: string, text: string, el?: HTMLInputElement) => {
  const field = el ?? (byTest(testId) as HTMLInputElement);
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

const item = (over: Partial<AddableItem> = {}): AddableItem => ({
  productId: 'p1',
  tradeName: 'Panadol',
  code: '6221010001',
  strength: '500 mg',
  form: 'tablet',
  packLabel: 'pack of 2 strips',
  rxLevel: 'OTC',
  matchedUnitId: null,
  sellableQty: 25,
  units: [
    { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '150' },
    { id: 'strip', label: 'strip', baseQty: 10, priceMinor: '1500' },
    { id: 'pack', label: 'pack', baseQty: 20, priceMinor: '2900' },
  ],
  batches: [{ batchId: 'b1', lot: 'L1', expiryDate: '2027-03-31', available: 25 }],
  ...over,
});
const sellItem = (over: Partial<AddableItem> & { notSellable?: boolean; noPrice?: boolean; matchedOn?: string } = {}) => ({ genericName: '', matchedOn: 'tradeName', notSellable: false, noPrice: false, ...item(over), ...over });
const ADOL = sellItem({ productId: 'p2', tradeName: 'Adol', code: '6290000002', sellableQty: 60, units: [{ id: 'a-strip', label: 'strip', baseQty: 10, priceMinor: '1250' }] });
const INFO = (productId = 'p1', over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    productId,
    currency: 'IQD',
    batches: [
      { batchId: 'bx', lot: 'OLD1', expiryDate: '2026-10-31', available: 2, expired: true, near: false, sellable: false },
      { batchId: 'b1', lot: 'L1', expiryDate: '2026-12-31', available: 5, expired: false, near: true, sellable: true },
      { batchId: 'b2', lot: 'L2', expiryDate: '2027-03-31', available: 20, expired: false, near: false, sellable: true },
    ],
    details: { code: '6221010001', genericName: 'Paracetamol', activeIngredient: 'Paracetamol', lastSales: [{ unitLabel: 'strip', unitPriceMinor: '1500', at: '2026-11-04T10:00:00Z' }, { unitLabel: 'strip', unitPriceMinor: '1400', at: '2026-11-03T10:00:00Z' }], lastPurchase: { at: '2026-10-04', supplierName: 'Al-Hakim' } },
    substitutes: productId === 'p1' ? [ADOL] : [],
    ...over,
  },
});

const cartOf = (qty = 3, over: Partial<AddableItem> = {}): CartState => {
  const one = cartReducer(emptyCart(), { type: 'add', item: item(over), unitId: 'strip' });
  return cartReducer(one, { type: 'qty', key: one.lines[0]!.key, qty });
};
const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: true, controlledMaxQty: 10, creditEnabled: true };
const PERMS = { discount: true, batchOverride: false, rx: true, credit: false };
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');
const ATTEMPT: SaleAttempt = { sig: 'old-sig', key: 'sale-key-0001', paymentKey: 'pay-key-0001', method: 'CASH', amountMinor: '5000', reference: '', fromHoldId: null };

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
  for (const fn of [...Object.values(sales), ...Object.values(returns), ...Object.values(receipts), bridge.printDoc, bridge.kickDrawer]) fn.mockReset();
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

// Pure parts -------------------------------------------------------------------------------------------------------------

describe('panel wording (pure)', () => {
  it('reads an expiry as month/year and the stock as packs and pieces', () => {
    expect(panels.expiryText('2027-03-31')).toBe('03/2027');
    expect(panels.stockBreakdown(25, item().units)).toEqual({ total: 25, baseLabel: 'tablet', pack: { count: 1, label: 'pack', rest: 5 } });
    expect(panels.stockBreakdown(7, [{ id: 'u', label: 'box', baseQty: 1, priceMinor: '1' }])).toEqual({ total: 7, baseLabel: 'box', pack: null });
  });

  it('marks the batch the line takes: its chosen batch, else the first sellable one', () => {
    const batches = INFO().data.batches;
    expect(panels.lineBatchId({ batchId: null }, batches)).toBe('b1');
    expect(panels.lineBatchId({ batchId: 'b2' }, batches)).toBe('b2');
    expect(panels.lineBatchId({ batchId: null }, [batches[0]!])).toBeNull();
  });
});

// Inquiry ----------------------------------------------------------------------------------------------------------------

describe('inquiry mode (F7)', () => {
  it('toggles with F7 and the button, taking F7 from the browser each time it acts', () => {
    screenWith([{ cart: emptyCart() }]);
    expect(byTest('inquiry-panel')).toBeNull();
    expect(press({ key: 'F7' }).defaultPrevented).toBe(true);
    expect(byTest('inquiry-panel')).not.toBeNull();
    expect(byTest('inquiry-mode')!.textContent).toContain('not added to the receipt');
    expect(byTest('inquiry-empty')).not.toBeNull();
    expect(press({ key: 'F7' }).defaultPrevented).toBe(true);
    expect(byTest('inquiry-panel')).toBeNull();
    click(byTest('inquiry-button'));
    expect(byTest('inquiry-panel')).not.toBeNull();
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
  });

  it('leaves F7 to the browser while the shift is closed (nothing acts)', () => {
    window.localStorage.setItem(STORE, serializeReceipts({ receipts: [newReceipt()], active: 0 }));
    mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: null, settings: SETTINGS, perms: PERMS }));
    expect(press({ key: 'F7' }).defaultPrevented).toBe(false);
  });

  it('shows the price ladder, stock, batches and substitutes of a typed item and adds nothing to the receipt', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem()] } });
    screenWith([{}]);
    await flush();
    const before = JSON.stringify(stored().receipts.map((r) => r.cart));
    press({ key: 'F7' });
    typeIn('cashier-search', 'Panadol');
    enter();
    await flush();
    const panel = byTest('inquiry-panel')!;
    expect(byTest('inquiry-name')!.textContent).toContain('Panadol');
    expect(allTest('inquiry-price').map((p) => p.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['tablet 150 IQD', 'strip 1,500 IQD', 'pack 2,900 IQD']);
    expect(byTest('inquiry-stock')!.textContent).toMatch(/25.*tablet.*1.*pack.*5/);
    expect(allTest('inquiry-batch').map((b) => b.textContent)).toEqual([expect.stringContaining('expired'), expect.stringContaining('soon'), expect.not.stringContaining('expired')]);
    expect(allTest('inquiry-batch')[0]!.getAttribute('data-expired')).toBe('true');
    expect(sales.sellInfo).toHaveBeenCalledWith({ productId: 'p1', currency: 'IQD' });
    expect(allTest('inquiry-sub').map((s) => s.textContent)).toEqual([expect.stringContaining('Adol')]);
    expect(panel.textContent).not.toMatch(/cost|profit/i);
    expect(JSON.stringify(stored().receipts.map((r) => r.cart))).toBe(before);
    expect(sales.createSale).not.toHaveBeenCalled();
  });

  it('shows a scanned (typed) barcode, even one that cannot be sold, and a picked substitute, still adding nothing', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ matchedOn: 'barcode', sellableQty: 0 })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    press({ key: 'F7' });
    typeIn('cashier-search', '6221010001');
    enter();
    await flush();
    expect(byTest('inquiry-name')!.textContent).toContain('Panadol');
    expect((byTest('inquiry-add') as HTMLButtonElement).disabled).toBe(true);
    click(allTest('inquiry-sub')[0]!);
    await flush();
    expect(byTest('inquiry-name')!.textContent).toContain('Adol');
    expect(sales.sellInfo).toHaveBeenLastCalledWith({ productId: 'p2', currency: 'IQD' });
    expect(byTest('inquiry-subs-none')).not.toBeNull();
    expect(stored().receipts[0]!.cart.lines).toHaveLength(0);
  });

  it('adds the item only when "add" is chosen, then leaves inquiry', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem()] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    press({ key: 'F7' });
    typeIn('cashier-search', 'Panadol');
    enter();
    await flush();
    expect(stored().receipts[0]!.cart.lines).toHaveLength(0);
    click(byTest('inquiry-add'));
    expect(stored().receipts[0]!.cart.lines.map((l) => l.productId)).toEqual(['p1']);
    expect(byTest('inquiry-panel')).toBeNull();
  });
});

// The panels under the lines -----------------------------------------------------------------------------------------------

describe('the line panels', () => {
  it('ask for a line while none is selected', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('line-panels')).not.toBeNull();
    expect(byTest('panel-batches')!.textContent).toContain('Select a line');
    expect(sales.sellInfo).not.toHaveBeenCalled();
  });

  it('show the selected line batches nearest expiry first (expired marked, not sellable), its details and substitutes; no cost for a cashier', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    await flush();
    expect(sales.sellInfo).toHaveBeenCalledWith({ productId: 'p1', currency: 'IQD' });
    const rows = allTest('panel-batch');
    expect(rows.map((r) => r.getAttribute('data-lot'))).toEqual(['OLD1', 'L1', 'L2']);
    expect(rows[0]!.getAttribute('data-expired')).toBe('true');
    expect(rows[0]!.textContent).toContain('not sold');
    expect(rows[1]!.getAttribute('aria-current')).toBe('true');
    expect(rows[1]!.textContent).toContain('soon');
    expect(rows[1]!.textContent).toMatch(/12\/2026/);
    const details = byTest('panel-details')!.textContent!;
    expect(details).toContain('1,500 · 1,400');
    expect(details).toContain('Al-Hakim');
    expect(details).toContain('6221010001');
    expect(details).toContain('Paracetamol');
    expect(byTest('panel-cost-hidden')).not.toBeNull();
    expect(details).not.toMatch(/\$/);
    expect(allTest('panel-sub').map((s) => s.textContent)).toEqual([expect.stringContaining('Adol')]);
  });

  it('replace the selected line by a substitute keeping its quantity', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    await flush();
    click(allTest('panel-sub')[0]!);
    const lines = stored().receipts[0]!.cart.lines;
    expect(lines.map((l) => [l.productId, l.qty])).toEqual([['p2', 3]]);
    expect(message()).toContain('Adol');
  });

  it('never replace a line on a receipt being paid', async () => {
    screenWith([{ attempt: ATTEMPT }]);
    await flush();
    press({ key: 'ArrowDown' });
    await flush();
    click(allTest('panel-sub')[0]!);
    expect(stored().receipts[0]!.cart.lines.map((l) => l.productId)).toEqual(['p1']);
    expect(message()).toContain('F4');
  });
});

// Return mode --------------------------------------------------------------------------------------------------------------

describe('return mode', () => {
  const openReturn = async (over: Partial<ComponentProps<typeof CashierScreen>> = { canReturn: true }) => {
    screenWith([{ cart: emptyCart() }], over);
    await flush();
    click(byTest('tool-return'));
    expect(flowOf()).toBe('return');
  };
  const findSale = async (number = 'S-77') => {
    typeIn('return-number', number);
    click(byTest('return-find'));
    await flush();
  };

  it('tells a role without the return right that it needs the pharmacist or owner, and offers nothing to send', async () => {
    await openReturn({});
    expect(byTest('return-role')).not.toBeNull();
    expect(byTest('return-number')).toBeNull();
    expect(returns.createReturn).not.toHaveBeenCalled();
  });

  it('finds the original sale by its number, caps each quantity at what is left, returns through the existing action and prints a return slip without the drawer', async () => {
    sales.listSales.mockResolvedValue({ ok: true, data: { items: [{ id: 'sale-77', number: 'S-77' }], nextCursor: null } });
    returns.returnableLines.mockResolvedValue({ ok: true, data: RETURNABLE });
    returns.returnPreview.mockResolvedValue({ ok: true, data: { refundMinor: '1500', isFinal: true } });
    returns.createReturn.mockResolvedValue({ ok: true, data: RETURN_DONE });
    receipts.returnSlip.mockResolvedValue({ ok: true, data: { html: '<p>slip</p>', text: 'slip', model: slipModel(), copyNumber: 0, replayed: false } });
    await openReturn();
    await findSale('S-٧٧');
    expect(sales.listSales).toHaveBeenCalledWith({ number: 'S-77', pageSize: 5 });
    expect(returns.returnableLines).toHaveBeenCalledWith({ saleId: 'sale-77' });
    expect(byTest('line-counts')!.textContent).toContain('20');
    // Above what is left: refused before anything is sent.
    typeIn('return-qty', '21');
    typeIn('return-reason', 'Wrong strength');
    expect((byTest('return-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(byTest('return-form')!.textContent).toMatch(/only what was sold|not yet returned/i);
    typeIn('return-qty', '10');
    await wait(300);
    await flush();
    const confirm = byTest('return-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    await flush();
    expect(returns.createReturn).toHaveBeenCalledTimes(1);
    expect(returns.createReturn.mock.calls[0]![0]).toMatchObject({ saleId: 'sale-77', lines: [{ saleLineId: 'sl1', baseQty: 10 }], reason: 'Wrong strength', refundMethod: 'CASH', clientKey: expect.any(String) });
    expect(byTest('return-slip')).not.toBeNull();
    expect(receipts.returnSlip).toHaveBeenCalledWith({ returnId: 'ret-1', width: '80', locale: 'en' });
    expect(bridge.printDoc).toHaveBeenCalledTimes(1);
    expect((bridge.printDoc.mock.calls[0] as unknown as [unknown, unknown, { drawer: boolean }])[2].drawer).toBe(false);
    expect(bridge.kickDrawer).not.toHaveBeenCalled();
    expect(sales.createSale).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"], dialog')).toBeNull();
  });

  it('says when no sale has that number', async () => {
    sales.listSales.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    await openReturn();
    await findSale('S-404');
    expect(byTest('return-notfound')!.textContent).toContain('S-404');
    expect(returns.returnableLines).not.toHaveBeenCalled();
  });

  it('never returns without the original sale: the way without it names the pharmacist or owner and sends nothing', async () => {
    await openReturn();
    click(byTest('return-nosale'));
    expect(byTest('return-nosale-note')!.textContent).toMatch(/pharmacist|owner/i);
    expect(returns.createReturn).not.toHaveBeenCalled();
    await openReturnAs({});
  });
  async function openReturnAs(over: Partial<ComponentProps<typeof CashierScreen>>) {
    act(() => root.unmount());
    root = createRoot(container);
    await openReturn(over);
    expect(byTest('return-role')!.textContent).toMatch(/manager|owner|pharmacist/i);
  }
});
