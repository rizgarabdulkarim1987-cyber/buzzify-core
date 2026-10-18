import { Hanken_Grotesk, Noto_Naskh_Arabic } from 'next/font/google';
import localFont from 'next/font/local';
import { DEFAULT_FONT_PAIR, type FontPairId } from '@/lib/font-pairs';
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

/*
 * The other brand kit pairs (src/lib/font-pairs.ts), self-hosted from their fontsource packages: one 400 file per face
 * and script. An Arabic-script face gets no metric fallback: a local font standing in for it (Arial has Arabic letters on
 * Windows) would be drawn first while it loads.
 */
export const fraunces = localFont({
  src: '../../node_modules/@fontsource/fraunces/files/fraunces-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-fraunces',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const dmSans = localFont({
  src: '../../node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-dm-sans',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const vazirmatn = localFont({
  src: '../../node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-vazirmatn',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});
export const playfair = localFont({
  src: '../../node_modules/@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-playfair',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const nunitoSans = localFont({
  src: '../../node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-nunito-sans',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const anton = localFont({
  src: '../../node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-anton',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const inter = localFont({
  src: '../../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-inter',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const kufi = localFont({
  src: '../../node_modules/@fontsource/noto-kufi-arabic/files/noto-kufi-arabic-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-kufi',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});
export const cormorant = localFont({
  src: '../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-cormorant',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const jost = localFont({
  src: '../../node_modules/@fontsource/jost/files/jost-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-jost',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const spaceGrotesk = localFont({
  src: '../../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-space-grotesk',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const plexArabic = localFont({
  src: '../../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-plex-arabic',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/*
 * The template presets' faces (src/lib/templates), self-hosted the same way: one 400 file per face and script.
 */
export const gilda = localFont({
  src: '../../node_modules/@fontsource/gilda-display/files/gilda-display-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-gilda',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const bellefair = localFont({
  src: '../../node_modules/@fontsource/bellefair/files/bellefair-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-bellefair',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const manrope = localFont({
  src: '../../node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-manrope',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const marcellus = localFont({
  src: '../../node_modules/@fontsource/marcellus/files/marcellus-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-marcellus',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const shippori = localFont({
  src: '../../node_modules/@fontsource/shippori-mincho/files/shippori-mincho-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-shippori',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const dmSerif = localFont({
  src: '../../node_modules/@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-dm-serif',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const outfit = localFont({
  src: '../../node_modules/@fontsource/outfit/files/outfit-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-outfit',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const youngSerif = localFont({
  src: '../../node_modules/@fontsource/young-serif/files/young-serif-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-young-serif',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const caslon = localFont({
  src: '../../node_modules/@fontsource/libre-caslon-text/files/libre-caslon-text-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-caslon',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const instrument = localFont({
  src: '../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-instrument',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const gloock = localFont({
  src: '../../node_modules/@fontsource/gloock/files/gloock-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-gloock',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Times New Roman',
});
export const sora = localFont({
  src: '../../node_modules/@fontsource/sora/files/sora-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-sora',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const unbounded = localFont({
  src: '../../node_modules/@fontsource/unbounded/files/unbounded-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-unbounded',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const bricolage = localFont({
  src: '../../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-bricolage',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const fredoka = localFont({
  src: '../../node_modules/@fontsource/fredoka/files/fredoka-latin-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-fredoka',
  display: 'swap',
  preload: false,
  adjustFontFallback: 'Arial',
});
export const mada = localFont({
  src: '../../node_modules/@fontsource/mada/files/mada-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-mada',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});
export const reemKufi = localFont({
  src: '../../node_modules/@fontsource/reem-kufi/files/reem-kufi-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-reem-kufi',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});
export const zain = localFont({
  src: '../../node_modules/@fontsource/zain/files/zain-arabic-400-normal.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-zain',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

/** The faces of each pair: its two Latin faces, and its Arabic-script face for Arabic and Sorani pages. */
const PAIR_FACES: Record<FontPairId, { latin: ReadonlyArray<{ variable: string }>; arabic: { variable: string } }> = {
  classic: { latin: [bodoni, hanken], arabic: naskh },
  cafe: { latin: [fraunces, dmSans], arabic: vazirmatn },
  bakery: { latin: [playfair, nunitoSans], arabic: naskh },
  street: { latin: [anton, inter], arabic: kufi },
  fine: { latin: [cormorant, jost], arabic: naskh },
  modern: { latin: [spaceGrotesk, inter], arabic: plexArabic },
  marble: { latin: [gilda, manrope], arabic: mada },
  palace: { latin: [marcellus, jost], arabic: naskh },
  souk: { latin: [marcellus, dmSans], arabic: reemKufi },
  ink: { latin: [shippori, manrope], arabic: naskh },
  riviera: { latin: [dmSerif, outfit], arabic: vazirmatn },
  botanical: { latin: [youngSerif, nunitoSans], arabic: vazirmatn },
  pearl: { latin: [caslon, manrope], arabic: naskh },
  studio: { latin: [instrument, manrope], arabic: mada },
  ritual: { latin: [instrument, outfit], arabic: mada },
  terra: { latin: [gloock, dmSans], arabic: vazirmatn },
  nordic: { latin: [sora, manrope], arabic: mada },
  neon: { latin: [unbounded, sora], arabic: zain },
  cocoa: { latin: [dmSerif, jost], arabic: naskh },
  gelato: { latin: [fredoka, nunitoSans], arabic: zain },
  pop: { latin: [bricolage, outfit], arabic: zain },
  rose: { latin: [bellefair, nunitoSans], arabic: naskh },
  cloud: { latin: [outfit, nunitoSans], arabic: mada },
};

/**
 * Only the variables a locale uses are attached, so an English page never references the Arabic family and
 * an Arabic or Sorani page never references the Latin ones, and the browser downloads only what it renders. The class
 * `font-pair-{pair}` points the stacks in globals.css at the pair's faces.
 */
export function fontVariablesFor(locale: Locale | null, pair: FontPairId = DEFAULT_FONT_PAIR): string {
  const faces = PAIR_FACES[pair];
  const variables = locale === 'ar' || locale === 'ckb' ? [faces.arabic.variable] : faces.latin.map((face) => face.variable);
  return `${variables.join(' ')} font-pair-${pair}`;
}

/** Every face of every pair, for the Studio's Brand tab, where each pair's sample is drawn in its own type. */
export function allPairFontVariables(): string {
  const faces = new Set(Object.values(PAIR_FACES).flatMap((pair) => [...pair.latin, pair.arabic]));
  return [...faces].map((face) => face.variable).join(' ');
}
