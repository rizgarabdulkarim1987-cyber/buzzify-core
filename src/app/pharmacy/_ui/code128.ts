/**
 * Code 128 for the label sheets, pure (R7-8): the symbol values, the checksum and the bars, with no library, no network and no
 * motion. Character sets B (ASCII 32 to 126) and C (digit pairs) are used; a run of digits goes to C where that is shorter
 * (4 or more at the start or the end, 6 or more inside the text; an odd run puts its first digit in B). Text outside ASCII 32 to
 * 126 is refused: a label never prints a barcode that would scan as something else.
 */

/** Bar, space, bar, space, bar, space widths of the symbols 0 to 105 (values 0 to 102 are characters, 103 to 105 are start codes). */
export const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
/** The stop symbol: 13 modules (a final bar of 2 closes it). */
export const STOP_PATTERN = '2331112';

const CODE_C = 99;
const CODE_B = 100;
const START_B = 104;
const START_C = 105;
const STOP = 106;
/** The longest text a label barcode carries (keeps it scannable at 40 mm). */
export const MAX_TEXT = 80;

export class Code128Error extends Error {
  constructor(readonly reason: 'EMPTY' | 'CHARSET' | 'TOO_LONG') {
    super(reason);
    this.name = 'Code128Error';
  }
}

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9';

/** How many digits run on from `at`. */
function digitRun(text: string, at: number): number {
  let n = 0;
  while (isDigit(text[at + n])) n++;
  return n;
}

export interface Encoded {
  /** Start code, data symbols, checksum, stop. */
  values: number[];
  checksum: number;
}

export function encode128(text: string): Encoded {
  if (text.length === 0) throw new Code128Error('EMPTY');
  if (text.length > MAX_TEXT) throw new Code128Error('TOO_LONG');
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch.length !== 1 || code < 32 || code > 126) throw new Code128Error('CHARSET');
  }
  const values: number[] = [];
  let mode: 'B' | 'C' | null = null;
  let i = 0;
  while (i < text.length) {
    const run = digitRun(text, i);
    const atStart = i === 0;
    const atEnd = i + run === text.length;
    const worthC = run >= (atStart || atEnd ? 4 : 6);
    if (mode !== 'C' && worthC) {
      // An odd run: its first digit goes in B, so the rest pairs up.
      if (run % 2 === 1) {
        if (mode === null) {
          values.push(START_B);
          mode = 'B';
        }
        values.push(text.charCodeAt(i) - 32);
        i++;
      }
      if (mode === null) values.push(START_C);
      else values.push(CODE_C);
      mode = 'C';
    }
    if (mode === 'C') {
      if (isDigit(text[i]) && isDigit(text[i + 1])) {
        values.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      mode = 'B';
    }
    if (mode === null) {
      values.push(START_B);
      mode = 'B';
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  const checksum = values.reduce((n, v, k) => n + (k === 0 ? v : v * k), 0) % 103;
  return { values: [...values, checksum, STOP], checksum };
}

export interface Bar {
  /** Position in modules from the left edge of the symbol (no quiet zone). */
  x: number;
  /** Width in modules. */
  w: number;
}

/** The bars of `text` in modules, and the symbol's total width in modules (without the quiet zones). */
export function barsOf(text: string): { bars: Bar[]; modules: number } {
  const { values } = encode128(text);
  const bars: Bar[] = [];
  let x = 0;
  for (const value of values) {
    const widths = value === STOP ? STOP_PATTERN : PATTERNS[value]!;
    for (let k = 0; k < widths.length; k++) {
      const w = Number(widths[k]);
      if (k % 2 === 0) bars.push({ x, w });
      x += w;
    }
  }
  return { bars, modules: x };
}
