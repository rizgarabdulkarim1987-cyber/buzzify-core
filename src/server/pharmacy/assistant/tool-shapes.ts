import { z } from 'zod';
import type { AssistantTool } from '@/server/domain/pharmacy/assistant-domain';

/**
 * The input and output shapes of the six assistant tools (R7-6). Every shape is strict: a key not listed here cannot reach the
 * answer or the model (this is the whitelist). Outputs are plain numbers, ids and strings; money is a string of minor units beside
 * its currency and is never added across currencies. Cost keys are optional: ABSENT (not null) for a role without `cost.view`.
 */

const idText = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD');
const currency = z.enum(['IQD', 'USD']);
const minor = z.string().regex(/^-?\d+$/);

export const periodShape = z.object({ from: day, to: day }).strict();
export type Period = z.infer<typeof periodShape>;

export const EXPIRY_DAYS = [30, 60, 90, 180] as const;

export const toolInputs = {
  batches_expiring: z.object({ days: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]).default(90), branchId: idText.optional() }).strict(),
  stock_below_reorder: z.object({ branchId: idText.optional() }).strict(),
  slow_movers: z.object({ period: periodShape.optional(), branchId: idText.optional() }).strict(),
  transfer_candidates: z.object({ batchId: idText }).strict(),
  unpaid_supplier_invoices: z.object({}).strict(),
  margin_change: z.object({ period: periodShape.optional(), branchId: idText.optional() }).strict(),
} satisfies Record<AssistantTool, z.ZodType>;

/** What every answer of a tool says about itself. */
const envelope = <N extends AssistantTool>(tool: N) => ({
  tool: z.literal(tool),
  /** When the data was read (ISO). */
  dataAsOf: z.string(),
  period: periodShape.nullable(),
  /** The branches the data covers (the person's own, or the one asked for). */
  branches: z.array(idText),
});

const productFields = { productId: idText, tradeName: z.string(), strength: z.string(), form: z.string() };

export const toolOutputs = {
  batches_expiring: z
    .object({
      ...envelope('batches_expiring'),
      days: z.number().int(),
      totals: z.object({ expired: z.number().int(), d30: z.number().int(), d60: z.number().int(), d90: z.number().int(), d180: z.number().int() }).strict(),
      rows: z.array(
        z
          .object({
            ...productFields,
            batchId: idText,
            lot: z.string(),
            branchId: idText,
            expiryDate: day,
            daysToExpiry: z.number().int(),
            band: z.string(),
            units: z.number().int(),
            unitCostMinor: minor.nullable().optional(),
            currency: currency.nullable().optional(),
          })
          .strict(),
      ),
      truncated: z.boolean(),
    })
    .strict(),
  stock_below_reorder: z
    .object({
      ...envelope('stock_below_reorder'),
      total: z.number().int(),
      rows: z.array(z.object({ ...productFields, branchId: idText, minQty: z.number().int(), sellable: z.number().int(), deficit: z.number().int(), reorderQty: z.number().int() }).strict()),
      truncated: z.boolean(),
    })
    .strict(),
  slow_movers: z
    .object({
      ...envelope('slow_movers'),
      days: z.number().int(),
      rows: z.array(z.object({ ...productFields, soldUnits: z.number().int(), onHandUnits: z.number().int() }).strict()),
      truncated: z.boolean(),
    })
    .strict(),
  transfer_candidates: z
    .object({
      ...envelope('transfer_candidates'),
      batch: z.object({ batchId: idText, productId: idText, tradeName: z.string(), lot: z.string(), expiryDate: day, status: z.string() }).strict(),
      /** Set when no move is suggested: the batch is expired or not active, and expired stock is never moved to be sold. */
      notSuggested: z.enum(['EXPIRED', 'NOT_ACTIVE']).nullable(),
      rows: z.array(z.object({ fromBranchId: idText, toBranchId: idText, availableAtSource: z.number().int(), destSellable: z.number().int(), destMinQty: z.number().int(), suggestedQty: z.number().int() }).strict()),
    })
    .strict(),
  unpaid_supplier_invoices: z
    .object({
      ...envelope('unpaid_supplier_invoices'),
      rows: z.array(
        z
          .object({
            invoiceId: idText,
            number: z.string(),
            supplierId: idText,
            supplierName: z.string(),
            currency,
            dueDate: day,
            daysOverdue: z.number().int(),
            dueBand: z.string(),
            status: z.string(),
            balanceMinor: minor.optional(),
          })
          .strict(),
      ),
      /** One total per currency; absent money keys without `cost.view`. */
      totals: z.array(z.object({ currency, count: z.number().int(), balanceMinor: minor.optional(), overdueMinor: minor.optional() }).strict()),
      truncated: z.boolean(),
    })
    .strict(),
  margin_change: z
    .object({
      ...envelope('margin_change'),
      previous: periodShape,
      /** Per currency; the two periods are of the same length. `changeBp` is the move of the margin rate in basis points. */
      byCurrency: z.array(
        z
          .object({
            currency,
            netMinor: minor,
            marginMinor: minor,
            marginBp: z.number().int().nullable(),
            previousNetMinor: minor,
            previousMarginMinor: minor,
            previousMarginBp: z.number().int().nullable(),
            changeBp: z.number().int().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
} satisfies Record<AssistantTool, z.ZodType>;

export type ToolInput<T extends AssistantTool> = z.input<(typeof toolInputs)[T]>;
export type ToolOutput<T extends AssistantTool = AssistantTool> = { [K in AssistantTool]: z.output<(typeof toolOutputs)[K]> }[T];

/** The tools as the model sees them: a name, a sentence and a JSON schema. Descriptions are fixed text, never data. */
export const TOOL_SPECS: Record<AssistantTool, { description: string; inputSchema: Record<string, unknown> }> = {
  batches_expiring: { description: 'Batches that are expired or expire within a number of days (30, 60, 90 or 180), optionally for one branch.', inputSchema: { type: 'object', properties: { days: { type: 'integer', enum: [30, 60, 90, 180] }, branchId: { type: 'string' } } } },
  stock_below_reorder: { description: 'Products whose sellable stock is below the branch minimum, optionally for one branch.', inputSchema: { type: 'object', properties: { branchId: { type: 'string' } } } },
  slow_movers: { description: 'Products in stock that sold least in a period (default the last 30 days).', inputSchema: { type: 'object', properties: { period: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }, branchId: { type: 'string' } } } },
  transfer_candidates: { description: 'Where the stock of one batch could be moved to cover a shortage in another branch.', inputSchema: { type: 'object', properties: { batchId: { type: 'string' } }, required: ['batchId'] } },
  unpaid_supplier_invoices: { description: 'Supplier invoices still owed, oldest due first, with totals per currency.', inputSchema: { type: 'object', properties: {} } },
  margin_change: { description: 'The margin of a period against the period just before it, per currency.', inputSchema: { type: 'object', properties: { period: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } }, branchId: { type: 'string' } } } },
};
