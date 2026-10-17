import { statSync } from 'node:fs';
import path from 'node:path';
import { openSync, type Font } from 'fontkit';
import { describe, expect, it, vi } from 'vitest';
import { FONT_PAIR_IDS, FONT_PAIRS, isFontPairId } from '@/lib/font-pairs';

/** `next/font` only works inside Next's compiler; here each face is its variable's name. */
vi.mock('next/font/local', () => ({ default: (options: { variable: string }) => ({ variable: `var(${options.variable})`, className: '', style: {} }) }));
vi.mock('next/font/google', () => {
  const face = (options: { variable: string }) => ({ variable: `var(${options.variable})`, className: '', style: {} });
  return { Hanken_Grotesk: face, Noto_Naskh_Arabic: face };
});

const ROOT = process.cwd();

/**
 * The 400 file of a family's subset: the bundled Bodoni Moda, else the family's fontsource package (the Google-hosted
 * classic faces are read from their fontsource twins, which carry the same subsets).
 */
function fileOf(family: string, subset: 'latin' | 'arabic'): string {
  if (family === 'Bodoni Moda') return path.join(ROOT, 'src', 'app', 'fonts', 'bodoni-moda-latin-opsz-400.woff2');
  const slug = family.toLowerCase().replace(/ /g, '-');
  return path.join(ROOT, 'node_modules', '@fontsource', slug, 'files', `${slug}-${subset}-400-normal.woff2`);
}

function open(file: string): Font {
  const font = openSync(file);
  if (!('hasGlyphForCodePoint' in font)) throw new Error(`${file} is a font collection`);
  return font;
}

const codePoints = (text: string) => [...text].map((char) => char.codePointAt(0)!);
const KB = 1024;

describe('font pairs', () => {
  it('names a display, a text and an Arabic-script family for every pair', () => {
    for (const id of FONT_PAIR_IDS) {
      expect(FONT_PAIRS[id]).toEqual({ label: expect.any(String), display: expect.any(String), text: expect.any(String), arabic: expect.any(String) });
    }
    expect(isFontPairId('cafe')).toBe(true);
    expect(isFontPairId('comic')).toBe(false);
  });

  it.each(FONT_PAIR_IDS)('%s: the Arabic-script face has every Sorani letter and the Arabic-Indic digits', (id) => {
    const arabic = open(fileOf(FONT_PAIRS[id].arabic, 'arabic'));
    const missing = codePoints('ڕڵۆێەڤگچپژ٠١٢٣٤٥٦٧٨٩').filter((cp) => !arabic.hasGlyphForCodePoint(cp));
    expect(missing.map((cp) => String.fromCodePoint(cp))).toEqual([]);
  });

  it.each(FONT_PAIR_IDS)('%s: the Latin faces have letters, digits and the price signs', (id) => {
    for (const family of [FONT_PAIRS[id].display, FONT_PAIRS[id].text]) {
      const missing = codePoints('AZaz09.,-€$').filter((cp) => !open(fileOf(family, 'latin')).hasGlyphForCodePoint(cp));
      expect(missing, family).toEqual([]);
    }
  });

  it.each(FONT_PAIR_IDS.filter((id) => id !== 'classic'))('%s: Latin faces under 45 KB together, Arabic face under 70 KB', (id) => {
    const pair = FONT_PAIRS[id];
    expect(statSync(fileOf(pair.display, 'latin')).size + statSync(fileOf(pair.text, 'latin')).size).toBeLessThan(45 * KB);
    expect(statSync(fileOf(pair.arabic, 'arabic')).size).toBeLessThan(70 * KB);
  });

  it('attaches only the pair faces of the page script', async () => {
    const { fontVariablesFor } = await import('@/app/fonts');
    expect(fontVariablesFor('en', 'cafe')).toContain('font-pair-cafe');
    expect(fontVariablesFor('en', 'cafe')).toContain('--font-fraunces');
    expect(fontVariablesFor('en', 'cafe')).not.toMatch(/vazirmatn|naskh/i);
    expect(fontVariablesFor('ckb', 'cafe')).toMatch(/--font-vazirmatn/);
    expect(fontVariablesFor('ckb', 'cafe')).not.toMatch(/fraunces|dm-sans/i);
  });

  it('keeps the classic faces as they were', async () => {
    const { fontVariablesFor } = await import('@/app/fonts');
    expect(fontVariablesFor('en')).toBe('var(--font-bodoni) var(--font-hanken) font-pair-classic');
    expect(fontVariablesFor('ar')).toBe('var(--font-naskh) font-pair-classic');
  });
});
