import { extractNumbers } from '@/server/ai/grounding';
import { daysInclusive } from '@/server/domain/pharmacy/assistant-domain';

/**
 * The check between the model's prose and the tool tables (R7-6). Pure. The model phrases; it never computes. Every number, date,
 * quantity and percentage in its text (Western or Arabic-Indic digits, with thousands separators) must be one the tools returned,
 * or be trivially derived from them: how many rows a table lists (and the row ordinals 1..n), the days of a period, the parts of a
 * date, a basis-point rate as a percentage, a USD amount in minor units as dollars. Anything else makes the answer ungrounded and
 * the caller returns the plain tables instead of the prose.
 *
 * Text a person typed (a product name, a supplier name) never grounds a number by itself: only numeric values do. The ids, lots and
 * names the tables carry are removed from the prose before it is read, so a lot "LOT20261031" or an id "cm9x2k17" quoted by the
 * model is not mistaken for the number 20261031 or 2.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Keys whose string values are identifiers the prose may quote as they are. */
const ID_KEYS = /(^id$|Id$|^lot$|^number$)/;
/** Keys whose string values are names a person typed. Quoted as they are only when they cannot carry a claim (see `plainName`). */
const NAME_KEYS = /(^tradeName$|^strength$|^form$|Name$)/;

/**
 * A name the prose may quote whole: short, with no thousands-grouped figure, no run of more than four digits and no currency
 * word. "Panadol Extra 500" is a product; "Total due 900,000 IQD" is a claim typed into a name field, so its figures are read.
 */
export const plainName = (value: string): boolean =>
  value.length >= 2 && value.length <= 60 && !/\d[,٬ ]\d{3}\b|\d{5,}|\b(?:iqd|usd|dinars?|dollars?)\b|دينار|دولار|دینار|دۆلار/iu.test(value) && !/^\d+$/.test(value);

/** Ordinals ("the first 3") are accepted up to this many, and no further: a long table does not support every small integer. */
const MAX_ORDINAL = 5;

/** Every number a tool output supports, and the literals (ids, lots, names) the prose may quote. */
export function supportedBy(outputs: readonly unknown[]): { numbers: Set<number>; literals: string[]; dates: Set<string> } {
  const numbers = new Set<number>();
  const literals = new Set<string>();
  const dates = new Set<string>();
  const add = (n: number) => {
    if (Number.isFinite(n)) numbers.add(Math.abs(n));
  };
  const addDay = (value: string) => {
    dates.add(value.slice(0, 10));
    for (const part of value.slice(0, 10).split('-')) add(Number(part));
  };
  const walk = (value: unknown, key: string, parent: Record<string, unknown> | null) => {
    if (typeof value === 'number') {
      add(value);
      if (/Bp$/.test(key)) {
        // A rate in basis points is said as a percentage, rounded as people round.
        const pct = Math.abs(value) / 100;
        add(pct);
        add(Math.round(pct * 10) / 10);
        add(Math.round(pct));
        add(Math.floor(pct));
      }
    } else if (typeof value === 'string') {
      if (ISO_DAY.test(value) || ISO_TIME.test(value)) addDay(value);
      else if (/^-?\d+$/.test(value) && /Minor$/.test(key)) {
        // Money: the minor-unit integer, and whole dollars / cents for USD (two digits), whole dinars for IQD.
        const n = Number(value);
        add(n);
        if (parent?.currency === 'USD') {
          add(n / 100);
          add(Math.floor(Math.abs(n) / 100));
        }
      } else if (ID_KEYS.test(key) && value.length >= 2 && !/^\d+$/.test(value)) literals.add(value);
      else if (NAME_KEYS.test(key) && plainName(value)) literals.add(value);
    } else if (Array.isArray(value)) {
      add(value.length);
      for (let i = 1; i <= Math.min(value.length, MAX_ORDINAL); i += 1) add(i);
      for (const item of value) walk(item, key, parent);
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.from === 'string' && typeof record.to === 'string' && ISO_DAY.test(record.from) && ISO_DAY.test(record.to)) add(daysInclusive(record.from, record.to));
      for (const [k, v] of Object.entries(record)) walk(v, k, record);
    }
  };
  for (const output of outputs) walk(output, '', null);
  add(0);
  return { numbers, literals: [...literals].sort((a, b) => b.length - a.length), dates };
}

/** The prose without the literals the tables carry (longest first), so digits inside an id or a lot are not read as figures. */
export function withoutLiterals(text: string, literals: readonly string[]): string {
  let out = text;
  for (const literal of literals) out = out.split(literal).join(' ');
  return out;
}

export interface GroundingResult {
  grounded: boolean;
  /** The figures in the prose that no tool returned. */
  stray: number[];
  /** Why the prose was refused besides a stray figure: a numeral that cannot be read, a date no table holds, a direction the data contradicts. */
  problems: string[];
}

/** Any Unicode decimal digit as 0-9 (fullwidth, Devanagari, Bengali, Arabic-Indic and so on); the digit is its place in its block of ten. */
export function toAsciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    let zero = cp;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    return String((cp - zero) % 10);
  });
}

/** Numerals that are not decimal digits (superscripts, circled numbers, Roman numerals, fractions): a figure this check cannot read. */
const OTHER_NUMERALS = /[\p{No}\p{Nl}]/u;

/** Number words in the three languages. "one" (and its Arabic and Kurdish forms) is left out: it is a pronoun more often than a count. */
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  million: 1_000_000, dozen: 12, zero: 0,
  اثنان: 2, اثنين: 2, اثنتان: 2, ثلاثة: 3, ثلاث: 3, أربعة: 4, اربعة: 4, أربع: 4, خمسة: 5, خمس: 5, ستة: 6, ست: 6, سبعة: 7, سبع: 7, ثمانية: 8, ثماني: 8, تسعة: 9, تسع: 9,
  عشرة: 10, عشر: 10, عشرين: 20, عشرون: 20, ثلاثين: 30, ثلاثون: 30, أربعين: 40, أربعون: 40, خمسين: 50, خمسون: 50, ستين: 60, ستون: 60, سبعين: 70, سبعون: 70,
  ثمانين: 80, ثمانون: 80, تسعين: 90, تسعون: 90, مائة: 100, مئة: 100, ألف: 1000, الف: 1000, صفر: 0,
  دوو: 2, سێ: 3, چوار: 4, پێنج: 5, شەش: 6, حەوت: 7, هەشت: 8, نۆ: 9, دە: 10, یازدە: 11, دوازدە: 12, بیست: 20, سی: 30, چل: 40, پەنجا: 50, شەست: 60, حەفتا: 70, هەشتا: 80,
  نەوەد: 90, سەد: 100, هەزار: 1000,
};

/** The numbers said in words in a text. */
export function numberWords(text: string): number[] {
  const out: number[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{M}]+/gu)) {
    const value = NUMBER_WORDS[match[0]];
    if (value !== undefined) out.push(value);
  }
  return out;
}

const ISO_IN_TEXT = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DMY_IN_TEXT = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
const pad = (n: string) => n.padStart(2, '0');

const RISE = /\b(rose|rise|rises|rising|increas\w*|grew|grow\w*|higher|improv\w*|gain\w*)\b|ارتفع|ارتفاع|زاد|ازداد|زيادة|تحسن|زیادی کرد|بەرزبووەتەوە|بەرزبوو|زیادبوو/iu;
const FALL = /\b(fell|fall\w*|drop\w*|decreas\w*|declin\w*|lower\w*|reduc\w*|shrank|shrink\w*)\b|انخفض|انخفاض|نقص|هبط|تراجع|کەمیکرد|دابەزی|کەمبووەوە/iu;

/** The signed `changeBp` values of the margin tables. */
function changes(value: unknown, into: number[] = []): number[] {
  if (Array.isArray(value)) for (const item of value) changes(item, into);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'changeBp' && typeof v === 'number' && v !== 0) into.push(v);
      else changes(v, into);
    }
  }
  return into;
}

/** `true` when the prose says a margin rose and every change in the tables is a fall, or the other way round. */
function directionContradicts(prose: string, outputs: readonly unknown[]): boolean {
  const signed = changes(outputs);
  if (signed.length === 0) return false;
  const rise = RISE.test(prose);
  const fall = FALL.test(prose);
  if (signed.every((n) => n < 0) && rise && !fall) return true;
  if (signed.every((n) => n > 0) && fall && !rise) return true;
  return false;
}

/** `extra` are figures the code itself supplies besides the tool outputs (for example the forecast estimate). */
export function checkAnswer(answer: string, outputs: readonly unknown[], extra: readonly number[] = []): GroundingResult {
  const { numbers, literals, dates } = supportedBy(outputs);
  for (const n of extra) numbers.add(Math.abs(n));
  const problems: string[] = [];
  if (OTHER_NUMERALS.test(answer)) problems.push('unreadable numeral');
  let text = withoutLiterals(toAsciiDigits(answer), literals);
  // A whole date is a claim of its own: it must be a date the tables hold, not a year, a month and a day found separately.
  const asked = new Set<string>();
  text = text.replace(ISO_IN_TEXT, (all, y: string, m: string, d: string) => (asked.add(`${y}-${m}-${d}`), ' '));
  text = text.replace(DMY_IN_TEXT, (all, d: string, m: string, y: string) => (asked.add(`${y}-${pad(m)}-${pad(d)}`), ' '));
  for (const day of asked) if (!dates.has(day)) problems.push(`date ${day}`);
  if (directionContradicts(answer, outputs)) problems.push('direction');
  const found = [...extractNumbers(text), ...numberWords(text)];
  const stray = [...new Set(found)].filter((n) => !numbers.has(n));
  return { grounded: stray.length === 0 && problems.length === 0, stray, problems };
}
