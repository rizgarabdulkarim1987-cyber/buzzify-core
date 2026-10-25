import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DAY_MS, baghdadDay, baghdadDayOf } from '@/lib/baghdad';
import type { PosAiSummaryKind } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { AI_LOCALES } from '@/server/domain/pos/ai';
import { countNewComplaints } from '@/server/pos/complaints';
import { listLowStock } from '@/server/pos/inventory';
import { readRangeReport } from '@/server/pos/range-report';
import { AiOutputRejectedError } from './errors';
import { checkGrounding, collectNumbers, hasAccusation, periodNumbers } from './grounding';
import { requireAi } from './package';
import { systemPrompt } from './prompts';
import { MAX_TOKENS, modelFor } from './provider/models';
import { runAi, type AiEnv } from './run';
import { rangeReportShape } from './tool-shapes';
import { untrusted } from './untrusted';

/**
 * The morning summary: facts first, from the existing reports, then (on request) a few sentences phrased by the model over
 * those facts only. The phrasing is checked for numbers the facts do not contain, kept per period and language, and reused
 * until the facts change, so reading it again costs no request.
 */

export const SUMMARY_KINDS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const satisfies readonly PosAiSummaryKind[];
export const summaryInput = z.object({ kind: z.enum(SUMMARY_KINDS), locale: z.enum(AI_LOCALES) }).strict();

const LENGTH: Record<(typeof SUMMARY_KINDS)[number], number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 30 };

const shiftDay = (day: string, by: number) => baghdadDayOf(new Date(baghdadDay(day).start.getTime() + by * DAY_MS + 12 * 60 * 60 * 1000));

/** The period the summary covers: the 1, 7 or 30 whole Baghdad days that ended yesterday. */
export function summaryPeriod(kind: (typeof SUMMARY_KINDS)[number], today: string): { from: string; to: string } {
  const to = shiftDay(today, -1);
  return { from: shiftDay(to, 1 - LENGTH[kind]), to };
}

/** The period of the same length just before `period`. */
export function previousPeriod(period: { from: string; to: string }): { from: string; to: string } {
  const length = Math.round((baghdadDay(period.to).start.getTime() - baghdadDay(period.from).start.getTime()) / DAY_MS) + 1;
  const to = shiftDay(period.from, -1);
  return { from: shiftDay(to, 1 - length), to };
}

export async function buildSummaryFacts(db: AnyDb, restaurantId: string, period: { from: string; to: string }) {
  const [current, before, lowStock, newComplaints] = await Promise.all([
    readRangeReport(db, restaurantId, period),
    readRangeReport(db, restaurantId, previousPeriod(period)),
    listLowStock(db, restaurantId, false),
    countNewComplaints(db, restaurantId),
  ]);
  const shape = rangeReportShape(current);
  return {
    period,
    days: shape.count,
    totals: shape.totals,
    topProducts: shape.topProducts.slice(0, 3).map((p) => ({ name: p.name, quantity: p.quantity, sales: p.sales })),
    previous: { period: previousPeriod(period), grossSales: before.totals.grossSales, netSales: before.totals.netSales, purchasesTotal: before.totals.purchasesTotal },
    lowStockCount: lowStock.length,
    newComplaints,
  };
}

export type SummaryFacts = Awaited<ReturnType<typeof buildSummaryFacts>>;

export const factsHash = (facts: SummaryFacts) => createHash('sha256').update(JSON.stringify(facts)).digest('hex');

export interface SummaryView {
  kind: (typeof SUMMARY_KINDS)[number];
  facts: SummaryFacts;
  /** The phrased text kept for these facts, or null when none was written yet or the facts changed since. */
  text: string | null;
}

export async function readSummary(db: AnyDb, restaurantId: string, rawInput: unknown, now = new Date()): Promise<SummaryView> {
  const input = summaryInput.parse(rawInput);
  const period = summaryPeriod(input.kind, baghdadDayOf(now));
  const facts = await buildSummaryFacts(db, restaurantId, period);
  const kept = await db.posAiSummary.findUnique({
    where: { restaurantId_kind_periodFrom_periodTo_locale: { restaurantId, kind: input.kind, periodFrom: period.from, periodTo: period.to, locale: input.locale } },
    select: { factsHash: true, text: true },
  });
  return { kind: input.kind, facts, text: kept && kept.factsHash === factsHash(facts) ? kept.text : null };
}

/** Phrases the summary for a period and language, or returns the text already kept for the same facts without a request. */
export async function phraseSummary(env: AiEnv, rawInput: unknown, now = new Date()): Promise<{ text: string; cached: boolean }> {
  await requireAi(env.db, env.restaurantId);
  const input = summaryInput.parse(rawInput);
  const view = await readSummary(env.db, env.restaurantId, input, now);
  if (view.text !== null) return { text: view.text, cached: true };

  const { period } = view.facts;
  const hash = factsHash(view.facts);
  const system = systemPrompt('phrase', { locale: input.locale, today: baghdadDayOf(now) });
  const allowed = collectNumbers(view.facts);
  for (const n of periodNumbers(period.from, period.to, view.facts.previous.period.from, view.facts.previous.period.to)) allowed.add(n);

  const { text, model } = await runAi(env, {
    feature: 'SUMMARY',
    now,
    work: async (call) => {
      const res = await call({
        purpose: 'phrase',
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: untrusted('toolResult', JSON.stringify(view.facts)) }] }],
        maxTokens: MAX_TOKENS.phrase,
      });
      const written = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n').trim();
      if (written === '' || !checkGrounding(written, allowed).ok || hasAccusation(written)) throw new AiOutputRejectedError();
      return { text: written, model: res.model || modelFor('phrase') };
    },
  });
  await env.db.posAiSummary.upsert({
    where: { restaurantId_kind_periodFrom_periodTo_locale: { restaurantId: env.restaurantId, kind: input.kind, periodFrom: period.from, periodTo: period.to, locale: input.locale } },
    create: { restaurantId: env.restaurantId, kind: input.kind, periodFrom: period.from, periodTo: period.to, locale: input.locale, factsHash: hash, text, model },
    update: { factsHash: hash, text, model },
  });
  return { text, cached: false };
}
