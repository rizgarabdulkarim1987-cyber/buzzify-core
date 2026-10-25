import { z } from 'zod';
import type { AnyDb } from '@/server/data/tenant-db';
import { canPos, type PosPermission, type PosRole } from '@/server/domain/pos/permissions';
import { COMPLAINT_STATUSES } from '@/server/domain/pos/complaint-rules';
import { nameKey } from '@/server/domain/pos/stock';
import { countNewComplaints, listComplaints } from '@/server/pos/complaints';
import { listItems, listLowStock } from '@/server/pos/inventory';
import { listPurchaseInvoices, listSuppliers } from '@/server/pos/purchases';
import { readRangeReport, RANGE_MAX_DAYS } from '@/server/pos/range-report';
import { dayField, readDailyReport } from '@/server/pos/report';
import { StudioError } from '@/server/studio/framework/result';
import { UnknownToolError } from './errors';
import type { AiToolSpec } from './provider/types';
import { complaintsShape, dailyReportShape, invoicesShape, itemsShape, rangeReportShape, suppliersShape } from './tool-shapes';

/**
 * The ten read tools the model may call, each a typed wrapper over an existing service run with the signed-in person's own
 * role and restaurant. There is no free query: names are matched by `nameKey`, ids never leave the server, and a role is
 * only offered the tools whose permission it holds (and `runTool` checks again before reading).
 */

export type AiToolName =
  | 'getDailyReport'
  | 'getRangeReport'
  | 'listInventoryItems'
  | 'listLowStock'
  | 'findItemsByName'
  | 'listSuppliers'
  | 'findSuppliersByName'
  | 'listPurchaseInvoices'
  | 'listComplaints'
  | 'countNewComplaints';

export interface ToolCtx {
  db: AnyDb;
  restaurantId: string;
  role: PosRole;
}

export interface ToolOutput {
  data: unknown;
  period: { from: string; to: string } | null;
  method: `ai.method.${AiToolName}`;
  empty: boolean;
  truncated: boolean;
}

export interface AiTool<I> {
  name: AiToolName;
  permission: PosPermission;
  description: string;
  input: z.ZodType<I>;
  inputSchema: Record<string, unknown>;
  run(ctx: ToolCtx, input: I): Promise<Omit<ToolOutput, 'method' | 'truncated'>>;
}

export const TOOL_RESULT_MAX_CHARS = 8000;
const DAY_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const emptyInput = z.object({}).strict();
const emptySchema = { type: 'object', properties: {}, required: [], additionalProperties: false };
const query = z.object({ query: z.string().trim().min(1).max(60) }).strict();
const querySchema = { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 60 } }, required: ['query'], additionalProperties: false };
const mayCost = (role: PosRole) => canPos(role, 'purchase.manage');

const matches = (name: string, text: string) => nameKey(name).includes(nameKey(text));

function tool<I>(def: AiTool<I>): AiTool<I> {
  return def;
}

export const AI_TOOLS: readonly AiTool<never>[] = [
  tool({
    name: 'getDailyReport',
    permission: 'report.view',
    description: 'Totals of one Baghdad day: shifts by cashier, sales, discounts, refunds, cancellations and cash differences.',
    input: z.object({ day: dayField }).strict(),
    inputSchema: { type: 'object', properties: { day: { type: 'string', pattern: DAY_PATTERN } }, required: ['day'], additionalProperties: false },
    async run(ctx, input) {
      const report = await readDailyReport(ctx.db, ctx.restaurantId, { day: input.day });
      return { data: dailyReportShape(report), period: { from: input.day, to: input.day }, empty: report.shifts.length === 0 && report.totals.grossSales === 0 };
    },
  }),
  tool({
    name: 'getRangeReport',
    permission: 'report.view',
    description: `Daily totals over a range of up to ${RANGE_MAX_DAYS} days with purchases, waste and product margins where costs are known.`,
    input: z.object({ from: dayField, to: dayField }).strict(),
    inputSchema: { type: 'object', properties: { from: { type: 'string', pattern: DAY_PATTERN }, to: { type: 'string', pattern: DAY_PATTERN } }, required: ['from', 'to'], additionalProperties: false },
    async run(ctx, input) {
      const report = await readRangeReport(ctx.db, ctx.restaurantId, input);
      return { data: rangeReportShape(report), period: { from: input.from, to: input.to }, empty: report.totals.grossSales === 0 && report.totals.purchasesTotal === 0 };
    },
  }),
  tool({
    name: 'listInventoryItems',
    permission: 'inventory.view',
    description: 'Active stock items with unit, quantity on hand and reorder level.',
    input: emptyInput,
    inputSchema: emptySchema,
    async run(ctx) {
      const items = await listItems(ctx.db, ctx.restaurantId, { withCost: mayCost(ctx.role) });
      return { data: itemsShape(items), period: null, empty: items.length === 0 };
    },
  }),
  tool({
    name: 'listLowStock',
    permission: 'inventory.view',
    description: 'Stock items at or under their reorder level, or with negative stock that needs a count.',
    input: emptyInput,
    inputSchema: emptySchema,
    async run(ctx) {
      const items = await listLowStock(ctx.db, ctx.restaurantId, mayCost(ctx.role));
      return { data: itemsShape(items), period: null, empty: items.length === 0 };
    },
  }),
  tool({
    name: 'findItemsByName',
    permission: 'inventory.view',
    description: 'Stock items whose name contains the given text.',
    input: query,
    inputSchema: querySchema,
    async run(ctx, input) {
      const items = (await listItems(ctx.db, ctx.restaurantId, { withCost: mayCost(ctx.role) })).filter((item) => matches(item.name, input.query)).slice(0, 20);
      return { data: itemsShape(items), period: null, empty: items.length === 0 };
    },
  }),
  tool({
    name: 'listSuppliers',
    permission: 'purchase.manage',
    description: 'Suppliers by name, with whether each is active.',
    input: emptyInput,
    inputSchema: emptySchema,
    async run(ctx) {
      const suppliers = await listSuppliers(ctx.db, ctx.restaurantId, true);
      return { data: suppliersShape(suppliers), period: null, empty: suppliers.length === 0 };
    },
  }),
  tool({
    name: 'findSuppliersByName',
    permission: 'purchase.manage',
    description: 'Suppliers whose name contains the given text.',
    input: query,
    inputSchema: querySchema,
    async run(ctx, input) {
      const suppliers = (await listSuppliers(ctx.db, ctx.restaurantId, true)).filter((s) => matches(s.name, input.query)).slice(0, 20);
      return { data: suppliersShape(suppliers), period: null, empty: suppliers.length === 0 };
    },
  }),
  tool({
    name: 'listPurchaseInvoices',
    permission: 'purchase.manage',
    description: 'Recent supplier invoices with totals, whether paid and whether voided; can be limited to a range of days or to unpaid ones.',
    input: z.object({ from: dayField.optional(), to: dayField.optional(), unpaidOnly: z.boolean().optional(), take: z.number().int().min(1).max(50).optional() }).strict(),
    inputSchema: {
      type: 'object',
      properties: { from: { type: 'string', pattern: DAY_PATTERN }, to: { type: 'string', pattern: DAY_PATTERN }, unpaidOnly: { type: 'boolean' }, take: { type: 'integer', minimum: 1, maximum: 50 } },
      required: [],
      additionalProperties: false,
    },
    async run(ctx, input) {
      const rows = await listPurchaseInvoices(ctx.db, ctx.restaurantId, { ...input, take: input.take ?? 20 });
      return { data: invoicesShape(rows), period: input.from && input.to ? { from: input.from, to: input.to } : null, empty: rows.length === 0 };
    },
  }),
  tool({
    name: 'listComplaints',
    permission: 'complaint.view',
    description: 'Recent guest complaints with status, category and a short excerpt; never a name or phone.',
    input: z.object({ status: z.enum(COMPLAINT_STATUSES).optional(), take: z.number().int().min(1).max(25).optional() }).strict(),
    inputSchema: { type: 'object', properties: { status: { type: 'string', enum: [...COMPLAINT_STATUSES] }, take: { type: 'integer', minimum: 1, maximum: 25 } }, required: [], additionalProperties: false },
    async run(ctx, input) {
      const rows = await listComplaints(ctx.db, ctx.restaurantId, { ...(input.status ? { status: input.status } : {}), take: input.take ?? 10 });
      const labels = rows.length === 0 ? [] : await ctx.db.posComplaint.findMany({ where: { restaurantId: ctx.restaurantId, id: { in: rows.map((r) => r.id) } }, select: { id: true, aiCategory: true } });
      return { data: complaintsShape(rows, new Map(labels.map((l) => [l.id, l.aiCategory]))), period: null, empty: rows.length === 0 };
    },
  }),
  tool({
    name: 'countNewComplaints',
    permission: 'complaint.view',
    description: 'How many complaints are new (not yet looked at).',
    input: emptyInput,
    inputSchema: emptySchema,
    async run(ctx) {
      const count = await countNewComplaints(ctx.db, ctx.restaurantId);
      return { data: { count }, period: null, empty: false };
    },
  }),
] as unknown as readonly AiTool<never>[];

export function toolsFor(role: PosRole): readonly AiTool<never>[] {
  return AI_TOOLS.filter((t) => canPos(role, t.permission));
}

export function toolSpecs(role: PosRole): AiToolSpec[] {
  return toolsFor(role).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** Cuts the longest list in `data` until the JSON fits; true when something was cut. */
function fit(output: Omit<ToolOutput, 'method' | 'truncated'> & { method: ToolOutput['method'] }): { json: string; truncated: boolean } {
  let truncated = false;
  let json = JSON.stringify({ ...output, truncated });
  if (json.length <= TOOL_RESULT_MAX_CHARS) return { json, truncated };
  const data = output.data as Record<string, unknown>;
  const key = Object.keys(data).filter((k) => Array.isArray(data[k])).sort((a, b) => (data[b] as unknown[]).length - (data[a] as unknown[]).length)[0];
  if (!key) return { json: json.slice(0, TOOL_RESULT_MAX_CHARS), truncated: true };
  let list = data[key] as unknown[];
  while (list.length > 0) {
    list = list.slice(0, Math.floor(list.length / 2));
    truncated = true;
    json = JSON.stringify({ ...output, data: { ...data, [key]: list }, truncated });
    if (json.length <= TOOL_RESULT_MAX_CHARS) break;
  }
  return { json, truncated };
}

/**
 * Runs one tool call for the model. An unknown name or a tool the role may not use is refused before anything is read; the
 * input is parsed strictly; the result is capped.
 */
export async function runTool(ctx: ToolCtx, name: string, rawInput: unknown): Promise<{ output: ToolOutput; json: string }> {
  const found = AI_TOOLS.find((t) => t.name === name);
  if (!found) throw new UnknownToolError(name);
  if (!canPos(ctx.role, found.permission)) throw new StudioError('FORBIDDEN');
  const input = found.input.parse(rawInput);
  const result = await (found as unknown as AiTool<unknown>).run(ctx, input);
  const method = `ai.method.${found.name}` as const;
  const { json, truncated } = fit({ ...result, method });
  return { output: { ...result, method, truncated }, json };
}
