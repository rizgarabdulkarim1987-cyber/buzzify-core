import { describe, expect, it } from 'vitest';
import {
  buildCartRequest,
  cartFromResume,
  cartReducer,
  cashShortcuts,
  draftKey,
  emptyCart,
  estimateCart,
  formatMinor,
  newClientKey,
  overSellable,
  parseDraft,
  parseMoney,
  parsePercent,
  paymentPreview,
  serializeDraft,
  shortcutOf,
  type AddableItem,
  type CartState,
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
    let cart = withLines({ type: 'add', item: item() });
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
    expect(parseDraft(serializeDraft('IQD', c))).toEqual({ v: 1, currency: 'IQD', cart: c });
  });

  it('is scoped to the pharmacy, branch and person', () => {
    expect(draftKey('r1', 'b1', 'u1')).not.toBe(draftKey('r1', 'b2', 'u1'));
    expect(draftKey('r1', 'b1', 'u1')).not.toBe(draftKey('r1', 'b1', 'u2'));
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
    const { cart, missing } = cartFromResume(
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
    expect(missing).toEqual(['Old product']);
    expect(cart.lines).toHaveLength(1);
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
