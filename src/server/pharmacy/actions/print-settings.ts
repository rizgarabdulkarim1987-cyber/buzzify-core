import { phPlaceInput, phTargetOf } from '@/server/pharmacy/entry';
import { printSettingsInput, setPrintSettings } from '@/server/pharmacy/print-settings';
import type { WorkstationSettings } from '@/server/domain/pharmacy/print-settings';
import { defineAction } from '@/server/studio/framework/action';

/**
 * What the audit keeps of a workstation's settings. The thermal printer's connection string is a technical setting, not personal data, but the
 * audit guard refuses any field named like an address; so the audit carries the printer's other values and whether one is set.
 */
function auditView(settings: WorkstationSettings | undefined) {
  if (!settings) return null;
  const { receiptPrinter, ...rest } = settings;
  return { ...rest, receiptPrinter: receiptPrinter ? { transport: receiptPrinter.transport, paperWidth: receiptPrinter.paperWidth, cut: receiptPrinter.cut, drawerPin: receiptPrinter.drawerPin, drawerOnCash: receiptPrinter.drawerOnCash } : null };
}

/** One workstation's printing settings (phase 7, R7-8): the owner's, like the other settings. The audit carries the name and the values. */
export const set = defineAction({
  name: 'ph.print.settings.set',
  permission: null,
  ph: 'settings.manage',
  input: printSettingsInput.extend(phPlaceInput.shape),
  target: phTargetOf,
  run(ctx, input) {
    return ctx.transaction(async (tx) => {
      const { before, after } = await setPrintSettings(tx, input);
      ctx.audit({
        action: 'ph.print.settings.set',
        entityType: 'PhSettings',
        entityId: ctx.restaurantId ?? input.restaurantId,
        changes: {
          workstation: { before: null, after: input.workstation },
          settings: { before: auditView(before.print.workstations[input.workstation]), after: auditView(after.print.workstations[input.workstation]) },
        },
      });
      return after;
    });
  },
});
