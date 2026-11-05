import type { PaperDoc, PaperRow } from '@/server/domain/pos/paper';
import type { ReceiptModel } from './receipt';

/**
 * The pharmacy receipt as thermal paper rows, from the same `ReceiptModel` the screen and the A4 sheet use, so the three always agree.
 * The model has no cost, profit, patient or customer field, so none can reach the paper. The browser draws the rows as a picture
 * (that is how Arabic and Kurdish print correctly), and the print bridge sends it to the printer.
 */

const center = (left: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'center', left, ...extra });
const pair = (left: string, right: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'start', left, right, ...extra });
const plain = (left: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'start', left, ...extra });

export function receiptPaperDoc(m: ReceiptModel): PaperDoc {
  const L = m.labels;
  const rows: PaperRow[] = [];
  if (m.copyMarker) rows.push(center(`*** ${m.copyMarker} ***`, { bold: true }));
  rows.push(center(m.shop.name, { size: 2, bold: true }));
  if (m.shop.address) rows.push(center(m.shop.address));
  if (m.shop.phone) rows.push(center(m.shop.phone));
  rows.push({ kind: 'rule' });
  rows.push(center(`${m.title}${m.rx ? ` [${L.rx}]` : ''}`, { bold: true }));
  rows.push(pair(L.number, m.number));
  if (m.saleNumber) rows.push(pair(L.saleNumber, m.saleNumber));
  rows.push(pair(L.date, m.date));
  if (m.cashier) rows.push(pair(m.kind === 'sale' ? L.cashier : L.approvedBy, m.cashier));
  rows.push({ kind: 'rule' });
  for (const line of m.lines) {
    rows.push(plain(`${line.name}${line.strength ? ` ${line.strength}` : ''}${line.rx ? ` [${L.rx}]` : ''}`, { bold: true }));
    rows.push(pair(`${line.qty}${line.unit ? ` ${line.unit}` : ''}${line.unitPrice ? ` × ${line.unitPrice}` : ''}`, line.total));
    if (line.discount) rows.push(pair(L.discount, line.discount));
  }
  rows.push({ kind: 'rule' });
  if (m.subtotal !== null) rows.push(pair(L.subtotal, m.subtotal));
  if (m.discount) rows.push(pair(L.discount, m.discount));
  if (m.rounding) rows.push(pair(L.rounding, m.rounding));
  rows.push(pair(m.kind === 'sale' ? L.total : L.refund, `${m.total} ${m.currency}`, { size: 2, bold: true }));
  if (m.refundMethod) rows.push(pair(L.refundedBy, m.refundMethod.label));
  for (const p of m.payments) rows.push(pair(p.label, p.amount));
  if (m.paid !== null && m.change !== null) {
    rows.push(pair(L.paid, `${m.paid} ${m.currency}`));
    rows.push(pair(L.change, `${m.change} ${m.currency}`));
  }
  if (m.shop.footer) {
    rows.push({ kind: 'rule' });
    rows.push(center(m.shop.footer));
  }
  rows.push({ kind: 'gap' });
  return { rows, ...(m.copyMarker ? { copy: true } : {}) };
}

/** True when a sale took any cash, even beside credit: that is when the drawer opens. A return slip never does. */
export function tookCash(m: ReceiptModel): boolean {
  return m.kind === 'sale' && m.payments.some((p) => p.method === 'CASH');
}
