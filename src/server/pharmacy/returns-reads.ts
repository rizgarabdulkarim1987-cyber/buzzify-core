import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { isWithinReturnWindow, refundForReturn } from '@/server/domain/pharmacy/sale';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { defaultRefundMethod, mayOverrideWindow, type RefundMethod } from './returns';

/**
 * Reading returns. Who reads: a holder of `report.view` or of `return.approve` (the people who make or audit returns);
 * a cashier or any other role reads none, and a support actor none. Nothing here carries a cost or a profit: a return
 * shows the lot and expiry of what came back, the quantities and the money refunded.
 */

const WHOLE = 'Enter a whole number';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const idText = z.string().min(1).max(64);

export const returnGetInput = z.object({ returnId: idText });
export const returnableInput = z.object({ saleId: idText });
export const returnListInput = z.object({
  saleId: idText.optional(),
  number: z.string().trim().min(1).max(40).optional(),
  from: z.coerce.date({ error: 'Enter a valid date' }).optional(),
  to: z.coerce.date({ error: 'Enter a valid date' }).optional(),
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

function mayRead(ph: PhActor): void {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'report.view') && !canPh(ph.role, 'return.approve')) throw new StudioError('FORBIDDEN');
}

export interface ReturnSummary {
  id: string;
  number: string | null;
  saleId: string;
  branchId: string;
  currency: 'IQD' | 'USD';
  refundMinor: string;
  refundMethod: RefundMethod;
  approvedById: string;
  lineCount: number;
  createdAt: string;
}

export async function listReturns(scoped: ScopedClient, ph: PhActor, input: z.infer<typeof returnListInput> & { branchId?: string }): Promise<{ items: ReturnSummary[]; nextCursor: string | null }> {
  mayRead(ph);
  const rows = await scoped.phReturn.findMany({
    where: {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.saleId ? { saleId: input.saleId } : {}),
      ...(input.number ? { number: input.number } : {}),
      ...(input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
    },
    select: { id: true, number: true, saleId: true, branchId: true, currency: true, refundMinor: true, refundMethod: true, approvedById: true, createdAt: true, _count: { select: { lines: true } } },
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
      saleId: r.saleId,
      branchId: r.branchId,
      currency: r.currency,
      refundMinor: String(r.refundMinor),
      refundMethod: r.refundMethod,
      approvedById: r.approvedById,
      lineCount: r._count.lines,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: more ? page[page.length - 1]!.id : null,
  };
}

export interface ReturnLineView {
  id: string;
  allocationId: string;
  saleLineId: string;
  lineNo: number;
  productId: string;
  productName: string;
  unitLabel: string;
  batchId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: 'DAY' | 'MONTH';
  baseQty: number;
  refundMinor: string;
}

export interface ReturnDetail extends ReturnSummary {
  saleNumber: string | null;
  shiftId: string;
  reason: string;
  lines: ReturnLineView[];
}

export async function getReturn(scoped: ScopedClient, ph: PhActor, input: { returnId: string; branchId?: string }): Promise<ReturnDetail> {
  mayRead(ph);
  const row = await scoped.phReturn.findFirst({
    where: { id: input.returnId, ...(input.branchId ? { branchId: input.branchId } : {}) },
    include: {
      sale: { select: { number: true } },
      lines: {
        orderBy: { id: 'asc' },
        include: {
          allocation: {
            select: {
              id: true,
              batchId: true,
              expirySnapshot: true,
              batch: { select: { lot: true, expiryPrecision: true } },
              saleLine: { select: { id: true, lineNo: true, productId: true, product: { select: { tradeName: true } }, unit: { select: { label: true } } } },
            },
          },
        },
      },
    },
  });
  if (!row) throw new StudioError('NOT_FOUND', 'Return not found');
  return {
    id: row.id,
    number: row.number,
    saleId: row.saleId,
    saleNumber: row.sale.number,
    branchId: row.branchId,
    shiftId: row.shiftId,
    currency: row.currency,
    refundMinor: String(row.refundMinor),
    refundMethod: row.refundMethod,
    approvedById: row.approvedById,
    reason: row.reason,
    lineCount: row.lines.length,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((l) => ({
      id: l.id,
      allocationId: l.allocation.id,
      saleLineId: l.allocation.saleLine.id,
      lineNo: l.allocation.saleLine.lineNo,
      productId: l.allocation.saleLine.productId,
      productName: l.allocation.saleLine.product.tradeName,
      unitLabel: l.allocation.saleLine.unit.label,
      batchId: l.allocation.batchId,
      lot: l.allocation.batch.lot,
      expiryDate: iso(l.allocation.expirySnapshot),
      expiryPrecision: l.allocation.batch.expiryPrecision,
      baseQty: l.baseQty,
      refundMinor: String(l.refundMinor),
    })),
  };
}

export interface ReturnableAllocation {
  id: string;
  batchId: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: 'DAY' | 'MONTH';
  soldBaseQty: number;
  returnedBaseQty: number;
  remainingBaseQty: number;
}

export interface ReturnableLine {
  id: string;
  lineNo: number;
  productId: string;
  productName: string;
  unitId: string;
  unitLabel: string;
  soldBaseQty: number;
  returnedBaseQty: number;
  remainingBaseQty: number;
  unitPriceMinor: string;
  /** What returning ONE more base unit of this line would refund now (the line's share), "0" when nothing remains. */
  refundPerUnitPreviewMinor: string;
  allocations: ReturnableAllocation[];
}

export interface Returnable {
  saleId: string;
  number: string | null;
  status: 'HELD' | 'COMPLETED' | 'RETURNED_PARTIAL' | 'RETURNED_FULL' | 'HOLD_EXPIRED';
  currency: 'IQD' | 'USD';
  totalMinor: string;
  /** Refunded so far, over all returns of the sale. */
  refundedMinor: string;
  /** True when the sale is in a state that can be returned and something remains. */
  returnable: boolean;
  window: { withinWindow: boolean; days: number; needsManager: boolean; mayOverride: boolean };
  paidMethods: RefundMethod[];
  defaultRefundMethod: RefundMethod;
  lines: ReturnableLine[];
}

/** What can still come back from one sale, for the return screen. NOT_FOUND for a sale outside the actor's branches. */
export async function returnableOf(scoped: ScopedClient, ph: PhActor, input: { saleId: string; branchId?: string }, now: Date = new Date()): Promise<Returnable> {
  mayRead(ph);
  const sale = await scoped.phSale.findFirst({
    where: { id: input.saleId, ...(input.branchId ? { branchId: input.branchId } : {}) },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      totalMinor: true,
      createdAt: true,
      completedAt: true,
      payments: { select: { method: true, amountMinor: true } },
      returns: { select: { refundMinor: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        select: {
          id: true,
          lineNo: true,
          productId: true,
          unitId: true,
          baseQty: true,
          unitPriceMinor: true,
          totalMinor: true,
          product: { select: { tradeName: true } },
          unit: { select: { label: true } },
          allocations: { orderBy: { id: 'asc' }, select: { id: true, batchId: true, baseQty: true, returnedBaseQty: true, expirySnapshot: true, batch: { select: { lot: true, expiryPrecision: true } } } },
        },
      },
    },
  });
  if (!sale) throw new StudioError('NOT_FOUND', 'Sale not found');
  const settings = await scoped.phSettings.findFirst({ select: { returnWindowDays: true } });
  const days = settings?.returnWindowDays ?? 30;
  const withinWindow = isWithinReturnWindow(sale.completedAt ?? sale.createdAt, now, days);
  const allocationIds = sale.lines.flatMap((l) => l.allocations.map((a) => a.id));
  const priorLines = await scoped.phReturnLine.findMany({ where: { saleLineAllocationId: { in: allocationIds } }, select: { saleLineAllocationId: true, refundMinor: true } });
  const refundedBy = new Map<string, bigint>();
  for (const p of priorLines) refundedBy.set(p.saleLineAllocationId, (refundedBy.get(p.saleLineAllocationId) ?? 0n) + p.refundMinor);

  const lines = sale.lines.map((l): ReturnableLine => {
    const returned = l.allocations.reduce((s, a) => s + a.returnedBaseQty, 0);
    const remaining = l.baseQty - returned;
    const refunded = l.allocations.reduce((s, a) => s + (refundedBy.get(a.id) ?? 0n), 0n);
    const preview =
      remaining > 0
        ? refundForReturn({ lineTotalMinor: l.totalMinor, lineBaseQty: BigInt(l.baseQty), returnBaseQty: 1n, alreadyReturnedBaseQty: BigInt(returned), alreadyRefundedMinor: refunded })
        : 0n;
    return {
      id: l.id,
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.product.tradeName,
      unitId: l.unitId,
      unitLabel: l.unit.label,
      soldBaseQty: l.baseQty,
      returnedBaseQty: returned,
      remainingBaseQty: remaining,
      unitPriceMinor: String(l.unitPriceMinor),
      refundPerUnitPreviewMinor: String(preview),
      allocations: l.allocations.map((a) => ({
        id: a.id,
        batchId: a.batchId,
        lot: a.batch.lot,
        expiryDate: iso(a.expirySnapshot),
        expiryPrecision: a.batch.expiryPrecision,
        soldBaseQty: a.baseQty,
        returnedBaseQty: a.returnedBaseQty,
        remainingBaseQty: a.baseQty - a.returnedBaseQty,
      })),
    };
  });
  const paid = sale.payments.map((p) => ({ method: p.method as RefundMethod, amountMinor: p.amountMinor }));
  return {
    saleId: sale.id,
    number: sale.number,
    status: sale.status,
    currency: sale.currency,
    totalMinor: String(sale.totalMinor),
    refundedMinor: String(sale.returns.reduce((s, r) => s + r.refundMinor, 0n)),
    returnable: (sale.status === 'COMPLETED' || sale.status === 'RETURNED_PARTIAL') && lines.some((l) => l.remainingBaseQty > 0),
    window: { withinWindow, days, needsManager: !withinWindow, mayOverride: mayOverrideWindow(ph.role) },
    paidMethods: [...new Set(paid.map((p) => p.method))],
    defaultRefundMethod: defaultRefundMethod(paid),
    lines,
  };
}
