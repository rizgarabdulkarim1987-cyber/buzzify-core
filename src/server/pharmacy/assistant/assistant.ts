import { baghdadDayOf } from '@/lib/baghdad';
import {
  addDays,
  CLINICAL_REFUSAL,
  chooseToolsByKeyword,
  classifyQuestion,
  INSUFFICIENT_DATA,
  mayUseTool,
  seasonalNaive,
  toolsOf,
  UNSAFE_STOCK_REFUSAL,
  type AssistantTool,
  type ForecastEstimate,
} from '@/server/domain/pharmacy/assistant-domain';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { StudioError } from '@/server/studio/framework/result';
import { scopeOf, windowOf } from '../reports-common';
import { assertStaff } from '../receipts';
import { checkAnswer } from './grounding';
import { buildChooseInput, buildPhraseInput } from './injection';
import { AssistantDegraded, specsOf, type AssistantProvider, type DegradeReason } from './provider';
import { runTool, type ToolEnv } from './tools';
import { toolInputs, type Period, type ToolOutput } from './tool-shapes';

/**
 * `ask` (R7-6): the whole of an assistant answer. Code decides everything that matters:
 *  - the tools run are chosen from the QUESTION alone (keywords; the model only when no keyword matches), never from data;
 *  - the tables are computed by the tool layer; the model, when it is used and allowed, only phrases them and is checked by
 *    `checkAnswer` (any figure the tables do not support makes the prose unusable and the plain tables come back instead);
 *  - questions about doses, diagnosis, interactions or substitutes, and about selling expired stock, get a fixed refusal and
 *    reach neither the tools nor the model;
 *  - a forecast is one sentence, `insufficient data`, until eight whole weeks of sales exist; then a seasonal-naive estimate
 *    computed here, labelled `estimate`;
 *  - a provider that fails, a budget that is spent, a missing `ai.use` or an unconfigured model never throws: the answer is the
 *    plain tables with `degraded: true` and a reason code. The model has no write tool: nothing here writes.
 */

export interface AskEnv extends ToolEnv {
  /** `null` when the person may not use the model (no `ai.use`): the tables come back plain. */
  provider: AssistantProvider | null;
}

export interface AskOptions {
  branchId?: string;
  /** For `transfer_candidates`, which names a batch. */
  batchId?: string;
  period?: Period;
  days?: 30 | 60 | 90 | 180;
}

export type AnswerReason = DegradeReason | 'CLINICAL' | 'UNSAFE_STOCK';

export interface AssistantAnswer {
  /** Prose (the model's, grounded; or a fixed sentence of the code). `null` when only the tables answer. */
  answer: string | null;
  /** False only when the model's prose was dropped because it held a figure or a claim the tables do not support. */
  grounded: boolean;
  tables: ToolOutput[];
  period: Period | null;
  branches: string[];
  dataAsOf: string;
  links: Array<{ tool: AssistantTool; href: string }>;
  label: 'fact' | 'estimate';
  degraded?: true;
  reason?: AnswerReason;
  /** The estimate behind a forecast answer, when there is one. */
  forecast?: ForecastEstimate;
}

const LINKS: Record<AssistantTool, string> = {
  batches_expiring: '/pharmacy/stock/expiry',
  stock_below_reorder: '/pharmacy/reports/lowStock',
  slow_movers: '/pharmacy/stock',
  transfer_candidates: '/pharmacy/stock/transfers',
  unpaid_supplier_invoices: '/pharmacy/purchasing/payables',
  margin_change: '/pharmacy/reports/margin',
};

const MAX_TOOLS = 3;
const SOLD = ['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL'] as const;

const base = (env: AskEnv, over: Partial<AssistantAnswer>): AssistantAnswer => ({
  answer: null,
  grounded: true,
  tables: [],
  period: null,
  branches: [],
  dataAsOf: env.now.toISOString(),
  links: [],
  label: 'fact',
  ...over,
});

/** The tool inputs a keyword choice uses: the options of the call, nothing from data. */
function inputFor(tool: AssistantTool, opts: AskOptions): Record<string, unknown> | null {
  switch (tool) {
    case 'batches_expiring':
      return { ...(opts.days ? { days: opts.days } : {}), ...(opts.branchId ? { branchId: opts.branchId } : {}) };
    case 'stock_below_reorder':
      return opts.branchId ? { branchId: opts.branchId } : {};
    case 'slow_movers':
    case 'margin_change':
      return { ...(opts.period ? { period: opts.period } : {}), ...(opts.branchId ? { branchId: opts.branchId } : {}) };
    case 'transfer_candidates':
      return opts.batchId ? { batchId: opts.batchId } : null;
    case 'unpaid_supplier_invoices':
      return {};
  }
}

type Plan = Array<{ tool: AssistantTool; input: Record<string, unknown> }>;

/** Tools the model picks when the question names none; anything off the list, repeated or badly shaped is ignored. */
async function chosenByModel(env: AskEnv, question: string, opts: AskOptions): Promise<Plan> {
  const allowed = toolsOf(env.ph.role);
  if (!env.provider || allowed.length === 0) return [];
  const reply = await env.provider({ stage: 'choose', ...buildChooseInput(question), tools: specsOf(allowed) });
  if (reply.kind !== 'tools') return [];
  const plan: Plan = [];
  for (const call of reply.calls) {
    const tool = allowed.find((t) => t === call.name);
    if (!tool || plan.some((p) => p.tool === tool)) continue;
    const base = typeof call.input === 'object' && call.input !== null && !Array.isArray(call.input) ? (call.input as Record<string, unknown>) : {};
    const input = tool === 'transfer_candidates' ? (opts.batchId ? { batchId: opts.batchId } : null) : { ...base, ...(opts.branchId && 'branchId' in toolInputs[tool].shape ? { branchId: opts.branchId } : {}) };
    if (input === null || !toolInputs[tool].safeParse(input).success) continue;
    plan.push({ tool, input });
    if (plan.length === MAX_TOOLS) break;
  }
  return plan;
}

/** Prose that tells a pharmacy to sell expired stock or gives medical advice is refused whatever the tables say. */
const unsafeProse = (text: string): boolean => classifyQuestion(text) === 'clinical' || classifyQuestion(text) === 'unsafe_stock';

export async function ask(env: AskEnv, question: string, opts: AskOptions = {}): Promise<AssistantAnswer> {
  assertStaff(env.ph);
  const text = question.trim();
  if (text === '' || text.length > 1000) throw new StudioError('INVALID', 'Check the highlighted fields', { question: 'Enter a question of up to 1000 characters' });

  const kind = classifyQuestion(text);
  if (kind === 'clinical') return base(env, { answer: CLINICAL_REFUSAL, reason: 'CLINICAL' });
  if (kind === 'unsafe_stock') return base(env, { answer: UNSAFE_STOCK_REFUSAL, reason: 'UNSAFE_STOCK' });
  if (kind === 'forecast') return forecast(env, opts);

  let plan: Plan = chooseToolsByKeyword(text)
    .slice(0, MAX_TOOLS)
    .flatMap((tool) => {
      const input = inputFor(tool, opts);
      return input === null ? [] : [{ tool, input }];
    });
  let reason: DegradeReason | undefined;
  if (plan.length === 0) {
    try {
      plan = await chosenByModel(env, text, opts);
    } catch (error) {
      reason = error instanceof AssistantDegraded ? error.reason : 'AI_PROVIDER_ERROR';
    }
    if (plan.length === 0) return base(env, { degraded: true, reason: reason ?? (env.provider ? 'NO_TOOL' : 'NO_AI_PERMISSION') });
  }
  // A tool the question names but the role may not use is a refusal, not a silent gap.
  for (const step of plan) if (!mayUseTool(env.ph.role, step.tool)) throw new StudioError('FORBIDDEN');

  const tables: ToolOutput[] = [];
  for (const step of plan) tables.push(await runTool(env, step.tool, step.input));
  const shown = {
    tables,
    period: tables.find((t) => t.period !== null)?.period ?? null,
    branches: [...new Set(tables.flatMap((t) => t.branches))],
    dataAsOf: env.now.toISOString(),
    links: tables.map((t) => ({ tool: t.tool, href: LINKS[t.tool] })),
  };

  if (!env.provider) return base(env, { ...shown, degraded: true, reason: reason ?? 'NO_AI_PERMISSION' });
  let prose: string;
  try {
    const reply = await env.provider({ stage: 'phrase', ...buildPhraseInput(text, tables) });
    prose = reply.kind === 'text' ? reply.text.trim() : '';
  } catch (error) {
    return base(env, { ...shown, degraded: true, reason: error instanceof AssistantDegraded ? error.reason : 'AI_PROVIDER_ERROR' });
  }
  if (prose === '') return base(env, { ...shown, degraded: true, reason: 'AI_PROVIDER_ERROR' });
  if (unsafeProse(prose) || !checkAnswer(prose, tables).grounded) return base(env, { ...shown, grounded: false, degraded: true, reason: 'UNGROUNDED' });
  return base(env, { ...shown, answer: prose });
}

/**
 * Demand over the next 7 days. Needs `report.view` like the reports it stands for. Without eight whole weeks of sales the answer
 * is the sentence `insufficient data` and nothing else; with them it is the units of the last full week, said by code and
 * labelled an estimate (seasonal-naive: next week looks like last week). The model is not involved.
 */
async function forecast(env: AskEnv, opts: AskOptions): Promise<AssistantAnswer> {
  if (!env.ph.role || !canPh(env.ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
  const scope = scopeOf(env.ph, opts.branchId);
  const today = baghdadDayOf(env.now);
  const week = { from: addDays(today, -7), to: addDays(today, -1) };
  const window = windowOf(week.from, week.to);
  const [first, last] = await Promise.all([
    env.scoped.phSale.aggregate({ where: { branchId: { in: scope.branchIds }, status: { in: [...SOLD] } }, _min: { completedAt: true } }),
    env.scoped.phSaleLine.aggregate({
      where: { sale: { branchId: { in: scope.branchIds }, status: { in: [...SOLD] }, completedAt: { gte: window.start, lt: window.endExclusive } } },
      _sum: { baseQty: true },
    }),
  ]);
  const firstSaleDay = first._min.completedAt ? baghdadDayOf(first._min.completedAt) : null;
  const estimate = seasonalNaive({ firstSaleDay, today, lastWeekUnits: last._sum.baseQty ?? 0 });
  const common = { branches: scope.branchIds, period: week };
  if (estimate === null) return base(env, { ...common, answer: INSUFFICIENT_DATA });
  return base(env, {
    ...common,
    answer: `Estimate: ${estimate.nextWeekUnits} units over the next 7 days, the same as ${estimate.basisFrom} to ${estimate.basisTo}.`,
    label: 'estimate',
    forecast: estimate,
  });
}
