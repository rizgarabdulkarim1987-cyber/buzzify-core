import { z } from 'zod';
import { delegates } from '@/server/data/tenant-db';
import { guardedAi } from '@/server/ai/ai-error-code';
import { askBuzzify, askInput } from '@/server/ai/ask';
import { suggestComplaintLabels } from '@/server/ai/complaints';
import { writeAiPackage } from '@/server/ai/package';
import { extractSupplyDraft, supplyInput } from '@/server/ai/supply';
import { phraseSummary, summaryInput } from '@/server/ai/summary';
import { defineAction, type ActionContext } from '@/server/studio/framework/action';
import { setComplaintAiLabels } from '@/server/pos/complaint-ai-labels';
import { idField } from '@/server/studio/services/content';

/** The AI package of a restaurant: only a Super Admin switches it (payment is arranged by hand), and every change is audited. */

export const setPosAiPackage = defineAction({
  name: 'pos.setAiPackage',
  permission: 'platform.settings',
  input: z.object({ restaurantId: idField, enabled: z.boolean(), monthlyLimit: z.number().int().min(0).max(1_000_000).optional() }),
  target: () => ({ kind: 'platform' }) as const,
  run: (ctx, input) =>
    ctx.transactionIn({ restaurantId: input.restaurantId }, async (tx) => {
      const { before, after } = await writeAiPackage(delegates(tx), input.restaurantId, { enabled: input.enabled, ...(input.monthlyLimit === undefined ? {} : { monthlyLimit: input.monthlyLimit }) });
      ctx.audit({
        action: 'pos.ai.package',
        entityType: 'PosAiPackage',
        entityId: input.restaurantId,
        changes: { enabled: { before: before.enabled, after: after.enabled }, monthlyLimit: { before: before.monthlyLimit, after: after.monthlyLimit } },
      });
      return { enabled: after.enabled, monthlyLimit: after.monthlyLimit };
    }),
});

// Till definitions. Online only (not in OP_KINDS). Each answers { ok: true, … } or { ok: false, code } so a refusal of the AI
// package never reaches the person as an exception message.

const TILL = { kind: 'pos' } as const;

function till(ctx: ActionContext) {
  if (ctx.pos === null || ctx.restaurantId === null) throw new Error('A till action ran without a till');
  return { env: { db: ctx.db, restaurantId: ctx.restaurantId, staffId: ctx.pos.userId }, role: ctx.pos.role };
}

export const phrasePosAiSummary = defineAction({
  name: 'pos.aiPhraseSummary',
  permission: null,
  pos: 'report.view',
  input: summaryInput,
  target: () => TILL,
  run: (ctx, input) => guardedAi(() => phraseSummary(till(ctx).env, input)),
});

export const askPosAi = defineAction({
  name: 'pos.aiAsk',
  permission: null,
  pos: 'report.view',
  input: askInput,
  target: () => TILL,
  run: (ctx, input) => {
    const { env, role } = till(ctx);
    return guardedAi(async () => ({ answer: await askBuzzify({ ...env, role }, input) }));
  },
});

/** Suggests labels for complaints nobody labeled (at most one batch), then saves them with one audit row that holds only a count. */
export const labelPosComplaints = defineAction({
  name: 'pos.aiLabelComplaints',
  permission: null,
  pos: 'complaint.manage',
  input: z.object({}).strict(),
  target: () => TILL,
  run: (ctx) =>
    guardedAi(async () => {
      const { env } = till(ctx);
      const { labels, pending } = await suggestComplaintLabels(env);
      if (labels.length === 0) return { labeled: 0, pending };
      const labeled = await ctx.transaction(async (tx) => {
        const { count } = await setComplaintAiLabels(delegates(tx), env.restaurantId, labels);
        ctx.audit({ action: 'pos.ai.complaint.label', entityType: 'PosAiPackage', entityId: env.restaurantId, changes: { labeled: { before: null, after: count } } });
        return count;
      });
      return { labeled, pending };
    }),
});

/** Reads an invoice into a draft for a person to check. Saves nothing: the draft is saved by the purchase form's own action. */
export const extractPosSupply = defineAction({
  name: 'pos.aiSupplyExtract',
  permission: null,
  pos: 'purchase.manage',
  input: supplyInput,
  target: () => TILL,
  run: (ctx, input) => guardedAi(async () => ({ draft: await extractSupplyDraft(till(ctx).env, input) })),
});
