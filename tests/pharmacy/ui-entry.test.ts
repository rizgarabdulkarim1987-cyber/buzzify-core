// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/lib/locale';
import { StudioI18nProvider } from '@/studio/i18n';
import { getStudioTranslator, STUDIO_MESSAGES } from '@/studio/messages';

/**
 * The fast product entry screen (plan Task 14, prototype docs/pharmacy/prototypes/product-entry-2026-11-05.html): one scan
 * field, a status line, the known product's six-field batch form or the new product's form, the history, the "entered now"
 * list and Finish. No dialog, Enter walks the fields, F2 saves, Esc clears; one line per save, retried with the same key.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/pharmacy/stock/entry' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }));
const actions = vi.hoisted(() => ({
  addEntryLine: vi.fn(),
  finishEntry: vi.fn(),
  lookupEntryProduct: vi.fn(),
  readEntryDraft: vi.fn(async () => ({ ok: true, data: { draft: null } })),
  readProductHistory: vi.fn<(input: unknown) => Promise<unknown>>(async () => ({ ok: true, data: { purchases: [], sales: [], returns: [] } })),
}));
vi.mock('@/app/pharmacy/_actions/entry', () => actions);

const { EntryScreen } = await import('@/app/pharmacy/_ui/entry/EntryScreen');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T09:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.readEntryDraft.mockImplementation(async () => ({ ok: true, data: { draft: null } }));
  actions.readProductHistory.mockImplementation(async () => ({ ok: true, data: { purchases: [], sales: [], returns: [] } }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function mount(element: ReactElement, locale: Locale = 'en') {
  const props = { locale, messages: STUDIO_MESSAGES[locale] } as ComponentProps<typeof StudioI18nProvider>;
  act(() => root.render(createElement(StudioI18nProvider, props, element)));
}
const byTest = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allTest = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const field = (name: string) => byTest(`entry-field-${name}`) as HTMLInputElement;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await settle();
};
function press(init: KeyboardEventInit, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
function typeIn(el: HTMLInputElement | HTMLSelectElement, text: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setValue.call(el, text);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function scan(code: string) {
  const input = byTest('entry-scan') as HTMLInputElement;
  typeIn(input, code);
  const event = press({ key: 'Enter' }, input);
  await flush();
  return event;
}

const SUPPLIERS = [
  { id: 's1', name: 'Al-Hakeem store' },
  { id: 's2', name: 'East store' },
];
const PRODUCT = {
  id: 'p1',
  tradeName: 'Glucophage 500mg tab',
  activeIngredient: 'metformin',
  rxLevel: 'RX' as const,
  packetUnitId: 'u3',
  packetLabel: 'packet',
  packetBaseQty: 30,
  units: [
    { id: 'u1', level: 1, label: 'tablet', baseQty: 1, sellable: true },
    { id: 'u2', level: 2, label: 'strip', baseQty: 10, sellable: true },
    { id: 'u3', level: 3, label: 'packet', baseQty: 30, sellable: true },
  ],
};
const known = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    canChangePrice: true,
    canCreateProduct: true,
    currency: 'IQD',
    kind: 'known',
    product: PRODUCT,
    stockBaseQty: 2130,
    sellPrice: { amountMinor: '20000', currency: 'IQD' },
    lastPurchase: { receivedOn: '2026-10-04', supplierId: 's1', supplierName: 'Al-Hakeem store', purchasePriceMinor: '310', purchaseCurrency: 'USD' },
    ...over,
  },
});
const unknown = (over: Record<string, unknown> = {}) => ({ ok: true, data: { canChangePrice: true, canCreateProduct: true, currency: 'IQD', kind: 'new', barcode: '1234500099', ...over } });
const LINE = { lineNo: 1, productId: 'p1', productName: 'Glucophage 500mg tab', isNew: false, qty: 30, unitLabel: 'packet', expiry: '01/2028', lot: 'EXP-202801', sellPriceMinor: '20000', currency: 'IQD' as const };
const saved = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: { receiptId: 'rc1', version: 1, lineNo: 1, lineCount: 1, productId: 'p1', productCreated: false, priceChanged: false, replayed: false, line: LINE, ...over },
});

function screen(over: Partial<ComponentProps<typeof EntryScreen>> = {}) {
  mount(createElement(EntryScreen, { branchId: 'b1', canChangePrice: true, canSeeCost: true, suppliers: SUPPLIERS, initialDraft: null, ...over }));
}
const KNOWN_FIELDS = ['qty', 'expiry', 'purchasePrice', 'sellPrice', 'lot', 'supplierId'];
const formFields = () => allTest('entry-form-field').map((el) => el.dataset.field);

describe('the entry screen', () => {
  it('starts idle with the scan field focused and nothing entered', () => {
    screen();
    expect(document.activeElement).toBe(byTest('entry-scan'));
    expect(byTest('entry-status')?.dataset.state).toBe('idle');
    expect(byTest('entry-form')).toBeNull();
    expect(byTest('entry-done-empty')).not.toBeNull();
  });

  it('shows a known barcode with its summary and the six-field form pre-filled from the last purchase', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    screen();
    await scan('6260147701596');
    expect(actions.lookupEntryProduct).toHaveBeenCalledWith({ q: '6260147701596' });
    expect(byTest('entry-status')?.dataset.state).toBe('known');
    expect(byTest('entry-status')?.textContent).toContain('Glucophage 500mg tab');
    expect(byTest('entry-form')?.dataset.kind).toBe('known');
    expect(formFields()).toEqual(KNOWN_FIELDS);
    expect(field('qty').value).toBe('');
    expect(field('purchasePrice').value).toBe('3.10');
    expect(field('sellPrice').value).toBe('20000');
    expect(field('sellPrice').readOnly).toBe(false);
    expect(field('lot').value).toBe('');
    expect((byTest('entry-field-supplierId') as unknown as HTMLSelectElement).value).toBe('s1');
    const summary = byTest('entry-summary')!.textContent!;
    expect(summary).toContain('71');
    expect(summary).toContain('3.10');
    expect(summary).toContain('20,000');
    expect(summary).toContain('Al-Hakeem store');
    expect(document.activeElement).toBe(field('qty'));
    expect(actions.readProductHistory).toHaveBeenCalledWith({ productId: 'p1' });
  });

  it('shows an unknown barcode as the new-product form: four required fields marked, the optional ones on the same screen', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(unknown());
    screen();
    await scan('1234500099');
    expect(byTest('entry-status')?.dataset.state).toBe('new');
    expect(byTest('entry-status')?.textContent).toContain('1234500099');
    expect(byTest('entry-form')?.dataset.kind).toBe('new');
    const required = allTest('entry-form-field').filter((el) => el.dataset.required === 'true').map((el) => el.dataset.field);
    expect(required).toEqual(['name', 'sellPrice', 'qty', 'expiry']);
    for (const f of ['purchasePrice', 'stripsPerPacket', 'tabletsPerStrip', 'activeIngredient', 'supplierId', 'lowStock', 'lot']) expect(formFields()).toContain(f);
    expect(byTest('entry-rx-yes')).not.toBeNull();
    expect(byTest('entry-summary')).toBeNull();
    expect(document.activeElement).toBe(field('name'));
    expect(byTest('history-purchases')?.textContent).toContain('New product');
  });

  it('names a missing required field inline and focuses it, without sending', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(unknown());
    screen();
    await scan('1234500099');
    typeIn(field('name'), 'Panadol Extra');
    const event = press({ key: 'F2' }, document);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(actions.addEntryLine).not.toHaveBeenCalled();
    expect(byTest('entry-msg')?.textContent).toContain('Selling price per packet');
    expect(document.activeElement).toBe(field('sellPrice'));
  });

  it('refuses a past or malformed expiry with the expiry message and focuses it', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '5');
    typeIn(field('expiry'), '1027');
    expect(field('expiry').value).toBe('10/27');
    typeIn(field('expiry'), '1325');
    expect(field('expiry').value).toBe('13/25');
    act(() => (byTest('entry-save') as HTMLButtonElement).click());
    await flush();
    expect(actions.addEntryLine).not.toHaveBeenCalled();
    expect(byTest('entry-msg')?.textContent).toMatch(/expiry/i);
    expect(document.activeElement).toBe(field('expiry'));
  });

  it('moves to the next field on Enter and saves on Enter in the last field', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    actions.addEntryLine.mockResolvedValueOnce(saved());
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '30');
    let event = press({ key: 'Enter' }, field('qty'));
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field('expiry'));
    typeIn(field('expiry'), '0128');
    for (const next of ['purchasePrice', 'sellPrice', 'lot', 'supplierId']) {
      press({ key: 'Enter' });
      expect(document.activeElement).toBe(byTest(`entry-field-${next}`));
    }
    expect(actions.addEntryLine).not.toHaveBeenCalled();
    event = press({ key: 'Enter' });
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(actions.addEntryLine).toHaveBeenCalledTimes(1);
    const sent = actions.addEntryLine.mock.calls[0]![0];
    expect(sent).toMatchObject({ product: { kind: 'known', productId: 'p1' }, qty: 30, expiry: { month: 1, year: 2028 }, purchasePrice: '3.10', purchaseCurrency: 'USD', sellPrice: '20000', lot: '', supplierId: 's1' });
    expect(sent.requestKey.length).toBeGreaterThanOrEqual(8);
  });

  it('after a save lists the line under "entered now", empties the scan field and focuses it', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    actions.addEntryLine.mockResolvedValueOnce(saved());
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '30');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    await flush();
    const items = allTest('entry-done-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Glucophage 500mg tab');
    expect(items[0]!.textContent).toContain('01/2028');
    expect(byTest('entry-count')?.textContent).toContain('1');
    expect((byTest('entry-scan') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(byTest('entry-scan'));
    expect(byTest('entry-form')).toBeNull();
    expect(byTest('entry-status')?.dataset.state).toBe('idle');
    expect(byTest('entry-status')?.textContent).toContain('Glucophage 500mg tab');
  });

  it('keeps the selling price read-only and unsent without price.change', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known({ canChangePrice: false }));
    actions.addEntryLine.mockResolvedValueOnce(saved());
    screen({ canChangePrice: false });
    await scan('6260147701596');
    expect(field('sellPrice').readOnly).toBe(true);
    expect(field('sellPrice').value).toBe('20000');
    typeIn(field('qty'), '2');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    await flush();
    expect(actions.addEntryLine.mock.calls[0]![0].sellPrice).toBeNull();
  });

  it('does not mark the selling price required for a new product without price.change', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(unknown({ canChangePrice: false }));
    screen({ canChangePrice: false });
    await scan('1234500099');
    expect(field('sellPrice').readOnly).toBe(true);
    const required = allTest('entry-form-field').filter((el) => el.dataset.required === 'true').map((el) => el.dataset.field);
    expect(required).toEqual(['name', 'qty', 'expiry']);
  });

  it('opens no dialog in any state', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(unknown());
    screen({ initialDraft: { receiptId: 'rc1', version: 1, supplierId: null, supplierName: '', createdAt: '2026-11-06T08:00:00Z', lineCount: 1, lines: [LINE] } });
    await scan('1234500099');
    press({ key: 'F2' }, document);
    act(() => (byTest('entry-finish') as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"], dialog, [role="alertdialog"]')).toBeNull();
  });

  it('does not send twice on a double Enter, and retries a lost answer with the same key', async () => {
    actions.lookupEntryProduct.mockResolvedValue(known());
    let answer: (value: unknown) => void = () => {};
    actions.addEntryLine.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    act(() => field('supplierId').focus());
    press({ key: 'Enter' });
    press({ key: 'Enter' });
    press({ key: 'F2' }, document);
    expect(actions.addEntryLine).toHaveBeenCalledTimes(1);
    expect((byTest('entry-save') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => answer(saved()));
    await flush();
    expect(allTest('entry-done-item')).toHaveLength(1);

    // A lost answer keeps the key: the next save resends it.
    await scan('6260147701596');
    typeIn(field('qty'), '4');
    typeIn(field('expiry'), '0228');
    actions.addEntryLine.mockRejectedValueOnce(new Error('network'));
    // The re-read after the lost answer shows the entry as the server has it: the first line, the lost one not (yet).
    actions.readEntryDraft.mockResolvedValueOnce({ ok: true, data: { draft: { receiptId: 'rc1', version: 1, supplierId: 's1', supplierName: 'Al-Hakeem store', createdAt: '2026-11-06T08:00:00Z', lineCount: 1, lines: [LINE] } } } as never);
    press({ key: 'F2' }, document);
    await flush();
    expect(byTest('entry-msg')?.textContent).toMatch(/no answer/i);
    actions.addEntryLine.mockResolvedValueOnce(saved({ lineNo: 2, lineCount: 2, line: { ...LINE, lineNo: 2, qty: 4 } }));
    press({ key: 'F2' }, document);
    await flush();
    const keys = actions.addEntryLine.mock.calls.map((c) => c[0].requestKey);
    expect(keys).toHaveLength(3);
    expect(keys[2]).toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[0]);
    expect(actions.addEntryLine.mock.calls[2]![0]).toEqual(actions.addEntryLine.mock.calls[1]![0]);
    expect(allTest('entry-done-item')).toHaveLength(2);
  });

  it('shows a refusal on the field the server named and focuses it', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    actions.addEntryLine.mockResolvedValueOnce({ ok: false, error: { code: 'INVALID', message: 'Enter a purchase price above 0', fields: { purchasePrice: 'Enter a purchase price above 0' } } });
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    typeIn(field('purchasePrice'), '0');
    press({ key: 'F2' }, document);
    await flush();
    expect(byTest('entry-msg')?.textContent).toContain('Purchase price per packet');
    expect(document.activeElement).toBe(field('purchasePrice'));
    expect(field('purchasePrice').getAttribute('aria-invalid')).toBe('true');
  });

  it('arms Finish on the first tap, posts once on the second with the receipt id, then shows the done state', async () => {
    let answer: (value: unknown) => void = () => {};
    actions.finishEntry.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    screen({ initialDraft: { receiptId: 'rc1', version: 3, supplierId: 's1', supplierName: 'Al-Hakeem store', createdAt: '2026-11-06T08:00:00Z', lineCount: 1, lines: [LINE] } });
    expect(allTest('entry-done-item')).toHaveLength(1);
    const finish = byTest('entry-finish') as HTMLButtonElement;
    act(() => finish.click());
    expect(actions.finishEntry).not.toHaveBeenCalled();
    expect(finish.getAttribute('aria-pressed')).toBe('true');
    act(() => finish.click());
    act(() => (byTest('entry-finish') as HTMLButtonElement | null)?.click());
    expect(actions.finishEntry).toHaveBeenCalledTimes(1);
    expect(actions.finishEntry).toHaveBeenCalledWith({ receiptId: 'rc1' });
    await act(async () => answer({ ok: true, data: { id: 'rc1', status: 'CONFIRMED', number: 'GR-12', lines: 1, baseQty: 900, warnings: [], replayed: false } }));
    await flush();
    expect(byTest('entry-finished')?.textContent).toContain('GR-12');
    expect(byTest('entry-back')?.getAttribute('href')).toBe('/pharmacy/stock');
    act(() => (byTest('entry-again') as HTMLButtonElement).click());
    expect(byTest('entry-finished')).toBeNull();
    expect(allTest('entry-done-item')).toHaveLength(0);
    expect(document.activeElement).toBe(byTest('entry-scan'));
  });

  it('says how to get past a line that expired since it was entered (Finish is refused with EXPIRED)', async () => {
    actions.finishEntry.mockResolvedValueOnce({ ok: false, error: { code: 'INVALID', message: 'This lot is already expired: remove it, or accept it into quarantine', fields: { phCode: 'EXPIRED', 'lines.0.expiry': 'x' } } });
    screen({ initialDraft: { receiptId: 'rc1', version: 3, supplierId: 's1', supplierName: 'Al-Hakeem store', createdAt: '2026-11-06T08:00:00Z', lineCount: 1, lines: [LINE] } });
    act(() => (byTest('entry-finish') as HTMLButtonElement).click());
    act(() => (byTest('entry-finish') as HTMLButtonElement).click());
    await flush();
    expect(byTest('entry-msg')?.textContent).toBe(getStudioTranslator('en')('pharmacy.entry.finishExpired'));
    expect(byTest('entry-msg')?.textContent).toContain('Receiving');
  });

  it('keeps Finish off with nothing entered', () => {
    screen();
    expect((byTest('entry-finish') as HTMLButtonElement).disabled).toBe(true);
  });

  it('prevents Enter, F2 and Esc only when they act; Esc clears the product and refocuses the scan field', async () => {
    screen();
    expect(press({ key: 'Enter' }, byTest('entry-scan')!).defaultPrevented).toBe(false);
    expect(press({ key: 'F2' }, document).defaultPrevented).toBe(false);
    expect(press({ key: 'Escape' }, document).defaultPrevented).toBe(false);
    expect(actions.lookupEntryProduct).not.toHaveBeenCalled();

    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    const event = await scan('6260147701596');
    expect(event.defaultPrevented).toBe(true);
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(true);
    expect(byTest('entry-form')).toBeNull();
    expect(byTest('entry-status')?.dataset.state).toBe('idle');
    expect(document.activeElement).toBe(byTest('entry-scan'));
  });

  it('lists several matches to choose from and opens the chosen one', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce({ ok: true, data: { canChangePrice: true, canCreateProduct: true, currency: 'IQD', kind: 'choose', candidates: [{ productId: 'p1', tradeName: 'Glucophage 500', packLabel: 'packet' }, { productId: 'p2', tradeName: 'Glucophage 850', packLabel: 'packet' }] } });
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    screen();
    await scan('gluco');
    expect(allTest('entry-candidate')).toHaveLength(2);
    act(() => allTest('entry-candidate')[0]!.click());
    await flush();
    expect(actions.lookupEntryProduct).toHaveBeenLastCalledWith({ productId: 'p1' });
    expect(byTest('entry-form')?.dataset.kind).toBe('known');
  });

  it('shows the three history tables for a known product', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    actions.readProductHistory.mockResolvedValueOnce({
      ok: true,
      data: {
        purchases: [{ receiptNumber: 'GR-1', receivedOn: '2026-10-04', supplierName: 'Al-Hakeem store', qty: 30, bonusQty: 0, unitLabel: 'packet', lot: 'L1', expiryDate: '2028-01-31', expiryPrecision: 'MONTH', unitCostMinor: '310', currency: 'USD' }],
        sales: [{ saleNumber: 'S-1', soldAt: '2026-11-05T10:00:00Z', unitLabel: 'strip', qty: 2, unitPriceMinor: '2000', totalMinor: '4000', currency: 'IQD' }],
        returns: [{ returnNumber: 'R-1', returnedAt: '2026-10-28T10:00:00Z', unitLabel: 'strip', qty: 1, baseQty: 10, refundMinor: '2000', currency: 'IQD', reason: 'Wrong item' }],
      },
    });
    screen();
    await scan('6260147701596');
    expect(byTest('history-purchases')?.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(byTest('history-purchases')?.textContent).toContain('3.10');
    expect(byTest('history-purchases')?.textContent).toContain('01/2028');
    expect(byTest('history-sales')?.textContent).toContain('2,000');
    expect(byTest('history-returns')?.textContent).toContain('Wrong item');
  });

  it('freezes the form after a lost answer and resends the stored line unchanged, even when an edit is tried', async () => {
    actions.lookupEntryProduct.mockResolvedValue(known());
    actions.addEntryLine.mockRejectedValueOnce(new Error('network'));
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    await flush();
    expect(byTest('entry-msg')?.textContent).toMatch(/no answer/i);
    expect(field('expiry').readOnly).toBe(true);
    expect(field('qty').readOnly).toBe(true);
    expect((byTest('entry-field-supplierId') as unknown as HTMLSelectElement).disabled).toBe(true);
    // The person tries to correct the expiry: the frozen form keeps the line that was sent.
    typeIn(field('expiry'), '0229');
    expect(field('expiry').value).toBe('01/28');
    // The draft is re-read (the list shows what landed) and Finish waits for the line.
    expect(actions.readEntryDraft).toHaveBeenCalled();
    expect((byTest('entry-finish') as HTMLButtonElement).disabled).toBe(true);
    actions.addEntryLine.mockResolvedValueOnce(saved());
    press({ key: 'F2' }, document);
    await flush();
    const [first, second] = actions.addEntryLine.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first);
    expect(second.expiry).toEqual({ month: 1, year: 2028 });
    expect(allTest('entry-done-item')).toHaveLength(1);
  });

  it('treats an unexpected server answer like a lost one (the cashier rule): frozen, resent with the same key', async () => {
    actions.lookupEntryProduct.mockResolvedValue(known());
    actions.addEntryLine.mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    await flush();
    expect(byTest('entry-msg')?.textContent).toMatch(/no answer/i);
    expect(field('qty').readOnly).toBe(true);
    actions.addEntryLine.mockResolvedValueOnce(saved());
    press({ key: 'F2' }, document);
    await flush();
    const [first, second] = actions.addEntryLine.mock.calls.map((c) => c[0]);
    expect(second).toEqual(first);
    expect(allTest('entry-done-item')).toHaveLength(1);
  });

  it('refuses a new scan while a lost line waits, and drops the line only on the armed drop button', async () => {
    actions.lookupEntryProduct.mockResolvedValue(known());
    actions.addEntryLine.mockRejectedValueOnce(new Error('network'));
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    await flush();
    const lookups = actions.lookupEntryProduct.mock.calls.length;
    await scan('6291003012345');
    expect(actions.lookupEntryProduct.mock.calls.length).toBe(lookups);
    expect(byTest('entry-msg')?.textContent).toBe(STUDIO_MESSAGES.en['pharmacy.entry.msg.pendingFirst']);
    expect((byTest('entry-scan') as HTMLInputElement).value).toBe('6291003012345');
    const drop = byTest('entry-drop') as HTMLButtonElement;
    act(() => drop.click());
    expect(byTest('entry-form')).not.toBeNull();
    act(() => drop.click());
    await flush();
    expect(byTest('entry-form')).toBeNull();
    // A fresh save of the same product after the drop gets a new key.
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    actions.addEntryLine.mockResolvedValueOnce(saved());
    press({ key: 'F2' }, document);
    await flush();
    const keys = actions.addEntryLine.mock.calls.map((c) => c[0].requestKey);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('says in entry words when the earlier save went through with other values, keeps the form and re-reads the list', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    actions.addEntryLine.mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'This key was already used for a different receipt', fields: { phCode: 'CLIENT_KEY_MISMATCH' } } });
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    actions.readEntryDraft.mockClear();
    press({ key: 'F2' }, document);
    await flush();
    expect(byTest('entry-msg')?.textContent).toBe(STUDIO_MESSAGES.en['pharmacy.entry.msg.keyMismatch']);
    expect(byTest('entry-form')).not.toBeNull();
    expect(actions.readEntryDraft).toHaveBeenCalled();
  });

  it('queues a scan made while a save is on its way and opens it after the save', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known());
    let answer: (value: unknown) => void = () => {};
    actions.addEntryLine.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    screen();
    await scan('6260147701596');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    actions.lookupEntryProduct.mockResolvedValueOnce(unknown());
    await scan('1234500099');
    expect(actions.lookupEntryProduct).toHaveBeenCalledTimes(1);
    await act(async () => answer(saved()));
    await flush();
    expect(allTest('entry-done-item')).toHaveLength(1);
    expect(actions.lookupEntryProduct).toHaveBeenLastCalledWith({ q: '1234500099' });
    expect(byTest('entry-form')?.dataset.kind).toBe('new');
  });

  it('moves on from a focused read-only selling price on Enter instead of saving early', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known({ canChangePrice: false }));
    screen({ canChangePrice: false });
    await scan('6260147701596');
    act(() => field('sellPrice').focus());
    press({ key: 'Enter' });
    expect(document.activeElement).toBe(field('lot'));
    expect(actions.addEntryLine).not.toHaveBeenCalled();
  });

  it('requires an editable selling price for a known product with no price yet', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known({ sellPrice: null }));
    screen();
    await scan('6260147701596');
    expect(allTest('entry-form-field').find((e) => e.dataset.field === 'sellPrice')?.dataset.required).toBe('true');
    typeIn(field('qty'), '3');
    typeIn(field('expiry'), '0128');
    press({ key: 'F2' }, document);
    await flush();
    expect(actions.addEntryLine).not.toHaveBeenCalled();
    expect(byTest('entry-msg')?.textContent).toContain('Selling price per packet');
    expect(document.activeElement).toBe(field('sellPrice'));
  });

  it('shows no purchase price to a role without cost.view', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(known({ lastPurchase: { receivedOn: '2026-10-04', supplierId: 's1', supplierName: 'Al-Hakeem store' } }));
    actions.readProductHistory.mockResolvedValueOnce({
      ok: true,
      data: { purchases: [{ receiptNumber: 'GR-1', receivedOn: '2026-10-04', supplierName: 'Al-Hakeem store', qty: 30, bonusQty: 0, unitLabel: 'packet', lot: 'L1', expiryDate: '2028-01-31', expiryPrecision: 'MONTH' }], sales: [], returns: [] },
    });
    screen({ canSeeCost: false });
    await scan('6260147701596');
    expect(field('purchasePrice').value).toBe('');
    expect(byTest('entry-summary')?.textContent).toContain('None');
    const head = [...byTest('history-purchases')!.querySelectorAll('th')].map((th) => th.textContent);
    expect(head).not.toContain('Price');
    expect(head).toContain('Expiry');
  });

  it('tells a role that cannot add products so, instead of the new form', async () => {
    actions.lookupEntryProduct.mockResolvedValueOnce(unknown({ canCreateProduct: false }));
    screen();
    await scan('1234500099');
    expect(byTest('entry-status')?.textContent).toBe(STUDIO_MESSAGES.en['pharmacy.entry.state.noCreate']);
    expect(byTest('entry-form')).toBeNull();
    expect(press({ key: 'F2' }, document).defaultPrevented).toBe(false);
  });

  it('has every entry string in Arabic and Sorani too', () => {
    const keys = Object.keys(STUDIO_MESSAGES.en).filter((k) => k.startsWith('pharmacy.entry.'));
    expect(keys.length).toBeGreaterThan(30);
    for (const locale of ['ar', 'ckb'] as const) for (const k of keys) expect(STUDIO_MESSAGES[locale][k], `${locale} ${k}`).toBeTruthy();
  });
});
