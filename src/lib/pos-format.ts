/**
 * Table numbers, amounts and minutes are written in Latin digits (0-9) in every locale, Arabic and Sorani included.
 * Decided once for the whole product: they match the printed receipt, the card terminals and the cashier's calculator,
 * and the same digits read the same on every screen. Thousands use a comma: 45,000.
 */
const LATIN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, useGrouping: true });

export function formatNumber(value: number): string {
  return LATIN.format(value);
}

/** Fills `{name}` placeholders, e.g. `format('Table {n}', { n: 7 })`. An unknown placeholder is left as it is. */
export function format(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** Whole minutes from `fromMs` to `nowMs`, never negative (a device clock a little behind the server shows 0). */
export function elapsedMinutes(fromMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - fromMs) / 60_000));
}

export type ElapsedText = {
  justNow: string;
  one: string;
  two: string;
  few: string;
  many: string;
  other: string;
  /** For an hour or more, with `{time}` as h:mm. */
  hours: string;
};

/** "32 دقيقة", "دقيقتان", "1:05 ساعة": the plural form of the locale under an hour, h:mm from an hour on. */
export function elapsedLabel(minutes: number, text: ElapsedText, pluralLocale: string): string {
  if (minutes < 1) return text.justNow;
  if (minutes >= 60) {
    const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    return format(text.hours, { time });
  }
  const category = new Intl.PluralRules(pluralLocale).select(minutes) as keyof Omit<ElapsedText, 'justNow' | 'hours'>;
  return format(text[category] ?? text.other, { n: formatNumber(minutes) });
}

/**
 * Keeps a run of Latin digits and signs ("10%", "+1,000") in one left-to-right piece inside Arabic or Sorani text, so
 * the bidi algorithm cannot move the percent sign to the other side. Uses the invisible isolate marks LRI and PDI.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}
