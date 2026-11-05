import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The display-only exchange rate (IQD per 1 USD) the cashier header shows. Nothing is charged or converted with it: the
 * customer pays in the shift's currency. Owner's (`settings.manage`), saved with the settings row's version, default 1450.
 */

export const DEFAULT_USD_RATE = 1450;
export const MAX_USD_RATE = 1_000_000;

const WHOLE = 'Enter a whole number';

export const exchangeRateInput = z.object({
  usdRate: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(MAX_USD_RATE, `Use ${MAX_USD_RATE} or less`),
  /** The version of the settings the person started from. */
  version: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more'),
});
export type ExchangeRateInput = z.infer<typeof exchangeRateInput>;

export async function setExchangeRate(tx: ScopedTx, input: ExchangeRateInput): Promise<{ before: number; after: { usdRate: number; version: number } }> {
  const row = await tx.phSettings.findFirst({ select: { id: true, usdRate: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  await updateWithVersion(tx.phSettings, { id: row.id, version: input.version, data: { usdRate: input.usdRate }, entityType: 'PhSettings' }, tx);
  return { before: row.usdRate, after: { usdRate: input.usdRate, version: input.version + 1 } };
}

export async function getExchangeRate(scoped: ScopedClient | ScopedTx): Promise<{ usdRate: number; version: number }> {
  const row = await scoped.phSettings.findFirst({ select: { usdRate: true, version: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  return row;
}
