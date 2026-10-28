import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { mayViewCost } from './products';

/**
 * Reading sales. Who sees which (phase 3 ruling): a holder of `report.view` sees every sale of the branches they work in;
 * a holder of only `shift.use` sees the sales of their own OPEN shift; any other role sees none. A support actor reads
 * none. Cost snapshots exist only in what a role with `cost.view` receives.
 */

const WHOLE = 'Enter a whole number';
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const SALE_STATUSES = ['HELD', 'COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL', 'HOLD_EXPIRED'] as const;

export const saleGetInput = z.object({ saleId: z.string().min(1).max(64) });

export const saleListInput = z.object({
  from: z.coerce.date({ error: 'Enter a valid date' }).optional(),
  to: z.coerce.date({ error: 'Enter a valid date' }).optional(),
  status: z.enum(SALE_STATUSES, 'Choose a status').optional(),
  number: z.string().trim().min(1).max(40).optional(),
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

/**
 * The shifts whose sales the actor may read: `null` for every sale (report.view), else the ids of their own open shifts
 * (possibly none). Refuses a role that holds neither permission and a support actor.
 */
async function readableShifts(scoped: ScopedClient, ph: PhActor): Promise<string[] | null> {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (canPh(ph.role, 'report.view')) return null;
  if (!canPh(ph.role, 'shift.use')) throw new StudioError('FORBIDDEN');
  const open = await scoped.phShift.findMany({ where: { userId: ph.userId, status: 'OPEN' }, select: { id: true } });
  return open.map((s) => s.id);
}

export interface SaleSummary {
  id: string;
  number: string | null;
  status: (typeof SALE_STATUSES)[number];
  branchId: string;
  currency: 'IQD' | 'USD';
  totalMinor: string;
  paidMinor: string;
  changeMinor: string;
  lineCount: number;
  /** The payment methods used, once each. */
  methods: ('CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL')[];
  soldById: string;
  createdAt: string;
}

/** Newest first, by cursor, within the readable shifts and the actor's branches. */
export async function listSales(
  scoped: ScopedClient,
  ph: PhActor,
  input: z.infer<typeof saleListInput> & { branchId?: string },
): Promise<{ items: SaleSummary[]; nextCursor: string | null }> {
  const shifts = await readableShifts(scoped, ph);
  const where = {
    ...(input.branchId ? { branchId: input.branchId } : {}),
    ...(shifts ? { shiftId: { in: shifts } } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.number ? { number: input.number } : {}),
    ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
  };
  if (input.cursor && !(await scoped.phSale.findFirst({ where: { ...where, id: input.cursor }, select: { id: true } }))) {
    throw new StudioError('INVALID', 'Check the highlighted fields', { cursor: 'This page of results is no longer available' });
  }
  const rows = await scoped.phSale.findMany({
    where,
    select: {
      id: true,
      number: true,
      status: true,
      branchId: true,
      currency: true,
      totalMinor: true,
      paidMinor: true,
      changeMinor: true,
      soldById: true,
      createdAt: true,
      _count: { select: { lines: true } },
      payments: { select: { method: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  return {
    items: page.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      branchId: r.branchId,
      currency: r.currency,
      totalMinor: String(r.totalMinor),
      paidMinor: String(r.paidMinor),
      changeMinor: String(r.changeMinor),
      lineCount: r._count.lines,
      methods: [...new Set(r.payments.map((p) => p.method))],
      soldById: r.soldById,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

export interface SaleAllocationView {
  id: string;
  batchId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: 'DAY' | 'MONTH';
  baseQty: number;
  returnedBaseQty: number;
  /** Present only for a role with `cost.view`. */
  costSnapshotMinor?: string | null;
  costCurrency?: 'IQD' | 'USD' | null;
}

export interface SaleLineView {
  lineNo: number;
  productId: string;
  productName: string;
  unitId: string;
  unitLabel: string;
  qty: number;
  baseQty: number;
  unitPriceMinor: string;
  discountMinor: string;
  totalMinor: string;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
  pharmacistId: string | null;
  priceOverrideReason: string;
  discountReason: string;
  allocations: SaleAllocationView[];
}

export interface SaleDetail extends SaleSummary {
  shiftId: string;
  subtotalMinor: string;
  discountMinor: string;
  roundingMinor: string;
  pharmacistId: string | null;
  note: string;
  completedAt: string | null;
  payments: { id: string; method: 'CASH' | 'CARD_MANUAL' | 'TRANSFER_MANUAL'; amountMinor: string; reference: string }[];
  lines: SaleLineView[];
}

/** One sale with lines, allocations (lot and expiry) and payments. NOT_FOUND for a sale the actor may not read. */
export async function getSale(scoped: ScopedClient, ph: PhActor, input: { saleId: string; branchId?: string }): Promise<SaleDetail> {
  const shifts = await readableShifts(scoped, ph);
  const sale = await scoped.phSale.findFirst({
    where: { id: input.saleId, ...(input.branchId ? { branchId: input.branchId } : {}), ...(shifts ? { shiftId: { in: shifts } } : {}) },
    include: {
      payments: { orderBy: { createdAt: 'asc' } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: {
          product: { select: { tradeName: true } },
          unit: { select: { label: true } },
          allocations: { orderBy: { id: 'asc' }, include: { batch: { select: { lot: true, expiryPrecision: true } } } },
        },
      },
    },
  });
  if (!sale) throw new StudioError('NOT_FOUND', 'Sale not found');
  const withCost = mayViewCost(ph);
  return {
    id: sale.id,
    number: sale.number,
    status: sale.status,
    branchId: sale.branchId,
    shiftId: sale.shiftId,
    currency: sale.currency,
    subtotalMinor: String(sale.subtotalMinor),
    discountMinor: String(sale.discountMinor),
    roundingMinor: String(sale.roundingMinor),
    totalMinor: String(sale.totalMinor),
    paidMinor: String(sale.paidMinor),
    changeMinor: String(sale.changeMinor),
    lineCount: sale.lines.length,
    methods: [...new Set(sale.payments.map((p) => p.method))],
    soldById: sale.soldById,
    pharmacistId: sale.pharmacistId,
    note: sale.note,
    createdAt: sale.createdAt.toISOString(),
    completedAt: sale.completedAt ? sale.completedAt.toISOString() : null,
    payments: sale.payments.map((p) => ({ id: p.id, method: p.method, amountMinor: String(p.amountMinor), reference: p.reference })),
    lines: sale.lines.map((l) => ({
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.product.tradeName,
      unitId: l.unitId,
      unitLabel: l.unit.label,
      qty: l.qty,
      baseQty: l.baseQty,
      unitPriceMinor: String(l.unitPriceMinor),
      discountMinor: String(l.discountMinor),
      totalMinor: String(l.totalMinor),
      rxLevel: l.rxLevel,
      pharmacistId: l.pharmacistId,
      priceOverrideReason: l.priceOverrideReason,
      discountReason: l.discountReason,
      allocations: l.allocations.map((a) => ({
        id: a.id,
        batchId: a.batchId,
        lot: a.batch.lot,
        expiryDate: iso(a.expirySnapshot),
        expiryPrecision: a.batch.expiryPrecision,
        baseQty: a.baseQty,
        returnedBaseQty: a.returnedBaseQty,
        ...(withCost ? { costSnapshotMinor: a.costSnapshotMinor === null ? null : String(a.costSnapshotMinor), costCurrency: a.costCurrency } : {}),
      })),
    })),
  };
}
