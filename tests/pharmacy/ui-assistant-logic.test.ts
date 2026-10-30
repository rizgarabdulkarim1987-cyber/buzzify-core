import { describe, expect, it } from 'vitest';
import {
  describeAnswer,
  KNOWN_REASONS,
  proposalFromRow,
  proposalState,
  questionState,
  rowAction,
  STARTERS,
  type AnswerLite,
} from '@/app/pharmacy/_ui/assistant-logic';
import { ASSISTANT_TOOLS, chooseToolsByKeyword, proposalInput } from '@/server/domain/pharmacy/assistant-domain';
import type { DegradeReason } from '@/server/pharmacy/assistant/provider';

const answer = (over: Partial<AnswerLite> = {}): AnswerLite => ({ answer: null, grounded: true, tables: [], period: null, branches: ['b1'], dataAsOf: '2026-11-01T09:00:00.000Z', links: [], label: 'fact', ...over });
const table = { tool: 'stock_below_reorder' as const, dataAsOf: '', period: null, branches: ['b1'], total: 1, rows: [], truncated: false };

describe('the question box', () => {
  it('counts up to 1000 characters and says when it is empty or too long', () => {
    expect(questionState('')).toEqual({ length: 0, left: 1000, empty: true, tooLong: false });
    expect(questionState('   ')).toMatchObject({ empty: true });
    expect(questionState('a'.repeat(1000))).toMatchObject({ left: 0, tooLong: false });
    expect(questionState('a'.repeat(1001))).toMatchObject({ left: -1, tooLong: true });
  });
});

describe('the starter questions', () => {
  it('has one for each of the six tools, and the fixed question reaches that tool by keyword alone (no model)', () => {
    expect(STARTERS.map((s) => s.tool).sort()).toEqual([...ASSISTANT_TOOLS].sort());
    for (const s of STARTERS) expect(chooseToolsByKeyword(s.question), s.tool).toEqual([s.tool]);
  });

  it('needs a batch only for the transfer question', () => {
    expect(STARTERS.filter((s) => s.needs === 'batch').map((s) => s.tool)).toEqual(['transfer_candidates']);
  });
});

describe('describing an answer', () => {
  it('shows model prose only when it is grounded and the answer is not degraded', () => {
    const view = describeAnswer(answer({ answer: 'Two products are below the minimum.', tables: [table] }));
    expect(view).toMatchObject({ prose: 'Two products are below the minimum.', notices: [], showTables: true, refusal: null });
  });

  it('withholds prose that is not grounded and says so, keeping the tables', () => {
    const view = describeAnswer(answer({ answer: 'Invented 99 figures', grounded: false, degraded: true, reason: 'UNGROUNDED', tables: [table] }));
    expect(view.prose).toBeNull();
    expect(view.notices).toEqual(['ungrounded']);
    expect(view.showTables).toBe(true);
  });

  it('maps each degrade reason to one notice and never to a raw code', () => {
    const expected: Record<DegradeReason, string> = {
      NO_AI_PERMISSION: 'noAi',
      NO_TOOL: 'noTool',
      AI_PRICING_NOT_SET: 'unavailable',
      AI_PRICING_MODEL_MISMATCH: 'unavailable',
      AI_NOT_IN_PLAN: 'unavailable',
      AI_NOT_CONFIGURED: 'unavailable',
      AI_INPUT_TOO_LARGE: 'unavailable',
      AI_BUDGET_REACHED: 'budget',
      EXTRACTION_IN_PROGRESS: 'provider',
      LEASE_LOST: 'provider',
      AI_TIMEOUT: 'provider',
      AI_PROVIDER_ERROR: 'provider',
      AI_REFUSED: 'provider',
      UNGROUNDED: 'ungrounded',
    };
    for (const [reason, notice] of Object.entries(expected)) {
      expect(describeAnswer(answer({ degraded: true, reason: reason as DegradeReason, tables: [table] })).notices, reason).toEqual([notice]);
    }
    expect(Object.keys(expected).sort()).toEqual([...KNOWN_REASONS].filter((r) => !['CLINICAL', 'UNSAFE_STOCK', 'PRODUCT_NEEDED'].includes(r)).sort());
    expect(describeAnswer(answer({ degraded: true, reason: 'SOMETHING_NEW' as DegradeReason })).notices).toEqual(['unavailable']);
  });

  it('turns the fixed refusals and the forecast sentences into plain explanations, not the server English', () => {
    expect(describeAnswer(answer({ answer: 'I cannot advise on doses', reason: 'CLINICAL' }))).toMatchObject({ prose: null, refusal: 'clinical', showTables: false });
    expect(describeAnswer(answer({ answer: 'I cannot suggest selling expired stock', reason: 'UNSAFE_STOCK' }))).toMatchObject({ prose: null, refusal: 'unsafeStock' });
    expect(describeAnswer(answer({ answer: 'Name a product', reason: 'PRODUCT_NEEDED' }))).toMatchObject({ prose: null, refusal: 'productNeeded' });
    expect(describeAnswer(answer({ answer: 'insufficient data', label: 'fact' }))).toMatchObject({ prose: null, refusal: 'insufficientData' });
  });

  it('describes a forecast from its numbers, labelled an estimate', () => {
    const view = describeAnswer(answer({ answer: 'Estimate: 14 units', label: 'estimate', forecast: { nextWeekUnits: 14, basisFrom: '2026-10-25', basisTo: '2026-10-31', weeksOfHistory: 9 } }));
    expect(view.prose).toBeNull();
    expect(view.forecast).toEqual({ units: 14, from: '2026-10-25', to: '2026-10-31', weeks: 9 });
    expect(view.estimate).toBe(true);
  });

  it('shows no table for a refusal and always shows the tables an answer has', () => {
    expect(describeAnswer(answer({ tables: [table] })).showTables).toBe(true);
    expect(describeAnswer(answer({ reason: 'CLINICAL', answer: 'x' })).showTables).toBe(false);
  });
});

describe('proposals from a table row', () => {
  const expiring = { productId: 'p1', batchId: 'bt1', units: 12, branchId: 'b1' };

  it('builds proposals that the server shape accepts, with ids and quantities only', () => {
    const transfer = proposalFromRow('transfer_candidates', { fromBranchId: 'b1', toBranchId: 'b2', suggestedQty: 5 }, { productId: 'p1' });
    const reorder = proposalFromRow('stock_below_reorder', { productId: 'p1', branchId: 'b1', reorderQty: 40 });
    const back = proposalFromRow('batches_expiring', expiring);
    expect(transfer).toEqual({ kind: 'TRANSFER', fromBranchId: 'b1', toBranchId: 'b2', lines: [{ productId: 'p1', qty: 5 }] });
    expect(reorder).toEqual({ kind: 'REORDER', lines: [{ productId: 'p1', qty: 40 }] });
    expect(back).toEqual({ kind: 'SUPPLIER_RETURN', lines: [{ productId: 'p1', batchId: 'bt1', qty: 12 }] });
    for (const p of [transfer, reorder, back]) expect(proposalInput.safeParse(p).success).toBe(true);
  });

  it('builds none for a row that cannot become one (zero quantity, or a tool without a proposal)', () => {
    expect(proposalFromRow('transfer_candidates', { fromBranchId: 'b1', toBranchId: 'b2', suggestedQty: 0 }, { productId: 'p1' })).toBeNull();
    expect(proposalFromRow('stock_below_reorder', { productId: 'p1', branchId: 'b1', reorderQty: 0 })).toBeNull();
    expect(proposalFromRow('slow_movers', { productId: 'p1' })).toBeNull();
    expect(proposalFromRow('margin_change', {})).toBeNull();
  });

  it('offers the action only to a role that may use the assistant and the draft the proposal hands over to', () => {
    expect(rowAction('transfer_candidates', { ai: true, transfer: true, purchase: false })).toBe('TRANSFER');
    expect(rowAction('transfer_candidates', { ai: true, transfer: false, purchase: true })).toBeNull();
    expect(rowAction('stock_below_reorder', { ai: true, transfer: false, purchase: true })).toBe('REORDER');
    expect(rowAction('batches_expiring', { ai: true, transfer: false, purchase: true })).toBe('SUPPLIER_RETURN');
    expect(rowAction('batches_expiring', { ai: false, transfer: true, purchase: true })).toBeNull();
    expect(rowAction('slow_movers', { ai: true, transfer: true, purchase: true })).toBeNull();
  });
});

describe('proposal state', () => {
  it('tells an open proposal from a decided one', () => {
    expect(proposalState({ status: 'PROPOSED' })).toBe('open');
    expect(proposalState({ status: 'ACCEPTED' })).toBe('accepted');
    expect(proposalState({ status: 'DISMISSED' })).toBe('dismissed');
  });
});
