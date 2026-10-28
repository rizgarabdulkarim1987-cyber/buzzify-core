import { describe, expect, it, vi } from 'vitest';
import { UNEXPECTED_MESSAGE } from '@/server/studio/framework/result';
import { NETWORK_FAILURE } from '@/studio/settle';
import {
  blockedLines,
  buildCartRequest,
  cartFromResume,
  cartReducer,
  cashShortcuts,
  createScanQueue,
  draftKey,
  emptyCart,
  estimateCart,
  formatMinor,
  holdSignature,
  keyFor,
  newClientKey,
  openedShiftOrClosed,
  outcomeUnknown,
  overSellable,
  parseDraft,
  parseMoney,
  parsePercent,
  parseQtyText,
  paymentPreview,
  refreshCart,
  saleAttemptFor,
  saleSignature,
  scanOutcome,
  serializeDraft,
  shortcutOf,
  TOTAL_MOVED_CODES,
  unitOf,
  type AddableItem,
  type CartState,
  type PayDraft,
  type ScanItem,
} from '@/app/pharmacy/_ui/sell-logic';

/**
 * The sale screen's client logic: money text, the cart, the estimate, the request, the draft on the device and the keys.
 * Pure functions, hand figures (3 x 1,500 = 4,500; 10 % of it = 450), no database.
 */

const item = (over: Partial<AddableItem> = {}): AddableItem => ({
  productId: 'p1',
  tradeName: 'Panadol',
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

const withLines = (...actions: Parameters<typeof cartReducer>[1][]): CartState => actions.reduce(cartReducer, emptyCart());

describe('money text', () => {
  it('formats IQD without decimals and USD with two, grouped, Latin digits', () => {
    expect(formatMinor(1_250_000n, 'IQD')).toBe('1,250,000');
    expect(formatMinor(1250n, 'USD')).toBe('12.50');
    expect(formatMinor(5n, 'USD')).toBe('0.05');
    expect(formatMinor(0n, 'IQD')).toBe('0');
    expect(formatMinor(-1500n, 'IQD')).toBe('-1,500');
  });

  it('is exact above Number.MAX_SAFE_INTEGER (BigInt all the way)', () => {
    expect(formatMinor(12_345_678_901_234_567_890n, 'IQD')).toBe('12,345,678,901,234,567,890');
    expect(formatMinor(9_007_199_254_740_993n, 'USD')).toBe('90,071,992,547,409.93');
  });

  it('parses what a person types, in Latin, Arabic-Indic or Persian digits', () => {
    expect(parseMoney('1,250', 'IQD')).toBe(1250n);
    expect(parseMoney('١٢٥٠', 'IQD')).toBe(1250n);
    expect(parseMoney('۱۲۵۰', 'IQD')).toBe(1250n);
    expect(parseMoney('12.5', 'USD')).toBe(1250n);
    expect(parseMoney('١٢٫٥٠', 'USD')).toBe(1250n);
    expect(parseMoney('12', 'USD')).toBe(1200n);
  });

  it('refuses what is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1.5', '12.345', '1e3', '1,2,x']) expect(parseMoney(bad, bad === '12.345' ? 'USD' : 'IQD')).toBeNull();
    expect(parseMoney('99999999999999999999', 'IQD')).toBeNull();
  });

  it('parses percents to basis points, at most two decimals, 0 to 100', () => {
    expect(parsePercent('5')).toBe(500);
    expect(parsePercent('2.5')).toBe(250);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('100.01')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(parsePercent('x')).toBeNull();
  });
});

describe('the cart reducer', () => {
  it('adds a product, and adding it again in the same unit raises the quantity', () => {
    const cart = withLines({ type: 'add', item: item() }, { type: 'add', item: item() });
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]!.qty).toBe(2);
  });

  it('starts in the unit a barcode named, else the smallest unit', () => {
    expect(withLines({ type: 'add', item: item() }).lines[0]!.unitId).toBe('tab');
    expect(withLines({ type: 'add', item: item({ matchedUnitId: 'box' }) }).lines[0]!.unitId).toBe('box');
    expect(withLines({ type: 'add', item: item(), unitId: 'box' }).lines[0]!.unitId).toBe('box');
  });

  it('keeps different units of one product as separate lines', () => {
    const cart = withLines({ type: 'add', item: item(), unitId: 'box' }, { type: 'add', item: item(), unitId: 'tab' });
    expect(cart.lines.map((l) => l.unitId)).toEqual(['box', 'tab']);
  });

  it('clamps the quantity between 1 and the maximum and never takes a fraction', () => {
    const key = withLines({ type: 'add', item: item() }).lines[0]!.key;
    const at = (qty: number) => withLines({ type: 'add', item: item() }, { type: 'qty', key, qty }).lines[0]!.qty;
    expect(at(0)).toBe(1);
    expect(at(-5)).toBe(1);
    expect(at(2.9)).toBe(2);
    expect(at(Number.NaN)).toBe(1);
    expect(at(9_999_999)).toBe(1_000_000);
    expect(withLines({ type: 'add', item: item() }, { type: 'step', key, delta: -1 }).lines[0]!.qty).toBe(1);
  });

  it('changing the unit drops a chosen batch; an unknown unit changes nothing', () => {
    let cart = withLines({ type: 'add', item: item() });
    const key = cart.lines[0]!.key;
    cart = cartReducer(cart, { type: 'batch', key, batchId: 'b1', lot: 'L1', reason: 'near expiry' });
    expect(cart.lines[0]!.batchId).toBe('b1');
    expect(cartReducer(cart, { type: 'unit', key, unitId: 'nope' })).toEqual(cart);
    cart = cartReducer(cart, { type: 'unit', key, unitId: 'box' });
    expect(cart.lines[0]!.unitId).toBe('box');
    expect(cart.lines[0]!.batchId).toBeNull();
  });

  it('a line with a chosen batch or a discount is not merged into', () => {
    let cart = withLines({ type: 'add', item: item() });
    cart = cartReducer(cart, { type: 'discount', key: cart.lines[0]!.key, discount: { kind: 'percent', value: '5' } });
    cart = cartReducer(cart, { type: 'add', item: item() });
    expect(cart.lines).toHaveLength(2);
  });

  it('removes and clears', () => {
    let cart = withLines({ type: 'add', item: item() }, { type: 'add', item: item({ productId: 'p2' }) });
    cart = cartReducer(cart, { type: 'remove', key: cart.lines[0]!.key });
    expect(cart.lines.map((l) => l.productId)).toEqual(['p2']);
    expect(cartReducer(cart, { type: 'clear' }).lines).toEqual([]);
  });

  it('stops at 200 lines', () => {
    let cart = emptyCart();
    for (let i = 0; i < 205; i += 1) cart = cartReducer(cart, { type: 'add', item: item({ productId: `p${i}` }) });
    expect(cart.lines).toHaveLength(200);
  });

  it('warns when the cart takes more base units than were sellable, across lines of one product', () => {
    const cart = withLines({ type: 'add', item: item({ sellableQty: 30 }), unitId: 'box' }, { type: 'add', item: item({ sellableQty: 30 }), unitId: 'tab' });
    expect([...overSellable(cart)]).toEqual([]);
    const more = cartReducer(cart, { type: 'qty', key: cart.lines[1]!.key, qty: 7 });
    expect([...overSellable(more)]).toEqual(['p1']);
  });
});

describe('the estimate', () => {
  const cart3 = () => {
    const cart = withLines({ type: 'add', item: item() });
    return cartReducer(cart, { type: 'qty', key: cart.lines[0]!.key, qty: 3 });
  };

  it('is quantity x price, with the line discount taken off (3 x 1,500 = 4,500; 10 % = 450)', () => {
    let cart = cart3();
    cart = cartReducer(cart, { type: 'discount', key: cart.lines[0]!.key, discount: { kind: 'percent', value: '10' } });
    const e = estimateCart(cart, 'IQD', 0);
    expect(e.grossMinor).toBe(4500n);
    expect(e.lineDiscountMinor).toBe(450n);
    expect(e.totalMinor).toBe(4050n);
    expect(e.roundingMinor).toBe(0n);
  });

  it('takes an invoice discount off the rest and a line amount in the currency units', () => {
    let cart = cart3();
    cart = cartReducer(cart, { type: 'discount', key: cart.lines[0]!.key, discount: { kind: 'amount', value: '500' } });
    cart = cartReducer(cart, { type: 'invoiceDiscount', discount: { kind: 'percent', value: '50' } });
    const e = estimateCart(cart, 'IQD', 0);
    expect(e.lineDiscountMinor).toBe(500n);
    expect(e.invoiceDiscountMinor).toBe(2000n);
    expect(e.totalMinor).toBe(2000n);
  });

  it('rounds the IQD invoice to the step, a tie going up, and shows the signed difference', () => {
    let cart = cart3();
    cart = cartReducer(cart, { type: 'discount', key: cart.lines[0]!.key, discount: { kind: 'percent', value: '10' } });
    const e = estimateCart(cart, 'IQD', 250); // 4,050 -> 4,000
    expect(e.totalMinor).toBe(4000n);
    expect(e.roundingMinor).toBe(-50n);
    const up = estimateCart(withLines({ type: 'add', item: item({ units: [{ id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '125' }] }) }), 'IQD', 250); // 125 is a tie -> 250
    expect(up.totalMinor).toBe(250n);
  });

  it('never turns a positive total into zero (rounds up to one step) and never rounds USD', () => {
    const tiny = withLines({ type: 'add', item: item({ units: [{ id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '100' }] }) });
    const e = estimateCart(tiny, 'IQD', 250);
    expect(e.totalMinor).toBe(250n);
    expect(e.roundingMinor).toBe(150n);
    const usd = estimateCart(cart3(), 'USD', 250);
    expect(usd.roundingMinor).toBe(0n);
    expect(usd.totalMinor).toBe(4500n);
  });

  it('flags a line with no price and a discount that cannot be read, and leaves them out of the total', () => {
    let cart = withLines({ type: 'add', item: item({ units: [{ id: 'tab', label: 'tablet', baseQty: 1, priceMinor: null }] }) });
    expect(estimateCart(cart, 'IQD', 0).unpricedCount).toBe(1);
    cart = cart3();
    cart = cartReducer(cart, { type: 'discount', key: cart.lines[0]!.key, discount: { kind: 'percent', value: 'abc' } });
    const e = estimateCart(cart, 'IQD', 0);
    expect(e.invalidCount).toBe(1);
  });

  it('a discount above the line is invalid, not capped', () => {
    let cart = cart3();
    cart = cartReducer(cart, { type: 'discount', key: cart.lines[0]!.key, discount: { kind: 'amount', value: '5000' } });
    expect(estimateCart(cart, 'IQD', 0).invalidCount).toBe(1);
  });

  it('stays exact with prices near the allowed maximum (no Number for money)', () => {
    const big = withLines({ type: 'add', item: item({ units: [{ id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '900000000000000' }] }) });
    const e = estimateCart(big, 'IQD', 0);
    expect(e.totalMinor).toBe(900_000_000_000_000n);
    expect(formatMinor(e.totalMinor, 'IQD')).toBe('900,000,000,000,000');
  });
});

describe('paying', () => {
  it('cash: empty means exact; more than the total gives change; less is short', () => {
    expect(paymentPreview({ method: 'CASH', tendered: '', reference: '' }, 4050n, 'IQD')).toEqual({ amountMinor: 4050n, changeMinor: 0n, ok: true });
    expect(paymentPreview({ method: 'CASH', tendered: '5,000', reference: '' }, 4050n, 'IQD')).toEqual({ amountMinor: 5000n, changeMinor: 950n, ok: true });
    expect(paymentPreview({ method: 'CASH', tendered: '4000', reference: '' }, 4050n, 'IQD').ok).toBe(false);
    expect(paymentPreview({ method: 'CASH', tendered: 'x', reference: '' }, 4050n, 'IQD').amountMinor).toBeNull();
  });

  it('card and transfer must be exactly the total', () => {
    expect(paymentPreview({ method: 'CARD_MANUAL', tendered: '', reference: '' }, 4050n, 'IQD').ok).toBe(true);
    expect(paymentPreview({ method: 'TRANSFER_MANUAL', tendered: '5000', reference: '' }, 4050n, 'IQD').ok).toBe(false);
  });

  it('offers round cash amounts above the total, at most four, smallest first', () => {
    expect(cashShortcuts(4050n, 'IQD')).toEqual([5000n, 10_000n, 25_000n, 50_000n]);
    expect(cashShortcuts(0n, 'IQD')).toEqual([]);
    expect(cashShortcuts(1250n, 'USD')).toEqual([1500n, 2000n, 5000n, 10_000n]);
  });
});

describe('the request', () => {
  it('sends money as text and a percent as a number, with the one reason on every discount', () => {
    let cart = withLines({ type: 'add', item: item(), unitId: 'box' });
    const key = cart.lines[0]!.key;
    cart = cartReducer(cart, { type: 'qty', key, qty: 2 });
    cart = cartReducer(cart, { type: 'discount', key, discount: { kind: 'amount', value: '500' } });
    cart = cartReducer(cart, { type: 'invoiceDiscount', discount: { kind: 'percent', value: '2.5' } });
    cart = cartReducer(cart, { type: 'discountReason', reason: ' regular customer ' });
    expect(buildCartRequest(cart, 'IQD', 'sale-key-1')).toEqual({
      clientKey: 'sale-key-1',
      currency: 'IQD',
      lines: [{ productId: 'p1', unitId: 'box', qty: 2, discount: { kind: 'amount', value: '500', reason: 'regular customer' } }],
      invoiceDiscount: { kind: 'percent', value: 2.5, reason: 'regular customer' },
    });
  });

  it('converts a USD amount discount to minor units and leaves a zero or empty discount out', () => {
    let cart = withLines({ type: 'add', item: item() });
    const key = cart.lines[0]!.key;
    cart = cartReducer(cart, { type: 'discount', key, discount: { kind: 'amount', value: '1.5' } });
    expect(buildCartRequest(cart, 'USD', 'k-12345678')!.lines[0]!.discount).toEqual({ kind: 'amount', value: '150' });
    cart = cartReducer(cart, { type: 'discount', key, discount: { kind: 'percent', value: '0' } });
    expect(buildCartRequest(cart, 'USD', 'k-12345678')!.lines[0]).not.toHaveProperty('discount');
  });

  it('sends a chosen batch with its reason, and returns null when a discount cannot be read', () => {
    let cart = withLines({ type: 'add', item: item() });
    const key = cart.lines[0]!.key;
    cart = cartReducer(cart, { type: 'batch', key, batchId: 'b1', lot: 'L1', reason: ' older stock first ' });
    expect(buildCartRequest(cart, 'IQD', 'k-12345678')!.lines[0]).toMatchObject({ batchId: 'b1', batchReason: 'older stock first' });
    cart = cartReducer(cart, { type: 'discount', key, discount: { kind: 'percent', value: 'bad' } });
    expect(buildCartRequest(cart, 'IQD', 'k-12345678')).toBeNull();
  });

  it('makes a fresh long key each time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newClientKey('sale')));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key.length).toBeGreaterThanOrEqual(8);
  });
});

describe('keys', () => {
  const press = (key: string, extra: Record<string, boolean> = {}) => ({ key, ...extra });

  it('F2 searches, F4 pays, F8 holds, Escape clears', () => {
    expect(shortcutOf(press('F2'), false)).toBe('search');
    expect(shortcutOf(press('F4'), false)).toBe('pay');
    expect(shortcutOf(press('F8'), true)).toBe('hold');
    expect(shortcutOf(press('Escape'), true)).toBe('escape');
  });

  it('Enter adds the top result only in the search box, and not with Shift', () => {
    expect(shortcutOf(press('Enter'), true)).toBe('addTop');
    expect(shortcutOf(press('Enter'), false)).toBeNull();
    expect(shortcutOf(press('Enter', { shiftKey: true }), true)).toBeNull();
  });

  it('leaves browser shortcuts and held keys alone', () => {
    expect(shortcutOf(press('F2', { ctrlKey: true }), false)).toBeNull();
    expect(shortcutOf(press('F4', { altKey: true }), false)).toBeNull();
    expect(shortcutOf(press('F8', { repeat: true }), false)).toBeNull();
    expect(shortcutOf(press('a'), true)).toBeNull();
  });
});

describe('the draft on the device', () => {
  const cart = () => {
    let c = withLines({ type: 'add', item: item() });
    c = cartReducer(c, { type: 'discount', key: c.lines[0]!.key, discount: { kind: 'percent', value: '5' } });
    return cartReducer(c, { type: 'qty', key: c.lines[0]!.key, qty: 4 });
  };

  it('round-trips a cart', () => {
    const c = cart();
    expect(parseDraft(serializeDraft('IQD', c))).toEqual({ v: 2, currency: 'IQD', cart: c, fromHoldId: null, attempt: null });
  });

  it('is scoped to the pharmacy, branch and person', () => {
    expect(draftKey('r1', 'b1', 'u1', 'IQD')).not.toBe(draftKey('r1', 'b2', 'u1', 'IQD'));
    expect(draftKey('r1', 'b1', 'u1', 'IQD')).not.toBe(draftKey('r1', 'b1', 'u2', 'IQD'));
    // A shift in another currency never reads, overwrites or removes this draft.
    expect(draftKey('r1', 'b1', 'u1', 'IQD')).not.toBe(draftKey('r1', 'b1', 'u1', 'USD'));
  });

  it('never throws on garbage and drops anything that is not a cart', () => {
    for (const bad of [null, '', 'not json', '{}', '[]', '{"v":2}', '{"v":1,"currency":"EUR","cart":{}}']) expect(parseDraft(bad)).toBeNull();
    const c = JSON.parse(serializeDraft('IQD', cart()));
    c.cart.lines[0].qty = 0;
    expect(parseDraft(JSON.stringify(c))).toBeNull();
    const d = JSON.parse(serializeDraft('IQD', cart()));
    d.cart.lines[0].units[0].priceMinor = '12.5';
    expect(parseDraft(JSON.stringify(d))).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, currency: 'IQD', cart: { ...emptyCart() } }))).toBeNull();
  });
});

describe('a held cart coming back', () => {
  it('rebuilds lines from the hold with fresh product data, keeping quantity, discounts and batch', () => {
    const lookup = new Map([['p1', item()]]);
    const { cart, blockedNames } = cartFromResume(
      {
        currency: 'IQD',
        invoiceDiscount: { kind: 'percent', value: 3, reason: 'loyal' },
        lines: [
          { productId: 'p1', unitId: 'box', qty: 2, tradeName: 'Panadol', discount: { kind: 'amount', value: '500' }, batchId: 'b1', batchReason: 'older first' },
          { productId: 'gone', unitId: 'x', qty: 1, tradeName: 'Old product' },
        ],
      },
      lookup,
    );
    // The line whose product is gone is KEPT and marked, never dropped.
    expect(blockedNames).toEqual(['Old product']);
    expect(cart.lines).toHaveLength(2);
    expect(cart.lines[1]).toMatchObject({ productId: 'gone', unitId: 'x', qty: 1, name: 'Old product', blocked: 'GONE' });
    expect(cart.lines[0]).toMatchObject({ unitId: 'box', qty: 2, discount: { kind: 'amount', value: '500' }, batchId: 'b1', batchLot: 'L1', batchReason: 'older first' });
    expect(cart.invoiceDiscount).toEqual({ kind: 'percent', value: '3' });
    expect(cart.discountReason).toBe('loyal');
  });

  it('keeps two equal lines apart when one has a discount, and sums two plain equal ones', () => {
    const lookup = new Map([['p1', item()]]);
    const two = cartFromResume(
      { currency: 'IQD', lines: [{ productId: 'p1', unitId: 'tab', qty: 2 }, { productId: 'p1', unitId: 'tab', qty: 3 }] },
      lookup,
    );
    expect(two.cart.lines.map((l) => l.qty)).toEqual([5]);
    const apart = cartFromResume(
      { currency: 'IQD', lines: [{ productId: 'p1', unitId: 'tab', qty: 2, discount: { kind: 'percent', value: 5 } }, { productId: 'p1', unitId: 'tab', qty: 3 }] },
      lookup,
    );
    expect(apart.cart.lines.map((l) => [l.qty, l.discount?.value ?? null])).toEqual([
      [2, '5'],
      [3, null],
    ]);
  });
});

// Task 8b: fixes from the review of the sale screen --------------------------------------------------------------------------

describe('money text: commas and Arabic separators', () => {
  it('a comma is a thousands separator only before groups of exactly three digits', () => {
    expect(parseMoney('1,250', 'IQD')).toBe(1250n);
    expect(parseMoney('1,234,567', 'IQD')).toBe(1_234_567n);
    expect(parseMoney('1,250', 'USD')).toBe(125_000n);
    expect(parseMoney('1,250.5', 'USD')).toBe(125_050n);
    expect(parseMoney('12,345', 'USD')).toBe(1_234_500n);
  });

  it('regression: "12,5" for USD is 12.50, never 125.00; "1,25" is 1.25; "12,50" is 12.50', () => {
    expect(parseMoney('12,5', 'USD')).toBe(1250n);
    expect(parseMoney('1,25', 'USD')).toBe(125n);
    expect(parseMoney('12,50', 'USD')).toBe(1250n);
    expect(parseMoney('0,5', 'USD')).toBe(50n);
  });

  it('a decimal comma is refused for IQD (no decimals) and when it has too many decimals or the commas are mixed up', () => {
    expect(parseMoney('12,5', 'IQD')).toBeNull();
    expect(parseMoney('12,50', 'IQD')).toBeNull();
    expect(parseMoney('1,2345', 'USD')).toBeNull();
    expect(parseMoney('1,234,5', 'USD')).toBeNull();
    expect(parseMoney('12,', 'USD')).toBeNull();
    expect(parseMoney(',5', 'USD')).toBeNull();
    expect(parseMoney('1,2,3', 'IQD')).toBeNull();
  });

  it('reads the Arabic decimal separator (U+066B), thousands separator (U+066C) and comma (U+060C) the same way', () => {
    expect(parseMoney('١٢٫٥', 'USD')).toBe(1250n);
    expect(parseMoney('١٢،٥', 'USD')).toBe(1250n);
    expect(parseMoney('١٬٢٥٠', 'IQD')).toBe(1250n);
    expect(parseMoney('١٬٢٥٠٫٥', 'USD')).toBe(125_050n);
    expect(parseMoney('١،٢٥٠', 'IQD')).toBe(1250n);
    expect(parseMoney('١٢،٥', 'IQD')).toBeNull();
  });

  it('percents use the same reading: "2,5" is 2.5 %, "1,000" is above 100 and refused, Arabic separators work', () => {
    expect(parsePercent('2,5')).toBe(250);
    expect(parsePercent('1,000')).toBeNull();
    expect(parsePercent('٢٫٥')).toBe(250);
    expect(parsePercent('٢،٥')).toBe(250);
    expect(parsePercent('2,5,1')).toBeNull();
  });

  it('a typed quantity takes Arabic digits and is null when empty or zero', () => {
    expect(parseQtyText('12')).toBe(12);
    expect(parseQtyText('١٢')).toBe(12);
    expect(parseQtyText('۳')).toBe(3);
    expect(parseQtyText('')).toBeNull();
    expect(parseQtyText('0')).toBeNull();
    expect(parseQtyText('abc')).toBeNull();
    expect(parseQtyText('99999999999')).toBe(1_000_000);
  });
});

describe('scans', () => {
  const hit = (over: Partial<ScanItem> = {}): ScanItem => ({ ...item(), matchedOn: 'barcode', notSellable: false, noPrice: false, ...over });

  it('one sellable barcode match is added; none is unknown; several are a pick; one that cannot be sold is reported, not added', () => {
    expect(scanOutcome('123', [hit()])).toMatchObject({ kind: 'add' });
    expect(scanOutcome('123', [])).toEqual({ kind: 'unknown', code: '123' });
    expect(scanOutcome('123', [hit({ matchedOn: 'tradeName' })])).toEqual({ kind: 'unknown', code: '123' });
    expect(scanOutcome('123', [hit(), hit({ productId: 'p2' })])).toMatchObject({ kind: 'pick', code: '123' });
    expect(scanOutcome('123', [hit({ sellableQty: 0 })])).toMatchObject({ kind: 'blocked' });
    expect(scanOutcome('123', [hit({ noPrice: true })])).toMatchObject({ kind: 'blocked' });
    expect(scanOutcome('123', [hit({ notSellable: true })])).toMatchObject({ kind: 'blocked' });
  });

  it('two scans that arrive before the first lookup returns are both handled, in order (none shared, none dropped)', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const release: Record<string, () => void> = {};
    const queue = createScanQueue(async (code) => {
      started.push(code);
      await new Promise<void>((resolve) => {
        release[code] = resolve;
      });
      finished.push(code);
    });
    queue.push('111');
    queue.push('222');
    queue.push('333');
    await Promise.resolve();
    // Only the first lookup runs; the others wait for their turn instead of replacing it.
    expect(started).toEqual(['111']);
    expect(queue.pending()).toBe(3);
    release['111']!();
    await vi.waitFor(() => expect(started).toEqual(['111', '222']));
    release['222']!();
    await vi.waitFor(() => expect(started).toEqual(['111', '222', '333']));
    release['333']!();
    await queue.whenIdle();
    expect(finished).toEqual(['111', '222', '333']);
    expect(queue.pending()).toBe(0);
  });

  it('a lookup that throws does not stop the scans behind it, and the queue can be used again', async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code) => {
      seen.push(code);
      if (code === 'bad') throw new Error('boom');
    });
    queue.push('bad');
    queue.push('good');
    await queue.whenIdle();
    expect(seen).toEqual(['bad', 'good']);
    queue.push('later');
    await queue.whenIdle();
    expect(seen).toEqual(['bad', 'good', 'later']);
  });

  it('every scan result lands in the cart: two scans of different products add two lines, a repeat raises the quantity', () => {
    const results = [scanOutcome('1', [hit()]), scanOutcome('2', [hit({ productId: 'p2', tradeName: 'Brufen' })]), scanOutcome('1', [hit()])];
    const cart = results.reduce((c, r) => (r.kind === 'add' ? cartReducer(c, { type: 'add', item: r.item }) : c), emptyCart());
    expect(cart.lines.map((l) => [l.productId, l.qty])).toEqual([
      ['p1', 2],
      ['p2', 1],
    ]);
  });
});

describe('attempts and keys', () => {
  const pay: PayDraft = { method: 'CASH', tendered: '', reference: '' };
  let n = 0;
  const make = (prefix: string) => `${prefix}-key-${(n += 1)}`;
  const cartOf = (qty = 1) => cartReducer(withLines({ type: 'add', item: item() }), { type: 'qty', key: 'l1', qty });
  const sigOf = (c: CartState, amount = 1500n, draft = pay, from: string | null = null) => saleSignature(c, 'IQD', draft, amount, from)!;

  it('a retry of the same sale reuses both keys; a changed cart, payment or hold gets new ones', () => {
    const a = saleAttemptFor(null, sigOf(cartOf()), pay, 1500n, null, make);
    const again = saleAttemptFor(a, sigOf(cartOf()), pay, 1500n, null, make);
    expect(again).toBe(a);
    expect(again.key).toBe(a.key);
    expect(again.paymentKey).toBe(a.paymentKey);
    for (const changed of [sigOf(cartOf(2)), sigOf(cartOf(), 2000n), sigOf(cartOf(), 1500n, { ...pay, method: 'CARD_MANUAL' }), sigOf(cartOf(), 1500n, pay, 'hold-1'), sigOf(cartOf(), 1500n, { ...pay, reference: 'slip 7' })]) {
      const next = saleAttemptFor(a, changed, pay, 1500n, null, make);
      expect(next.key).not.toBe(a.key);
      expect(next.paymentKey).not.toBe(a.paymentKey);
    }
  });

  it('a double click (the same request twice before the first answer) sends one pair of keys', () => {
    const sig = sigOf(cartOf());
    const first = saleAttemptFor(null, sig, pay, 1500n, null, make);
    const second = saleAttemptFor(first, sig, pay, 1500n, null, make);
    expect([second.key, second.paymentKey]).toEqual([first.key, first.paymentKey]);
  });

  it('after a success or a definite refusal the caller drops the attempt, so the next try (e.g. after PAYMENT_SHORT) is a new request with new keys', () => {
    const sig = sigOf(cartOf());
    const first = saleAttemptFor(null, sig, pay, 1500n, null, make);
    const afterRefusal = saleAttemptFor(null, sig, pay, 1500n, null, make);
    expect(afterRefusal.key).not.toBe(first.key);
  });

  it('a signature does not depend on prices or on the key, only on what is sold, how it is paid and which hold it completes', () => {
    const c = cartOf();
    const repriced = refreshCart(c, new Map([['p1', item({ units: [{ id: 'box', label: 'box', baseQty: 24, priceMinor: '9999' }, { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '2000' }] })]]));
    expect(sigOf(repriced)).toBe(sigOf(c));
    expect(saleSignature(withLines({ type: 'add', item: item() }, { type: 'discount', key: 'l1', discount: { kind: 'percent', value: 'x' } }), 'IQD', pay, 1500n, null)).toBeNull();
  });

  it('a hold request has its own signature; it changes with the cart', () => {
    expect(holdSignature(cartOf(), 'IQD')).toBe(holdSignature(cartOf(), 'IQD'));
    expect(holdSignature(cartOf(), 'IQD')).not.toBe(holdSignature(cartOf(2), 'IQD'));
  });

  it('keyFor is the same idea for any single-key request (shift open, reprint, hold)', () => {
    const first = keyFor(null, 'IQD:0', 'shift', make);
    expect(keyFor(first, 'IQD:0', 'shift', make)).toBe(first);
    expect(keyFor(first, 'USD:0', 'shift', make).key).not.toBe(first.key);
    expect(keyFor(first, 'IQD:5000', 'shift', make).key).not.toBe(first.key);
  });

  it('only a dropped connection or an unexpected server error leaves the outcome unknown; any refusal is definite', () => {
    expect(outcomeUnknown({ message: NETWORK_FAILURE })).toBe(true);
    expect(outcomeUnknown({ message: UNEXPECTED_MESSAGE })).toBe(true);
    expect(outcomeUnknown({ message: 'The payments do not cover the total' })).toBe(false);
    expect(TOTAL_MOVED_CODES).toContain('PAYMENT_SHORT');
  });

  it('the attempt travels with the draft: a reload restores the same keys and the payment as typed', () => {
    const c = cartOf(3);
    const attempt = saleAttemptFor(null, sigOf(c, 4500n, pay, 'hold-9'), pay, 4500n, 'hold-9', make);
    const back = parseDraft(serializeDraft('IQD', c, attempt, 'hold-9'));
    expect(back?.attempt).toEqual(attempt);
    expect(back?.fromHoldId).toBe('hold-9');
    // The same cart and payment after the reload make the same signature, so the same keys are sent.
    expect(saleAttemptFor(back!.attempt, sigOf(back!.cart, 4500n, pay, back!.fromHoldId), pay, 4500n, back!.fromHoldId, make)).toBe(back!.attempt);
  });

  it('a damaged attempt is dropped but the cart is kept', () => {
    const c = cartOf();
    const attempt = saleAttemptFor(null, sigOf(c), pay, 1500n, null, make);
    const raw = JSON.parse(serializeDraft('IQD', c, attempt));
    raw.attempt.paymentKey = 'x';
    const back = parseDraft(JSON.stringify(raw));
    expect(back?.attempt).toBeNull();
    expect(back?.cart.lines).toHaveLength(1);
  });
});

describe('keys: IME and handled keys', () => {
  it('ignores a key while an input method is composing, and keyCode 229', () => {
    expect(shortcutOf({ key: 'Enter', isComposing: true }, true)).toBeNull();
    expect(shortcutOf({ key: 'Enter', keyCode: 229 }, true)).toBeNull();
    expect(shortcutOf({ key: 'F4', isComposing: true }, false)).toBeNull();
    expect(shortcutOf({ key: 'Enter', keyCode: 13 }, true)).toBe('addTop');
  });

  it('ignores a key that was already handled (a scanner’s closing Enter inside the search box)', () => {
    expect(shortcutOf({ key: 'Enter', defaultPrevented: true }, true)).toBeNull();
    expect(shortcutOf({ key: 'F4', defaultPrevented: true }, false)).toBeNull();
    expect(shortcutOf({ key: 'Enter', defaultPrevented: false }, true)).toBe('addTop');
  });
});

describe('a held cart that cannot be rebuilt in full', () => {
  const held = (lines: Record<string, unknown>[]) => ({ currency: 'IQD' as const, lines });

  it('keeps a line whose product is gone, marked GONE, with its quantity, held unit and name; it never turns into another product or unit', () => {
    const { cart, blockedNames } = cartFromResume(held([{ productId: 'p1', unitId: 'box', qty: 2, tradeName: 'Panadol' }, { productId: 'p9', unitId: 'u9', qty: 4, tradeName: 'Old' }]), new Map([['p1', item()]]));
    expect(cart.lines).toHaveLength(2);
    expect(blockedNames).toEqual(['Old']);
    expect(cart.lines[0]).toMatchObject({ productId: 'p1', unitId: 'box', qty: 2, blocked: null });
    expect(cart.lines[1]).toMatchObject({ productId: 'p9', unitId: 'u9', qty: 4, name: 'Old', blocked: 'GONE' });
    expect(blockedLines(cart).map((l) => l.productId)).toEqual(['p9']);
  });

  it('keeps the held unit when the product does not sell it any more (UNIT), next to the units sold now, with no price for it', () => {
    const { cart } = cartFromResume(held([{ productId: 'p1', unitId: 'strip', qty: 1, tradeName: 'Panadol' }]), new Map([['p1', item()]]));
    const line = cart.lines[0]!;
    expect(line).toMatchObject({ unitId: 'strip', blocked: 'UNIT' });
    expect(line.units.map((u) => u.id)).toEqual(['strip', 'box', 'tab']);
    expect(unitOf(line).priceMinor).toBeNull();
  });

  it('marks NO_PRICE when the held unit has no open price now, and RESTRICTED for a controlled product', () => {
    const noPrice = item({ units: [{ id: 'box', label: 'box', baseQty: 24, priceMinor: null }, { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '1500' }] });
    expect(cartFromResume(held([{ productId: 'p1', unitId: 'box', qty: 1, tradeName: 'P' }]), new Map([['p1', noPrice]])).cart.lines[0]).toMatchObject({ unitId: 'box', blocked: 'NO_PRICE' });
    expect(cartFromResume(held([{ productId: 'p1', unitId: 'box', qty: 1, tradeName: 'P' }]), new Map([['p1', { ...item(), notSellable: true }]])).cart.lines[0]).toMatchObject({ blocked: 'RESTRICTED' });
  });

  it('a blocked line is never merged into, and its stock does not count toward the over-stock warning', () => {
    const { cart } = cartFromResume(held([{ productId: 'p1', unitId: 'strip', qty: 500, tradeName: 'P' }]), new Map([['p1', item()]]));
    const next = cartReducer(cart, { type: 'add', item: item(), unitId: 'tab' });
    expect(next.lines).toHaveLength(2);
    expect(overSellable(cart).size).toBe(0);
  });

  it('only the cashier clears a mark: removing the line, or choosing a unit that has a price; a gone or controlled product is never cleared by a unit', () => {
    const { cart } = cartFromResume(held([{ productId: 'p1', unitId: 'strip', qty: 1, tradeName: 'P' }, { productId: 'p9', unitId: 'u', qty: 1, tradeName: 'Old' }]), new Map([['p1', item()]]));
    expect(refreshCart(cart, new Map([['p1', item()]])).lines.map((l) => l.blocked)).toEqual(['UNIT', 'GONE']);
    const chosen = cartReducer(cart, { type: 'unit', key: cart.lines[0]!.key, unitId: 'tab' });
    expect(chosen.lines[0]).toMatchObject({ unitId: 'tab', blocked: null });
    const removed = cartReducer(chosen, { type: 'remove', key: cart.lines[1]!.key });
    expect(blockedLines(removed)).toHaveLength(0);
    const same = cartReducer(cart, { type: 'unit', key: cart.lines[1]!.key, unitId: 'u' });
    expect(same.lines[1]!.blocked).toBe('GONE');
  });

  it('survives the draft round trip with its marks', () => {
    const { cart } = cartFromResume(held([{ productId: 'p9', unitId: 'u9', qty: 4, tradeName: 'Old' }]), new Map());
    expect(parseDraft(serializeDraft('IQD', cart))?.cart.lines[0]).toMatchObject({ blocked: 'GONE', unitId: 'u9', qty: 4 });
  });
});

describe('refreshing the cart after a refused payment', () => {
  it('takes the current prices, units and stock of the cart’s products by id and keeps unit, quantity and discount', () => {
    let cart = withLines({ type: 'add', item: item() }, { type: 'qty', key: 'l1', qty: 3 }, { type: 'discount', key: 'l1', discount: { kind: 'percent', value: '10' } });
    expect(estimateCart(cart, 'IQD', 0).totalMinor).toBe(4050n);
    cart = refreshCart(cart, new Map([['p1', item({ sellableQty: 7, units: [{ id: 'box', label: 'box', baseQty: 24, priceMinor: '3200' }, { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: '1600' }] })]]));
    expect(cart.lines[0]).toMatchObject({ unitId: 'tab', qty: 3, sellableQty: 7, discount: { kind: 'percent', value: '10' }, blocked: null });
    expect(estimateCart(cart, 'IQD', 0).totalMinor).toBe(4320n);
  });

  it('marks a line GONE when its product is missing from the answer, and NO_PRICE when its unit lost the price, instead of dropping it', () => {
    const cart = withLines({ type: 'add', item: item() }, { type: 'add', item: item({ productId: 'p2', tradeName: 'Brufen' }) });
    const next = refreshCart(cart, new Map([['p1', item({ units: [{ id: 'box', label: 'box', baseQty: 24, priceMinor: '3000' }, { id: 'tab', label: 'tablet', baseQty: 1, priceMinor: null }] })]]));
    expect(next.lines.map((l) => [l.productId, l.blocked])).toEqual([
      ['p1', 'NO_PRICE'],
      ['p2', 'GONE'],
    ]);
  });
});

describe('openedShiftOrClosed (the answer to an open request)', () => {
  const base = { id: 's1', currency: 'IQD' as const, openingFloatMinor: '700', openedAt: '2026-10-28T08:00:00.000Z' };
  it('an OPEN shift is handed on', () => {
    expect(openedShiftOrClosed({ ...base, status: 'OPEN' })).toEqual({ kind: 'open' });
  });
  it('a replay that finds the shift CLOSED is not an open shift: the person opens a new one with a new key', () => {
    expect(openedShiftOrClosed({ ...base, status: 'CLOSED' })).toEqual({ kind: 'closed' });
  });
});
