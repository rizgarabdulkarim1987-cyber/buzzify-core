import { Hanken_Grotesk, Noto_Naskh_Arabic } from 'next/font/google';
import localFont from 'next/font/local';
import type { Locale } from '@/lib/locale';

/*
 * `preload: false` on every face. Next preloads each font module that is reachable from the route, whichever
 * variable is attached to the page, so with preloading on, an English page preloaded the 94 KB Arabic face
 * and an Arabic page preloaded both Latin ones. Without it the browser fetches a face only once the page
 * actually uses its family, which `fontVariablesFor` keeps to the locale's own script.
 */
// Bodoni Moda is the display face and relies on its optical-size axis, which `next/font/google` can only
// request together with the full 400-900 weight range (46 KB). The file below is the same Latin subset from
// Google Fonts with the weight pinned to 400 and the optical-size axis kept (27 KB). See fonts/README.md.
export const bodoni = localFont({
  src: './fonts/bodoni-moda-latin-opsz-400.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-bodoni',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
// The interface sets all text in the regular weight, so the text faces are single 400 files rather than the
// full variable ranges (Hanken 100-900, Naskh 400-700), which are two to three times the size.
export const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-hanken',
  display: 'swap',
  preload: false,
});
export const naskh = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: '400',
  variable: '--font-naskh',
  display: 'swap',
  preload: false,
});

/**
 * Only the variables a locale uses are attached, so an English page never references the Arabic family and
 * an Arabic or Sorani page never references the Latin ones, and the browser downloads only what it renders.
 */
export function fontVariablesFor(locale: Locale | null): string {
  if (locale === 'ar' || locale === 'ckb') return naskh.variable;
  return `${bodoni.variable} ${hanken.variable}`;
}
