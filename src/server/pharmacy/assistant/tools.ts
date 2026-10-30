import { baghdadDayOf } from '@/lib/baghdad';
import type { ScopedClient } from '@/server/data/tenant-db';
import { ASSISTANT_TOOLS, lastDays, mayUseTool, previousPeriod, type AssistantTool } from '@/server/domain/pharmacy/assistant-domain';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from '../actor';
import { listExpiry } from '../expiry';
import { listPayables } from '../payables-reads';
import { marginReport } from '../reports-margin';
import { marginInput } from '../reports-inputs';
import { scopeOf, windowOf } from '../reports-common';
import { lowStockInput, lowStockReport } from '../reports-stock';
import { assertStaff } from '../receipts';
import { toolInputs, toolOutputs, type Period, type ToolOutput } from './tool-shapes';

/**
 * The six assistant tools (R7-6): TypeScript reads over the existing scoped services, each with the permissions of the report it
 * stands for and the actor's branches. There is NO SQL here (not even a raw one): the expiry list, the low-stock report, the
 * payables list and the margin report are the services the screens use, and the two remaining reads (slow movers, transfer
 * candidates) are ORM reads through the scoped client. Every output is parsed by its strict shape before it leaves, so a key the
 * shape does not list cannot get out, and a cost key the services left out stays absent. No tool writes anything.
 */

export interface ToolEnv {
  scoped: ScopedClient;
  ph: PhActor;
  now: Date;
}

const SLOW_ROWS = 20;
const ROWS = 50;
const SCAN_CAP = 5000;

const meta = (env: ToolEnv, branches: string[], period: Period | null) => ({ dataAsOf: env.now.toISOString(), period, branches });

/** Runs one tool by name for an actor. Refuses (FORBIDDEN) a tool the role may not use; an unknown name or bad input is INVALID. */
export async function runTool(env: ToolEnv, name: string, rawInput: unknown): Promise<ToolOutput> {
  assertStaff(env.ph);
  if (!(ASSISTANT_TOOLS as readonly string[]).includes(name)) throw new StudioError('INVALID', 'Choose one of the assistant tools');
  const tool = name as AssistantTool;
  if (!mayUseTool(env.ph.role, tool)) throw new StudioError('FORBIDDEN');
  const parsed = toolInputs[tool].safeParse(rawInput ?? {});
  if (!parsed.success) throw new StudioError('INVALID', 'Check the highlighted fields');
  const input = parsed.data as never;
  switch (tool) {
    case 'batches_expiring':
      return toolOutputs.batches_expiring.parse(await batchesExpiring(env, input));
    case 'stock_below_reorder':
      return toolOutputs.stock_below_reorder.parse(await stockBelowReorder(env, input));
    case 'slow_movers':
      return toolOutputs.slow_movers.parse(await slowMovers(env, input));
    case 'transfer_candidates':
      return toolOutputs.transfer_candidates.parse(await transferCandidates(env, input));
    case 'unpaid_supplier_invoices':
      return toolOutputs.unpaid_supplier_invoices.parse(await unpaidSupplierInvoices(env));
    case 'margin_change':
      return toolOutputs.margin_change.parse(await marginChange(env, input));
  }
}

const periodOf = (env: ToolEnv, period: Period | undefined): Period => period ?? lastDays(baghdadDayOf(env.now), 30);

async function batchesExpiring(env: ToolEnv, input: { days: 30 | 60 | 90 | 180; branchId?: string }) {
  const scope = scopeOf(env.ph, input.branchId);
  const list = await listExpiry(env.scoped, env.ph, { days: input.days, includeExpired: true, pageSize: ROWS, cursor: null, ...(input.branchId ? { branchId: input.branchId } : {}) });
  return {
    tool: 'batches_expiring' as const,
    ...meta(env, scope.branchIds, null),
    days: input.days,
    totals: list.totals,
    rows: list.items.map((r) => ({
      productId: r.product.productId,
      tradeName: r.product.tradeName,
      strength: r.product.strength,
      form: r.product.form,
      batchId: r.batch.batchId,
      lot: r.batch.lot,
      branchId: r.branchId,
      expiryDate: r.batch.expiryDate,
      daysToExpiry: r.daysToExpiry,
      band: r.band,
      units: r.buckets.available + r.buckets.reserved + r.buckets.quarantine,
      // Present only when the service returned them: the actor holds `cost.view`.
      ...(r.unitCostMinor !== undefined ? { unitCostMinor: r.unitCostMinor, currency: r.currency ?? null } : {}),
    })),
    truncated: list.nextCursor !== null,
  };
}

async function stockBelowReorder(env: ToolEnv, input: { branchId?: string }) {
  const scope = scopeOf(env.ph, input.branchId);
  const report = await lowStockReport(env.scoped, env.ph, { branchId: input.branchId }, lowStockInput.parse({ take: ROWS }));
  return {
    tool: 'stock_below_reorder' as const,
    ...meta(env, scope.branchIds, null),
    total: report.total,
    rows: report.rows.map((r) => ({ productId: r.productId, tradeName: r.tradeName, strength: r.strength, form: r.form, branchId: r.branchId, minQty: r.minQty, sellable: r.sellable, deficit: r.deficit, reorderQty: r.reorderQty })),
    truncated: report.hasMore,
  };
}

/**
 * Products with sellable stock that sold the fewest units in the period (units sold, gross of returns), least first, then the most
 * stock. Two grouped reads through the scoped client: stock per product (active, unexpired batches) and units sold per product.
 */
async function slowMovers(env: ToolEnv, input: { period?: Period; branchId?: string }) {
  const scope = scopeOf(env.ph, input.branchId);
  const period = periodOf(env, input.period);
  const window = windowOf(period.from, period.to);
  const today = utcToday(env.now);
  const [stock, sold] = await Promise.all([
    env.scoped.phStockBalance.groupBy({
      by: ['productId'],
      where: { branchId: { in: scope.branchIds }, available: { gt: 0 }, batch: { status: 'ACTIVE', expiryDate: { gte: new Date(`${today}T00:00:00.000Z`) } } },
      _sum: { available: true },
      orderBy: { productId: 'asc' },
      take: SCAN_CAP + 1,
    }),
    env.scoped.phSaleLine.groupBy({
      by: ['productId'],
      where: { sale: { branchId: { in: scope.branchIds }, status: { in: ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] }, completedAt: { gte: window.start, lt: window.endExclusive } } },
      _sum: { baseQty: true },
      orderBy: { productId: 'asc' },
      take: SCAN_CAP + 1,
    }),
  ]);
  const soldBy = new Map(sold.map((s) => [s.productId, s._sum.baseQty ?? 0]));
  const ranked = stock
    .slice(0, SCAN_CAP)
    .map((s) => ({ productId: s.productId, onHandUnits: s._sum.available ?? 0, soldUnits: soldBy.get(s.productId) ?? 0 }))
    .sort((a, b) => a.soldUnits - b.soldUnits || b.onHandUnits - a.onHandUnits || (a.productId < b.productId ? -1 : 1));
  const top = ranked.slice(0, SLOW_ROWS);
  const products = await env.scoped.phProduct.findMany({ where: { id: { in: top.map((t) => t.productId) } }, select: { id: true, tradeName: true, strength: true, form: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  return {
    tool: 'slow_movers' as const,
    ...meta(env, scope.branchIds, period),
    days: window.days,
    rows: top.flatMap((t) => {
      const p = byId.get(t.productId);
      return p ? [{ productId: p.id, tradeName: p.tradeName, strength: p.strength, form: p.form, soldUnits: t.soldUnits, onHandUnits: t.onHandUnits }] : [];
    }),
    truncated: stock.length > SCAN_CAP || ranked.length > SLOW_ROWS,
  };
}

/**
 * Where the stock of one batch could go: from each branch that holds it to each branch whose sellable stock of the product is
 * below its minimum, up to the shortage and up to what the source can spare (its own stock above its own minimum). An expired or
 * inactive batch gets no suggestion at all: expired stock is written off, never moved to be sold.
 */
async function transferCandidates(env: ToolEnv, input: { batchId: string }) {
  const batch = await env.scoped.phBatch.findFirst({ where: { id: input.batchId }, select: { id: true, productId: true, lot: true, expiryDate: true, status: true } });
  if (!batch) throw new StudioError('NOT_FOUND');
  const product = await env.scoped.phProduct.findFirst({ where: { id: batch.productId }, select: { tradeName: true } });
  const today = utcToday(env.now);
  const expiryDate = batch.expiryDate.toISOString().slice(0, 10);
  const notSuggested = expiryDate < today ? ('EXPIRED' as const) : batch.status !== 'ACTIVE' ? ('NOT_ACTIVE' as const) : null;
  const reach = env.ph.branchIds;
  const out = {
    tool: 'transfer_candidates' as const,
    ...meta(env, reach, null),
    batch: { batchId: batch.id, productId: batch.productId, tradeName: product?.tradeName ?? '', lot: batch.lot, expiryDate, status: batch.status },
    notSuggested,
    rows: [] as Array<{ fromBranchId: string; toBranchId: string; availableAtSource: number; destSellable: number; destMinQty: number; suggestedQty: number }>,
  };
  if (notSuggested !== null) return out;

  const [balances, settings] = await Promise.all([
    env.scoped.phStockBalance.findMany({
      where: { productId: batch.productId, branchId: { in: reach } },
      select: { batchId: true, branchId: true, available: true, batch: { select: { status: true, expiryDate: true } } },
      take: SCAN_CAP,
    }),
    env.scoped.phProductBranch.findMany({ where: { productId: batch.productId, branchId: { in: reach } }, select: { branchId: true, minQty: true } }),
  ]);
  const minOf = new Map(settings.map((s) => [s.branchId, s.minQty]));
  const sellable = new Map<string, number>(reach.map((b) => [b, 0]));
  for (const b of balances) {
    if (b.batch.status === 'ACTIVE' && b.batch.expiryDate.toISOString().slice(0, 10) >= today) sellable.set(b.branchId, (sellable.get(b.branchId) ?? 0) + b.available);
  }
  const sources = balances
    .filter((b) => b.batchId === batch.id && b.available > 0)
    .map((b) => {
      const min = minOf.get(b.branchId) ?? 0;
      const spare = min > 0 ? Math.max(0, (sellable.get(b.branchId) ?? 0) - min) : b.available;
      return { branchId: b.branchId, available: b.available, spare: Math.min(b.available, spare) };
    })
    .sort((a, b) => b.spare - a.spare || (a.branchId < b.branchId ? -1 : 1));
  const needs = reach
    .map((branchId) => ({ branchId, min: minOf.get(branchId) ?? 0, have: sellable.get(branchId) ?? 0 }))
    .filter((d) => d.min > 0 && d.have < d.min)
    .map((d) => ({ ...d, need: d.min - d.have }))
    .sort((a, b) => b.need - a.need || (a.branchId < b.branchId ? -1 : 1));
  for (const dest of needs) {
    let need = dest.need;
    for (const src of sources) {
      if (need <= 0) break;
      if (src.branchId === dest.branchId || src.spare <= 0) continue;
      const qty = Math.min(need, src.spare);
      out.rows.push({ fromBranchId: src.branchId, toBranchId: dest.branchId, availableAtSource: src.available, destSellable: dest.have, destMinQty: dest.min, suggestedQty: qty });
      src.spare -= qty;
      need -= qty;
    }
  }
  out.rows.sort((a, b) => (a.fromBranchId + a.toBranchId < b.fromBranchId + b.toBranchId ? -1 : 1));
  return out;
}

async function unpaidSupplierInvoices(env: ToolEnv) {
  const list = await listPayables(env.scoped, env.ph, { take: ROWS });
  return {
    tool: 'unpaid_supplier_invoices' as const,
    ...meta(env, env.ph.branchIds, null),
    rows: list.items.map((i) => ({
      invoiceId: i.id,
      number: i.number,
      supplierId: i.supplierId,
      supplierName: i.supplierName,
      currency: i.currency,
      dueDate: i.dueDate,
      daysOverdue: i.daysOverdue,
      dueBand: i.dueBand,
      status: i.status,
      ...(i.balanceMinor !== undefined ? { balanceMinor: i.balanceMinor } : {}),
    })),
    totals: list.totals.map((t) => ({ currency: t.currency, count: t.count, ...(t.balanceMinor !== undefined ? { balanceMinor: t.balanceMinor } : {}), ...(t.overdueMinor !== undefined ? { overdueMinor: t.overdueMinor } : {}) })),
    truncated: list.nextCursor !== null,
  };
}

/** The margin of the period and of the period before it (same length), per currency, with the move in basis points. Needs report.view, profit.view and cost.view (the service refuses otherwise). */
async function marginChange(env: ToolEnv, input: { period?: Period; branchId?: string }) {
  const scope = scopeOf(env.ph, input.branchId);
  const period = periodOf(env, input.period);
  const previous = previousPeriod(period.from, period.to);
  const place = { branchId: input.branchId };
  const [now, before] = await Promise.all([
    marginReport(env.scoped, env.ph, place, marginInput.parse({ ...period, groupBy: 'branch', take: 1 })),
    marginReport(env.scoped, env.ph, place, marginInput.parse({ ...previous, groupBy: 'branch', take: 1 })),
  ]);
  const currencies = [...new Set([...now.totals.map((t) => t.currency), ...before.totals.map((t) => t.currency)])].sort();
  return {
    tool: 'margin_change' as const,
    ...meta(env, scope.branchIds, period),
    previous,
    byCurrency: currencies.map((currency) => {
      const cur = now.totals.find((t) => t.currency === currency);
      const prev = before.totals.find((t) => t.currency === currency);
      return {
        currency,
        netMinor: cur?.netMinor ?? '0',
        marginMinor: cur?.marginMinor ?? '0',
        marginBp: cur?.marginBp ?? null,
        previousNetMinor: prev?.netMinor ?? '0',
        previousMarginMinor: prev?.marginMinor ?? '0',
        previousMarginBp: prev?.marginBp ?? null,
        changeBp: cur?.marginBp != null && prev?.marginBp != null ? cur.marginBp - prev.marginBp : null,
      };
    }),
  };
}

