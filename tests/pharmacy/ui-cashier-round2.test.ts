// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';

/**
 * Fix round 2 of the cashier swap (plan Task 11, browser-check-report.md): the keypad never changes a quantity while a panel is
 * open, the line name is always visible, Rx lines say so, the discount kind switch, the line keys on the keypad, the first unit,
 * the refund choices of an on-account sale, the restored note and the customer read again after a credit sale.
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
const customers = vi.hoisted(() => ({ listCustomers: vi.fn(async () => ({ ok: true, data: { items: [] as unknown[] } })), getCustomer: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/customers', () => customers);
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

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('ph.print.workstation', 'Counter 1');
  window.history.replaceState({}, '', '/pharmacy/sell');
  for (const fn of [...Object.values(sales), ...Object.values(returns), ...Object.values(receipts), nav.refresh, customers.getCustomer, bridge.printDoc, bridge.kickDrawer]) fn.mockReset();
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

const SALE = { id: 'sale-1', number: 'S-1', status: 'COMPLETED', branchId: 'b1', currency: 'IQD', subtotalMinor: '4500', discountMinor: '0', roundingMinor: '0', totalMinor: '4500', paidMinor: '5000', changeMinor: '500', lineCount: 1, completedAt: '2026-11-05T09:00:00Z', replayed: false };
const CUSTOMER = { id: 'c1', name: 'Ali Hassan', currency: 'IQD', creditLimitMinor: '10000', balanceMinor: '2000', availableMinor: '8000', active: true };
const pad = (digits: string) => {
  for (const d of digits) click(allTest('key-digit').find((b) => b.textContent === d) ?? null);
};
const padEnter = () => click(byTest('keypad-enter'));
const storedQty = () => stored().receipts[0]!.cart.lines.map((l) => l.qty);
const valueOf = (id: string) => (byTest(id) as HTMLInputElement).value;

// 1. The keypad while a panel is open ------------------------------------------------------------------------------------

describe('the keypad while a panel is open (never a quantity)', () => {
  it('types the cash received, and the check key confirms the payment', async () => {
    sales.createSale.mockResolvedValue({ ok: true, data: SALE });
    receipts.saleReceipt.mockResolvedValue({ ok: false, error: { code: 'X', message: 'x' } });
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: 'F2' });
    pad('5000');
    expect(valueOf('flow-tendered')).toBe('5000');
    expect(storedQty()).toEqual([3]);
    expect(byTest('keypad-display')!.textContent).toBe('');
    await act(async () => byTest('keypad-enter')!.click());
    await flush();
    expect(sales.createSale).toHaveBeenCalledTimes(1);
    const body = sales.createSale.mock.calls[0]![0] as { payments: { method: string; amountMinor: string }[]; lines: { qty: number }[] };
    expect(body.payments.map((p) => [p.method, p.amountMinor])).toEqual([['CASH', '5000']]);
    expect(body.lines.map((l) => l.qty)).toEqual([3]);
  });

  it('C clears the cash received, not the line', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: 'F2' });
    pad('12');
    click(byTest('keypad-clear'));
    expect(valueOf('flow-tendered')).toBe('');
    expect(storedQty()).toEqual([3]);
  });

  it('types what is paid now in the credit flow, never the quantity', async () => {
    customers.getCustomer.mockResolvedValue({ ok: true, data: CUSTOMER });
    screenWith([{ customerId: 'c1' }], { perms: { ...PERMS, credit: true } });
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: 'F3' });
    await flush();
    pad('1000');
    expect(valueOf('flow-now')).toBe('1000');
    expect(storedQty()).toEqual([3]);
  });

  it('types the receipt discount in the discount flow, never the quantity, and the check key applies it', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: 'F9' });
    pad('5');
    expect(valueOf('disc-value')).toBe('5');
    expect(storedQty()).toEqual([3]);
    expect(stored().receipts[0]!.cart.invoiceDiscount).toEqual({ kind: 'percent', value: '5' });
    padEnter();
    expect(flowOf()).toBe('idle');
    expect(storedQty()).toEqual([3]);
  });

  it('changes nothing while another panel is open (the held list), and says why', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    click(byTest('tool-held'));
    await flush();
    expect(flowOf()).toBe('held');
    pad('7');
    padEnter();
    expect(storedQty()).toEqual([3]);
    expect(message()).toContain('Close the open panel');
  });

  it('still sets the quantity with no panel open', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    pad('7');
    padEnter();
    expect(storedQty()).toEqual([7]);
  });
});

// 4. The discount panel -------------------------------------------------------------------------------------------------------

describe('the discount panel', () => {
  it('clears a typed value when the kind switches, so 10% never becomes an amount of 10 (or 500 → 10500)', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'F9' });
    typeIn('disc-value', '10');
    expect(stored().receipts[0]!.cart.invoiceDiscount).toEqual({ kind: 'percent', value: '10' });
    click(byTest('disc-kind-amount'));
    expect(valueOf('disc-value')).toBe('');
    expect(stored().receipts[0]!.cart.invoiceDiscount).toBeNull();
    expect(byTest('disc-kind-amount')!.getAttribute('aria-pressed')).toBe('true');
    typeIn('disc-value', '500');
    expect(stored().receipts[0]!.cart.invoiceDiscount).toEqual({ kind: 'amount', value: '500' });
  });

  it('a 100% discount (total 0) holds Pay back, as the old screen did, and asks for the reason', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'F9' });
    typeIn('disc-value', '100');
    expect(byTest('disc-reason-needed')).not.toBeNull();
    click(byTest('disc-apply'));
    press({ key: 'F2' });
    expect(byTest('flow-blocked')!.textContent!.toLowerCase()).toContain('zero');
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a discount over the limit with no reason holds Pay back until the reason is typed', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'F9' });
    typeIn('disc-value', '20');
    click(byTest('disc-apply'));
    press({ key: 'F2' });
    expect(byTest('flow-blocked')!.textContent!.toLowerCase()).toContain('reason');
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
    press({ key: 'F9' });
    typeIn('disc-reason', 'Regular patient');
    click(byTest('disc-apply'));
    press({ key: 'F2' });
    expect(byTest('flow-blocked')).toBeNull();
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(false);
  });
});

// 2. The name column ---------------------------------------------------------------------------------------------------------

describe('the name column of the sale lines', () => {
  it('is the flexible column: the table is at least every fixed width plus the name’s minimum, with and without cost', async () => {
    const { linesTableMinRem, NAME_MIN_REM, FIXED_REM } = await import('@/app/pharmacy/_ui/cashier/SaleLinesTable');
    for (const canSeeCost of [false, true]) {
      screenWith([{}], { canSeeCost });
      await flush();
      const table = container.querySelector<HTMLTableElement>('table[role="grid"]')!;
      const cols = [...table.querySelectorAll('col')];
      const named = cols.filter((c) => c.style.width === '');
      expect(named).toHaveLength(1);
      const fixed = cols.reduce((sum, c) => sum + (c.style.width ? parseFloat(c.style.width) : 0), 0);
      expect(fixed).toBe(FIXED_REM(canSeeCost));
      expect(parseFloat(table.style.minWidth)).toBe(linesTableMinRem(canSeeCost));
      expect(linesTableMinRem(canSeeCost)).toBe(fixed + NAME_MIN_REM);
      expect(NAME_MIN_REM).toBeGreaterThanOrEqual(12);
      expect(table.className).not.toMatch(/min-w-\[/);
    }
  });
});

// 3. Prescription lines --------------------------------------------------------------------------------------------------------

describe('a prescription line, through the real search → line mapping', () => {
  it('an RX product found by name shows the Rx badge on its line', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ productId: 'aug', tradeName: 'Augmentin', rxLevel: 'RX' })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', 'Augmentin');
    await wait(300);
    await flush();
    enter();
    await flush();
    expect(stored().receipts[0]!.cart.lines.map((l) => [l.productId, l.rxLevel])).toEqual([['aug', 'RX']]);
    expect(byTest('line-rx')!.textContent).toMatch(/Rx|prescription/i);
  });

  it('a controlled product shows the controlled badge and holds Pay back until its prescription is recorded', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ productId: 'tram', tradeName: 'Tramadol', rxLevel: 'RESTRICTED', matchedOn: 'barcode' })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', '6221010001');
    enter();
    await flush();
    expect(byTest('line-controlled')).not.toBeNull();
    press({ key: 'F2' });
    expect(byTest('flow-blocked')!.textContent!.toLowerCase()).toContain('prescription');
    expect((byTest('flow-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an OTC line has no prescription badge', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('line-rx')).toBeNull();
    expect(byTest('line-controlled')).toBeNull();
  });
});

// 7. The line keys -----------------------------------------------------------------------------------------------------------------

describe('the line keys on the keypad (the prototype’s line buttons)', () => {
  const two = () => cartReducer(cartReducer(emptyCart(), { type: 'add', item: item() }), { type: 'add', item: item({ productId: 'p2', tradeName: 'Brufen' }) });
  const selectedName = () => container.querySelector('[data-testid="sale-line"][aria-selected="true"] [data-testid="line-name"]')?.textContent ?? null;

  it('move the selection up and down, step the quantity and delete the line, each a 44px button with a name', async () => {
    screenWith([{ cart: two() }]);
    await flush();
    for (const id of ['pad-line-up', 'pad-line-down', 'pad-qty-down', 'pad-qty-up', 'pad-remove']) {
      const b = byTest(id)!;
      expect(b).not.toBeNull();
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.className).toContain('min-h-11');
    }
    click(byTest('pad-line-down'));
    expect(selectedName()).toBe('Panadol');
    click(byTest('pad-line-down'));
    expect(selectedName()).toBe('Brufen');
    click(byTest('pad-line-up'));
    expect(selectedName()).toBe('Panadol');
    click(byTest('pad-qty-up'));
    click(byTest('pad-qty-up'));
    expect(storedQty()).toEqual([3, 1]);
    click(byTest('pad-qty-down'));
    expect(storedQty()).toEqual([2, 1]);
    click(byTest('pad-remove'));
    expect(stored().receipts[0]!.cart.lines.map((l) => l.productId)).toEqual(['p2']);
  });

  it('say to pick a line first when none is selected', async () => {
    screenWith([{ cart: two() }]);
    await flush();
    click(byTest('pad-qty-up'));
    expect(storedQty()).toEqual([1, 1]);
    expect(message()).toContain('Select a line first');
  });

  it('never change a quantity while a payment panel is open', async () => {
    screenWith([{ cart: two() }]);
    await flush();
    click(byTest('pad-line-down'));
    press({ key: 'F2' });
    click(byTest('pad-qty-up'));
    click(byTest('pad-remove'));
    expect(storedQty()).toEqual([1, 1]);
    expect(message()).toContain('Close the open panel');
  });

  it('+ and Delete work from the empty scan field too', async () => {
    screenWith([{ cart: two() }]);
    await flush();
    press({ key: 'ArrowDown' });
    const field = byTest('cashier-search')!;
    act(() => field.focus());
    press({ key: '+' }, field);
    expect(storedQty()).toEqual([2, 1]);
    press({ key: 'Delete' }, field);
    expect(stored().receipts[0]!.cart.lines.map((l) => l.productId)).toEqual(['p2']);
  });
});

// 8. Smaller fixes ---------------------------------------------------------------------------------------------------------------

describe('the unit a new line starts in (decision: by name the smallest unit, by barcode the barcode’s unit)', () => {
  const LADDER = [
    { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '250' },
    { id: 'strip', label: 'strip', baseQty: 10, priceMinor: '2500' },
    { id: 'pack', label: 'packet', baseQty: 30, priceMinor: '5500' },
  ];
  const unitOfLine = () => stored().receipts[0]!.cart.lines.map((l) => l.unitId);

  it('Enter on a typed name adds a tablet, even though the server matched the packet', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ units: LADDER, matchedUnitId: 'pack', sellableQty: 300 })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', 'Pan');
    enter();
    await flush();
    expect(unitOfLine()).toEqual(['tab']);
  });

  it('a picked suggestion shows and adds the tablet too', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ units: LADDER, matchedUnitId: 'pack', sellableQty: 300 })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', 'Pan');
    await wait(300);
    await flush();
    const row = allTest('suggestion')[0]!;
    expect(row.textContent).toContain('tablet');
    click(row);
    expect(unitOfLine()).toEqual(['tab']);
  });

  it('a barcode keeps the unit it is printed on', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ units: LADDER, matchedUnitId: 'strip', matchedOn: 'barcode', sellableQty: 300 })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', '6221010001');
    enter();
    await flush();
    expect(unitOfLine()).toEqual(['strip']);
  });
});

describe('the "restored receipts" note', () => {
  it('shows after a reload with lines and goes at the first key', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('cashier-restored')).not.toBeNull();
    press({ key: 'ArrowDown' });
    expect(byTest('cashier-restored')).toBeNull();
  });

  it('goes at the first tap too', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('cashier-restored')).not.toBeNull();
    act(() => void container.querySelector('[data-testid="sale-line"]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(byTest('cashier-restored')).toBeNull();
  });
});

describe('the refund choices of a sale put on the account (return mode)', () => {
  it('offers only the default method when nothing was paid at the till', async () => {
    sales.listSales.mockResolvedValue({ ok: true, data: { items: [{ id: 'sale-77', number: 'S-77' }], nextCursor: null } });
    returns.returnableLines.mockResolvedValue({ ok: true, data: { ...RETURNABLE, paidMethods: [], onAccount: true } });
    returns.returnPreview.mockResolvedValue({ ok: true, data: { refundMinor: '1500', isFinal: true } });
    screenWith([{ cart: emptyCart() }], { canReturn: true });
    await flush();
    click(byTest('tool-return'));
    typeIn('return-number', 'S-77');
    await act(async () => void (byTest('return-find') as HTMLButtonElement).click());
    await flush();
    expect(byTest('return-on-account')).not.toBeNull();
    expect([...byTest('return-method')!.querySelectorAll('option')].map((o) => o.value)).toEqual(['CASH']);
  });
});

// 6. The customer after a credit sale -------------------------------------------------------------------------------------------

describe('the customer card after a credit sale', () => {
  it('reads the customer again, so the balance and the room left are the new ones', async () => {
    customers.getCustomer.mockResolvedValueOnce({ ok: true, data: CUSTOMER });
    customers.getCustomer.mockResolvedValue({ ok: true, data: { ...CUSTOMER, balanceMinor: '6500', availableMinor: '3500' } });
    sales.createSale.mockResolvedValue({ ok: true, data: { ...SALE, paidMinor: '0', changeMinor: '0' } });
    receipts.saleReceipt.mockResolvedValue({ ok: false, error: { code: 'X', message: 'x' } });
    screenWith([{ customerId: 'c1' }], { perms: { ...PERMS, credit: true } });
    await flush();
    press({ key: 'F3' });
    await flush();
    expect(byTest('cashier-balance')!.textContent).toContain('2,000');
    await act(async () => (byTest('flow-confirm') as HTMLButtonElement).click());
    await flush();
    expect(flowOf()).toBe('receipt');
    expect(customers.getCustomer).toHaveBeenCalledTimes(2);
    expect(byTest('cashier-balance')!.textContent).toContain('6,500');
    expect(byTest('customer-figures')!.textContent).toContain('3,500');
  });
});

// 5. One screen, no page scroll (layout A) ------------------------------------------------------------------------------------------

describe('the layout fits one screen (the work panel opens in the main column)', () => {
  it('opens the cash panel in the main column, under the lines, and leaves the side column’s pay row where it was', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'F2' });
    const panel = byTest('work-panel')!;
    expect(byTest('cashier-main')!.contains(panel)).toBe(true);
    expect(byTest('cashier-side')!.contains(panel)).toBe(false);
    // The lines stay above the panel while paying.
    const lines = byTest('sale-lines-scroll')!;
    expect(lines.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The side column ends with the pay row, kept in view at the bottom of its own scroll.
    expect(byTest('cashier-side')!.lastElementChild).toBe(byTest('cashier-pay'));
    expect(byTest('cashier-pay')!.className).toContain('lg:sticky');
  });

  it('shows the prescription box in the main column when idle, with the line panels', async () => {
    screenWith([{ cart: cartReducer(emptyCart(), { type: 'add', item: item({ rxLevel: 'RESTRICTED' }) }) }]);
    await flush();
    const rx = byTest('work-panel')!;
    expect(rx.getAttribute('data-flow')).toBe('idle');
    expect(byTest('cashier-main')!.contains(rx)).toBe(true);
  });

  it('on a wide screen the page does not scroll: the columns and the lines scroll inside themselves', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('cashier-screen')!.className).toContain('lg:overflow-hidden');
    expect(byTest('cashier-grid')!.className).toContain('lg:min-h-0');
    expect(byTest('cashier-work')!.className).toContain('lg:overflow-y-auto');
    expect(byTest('sale-lines-scroll')!.className).toContain('overflow-auto');
  });
});

describe('the side column fits a short laptop screen (round 4)', () => {
  const cls = (id: string) => byTest(id)!.className.split(' ').filter(Boolean);

  it('never scrolls as a whole: the total, the keypad and the pay row keep their size, and only the customer card gives way', async () => {
    customers.listCustomers.mockResolvedValue({ ok: true, data: { items: [CUSTOMER] } });
    screenWith([{}]);
    await flush();
    const side = byTest('cashier-side')!;
    expect(cls('cashier-side')).toContain('lg:overflow-hidden');
    expect(cls('cashier-side')).not.toContain('lg:overflow-y-auto');
    for (const id of ['cashier-total', 'keypad', 'cashier-pay']) expect(cls(id)).toContain('lg:shrink-0');
    expect(cls('cashier-customer')).toEqual(expect.arrayContaining(['lg:min-h-0', 'lg:shrink', 'lg:overflow-y-auto']));
    // The keypad sits right above the pay row, in the column itself (never under it).
    expect([...side.children].map((c) => c.getAttribute('data-testid'))).toEqual(['cashier-total', 'cashier-customer', 'keypad', 'cashier-pay']);
  });

  it('a picked customer takes two rows: the name with Change beside it, then the figures', async () => {
    customers.listCustomers.mockResolvedValue({ ok: true, data: { items: [CUSTOMER] } });
    screenWith([{}], { perms: { ...PERMS, credit: true } });
    await flush();
    typeIn('customer-search', 'Ali');
    await wait(300);
    await flush();
    click(allTest('customer-option')[0]!);
    const card = byTest('customer-picked')!;
    const change = byTest('customer-change')!;
    expect(change.parentElement!.parentElement).toBe(card);
    expect(change.parentElement!.textContent).toContain(CUSTOMER.name);
    expect(change.className).toContain('min-h-11');
    expect([...card.children].map((c) => c.getAttribute('data-testid') ?? c.tagName)).toEqual(['P', 'customer-figures']);
  });

  it('is denser on a short screen (under 820px high): smaller total figure and pay buttons, still 44px targets', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('cashier-total')!.innerHTML).toContain('[@media(max-height:820px)]:text-[32px]');
    expect(byTest('pay-cash')!.className).toContain('[@media(max-height:820px)]:min-h-12');
    expect(byTest('pay-cash')!.className).toContain('min-w-11');
    // The figures under the total (discount, count, balance, stock) go two by two.
    expect(byTest('cashier-discount')!.parentElement!.className).toContain('[@media(max-height:820px)]:grid-cols-2');
  });

  it('on a 768px-high screen the lines give up more room while a flow is open (the table scrolls inside itself)', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'F2' });
    expect(byTest('sale-lines-scroll')!.className).toContain('lg:[@media(max-height:780px)]:min-h-[72px]');
    press({ key: 'Escape' });
    expect(byTest('sale-lines-scroll')!.className).not.toContain('min-h-[72px]');
  });
});

describe('the customer picker in the side column', () => {
  it('lists customers only once something is typed (the column stays short), and reads them again after a credit sale', async () => {
    customers.listCustomers.mockResolvedValue({ ok: true, data: { items: [CUSTOMER] } });
    customers.getCustomer.mockResolvedValue({ ok: true, data: CUSTOMER });
    sales.createSale.mockResolvedValue({ ok: true, data: { ...SALE, paidMinor: '0', changeMinor: '0' } });
    receipts.saleReceipt.mockResolvedValue({ ok: false, error: { code: 'X', message: 'x' } });
    screenWith([{}], { perms: { ...PERMS, credit: true } });
    await wait(300);
    await flush();
    expect(customers.listCustomers).not.toHaveBeenCalled();
    expect(byTest('customer-results')).toBeNull();
    typeIn('customer-search', 'Ali');
    await wait(300);
    await flush();
    expect(customers.listCustomers).toHaveBeenCalledTimes(1);
    click(allTest('customer-option')[0]!);
    press({ key: 'F3' });
    await flush();
    await act(async () => (byTest('flow-confirm') as HTMLButtonElement).click());
    await flush();
    click(byTest('receipt-next'));
    await wait(300);
    await flush();
    // The list kept for "Ali" is read again: it shows the balance after the sale.
    expect(customers.listCustomers).toHaveBeenCalledTimes(2);
    expect(allTest('customer-option')).toHaveLength(1);
  });
});

// Fix round 3 (task-11-review.md, Re-review 2) ---------------------------------------------------------------------------------------

describe('round 3: a name add starts in the smallest PRICED unit (I2)', () => {
  const PARTLY = [
    { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: null },
    { id: 'strip', label: 'strip', baseQty: 10, priceMinor: '2500' },
    { id: 'pack', label: 'packet', baseQty: 30, priceMinor: '5500' },
  ];
  const unitOfLine = () => stored().receipts[0]!.cart.lines.map((l) => l.unitId);

  it('Enter on a typed name skips the unpriced tablet and adds a strip', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ units: PARTLY, matchedUnitId: 'pack', sellableQty: 300 })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', 'Pan');
    enter();
    await flush();
    expect(unitOfLine()).toEqual(['strip']);
  });

  it('a picked suggestion shows and adds the strip', async () => {
    sales.sellSearch.mockResolvedValue({ ok: true, data: { items: [sellItem({ units: PARTLY, matchedUnitId: 'pack', sellableQty: 300 })] } });
    screenWith([{ cart: emptyCart() }]);
    await flush();
    typeIn('cashier-search', 'Pan');
    await wait(300);
    await flush();
    const row = allTest('suggestion')[0]!;
    expect(row.textContent).toContain('strip');
    click(row);
    expect(unitOfLine()).toEqual(['strip']);
  });

  it('with no priced unit at all, keeps the server’s unit', async () => {
    const { asTyped } = await import('@/app/pharmacy/_ui/cashier/cashier-logic');
    const none = PARTLY.map((u) => ({ ...u, priceMinor: null }));
    expect(asTyped(sellItem({ units: none, matchedUnitId: 'pack' }) as never)).toMatchObject({ matchedUnitId: 'pack' });
    expect(asTyped(sellItem({ units: PARTLY, matchedUnitId: 'pack', matchedOn: 'barcode' }) as never)).toMatchObject({ matchedUnitId: 'pack' });
  });
});

describe('round 3: the physical line keys while a panel is open (M1)', () => {
  const two = () => cartReducer(cartReducer(emptyCart(), { type: 'add', item: item() }), { type: 'add', item: item({ productId: 'p2', tradeName: 'Brufen' }) });
  for (const [name, key] of [['cash', 'F2'], ['discount', 'F9']] as const) {
    it(`+ - and Delete change nothing while the ${name} panel is open, and say why`, async () => {
      screenWith([{ cart: two() }]);
      await flush();
      press({ key: 'ArrowDown' });
      press({ key });
      press({ key: '+' });
      press({ key: '-' });
      press({ key: 'Delete' });
      expect(storedQty()).toEqual([1, 1]);
      expect(message()).toContain('Close the open panel');
      // The arrows still move the selection.
      press({ key: 'ArrowDown' });
      expect(container.querySelector('[data-testid="sale-line"][aria-selected="true"] [data-testid="line-name"]')?.textContent).toBe('Brufen');
    });
  }
});

describe('round 3: pad digits never come back after a panel (M3)', () => {
  it('digits typed before F2 are dropped when the panel opens, so ✓ after closing it changes nothing', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    pad('7');
    expect(byTest('keypad-display')!.textContent).toBe('7');
    press({ key: 'F2' });
    click(byTest('flow-back'));
    expect(flowOf()).toBe('idle');
    // The typed 7 is gone: the display shows the line's own quantity again.
    expect(byTest('keypad-display')!.textContent).toBe('3');
    padEnter();
    expect(storedQty()).toEqual([3]);
  });
});

describe('round 3: the discount pad types into the focused field (M4)', () => {
  it('goes to the line discount when that field has focus, and back to the receipt discount when it does', async () => {
    screenWith([{}]);
    await flush();
    press({ key: 'ArrowDown' });
    press({ key: 'F9' });
    act(() => byTest('disc-line-value')!.focus());
    pad('5');
    expect(valueOf('disc-line-value')).toBe('5');
    expect(stored().receipts[0]!.cart.invoiceDiscount).toBeNull();
    expect(stored().receipts[0]!.cart.lines[0]!.discount).toEqual({ kind: 'percent', value: '5' });
    act(() => byTest('disc-value')!.focus());
    pad('2');
    expect(valueOf('disc-value')).toBe('2');
    expect(stored().receipts[0]!.cart.lines[0]!.discount).toEqual({ kind: 'percent', value: '5' });
    expect(byTest('disc-pad-target')!.textContent).toMatch(/receipt/i);
  });
});
