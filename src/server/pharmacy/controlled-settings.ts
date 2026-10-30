import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';
import { updateWithVersion } from '@/server/studio/framework/concurrency';

/**
 * The controlled-drug settings of the business (phase 7, R7-1 and R7-4): whether controlled medicines may be sold at all, the
 * most of one a sale may carry (0 = no limit), and how many days prescriptions are kept (nothing is purged by this phase).
 * Saved with the settings row's version (`updateWithVersion`: a stale save is a `CONFLICT` naming who changed it last). The audit
 * carries the three values and nothing else.
 */

const WHOLE = 'Enter a whole number';

export const RX_RETENTION_DEFAULT_DAYS = 3650;

export const controlledSettingsInput = z.object({
  controlledEnabled: z.boolean(),
  controlledMaxQty: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(1_000_000, 'Enter a smaller number'),
  rxRetentionDays: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(36_500, 'Enter a smaller number'),
  /** The version of the settings the person started from. */
  version: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more'),
});
export type ControlledSettingsInput = z.infer<typeof controlledSettingsInput>;

export interface ControlledSettings {
  controlledEnabled: boolean;
  controlledMaxQty: number;
  rxRetentionDays: number;
  version: number;
}

/** The settings as they are now. A row made before phase 7 has no retention: it reads as the default of 10 years. */
export async function getControlledSettings(scoped: ScopedClient | ScopedTx): Promise<ControlledSettings> {
  const row = await scoped.phSettings.findFirst({ select: { controlledEnabled: true, controlledMaxQty: true, rxRetentionDays: true, version: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  return { controlledEnabled: row.controlledEnabled, controlledMaxQty: row.controlledMaxQty, rxRetentionDays: row.rxRetentionDays ?? RX_RETENTION_DEFAULT_DAYS, version: row.version };
}

/** Saves the three values if the row is still at `input.version`; returns the new settings and the old ones, for the audit. */
export async function setControlledSettings(tx: ScopedTx, input: ControlledSettingsInput): Promise<{ before: ControlledSettings; after: ControlledSettings }> {
  const row = await tx.phSettings.findFirst({ select: { id: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  const before = await getControlledSettings(tx);
  await updateWithVersion(
    tx.phSettings,
    {
      id: row.id,
      version: input.version,
      data: { controlledEnabled: input.controlledEnabled, controlledMaxQty: input.controlledMaxQty, rxRetentionDays: input.rxRetentionDays },
      entityType: 'PhSettings',
    },
    tx,
  );
  return {
    before,
    after: { controlledEnabled: input.controlledEnabled, controlledMaxQty: input.controlledMaxQty, rxRetentionDays: input.rxRetentionDays, version: input.version + 1 },
  };
}
