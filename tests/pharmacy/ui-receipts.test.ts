// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import type { ReceiptDetail } from '@/server/pharmacy/receipts';
import type { MovementView } from '@/server/pharmacy/stock-reads';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The receiving screens (Phase 2, Task 9b) mounted in a browser-like document and used as a person would. The Server
 * Actions are stood in for. jsdom has no layout, so the sideways-scroll and axe checks are in
 * tests/e2e/pharmacy-receive.spec.ts; here the money, the dates and the words are checked.
 */

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/studio/request-locale', () => ({ requestStudioLocale: async () => 'en' }));
const catalog = vi.hoisted(() => ({ searchProducts: vi.fn() }));
vi.mock('@/app/pharmacy/_actions/catalog', () => catalog);
const actions = vi.hoisted(() => ({
  createReceipt: vi.fn(),
  updateReceipt: vi.fn(),
  confirmReceipt: vi.fn(),
  voidReceipt: vi.fn(),
  receiptProduct: vi.fn(),
}));
vi.mock('@/app/pharmacy/_actions/receipts', () => actions);

const { ReceiptEditor } = await import('@/app/pharmacy/_ui/ReceiptEditor');
const { ReceiptView } = await import('@/app/pharmacy/_ui/ReceiptView');
const { ReceiptStatus } = await import('@/app/pharmacy/_ui/ReceiptStatus');
const { ReceiveBlocked } = await import('@/app/pharmacy/_ui/ReceiveBlocked');
const { emptyDraft, inputOf, readExpiry, totalsOf, minorToText } = await import('@/app/pharmacy/_ui/receipt-draft');
const { default: ReceiveError } = await import('@/app/pharmacy/(app)/stock/receive/error');
const { default: ReceiveLoading } = await import('@/app/pharmacy/(app)/stock/receive/loading');

const en = getStudioTranslator('en');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function mount(element: ReactElement, locale: Locale = 'en') {
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

const field = (label: string) => {
  const found = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`no field labelled ${label}`);
  return document.getElementById(found.htmlFor) as HTMLInputElement & HTMLSelectElement;
};
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;
const text = () => container.textContent ?? '';
const search = () => container.querySelector<HTMLInputElement>('[data-testid="receipt-picker"] input')!;

const PANADOL = {
  id: 'p1',
  tradeName: 'Panadol',
  strength: '500 mg',
  form: 'tablet',
  units: [
    { id: 'u0', level: 0, label: 'tablet', baseQty: 1, sellable: true },
    { id: 'u1', level: 1, label: 'strip', baseQty: 10, sellable: true },
    { id: 'u2', level: 2, label: 'box', baseQty: 30, sellable: false },
  ],
};
const FOUND = { productId: 'p1', matchedOn: 'tradeName', label: 'Panadol', strength: '500 mg', form: 'tablet', packLabel: 'box of 30', price: null };

const editorProps = (over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  restaurantId: 'r1',
  branchId: 'b1',
  branchName: 'Main street',
  initial: null,
  receiptId: null,
  currencies: ['IQD', 'USD'] as ('IQD' | 'USD')[],
  ...over,
});

/** Opens the form, finds Panadol by name, and returns once its line is on screen. */
async function addPanadol() {
  catalog.searchProducts.mockResolvedValue({ ok: true, data: [FOUND] });
  actions.receiptProduct.mockResolvedValue({ ok: true, data: PANADOL });
  await press(search(), 'Enter'); // nothing typed yet: no search
  type(search(), 'Panadol');
  await press(search(), 'Enter');
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('how an expiry is understood', () => {
  const TODAY = '2026-10-27';
  it('reads MM/YYYY as the month (to its last day), DD/MM/YYYY and YYYY-MM-DD as a day, with Arabic digits too', () => {
    expect(readExpiry('03/2027', TODAY)).toMatchObject({ ok: true, iso: '2027-03-31', precision: 'MONTH', shown: '03/2027', expired: false });
    expect(readExpiry('14/03/2027', TODAY)).toMatchObject({ ok: true, iso: '2027-03-14', precision: 'DAY', shown: '14/03/2027' });
    expect(readExpiry('2027-03-14', TODAY)).toMatchObject({ ok: true, iso: '2027-03-14', precision: 'DAY' });
    expect(readExpiry('٠٣/٢٠٢٧', TODAY)).toMatchObject({ ok: true, iso: '2027-03-31', precision: 'MONTH' });
    expect(readExpiry('٢٠٢٧-٠٣-١٤', TODAY)).toMatchObject({ ok: true, iso: '2027-03-14' });
  });
  it('refuses what is not a date, and marks a date that has passed', () => {
    for (const bad of ['', '13/2027', '31/02/2027', '2027', 'soon', '00/2027']) expect(readExpiry(bad, TODAY).ok, bad).toBe(false);
    expect(readExpiry('09/2026', TODAY)).toMatchObject({ ok: true, expired: true });
    expect(readExpiry('2026-10-27', TODAY)).toMatchObject({ ok: true, expired: false });
  });
});

describe('the action input of a draft', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    key: 'a',
    productId: 'p1',
    productName: 'Panadol',
    productMeta: '',
    units: [{ id: 'u1', label: 'strip', baseQty: 10 }],
    unitId: 'u1',
    qty: '5',
    bonusQty: '1',
    lot: 'L-100',
    expiry: '03/2027',
    cost: '2,500',
    currency: 'IQD' as const,
    freeOfCharge: false,
    acceptExpired: false,
    ...over,
  });
  const draft = (lines: ReturnType<typeof line>[]) => ({ ...emptyDraft('key-12345678', '2026-10-27'), lines });

  it('sends the cost as minor units in text (IQD whole, USD cents), never a float, and the expiry as the server reads it', () => {
    const built = inputOf(draft([line(), line({ key: 'b', currency: 'USD', cost: '12.50', expiry: '14/03/2027', qty: '٣' })]));
    const lines = (built.input as { lines: Record<string, unknown>[] }).lines;
    expect(lines[0]).toMatchObject({ unitCostMinor: '2500', currency: 'IQD', expiry: '2027-03-31', qty: 5, bonusQty: 1 });
    expect(lines[1]).toMatchObject({ unitCostMinor: '1250', currency: 'USD', expiry: '2027-03-14', qty: 3 });
    expect(Object.keys(built.input!)).not.toContain('restaurantId');
    expect(Object.keys(built.input!)).not.toContain('branchId');
    expect(minorToText(1250n, 'USD')).toBe('12.50');
    expect(minorToText(2500n, 'IQD')).toBe('2500');
  });

  it('free of charge sends a zero cost; a blank or wrong cost, quantity, lot or expiry is a problem by line and field', () => {
    expect((inputOf(draft([line({ freeOfCharge: true, cost: '' })])).input as { lines: Record<string, unknown>[] }).lines[0]).toMatchObject({ unitCostMinor: '0', freeOfCharge: true });
    const bad = inputOf(draft([line({ cost: '12,50', qty: '0', lot: ' ', expiry: 'soon', bonusQty: 'x' })]));
    expect(bad.input).toBeUndefined();
    expect(bad.problems).toEqual({
      'lines.0.qty': 'qty',
      'lines.0.bonusQty': 'bonus',
      'lines.0.lot': 'lot',
      'lines.0.expiry': 'expiry',
      'lines.0.unitCostMinor': 'cost',
    });
    expect(inputOf(draft([])).problems.lines).toBe('lines');
  });

  it('counts base units (bonus included) and the lines that will go to quarantine', () => {
    const totals = totalsOf(draft([line(), line({ key: 'b', qty: '2', bonusQty: '0', expiry: '01/2020' })]), '2026-10-27');
    expect(totals).toEqual({ lines: 2, baseUnits: (5 + 1) * 10 + 2 * 10, expiredLines: 1 });
  });
});

describe('the receiving form', () => {
  it('adds a product from the search with its largest pack chosen, and puts focus on the quantity', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await addPanadol();
    expect(catalog.searchProducts).toHaveBeenCalledWith({ q: 'Panadol' });
    const line = container.querySelector('[data-testid="receipt-line"]')!;
    expect(line.textContent).toContain('Panadol');
    expect(line.textContent).toContain('500 mg · tablet');
    expect((field('Pack received') as HTMLSelectElement).value).toBe('u2');
    expect(document.activeElement).toBe(field('Quantity'));
    expect(text()).toContain('1 items');
  });

  it('adds a pasted barcode at once when it matches exactly one product, with the barcode\'s own pack', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    catalog.searchProducts.mockResolvedValue({ ok: true, data: [{ ...FOUND, matchedOn: 'barcode', unitId: 'u1' }] });
    actions.receiptProduct.mockResolvedValue({ ok: true, data: PANADOL });
    type(search(), '6221012345678');
    await press(search(), 'Enter');
    await settle();
    expect(catalog.searchProducts).toHaveBeenCalledWith({ q: '6221012345678' });
    expect((field('Pack received') as HTMLSelectElement).value).toBe('u1');
    expect(search().value).toBe('');
  });

  it('lists several matches to choose from, and says when nothing matches', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    catalog.searchProducts.mockResolvedValue({ ok: true, data: [FOUND, { ...FOUND, productId: 'p2', label: 'Panadol Extra' }] });
    type(search(), 'pana');
    await press(search(), 'Enter');
    await settle();
    expect(container.querySelectorAll('[data-testid="receipt-picker-result"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="receipt-line"]')).toBeNull();
    catalog.searchProducts.mockResolvedValue({ ok: true, data: [] });
    type(search(), 'zzz');
    await press(search(), 'Enter');
    await settle();
    expect(container.querySelector('[data-testid="receipt-picker-none"]')?.textContent).toContain('No product matches');
  });

  it('says in words how the expiry was understood, and when the date has passed', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await addPanadol();
    type(field('Expiry'), '03/2027');
    expect(container.querySelector('[data-testid="expiry-reading"]')?.textContent).toContain('Expires 03/2027 (month only');
    type(field('Expiry'), '14/03/2027');
    expect(container.querySelector('[data-testid="expiry-reading"]')?.textContent).toBe('Expires 14/03/2027');
    type(field('Expiry'), '01/2020');
    expect(container.querySelector('[data-testid="expiry-reading"]')?.textContent).toContain('already passed');
    expect(container.querySelector('[data-testid="receipt-totals"]')?.textContent).toContain('1 go to quarantine');
  });

  it('moves with Enter through a line and, from its last field, back to the search for the next product', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await addPanadol();
    await press(field('Quantity'), 'Enter');
    expect(document.activeElement).toBe(field('Bonus quantity'));
    await press(field('Cost per pack'), 'Enter');
    expect(document.activeElement).toBe(search());
  });

  it('explains both toggles, and free of charge sets the cost to zero and locks it', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await addPanadol();
    expect(text()).toContain('The cost is zero on purpose');
    expect(text()).toContain('the stock is added to quarantine and cannot be sold');
    const free = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][0]!;
    await click(free);
    expect(field('Cost per pack').value).toBe('0');
    expect(field('Cost per pack').disabled).toBe(true);
  });

  it('shows problems under the fields without calling the server', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await addPanadol();
    await click(button('Save draft')!);
    await settle();
    expect(actions.createReceipt).not.toHaveBeenCalled();
    const line = container.querySelector('[data-testid="receipt-line"]')!;
    expect(line.textContent).toContain('Enter a whole number, 1 or more');
    expect(line.textContent).toContain('Enter the lot');
    expect(line.textContent).toContain('Enter the expiry as MM/YYYY, DD/MM/YYYY or YYYY-MM-DD');
    expect(line.textContent).toContain('Enter the cost as a number');
  });

  async function fill() {
    await addPanadol();
    type(field('Quantity'), '5');
    type(field('Lot'), 'l-100');
    type(field('Expiry'), '03/2027');
    type(field('Cost per pack'), '2500');
    type(field('Supplier'), 'Acme');
  }

  it('saves the draft on the server (idempotent key, no pharmacy or branch in the input) and opens its page', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await fill();
    expect(text()).toContain('Unsaved changes');
    actions.createReceipt.mockResolvedValue({ ok: true, data: { id: 'rc1', version: 1, status: 'DRAFT', replayed: false, lineCount: 1 } });
    await click(button('Save draft')!);
    await settle();
    const sent = actions.createReceipt.mock.calls[0]![0] as Record<string, unknown> & { lines: Record<string, unknown>[] };
    expect(sent.clientKey).toMatch(/.{8,}/);
    expect(sent).not.toHaveProperty('restaurantId');
    expect(sent).not.toHaveProperty('branchId');
    expect(sent).toMatchObject({ supplierName: 'Acme' });
    expect(sent.lines[0]).toMatchObject({ productId: 'p1', unitId: 'u2', qty: 5, lot: 'l-100', expiry: '2027-03-31', unitCostMinor: '2500', currency: 'IQD' });
    expect(router.replace).toHaveBeenCalledWith('/pharmacy/stock/receive/rc1');
  });

  it('asks before confirming, says what will happen, then shows the receipt number with links', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await fill();
    type(field('Expiry'), '01/2020');
    await click(button('Confirm receipt')!);
    const panel = container.querySelector('[data-testid="receipt-confirm"]')!;
    expect(panel.textContent).toContain('1 items, 150 units in all, will be added to the stock of');
    expect(panel.textContent).toContain('Main street');
    expect(panel.textContent).toContain('1 items have an expiry date that has passed. They go to quarantine');
    expect(actions.confirmReceipt).not.toHaveBeenCalled();
    actions.createReceipt.mockResolvedValue({ ok: true, data: { id: 'rc1', version: 1, status: 'DRAFT', replayed: false, lineCount: 1 } });
    actions.confirmReceipt.mockResolvedValue({ ok: true, data: { id: 'rc1', status: 'CONFIRMED', number: 'R-000007', version: 3, branchId: 'b1', warnings: [{ code: 'COST_DIFFERS', lineNo: 1, batchId: 'x' }], lines: 1, baseQty: 150 } });
    await click(button('Confirm and add to stock')!);
    await settle();
    expect(actions.createReceipt).toHaveBeenCalledTimes(1);
    expect(actions.confirmReceipt).toHaveBeenCalledWith({ receiptId: 'rc1' });
    expect(container.querySelector('[data-testid="receipt-number"]')?.textContent).toBe('R-000007');
    expect(container.querySelector('[data-testid="receipt-number"]')?.getAttribute('dir')).toBe('ltr');
    expect(text()).toContain('the cost differs from the cost already kept');
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/pharmacy/stock/receive/rc1', '/pharmacy/stock', '/pharmacy/stock/receive/new']);
  });

  it('shows the server\'s refusal under the line that caused it and keeps what was typed', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await fill();
    type(field('Expiry'), '01/2020');
    actions.createReceipt.mockResolvedValue({ ok: true, data: { id: 'rc1', version: 1, status: 'DRAFT', replayed: false, lineCount: 1 } });
    actions.confirmReceipt.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID', message: 'This lot is already expired: remove it, or accept it into quarantine', fields: { 'lines.0.expiry': 'This lot is already expired: remove it, or accept it into quarantine', phCode: 'EXPIRED' } },
    });
    await click(button('Confirm receipt')!);
    await click(button('Confirm and add to stock')!);
    await settle();
    const line = container.querySelector('[data-testid="receipt-line"]')!;
    expect(line.textContent).toContain('This lot is already expired');
    expect(field('Lot').value).toBe('l-100');
    expect(container.querySelector('[data-testid="receipt-done"]')).toBeNull();
  });

  it('offers "Void" only as a second step, and a saved draft is voided on the server', async () => {
    const initial = { ...emptyDraft('key-12345678', '2026-10-27'), version: 2, lines: [] };
    mount(createElement(ReceiptEditor, editorProps({ initial, receiptId: 'rc9' })));
    await click(button('Void this draft')!);
    expect(container.querySelector('[data-testid="receipt-void-confirm"]')?.textContent).toContain('No stock changes');
    expect(actions.voidReceipt).not.toHaveBeenCalled();
    actions.voidReceipt.mockResolvedValue({ ok: true, data: { id: 'rc9', status: 'VOID' } });
    await click(button('Yes, void it')!);
    await settle();
    expect(actions.voidReceipt).toHaveBeenCalledWith({ receiptId: 'rc9' });
    expect(router.push).toHaveBeenCalledWith('/pharmacy/stock/receive');
  });

  it('cannot save or confirm while offline, and says so', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mount(createElement(ReceiptEditor, editorProps()));
    await settle();
    expect(container.querySelector('[data-testid="stock-offline"]')).toBeTruthy();
    expect(text()).toContain('You are offline');
  });
});

const RECEIPT = (over: Partial<ReceiptDetail> = {}): ReceiptDetail => ({
  id: 'rc1',
  number: 'R-000007',
  status: 'CONFIRMED',
  branchId: 'b1',
  supplierName: 'Acme',
  reference: 'INV-1',
  receivedOn: '2026-10-27',
  lineCount: 1,
  version: 3,
  createdAt: '2026-10-27T08:00:00.000Z',
  note: '',
  confirmedAt: '2026-10-27T09:00:00.000Z',
  lines: [
    {
      lineNo: 1,
      productId: 'p1',
      productName: 'Panadol',
      unitId: 'u1',
      unitLabel: 'strip',
      qty: 5,
      bonusQty: 1,
      baseQty: 60,
      lot: 'L-100',
      expiryDate: '2027-03-31',
      expiryPrecision: 'MONTH',
      freeOfCharge: false,
      acceptExpired: true,
      batchId: 'bt1',
    },
  ],
  ...over,
});
const MOVE: MovementView = {
  id: 'm1',
  type: 'RECEIPT',
  branchId: 'b1',
  productId: 'p1',
  batchId: 'bt1',
  lot: 'L-100',
  availableDelta: 60,
  reservedDelta: 0,
  quarantineDelta: 0,
  damagedDelta: 0,
  reason: '',
  userId: 'user-12345678',
  reversesId: null,
  receiptId: 'rc1',
  countId: null,
  createdAt: '2026-10-27T09:00:00.000Z',
};

describe('a receipt that is read only', () => {
  const view = (receipt: ReceiptDetail, movements: MovementView[] | null = null, locale: Locale = 'en') =>
    createElement(ReceiptView, { receipt, movements, branchName: 'Main street', t: getStudioTranslator(locale), locale });

  it('shows the header, the lines (lot and expiry left to right) and the movements it made', () => {
    mount(view(RECEIPT(), [MOVE]));
    expect(container.querySelector('[data-testid="receipt-number"]')?.textContent).toBe('R-000007');
    expect(container.querySelector('[data-chip="CONFIRMED"]')?.textContent).toBe('Confirmed');
    expect(container.querySelector('[data-testid="receipt-view-lot"]')?.getAttribute('dir')).toBe('ltr');
    expect(text()).toContain('03/2027');
    expect(text()).toContain('Accepted although expired: in quarantine');
    expect(text()).toContain('Stock changes made by this receipt');
    expect(container.querySelectorAll('[data-testid="movement-row"]')).toHaveLength(1);
    expect(container.querySelector('button, input, textarea')).toBeNull();
  });

  it('draws cost only when the payload has the cost keys', () => {
    mount(view(RECEIPT()));
    expect(container.querySelector('[data-cost]')).toBeNull();
    const withCost = RECEIPT();
    withCost.lines[0] = { ...withCost.lines[0]!, unitCostMinor: '2500', currency: 'IQD' };
    mount(view(withCost));
    expect(container.querySelector('[data-cost]')?.textContent).toMatch(/2,500|٢٬٥٠٠/);
  });

  it('shows a void receipt without movements, and a draft without a number', () => {
    mount(view(RECEIPT({ status: 'VOID', number: null, confirmedAt: null }), []));
    expect(container.querySelector('[data-chip="VOID"]')?.textContent).toBe('Void');
    expect(text()).toContain('No number yet');
    expect(text()).not.toContain('Stock changes made by this receipt');
  });

  it('says a confirmed receipt has no recorded changes when the ledger gives none', () => {
    mount(view(RECEIPT(), []));
    expect(text()).toContain('No stock changes are recorded');
  });
});

describe('states and languages', () => {
  it('names each receipt state with an icon and a word', () => {
    mount(createElement('div', null, (['DRAFT', 'CONFIRMED', 'VOID'] as const).map((s) => createElement(ReceiptStatus, { key: s, status: s, t: en }))));
    const chips = [...container.querySelectorAll('[data-chip]')];
    expect(chips.map((c) => c.textContent)).toEqual(['Draft', 'Confirmed', 'Void']);
    for (const chip of chips) expect(chip.querySelector('svg')).toBeTruthy();
  });

  it.each(['readOnly', 'role', 'support'] as const)('says why receiving is blocked (%s) with a lock and a sentence', (reason) => {
    mount(createElement(ReceiveBlocked, { reason, t: en }));
    expect(container.querySelector('[data-testid="receive-write-blocked"] svg')).toBeTruthy();
    expect(text()).toBe(en(`pharmacy.receive.blocked.${reason}`));
  });

  it('loading and failure each say so with an icon, and failure offers a retry', async () => {
    mount(await ReceiveLoading());
    expect(container.querySelector('[role="status"] svg')).toBeTruthy();
    expect(text()).toBe(en('pharmacy.receive.loading'));
    const reset = vi.fn();
    mount(createElement(ReceiveError, { error: new Error('x'), reset }));
    expect(container.querySelector('[role="alert"] svg')).toBeTruthy();
    await click(button('Try again')!);
    expect(reset).toHaveBeenCalled();
  });

  it.each(['ar', 'ckb'] as const)('the form reads right to left in %s with logical classes only and no cut-off rows', async (locale) => {
    mount(createElement(ReceiptEditor, editorProps()), locale);
    await addPanadol();
    expect(document.documentElement.dir).toBe('rtl');
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/);
    expect(html).not.toMatch(/\btext-(?:left|right)\b/);
    // The shared Button is the only thing that does not wrap, and its labels are short.
    expect([...container.querySelectorAll('.whitespace-nowrap')].filter((el) => !el.classList.contains('s-btn'))).toEqual([]);
    expect(container.querySelector('[data-testid="receipt-line"] input[data-nav="lot"]')?.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('[data-testid="receipt-line"] input[data-nav="expiry"]')?.getAttribute('dir')).toBe('ltr');
    expect(text()).not.toContain('pharmacy.receive');
  });

  it('touch targets: every control of the form is at least 44px by class', async () => {
    mount(createElement(ReceiptEditor, editorProps()));
    await addPanadol();
    for (const el of container.querySelectorAll('input:not([type="checkbox"]), select, button')) {
      expect(el.className + (el.parentElement?.className ?? ''), el.outerHTML.slice(0, 80)).toMatch(/min-h-11/);
    }
  });

  it('en, ar and ckb have the same receiving keys with the same placeholders', () => {
    const keys = Object.keys(STUDIO_MESSAGES.en).filter((k) => k.startsWith('pharmacy.receive.') || k === 'pharmacy.nav.receiving');
    expect(keys.length).toBeGreaterThan(100);
    const holes = (m: Record<string, string>) => (k: string) => [...(m[k] ?? '').matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
    for (const locale of ['ar', 'ckb'] as const) {
      const other = STUDIO_MESSAGES[locale] as Record<string, string>;
      for (const key of keys) {
        expect(other[key], `${locale} ${key}`).toBeTruthy();
        expect(holes(other)(key), `${locale} ${key}`).toBe(holes(STUDIO_MESSAGES.en as Record<string, string>)(key));
      }
    }
  });
});
