import { describe, expect, it } from 'vitest';
import { barsOf, Code128Error, encode128, PATTERNS, STOP_PATTERN } from '@/app/pharmacy/_ui/code128';

const sum = (widths: string) => [...widths].reduce((n, d) => n + Number(d), 0);

describe('code128 encoder', () => {
  it('has 107 patterns of 11 modules (the stop of 13), bars and spaces alternating', () => {
    expect(PATTERNS).toHaveLength(106);
    for (const [value, widths] of PATTERNS.entries()) {
      expect(widths, `pattern ${value}`).toHaveLength(6);
      expect(sum(widths), `pattern ${value} width`).toBe(11);
    }
    expect(sum(STOP_PATTERN)).toBe(13);
    expect(new Set(PATTERNS).size).toBe(106);
  });

  it('matches known values: character set B maps a space to 0 and the start B is 104', () => {
    expect(encode128('A').values).toEqual([104, 33, (104 + 33) % 103, 106]);
    expect(encode128(' ').values.slice(0, 2)).toEqual([104, 0]);
    expect(PATTERNS[104]).toBe('211214');
    expect(PATTERNS[105]).toBe('211232');
    expect(PATTERNS[0]).toBe('212222');
    expect(STOP_PATTERN).toBe('2331112');
  });

  it('computes the checksum by hand: PJJ123C is 104 + 1*48 + 2*42 + 3*42 + 4*17 + 5*18 + 6*19 + 7*35 = 879, 879 mod 103 = 55', () => {
    const { values, checksum } = encode128('PJJ123C');
    expect(values.slice(0, 8)).toEqual([104, 48, 42, 42, 17, 18, 19, 35]);
    expect(checksum).toBe(55);
    expect(values.at(-2)).toBe(55);
    expect(values.at(-1)).toBe(106);
  });

  it('uses character set C for a run of digits: 123456 is start C, 12, 34, 56 with checksum (105 + 12 + 68 + 168) = 353, 353 mod 103 = 44', () => {
    const { values } = encode128('123456');
    expect(values).toEqual([105, 12, 34, 56, 44, 106]);
  });

  it('switches B to C and back: an odd digit run puts its first digit in B; short runs stay in B', () => {
    // 12345 -> start B '1', code C, 23, 45
    expect(encode128('12345').values.slice(0, 5)).toEqual([104, 17, 99, 23, 45]);
    // a run of 3 digits inside text is not worth a switch
    expect(encode128('A123B').values.slice(0, 6)).toEqual([104, 33, 17, 18, 19, 34]);
    // text, then a long run, then text: B ... CODE C ... CODE B ...
    const { values } = encode128('AB12345678CD');
    expect(values.slice(0, 3)).toEqual([104, 33, 34]);
    expect(values).toContain(99);
    expect(values).toContain(100);
    expect(values.indexOf(99)).toBeLessThan(values.indexOf(100));
  });

  it('decodes back to the text (a reference decoder over the values)', () => {
    const decode = (values: number[]): string => {
      let mode: 'B' | 'C' = values[0] === 105 ? 'C' : 'B';
      let out = '';
      for (const v of values.slice(1, -2)) {
        if (v === 99) mode = 'C';
        else if (v === 100) mode = 'B';
        else out += mode === 'C' ? String(v).padStart(2, '0') : String.fromCharCode(v + 32);
      }
      return out;
    };
    for (const text of ['1234', '123456', '5901234123457', '6224000123452', 'LOT-A1/2026', 'Panadol 500 mg', 'AB12345678CD', '12', '1', '0000', 'x9876543210', '~ !']) {
      expect(decode(encode128(text).values), text).toBe(text);
    }
  });

  it('refuses text that cannot be encoded', () => {
    for (const bad of ['', 'é', 'سلام', 'a\tb', 'a\nb', '日本', '\u007f']) {
      expect(() => encode128(bad), JSON.stringify(bad)).toThrow(Code128Error);
    }
    expect(() => encode128('x'.repeat(81))).toThrow(Code128Error);
  });

  it('draws bars: starts with a bar, total 11 modules per symbol plus 13 for the stop, rects never overlap', () => {
    const text = '123456';
    const { values } = encode128(text);
    const { bars, modules } = barsOf(text);
    expect(modules).toBe((values.length - 1) * 11 + 13);
    expect(bars[0]!.x).toBe(0);
    expect(bars.at(-1)!.x + bars.at(-1)!.w).toBe(modules);
    for (let i = 1; i < bars.length; i++) expect(bars[i]!.x).toBeGreaterThan(bars[i - 1]!.x + bars[i - 1]!.w - 1);
    // start C is 211232: bar 2, space 1, bar 1, space 2, bar 3, space 2
    expect(bars.slice(0, 3)).toEqual([{ x: 0, w: 2 }, { x: 3, w: 1 }, { x: 6, w: 3 }]);
  });
});
