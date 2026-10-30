import type { PaperDoc, PaperRow } from '@/server/domain/pos/paper';
import type { KitchenTicket } from '@/server/pos/kitchen';
import type { OrderView } from '@/server/pos/orders';
import type { Receipt } from '@/server/pos/payments';
import type { ShiftSummary } from '@/server/pos/shifts';

/** Words and number formats come from the screen's language, so the paper reads like the screen. */
export type PaperText = (key: string, vars?: Record<string, string | number>) => string;
export interface PaperFormat {
  money: (amount: number) => string;
  number: (value: number) => string;
  stamp: (at: Date) => string;
}

const join = (parts: ReadonlyArray<string | null | undefined>) => parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' · ');
const center = (left: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'center', left, ...extra });
const pair = (left: string, right: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'start', left, right, ...extra });
const plain = (left: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'start', left, ...extra });

/** The paid order as paper, row for row what the receipt screen shows. */
export function receiptDoc(receipt: Receipt, t: PaperText, fmt: PaperFormat, opts: { copy: boolean }): PaperDoc {
  const s = receipt.snapshot;
  const rows: PaperRow[] = [];
  if (opts.copy) rows.push(center(t('pos.receipt.copy'), { bold: true }));
  const { business } = receipt;
  if (business.name) rows.push(center(business.name, { size: 2, bold: true }));
  if (business.address) rows.push(center(business.address));
  if (business.phone) rows.push(center(business.phone));
  if (s.taxNumber) rows.push(center(t('pos.receipt.taxNumber', { n: s.taxNumber })));
  rows.push(center(t('pos.receipt.heading', { n: fmt.number(receipt.orderNumber) }), { bold: true }));
  rows.push(center(join([receipt.tableNumber !== null ? t('pos.receipt.table', { n: fmt.number(receipt.tableNumber) }) : null, fmt.stamp(receipt.paidAt)])));
  if (receipt.cashierName) rows.push(center(receipt.cashierName));
  if (receipt.queueNumber !== null && receipt.kind !== 'DINE_IN') {
    rows.push(center(t(receipt.kind === 'DELIVERY' ? 'pos.receipt.kindDelivery' : 'pos.receipt.kindTakeaway', { n: fmt.number(receipt.queueNumber) }), { bold: true }));
  }
  if (receipt.customer) {
    if (receipt.customer.name) rows.push(center(receipt.customer.name));
    if (receipt.customer.phone) rows.push(center(receipt.customer.phone));
    if (receipt.kind === 'DELIVERY') {
      const where = join([receipt.customer.zoneName, receipt.customer.address]);
      if (where) rows.push(center(where));
      if (receipt.customer.addressNote) rows.push(center(receipt.customer.addressNote));
      if (receipt.customer.driverName) rows.push(center(`${t('pos.offp.driver')}: ${receipt.customer.driverName}`));
    }
  }
  rows.push({ kind: 'rule' });
  for (const line of s.lines) {
    rows.push(pair(`${fmt.number(line.quantity)} × ${line.name}`, fmt.money(line.lineTotal)));
    if (line.options.length > 0) rows.push(plain(line.options.map((o) => o.name).join(' · ')));
    if (line.promoPerUnit > 0) rows.push(plain(`${t('pos.requests.offer')} ${fmt.money(-line.promoPerUnit * line.quantity)}`));
  }
  rows.push({ kind: 'rule' });
  rows.push(pair(t('pos.totals.subtotal'), fmt.money(s.subtotal)));
  if (s.invoiceDiscount > 0) rows.push(pair(t('pos.totals.discount'), `− ${fmt.money(s.invoiceDiscount)}`));
  if (s.service > 0) rows.push(pair(t('pos.totals.service'), fmt.money(s.service)));
  if (s.tax > 0) rows.push(pair(t('pos.totals.tax'), fmt.money(s.tax)));
  if (s.deliveryFee > 0) rows.push(pair(t('pos.totals.deliveryFee'), fmt.money(s.deliveryFee)));
  if (s.rounding !== 0) rows.push(pair(t('pos.totals.rounding'), `${s.rounding > 0 ? '+' : '−'} ${fmt.money(Math.abs(s.rounding))}`));
  rows.push(pair(t('pos.totals.total'), fmt.money(s.total), { size: 2, bold: true }));
  for (const leg of receipt.legs) {
    const label = leg.method === 'CASH' ? t('pos.receipt.cash') : t(`pos.method.${leg.method}`);
    const value =
      leg.method === 'CASH_USD' && leg.tenderedUsd !== null ? t('pos.usd.amount', { n: fmt.number(leg.tenderedUsd) }) : fmt.money(leg.method === 'CASH' ? (leg.tendered ?? leg.amount) : leg.amount);
    rows.push(pair(label, value));
    if (leg.reference) rows.push(pair(t('pos.receipt.reference'), leg.reference));
  }
  if (receipt.tip) rows.push(pair(`${t('pos.pay.tip')} · ${receipt.tip.method === 'CASH' ? t('pos.receipt.cash') : t(`pos.method.${receipt.tip.method}`)}`, fmt.money(receipt.tip.amount)));
  if (receipt.legs.some((leg) => leg.method === 'CASH' || leg.method === 'CASH_USD')) rows.push(pair(t('pos.pay.change'), fmt.money(receipt.change)));
  if (receipt.reversal) {
    rows.push({ kind: 'rule' });
    rows.push(center(t('pos.receipt.reversed'), { size: 2, bold: true }));
    rows.push(center(fmt.money(receipt.reversal.amount)));
    rows.push(center(t('pos.receipt.reversedBy', { name: receipt.reversal.byName, time: fmt.stamp(receipt.reversal.at) })));
    if (receipt.reversal.reason) rows.push(center(receipt.reversal.reason));
  }
  rows.push({ kind: 'gap' });
  rows.push(center(business.footer || t('pos.receipt.thanks')));
  return { rows, ...(opts.copy ? { copy: true } : {}) };
}

/** One paper per kitchen sheet and per cancellation slip, each tagged with the section whose printer takes it. */
export function kitchenDocs(ticket: KitchenTicket, t: PaperText, fmt: PaperFormat, printedSlips: ReadonlySet<string> = new Set()): { sectionId: string | null; doc: PaperDoc; slipKey?: string }[] {
  const head = join([
    ticket.kind !== 'DINE_IN' && ticket.queueNumber !== null
      ? t(ticket.kind === 'DELIVERY' ? 'pos.ticket.delivery' : 'pos.ticket.takeaway', { n: fmt.number(ticket.queueNumber) })
      : ticket.tableNumber !== null
        ? t('pos.ticket.table', { n: fmt.number(ticket.tableNumber) })
        : null,
    ticket.areaName,
    ticket.cashierName,
  ]);
  const docs: { sectionId: string | null; doc: PaperDoc; slipKey?: string }[] = [];
  for (const sheet of ticket.sheets) {
    const rows: PaperRow[] = [center(`${sheet.sectionName} · ${t('pos.ticket.order', { n: fmt.number(ticket.orderNumber) })}`, { size: 2, bold: true })];
    if (head) rows.push(center(head));
    rows.push({ kind: 'rule' });
    for (const line of sheet.lines) {
      rows.push(plain(`${fmt.number(line.quantity)} × ${line.name}`, { size: 2, bold: true }));
      if (line.options.length > 0) rows.push(plain(line.options.join(' · ')));
      if (line.note) rows.push(plain(`“${line.note}”`));
    }
    rows.push({ kind: 'gap' });
    docs.push({ sectionId: sheet.sectionId, doc: { rows } });
  }
  // A cancellation stays on the ticket until the kitchen screen acknowledges it; a kitchen that only prints must not get it on every later round.
  for (const slip of ticket.cancelSlips) {
    const slipKey = `${ticket.orderNumber}|${slip.sectionId ?? ''}|${slip.lines.map((l) => `${l.quantity}×${l.name}:${l.reason}`).join(';')}`;
    if (printedSlips.has(slipKey)) continue;
    const rows: PaperRow[] = [center(`${t('pos.ticket.cancelled')} · ${slip.sectionName}`, { size: 2, bold: true })];
    if (head) rows.push(center(head));
    rows.push({ kind: 'rule' });
    for (const line of slip.lines) {
      rows.push(plain(`${fmt.number(line.quantity)} × ${line.name}`, { size: 2, bold: true }));
      if (line.reason) rows.push(plain(line.reason));
    }
    rows.push({ kind: 'gap' });
    docs.push({ sectionId: slip.sectionId, doc: { rows }, slipKey });
  }
  return docs;
}

/** A phone number in a right-to-left line: isolated so its `+` and spaces stay in dialling order. */
const dialled = (phone: string) => `⁦${phone}⁩`;

/** The driver's paper, row for row what the delivery slip screen shows: where to go, what is in the bag (no prices) and the cash to collect. */
export function deliveryDoc(order: OrderView, t: PaperText, fmt: PaperFormat): PaperDoc {
  const info = order.offPremise;
  const rows: PaperRow[] = [center(t('pos.slip.title'), { size: 2, bold: true })];
  if (info) rows.push(center(t('pos.receipt.kindDelivery', { n: fmt.number(info.queueNumber) }), { bold: true }));
  rows.push(center(fmt.stamp(order.seatedAt)));
  rows.push({ kind: 'rule' });
  if (info) {
    if (info.customerName) rows.push(plain(info.customerName, { bold: true }));
    if (info.customerPhone) rows.push(plain(dialled(info.customerPhone)));
    const where = join([info.zoneName, info.address]);
    if (where) rows.push(plain(where));
    if (info.addressNote) rows.push(plain(info.addressNote));
    if (info.driverName) rows.push(plain(`${t('pos.offp.driver')}: ${info.driverName}`));
    rows.push({ kind: 'rule' });
  }
  for (const line of order.lines.filter((l) => !l.cancelled)) {
    rows.push(plain(`${fmt.number(line.quantity)} × ${line.name}`));
    if (line.options.length > 0) rows.push(plain(line.options.map((o) => o.name).join(' · ')));
  }
  rows.push({ kind: 'rule' });
  const paid = order.status === 'PAID';
  rows.push(pair(paid ? t('pos.slip.paidAlready') : t('pos.slip.toCollect'), fmt.money(paid ? 0 : order.totals.total), { size: 2, bold: true }));
  rows.push({ kind: 'gap' });
  return { rows };
}

/** The shift as paper: what was counted and how it compares, never what the drawer should hold while it is open. */
export function shiftDoc(summary: ShiftSummary, t: PaperText, fmt: PaperFormat): PaperDoc {
  const { shift } = summary;
  const open = shift.closedAt === null;
  const rows: PaperRow[] = [
    center(t('pos.shift.countAndClose'), { size: 2, bold: true }),
    center(join([summary.cashierName, `${t('pos.shift.openedAt')} ${fmt.stamp(shift.openedAt)}`, shift.closedAt ? `${t('pos.shift.closedAt')} ${fmt.stamp(shift.closedAt)}` : null])),
    { kind: 'rule' },
    pair(t('pos.shift.openingFloat'), fmt.money(shift.openingFloat)),
  ];
  if (shift.zNumber !== null) rows.push(pair(t('pos.shift.zNumber'), fmt.number(shift.zNumber)));
  if (!open) rows.push(pair(t('pos.shift.cashSales', { n: fmt.number(summary.salesCount) }), fmt.money(summary.cashSales)));
  rows.push(pair(t('pos.shift.expenses'), `− ${fmt.money(summary.expensesTotal)}`));
  if (!open && summary.cashRefunds > 0) rows.push(pair(t('pos.shift.cashRefunds'), `− ${fmt.money(summary.cashRefunds)}`));
  if (!open && shift.countedCash !== null) rows.push(pair(t('pos.shift.counted'), fmt.money(shift.countedCash)));
  if (!open && shift.countedUsd !== null) rows.push(pair(t('pos.shift.countedUsd'), t('pos.usd.amount', { n: fmt.number(shift.countedUsd) })));
  if (!open && shift.difference !== null) {
    const kind = shift.difference === 0 ? 'exact' : shift.difference > 0 ? 'surplus' : 'shortage';
    rows.push(pair(t(`pos.shift.${kind}`), kind === 'exact' ? '' : fmt.money(Math.abs(shift.difference)), { bold: true }));
  }
  if (shift.note) rows.push(plain(shift.note));
  rows.push({ kind: 'gap' });
  return { rows };
}
