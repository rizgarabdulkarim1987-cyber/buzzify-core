import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openSync, type Font } from 'fontkit';
import { describe, expect, it, vi } from 'vitest';
import { LOCALES } from '@/lib/locale';

/** `next/font/local` only works inside Next's compiler; here it records what it was asked for. */
const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('next/font/local', () => ({
  default: (options: Record<string, unknown>) => {
    calls.push(options);
    return { variable: `var-${String(options.variable)}`, className: 'unused', style: { fontFamily: 'unused' } };
  },
}));

const FONTS_FILE = path.join(process.cwd(), 'src', 'studio', 'fonts.ts');

/** The font files `fonts.ts` loads, as absolute paths: read from its source, so the test checks what ships. */
function fontFiles(): string[] {
  const source = readFileSync(FONTS_FILE, 'utf8');
  return [...source.matchAll(/src:\s*'([^']+\.woff2)'/g)].map((match) => path.resolve(path.dirname(FONTS_FILE), match[1]!));
}

function open(file: string): Font {
  const font = openSync(file);
  if (!('hasGlyphForCodePoint' in font)) throw new Error(`${file} is a font collection`);
  return font;
}

const codePoints = (text: string) => [...text].map((char) => char.codePointAt(0)!);

describe('Studio fonts', () => {
  it('loads Hanken Grotesk and Noto Sans Arabic from their fontsource packages', () => {
    const files = fontFiles().map((file) => file.split(path.sep).join('/'));
    expect(files).toHaveLength(2);
    expect(files.some((file) => file.includes('node_modules/@fontsource-variable/hanken-grotesk/files/'))).toBe(true);
    expect(files.some((file) => file.includes('node_modules/@fontsource-variable/noto-sans-arabic/files/'))).toBe(true);
  });

  it('has every Sorani letter and the Arabic-Indic digits in the Arabic-script face', () => {
    const arabic = open(fontFiles().find((file) => file.includes('noto-sans-arabic'))!);
    const wanted = codePoints('ڕڵۆێەڤگچپژ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹');
    const missing = wanted.filter((cp) => !arabic.hasGlyphForCodePoint(cp)).map((cp) => String.fromCodePoint(cp));
    expect(missing).toEqual([]);
  });

  it('has the Latin letters, digits and punctuation in the Latin face', () => {
    const latin = open(fontFiles().find((file) => file.includes('hanken-grotesk'))!);
    const missing = codePoints('AZaz09@.-–—€é').filter((cp) => !latin.hasGlyphForCodePoint(cp));
    expect(missing).toEqual([]);
  });

  it('declares both faces with weights 400 to 600, swapped in, and attaches both in every language', async () => {
    const { studioFontVariables } = await import('@/studio/fonts');
    expect(calls).toHaveLength(2);
    for (const options of calls) {
      expect(options.weight).toBe('400 600');
      expect(options.display).toBe('swap');
    }
    const variables = calls.map((options) => `var-${String(options.variable)}`);
    // Arabic-script names (a restaurant called مطعم مازو) appear on English pages and Latin ones (emails, slugs) on
    // Arabic and Sorani pages, so every page can draw both scripts; the CSS puts the interface language's face first.
    for (const locale of LOCALES) {
      const classes = studioFontVariables(locale).split(' ');
      for (const variable of variables) expect(classes, locale).toContain(variable);
    }
  });
});
