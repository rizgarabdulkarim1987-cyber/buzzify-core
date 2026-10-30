import { extractNumbers, toLatinDigits } from '@/server/ai/grounding';
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

/** Keys whose string values are identifiers or display text the prose may quote as they are. */
const LITERAL_KEYS = /(^id$|Id$|^lot$|^number$|^tradeName$|^strength$|^form$|Name$)/;

/** Every number a tool output supports, and the literals (ids, lots, names) the prose may quote. */
export function supportedBy(outputs: readonly unknown[]): { numbers: Set<number>; literals: string[] } {
  const numbers = new Set<number>();
  const literals = new Set<string>();
  const add = (n: number) => {
    if (Number.isFinite(n)) numbers.add(Math.abs(n));
  };
  const addDay = (value: string) => {
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
      } else if (LITERAL_KEYS.test(key) && value.length >= 2 && !/^\d+$/.test(value)) literals.add(value);
    } else if (Array.isArray(value)) {
      add(value.length);
      for (let i = 1; i <= value.length; i += 1) add(i);
      for (const item of value) walk(item, key, parent);
    } else if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.from === 'string' && typeof record.to === 'string' && ISO_DAY.test(record.from) && ISO_DAY.test(record.to)) add(daysInclusive(record.from, record.to));
      for (const [k, v] of Object.entries(record)) walk(v, k, record);
    }
  };
  for (const output of outputs) walk(output, '', null);
  add(0);
  return { numbers, literals: [...literals].sort((a, b) => b.length - a.length) };
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
}

/** `extra` are figures the code itself supplies besides the tool outputs (for example the forecast estimate). */
export function checkAnswer(answer: string, outputs: readonly unknown[], extra: readonly number[] = []): GroundingResult {
  const { numbers, literals } = supportedBy(outputs);
  for (const n of extra) numbers.add(Math.abs(n));
  const stray = [...new Set(extractNumbers(withoutLiterals(toLatinDigits(answer), literals)))].filter((n) => !numbers.has(n));
  return { grounded: stray.length === 0, stray };
}
