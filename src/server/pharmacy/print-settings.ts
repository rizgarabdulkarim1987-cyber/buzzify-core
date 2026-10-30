import { z } from 'zod';
import type { ScopedClient, ScopedTx } from '@/server/data/tenant-db';
import { readPrintSettings, withWorkstation, workstationName, workstationSettings, type PrintSettings } from '@/server/domain/pharmacy/print-settings';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

/**
 * Printing settings per workstation (phase 7, R7-8): paper, margins, the default label size. They live in `PhSettings.print`
 * (JSON, validated by `printSettings`, strict). Saved with the settings row's version; the owner's (`settings.manage`). Nothing
 * here prints, and nothing here is personal data. The audit carries the workstation's name and the values, nothing else.
 */

const WHOLE = 'Enter a whole number';

export const printSettingsInput = z.object({
  workstation: workstationName,
  settings: workstationSettings,
  /** The version of the settings row the person started from. */
  version: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more'),
});
export type PrintSettingsInput = z.infer<typeof printSettingsInput>;

export interface PrintSettingsView {
  print: PrintSettings;
  version: number;
}

export async function getPrintSettings(scoped: ScopedClient | ScopedTx): Promise<PrintSettingsView> {
  const row = await scoped.phSettings.findFirst({ select: { print: true, version: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  return { print: readPrintSettings(row.print), version: row.version };
}

export async function setPrintSettings(tx: ScopedTx, input: PrintSettingsInput): Promise<{ before: PrintSettingsView; after: PrintSettingsView }> {
  const row = await tx.phSettings.findFirst({ select: { id: true } });
  if (!row) throw new StudioError('NOT_FOUND', 'Settings not found');
  const before = await getPrintSettings(tx);
  let next: PrintSettings;
  try {
    next = withWorkstation(before.print, input.workstation, input.settings);
  } catch {
    // The input was validated already: what is left is the cap on the number of workstations.
    throw new StudioError('INVALID', 'Check the highlighted fields', { workstation: 'Use at most 20 workstations' });
  }
  await updateWithVersion(tx.phSettings, { id: row.id, version: input.version, data: { print: next }, entityType: 'PhSettings' }, tx);
  return { before, after: { print: next, version: input.version + 1 } };
}
