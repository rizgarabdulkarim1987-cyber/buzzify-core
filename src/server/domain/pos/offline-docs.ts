import { localTotals, payableOf, type LocalOrder } from '@/lib/pos-sync/local-state';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';
import type { PaperDoc, PaperRow } from '@/server/domain/pos/paper';
import type { PaperFormat, PaperText } from '@/server/domain/pos/paper-docs';

/**
 * Paper for the offline till, built from the order as the device holds it (no server). Same rows as the online receipt and
 * kitchen sheets so the paper reads alike; the receipt says it is provisional until the payment is sent.
 */

const center = (left: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'center', left, ...extra });
const pair = (left: string, right: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'start', left, right, ...extra });
const plain = (left: string, extra: Partial<Extract<PaperRow, { kind: 'text' }>> = {}): PaperRow => ({ kind: 'text', align: 'start', left, ...extra });

const numberOf = (order: LocalOrder, fmt: PaperFormat) => order.provisional ?? fmt.number(order.number ?? 0);
const unitTotal = (line: LocalOrder['lines'][number]) => (line.unitPrice + line.options.reduce((sum, option) => sum + option.priceDelta, 0) - line.promoPerUnit) * line.quantity;

/** The paid order as a provisional receipt. `tableNumber` is the table's number on the floor (null when unknown). */
export function offlineReceiptDoc(order: LocalOrder, tableNumber: number | null, snapshot: Pick<SyncSnapshot, 'rates' | 'business' | 'user'>, t: PaperText, fmt: PaperFormat): PaperDoc {
  const rows: PaperRow[] = [center(t('pos.offline.receiptProvisional'), { bold: true })];
  const business = snapshot.business;
  if (business?.name) rows.push(center(business.name, { size: 2, bold: true }));
  if (business?.address) rows.push(center(business.address));
  if (business?.phone) rows.push(center(business.phone));
  if (business?.taxNumber) rows.push(center(t('pos.receipt.taxNumber', { n: business.taxNumber })));
  rows.push(center(t('pos.receipt.heading', { n: numberOf(order, fmt) }), { bold: true }));
  rows.push(center([tableNumber !== null ? t('pos.receipt.table', { n: fmt.number(tableNumber) }) : '', order.seatedAt ? fmt.stamp(new Date(order.seatedAt)) : ''].filter(Boolean).join(' · ')));
  if (snapshot.user.name) rows.push(center(snapshot.user.name));
  rows.push({ kind: 'rule' });
  for (const line of order.lines.filter((l) => !l.cancelled)) {
    rows.push(pair(`${fmt.number(line.quantity)} × ${line.name}`, fmt.money(unitTotal(line))));
    if (line.options.length > 0) rows.push(plain(line.options.map((o) => o.name).join(' · ')));
  }
  rows.push({ kind: 'rule' });
  const totals = localTotals(order, snapshot.rates);
  const payable = payableOf(totals, snapshot.rates);
  rows.push(pair(t('pos.totals.subtotal'), fmt.money(totals.subtotal)));
  if (totals.invoiceDiscount > 0) rows.push(pair(t('pos.totals.discount'), `− ${fmt.money(totals.invoiceDiscount)}`));
  if (totals.service > 0) rows.push(pair(t('pos.totals.service'), fmt.money(totals.service)));
  if (totals.tax > 0) rows.push(pair(t('pos.totals.tax'), fmt.money(totals.tax)));
  if (payable.rounding !== 0) rows.push(pair(t('pos.totals.rounding'), `${payable.rounding > 0 ? '+' : '−'} ${fmt.money(Math.abs(payable.rounding))}`));
  rows.push(pair(t('pos.totals.total'), fmt.money(payable.total), { size: 2, bold: true }));
  if (order.paid) {
    rows.push(pair(t('pos.receipt.cash'), fmt.money(order.paid.amountReceived)));
    rows.push(pair(t('pos.pay.change'), fmt.money(order.paid.change)));
  }
  rows.push({ kind: 'gap' });
  rows.push(center(business?.footer || t('pos.receipt.thanks')));
  return { rows };
}

/**
 * One paper per kitchen section for the lines not sent yet, and one cancellation slip per section for sent lines the
 * cashier cancelled since (each only once: `printedSlips` holds the slips already on paper).
 */
export function offlineKitchenDocs(
  order: LocalOrder,
  tableNumber: number | null,
  snapshot: Pick<SyncSnapshot, 'catalog' | 'printers'>,
  t: PaperText,
  fmt: PaperFormat,
  printedSlips: ReadonlySet<string>,
): { sectionId: string | null; doc: PaperDoc; slipKey?: string }[] {
  const sectionOf = (productId: string | null) => snapshot.catalog?.products.find((p) => p.id === productId)?.sectionId ?? null;
  const nameOf = (sectionId: string | null) => snapshot.printers?.find((p) => p.role === 'KITCHEN' && p.sectionId === sectionId && sectionId !== null)?.name ?? '';
  const head = tableNumber !== null ? t('pos.ticket.table', { n: fmt.number(tableNumber) }) : '';
  const docs: { sectionId: string | null; doc: PaperDoc; slipKey?: string }[] = [];

  const bySection = (lines: LocalOrder['lines']) => {
    const groups = new Map<string | null, LocalOrder['lines']>();
    for (const line of lines) groups.set(sectionOf(line.productId), [...(groups.get(sectionOf(line.productId)) ?? []), line]);
    return groups;
  };

  for (const [sectionId, lines] of bySection(order.lines.filter((l) => !l.sent && !l.cancelled))) {
    const title = [nameOf(sectionId), t('pos.ticket.order', { n: numberOf(order, fmt) })].filter(Boolean).join(' · ');
    const rows: PaperRow[] = [center(title, { size: 2, bold: true })];
    if (head) rows.push(center(head));
    rows.push({ kind: 'rule' });
    for (const line of lines) {
      rows.push(plain(`${fmt.number(line.quantity)} × ${line.name}`, { size: 2, bold: true }));
      if (line.options.length > 0) rows.push(plain(line.options.map((o) => o.name).join(' · ')));
      if (line.note) rows.push(plain(`“${line.note}”`));
    }
    rows.push({ kind: 'gap' });
    docs.push({ sectionId, doc: { rows } });
  }

  for (const [sectionId, lines] of bySection(order.lines.filter((l) => l.sent && l.cancelled))) {
    const slipKey = `${order.key}|${sectionId ?? ''}|${lines.map((l) => `${l.id}:${l.quantity}`).join(';')}`;
    if (printedSlips.has(slipKey)) continue;
    const rows: PaperRow[] = [center([t('pos.ticket.cancelled'), nameOf(sectionId)].filter(Boolean).join(' · '), { size: 2, bold: true })];
    if (head) rows.push(center(head));
    rows.push({ kind: 'rule' });
    for (const line of lines) rows.push(plain(`${fmt.number(line.quantity)} × ${line.name}`, { size: 2, bold: true }));
    rows.push({ kind: 'gap' });
    docs.push({ sectionId, doc: { rows }, slipKey });
  }
  return docs;
}
