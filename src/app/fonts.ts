import { Bodoni_Moda, Hanken_Grotesk, Noto_Naskh_Arabic } from 'next/font/google';
import type { Locale } from '@/lib/locale';

export const bodoni = Bodoni_Moda({ subsets: ['latin'], variable: '--font-bodoni', display: 'swap', axes: ['opsz'] });
export const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' });
export const naskh = Noto_Naskh_Arabic({ subsets: ['arabic'], variable: '--font-naskh', display: 'swap' });

/**
 * Only the fonts a locale uses are attached, so an English page never downloads the Arabic face and an
 * Arabic or Sorani page never downloads the Latin ones. Attaching a font is what makes Next preload it.
 */
export function fontVariablesFor(locale: Locale | null): string {
  if (locale === 'ar' || locale === 'ckb') return naskh.variable;
  return `${bodoni.variable} ${hanken.variable}`;
}
