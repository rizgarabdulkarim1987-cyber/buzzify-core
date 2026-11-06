// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { STUDIO_MESSAGES } from '@/studio/messages';
import ar from '@/studio/messages/pharmacy/ar';

/**
 * Task 17, the prototype-completeness pass (docs/pharmacy/prototypes/cashier-layouts-2026-11-05.html, layout A): the calculator
 * key and panel, the # inquiry and return keys, the toggled captions, the current-line bar, the toolbar's new-receipt button and
 * answers instead of silently disabled buttons, the no-print box in the toolbar, the always-shown balance and stock, the date, the
 * cart key and the card button, editable cells in the lines, the expiry marks and the shift totals line.
 */

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/pharmacy/sell' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never),
}));
const sales = vi.hoisted(() => ({ sellSearch: vi.fn(), sellInfo: vi.fn(), sellCosts: vi.fn(), holdSale: vi.fn(), createSale: vi.fn(), discardHold: vi.fn(), resumeHold: vi.fn(), listHolds: vi.fn(), listSales: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/sales', () => sales);
vi.mock('@/app/pharmacy/_actions/returns', () => ({ returnableLines: vi.fn(), returnPreview: vi.fn(), createReturn: vi.fn(), cancelSale: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/shifts', () => ({ openShift: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/customers', () => ({ listCustomers: vi.fn(async () => ({ ok: true, data: { items: [] as unknown[] } })), getCustomer: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/receipts', () => ({ saleReceipt: vi.fn(), reprintReceipt: vi.fn(), returnSlip: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/prescriptions', () => ({ createPrescription: vi.fn(), getPrescription: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/print', () => ({ getPrintSettings: vi.fn(async () => ({ ok: true, data: { print: { workstations: {} } } })) }));
vi.mock('@/app/pos/_ui/print/print-client', () => ({ printDoc: vi.fn(async () => ({ ok: true })), kickDrawer: vi.fn(async () => ({ ok: true })) }));

const { CashierScreen } = await import('@/app/pharmacy/_ui/cashier/CashierScreen');
const { evalCalc, formatCalc, calcKey } = await import('@/app/pharmacy/_ui/cashier/calc-logic');
const { shiftLineOf } = await import('@/server/pharmacy/queries/pulse-shift');
const { cartReducer, emptyCart } = await import('@/app/pharmacy/_ui/sell-logic');
const { newReceipt, receiptsKey, serializeReceipts } = await import('@/app/pharmacy/_ui/sell-receipts');
type AddableItem = import('@/app/pharmacy/_ui/sell-logic').AddableItem;
type CartState = import('@/app/pharmacy/_ui/sell-logic').CartState;
type OpenReceipt = import('@/app/pharmacy/_ui/sell-receipts').OpenReceipt;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
function mount(element: ReactElement, locale: Locale) {
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
const byTest = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allTest = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const press = (init: KeyboardEventInit, target: EventTarget = window) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const click = (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  act(() => el!.click());
};
const setValue = (el: HTMLElement | null, text: string) => {
  expect(el).not.toBeNull();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, text);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const commit = (el: HTMLElement | null, text: string) => {
  setValue(el, text);
  press({ key: 'Enter' }, el!);
};
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await tick();
};
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
  sellableQty: 250,
  units: [
    { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '150' },
    { id: 'strip', label: 'strip', baseQty: 10, priceMinor: '1500' },
  ],
  batches: [
    { batchId: 'b1', lot: 'L1', expiryDate: '2026-12-31', available: 50 },
    { batchId: 'b2', lot: 'L2', expiryDate: '2027-03-31', available: 200 },
  ],
  ...over,
});
const cartOf = (qty = 3): CartState => {
  const one = cartReducer(emptyCart(), { type: 'add', item: item(), unitId: 'strip' });
  return cartReducer(one, { type: 'qty', key: one.lines[0]!.key, qty });
};
const SHIFT = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '0', openedAt: '2026-11-05T08:00:00Z' };
const SETTINGS = { defaultCurrency: 'IQD' as const, enabledCurrencies: ['IQD' as const], roundingStepMinor: '0', maxDiscountPercent: 10, controlledEnabled: true, controlledMaxQty: 10, creditEnabled: true };
const PERMS = { discount: true, batchOverride: false, rx: true, credit: false };
const STORE = receiptsKey('r1', 'b1', 'u1', 'IQD');
const ATTEMPT = { sig: 'old-sig', key: 'sale-key-0001', paymentKey: 'pay-key-0001', method: 'CASH' as const, amountMinor: '5000', reference: '', fromHoldId: null };
const PULSE = {
  shiftNetMinor: '12000',
  receiptsDone: 3,
  drawerCashMinor: '9000',
  nearExpiry: { count: 0, firstProductName: null, firstProductId: null },
  lowStock: { count: 0, firstProductName: null, firstProductId: null },
  usdRate: 1450,
  shift: { cash: { count: 2, amountMinor: '7000' }, credit: { count: 1, amountMinor: '5000' }, card: { count: 0, amountMinor: '0' }, transfer: { count: 0, amountMinor: '0' }, returns: { count: 1, amountMinor: '1500' } },
};

function screenWith(list: Partial<OpenReceipt>[], over: Partial<ComponentProps<typeof CashierScreen>> = {}, locale: Locale = 'en') {
  window.localStorage.setItem(STORE, serializeReceipts({ receipts: list.map((r) => ({ ...newReceipt(), cart: cartOf(), ...r })), active: 0 }));
  mount(createElement(CashierScreen, { restaurantId: 'r1', branchId: 'b1', userId: 'u1', shift: SHIFT, settings: SETTINGS, perms: PERMS, ...over }), locale);
}
const stored = () => JSON.parse(window.localStorage.getItem(STORE) ?? '{}') as { receipts: OpenReceipt[] };
const selectFirst = () => click(allTest('sale-line')[0] ?? null);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/pharmacy/sell');
  for (const fn of Object.values(sales)) fn.mockReset();
  sales.listHolds.mockResolvedValue({ ok: true, data: { items: [], hasMore: false } });
  sales.sellInfo.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the calculator sum', () => {
  it('reads the usual order of operations and brackets', () => {
    expect(evalCalc('2000*5-500')).toBe(9500);
    expect(evalCalc('(1+2)*3')).toBe(9);
    expect(evalCalc('10/4')).toBe(2.5);
    expect(evalCalc('-5+2')).toBe(-3);
    expect(evalCalc(' 1 500 + ٢٥٠ ')).toBe(1750);
    expect(evalCalc('3×4÷2')).toBe(6);
  });
  it('answers nothing for an unfinished sum, a division by zero or anything that is not a sum', () => {
    for (const text of ['', '2+', '(1+2', '1/0', 'alert(1)', '2**3', '1..2', ')']) expect(evalCalc(text), text).toBeNull();
  });
  it('shows the answer grouped with at most two decimals, and takes keypad digits and C', () => {
    expect(formatCalc(9500)).toBe('9,500');
    expect(formatCalc(1 / 3)).toBe('0.33');
    expect(calcKey('20', '5')).toBe('205');
    expect(calcKey('205', 'C')).toBe('');
  });
});

describe('the keypad function keys (prototype: حاسبة, # استعلام, إرجاع مادة)', () => {
  it('the calculator key opens the calculator panel; a sum is answered and the receipt does not change', async () => {
    screenWith([{}]);
    await flush();
    const before = JSON.stringify(stored().receipts[0]!.cart);
    click(byTest('keypad-calc'));
    expect(flowOf()).toBe('calc');
    setValue(byTest('calc-input'), '2000*5-500');
    expect(byTest('calc-result')!.textContent).toContain('9,500');
    // The keypad types into the sum while the calculator is open, never a quantity.
    for (const d of ['1', '2']) click(allTest('key-digit').find((b) => b.textContent === d) ?? null);
    expect((byTest('calc-input') as HTMLInputElement).value).toBe('2000*5-50012');
    click(byTest('keypad-enter'));
    press({ key: 'Escape' });
    expect(flowOf()).toBe('idle');
    expect(JSON.stringify(stored().receipts[0]!.cart)).toBe(before);
  });

  it('the # key turns inquiry mode on and off', async () => {
    screenWith([{}]);
    await flush();
    click(byTest('keypad-inquiry'));
    expect(byTest('inquiry-panel')).not.toBeNull();
    expect(byTest('keypad-inquiry')!.getAttribute('aria-pressed')).toBe('true');
    click(byTest('keypad-inquiry'));
    expect(byTest('inquiry-panel')).toBeNull();
  });

  it('the return key and the toolbar button toggle return mode, and both say "End return" while it is on', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    expect(byTest('tool-return')!.textContent).toContain('إرجاع مادة');
    click(byTest('keypad-return'));
    expect(flowOf()).toBe('return');
    expect(byTest('tool-return')!.textContent).toContain('إنهاء الإرجاع');
    expect(byTest('keypad-return')!.textContent).toContain('إنهاء الإرجاع');
    click(byTest('tool-return'));
    expect(flowOf()).toBe('idle');
    expect(byTest('keypad-return')!.textContent).toContain('إرجاع مادة');
  });
});

describe('toggled captions and Escape', () => {
  it('the inquiry button reads "استعلام عن سعر" with F7, and "إنهاء الاستعلام" while inquiry is on', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    expect(byTest('inquiry-button')!.textContent).toContain('استعلام عن سعر');
    expect(byTest('inquiry-button')!.textContent).toContain('F7');
    click(byTest('inquiry-button'));
    expect(byTest('inquiry-button')!.textContent).toContain('إنهاء الاستعلام');
  });

  it('Escape with no panel open leaves inquiry mode; with a panel open it only closes the panel', async () => {
    screenWith([{}]);
    await flush();
    click(byTest('inquiry-button'));
    click(byTest('keypad-calc'));
    press({ key: 'Escape' });
    expect(flowOf()).toBe('idle');
    expect(byTest('inquiry-panel')).not.toBeNull();
    press({ key: 'Escape' });
    expect(byTest('inquiry-panel')).toBeNull();
  });
});

describe('the current-line bar', () => {
  it('asks to pick or scan with no line selected, then shows the line: name, quantity, unit price, total', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    expect(byTest('current-line')!.textContent).toContain('اختر أو امسح مادة');
    selectFirst();
    const bar = byTest('current-line')!.textContent!;
    expect(bar).toContain('Panadol');
    expect(bar).toContain('العدد');
    expect(bar).toContain('3');
    expect(bar).toContain('سعر الوحدة');
    expect(bar).toContain('1,500');
    expect(bar).toContain('الكلي');
    expect(bar).toContain('4,500');
  });
});

describe('the toolbar (prototype order and answers)', () => {
  it('starts with "وصل جديد" (F4), which opens another receipt', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    const tools = allTest('cashier-toolbar')[0]!;
    expect(tools.querySelector('button')!.getAttribute('data-testid')).toBe('tool-new');
    expect(byTest('tool-new')!.textContent).toContain('وصل جديد');
    expect(byTest('tool-new')!.textContent).toContain('F4');
    click(byTest('tool-new'));
    expect(allTest('receipt-tab')).toHaveLength(2);
  });

  it('discard on an empty receipt answers "لا شيء لإهماله" instead of being silently off', async () => {
    screenWith([{ cart: emptyCart() }], {}, 'ar');
    await flush();
    const discard = byTest('tool-discard')!;
    expect(discard.getAttribute('aria-disabled')).toBe('true');
    expect((discard as HTMLButtonElement).disabled).toBe(false);
    click(discard);
    expect(message()).toContain('لا شيء لإهماله');
  });

  it('discard on a receipt being paid says why it cannot', async () => {
    screenWith([{ attempt: ATTEMPT }]);
    await flush();
    click(byTest('tool-discard'));
    expect(message()).not.toBe('');
    expect(stored().receipts[0]!.cart.lines).toHaveLength(1);
  });

  it('print is always there; with no earlier sale it answers "لا يوجد وصل سابق في هذه الوردية"', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    click(byTest('tool-reprint'));
    expect(message()).toContain('لا يوجد وصل سابق في هذه الوردية');
    expect(flowOf()).toBe('idle');
  });

  it('keeps "لا أطبع الوصل" in the toolbar under the print button', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    const box = byTest('flow-no-print') as HTMLInputElement;
    expect(byTest('cashier-toolbar')!.contains(box)).toBe(true);
    expect(box.closest('label')!.textContent).toContain('لا أطبع الوصل');
  });

  it('shows the receipt discount (F9) on an empty receipt too, off until there is something to discount', async () => {
    screenWith([{ cart: emptyCart() }]);
    await flush();
    expect((byTest('tool-discount') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the side column', () => {
  it('always shows the customer balance (0 for a walk-in) and the stock left ("-" with no line), and the date', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    expect(byTest('cashier-balance')!.textContent).toContain('0');
    expect(byTest('cashier-stock')!.textContent).toContain('-');
    expect(byTest('receipt-date')!.textContent).toContain('التاريخ');
    selectFirst();
    expect(byTest('cashier-stock')!.textContent).toContain('25');
  });

  it('the keypad display shows the selected line’s quantity until digits are typed', async () => {
    screenWith([{}]);
    await flush();
    expect(byTest('keypad-display')!.textContent).toBe('-');
    selectFirst();
    expect(byTest('keypad-display')!.textContent).toBe('3');
    click(allTest('key-digit').find((b) => b.textContent === '7') ?? null);
    expect(byTest('keypad-display')!.textContent).toBe('7');
  });

  it('the green cart key finishes the sale in cash (opens the cash panel); on an empty receipt it says the receipt is empty', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    expect(byTest('pad-cart')!.getAttribute('aria-label')).toBe('إنهاء البيع نقداً');
    click(byTest('pad-cart'));
    expect(flowOf()).toBe('cash');
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{ cart: emptyCart() }], {}, 'ar');
    await flush();
    click(byTest('pad-cart'));
    expect(message()).toContain('الوصل فارغ');
  });

  it('pays with نقدي (F2), آجل (F3) and بطاقة; the card button opens the cash panel on the card method', async () => {
    screenWith([{}], {}, 'ar');
    await flush();
    expect(byTest('pay-cash')!.textContent).toContain('نقدي');
    expect(byTest('pay-cash')!.textContent).toContain('F2');
    expect(byTest('pay-credit')!.textContent).toContain('F3');
    click(byTest('pay-card'));
    expect(flowOf()).toBe('cash');
    expect(byTest('pay-method-CARD_MANUAL')!.getAttribute('aria-pressed')).toBe('true');
    click(byTest('pay-cash'));
    expect(byTest('pay-method-CASH')!.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the sale lines (editable cells as in the prototype)', () => {
  it('the quantity cell is an input that sets the quantity', async () => {
    screenWith([{}]);
    await flush();
    commit(byTest('line-qty'), '5');
    expect(stored().receipts[0]!.cart.lines[0]!.qty).toBe(5);
  });

  it('a refused change (the receipt is being paid) puts the old quantity back and says why', async () => {
    screenWith([{ attempt: ATTEMPT }]);
    await flush();
    commit(byTest('line-qty'), '9');
    expect(stored().receipts[0]!.cart.lines[0]!.qty).toBe(3);
    expect((byTest('line-qty') as HTMLInputElement).value).toBe('3');
    expect(message()).not.toBe('');
  });

  it('the unit cell is a button that converts the line to its next priced unit', async () => {
    screenWith([{}]);
    await flush();
    click(byTest('line-unit'));
    expect(stored().receipts[0]!.cart.lines[0]!.unitId).toBe('tab');
  });

  it('the discount cell is an amount input with the discount permission, text without it', async () => {
    screenWith([{}]);
    await flush();
    commit(byTest('line-discount'), '500');
    expect(stored().receipts[0]!.cart.lines[0]!.discount).toEqual({ kind: 'amount', value: '500' });
    act(() => root.unmount());
    root = createRoot(container);
    screenWith([{}], { perms: { ...PERMS, discount: false } });
    await flush();
    expect(byTest('line-discount')).toBeNull();
  });

  it('shows the expiry as month/year, marked when it is near', async () => {
    screenWith([{}]);
    await flush();
    const expiry = byTest('line-expiry')!;
    expect(expiry.textContent).toContain('12/2026');
  });
});

describe('the shift totals line (prototype footer)', () => {
  it('shows cash, credit, card and returns with their counts', async () => {
    screenWith([{}], { pulse: PULSE }, 'ar');
    await flush();
    const line = byTest('shift-totals')!.textContent!;
    expect(line).toContain('الوردية');
    expect(line).toContain('نقدي (2)');
    expect(line).toContain('7,000');
    expect(line).toContain('آجل (1)');
    expect(line).toContain('بطاقة (0)');
    expect(line).toContain('مرتجعات (1)');
    expect(line).toContain('-1,500');
  });

  it('is read from the shift totals: cash net of change, credit, card, transfer and returns', () => {
    const totals = {
      cash: { tenderedMinor: '10000', changeMinor: '1500' },
      payments: [
        { method: 'CASH', count: 2, amountMinor: '10000' },
        { method: 'CREDIT', count: 1, amountMinor: '4000' },
        { method: 'CARD_MANUAL', count: 1, amountMinor: '2500' },
      ],
      returns: { count: 1, refundMinor: '700' },
    };
    expect(shiftLineOf(totals)).toEqual({ cash: { count: 2, amountMinor: '8500' }, credit: { count: 1, amountMinor: '4000' }, card: { count: 1, amountMinor: '2500' }, transfer: { count: 0, amountMinor: '0' }, returns: { count: 1, amountMinor: '700' } });
    expect(shiftLineOf(undefined)).toBeNull();
  });
});

describe('the Arabic of the new parts is the prototype’s', () => {
  it.each(
    Object.entries({
      'pharmacy.cashier.tools.new': 'وصل جديد',
      'pharmacy.cashier.tools.nothingToDiscard': 'لا شيء لإهماله',
      'pharmacy.cashier.tools.noLastReceipt': 'لا يوجد وصل سابق في هذه الوردية',
      'pharmacy.cashier.tools.returnEnd': 'إنهاء الإرجاع',
      'pharmacy.cashier.inquiry.button': 'استعلام عن سعر',
      'pharmacy.cashier.inquiry.end': 'إنهاء الاستعلام',
      'pharmacy.cashier.keypad.calc': 'حاسبة',
      'pharmacy.cashier.keypad.inquiry': '# استعلام',
      'pharmacy.cashier.keypad.cart': 'إنهاء البيع نقداً',
      'pharmacy.cashier.flow.title.calc': 'الآلة الحاسبة',
      'pharmacy.cashier.calc.label': 'اكتب العملية',
      'pharmacy.cashier.current.empty': 'اختر أو امسح مادة',
      'pharmacy.cashier.receipt.date': 'التاريخ',
      'pharmacy.cashier.pay.cash': 'نقدي',
      'pharmacy.cashier.pay.credit': 'آجل',
      'pharmacy.cashier.pay.card': 'بطاقة',
      'pharmacy.cashier.footer.region': 'الوردية',
      'pharmacy.cashier.footer.returns': 'مرتجعات ({count})',
    }),
  )('%s', (key, text) => expect((ar as Record<string, string>)[key]).toBe(text));
});
