import { addDays, baghdadDay } from './reports-domain';

/**
 * The pure rules of the chain dashboard (phase 6, task 5; R6-8). No database; the clock is an argument.
 */

export const DASHBOARD_DAYS = 30;

/** The default window: the last 30 Baghdad days, today included. */
export function dashboardWindow(now: Date): { from: string; to: string } {
  const to = baghdadDay(now);
  return { from: addDays(to, -(DASHBOARD_DAYS - 1)), to };
}

/** Competition ranking by net sales, highest first: equal figures share a rank and the next rank is skipped (1, 2, 2, 4). Ties keep key order. */
export function rankByNet<K extends string>(rows: ReadonlyArray<{ key: K; net: bigint }>): Array<{ key: K; net: bigint; rank: number }> {
  const sorted = [...rows].sort((a, b) => (a.net !== b.net ? (a.net > b.net ? -1 : 1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.net !== sorted[index - 1]!.net) rank = index + 1;
    return { key: row.key, net: row.net, rank };
  });
}
