import { describe, expect, it } from 'vitest';
import { layoutRows, wrapRow } from '@/app/pos/_ui/print/render-doc';
import type { PaperRow } from '@/server/domain/pos/paper';

// A canvas stub: every UTF-16 unit is 10 dots wide, whatever the font.
const measure = (s: string) => s.length * 10;
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('wrapRow', () => {
  it('keeps a short line whole', () => {
    expect(wrapRow('hello', 100, measure)).toEqual(['hello']);
  });

  it('breaks at spaces', () => {
    expect(wrapRow('aaa bbb ccc', 70, measure)).toEqual(['aaa bbb', 'ccc']);
  });

  it('breaks a 60-character word at the line width', () => {
    expect(wrapRow('x'.repeat(60), 200, measure)).toEqual(['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(20)]);
  });

  it('never splits a surrogate pair', () => {
    const lines = wrapRow('😀'.repeat(10), 50, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('😀'.repeat(10));
    for (const line of lines) expect(lone.test(line)).toBe(false);
  });

  it('still returns a line when one character is wider than the room', () => {
    expect(wrapRow('abc', 5, measure)).toEqual(['a', 'b', 'c']);
  });
});

describe('layoutRows', () => {
  const text = (left: string, right?: string): PaperRow => ({ kind: 'text', align: 'start', left, right });

  it('reserves the right column and wraps the left text under itself', () => {
    // 200 dots wide, 8 padding each side: 184 usable; the price takes 50 + 12, leaving 122 (12 characters).
    const rows = layoutRows([text('aaaa bbbb cccc dddd eeee', '1,000')], 200, measure);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ left: 'aaaa bbbb', right: '1,000' });
    expect(rows[1]).toMatchObject({ left: 'cccc dddd' });
    expect((rows[1] as { right?: string }).right).toBeUndefined();
    for (const row of rows) if (row.kind === 'text') expect(measure(row.left)).toBeLessThanOrEqual(122);
  });

  it('cuts a word only when it is wider than the whole line, and keeps the price on the last piece', () => {
    // 184 usable: 18 characters per piece; the last piece (12 characters) has room for the price (62).
    const rows = layoutRows([text('a'.repeat(30), '1,000')], 200, measure);
    expect(rows.map((r) => (r.kind === 'text' ? r.left : ''))).toEqual(['a'.repeat(18), 'a'.repeat(12)]);
    expect((rows[0] as { right?: string }).right).toBeUndefined();
    expect((rows[1] as { right?: string }).right).toBe('1,000');
  });

  it('keeps right-to-left text in logical order so the canvas joins the letters', () => {
    const original = 'مرحبا بكم جميعا في مطعمنا';
    const rows = layoutRows([text(original)], 120, measure);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => (row.kind === 'text' ? row.left : '')).join(' ')).toBe(original);
  });

  it('never cuts a word to make room for the price: the price goes on a line of its own', () => {
    // 184 usable; the price takes 90 + 12, leaving 82, and the word is 90 wide.
    const rows = layoutRows([{ kind: 'text', align: 'start', left: 'TotalWord', right: '1,250,000', size: 2, bold: true }], 200, measure);
    expect(rows).toEqual([
      { kind: 'text', align: 'start', left: 'TotalWord', right: undefined, size: 2, bold: true },
      { kind: 'text', align: 'start', left: '', right: '1,250,000', size: 2, bold: true },
    ]);
  });

  it('gives the label the whole width when a word does not fit beside the price', () => {
    const rows = layoutRows([{ kind: 'text', align: 'start', left: 'a bbbbbbbbbb', right: '1,000' }], 120, measure);
    // usable 104: the 10-letter word (100) is wider than the room beside the price (104 - 62 = 42).
    expect(rows.map((r) => (r.kind === 'text' ? r.left : ''))).toEqual(['a', 'bbbbbbbbbb', '']);
    expect((rows[2] as { right?: string }).right).toBe('1,000');
  });

  it('leaves rules, gaps, barcodes and short rows as they are', () => {
    const input: PaperRow[] = [{ kind: 'rule' }, { kind: 'gap' }, { kind: 'barcode', value: '123' }, text('ok', '5')];
    expect(layoutRows(input, 384, measure)).toEqual(input);
  });
});
