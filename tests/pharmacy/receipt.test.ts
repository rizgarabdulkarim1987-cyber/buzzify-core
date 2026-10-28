import { describe, expect, it } from 'vitest';
import {
  buildReceipt,
  DEFAULT_TIME_ZONE,
  escapeHtml,
  formatLocalDateTime,
  formatMinor,
  isValidTimeZone,
  renderReceiptHtml,
  renderReceiptText,
  type ReceiptOptions,
  type StoredDocument,
  type StoredSale,
} from '@/server/domain/pharmacy/receipt';

/**
 * The receipt builder and renderers are pure (no database): the same stored rows always give the same model, HTML and
 * text. Golden files pin the 58 and 80 mm layouts in English and Arabic; the figures below are worked by hand.
 */

const AT = new Date('2026-10-28T14:03:09.000Z');
const SHOP = { name: 'Al Noor Pharmacy', address: 'Karrada, Baghdad', phone: '+964 770 000 0000', footer: 'Keep out of reach of children' };

// 2 x Panadol 500 mg tablet at 250 = 500 gross, line discount 50 -> 450
// 1 x Amoxil 250 mg strip (Rx) at 2,000 = 2,000, invoice share 100 -> 1,900
// subtotal 2,500, discount 150, total before rounding 2,350, rounded to 2,350 (step 250 is exact)
const sale: StoredSale = {
  number: '20261028-000123',
  currency: 'IQD',
  at: AT,
  subtotalMinor: 2500n,
  discountMinor: 150n,
  roundingMinor: 0n,
  totalMinor: 2350n,
  paidMinor: 3000n,
  changeMinor: 650n,
  cashierName: 'Sara',
  lines: [
    { lineNo: 1, name: 'Panadol', strength: '500 mg', qty: 2, unitLabel: 'tablet', unitPriceMinor: 250n, discountMinor: 50n, totalMinor: 450n, rxLevel: 'OTC' },
    { lineNo: 2, name: 'Amoxil', strength: '250 mg', qty: 1, unitLabel: 'strip', unitPriceMinor: 2000n, discountMinor: 100n, totalMinor: 1900n, rxLevel: 'RX' },
  ],
  payments: [{ method: 'CASH', amountMinor: 3000n }],
};
const doc: StoredDocument = { kind: 'sale', sale };
const opts = (over: Partial<ReceiptOptions> = {}): ReceiptOptions => ({ width: '80', locale: 'en', copy: false, shop: SHOP, ...over });

describe('formatMinor', () => {
  it('prints IQD without decimals and USD with two, Latin digits, grouped', () => {
    expect(formatMinor(0n, 'IQD')).toBe('0');
    expect(formatMinor(999n, 'IQD')).toBe('999');
    expect(formatMinor(1234567n, 'IQD')).toBe('1,234,567');
    expect(formatMinor(5n, 'USD')).toBe('0.05');
    expect(formatMinor(1250n, 'USD')).toBe('12.50');
    expect(formatMinor(123456789n, 'USD')).toBe('1,234,567.89');
  });
  it('is exact beyond the safe-integer range and keeps the sign', () => {
    expect(formatMinor(9007199254740993n, 'IQD')).toBe('9,007,199,254,740,993');
    expect(formatMinor(9223372036854775807n, 'USD')).toBe('92,233,720,368,547,758.07');
    expect(formatMinor(-25n, 'IQD')).toBe('-25');
    expect(formatMinor(-5n, 'USD')).toBe('-0.05');
  });
});

describe('the receipt prints local time from the stored UTC instant', () => {
  it('a sale at 22:30 UTC is 01:30 of the NEXT day in Baghdad', () => {
    const late = new Date('2026-10-28T22:30:00.000Z');
    expect(DEFAULT_TIME_ZONE).toBe('Asia/Baghdad');
    expect(formatLocalDateTime(late, 'Asia/Baghdad')).toBe('2026-10-29 01:30');
    const m = buildReceipt({ kind: 'sale', sale: { ...sale, at: late } }, opts());
    expect(m.date).toBe('2026-10-29 01:30');
    expect(renderReceiptText(m)).toContain('2026-10-29 01:30');
    expect(renderReceiptHtml(m)).toContain('2026-10-29 01:30');
    // The number is not touched: it keeps the number the sale was given (UTC day, documented limit).
    expect(m.number).toBe('20261028-000123');
  });
  it('uses the zone given, Latin digits, 24 hours, midnight is 00', () => {
    const at = new Date('2026-10-28T21:05:00.000Z');
    expect(formatLocalDateTime(at, 'UTC')).toBe('2026-10-28 21:05');
    expect(formatLocalDateTime(new Date('2026-10-28T21:00:00.000Z'), 'Asia/Baghdad')).toBe('2026-10-29 00:00');
    expect(formatLocalDateTime(at, 'America/New_York')).toBe('2026-10-28 17:05');
    expect(buildReceipt(doc, opts({ timeZone: 'UTC' })).date).toBe('2026-10-28 14:03');
  });
  it('knows a real IANA zone from a made-up one, and a bad stored zone prints in the default zone instead of failing', () => {
    expect(isValidTimeZone('Asia/Baghdad')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    for (const bad of ['', 'Mars/Base', 'baghdad', '+03:00', 'Asia/Baghdad; DROP']) expect(isValidTimeZone(bad)).toBe(false);
    expect(buildReceipt(doc, opts({ timeZone: 'Mars/Base' })).date).toBe('2026-10-28 17:03');
  });
});

describe('buildReceipt (sale)', () => {
  const m = buildReceipt(doc, opts());

  it('carries the stored figures, formatted', () => {
    expect(m.number).toBe('20261028-000123');
    expect(m.date).toBe('2026-10-28 17:03'); // 14:03 UTC is 17:03 in Baghdad (UTC+3)
    expect(m.cashier).toBe('Sara');
    expect(m.lines.map((l) => [l.no, l.name, l.strength, l.qty, l.unit, l.unitPrice, l.discount, l.total])).toEqual([
      [1, 'Panadol', '500 mg', '2', 'tablet', '250', '-50', '450'],
      [2, 'Amoxil', '250 mg', '1', 'strip', '2,000', '-100', '1,900'],
    ]);
    expect([m.subtotal, m.discount, m.rounding, m.total, m.paid, m.change]).toEqual(['2,500', '-150', null, '2,350', '3,000', '650']);
    expect(m.payments).toEqual([{ method: 'CASH', label: 'Cash', amount: '3,000' }]);
  });
  it('marks a prescription sale, and only then', () => {
    expect(m.rx).toBe(true);
    expect(m.lines.map((l) => l.rx)).toEqual([false, true]);
    const otc = buildReceipt({ kind: 'sale', sale: { ...sale, lines: [sale.lines[0]!] } }, opts());
    expect(otc.rx).toBe(false);
  });
  it('shows a signed rounding line only when there is a difference', () => {
    const rounded = buildReceipt({ kind: 'sale', sale: { ...sale, roundingMinor: -25n } }, opts());
    expect(rounded.rounding).toBe('-25');
  });
  it('has the COPY marker only on a copy, localized, numbered after the first', () => {
    expect(m.copy).toBe(false);
    expect(m.copyMarker).toBeNull();
    expect(buildReceipt(doc, opts({ copy: true })).copyMarker).toBe('COPY');
    expect(buildReceipt(doc, opts({ copy: true, copyNumber: 3 })).copyMarker).toBe('COPY 3');
    expect(buildReceipt(doc, opts({ copy: true, locale: 'ar' })).copyMarker).toBe('نسخة');
  });
  it('is right to left for ar and ckb and keeps Latin digits for amounts and numbers', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      const r = buildReceipt(doc, opts({ locale }));
      expect(r.dir).toBe('rtl');
      expect(r.number).toBe('20261028-000123');
      expect(r.total).toBe('2,350');
      expect(`${r.total}${r.paid}${r.date}`).not.toMatch(/[٠-٩۰-۹]/);
    }
    expect(m.dir).toBe('ltr');
  });
  it('omits what the shop does not have', () => {
    const r = buildReceipt(doc, opts({ shop: { name: 'Only a name' } }));
    expect(r.shop).toEqual({ name: 'Only a name' });
  });
  it('is pure: the same rows give the same model', () => {
    expect(buildReceipt(doc, opts())).toEqual(buildReceipt(doc, opts()));
  });
  it('USD prints two decimals', () => {
    const usd = buildReceipt(
      { kind: 'sale', sale: { ...sale, currency: 'USD', subtotalMinor: 1250n, discountMinor: 0n, totalMinor: 1250n, paidMinor: 1250n, changeMinor: 0n, lines: [{ ...sale.lines[0]!, unitPriceMinor: 625n, discountMinor: 0n, totalMinor: 1250n }] } },
      opts(),
    );
    expect([usd.total, usd.change, usd.lines[0]!.unitPrice]).toEqual(['12.50', null, '6.25']);
  });
});

describe('buildReceipt (return slip)', () => {
  const ret = buildReceipt(
    {
      kind: 'return',
      ret: { number: 'R20261028-000004', saleNumber: '20261028-000123', currency: 'IQD', at: AT, refundMinor: 450n, refundMethod: 'CASH', approverName: 'Omar', lines: [{ name: 'Panadol', strength: '500 mg', baseQty: 2, refundMinor: 450n, rxLevel: 'OTC' }] },
    },
    opts({ width: '58' }),
  );
  it('shows the return number, the sale it belongs to, the refund and how it went out', () => {
    expect(ret).toMatchObject({ kind: 'return', number: 'R20261028-000004', saleNumber: '20261028-000123', total: '450', cashier: 'Omar', title: 'Return slip' });
    expect(ret.refundMethod).toEqual({ method: 'CASH', label: 'Cash' });
    expect(ret.lines[0]).toMatchObject({ qty: '2', total: '450', unitPrice: null });
  });
});

describe('renderReceiptHtml', () => {
  it('is a complete page: print size, no script, no link, no animation', () => {
    for (const width of ['80', '58'] as const) {
      const html = renderReceiptHtml(buildReceipt(doc, opts({ width })));
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain(`@page { size: ${width}mm auto; margin: 2mm }`);
      expect(html).not.toMatch(/<script|<link|<img|src=|href=|@import|url\(|transition|animation|@keyframes/i);
    }
  });
  it('sets lang and dir from the locale', () => {
    expect(renderReceiptHtml(buildReceipt(doc, opts()))).toContain('<html lang="en" dir="ltr">');
    expect(renderReceiptHtml(buildReceipt(doc, opts({ locale: 'ar' })))).toContain('<html lang="ar" dir="rtl">');
    expect(renderReceiptHtml(buildReceipt(doc, opts({ locale: 'ckb' })))).toContain('<html lang="ckb" dir="rtl">');
  });
  it('escapes every dynamic value', () => {
    const evil = '<script>alert(1)</script>"\'&';
    const hostile = buildReceipt(
      {
        kind: 'sale',
        sale: { ...sale, number: evil, cashierName: evil, lines: [{ ...sale.lines[0]!, name: evil, strength: evil, unitLabel: evil }] },
      },
      opts({ shop: { name: evil, address: evil, phone: evil, footer: evil }, copy: true }),
    );
    const html = renderReceiptHtml(hostile);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)</script>');
    expect(html).toContain(escapeHtml(evil));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;');
  });
  it('shows the COPY marker only on a copy', () => {
    expect(renderReceiptHtml(buildReceipt(doc, opts()))).not.toContain('COPY');
    expect(renderReceiptHtml(buildReceipt(doc, opts({ copy: true })))).toContain('COPY');
  });
  it('contains no cost or patient wording', () => {
    const html = renderReceiptHtml(buildReceipt(doc, opts())).toLowerCase();
    for (const word of ['cost', 'profit', 'patient', 'customer', 'phone number of']) expect(html).not.toContain(word);
  });

  // Golden files: review a diff here as a change of what is printed.
  for (const width of ['80', '58'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      it(`golden: ${width} mm ${locale} sale, first print and copy`, async () => {
        await expect(renderReceiptHtml(buildReceipt(doc, opts({ width, locale })))).toMatchFileSnapshot(`__golden__/receipt-${width}-${locale}.html`);
        await expect(renderReceiptText(buildReceipt(doc, opts({ width, locale, copy: true, copyNumber: 2 })))).toMatchFileSnapshot(`__golden__/receipt-${width}-${locale}-copy.txt`);
      });
    }
  }
});

describe('renderReceiptText', () => {
  it('fits its width and lines up by hand', () => {
    const text = renderReceiptText(buildReceipt(doc, opts({ width: '58' })));
    for (const line of text.split('\n')) expect([...line].length).toBeLessThanOrEqual(32);
    expect(text).toContain(`Total${' '.repeat(18)}2,350 IQD`);
    expect(text).toContain(`Change${' '.repeat(19)}650 IQD`);
    expect(text).not.toContain('COPY');
    expect(renderReceiptText(buildReceipt(doc, opts({ width: '80', copy: true })))).toContain('*** COPY ***');
  });
});

describe('return slip rounding and hostile text', () => {
  const slip = (refundMinor: bigint) =>
    buildReceipt(
      {
        kind: 'return',
        ret: { number: 'R1', saleNumber: 'S1', currency: 'IQD', at: AT, refundMinor, refundMethod: 'CASH', approverName: 'Omar', lines: [{ name: 'Panadol', strength: '500 mg', baseQty: 6, refundMinor: 270n, rxLevel: 'OTC' }] },
      },
      opts(),
    );

  it('shows the rounding of a final return as the difference between the refund and its lines', () => {
    const m = slip(370n);
    expect([m.rounding, m.total]).toEqual(['100', '370']);
    expect(renderReceiptText(m)).toMatch(/Rounding\s+100\n/);
    expect(slip(270n).rounding).toBeNull();
  });

  it('keeps a name on one line in the text: newlines and bidi controls are removed', () => {
    const m = buildReceipt(
      { kind: 'sale', sale: { ...sale, lines: [{ ...sale.lines[0]!, name: 'Pana\ndol\r\n\u202Eevil\u2066x\u200F' }], cashierName: 'Sa\nra\u202E' } },
      opts({ shop: { ...SHOP, name: 'Al\nNoor\u202D' } }),
    );
    const text = renderReceiptText(m);
    expect(text).not.toMatch(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
    expect(text).toContain('Pana dol evilx 500 mg');
    expect(text).toContain('Al Noor');
    expect(text).toContain('Sa ra');
  });
});
