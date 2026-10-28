import { partTotals, type PaidComponents } from '@/server/domain/pos/split';
import type { Totals } from '@/server/domain/pos/totals';

/** What the split screen needs to know about one line of the order. */
export interface SplitViewLine {
  id: string;
  lineTotal: number;
  paid: boolean;
  cancelled: boolean;
}

/** The lines a guest can still be asked to pay for: live and not paid by an earlier part. */
export const unpaidLineIds = (lines: readonly SplitViewLine[]): string[] => lines.filter((line) => !line.cancelled && !line.paid).map((line) => line.id);

export const toggleLine = (selected: readonly string[], id: string): string[] => (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

/**
 * Splits the unpaid lines into `guests` groups of nearly equal value (biggest line first into the lightest group), so the
 * cashier can offer "split evenly" as a starting point. A line is never cut in half; groups that stay empty are dropped.
 */
export function evenGroups(lines: readonly SplitViewLine[], guests: number): string[][] {
  const open = lines.filter((line) => !line.cancelled && !line.paid).sort((a, b) => b.lineTotal - a.lineTotal);
  const groups = Array.from({ length: Math.max(1, guests) }, () => ({ ids: [] as string[], value: 0 }));
  for (const line of open) {
    const lightest = groups.reduce((min, group) => (group.value < min.value ? group : min));
    lightest.ids.push(line.id);
    lightest.value += line.lineTotal;
  }
  return groups.filter((group) => group.ids.length > 0).map((group) => group.ids);
}

/** What the selected lines come to with their share of the invoice discount, service, tax and delivery fee. */
export function partTotalOf(full: Totals, taken: PaidComponents, lines: readonly SplitViewLine[], selected: readonly string[]): number {
  if (selected.length === 0) return 0;
  const live = lines.filter((line) => !line.cancelled).map((line) => ({ id: line.id, total: line.lineTotal, paid: line.paid }));
  return partTotals(full, live, selected, taken).total;
}
