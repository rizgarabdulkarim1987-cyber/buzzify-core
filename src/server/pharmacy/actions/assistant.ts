import { z } from 'zod';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { ask } from '@/server/pharmacy/assistant/assistant';
import { gatedProvider } from '@/server/pharmacy/assistant/provider';
import { acceptProposal, createProposal, dismissProposal, proposalIdInput } from '@/server/pharmacy/assistant/proposals';
import { periodShape } from '@/server/pharmacy/assistant/tool-shapes';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineAction } from '@/server/studio/framework/action';

/**
 * The daily assistant (phase 7, task 4; R7-6, R7-7).
 *
 * `ph.assistant.ask` is open to every staff role (`catalog.view`): what a person gets depends on what they may read. The model
 * (and so the budget) is used only with `ai.use`; without it, or when the provider fails or the month's budget is spent, the answer
 * is the plain tables (`degraded`), and a tool the role may not use is refused. It runs while the pharmacy is read-only (it reads,
 * and books only the AI budget). Audit: the tools run, row counts, the label and the degrade reason; never the question or the answer.
 *
 * The three proposal actions need `ai.use` and the permission of the draft the proposal hands over to; none of them creates a
 * transfer, order or return (see proposals.ts).
 */

export const askAction = defineAction({
  name: 'ph.assistant.ask',
  permission: null,
  ph: 'catalog.view',
  allowReadOnly: true,
  input: phPlaceInput.extend({
    question: z.string().trim().min(1, 'Enter a question').max(1000, 'Enter a question of up to 1000 characters'),
    batchId: z.string().min(1).max(64).optional(),
    productId: z.string().min(1).max(64).optional(),
    days: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]).optional(),
    period: periodShape.optional(),
    direct: z.boolean().optional(),
  }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    const now = new Date();
    const provider = canPh(ph.role!, 'ai.use') && !input.direct ? gatedProvider(ctx.db, ph.restaurantId, now) : null;
    const answer = await ask({ scoped, ph, now, provider }, input.question, {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.batchId ? { batchId: input.batchId } : {}),
      ...(input.productId ? { productId: input.productId } : {}),
      ...(input.days ? { days: input.days } : {}),
      ...(input.period ? { period: input.period } : {}),
      ...(input.direct ? { direct: true } : {}),
    });
    ctx.audit({
      action: 'ph.assistant.ask',
      entityType: 'PhAssistant',
      entityId: ph.restaurantId,
      changes: {
        tools: { before: null, after: answer.tables.map((t) => t.tool).join(',') },
        rows: { before: null, after: answer.tables.reduce((n, t) => n + ('rows' in t ? t.rows.length : 0), 0) },
        label: { before: null, after: answer.label },
        grounded: { before: null, after: answer.grounded },
        degraded: { before: null, after: answer.degraded ?? false },
        degradeReason: { before: null, after: answer.reason ?? null },
      },
    });
    return answer;
  },
});

export const proposalCreate = defineAction({
  name: 'ph.assistant.proposal.create',
  permission: null,
  ph: 'ai.use',
  input: phPlaceInput.extend({ proposal: z.unknown() }),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const made = await createProposal(tx, { ph, branchId: input.branchId, input: input.proposal });
      ctx.audit({
        action: 'ph.assistant.proposal.create',
        entityType: 'PhAiProposal',
        entityId: made.id,
        changes: { kind: { before: null, after: made.kind }, branchId: { before: null, after: made.branchId }, lines: { before: null, after: made.lines } },
      });
      return made;
    });
  },
});

export const proposalAccept = defineAction({
  name: 'ph.assistant.proposal.accept',
  permission: null,
  ph: 'ai.use',
  input: phPlaceInput.extend(proposalIdInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const done = await acceptProposal(tx, { ph, proposalId: input.proposalId });
      ctx.audit({
        action: 'ph.assistant.proposal.accept',
        entityType: 'PhAiProposal',
        entityId: done.id,
        changes: { status: { before: 'PROPOSED', after: 'ACCEPTED' }, kind: { before: null, after: done.kind }, lines: { before: null, after: done.prefill.lines.length } },
      });
      return done;
    });
  },
});

export const proposalDismiss = defineAction({
  name: 'ph.assistant.proposal.dismiss',
  permission: null,
  ph: 'ai.use',
  input: phPlaceInput.extend(proposalIdInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    return ctx.transaction(async (tx) => {
      const done = await dismissProposal(tx, { ph, proposalId: input.proposalId });
      ctx.audit({
        action: 'ph.assistant.proposal.dismiss',
        entityType: 'PhAiProposal',
        entityId: done.id,
        changes: { status: { before: 'PROPOSED', after: 'DISMISSED' }, kind: { before: null, after: done.kind } },
      });
      return done;
    });
  },
});
