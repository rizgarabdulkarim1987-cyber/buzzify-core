/** The share of views that became clicks; zero when nothing was seen. */
export function clickRate(clicks: number, views: number): number {
  return views > 0 ? clicks / views : 0;
}

/** One cell of a CSV row: quoted when it holds a comma, quote or line break, and a leading formula character is defused. */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows of a report (an advert, a restaurant, a menu or a day) as CSV text: name, views, clicks and the click rate as a percentage. */
export function introCsv(rows: ReadonlyArray<{ label: string; views: number; clicks: number }>): string {
  const lines = rows.map((row) => [cell(row.label), row.views, row.clicks, `${(clickRate(row.clicks, row.views) * 100).toFixed(1)}%`].join(','));
  return ['name,views,clicks,click rate', ...lines].join('\n');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a text is a real calendar day (`YYYY-MM-DD`). */
export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** The longest range a report covers, in days. */
export const MAX_REPORT_DAYS = 366;

/** Whether `from` to `to` (both days) is in order and no longer than a year. */
export function validRange(from: string, to: string): boolean {
  if (!isDay(from) || !isDay(to) || from > to) return false;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 < MAX_REPORT_DAYS;
}
