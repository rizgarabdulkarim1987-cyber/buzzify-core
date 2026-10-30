import { INSUFFICIENT_DATA, type AssistantTool, type ForecastEstimate, type ProposalInput } from '@/server/domain/pharmacy/assistant-domain';
import type { AnswerReason } from '@/server/pharmacy/assistant/assistant';
import type { ToolOutput } from '@/server/pharmacy/assistant/tool-shapes';

/**
 * The assistant screen, pure (phase 7, R7-6 and R7-7). The server answers with tables (the source of truth), a reason code when it
 * could not use the model, and prose only when the figures in it were checked against the tables. This file turns that into what the
 * screen says: which notice, which refusal, whether any prose may be shown. A raw reason code is never shown; a reason this screen
 * does not know reads as "the assistant is not available". Nothing here reads or writes storage: a question is never kept.
 */

export const MAX_QUESTION = 1000;

export interface AnswerLite {
  answer: string | null;
  grounded: boolean;
  tables: ToolOutput[];
  period: { from: string; to: string } | null;
  branches: string[];
  dataAsOf: string;
  links: Array<{ tool: AssistantTool; href: string }>;
  label: 'fact' | 'estimate';
  degraded?: true;
  reason?: AnswerReason;
  forecast?: ForecastEstimate;
}

export const KNOWN_REASONS: readonly AnswerReason[] = [
  'NO_AI_PERMISSION',
  'NO_TOOL',
  'AI_PRICING_NOT_SET',
  'AI_PRICING_MODEL_MISMATCH',
  'AI_NOT_IN_PLAN',
  'AI_NOT_CONFIGURED',
  'AI_INPUT_TOO_LARGE',
  'AI_BUDGET_REACHED',
  'EXTRACTION_IN_PROGRESS',
  'LEASE_LOST',
  'AI_TIMEOUT',
  'AI_PROVIDER_ERROR',
  'AI_REFUSED',
  'UNGROUNDED',
  'CLINICAL',
  'UNSAFE_STOCK',
  'PRODUCT_NEEDED',
];

export function questionState(text: string): { length: number; left: number; empty: boolean; tooLong: boolean } {
  const length = text.length;
  return { length, left: MAX_QUESTION - length, empty: text.trim() === '', tooLong: length > MAX_QUESTION };
}

// Starters -----------------------------------------------------------------------------------------------------------------

export interface Starter {
  tool: AssistantTool;
  /** The fixed English question sent to the server. It names its tool by keyword, so it works with no model at all. */
  question: string;
  /** What else the question needs: a batch for the transfer question. */
  needs: 'batch' | null;
}

export const STARTERS: readonly Starter[] = [
  { tool: 'batches_expiring', question: 'Which batches are expiring soon?', needs: null },
  { tool: 'stock_below_reorder', question: 'What is below the reorder level?', needs: null },
  { tool: 'slow_movers', question: 'Which products are slow movers?', needs: null },
  { tool: 'transfer_candidates', question: 'Where could this batch be transferred?', needs: 'batch' },
  { tool: 'unpaid_supplier_invoices', question: 'Which supplier invoices are unpaid?', needs: null },
  { tool: 'margin_change', question: 'How did the margin change?', needs: null },
];

// Describing an answer -----------------------------------------------------------------------------------------------------

export type NoticeKey = 'noAi' | 'noTool' | 'budget' | 'provider' | 'ungrounded' | 'unavailable';
export type RefusalKey = 'clinical' | 'unsafeStock' | 'productNeeded' | 'insufficientData';

const NOTICE_OF: Partial<Record<AnswerReason, NoticeKey>> = {
  NO_AI_PERMISSION: 'noAi',
  NO_TOOL: 'noTool',
  AI_BUDGET_REACHED: 'budget',
  EXTRACTION_IN_PROGRESS: 'provider',
  LEASE_LOST: 'provider',
  AI_TIMEOUT: 'provider',
  AI_PROVIDER_ERROR: 'provider',
  AI_REFUSED: 'provider',
  UNGROUNDED: 'ungrounded',
};

const REFUSAL_OF: Partial<Record<AnswerReason, RefusalKey>> = { CLINICAL: 'clinical', UNSAFE_STOCK: 'unsafeStock', PRODUCT_NEEDED: 'productNeeded' };

export interface AnswerView {
  /** The model's prose; only when it was checked against the tables. */
  prose: string | null;
  notices: NoticeKey[];
  refusal: RefusalKey | null;
  showTables: boolean;
  estimate: boolean;
  forecast: { units: number; from: string; to: string; weeks: number } | null;
}

export function describeAnswer(a: AnswerLite): AnswerView {
  const refusal: RefusalKey | null = (a.reason ? REFUSAL_OF[a.reason] : undefined) ?? (a.answer === INSUFFICIENT_DATA ? 'insufficientData' : null);
  const notices: NoticeKey[] = [];
  if (a.degraded && !refusal) notices.push((a.reason ? NOTICE_OF[a.reason] : undefined) ?? 'unavailable');
  const forecast = a.forecast ? { units: a.forecast.nextWeekUnits, from: a.forecast.basisFrom, to: a.forecast.basisTo, weeks: a.forecast.weeksOfHistory } : null;
  const prose = a.answer !== null && a.grounded && !a.degraded && !a.reason && !refusal && !forecast ? a.answer : null;
  return { prose, notices, refusal, showTables: a.tables.length > 0, estimate: a.label === 'estimate', forecast };
}

// Proposals ----------------------------------------------------------------------------------------------------------------

/** Only product and batch ids, branch ids and whole quantities travel into a proposal: never a name, a figure of money or free text. */
export function proposalFromRow(tool: AssistantTool, row: Record<string, unknown>, ctx: { productId?: string } = {}): ProposalInput | null {
  const qty = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null);
  if (tool === 'transfer_candidates') {
    const n = qty(row.suggestedQty);
    if (n === null || !ctx.productId || typeof row.fromBranchId !== 'string' || typeof row.toBranchId !== 'string') return null;
    return { kind: 'TRANSFER', fromBranchId: row.fromBranchId, toBranchId: row.toBranchId, lines: [{ productId: ctx.productId, qty: n }] };
  }
  if (tool === 'stock_below_reorder') {
    const n = qty(row.reorderQty);
    if (n === null || typeof row.productId !== 'string') return null;
    return { kind: 'REORDER', lines: [{ productId: row.productId, qty: n }] };
  }
  if (tool === 'batches_expiring') {
    const n = qty(row.units);
    if (n === null || typeof row.productId !== 'string' || typeof row.batchId !== 'string') return null;
    return { kind: 'SUPPLIER_RETURN', lines: [{ productId: row.productId, batchId: row.batchId, qty: n }] };
  }
  return null;
}

/** Which proposal a table row may offer, for a role with these keys; null when none (the control is then not shown). */
export function rowAction(tool: AssistantTool, caps: { ai: boolean; transfer: boolean; purchase: boolean }): ProposalInput['kind'] | null {
  if (!caps.ai) return null;
  if (tool === 'transfer_candidates') return caps.transfer ? 'TRANSFER' : null;
  if (tool === 'stock_below_reorder') return caps.purchase ? 'REORDER' : null;
  if (tool === 'batches_expiring') return caps.purchase ? 'SUPPLIER_RETURN' : null;
  return null;
}

export type ProposalStateKey = 'open' | 'accepted' | 'dismissed';

export const proposalState = (p: { status: 'PROPOSED' | 'ACCEPTED' | 'DISMISSED' }): ProposalStateKey => (p.status === 'PROPOSED' ? 'open' : p.status === 'ACCEPTED' ? 'accepted' : 'dismissed');

/** Where an accepted proposal opens its draft. */
export const DRAFT_HREF: Record<ProposalInput['kind'], string> = {
  TRANSFER: '/pharmacy/stock/transfers/new',
  REORDER: '/pharmacy/purchasing/orders/new',
  SUPPLIER_RETURN: '/pharmacy/purchasing/returns/new',
};
