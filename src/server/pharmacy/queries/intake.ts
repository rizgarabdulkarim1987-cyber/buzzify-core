import { z } from 'zod';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { fileUrl as signedFileUrl } from '@/server/pharmacy/intake/files';
import { usageView } from '@/server/pharmacy/intake/ai';
import { getIntakeStorage, IntakeStorageNotConfiguredError } from '@/server/pharmacy/intake/storage';
import { pharmacyOf } from '@/server/pharmacy/products';
import { assertStaff } from '@/server/pharmacy/receipts';
import { defineQuery } from '@/server/studio/framework/query';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Invoice intake, reading (R5-14): seeing an uploaded invoice is `purchase.manage`. The URL is signed per request after the
 * access check, lives five minutes and is never stored. A support actor reads none.
 */

export const fileUrl = defineQuery({
  name: 'ph.intake.file.url',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput.extend({ fileId: z.string().min(1).max(64) }),
  target: phTargetOf,
  async run(ctx, input) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    try {
      return await signedFileUrl(scoped, getIntakeStorage(), input.fileId);
    } catch (error) {
      if (error instanceof IntakeStorageNotConfiguredError) {
        throw new StudioError('CONFLICT', 'Invoice upload is not set up yet', { phCode: error.code });
      }
      throw error;
    }
  },
});

/**
 * This month's AI usage (R5-12): needs `purchase.manage` (the framework) and `report.view` (here). The counts are for both; the
 * money keys are present only for a role with `cost.view`. Business-wide: the branch only names the place of the request.
 */
export const usage = defineQuery({
  name: 'ph.intake.usage',
  permission: null,
  ph: 'purchase.manage',
  input: phPlaceInput,
  target: phTargetOf,
  async run(ctx) {
    const { ph, scoped } = pharmacyOf(ctx);
    assertStaff(ph);
    if (!canPh(ph.role!, 'report.view')) throw new StudioError('FORBIDDEN');
    return usageView(scoped, ph, new Date());
  },
});
