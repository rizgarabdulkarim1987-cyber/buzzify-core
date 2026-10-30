import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { ageingBuckets, type AgeingBucket } from '@/server/domain/pharmacy/credit';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { baghdadDay, baghdadWindow, ReportsError, validDay } from '@/server/domain/pharmacy/reports-domain';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { assertCustomerAccess, assertCustomerManager, CUSTOMER_PAGE, type CustomerListInput } from './customers';
import { cleanText } from './suppliers';

/**
 * Reading customers and their accounts (phase 7, R7-5). Nothing here writes. A holder of `customer.manage` or `credit.sell`
 * lists customers with their limit and balance; the phone and the note are shown only with `customer.manage`. Statements and
 * ageing need `customer.manage`. Balances are sums of ledger rows (never stored), in the customer's own currency: nothing is
 * ever summed across currencies. Statement days are Baghdad days (UTC+3).
 */

const idText = z.string().min(1).max(64);
const dayText = z.string().trim().refine(validDay, 'Enter a date as YYYY-MM-DD');
export const STATEMENT_PAGE = 100;

export const customerGetInput = z.object({ customerId: idText });

export const statementInput = z.object({
  customerId: idText,
  from: dayText,
  to: dayText,
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number().int().min(1).max(200).default(STATEMENT_PAGE),
});
export type StatementInput = z.input<typeof statementInput>;

export const ageingInput = z.object({ customerId: idText.optional(), asOf: dayText.optional() });
export type AgeingInput = z.input<typeof ageingInput>;

export interface CustomerView {
  id: string;
  name: string;
  /** Only for `customer.manage`. */
  phone?: string | null;
  note?: string;
  currency: 'IQD' | 'USD';
  creditLimitMinor: string;
  balanceMinor: string;
  /** The room left under the limit (0 when at or above it). */
  availableMinor: string;
  active: boolean;
  version: number;
  createdAt: string;
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  note: string;
  currency: 'IQD' | 'USD';
  creditLimitMinor: bigint;
  active: boolean;
  version: number;
  createdAt: Date;
}

const SELECT = { id: true, name: true, phone: true, note: true, currency: true, creditLimitMinor: true, active: true, version: true, createdAt: true } as const;

function viewOf(row: CustomerRow, balance: bigint, manager: boolean): CustomerView {
  const room = row.creditLimitMinor - balance;
  return {
    id: row.id,
    name: row.name,
    ...(manager ? { phone: row.phone, note: row.note } : {}),
    currency: row.currency,
    creditLimitMinor: String(row.creditLimitMinor),
    balanceMinor: String(balance),
    availableMinor: String(room > 0n ? room : 0n),
    active: row.active,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

const mayManage = (ph: PhActor) => ph.role !== null && canPh(ph.role, 'customer.manage');

async function balancesOf(scoped: ScopedClient, ids: readonly string[]): Promise<Map<string, bigint>> {
  if (ids.length === 0) return new Map();
  const sums = await scoped.phCustomerLedger.groupBy({ by: ['customerId'], where: { customerId: { in: [...ids] } }, _sum: { amountMinor: true } });
  return new Map(sums.map((s) => [s.customerId, s._sum.amountMinor ?? 0n]));
}

/** One page of customers by name: live ones unless told otherwise, matching the search in the name (or the phone, for a manager). */
export async function listCustomers(scoped: ScopedClient, ph: PhActor, input: CustomerListInput): Promise<{ items: CustomerView[]; nextCursor: string | null }> {
  assertCustomerAccess(ph);
  const manager = mayManage(ph);
  const search = input.search ? cleanText(input.search) : '';
  let owingIds: string[] | null = null;
  if (input.owingOnly) {
    const owing = await scoped.phCustomerLedger.groupBy({ by: ['customerId'], having: { amountMinor: { _sum: { gt: 0n } } } });
    owingIds = owing.map((o) => o.customerId);
  }
  const rows = await scoped.phCustomer.findMany({
    where: {
      ...(input.active === 'all' ? {} : { active: input.active }),
      ...(owingIds ? { id: { in: owingIds } } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, ...(manager ? [{ phone: { contains: search } }] : [])] } : {}),
    },
    select: SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: CUSTOMER_PAGE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 0 } : {}),
  });
  const page = rows.slice(0, CUSTOMER_PAGE);
  const balances = await balancesOf(scoped, page.map((r) => r.id));
  return { items: page.map((r) => viewOf(r, balances.get(r.id) ?? 0n, manager)), nextCursor: rows.length > CUSTOMER_PAGE ? rows[CUSTOMER_PAGE]!.id : null };
}

export async function getCustomer(scoped: ScopedClient, ph: PhActor, customerId: string): Promise<CustomerView> {
  assertCustomerAccess(ph);
  const row = await scoped.phCustomer.findFirst({ where: { id: customerId }, select: SELECT });
  if (!row) throw new StudioError('NOT_FOUND', 'Customer not found');
  const balances = await balancesOf(scoped, [row.id]);
  return viewOf(row, balances.get(row.id) ?? 0n, mayManage(ph));
}

// Statement -----------------------------------------------------------------------------------------------------------

export interface StatementRowView {
  id: string;
  kind: 'CHARGE' | 'PAYMENT' | 'REVERSAL' | 'REFUND';
  /** The Baghdad day. */
  day: string;
  at: string;
  amountMinor: string;
  balanceMinor: string;
  saleId: string | null;
  saleNumber: string | null;
  paymentId: string | null;
  method: 'CASH' | 'CARD' | 'TRANSFER' | null;
  /** For a PAYMENT row: it was already corrected (a payment is corrected once). */
  corrected: boolean;
}

export interface StatementView {
  customer: { id: string; name: string; currency: 'IQD' | 'USD'; active: boolean };
  from: string;
  to: string;
  openingMinor: string;
  closingMinor: string;
  /** Totals of the whole range (not just this page) by kind. */
  totalsByKind: Record<StatementRowView['kind'], string>;
  rows: StatementRowView[];
  nextCursor: string | null;
}

function windowOf(from: string, to: string) {
  try {
    return baghdadWindow(from, to);
  } catch (error) {
    if (error instanceof ReportsError) {
      const message = error.code === 'RANGE_TOO_LONG' ? 'Use a range of at most one year' : error.code === 'FROM_AFTER_TO' ? 'The start date is after the end date' : 'Enter a date as YYYY-MM-DD';
      throw new StudioError('INVALID', message, { [error.code === 'FROM_AFTER_TO' ? 'from' : 'to']: message });
    }
    throw error;
  }
}

/**
 * One customer's ledger over `from..to` (Baghdad days, at most 366), oldest first, by cursor (the last row's id), each row with
 * the running balance. The opening balance is everything before `from`; the closing balance is the opening plus the whole range.
 * A constant number of statements however long the page.
 */
export async function customerStatement(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof statementInput>): Promise<StatementView> {
  assertCustomerManager(ph);
  const window = windowOf(input.from, input.to);
  const customer = await scoped.phCustomer.findFirst({ where: { id: input.customerId }, select: { id: true, name: true, currency: true, active: true } });
  if (!customer) throw new StudioError('NOT_FOUND', 'Customer not found');
  const inRange = { gte: window.start, lt: window.endExclusive };
  const sum = async (where: object) => (await scoped.phCustomerLedger.aggregate({ where: { customerId: customer.id, ...where }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n;

  let after: object | null = null;
  let balance = 0n;
  const opening = await sum({ createdAt: { lt: window.start } });
  if (input.cursor) {
    const at = await scoped.phCustomerLedger.findFirst({ where: { id: input.cursor, customerId: customer.id, createdAt: inRange }, select: { id: true, createdAt: true } });
    if (!at) throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
    after = { OR: [{ createdAt: { gt: at.createdAt } }, { createdAt: at.createdAt, id: { gt: at.id } }] };
    const upTo = await sum({ createdAt: inRange, NOT: after });
    balance = opening + upTo;
  } else {
    balance = opening;
  }
  const [rows, totals] = await Promise.all([
    scoped.phCustomerLedger.findMany({
      where: { customerId: customer.id, createdAt: inRange, ...(after ? after : {}) },
      select: { id: true, kind: true, amountMinor: true, createdAt: true, saleId: true, paymentId: true, payment: { select: { reversedBy: { select: { id: true } } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.pageSize + 1,
    }),
    scoped.phCustomerLedger.groupBy({ by: ['kind'], where: { customerId: customer.id, createdAt: inRange }, _sum: { amountMinor: true } }),
  ]);
  const page = rows.slice(0, input.pageSize);
  const saleIds = [...new Set(page.flatMap((r) => (r.saleId ? [r.saleId] : [])))];
  const paymentIds = [...new Set(page.flatMap((r) => (r.paymentId ? [r.paymentId] : [])))];
  const [sales, payments] = await Promise.all([
    saleIds.length ? scoped.phSale.findMany({ where: { id: { in: saleIds } }, select: { id: true, number: true } }) : [],
    // A payment taken at a branch the actor does not work at is not visible to a branch-limited actor: its method is left out.
    paymentIds.length ? scoped.phCustomerPayment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, method: true } }) : [],
  ]);
  // Whether a payment was corrected is read through the ledger row's own relation, so it does not depend on the viewer's branches.
  const numberOf = new Map(sales.map((s) => [s.id, s.number]));
  const methodOf = new Map(payments.map((p) => [p.id, p.method]));
  const totalsByKind = { CHARGE: 0n, PAYMENT: 0n, REVERSAL: 0n, REFUND: 0n } as Record<StatementRowView['kind'], bigint>;
  for (const t of totals) totalsByKind[t.kind] = t._sum.amountMinor ?? 0n;
  const rangeTotal = Object.values(totalsByKind).reduce((a, b) => a + b, 0n);

  const out: StatementRowView[] = page.map((r) => {
    balance += r.amountMinor;
    return {
      id: r.id,
      kind: r.kind,
      day: baghdadDay(r.createdAt),
      at: r.createdAt.toISOString(),
      amountMinor: String(r.amountMinor),
      balanceMinor: String(balance),
      saleId: r.saleId,
      saleNumber: r.saleId ? (numberOf.get(r.saleId) ?? null) : null,
      paymentId: r.paymentId,
      method: r.paymentId ? (methodOf.get(r.paymentId) ?? null) : null,
      corrected: r.kind === 'PAYMENT' && r.paymentId !== null && (r.payment?.reversedBy.length ?? 0) > 0,
    };
  });
  return {
    customer: { id: customer.id, name: customer.name, currency: customer.currency, active: customer.active },
    from: input.from,
    to: input.to,
    openingMinor: String(opening),
    closingMinor: String(opening + rangeTotal),
    totalsByKind: Object.fromEntries(Object.entries(totalsByKind).map(([k, v]) => [k, String(v)])) as Record<StatementRowView['kind'], string>,
    rows: out,
    nextCursor: rows.length > input.pageSize ? page[page.length - 1]!.id : null,
  };
}

// Ageing --------------------------------------------------------------------------------------------------------------

export interface AgeingItem {
  customerId: string;
  name: string;
  currency: 'IQD' | 'USD';
  owedMinor: string;
  buckets: Record<AgeingBucket, string>;
}

export interface AgeingView {
  asOf: string;
  items: AgeingItem[];
  /** Per currency, never summed across them. */
  totals: { currency: 'IQD' | 'USD'; count: number; owedMinor: string; buckets: Record<AgeingBucket, string> }[];
  hasMore: boolean;
}

export const AGEING_LIMIT = 200;

/**
 * What customers owe by age, per customer and per currency: a charge ages from its Baghdad day; a refund cancels its own
 * sale's charge and a corrected payment goes back onto what it had settled; other payments settle the oldest charges first. Customers who owe nothing are left out. At most 200 customers (by name).
 */
export async function customerAgeing(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof ageingInput>): Promise<AgeingView> {
  assertCustomerManager(ph);
  const asOf = input.asOf ?? baghdadDay(new Date());
  const owing = await scoped.phCustomerLedger.groupBy({
    by: ['customerId'],
    where: input.customerId ? { customerId: input.customerId } : {},
    having: { amountMinor: { _sum: { gt: 0n } } },
  });
  const customers = owing.length
    ? await scoped.phCustomer.findMany({ where: { id: { in: owing.map((o) => o.customerId) } }, select: { id: true, name: true, currency: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: AGEING_LIMIT + 1 })
    : [];
  const shown = customers.slice(0, AGEING_LIMIT);
  const entries = shown.length
    ? await scoped.phCustomerLedger.findMany({ where: { customerId: { in: shown.map((c) => c.id) } }, select: { customerId: true, kind: true, amountMinor: true, createdAt: true, saleId: true, paymentId: true, payment: { select: { reversesId: true } } } })
    : [];
  // A REVERSAL row points at the reversing payment; that payment points at the one it corrects. The link is read through the ledger row's own
  // relation (the ledger is business-wide), not through a branch-scoped payment query, so a viewer limited to other branches sees the same ageing.
  const items: AgeingItem[] = shown.map((c) => {
    const mine = entries
      .filter((e) => e.customerId === c.id)
      .map((e) => ({ day: baghdadDay(e.createdAt), amountMinor: e.amountMinor, kind: e.kind, saleId: e.saleId, paymentId: e.paymentId, reversesPaymentId: e.kind === 'REVERSAL' && e.paymentId ? (e.payment?.reversesId ?? null) : null }));
    const aged = ageingBuckets(mine, asOf);
    return {
      customerId: c.id,
      name: c.name,
      currency: c.currency,
      owedMinor: String(aged.owedMinor),
      buckets: Object.fromEntries(Object.entries(aged.buckets).map(([k, v]) => [k, String(v)])) as Record<AgeingBucket, string>,
    };
  });
  const totals = (['IQD', 'USD'] as const).flatMap((currency) => {
    const mine = items.filter((i) => i.currency === currency);
    if (mine.length === 0) return [];
    const buckets = { '0-30': 0n, '31-60': 0n, '61-90': 0n, '90+': 0n } as Record<AgeingBucket, bigint>;
    for (const i of mine) for (const k of Object.keys(buckets) as AgeingBucket[]) buckets[k] += BigInt(i.buckets[k]);
    return [
      {
        currency,
        count: mine.length,
        owedMinor: String(mine.reduce((a, i) => a + BigInt(i.owedMinor), 0n)),
        buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, String(v)])) as Record<AgeingBucket, string>,
      },
    ];
  });
  return { asOf, items, totals, hasMore: customers.length > AGEING_LIMIT };
}
