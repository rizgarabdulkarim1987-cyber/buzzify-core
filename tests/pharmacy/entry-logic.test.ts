import { describe, expect, it } from 'vitest';
import { emptyEntryForm, entryRequest, formatExpiryInput, parseExpiry, requiredMissing, type EntryForm } from '@/app/pharmacy/_ui/entry/entry-logic';
import { entryLineInput } from '@/server/pharmacy/fast-entry';

/** Fast product entry (Task 13): the pure rules of the entry form. The clock is passed in, never read. */

const NOV_2026 = new Date('2026-11-06T10:00:00.000Z');

const form = (over: Partial<EntryForm> = {}): EntryForm => ({ ...emptyEntryForm(), ...over });

describe('parseExpiry', () => {
  it('reads four digits or MM/YY as the month and the year 20YY', () => {
    expect(parseExpiry('0828', NOV_2026)).toEqual({ ok: true, month: 8, year: 2028 });
    expect(parseExpiry('08/28', NOV_2026)).toEqual({ ok: true, month: 8, year: 2028 });
    expect(parseExpiry(' 12/30 ', NOV_2026)).toEqual({ ok: true, month: 12, year: 2030 });
  });

  it('reads Arabic-Indic digits like Latin ones', () => {
    expect(parseExpiry('٠٨/٢٨', NOV_2026)).toEqual({ ok: true, month: 8, year: 2028 });
  });

  it('accepts the current month (the goods are good to its last day)', () => {
    expect(parseExpiry('11/26', NOV_2026)).toEqual({ ok: true, month: 11, year: 2026 });
    expect(parseExpiry('1126', new Date('2026-11-30T23:59:59.000Z'))).toEqual({ ok: true, month: 11, year: 2026 });
  });

  it('refuses a past month, an impossible month and anything malformed', () => {
    expect(parseExpiry('01/20', NOV_2026)).toEqual({ ok: false });
    expect(parseExpiry('10/26', NOV_2026)).toEqual({ ok: false });
    expect(parseExpiry('13/28', NOV_2026)).toEqual({ ok: false });
    expect(parseExpiry('00/28', NOV_2026)).toEqual({ ok: false });
    for (const bad of ['', '8/28', '082', '08/2028', 'ab/cd', '08-28', '08/28/1']) expect(parseExpiry(bad, NOV_2026), bad).toEqual({ ok: false });
  });
});

describe('formatExpiryInput', () => {
  it('keeps digits only and puts a slash after the month', () => {
    expect(formatExpiryInput('0828')).toBe('08/28');
    expect(formatExpiryInput('08')).toBe('08');
    expect(formatExpiryInput('082')).toBe('08/2');
    expect(formatExpiryInput('08/28')).toBe('08/28');
    expect(formatExpiryInput('0a8-2x8')).toBe('08/28');
    expect(formatExpiryInput('082899')).toBe('08/28');
    expect(formatExpiryInput('٠٨٢٨')).toBe('08/28');
    expect(formatExpiryInput('')).toBe('');
  });
});

describe('requiredMissing', () => {
  it('asks a new product for name, selling price, quantity and expiry, in that order', () => {
    expect(requiredMissing(form(), false)).toBe('name');
    expect(requiredMissing(form({ name: 'Augmentin' }), false)).toBe('sellPrice');
    expect(requiredMissing(form({ name: 'Augmentin', sellPrice: '6000' }), false)).toBe('qty');
    expect(requiredMissing(form({ name: 'Augmentin', sellPrice: '6000', qty: '3' }), false)).toBe('expiry');
    expect(requiredMissing(form({ name: 'Augmentin', sellPrice: '6000', qty: '3', expiry: '08/28' }), false)).toBeNull();
  });

  it('treats blanks as missing', () => {
    expect(requiredMissing(form({ name: '   ', sellPrice: '6000', qty: '3', expiry: '08/28' }), false)).toBe('name');
  });

  it('does not ask a new product for the purchase price (optional there)', () => {
    expect(requiredMissing(form({ name: 'A', sellPrice: '1', qty: '1', expiry: '08/28', purchasePrice: '' }), false)).toBeNull();
  });

  it('skips the selling price when it is read-only (no price.change)', () => {
    expect(requiredMissing(form({ name: 'A', qty: '1', expiry: '08/28', sellPriceLocked: true }), false)).toBeNull();
  });

  it('asks a known product for quantity, expiry, purchase price and (when editable) selling price, never the name', () => {
    expect(requiredMissing(form(), true)).toBe('qty');
    expect(requiredMissing(form({ qty: '2' }), true)).toBe('expiry');
    expect(requiredMissing(form({ qty: '2', expiry: '08/28' }), true)).toBe('purchasePrice');
    // The prototype's required() keeps the selling price for a known product: a product with no price yet must get one.
    expect(requiredMissing(form({ qty: '2', expiry: '08/28', purchasePrice: '3.10' }), true)).toBe('sellPrice');
    expect(requiredMissing(form({ qty: '2', expiry: '08/28', purchasePrice: '3.10', sellPrice: '20000' }), true)).toBeNull();
    expect(requiredMissing(form({ qty: '2', expiry: '08/28', purchasePrice: '3.10', sellPriceLocked: true }), true)).toBeNull();
  });
});

describe('entryRequest', () => {
  const known = { kind: 'known' as const, productId: 'prod-1' };
  const fresh = { kind: 'new' as const, barcode: '1234500099' };

  it('builds the request of a known product the server schema accepts', () => {
    const built = entryRequest(form({ qty: '2', expiry: '0828', purchasePrice: '3.10', sellPrice: '20,000', lot: ' l-9 ', supplierId: 'sup-1' }), known, 'entry-key-0001', NOV_2026);
    expect(built).toEqual({
      ok: true,
      request: {
        requestKey: 'entry-key-0001',
        product: { kind: 'known', productId: 'prod-1' },
        qty: 2,
        expiry: { month: 8, year: 2028 },
        purchasePrice: '3.10',
        purchaseCurrency: 'USD',
        sellPrice: '20,000',
        lot: 'l-9',
        supplierId: 'sup-1',
      },
    });
    if (built.ok) expect(entryLineInput.safeParse(built.request).success).toBe(true);
  });

  it('builds a new product with its optional fields, and leaves out what was not entered', () => {
    const built = entryRequest(
      form({ name: ' Augmentin 1g ', sellPrice: '6000', qty: '3', expiry: '08/28', stripsPerPacket: '2', tabletsPerStrip: '7', needsRx: true, activeIngredient: 'amoxicillin', lowStock: '4' }),
      fresh,
      'entry-key-0002',
      NOV_2026,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.product).toEqual({
      kind: 'new',
      tradeName: 'Augmentin 1g',
      barcode: '1234500099',
      activeIngredient: 'amoxicillin',
      rxLevel: 'RX',
      stripsPerPacket: 2,
      tabletsPerStrip: 7,
      lowStockPackets: 4,
    });
    expect(built.request.purchasePrice).toBeNull();
    expect(built.request.supplierId).toBeNull();
    expect(entryLineInput.safeParse(built.request).success).toBe(true);
  });

  it('sends no selling price when the field is read-only', () => {
    const built = entryRequest(form({ qty: '1', expiry: '08/28', purchasePrice: '1', sellPrice: '9999', sellPriceLocked: true }), known, 'entry-key-0003', NOV_2026);
    expect(built.ok && built.request.sellPrice).toBeNull();
  });

  it('names the first missing field, then a bad expiry, then a bad quantity', () => {
    expect(entryRequest(form({ qty: '1' }), known, 'entry-key-0004', NOV_2026)).toEqual({ ok: false, field: 'expiry', problem: 'missing' });
    expect(entryRequest(form({ qty: '1', expiry: '01/20', purchasePrice: '1', sellPrice: '1' }), known, 'entry-key-0004', NOV_2026)).toEqual({ ok: false, field: 'expiry', problem: 'expiry' });
    expect(entryRequest(form({ qty: '0', expiry: '08/28', purchasePrice: '1', sellPrice: '1' }), known, 'entry-key-0004', NOV_2026)).toEqual({ ok: false, field: 'qty', problem: 'qty' });
    expect(entryRequest(form({ qty: '1.5', expiry: '08/28', purchasePrice: '1', sellPrice: '1' }), known, 'entry-key-0004', NOV_2026)).toEqual({ ok: false, field: 'qty', problem: 'qty' });
    expect(entryRequest(form({ name: 'A', sellPrice: '1', qty: '1', expiry: '08/28', tabletsPerStrip: 'x' }), fresh, 'entry-key-0004', NOV_2026)).toEqual({ ok: false, field: 'tabletsPerStrip', problem: 'number' });
  });
});
