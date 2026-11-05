import { formatExpiry, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';
import { normalizeDigits, type CartUnit } from '../sell-logic';

/**
 * The cashier's product panels (inquiry and the three panels under the lines) and return mode, pure: how an expiry and a stock
 * are read out, which batch a line takes, and the sale number typed for a return.
 */

/** 'YYYY-MM-DD' read out at the batch's own precision: MM/YYYY for a month expiry, DD/MM/YYYY for a day one (as every other screen). */
export const expiryText = (date: string, precision: ExpiryPrecision): string => formatExpiry({ expiryDate: date, expiryPrecision: precision });

/**
 * Stock in base pieces, with the largest unit's count and the pieces left over when the largest unit holds more than one
 * (prototype: "25 tablets (1 pack and 5 tablets)"). The base label is the unit of one piece, else the smallest unit's.
 */
export function stockBreakdown(total: number, units: readonly CartUnit[]): { total: number; baseLabel: string; pack: { count: number; label: string; rest: number } | null } {
  const sorted = [...units].sort((a, b) => a.baseQty - b.baseQty);
  const base = sorted[0];
  const top = sorted[sorted.length - 1];
  const baseLabel = base?.label ?? '';
  if (!top || top.baseQty <= 1) return { total, baseLabel, pack: null };
  return { total, baseLabel, pack: { count: Math.floor(total / top.baseQty), label: top.label, rest: total % top.baseQty } };
}

/** The batch a line takes: the one chosen for it, else the first sellable batch (nearest expiry first, as the sale allocates); null when none. */
export function lineBatchId(line: { batchId: string | null }, batches: readonly { batchId: string; sellable: boolean }[]): string | null {
  if (line.batchId) return line.batchId;
  return batches.find((b) => b.sellable)?.batchId ?? null;
}

/** A sale number as typed for a return: trimmed, Arabic and Persian digits read as Latin. */
export const saleNumberOf = (text: string): string => normalizeDigits(text.trim());
