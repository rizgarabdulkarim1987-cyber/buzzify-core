import type { PrismaClient } from '@/generated/prisma/client';
import { POS_PAYMENT_METHODS, type PosPaymentMethodKey } from '@/server/domain/pos/payment-methods';
import type { ScopedTx } from '@/server/data/tenant-db';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';

export { POS_PAYMENT_METHODS, type PosPaymentMethodKey };

/** How a restaurant runs its till, as a form shows it. `version` is 0 until the first save. */
export interface PosSettingsView {
  serviceRatePercent: number;
  taxRatePercent: number;
  enabledPaymentMethods: PosPaymentMethodKey[];
  tableRingMinutes: number;
  kitchenPrintEnabled: boolean;
  kitchenScreenEnabled: boolean;
  qrOrderingEnabled: boolean;
  takeawayEnabled: boolean;
  deliveryEnabled: boolean;
  complaintsEnabled: boolean;
  idleMinutes: number;
  requireApproval: boolean;
  catalogMenuId: string | null;
  version: number;
}

/** What a form submits: the view without the catalog menu (chosen on its own) and with the version it was loaded at. */
export type PosSettingsInput = Omit<PosSettingsView, 'catalogMenuId'>;

export const POS_SETTINGS_DEFAULTS: PosSettingsView = {
  serviceRatePercent: 0,
  taxRatePercent: 0,
  enabledPaymentMethods: ['CASH'],
  tableRingMinutes: 60,
  kitchenPrintEnabled: false,
  kitchenScreenEnabled: false,
  qrOrderingEnabled: false,
  takeawayEnabled: false,
  deliveryEnabled: false,
  complaintsEnabled: false,
  idleMinutes: 15,
  requireApproval: true,
  catalogMenuId: null,
  version: 0,
};

type Row = {
  serviceRatePercent: number;
  taxRatePercent: number;
  enabledPaymentMethods: string[];
  tableRingMinutes: number;
  kitchenPrintEnabled: boolean;
  kitchenScreenEnabled: boolean;
  qrOrderingEnabled: boolean;
  takeawayEnabled: boolean;
  deliveryEnabled: boolean;
  complaintsEnabled: boolean;
  idleMinutes: number;
  requireApproval: boolean;
  catalogMenuId: string | null;
  version: number;
};

function view(row: Row): PosSettingsView {
  return {
    serviceRatePercent: row.serviceRatePercent,
    taxRatePercent: row.taxRatePercent,
    enabledPaymentMethods: row.enabledPaymentMethods as PosPaymentMethodKey[],
    tableRingMinutes: row.tableRingMinutes,
    kitchenPrintEnabled: row.kitchenPrintEnabled,
    kitchenScreenEnabled: row.kitchenScreenEnabled,
    qrOrderingEnabled: row.qrOrderingEnabled,
    takeawayEnabled: row.takeawayEnabled,
    deliveryEnabled: row.deliveryEnabled,
    complaintsEnabled: row.complaintsEnabled,
    idleMinutes: row.idleMinutes,
    requireApproval: row.requireApproval,
    catalogMenuId: row.catalogMenuId,
    version: row.version,
  };
}

/** The restaurant's settings, or the defaults at version 0 when it has never saved any. */
export async function readPosSettings(db: PrismaClient, restaurantId: string): Promise<PosSettingsView> {
  const row = await db.posSettings.findUnique({ where: { restaurantId } });
  return row ? view(row) : POS_SETTINGS_DEFAULTS;
}

const CASH_REQUIRED = 'Cash must stay switched on';

/** Cash is the one method every till has; the others are the owner's choice. Each method once, in the catalog's order. */
function methodsOf(selected: readonly PosPaymentMethodKey[]): PosPaymentMethodKey[] {
  if (!selected.includes('CASH')) {
    throw new StudioError('INVALID', CASH_REQUIRED, { enabledPaymentMethods: CASH_REQUIRED });
  }
  return POS_PAYMENT_METHODS.filter((method) => selected.includes(method));
}

/**
 * Saves the restaurant's settings if they are still at the version the form was loaded at (version 0: never saved), and
 * returns what changed for the audit row. The restaurant is the transaction's; it is never taken from the input.
 */
export async function savePosSettings(
  tx: ScopedTx,
  restaurantId: string,
  input: PosSettingsInput,
): Promise<{ id: string; before: PosSettingsView; after: PosSettingsView }> {
  const { version, ...fields } = input;
  const data = { ...fields, enabledPaymentMethods: methodsOf(input.enabledPaymentMethods) };
  const existing = await tx.posSettings.findFirst({ where: { restaurantId } });

  if (!existing) {
    if (version !== 0) throw new StudioError('CONFLICT');
    try {
      const created = await tx.posSettings.create({ data: { restaurantId, ...data } });
      return { id: created.id, before: POS_SETTINGS_DEFAULTS, after: view(created) };
    } catch (error) {
      // Two first saves at once: the second finds the row the first made.
      if ((error as { code?: unknown } | null)?.code === 'P2002') throw new StudioError('CONFLICT');
      throw error;
    }
  }

  await updateWithVersion(tx.posSettings, { id: existing.id, version, data, entityType: 'PosSettings' }, tx);
  const saved = await tx.posSettings.findFirst({ where: { id: existing.id } });
  return { id: existing.id, before: view(existing), after: saved ? view(saved) : view({ ...existing, ...data, version: version + 1 }) };
}

/** The fields whose value differs, for an audit row's `changes`. */
export function settingsChanges(before: PosSettingsView, after: PosSettingsView): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof PosSettingsView>) {
    if (key === 'version' || key === 'catalogMenuId') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}
