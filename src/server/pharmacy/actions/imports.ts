import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import {
  APPLY_TIMEOUT_MS,
  applyImport,
  firstRowsWithIssues,
  importApplyInput,
  importPreviewInput,
  prepareImport,
  PREVIEW_TIMEOUT_MS,
  storeImport,
} from '@/server/pharmacy/imports';
import { pharmacyOf } from '@/server/pharmacy/products';
import { defineAction } from '@/server/studio/framework/action';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The catalog import (`import.apply`): preview a file, then apply the preview. A support actor runs no action, and the
 * read-only state refuses both (only reads and exports run then). The audit rows carry counts and the batch id, never a
 * row's contents.
 */

export const preview = defineAction({
  name: 'ph.imports.preview',
  permission: null,
  ph: 'import.apply',
  input: importPreviewInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    const prepared = await prepareImport(scoped, ph, input);
    const batchId = await ctx.transaction(async (tx) => {
      const id = await storeImport(tx, ph, prepared);
      ctx.audit({
        action: 'ph.import.preview',
        entityType: 'PhImportBatch',
        entityId: id,
        changes: {
          status: { before: null, after: 'PREVIEWED' },
          rows: { before: null, after: prepared.summary.rows },
          ok: { before: null, after: prepared.summary.ok },
          warnings: { before: null, after: prepared.summary.warnings },
          errors: { before: null, after: prepared.summary.errors },
          duplicates: { before: null, after: prepared.summary.duplicates },
          ...(prepared.duplicateOf !== null
            ? { duplicateOf: { before: null, after: prepared.duplicateOf }, overrideReason: { before: null, after: input.overrideReason ?? null } }
            : {}),
        },
      });
      return id;
    }, { timeoutMs: PREVIEW_TIMEOUT_MS });
    return {
      batchId,
      batchHash: prepared.batchHash,
      suggestedMapping: prepared.suggestedMapping,
      mapping: prepared.config.columns,
      summary: prepared.summary,
      firstRowsWithIssues: firstRowsWithIssues(prepared.rows),
    };
  },
});

export const apply = defineAction({
  name: 'ph.imports.apply',
  permission: null,
  ph: 'import.apply',
  input: importApplyInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph } = pharmacyOf(ctx);
    try {
      return await ctx.transaction(async (tx) => {
        const applied = await applyImport(tx, ph, input);
        if (!applied.alreadyApplied) {
          ctx.audit({
            action: 'ph.import.apply',
            entityType: 'PhImportBatch',
            entityId: input.batchId,
            changes: {
              status: { before: 'PREVIEWED', after: 'COMMITTED' },
              created: { before: null, after: applied.created },
              prices: { before: null, after: applied.prices },
              skipped: { before: null, after: applied.skipped },
              excluded: { before: null, after: applied.excluded },
              acceptWarnings: { before: null, after: input.acceptWarnings },
            },
          });
        }
        return applied;
      }, { timeoutMs: APPLY_TIMEOUT_MS });
    } catch (error) {
      // A product or barcode saved at the same moment by someone else (the database refused the second copy): the
      // preview no longer says what would happen.
      if ((error as { code?: unknown } | null)?.code === 'P2002') {
        throw new StudioError('CONFLICT', 'This import changed since its preview. Preview the file again.', { phCode: 'BATCH_STALE' });
      }
      throw error;
    }
  },
});
