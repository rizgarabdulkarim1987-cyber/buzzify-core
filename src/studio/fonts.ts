import localFont from 'next/font/local';
import type { Locale } from '@/lib/locale';

/*
 * The Studio's two faces, self-hosted from their fontsource packages: Hanken Grotesk for Latin script and Noto Sans
 * Arabic for Arabic and Sorani (it has the Sorani letters ڕ ڵ ۆ ێ ە ڤ and both sets of Arabic-Indic digits; see
 * tests/studio/fonts.test.ts). Each is the variable file of one script's subset, declared for weights 400 to 600, the
 * only weights the Studio sets.
 *
 * Each face carries its script's `unicode-range`, so a browser downloads the Arabic file only for a page that has
 * Arabic-script text on it, and the Latin file only for Latin text. Only the Latin face is preloaded: every Studio page
 * has Latin text (the product name, emails, slugs), while an English page with no Arabic-script name on it never
 * needs the 160 KB Arabic file.
 */
export const studioLatin = localFont({
  src: '../../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
  weight: '400 600',
  style: 'normal',
  display: 'swap',
  variable: '--font-studio-latin',
  // No metric-matched local fallback: it would be a whole local font (Arial, which has Arabic letters on Windows) in
  // front of the Arabic face, and Arabic-script text would be drawn in it.
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

export const studioArabic = localFont({
  src: '../../node_modules/@fontsource-variable/noto-sans-arabic/files/noto-sans-arabic-arabic-wght-normal.woff2',
  weight: '400 600',
  style: 'normal',
  display: 'swap',
  variable: '--font-studio-arabic',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC',
    },
  ],
});

/**
 * The classes a Studio page's `<html>` carries for its fonts. Both faces' variables, in every language: Arabic-script
 * names (a restaurant called مطعم مازو) appear on English pages, and Latin ones (emails, slugs, client IDs) on Arabic
 * and Sorani pages. The last class puts the interface language's script first in the font stack (studio.css).
 */
export function studioFontVariables(locale: Locale): string {
  const lead = locale === 'en' ? 's-script-latin' : 's-script-arabic';
  return `${studioLatin.variable} ${studioArabic.variable} ${lead}`;
}
