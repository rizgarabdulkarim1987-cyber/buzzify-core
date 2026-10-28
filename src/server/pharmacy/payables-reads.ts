import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import {
  buildStatement,
  dayDiff,
  daysOverdue,
  dueBand,
  dueDate as addDays,
  shownNumber,
  statementInvariant,
  type DueBand,
  type StatementInput as StatementRowInput,
  type StatementKind,
} from '@/server/domain/pharmacy/purchasing';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';

/**
 * What the business owes its suppliers, read from the stored records (R4-5, R4-8, R4-12). Three reads, none of which writes:
 * the supplier statement (rows in one currency over a date range with an opening balance, a running balance, the closing
 * balance and a check of it against the invoice counters), the payables list (open invoices with their due band, totals over
 * every matching invoice) and the supplier balances (one row per supplier and currency). Everything here belongs to the
 * business: any `purchase.manage` holder at any branch sees the same figures. Sums are bigint, in SQL where they span many
 * rows. Money keys are present only for a role with `cost.view`; the counts are not money and always are.
 *
 * Statement dates are UTC calendar days: an invoice stands on its `invoiceDate`, a payment or its reversal on `paidOn`, a
 * credit note on `noteDate`, and a void on the day of `voidedAt`. Within a day rows keep the order they were made in.
 */

/** 366 days apart (to - from), so a range of one calendar year that holds 29 February is allowed. */
const MAX_RANGE_DAYS = 366;
export const PAYABLES_PAGE = 50;
export const BALANCES_LIMIT = 200;
const DAY_MS = 86_400_000;

const idText = z.string().min(1).max(64);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (date: string) => new Date(`${date}T00:00:00.000Z`);
const shift = (date: string, days: number) => iso(new Date(midnight(date).getTime() + days * DAY_MS));
const dateText = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(midnight(v)) === v, 'Enter a date as YYYY-MM-DD');
const currencyEnum = z.enum(['IQD', 'USD'], 'Choose IQD or USD');
const rowsOnly = z.enum(['rows']).optional();

const BANDS = ['NOT_DUE', 'DUE_7', 'OVERDUE_1_30', 'OVERDUE_31_60', 'OVERDUE_60_PLUS'] as const;
const OVERDUE_BANDS: readonly DueBand[] = ['OVERDUE_1_30', 'OVERDUE_31_60', 'OVERDUE_60_PLUS'];
const OWING = ['OPEN', 'PARTIAL'] as const;
const KINDS: readonly StatementKind[] = ['INVOICE', 'PAYMENT', 'PAYMENT_REVERSAL', 'CREDIT_NOTE', 'INVOICE_VOID'];

export const statementInput = z.object({ supplierId: idText, currency: currencyEnum, from: dateText, to: dateText, format: rowsOnly });
export type StatementInput = z.infer<typeof statementInput>;

export const payablesInput = z.object({
  supplierId: idText.optional(),
  currency: currencyEnum.optional(),
  band: z.enum(BANDS).optional(),
  overdueOnly: z.boolean().optional(),
  cursor: z.string().min(1).max(64).nullish(),
  take: z.number().int().min(1).max(PAYABLES_PAGE).default(PAYABLES_PAGE),
  format: rowsOnly,
});
export type PayablesInput = z.input<typeof payablesInput>;

export const balancesInput = z.object({ currency: currencyEnum.optional(), onlyOwed: z.boolean().optional(), format: rowsOnly });
export type BalancesInput = z.input<typeof balancesInput>;

const invalid = (field: string, message: string) => new StudioError('INVALID', message, { [field]: message });
const supplierNotFound = () => new StudioError('NOT_FOUND', 'Supplier not found');

// Statement -------------------------------------------------------------------------------------------------------------

export interface StatementRowView {
  /** Unique within the statement (a voided invoice has a row for the invoice and one for the void). */
  id: string;
  /** The invoice, payment or credit note the row comes from. */
  recordId: string;
  entity: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE';
  kind: StatementKind;
  date: string;
  ref: string;
  amountMinor?: string;
  balanceMinor?: string;
}

export interface StatementView {
  supplier: { id: string; name: string; archived: boolean };
  currency: 'IQD' | 'USD';
  from: string;
  to: string;
  counts: Record<StatementKind, number>;
  rows: StatementRowView[];
  opening?: string;
  closing?: string;
  totalsByKind?: Record<StatementKind, string>;
  /** Null when `to` is before today: the check compares today's counters with the balance as of today. */
  invariant?: { ok: boolean; difference: string } | null;
}

type DateWindow = { gte?: Date; lt?: Date };

/** The signed effect on the balance of every record of one supplier and currency whose statement day lies in the window (a day, `lt` exclusive). */
async function netEffect(scoped: ScopedClient, supplierId: string, currency: 'IQD' | 'USD', window: DateWindow): Promise<bigint> {
  const bySupplier = { supplierId, currency };
  const [invoiced, voided, paid, reversed, credited] = await Promise.all([
    scoped.phSupplierInvoice.aggregate({ where: { ...bySupplier, invoiceDate: window }, _sum: { totalMinor: true } }),
    scoped.phSupplierInvoice.aggregate({ where: { ...bySupplier, status: 'VOID', voidedAt: window }, _sum: { totalMinor: true } }),
    scoped.phSupplierPayment.aggregate({ where: { ...bySupplier, isReversal: false, paidOn: window }, _sum: { amountMinor: true } }),
    scoped.phSupplierPayment.aggregate({ where: { ...bySupplier, isReversal: true, paidOn: window }, _sum: { amountMinor: true } }),
    scoped.phCreditNote.aggregate({ where: { ...bySupplier, noteDate: window }, _sum: { amountMinor: true } }),
  ]);
  const sum = (r: { _sum: Record<string, bigint | null> }, key: string) => r._sum[key] ?? 0n;
  return sum(invoiced, 'totalMinor') - sum(voided, 'totalMinor') - sum(paid, 'amountMinor') + sum(reversed, 'amountMinor') - sum(credited, 'amountMinor');
}

interface Entry {
  id: string;
  rowId: string;
  entity: StatementRowView['entity'];
  kind: StatementKind;
  day: string;
  stamp: number;
  ref: string;
  amountMinor: bigint;
}

/**
 * One supplier's statement in one currency: the balance before `from`, every record of the range in day order with a running
 * balance, and the closing balance. When `to` is today or later the closing balance (moved to today by anything dated after
 * `to`) is checked against the invoices: open balances minus unapplied credit. A constant number of statements however many rows.
 */
export async function supplierStatement(scoped: ScopedClient, ph: PhActor, input: StatementInput): Promise<StatementView> {
  const { from, to, currency } = input;
  if (from > to) throw invalid('from', 'The start date is after the end date');
  if (dayDiff(to, from) > MAX_RANGE_DAYS) throw invalid('to', 'Use a range of at most one year');
  const supplier = await scoped.phSupplier.findFirst({ where: { id: input.supplierId }, select: { id: true, name: true, active: true } });
  if (!supplier) throw supplierNotFound();

  const today = utcToday();
  const [lo, after] = [midnight(from), midnight(addDays(to, 1))];
  const bySupplier = { supplierId: supplier.id, currency };
  const inRange = { gte: lo, lt: after };
  const [invoices, voids, payments, notes, opening] = await Promise.all([
    scoped.phSupplierInvoice.findMany({ where: { ...bySupplier, invoiceDate: inRange }, select: { id: true, numberRaw: true, invoiceDate: true, totalMinor: true, createdAt: true } }),
    scoped.phSupplierInvoice.findMany({ where: { ...bySupplier, status: 'VOID', voidedAt: inRange }, select: { id: true, numberRaw: true, totalMinor: true, voidedAt: true } }),
    scoped.phSupplierPayment.findMany({ where: { ...bySupplier, paidOn: inRange }, select: { id: true, reference: true, reversesId: true, isReversal: true, amountMinor: true, paidOn: true, createdAt: true } }),
    scoped.phCreditNote.findMany({ where: { ...bySupplier, noteDate: inRange }, select: { id: true, number: true, amountMinor: true, noteDate: true, createdAt: true } }),
    netEffect(scoped, supplier.id, currency, { lt: lo }),
  ]);

  // A reversal's own reference is the reason given (free text): the statement shows the payment it undid instead.
  const reversed = [...new Set(payments.flatMap((r) => (r.reversesId ? [r.reversesId] : [])))];
  const originals = new Map(
    reversed.length === 0 ? [] : (await scoped.phSupplierPayment.findMany({ where: { id: { in: reversed } }, select: { id: true, reference: true } })).map((r) => [r.id, r.reference] as const),
  );
  const entries: Entry[] = [
    ...invoices.map((r): Entry => ({ id: r.id, rowId: r.id, entity: 'INVOICE', kind: 'INVOICE', day: iso(r.invoiceDate), stamp: r.createdAt.getTime(), ref: r.numberRaw, amountMinor: r.totalMinor })),
    ...voids.map((r): Entry => ({ id: r.id, rowId: `${r.id}#void`, entity: 'INVOICE', kind: 'INVOICE_VOID', day: iso(r.voidedAt!), stamp: r.voidedAt!.getTime(), ref: r.numberRaw, amountMinor: r.totalMinor })),
    ...payments.map((r): Entry => ({ id: r.id, rowId: r.id, entity: 'PAYMENT', kind: r.isReversal ? 'PAYMENT_REVERSAL' : 'PAYMENT', day: iso(r.paidOn), stamp: r.createdAt.getTime(), ref: r.reversesId ? (originals.get(r.reversesId) ?? '') : r.reference, amountMinor: r.amountMinor })),
    ...notes.map((r): Entry => ({ id: r.id, rowId: r.id, entity: 'CREDIT_NOTE', kind: 'CREDIT_NOTE', day: iso(r.noteDate), stamp: r.createdAt.getTime(), ref: r.number, amountMinor: r.amountMinor })),
  ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.stamp - b.stamp || (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0)));

  const built = buildStatement({
    openingMinor: opening,
    rows: entries.map((e): StatementRowInput => ({ at: midnight(e.day), kind: e.kind, amountMinor: e.amountMinor, ref: e.ref })),
  });
  const counts = Object.fromEntries(KINDS.map((k) => [k, entries.filter((e) => e.kind === k).length])) as Record<StatementKind, number>;
  const withCost = mayViewCost(ph);
  const rows = entries.map((e, n): StatementRowView => ({
    id: e.rowId,
    recordId: e.id,
    entity: e.entity,
    kind: e.kind,
    date: e.day,
    ref: shownNumber(e.ref),
    ...(withCost ? { amountMinor: e.amountMinor.toString(), balanceMinor: built.rows[n]!.balanceMinor.toString() } : {}),
  }));
  const view: StatementView = { supplier: { id: supplier.id, name: supplier.name, archived: !supplier.active }, currency, from, to, counts, rows };
  if (!withCost) return view;

  view.opening = built.openingMinor.toString();
  view.closing = built.closingMinor.toString();
  view.totalsByKind = Object.fromEntries(KINDS.map((k) => [k, built.totals[k].toString()])) as Record<StatementKind, string>;
  view.invariant = to < today ? null : await checkInvariant(scoped, view, built.closingMinor, after);
  return view;
}

/** The closing balance moved to today (by what is dated after `to`) against the open invoices' balances less the credit nobody has used. */
async function checkInvariant(scoped: ScopedClient, view: StatementView, closing: bigint, after: Date): Promise<{ ok: boolean; difference: string }> {
  const { supplier, currency } = view;
  const bySupplier = { supplierId: supplier.id, currency };
  const [later, open, unapplied] = await Promise.all([
    netEffect(scoped, supplier.id, currency, { gte: after }),
    scoped.phSupplierInvoice.aggregate({ where: { ...bySupplier, status: { in: [...OWING] } }, _sum: { totalMinor: true, paidMinor: true, creditedMinor: true } }),
    // The comparison of two columns is not expressible in a Prisma aggregate.
    // eslint-disable-next-line no-restricted-properties -- a sum over this supplier's own credit notes (restaurant bound through the supplier read just before)
    scoped.$queryRaw<{ unapplied: bigint }[]>`
      SELECT COALESCE(SUM("amountMinor" - "appliedMinor"), 0)::bigint AS "unapplied" FROM "PhCreditNote"
      WHERE "supplierId" = ${supplier.id} AND "currency" = ${currency}::"Currency"`,
  ]);
  const balance = (open._sum.totalMinor ?? 0n) - (open._sum.paidMinor ?? 0n) - (open._sum.creditedMinor ?? 0n);
  const check = statementInvariant(closing + later, [{ balanceMinor: balance }], unapplied[0]?.unapplied ?? 0n);
  return { ok: check.ok, difference: check.difference.toString() };
}

// Payables list ---------------------------------------------------------------------------------------------------------

export interface PayableItem {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  currency: 'IQD' | 'USD';
  invoiceDate: string;
  dueDate: string;
  status: 'OPEN' | 'PARTIAL';
  dueBand: DueBand;
  daysOverdue: number;
  totalMinor?: string;
  paidMinor?: string;
  creditedMinor?: string;
  balanceMinor?: string;
}

export interface PayableTotals {
  currency: 'IQD' | 'USD';
  count: number;
  bands: Record<DueBand, { count: number; balanceMinor?: string }>;
  balanceMinor?: string;
  overdueMinor?: string;
}

/** The due dates a band stands for, as a filter on the due date, relative to `today`. */
function dueWindow(band: DueBand, today: string): { gte?: Date; lt?: Date } {
  const day = (n: number) => midnight(shift(today, n));
  switch (band) {
    case 'NOT_DUE':
      return { gte: day(8) };
    case 'DUE_7':
      return { gte: day(0), lt: day(8) };
    case 'OVERDUE_1_30':
      return { gte: day(-30), lt: day(0) };
    case 'OVERDUE_31_60':
      return { gte: day(-60), lt: day(-30) };
    case 'OVERDUE_60_PLUS':
      return { lt: day(-60) };
  }
}

/**
 * Open (OPEN or PARTIAL) invoices, oldest due date first (id breaks ties, so a page never moves under the cursor), with the
 * balance `total - paid - credited`, the due band and the days overdue. `totals` cover every invoice that matches the filters,
 * per currency and per band (summed in SQL), not just the page. Void and paid invoices are not payable.
 */
export async function listPayables(scoped: ScopedClient, ph: PhActor, input: PayablesInput): Promise<{ items: PayableItem[]; nextCursor: string | null; totals: PayableTotals[] }> {
  const today = utcToday();
  const take = input.take ?? PAYABLES_PAGE;
  const window = input.band ? dueWindow(input.band, today) : null;
  const base = {
    status: { in: [...OWING] },
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    AND: [...(window ? [{ dueDate: window }] : []), ...(input.overdueOnly ? [{ dueDate: { lt: midnight(today) } }] : [])],
  };
  // The page continues after the cursor invoice's (dueDate, id), read without the filters: that invoice may have been paid or
  // credited since the last page, and a cursor that is itself filtered out must not make the next page skip or lose a row.
  let afterCursor: object[] = [];
  if (input.cursor) {
    const at = await scoped.phSupplierInvoice.findFirst({ where: { id: input.cursor }, select: { id: true, dueDate: true } });
    if (!at) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    afterCursor = [{ OR: [{ dueDate: { gt: at.dueDate } }, { dueDate: at.dueDate, id: { gt: at.id } }] }];
  }
  const [rows, groups] = await Promise.all([
    scoped.phSupplierInvoice.findMany({
      where: { ...base, AND: [...base.AND, ...afterCursor] },
      include: { supplier: { select: { name: true } } },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: take + 1,
    }),
    scoped.phSupplierInvoice.groupBy({ by: ['currency', 'dueDate'], where: base, _count: { _all: true }, _sum: { totalMinor: true, paidMinor: true, creditedMinor: true } }),
  ]);
  const withCost = mayViewCost(ph);
  const more = rows.length > take;
  const page = more ? rows.slice(0, take) : rows;

  const items = page.map((r): PayableItem => ({
    id: r.id,
    number: shownNumber(r.number),
    supplierId: r.supplierId,
    supplierName: r.supplier.name,
    currency: r.currency,
    invoiceDate: iso(r.invoiceDate),
    dueDate: iso(r.dueDate),
    status: r.status as 'OPEN' | 'PARTIAL',
    dueBand: dueBand(r.dueDate, today),
    daysOverdue: daysOverdue(r.dueDate, today),
    ...(withCost
      ? { totalMinor: r.totalMinor.toString(), paidMinor: r.paidMinor.toString(), creditedMinor: r.creditedMinor.toString(), balanceMinor: (r.totalMinor - r.paidMinor - r.creditedMinor).toString() }
      : {}),
  }));

  const byCurrency = new Map<'IQD' | 'USD', { count: number; bands: Record<DueBand, { count: number; balance: bigint }> }>();
  for (const g of groups) {
    const entry = byCurrency.get(g.currency) ?? { count: 0, bands: Object.fromEntries(BANDS.map((b) => [b, { count: 0, balance: 0n }])) as Record<DueBand, { count: number; balance: bigint }> };
    const band = entry.bands[dueBand(g.dueDate, today)];
    band.count += g._count._all;
    band.balance += (g._sum.totalMinor ?? 0n) - (g._sum.paidMinor ?? 0n) - (g._sum.creditedMinor ?? 0n);
    entry.count += g._count._all;
    byCurrency.set(g.currency, entry);
  }
  const totals = [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, t]): PayableTotals => {
      const bands = Object.fromEntries(BANDS.map((b) => [b, { count: t.bands[b].count, ...(withCost ? { balanceMinor: t.bands[b].balance.toString() } : {}) }])) as PayableTotals['bands'];
      const sum = (list: readonly DueBand[]) => list.reduce((acc, b) => acc + t.bands[b].balance, 0n);
      return { currency, count: t.count, bands, ...(withCost ? { balanceMinor: sum(BANDS).toString(), overdueMinor: sum(OVERDUE_BANDS).toString() } : {}) };
    });
  return { items, nextCursor: more ? page[page.length - 1]!.id : null, totals };
}

// Balances --------------------------------------------------------------------------------------------------------------

export interface BalanceItem {
  supplierId: string;
  supplierName: string;
  archived: boolean;
  currency: 'IQD' | 'USD';
  openInvoices: number;
  oldestDueDate: string | null;
  openMinor?: string;
  unappliedCreditMinor?: string;
  netOwedMinor?: string;
  overdueMinor?: string;
}

interface BalanceRow {
  supplierId: string;
  name: string;
  active: boolean;
  currency: 'IQD' | 'USD';
  open: bigint;
  overdue: bigint;
  oldest: Date | null;
  n: number;
  unapplied: bigint;
}

/**
 * One row per supplier and currency that has an open invoice or credit nobody has used: open balance, unapplied credit, net
 * owed (open less credit, negative when the supplier owes the business), what is overdue and the oldest due date. One SQL
 * statement for all suppliers; archived suppliers are included. At most 200 rows, with `hasMore` when there are more.
 */
export async function listBalances(scoped: ScopedClient, ph: PhActor, input: BalancesInput): Promise<{ items: BalanceItem[]; hasMore: boolean }> {
  const today = utcToday();
  const restaurantId = ph.restaurantId;
  const currency = input.currency ?? null;
  const onlyOwed = input.onlyOwed ?? false;
  // Sums of two columns grouped by supplier cannot be written as a Prisma query; every table is bound to this restaurant.
  // eslint-disable-next-line no-restricted-properties -- a read-only aggregation over this business's own invoices and credit notes, restaurantId bound in each part
  const found = await scoped.$queryRaw<BalanceRow[]>`
    WITH "o" AS (
      SELECT "supplierId", "currency",
             SUM("totalMinor" - "paidMinor" - "creditedMinor")::bigint AS "open",
             COALESCE(SUM(CASE WHEN "dueDate" < ${today}::date THEN "totalMinor" - "paidMinor" - "creditedMinor" ELSE 0 END), 0)::bigint AS "overdue",
             MIN("dueDate") AS "oldest",
             COUNT(*)::int AS "n"
      FROM "PhSupplierInvoice"
      WHERE "restaurantId" = ${restaurantId} AND "status" IN ('OPEN', 'PARTIAL')
      GROUP BY "supplierId", "currency"
    ), "c" AS (
      SELECT "supplierId", "currency", SUM("amountMinor" - "appliedMinor")::bigint AS "unapplied"
      FROM "PhCreditNote"
      WHERE "restaurantId" = ${restaurantId}
      GROUP BY "supplierId", "currency"
      HAVING SUM("amountMinor" - "appliedMinor") > 0
    ), "x" AS (
      SELECT COALESCE("o"."supplierId", "c"."supplierId") AS "supplierId", COALESCE("o"."currency", "c"."currency") AS "currency",
             COALESCE("o"."open", 0)::bigint AS "open", COALESCE("o"."overdue", 0)::bigint AS "overdue", "o"."oldest", COALESCE("o"."n", 0) AS "n",
             COALESCE("c"."unapplied", 0)::bigint AS "unapplied"
      FROM "o" FULL OUTER JOIN "c" ON "o"."supplierId" = "c"."supplierId" AND "o"."currency" = "c"."currency"
    )
    SELECT "s"."id" AS "supplierId", "s"."name", "s"."active", "x"."currency"::text AS "currency", "x"."open", "x"."overdue", "x"."oldest", "x"."n", "x"."unapplied"
    FROM "x" JOIN "PhSupplier" "s" ON "s"."id" = "x"."supplierId" AND "s"."restaurantId" = ${restaurantId}
    WHERE (${currency}::text IS NULL OR "x"."currency"::text = ${currency})
      AND (NOT ${onlyOwed}::boolean OR "x"."open" - "x"."unapplied" > 0)
    ORDER BY "s"."name", "s"."id", "x"."currency"::text
    LIMIT ${BALANCES_LIMIT + 1}`;
  const withCost = mayViewCost(ph);
  const items = found.slice(0, BALANCES_LIMIT).map((r): BalanceItem => ({
    supplierId: r.supplierId,
    supplierName: r.name,
    archived: !r.active,
    currency: r.currency,
    openInvoices: r.n,
    oldestDueDate: r.oldest ? iso(r.oldest) : null,
    ...(withCost
      ? { openMinor: r.open.toString(), unappliedCreditMinor: r.unapplied.toString(), netOwedMinor: (r.open - r.unapplied).toString(), overdueMinor: r.overdue.toString() }
      : {}),
  }));
  return { items, hasMore: found.length > BALANCES_LIMIT };
}
