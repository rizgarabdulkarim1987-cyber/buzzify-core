import { parseMoney, type Currency } from '@/server/domain/pharmacy/money';
import type { DueBand } from '@/server/domain/pharmacy/purchasing';
import { wholeOf } from './product-draft';
import { attemptKeyFor } from './purchasing-logic';

/**
 * The pure parts of the money screens of purchasing: invoice entry, payments and credit allocation, the statement's CSV, the
 * attempt keys of each request, and the payables grouping. No React, no server: money is BigInt minor units with its
 * currency, never a Float, and two currencies are never added together. This file must not import the domain's
 * `purchasing.ts` at run time (it pulls in `node:crypto`); the allocation planner here mirrors it and a unit test pins that.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PART = 9_223_372_036_854_775_807n;

/** A signed amount as typed: empty is zero, one leading `+` or `-`, then an amount in the currency's digits. Null otherwise. */
export function parseSignedMoney(text: string, currency: Currency): bigint | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0n;
  const negative = trimmed.startsWith('-');
  const body = negative || trimmed.startsWith('+') ? trimmed.slice(1).trim() : trimmed;
  const money = parseMoney(body, currency);
  if (!money) return null;
  return negative ? -money.amount : money.amount;
}

// Invoice entry --------------------------------------------------------------------------------------------------------

/** What the entry screen shows of one invoiceable receipt line (`ph.invoices.invoiceable`). */
export interface InvoiceableRow {
  receiptLineId: string;
  receiptId: string;
  receiptNumber: string | null;
  productName: string;
  unitLabel: string;
  lot: string;
  expiry: string;
  invoiceableQty: number;
  currency: Currency | null;
  unitCostMinor?: string | undefined;
}

export interface InvoiceLineDraft {
  checked: boolean;
  /** Quantity to invoice, as typed. */
  qty: string;
  /** Invoiced unit cost, as typed (prefilled from the receipt cost). */
  cost: string;
}

export interface InvoiceDraft {
  clientKey: string;
  /** The signature `clientKey` was made for: the key is reused only while the request is the same. */
  keySig?: string | undefined;
  supplierId: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  currency: Currency;
  /** Signed, as typed. */
  adjustment: string;
  adjustmentReason: string;
  /** By receipt line id. */
  lines: Record<string, InvoiceLineDraft>;
}

export function emptyInvoiceDraft(clientKey: string, currency: Currency): InvoiceDraft {
  return { clientKey, supplierId: '', number: '', invoiceDate: '', dueDate: '', currency, adjustment: '', adjustmentReason: '', lines: {} };
}

/** The lines of a supplier as the draft starts: nothing ticked, the quantity left to invoice, the receipt cost. */
export function invoiceLinesStart(rows: readonly InvoiceableRow[], currency: Currency): Record<string, InvoiceLineDraft> {
  return Object.fromEntries(
    rows.map((r) => [
      r.receiptLineId,
      {
        checked: false,
        qty: String(r.invoiceableQty),
        cost: r.unitCostMinor === undefined || r.currency === null ? '' : minorText(BigInt(r.unitCostMinor), r.currency ?? currency),
      },
    ]),
  );
}

/** Minor units as typed text: `1250` for IQD, `12.50` for USD; negative amounts keep their sign. */
export function minorText(amount: bigint, currency: Currency): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const text = currency === 'IQD' ? abs.toString() : `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** Quantity times cost per line (BigInt), the signed adjustment, and the total. Null while any figure is not a valid amount. */
export function invoiceTotalsOf(
  lines: readonly { qty: string; cost: string }[],
  adjustment: string,
  currency: Currency,
): { linesMinor: bigint; adjustmentMinor: bigint; totalMinor: bigint } | null {
  let sum = 0n;
  for (const l of lines) {
    // A line restored from an older draft may lack a field: it is not a valid amount yet, never a crash.
    const qty = wholeOf(l.qty ?? '');
    const cost = parseMoney(l.cost ?? '', currency);
    if (qty === null || qty < 1 || !cost) return null;
    sum += cost.amount * BigInt(qty);
  }
  const adj = parseSignedMoney(adjustment, currency);
  if (adj === null) return null;
  return { linesMinor: sum, adjustmentMinor: adj, totalMinor: sum + adj };
}

export type InvoiceProblem = 'total' | 'supplier' | 'number' | 'date' | 'due' | 'currency' | 'lines' | 'qty' | 'exceeds' | 'cost' | 'adjustment' | 'reason';

export interface InvoiceBuilt {
  input?: Record<string, unknown>;
  /** Field (`supplierId`, `number`, `lines`, `lines.<receiptLineId>.qty`, ...) to a problem code. */
  problems: Record<string, InvoiceProblem>;
}

const ticked = (draft: InvoiceDraft, rows: readonly InvoiceableRow[]) => rows.filter((r) => draft.lines[r.receiptLineId]?.checked);

/** The action input and the problems that need no server. The place is put in by the Server Action. */
export function invoiceInputOf(draft: InvoiceDraft, rows: readonly InvoiceableRow[]): InvoiceBuilt {
  const problems: InvoiceBuilt['problems'] = {};
  if (!draft.supplierId) problems.supplierId = 'supplier';
  if (draft.number.trim() === '') problems.number = 'number';
  if (!DATE.test(draft.invoiceDate)) problems.invoiceDate = 'date';
  if (draft.dueDate !== '' && !DATE.test(draft.dueDate)) problems.dueDate = 'date';
  else if (draft.dueDate !== '' && DATE.test(draft.invoiceDate) && draft.dueDate < draft.invoiceDate) problems.dueDate = 'due';
  const chosen = ticked(draft, rows);
  if (chosen.length === 0) problems.lines = 'lines';
  const lines = chosen.map((r) => {
    const l = draft.lines[r.receiptLineId]!;
    const qty = wholeOf(l.qty);
    if (qty === null || qty < 1) problems[`lines.${r.receiptLineId}.qty`] = 'qty';
    else if (qty > r.invoiceableQty) problems[`lines.${r.receiptLineId}.qty`] = 'exceeds';
    const cost = parseMoney(l.cost, draft.currency);
    if (!cost) problems[`lines.${r.receiptLineId}.cost`] = 'cost';
    if (r.currency !== null && r.currency !== draft.currency) problems.currency = 'currency';
    return { receiptLineId: r.receiptLineId, qtyInvoiced: qty ?? 0, unitCostMinor: cost ? cost.amount.toString() : '0' };
  });
  const adj = parseSignedMoney(draft.adjustment, draft.currency);
  if (adj === null) problems.adjustment = 'adjustment';
  else if (adj !== 0n && draft.adjustmentReason.trim() === '') problems.adjustmentReason = 'reason';
  // An invoice that bills nothing or less than nothing is not an invoice: say so here, as the server would.
  const totals = invoiceTotalsOf(chosen.map((r) => draft.lines[r.receiptLineId]!), draft.adjustment, draft.currency);
  if (totals && totals.totalMinor <= 0n) problems.total = 'total';
  if (Object.keys(problems).length > 0) return { problems };
  return {
    problems,
    input: {
      supplierId: draft.supplierId,
      number: draft.number.trim(),
      invoiceDate: draft.invoiceDate,
      ...(draft.dueDate !== '' ? { dueDate: draft.dueDate } : {}),
      currency: draft.currency,
      adjustmentMinor: (adj ?? 0n).toString(),
      adjustmentReason: draft.adjustmentReason.trim(),
      lines,
    },
  };
}

/** A receipt line as the draft starts it: not ticked, the quantity left to invoice, the receipt cost. */
const startLine = (row: InvoiceableRow, currency: Currency): InvoiceLineDraft => invoiceLinesStart([row], currency)[row.receiptLineId]!;

/**
 * Changes one line of a draft. A draft restored from an earlier visit holds only the receipt lines that existed then; a
 * line it does not know starts from the receipt line instead of from nothing.
 */
export function editLine(draft: InvoiceDraft, row: InvoiceableRow, patch: Partial<InvoiceLineDraft>): InvoiceDraft {
  const current = draft.lines[row.receiptLineId] ?? startLine(row, draft.currency);
  return { ...draft, lines: { ...draft.lines, [row.receiptLineId]: { ...current, ...patch } } };
}

/** Ticks or unticks a line, with the same start for a line the draft has never seen. */
export function tickLine(draft: InvoiceDraft, row: InvoiceableRow, checked: boolean): InvoiceDraft {
  return editLine(draft, row, { checked });
}

/** Every field the server hashes, as typed, ticked lines only and in a fixed order; not the key. */
export function invoiceSignature(draft: InvoiceDraft): string {
  const lines = Object.entries(draft.lines)
    .filter(([, l]) => l.checked)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, l]) => [id, (l.qty ?? '').trim(), (l.cost ?? '').trim()]);
  return JSON.stringify([draft.supplierId, draft.number.trim(), draft.invoiceDate, draft.dueDate, draft.currency, draft.adjustment.trim(), draft.adjustmentReason.trim(), lines]);
}

/** The invoice date plus the supplier's terms; empty while the date is not a date. */
export function dueFrom(invoiceDate: string, termsDays: number): string {
  if (!DATE.test(invoiceDate) || !Number.isSafeInteger(termsDays) || termsDays < 0 || termsDays > 365) return '';
  const ms = Date.parse(`${invoiceDate}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + termsDays * 86_400_000).toISOString().slice(0, 10);
}

// Allocation -----------------------------------------------------------------------------------------------------------

/** An open invoice as the payment and credit screens list it. */
export interface OpenInvoice {
  id: string;
  number: string;
  supplierId: string;
  currency: Currency;
  dueDate: string;
  balanceMinor: bigint;
}

export type AllocationMode = 'auto' | 'explicit';
export type AllocationError = 'AMOUNT' | 'INVALID' | 'UNALLOCATED' | 'OVER_ALLOCATION';

export interface AllocationPreview {
  rows: { invoiceId: string; amountMinor: bigint }[];
  /** What no invoice takes yet (auto: more than all balances; explicit: parts below the amount). */
  leftoverMinor: bigint;
  error: AllocationError | null;
}

const byDue = (a: { dueDate: string; id: string }, b: { dueDate: string; id: string }) =>
  a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Where an amount goes. Auto: the oldest due invoice is paid in full first, then by id, as the domain's `planAllocation`
 * does; explicit: the typed parts, shown with what is left to place. Never throws: the error is a code the screen words.
 */
export function allocationPreview(invoices: readonly OpenInvoice[], amountMinor: bigint, mode: AllocationMode, explicit: Readonly<Record<string, string>>): AllocationPreview {
  if (amountMinor <= 0n) return { rows: [], leftoverMinor: 0n, error: 'AMOUNT' };
  const ordered = [...invoices].sort(byDue);
  if (mode === 'auto') {
    let left = amountMinor;
    const rows: AllocationPreview['rows'] = [];
    for (const inv of ordered) {
      if (inv.balanceMinor <= 0n) continue;
      if (left === 0n) break;
      const part = left < inv.balanceMinor ? left : inv.balanceMinor;
      rows.push({ invoiceId: inv.id, amountMinor: part });
      left -= part;
    }
    return { rows, leftoverMinor: left, error: left > 0n ? 'UNALLOCATED' : null };
  }
  const rows: AllocationPreview['rows'] = [];
  let sum = 0n;
  let over = false;
  for (const inv of ordered) {
    const text = (explicit[inv.id] ?? '').trim();
    if (text === '') continue;
    const money = parseMoney(text, inv.currency);
    if (!money || money.amount > MAX_PART) return { rows, leftoverMinor: 0n, error: 'INVALID' };
    if (money.amount === 0n) continue;
    if (money.amount > inv.balanceMinor) over = true;
    rows.push({ invoiceId: inv.id, amountMinor: money.amount });
    sum += money.amount;
  }
  if (over || sum > amountMinor) return { rows, leftoverMinor: 0n, error: 'OVER_ALLOCATION' };
  const leftover = amountMinor - sum;
  return { rows, leftoverMinor: leftover, error: leftover > 0n ? 'UNALLOCATED' : null };
}

// Payments -------------------------------------------------------------------------------------------------------------

export const PAYMENT_METHODS = ['CASH', 'TRANSFER_MANUAL', 'CHEQUE_MANUAL', 'CARD_MANUAL'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentDraft {
  clientKey: string;
  keySig?: string | undefined;
  method: PaymentMethod;
  amount: string;
  paidOn: string;
  reference: string;
  mode: AllocationMode;
  /** Explicit parts by invoice id, as typed. */
  explicit: Record<string, string>;
}

export function emptyPaymentDraft(clientKey: string, today: string): PaymentDraft {
  return { clientKey, method: 'CASH', amount: '', paidOn: today, reference: '', mode: 'auto', explicit: {} };
}

export type PaymentProblem = 'amount' | 'date' | 'UNALLOCATED' | 'OVER_ALLOCATION' | 'INVALID';

export function paymentInputOf(
  draft: PaymentDraft,
  supplierId: string,
  currency: Currency,
  invoices: readonly OpenInvoice[],
): { input?: Record<string, unknown>; problems: Record<string, PaymentProblem>; preview: AllocationPreview } {
  const problems: Record<string, PaymentProblem> = {};
  const money = parseMoney(draft.amount, currency);
  if (!money || money.amount <= 0n) problems.amount = 'amount';
  if (!DATE.test(draft.paidOn)) problems.paidOn = 'date';
  const preview = money && money.amount > 0n ? allocationPreview(invoices, money.amount, draft.mode, draft.explicit) : { rows: [], leftoverMinor: 0n, error: 'AMOUNT' as const };
  if (money && money.amount > 0n && preview.error) {
    if (draft.mode === 'auto') problems.amount = preview.error === 'UNALLOCATED' ? 'UNALLOCATED' : 'amount';
    else problems.allocations = preview.error === 'AMOUNT' ? 'INVALID' : preview.error;
  }
  if (Object.keys(problems).length > 0 || !money) return { problems, preview };
  return {
    problems,
    preview,
    input: {
      supplierId,
      currency,
      method: draft.method,
      amountMinor: money.amount.toString(),
      paidOn: draft.paidOn,
      reference: draft.reference.trim(),
      ...(draft.mode === 'explicit' ? { allocations: preview.rows.map((r) => ({ invoiceId: r.invoiceId, amountMinor: r.amountMinor.toString() })) } : {}),
    },
  };
}

const explicitEntries = (parts: Readonly<Record<string, string>>) =>
  Object.entries(parts)
    .map(([id, v]) => [id, v.trim()] as const)
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Every field the server hashes, as typed; explicit parts in a fixed order. Not the key. */
export function paymentSignature(draft: PaymentDraft, supplierId: string, currency: Currency): string {
  return JSON.stringify([supplierId, currency, draft.method, draft.amount.trim(), draft.paidOn, draft.reference.trim(), draft.mode, draft.mode === 'explicit' ? explicitEntries(draft.explicit) : []]);
}

/** The key a payment (or credit, return, invoice) is sent with: the saved one while the signature is the same. */
export const keyedAttempt = attemptKeyFor;

// Credit notes ---------------------------------------------------------------------------------------------------------

export interface CreditDraft {
  clientKey: string;
  keySig?: string | undefined;
  supplierId: string;
  number: string;
  currency: Currency;
  amount: string;
  noteDate: string;
  supplierReturnId: string;
  note: string;
}

export function emptyCreditDraft(clientKey: string, currency: Currency, today: string): CreditDraft {
  return { clientKey, supplierId: '', number: '', currency, amount: '', noteDate: today, supplierReturnId: '', note: '' };
}

export type CreditProblem = 'supplier' | 'number' | 'amount' | 'date';

export function creditInputOf(draft: CreditDraft): { input?: Record<string, unknown>; problems: Record<string, CreditProblem> } {
  const problems: Record<string, CreditProblem> = {};
  if (!draft.supplierId) problems.supplierId = 'supplier';
  if (draft.number.trim() === '') problems.number = 'number';
  const money = parseMoney(draft.amount, draft.currency);
  if (!money || money.amount <= 0n) problems.amount = 'amount';
  if (!DATE.test(draft.noteDate)) problems.noteDate = 'date';
  if (Object.keys(problems).length > 0 || !money) return { problems };
  return {
    problems,
    input: {
      supplierId: draft.supplierId,
      number: draft.number.trim(),
      currency: draft.currency,
      amountMinor: money.amount.toString(),
      noteDate: draft.noteDate,
      ...(draft.supplierReturnId ? { supplierReturnId: draft.supplierReturnId } : {}),
      note: draft.note.trim(),
    },
  };
}

export function creditSignature(draft: CreditDraft): string {
  return JSON.stringify([draft.supplierId, draft.number.trim(), draft.currency, draft.amount.trim(), draft.noteDate, draft.supplierReturnId, draft.note.trim()]);
}

/** Applying a credit note: the same shape as a payment without method, date or reference. */
export interface ApplyDraft {
  clientKey: string;
  keySig?: string | undefined;
  mode: AllocationMode;
  explicit: Record<string, string>;
}

export function applySignature(draft: ApplyDraft, creditNoteId: string): string {
  return JSON.stringify([creditNoteId, draft.mode, draft.mode === 'explicit' ? explicitEntries(draft.explicit) : []]);
}

/**
 * Applying credit: auto spends it oldest due first and may leave some unspent; explicit parts may not exceed what is left.
 * Returns the action input (`allocations` only in explicit mode) or the error code for the screen.
 */
export function applyInputOf(
  draft: ApplyDraft,
  creditNoteId: string,
  availableMinor: bigint,
  invoices: readonly OpenInvoice[],
): { input?: Record<string, unknown>; error: AllocationError | null; preview: AllocationPreview } {
  if (draft.mode === 'auto') {
    const total = invoices.reduce((s, i) => s + (i.balanceMinor > 0n ? i.balanceMinor : 0n), 0n);
    const spend = availableMinor < total ? availableMinor : total;
    if (spend <= 0n) return { error: 'AMOUNT', preview: { rows: [], leftoverMinor: 0n, error: 'AMOUNT' } };
    const preview = allocationPreview(invoices, spend, 'auto', {});
    return { input: { creditNoteId }, error: null, preview };
  }
  const typed = invoices.reduce((s, i) => {
    const m = parseMoney(draft.explicit[i.id] ?? '', i.currency);
    return s + (m ? m.amount : 0n);
  }, 0n);
  if (typed <= 0n) return { error: 'AMOUNT', preview: { rows: [], leftoverMinor: 0n, error: 'AMOUNT' } };
  const preview = allocationPreview(invoices, typed, 'explicit', draft.explicit);
  if (preview.error) return { error: preview.error, preview };
  if (typed > availableMinor) return { error: 'OVER_ALLOCATION', preview };
  return {
    input: { creditNoteId, allocations: preview.rows.map((r) => ({ invoiceId: r.invoiceId, amountMinor: r.amountMinor.toString() })) },
    error: null,
    preview,
  };
}

// Supplier returns -----------------------------------------------------------------------------------------------------

export interface ReturnLineDraft {
  batchId: string;
  bucket: 'AVAILABLE' | 'QUARANTINE';
  /** Whole base units, as typed. */
  qty: string;
  /** What the screen saw in that bucket when the line was added; the server decides again. */
  max: number;
  productName: string;
  lot: string;
  expiry: string;
}

export interface ReturnDraft {
  clientKey: string;
  keySig?: string | undefined;
  supplierId: string;
  reason: string;
  note: string;
  lines: ReturnLineDraft[];
}

export function emptyReturnDraft(clientKey: string): ReturnDraft {
  return { clientKey, supplierId: '', reason: '', note: '', lines: [] };
}

/** Adds a line unless that batch and bucket is already on the return. */
export function addReturnLine(lines: readonly ReturnLineDraft[], line: ReturnLineDraft): ReturnLineDraft[] {
  return lines.some((l) => l.batchId === line.batchId && l.bucket === line.bucket) ? [...lines] : [...lines, line];
}

export type ReturnProblem = 'supplier' | 'reason' | 'lines' | 'qty' | 'exceeds' | 'duplicate';

export function returnInputOf(draft: ReturnDraft): { input?: Record<string, unknown>; problems: Record<string, ReturnProblem> } {
  const problems: Record<string, ReturnProblem> = {};
  if (!draft.supplierId) problems.supplierId = 'supplier';
  if (draft.reason.trim().length < 3) problems.reason = 'reason';
  if (draft.lines.length === 0) problems.lines = 'lines';
  const seen = new Set<string>();
  const lines = draft.lines.map((l, i) => {
    const qty = wholeOf(l.qty);
    if (qty === null || qty < 1) problems[`lines.${i}.qty`] = 'qty';
    else if (qty > l.max) problems[`lines.${i}.qty`] = 'exceeds';
    const pair = `${l.batchId}|${l.bucket}`;
    if (seen.has(pair)) problems[`lines.${i}.batchId`] = 'duplicate';
    seen.add(pair);
    return { batchId: l.batchId, bucket: l.bucket, qty: qty ?? 0 };
  });
  if (Object.keys(problems).length > 0) return { problems };
  return { problems, input: { supplierId: draft.supplierId, reason: draft.reason.trim(), note: draft.note.trim(), lines } };
}

/** Every field the server hashes, as typed; not the key and not what the screen only displays. */
export function returnSignature(draft: ReturnDraft): string {
  return JSON.stringify([draft.supplierId, draft.reason.trim(), draft.note.trim(), draft.lines.map((l) => [l.batchId, l.bucket, l.qty.trim()])]);
}

// Reason actions (void, reverse) ----------------------------------------------------------------------------------------

/** The key of a reason action: kept while the reason is unchanged (a retry after a lost answer replays), new after an edit. */
export function reasonAttempt(
  draft: { clientKey: string; keySig?: string | undefined; reason: string },
  make: (prefix: string) => string,
  prefix = 'rv',
): { clientKey: string; keySig: string } {
  return attemptKeyFor(draft, draft.reason.trim(), prefix, make);
}

// Payables -------------------------------------------------------------------------------------------------------------

export interface CurrencyGroup<T> {
  currency: Currency;
  items: T[];
  totalMinor: bigint;
}

/** Items by currency, each with its own total; two currencies are never added. */
export function groupByCurrency<T extends { currency: Currency; balanceMinor: bigint }>(items: readonly T[]): CurrencyGroup<T>[] {
  const groups = new Map<Currency, CurrencyGroup<T>>();
  for (const item of items) {
    const group = groups.get(item.currency) ?? { currency: item.currency, items: [], totalMinor: 0n };
    group.items.push(item);
    group.totalMinor += item.balanceMinor;
    groups.set(item.currency, group);
  }
  return [...groups.values()];
}

export function selectionTotals<T extends { id: string; currency: Currency; balanceMinor: bigint }>(items: readonly T[], selected: ReadonlySet<string>): CurrencyGroup<T>[] {
  return groupByCurrency(items.filter((i) => selected.has(i.id)));
}

export type PaySelected = { ok: true; supplierId: string; currency: Currency; ids: string[] } | { ok: false; reason: 'none' | 'supplier' | 'currency' };

/** "Pay selected" is for invoices of one supplier and one currency. */
export function canPaySelected(items: readonly OpenInvoice[], selected: ReadonlySet<string>): PaySelected {
  const chosen = items.filter((i) => selected.has(i.id));
  const first = chosen[0];
  if (!first) return { ok: false, reason: 'none' };
  if (chosen.some((i) => i.supplierId !== first.supplierId)) return { ok: false, reason: 'supplier' };
  if (chosen.some((i) => i.currency !== first.currency)) return { ok: false, reason: 'currency' };
  return { ok: true, supplierId: first.supplierId, currency: first.currency, ids: chosen.map((i) => i.id) };
}

export const BANDS: readonly DueBand[] = ['OVERDUE_60_PLUS', 'OVERDUE_31_60', 'OVERDUE_1_30', 'DUE_7', 'NOT_DUE'];

// Statement CSV --------------------------------------------------------------------------------------------------------

export interface CsvRow {
  date: string;
  ref: string;
  kind: string;
  amountMinor: string;
  balanceMinor: string;
}

const csvText = (value: string): string => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csvAmount = (minor: string, currency: Currency): string => {
  try {
    return minorText(BigInt(minor), currency);
  } catch {
    return '';
  }
};

/** A statement as CSV for a spreadsheet: a UTF-8 BOM so Excel reads Arabic, CRLF lines, amounts with the currency's digits and no grouping. */
export function statementCsv(
  rows: readonly CsvRow[],
  currency: Currency,
  labels: { date: string; ref: string; kind: string; amount: string; balance: string },
  extra: { opening?: string; closing?: string; openingLabel?: string; closingLabel?: string },
): string {
  const out: string[] = [[labels.date, labels.ref, labels.kind, labels.amount, labels.balance].map(csvText).join(',')];
  if (extra.opening !== undefined) out.push(['', csvText(extra.openingLabel ?? ''), '', '', csvAmount(extra.opening, currency)].join(','));
  for (const r of rows) out.push([csvText(r.date), csvText(r.ref), csvText(r.kind), csvAmount(r.amountMinor, currency), csvAmount(r.balanceMinor, currency)].join(','));
  if (extra.closing !== undefined) out.push(['', csvText(extra.closingLabel ?? ''), '', '', csvAmount(extra.closing, currency)].join(','));
  return `﻿${out.join('\r\n')}`;
}
