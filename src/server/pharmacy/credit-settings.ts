import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Whether the business sells on credit (phase 7, R7-5): one switch, off by default, the owner's (`settings.manage`). Saved with
 * the settings row's version. The audit carries the switch and nothing else.
 */

const WHOLE = 'Enter a whole number';

export const creditSettingsInput = z.object({
  creditEnabled: z.boolean(),
  /** The version of the settings the person started from. */
  version: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more'),
});
export type CreditSettingsInput = z.infer<typeof creditSettingsInput>;

export interface CreditSettings {
  creditEnabled: boolean;
  version: number;
}

export async function getCreditSettings(scoped: ScopedClient | ScopedTx): Promise<CreditSettings> {
  const row = await scoped.phSettings.findFirst({ select: { creditEnabled: true, version: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  return row;
}

export async function setCreditSettings(tx: ScopedTx, input: CreditSettingsInput): Promise<{ before: CreditSettings; after: CreditSettings }> {
  const row = await tx.phSettings.findFirst({ select: { id: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  const before = await getCreditSettings(tx);
  await updateWithVersion(tx.phSettings, { id: row.id, version: input.version, data: { creditEnabled: input.creditEnabled }, entityType: 'PhSettings' }, tx);
  return { before, after: { creditEnabled: input.creditEnabled, version: input.version + 1 } };
}
