import { describe, expect, it } from 'vitest';
import { buildReceipt, type ReceiptOptions, type StoredSale } from '@/server/domain/pharmacy/receipt';
import { receiptPaperDoc, tookCash } from '@/server/domain/pharmacy/receipt-paper';

const SHOP = { name: 'Al Noor Pharmacy', address: 'Karrada, Baghdad', phone: '+964 770 000 0000', footer: 'Keep out of reach of children' };
const sale: StoredSale = {
  number: '20261028-000123',
  currency: 'IQD',
  at: new Date('2026-10-28T14:03:09.000Z'),
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
const opts = (over: Partial<ReceiptOptions> = {}): ReceiptOptions => ({ width: '80', locale: 'en', copy: false, shop: SHOP, ...over });
const model = (over: Partial<StoredSale> = {}, o: Partial<ReceiptOptions> = {}) => buildReceipt({ kind: 'sale', sale: { ...sale, ...over } }, opts(o));
const texts = (m: ReturnType<typeof model>) => receiptPaperDoc(m).rows.flatMap((r) => (r.kind === 'text' ? [r.left, r.right ?? ''] : []));

describe('receiptPaperDoc', () => {
  it('puts the shop first, big, and carries the sale number, cashier and total', () => {
    const doc = receiptPaperDoc(model());
    expect(doc.rows[0]).toMatchObject({ kind: 'text', align: 'center', left: 'Al Noor Pharmacy', size: 2, bold: true });
    const all = texts(model()).join('|');
    expect(all).toContain('20261028-000123');
    expect(all).toContain('Sara');
    expect(all).toContain('2,350');
    expect(doc.copy).toBeFalsy();
  });
  it('writes each line as a name row and a quantity-times-price row with the line total', () => {
    const rows = receiptPaperDoc(model()).rows;
    expect(rows.some((r) => r.kind === 'text' && r.left.includes('Panadol') && r.left.includes('500 mg'))).toBe(true);
    expect(rows.some((r) => r.kind === 'text' && r.right === '450' && r.left.includes('2'))).toBe(true);
    expect(rows.some((r) => r.kind === 'text' && r.right === '1,900')).toBe(true);
  });
  it('marks prescription items and shows change only when there is some', () => {
    expect(texts(model()).join('|')).toContain('Rx');
    expect(texts(model()).join('|')).toContain('650');
    const exact = model({ paidMinor: 2350n, changeMinor: 0n });
    expect(receiptPaperDoc(exact).rows.some((r) => r.kind === 'text' && r.left === exact.labels.change)).toBe(false);
  });
  it('a copy starts with a bold COPY row and says so on the document', () => {
    const m = model({}, { copy: true, copyNumber: 2 });
    const doc = receiptPaperDoc(m);
    expect(doc.copy).toBe(true);
    expect(doc.rows[0]).toMatchObject({ kind: 'text', bold: true, align: 'center' });
    expect((doc.rows[0] as { left: string }).left).toContain(m.copyMarker as string);
  });
  it('ends with the shop footer', () => {
    expect(texts(model()).join('|')).toContain('Keep out of reach of children');
  });
});

describe('tookCash', () => {
  it('is true when any payment was cash, even beside credit', () => {
    expect(tookCash(model())).toBe(true);
    expect(tookCash(model({ payments: [{ method: 'CASH', amountMinor: 1000n }, { method: 'CREDIT', amountMinor: 1350n }] }))).toBe(true);
  });
  it('is false for credit-only and card-only sales', () => {
    expect(tookCash(model({ payments: [{ method: 'CREDIT', amountMinor: 2350n }] }))).toBe(false);
    expect(tookCash(model({ payments: [{ method: 'CARD_MANUAL', amountMinor: 2350n }] }))).toBe(false);
  });
  it('is false for a return slip', () => {
    const m = buildReceipt(
      { kind: 'return', ret: { number: 'R-1', saleNumber: '20261028-000123', currency: 'IQD', at: sale.at, refundMinor: 450n, refundMethod: 'CASH', approverName: 'Sara', lines: [{ name: 'Panadol', strength: '500 mg', baseQty: 2, refundMinor: 450n, rxLevel: 'OTC' }] } },
      opts(),
    );
    expect(tookCash(m)).toBe(false);
  });
});
