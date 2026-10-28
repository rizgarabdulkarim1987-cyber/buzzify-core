import { describe, expect, it } from 'vitest';
import type { PaperRow } from '@/server/domain/pos/paper';
import { kitchenDocs, receiptDoc, shiftDoc, type PaperFormat } from '@/server/domain/pos/paper-docs';
import type { KitchenTicket } from '@/server/pos/kitchen';
import type { Receipt } from '@/server/pos/payments';
import type { ShiftSummary } from '@/server/pos/shifts';

const t = (key: string) => key;
const fmt: PaperFormat = { money: (n) => `${n}$`, number: (n) => String(n), stamp: () => 'STAMP' };

function receipt(overrides: Partial<Receipt> = {}, snapshot: Partial<Receipt['snapshot']> = {}): Receipt {
  return {
    paymentId: 'p1', part: 1, parts: [], orderId: 'o1', orderNumber: 12, tableNumber: 4, kind: 'DINE_IN', queueNumber: null, customer: null,
    method: 'CASH', legs: [{ method: 'CASH', amount: 5000, tendered: 10000, reference: null, tenderedUsd: null, rate: null }], tip: null,
    amountReceived: 10000, change: 5000, reference: null, paidAt: new Date(0), cashierName: 'Ali', orderVersion: 3, reversal: null,
    business: { name: 'Grill House', address: '', phone: '', footer: 'See you' },
    snapshot: { subtotal: 5000, invoiceDiscount: 0, service: 0, tax: 0, deliveryFee: 0, rounding: 0, total: 5000, lines: [{ id: 'l1', quantity: 2, name: 'Kebab', options: [], promoPerUnit: 0, lineTotal: 5000 }], ...snapshot } as Receipt['snapshot'],
    ...overrides,
  } as Receipt;
}

const text = (rows: PaperRow[]) => rows.filter((r): r is Extract<PaperRow, { kind: 'text' }> => r.kind === 'text');

describe('receiptDoc', () => {
  it('writes the business, the lines, the total, the change and the footer in order', () => {
    const rows = receiptDoc(receipt(), t, fmt, { copy: false }).rows;
    const flat = text(rows).map((r) => r.left);
    expect(flat[0]).toBe('Grill House');
    expect(text(rows)[0]).toMatchObject({ align: 'center', size: 2 });
    expect(flat).toContain('2 × Kebab');
    expect(text(rows).find((r) => r.left === '2 × Kebab')?.right).toBe('5000$');
    expect(flat.indexOf('pos.totals.total')).toBeGreaterThan(flat.indexOf('2 × Kebab'));
    expect(flat).toContain('pos.pay.change');
    expect(flat[flat.length - 1]).toBe('See you');
  });

  it('adds a rounding row only when the bill was rounded', () => {
    expect(text(receiptDoc(receipt(), t, fmt, { copy: false }).rows).map((r) => r.left)).not.toContain('pos.totals.rounding');
    const rounded = receiptDoc(receipt({}, { rounding: -250 }), t, fmt, { copy: false }).rows;
    expect(text(rounded).find((r) => r.left === 'pos.totals.rounding')?.right).toBe('− 250$');
  });

  it('shows dollars on a dollar leg and still prints the change line', () => {
    const doc = receiptDoc(receipt({ legs: [{ method: 'CASH_USD', amount: 5000, tendered: null, reference: null, tenderedUsd: 4, rate: 1500 }] }), t, fmt, { copy: false });
    expect(text(doc.rows).find((r) => r.left === 'pos.method.CASH_USD')?.right).toBe('pos.usd.amount');
    expect(text(doc.rows).map((r) => r.left)).toContain('pos.pay.change');
  });

  it('puts the copy word first on a reprint, and omits an empty business block', () => {
    const copy = receiptDoc(receipt({ business: { name: '', address: '', phone: '', footer: '' } }), t, fmt, { copy: true });
    expect(text(copy.rows)[0].left).toBe('pos.receipt.copy');
    expect(copy.copy).toBe(true);
    expect(text(copy.rows).map((r) => r.left)).not.toContain('');
  });
});

describe('kitchenDocs', () => {
  const ticket = {
    orderNumber: 7, kind: 'DINE_IN', queueNumber: null, tableNumber: 2, areaName: 'Hall', cashierName: 'Ali', printedAt: new Date(0),
    sheets: [
      { sectionId: 's1', sectionName: 'Grill', batch: 1, sentAt: new Date(0), lines: [{ name: 'Kebab', quantity: 2, options: ['Spicy'], note: 'no onion' }] },
      { sectionId: null, sectionName: 'Bar', batch: 1, sentAt: new Date(0), lines: [{ name: 'Tea', quantity: 1, options: [], note: '' }] },
    ],
    cancelSlips: [{ sectionId: 's1', sectionName: 'Grill', lines: [{ name: 'Rice', quantity: 1, reason: 'out' }] }],
  } as KitchenTicket;

  it('gives one document per sheet and per cancel slip, tagged with its section', () => {
    const docs = kitchenDocs(ticket, t, fmt);
    expect(docs.map((d) => d.sectionId)).toEqual(['s1', null, 's1']);
    const grill = text(docs[0].doc.rows);
    expect(grill.find((r) => r.left === '2 × Kebab')).toMatchObject({ size: 2 });
    expect(grill.map((r) => r.left)).toEqual(expect.arrayContaining(['Spicy', '“no onion”']));
    expect(text(docs[2].doc.rows).map((r) => r.left)).toContain('pos.ticket.cancelled · Grill');
  });
});

describe('shiftDoc', () => {
  it('lists opening float, sales, expenses and the count', () => {
    const summary = {
      shift: { id: 's', userId: 'u', openedAt: new Date(0), openingFloat: 25000, closedAt: new Date(1), countedCash: 90000, expectedCashAtClose: 90000, difference: 0, countedUsd: null, expectedUsdAtClose: null, differenceUsd: null, zNumber: 3, note: '' },
      cashierName: 'Ali', closedByName: 'Ali', cashSales: 80000, salesCount: 9, expenses: [], expensesTotal: 15000, cashRefunds: 0,
      refundsByMethod: {}, expectedCash: 90000, countsDollars: false, expectedUsd: null, openOrdersCount: 0, unsettledDeliveries: { count: 0, amount: 0 },
    } as unknown as ShiftSummary;
    const rows = text(shiftDoc(summary, t, fmt).rows);
    expect(rows.find((r) => r.left === 'pos.shift.openingFloat')?.right).toBe('25000$');
    expect(rows.find((r) => r.left === 'pos.shift.counted')?.right).toBe('90000$');
    expect(rows.map((r) => r.left)).toContain('pos.shift.zNumber');
  });
});
