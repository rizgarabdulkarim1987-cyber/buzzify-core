import { HOME_PERIODS, type HomePeriod } from '@/server/domain/pharmacy/home';

export type { HomeAttention, HomeFigures, HomePeriod } from '@/server/domain/pharmacy/home';

/** Today against yesterday in whole percent; null when yesterday is 0 (no chip, never NaN% or Infinity%). */
export function trendOf(today: number, yesterday: number): { pct: number; direction: 'up' | 'down' | 'flat' } | null {
  if (!(yesterday > 0)) return null;
  const pct = Math.round((Math.abs(today - yesterday) / yesterday) * 100);
  if (pct === 0) return { pct: 0, direction: 'flat' };
  return { pct, direction: today > yesterday ? 'up' : 'down' };
}

/** The total per item, rounded to a whole minor unit; 0 when there are no items. */
export function average(total: number, count: number): number {
  return count > 0 ? Math.round(total / count) : 0;
}

/** The `?period=` of the address; anything else is 7 days. */
export function periodOf(raw: string | string[] | undefined): HomePeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return HOME_PERIODS.find((p) => p === value) ?? '7d';
}

/** The greeting for the hour in Baghdad (UTC+3, no daylight saving): morning until noon, afternoon until 17:00. */
export function greetingOf(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date(now.getTime() + 3 * 3_600_000).getUTCHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * The chart's line and its fill as SVG paths in a `width` x `height` box: the points spread across the width, 0 at the
 * bottom and the highest total at 90% of the height. Null when every total is 0 (the chart shows its empty state).
 */
export function chartPaths(totals: number[], width: number, height: number): { line: string; area: string; last: { x: number; y: number } } | null {
  const max = Math.max(0, ...totals);
  if (totals.length === 0 || !(max > 0)) return null;
  const ys = totals.map((v) => round(height - (Math.max(0, v) / max) * height * 0.9));
  const points = totals.length === 1 ? [{ x: 0, y: ys[0]! }, { x: width, y: ys[0]! }] : ys.map((y, i) => ({ x: round((i / (totals.length - 1)) * width), y }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  return { line, area: `${line} L${width},${height} L0,${height} Z`, last: points.at(-1)! };
}
