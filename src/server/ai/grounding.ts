/**
 * The check between a model's text and the owner. The model phrases; it never computes. Every number in what it wrote must
 * be one the deterministic code supplied (a tool result, the facts, the period, the question), or the text is refused.
 */

const ARABIC_INDIC = /[٠-٩]/g;
const EXTENDED = /[۰-۹]/g;

/** Latin digits for Arabic-Indic and Extended Arabic-Indic ones; everything else untouched. */
export function toLatinDigits(text: string): string {
  return text.replace(ARABIC_INDIC, (c) => String(c.charCodeAt(0) - 0x0660)).replace(EXTENDED, (c) => String(c.charCodeAt(0) - 0x06f0));
}

// Digits, then groups of exactly three after a separator (comma, Arabic thousands separator, thin spaces), then an optional
// decimal part. A separator not followed by exactly three digits ends the number.
const NUMBER = /\d+(?:[,٬  ]\d{3}(?!\d))*(?:[.٫]\d+)?/g;

/** Every number in a text: Western, Arabic-Indic and Extended Arabic-Indic digits, with group separators and decimals. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const match of toLatinDigits(text).matchAll(NUMBER)) {
    const value = Number(match[0].replace(/[,٬  ]/g, '').replace('٫', '.'));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * The numbers inside any value: numbers themselves (by size), and the year, month and day of date strings. Other strings
 * (guest complaints, supplier and product names) are free text a person typed, so a figure written in one never grounds an answer.
 */
export function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(Math.abs(value));
  } else if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/.test(value)) for (const n of periodNumbers(value.slice(0, 10))) into.add(n);
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, into);
  }
  return into;
}

/** Year, month and day of each 'YYYY-MM-DD', as numbers, so "5 October 2026" is grounded by a period of 2026-10-05. */
export function periodNumbers(...days: string[]): number[] {
  return days.flatMap((day) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? day.split('-').map(Number) : []));
}

export function checkGrounding(text: string, allowed: Iterable<number>): { ok: boolean; stray: number[] } {
  const set = new Set(allowed);
  const stray = [...new Set(extractNumbers(text))].filter((n) => !set.has(n));
  return { ok: stray.length === 0, stray };
}

/** Words the AI package never says about a person, in any of the three languages. Operations are "worth reviewing". */
export const ACCUSATION_WORDS: readonly string[] = ['fraud', 'theft', 'steal', 'stole', 'embezzl', 'احتيال', 'سرقة', 'سرق', 'اختلاس', 'فێڵ', 'دزی', 'دزین'];

export function hasAccusation(text: string): boolean {
  const lower = text.toLowerCase();
  return ACCUSATION_WORDS.some((word) => lower.includes(word));
}
