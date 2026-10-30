import type { CountLineView } from '@/server/pharmacy/counts';

/** What the counter has typed, per line id, as text. Kept on the device by `useDraft`; only numbers reach the server. */
export type CountEntries = Record<string, string>;

const MAX_QTY = 1_000_000_000;
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED = '۰۱۲۳۴۵۶۷۸۹';

/** Keeps digits only (Arabic-Indic and Persian digits become Latin), so a number typed on any keyboard reads the same. */
export function digitsOf(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(EXTENDED.indexOf(d)))
    .replace(/[^\d]/g, '')
    .slice(0, 10);
}

/** The typed entries the server does not have yet: a value that is present, a whole number in range and not already saved. */
export function unsavedEntries(lines: CountLineView[], entries: CountEntries): { lineId: string; countedQty: number }[] {
  const out: { lineId: string; countedQty: number }[] = [];
  for (const line of lines) {
    const text = entries[line.lineId];
    if (text === undefined || text === '') continue;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) continue;
    if (n !== line.countedQty) out.push({ lineId: line.lineId, countedQty: n });
  }
  return out;
}

/** The entries a count starts from: what the server already has. */
export function entriesOf(lines: CountLineView[]): CountEntries {
  const out: CountEntries = {};
  for (const line of lines) if (line.countedQty !== null) out[line.lineId] = String(line.countedQty);
  return out;
}

/** Lines with a number, saved or typed: the rest are "not counted yet". */
export function countedIn(lines: CountLineView[], entries: CountEntries): number {
  return lines.filter((l) => (entries[l.lineId] ?? '') !== '' || l.countedQty !== null).length;
}

/** Totals of a submitted count's differences, for the summary line. */
export function summarise(lines: CountLineView[]): { counted: number; diffs: number; net: number } {
  let counted = 0;
  let diffs = 0;
  let net = 0;
  for (const l of lines) {
    if (l.countedQty === null) continue;
    counted += 1;
    if (l.difference !== undefined && l.difference !== 0) {
      diffs += 1;
      net += l.difference;
    }
  }
  return { counted, diffs, net };
}
