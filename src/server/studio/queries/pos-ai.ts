import { z } from 'zod';
import { baghdadDayOf } from '@/lib/baghdad';
import { readAlerts } from '@/server/ai/alerts';
import { guardedAi } from '@/server/ai/ai-error-code';
import { getAiPackage, requireAi } from '@/server/ai/package';
import { readSummary, summaryInput } from '@/server/ai/summary';
import { getAiUsage } from '@/server/ai/usage';
import { countUnlabeledComplaints } from '@/server/pos/complaint-ai-labels';
import { listComplaints } from '@/server/pos/complaints';
import { dayField } from '@/server/pos/report';
import { defineQuery, type QueryContext } from '@/server/studio/framework/query';

/** The AI package's till queries. Every one answers { ok: true, … } or { ok: false, code } while the package is off. */

const TILL = { kind: 'pos' } as const;

function restaurantOf(ctx: QueryContext): string {
  if (ctx.restaurantId === null) throw new Error('A till query ran without a restaurant');
  return ctx.restaurantId;
}

/** Whether the package is on and this month's use, for the till frame's navigation and the package page. Every role may ask. */
export const posAiState = defineQuery({
  name: 'pos.aiState',
  permission: null,
  pos: 'pin.own',
  input: z.object({}),
  target: () => TILL,
  run: async (ctx) => {
    const restaurantId = restaurantOf(ctx);
    const pkg = await getAiPackage(ctx.db, restaurantId);
    const usage = pkg.enabled ? await getAiUsage(ctx.db, restaurantId, pkg.monthlyLimit, new Date()) : null;
    return { enabled: pkg.enabled, limit: pkg.monthlyLimit, used: usage?.used ?? 0, syncedAt: pkg.syncedAt };
  },
});

export const posAiSummary = defineQuery({
  name: 'pos.aiSummary',
  permission: null,
  pos: 'report.view',
  input: summaryInput,
  target: () => TILL,
  run: (ctx, input) =>
    guardedAi(async () => {
      const restaurantId = restaurantOf(ctx);
      await requireAi(ctx.db, restaurantId);
      return { summary: await readSummary(ctx.db, restaurantId, input) };
    }),
});

export const posAiAlerts = defineQuery({
  name: 'pos.aiAlerts',
  permission: null,
  pos: 'report.view',
  input: z.object({ day: dayField.optional() }),
  target: () => TILL,
  run: (ctx, input) =>
    guardedAi(async () => {
      const restaurantId = restaurantOf(ctx);
      await requireAi(ctx.db, restaurantId);
      return { alerts: await readAlerts(ctx.db, restaurantId, { day: input.day ?? baghdadDayOf(new Date()) }) };
    }),
});

/** Recent complaints with the AI's suggestions beside the guest's own category. No contact, no table, no order. */
export const posAiComplaintLabels = defineQuery({
  name: 'pos.aiComplaintLabels',
  permission: null,
  pos: 'complaint.manage',
  input: z.object({}),
  target: () => TILL,
  run: (ctx) =>
    guardedAi(async () => {
      const restaurantId = restaurantOf(ctx);
      await requireAi(ctx.db, restaurantId);
      const rows = await listComplaints(ctx.db, restaurantId, { take: 50 });
      const labels = await ctx.db.posComplaint.findMany({ where: { restaurantId, id: { in: rows.map((r) => r.id) } }, select: { id: true, aiCategory: true, aiSummary: true, languageGuess: true, aiLabeledAt: true } });
      const byId = new Map(labels.map((l) => [l.id, l]));
      return {
        complaints: rows.map((r) => ({ id: r.id, excerpt: r.excerpt, createdAt: r.createdAt, category: r.category, aiCategory: byId.get(r.id)?.aiCategory ?? null, aiSummary: byId.get(r.id)?.aiSummary ?? null, language: byId.get(r.id)?.languageGuess ?? null, labeled: byId.get(r.id)?.aiLabeledAt != null })),
        pending: await countUnlabeledComplaints(ctx.db, restaurantId),
      };
    }),
});
