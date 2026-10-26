/**
 * The curated font pairs a brand kit offers (spec 12): each a Latin display face, a Latin text face and an Arabic-script
 * face with every Sorani letter. `classic` is the pair ATELIER has always used. The faces themselves are loaded in
 * `src/app/fonts.ts`.
 */
export const FONT_PAIR_IDS = [
  'classic',
  'cafe',
  'bakery',
  'street',
  'fine',
  'modern',
  'marble',
  'palace',
  'souk',
  'ink',
  'riviera',
  'botanical',
  'pearl',
  'studio',
  'ritual',
  'terra',
  'nordic',
  'neon',
  'cocoa',
  'gelato',
  'pop',
  'rose',
  'cloud',
] as const;
export type FontPairId = (typeof FONT_PAIR_IDS)[number];

export const DEFAULT_FONT_PAIR: FontPairId = 'classic';

export function isFontPairId(value: unknown): value is FontPairId {
  return typeof value === 'string' && (FONT_PAIR_IDS as readonly string[]).includes(value);
}

export interface FontPair {
  /** What the Studio calls the pair. */
  label: string;
  /** The Latin display family (headings, the menu's name). */
  display: string;
  /** The Latin text family. */
  text: string;
  /** The Arabic-script family, for Arabic and Sorani pages, headings and text alike. */
  arabic: string;
}

/**
 * The families of each pair, all at weight 400 (spec 12). `classic` is ATELIER's: Bodoni Moda from a bundled file,
 * Hanken Grotesk and Noto Naskh Arabic from Google Fonts. The others are self-hosted from their fontsource packages.
 * Cairo was measured and left out: its Arabic file lacks ڕ ڵ ۆ ێ ە, as do Almarai, Tajawal, Changa, El Messiri, Lalezar,
 * Lemonada, Readex Pro, Rubik and Baloo Bhaijaan 2; Amiri has every letter but its file is 106 KB. The pairs after
 * `modern` arrived with the template presets (src/lib/templates), each named for the preset that first used it.
 */
export const FONT_PAIRS: Record<FontPairId, FontPair> = {
  classic: { label: 'Classic', display: 'Bodoni Moda', text: 'Hanken Grotesk', arabic: 'Noto Naskh Arabic' },
  cafe: { label: 'Café', display: 'Fraunces', text: 'DM Sans', arabic: 'Vazirmatn' },
  bakery: { label: 'Bakery', display: 'Playfair Display', text: 'Nunito Sans', arabic: 'Noto Naskh Arabic' },
  street: { label: 'Street', display: 'Anton', text: 'Inter', arabic: 'Noto Kufi Arabic' },
  fine: { label: 'Fine dining', display: 'Cormorant Garamond', text: 'Jost', arabic: 'Noto Naskh Arabic' },
  modern: { label: 'Modern', display: 'Space Grotesk', text: 'Inter', arabic: 'IBM Plex Sans Arabic' },
  marble: { label: 'Marble', display: 'Gilda Display', text: 'Manrope', arabic: 'Mada' },
  palace: { label: 'Palace', display: 'Marcellus', text: 'Jost', arabic: 'Noto Naskh Arabic' },
  souk: { label: 'Souk', display: 'Marcellus', text: 'DM Sans', arabic: 'Reem Kufi' },
  ink: { label: 'Ink', display: 'Shippori Mincho', text: 'Manrope', arabic: 'Noto Naskh Arabic' },
  riviera: { label: 'Riviera', display: 'DM Serif Display', text: 'Outfit', arabic: 'Vazirmatn' },
  botanical: { label: 'Botanical', display: 'Young Serif', text: 'Nunito Sans', arabic: 'Vazirmatn' },
  pearl: { label: 'Pearl', display: 'Libre Caslon Text', text: 'Manrope', arabic: 'Noto Naskh Arabic' },
  studio: { label: 'Studio', display: 'Instrument Serif', text: 'Manrope', arabic: 'Mada' },
  ritual: { label: 'Ritual', display: 'Instrument Serif', text: 'Outfit', arabic: 'Mada' },
  terra: { label: 'Terra', display: 'Gloock', text: 'DM Sans', arabic: 'Vazirmatn' },
  nordic: { label: 'Nordic', display: 'Sora', text: 'Manrope', arabic: 'Mada' },
  neon: { label: 'Neon', display: 'Unbounded', text: 'Sora', arabic: 'Zain' },
  cocoa: { label: 'Cocoa', display: 'DM Serif Display', text: 'Jost', arabic: 'Noto Naskh Arabic' },
  gelato: { label: 'Gelato', display: 'Fredoka', text: 'Nunito Sans', arabic: 'Zain' },
  pop: { label: 'Pop', display: 'Bricolage Grotesque', text: 'Outfit', arabic: 'Zain' },
  rose: { label: 'Rose', display: 'Bellefair', text: 'Nunito Sans', arabic: 'Noto Naskh Arabic' },
  cloud: { label: 'Cloud', display: 'Outfit', text: 'Nunito Sans', arabic: 'Mada' },
};

/** The CSS variables `src/app/fonts.ts` gives each pair's faces, for drawing a pair's samples in the Studio. */
export const FONT_PAIR_VARIABLES: Record<FontPairId, { display: string; text: string; arabic: string }> = {
  classic: { display: '--font-bodoni', text: '--font-hanken', arabic: '--font-naskh' },
  cafe: { display: '--font-fraunces', text: '--font-dm-sans', arabic: '--font-vazirmatn' },
  bakery: { display: '--font-playfair', text: '--font-nunito-sans', arabic: '--font-naskh' },
  street: { display: '--font-anton', text: '--font-inter', arabic: '--font-kufi' },
  fine: { display: '--font-cormorant', text: '--font-jost', arabic: '--font-naskh' },
  modern: { display: '--font-space-grotesk', text: '--font-inter', arabic: '--font-plex-arabic' },
  marble: { display: '--font-gilda', text: '--font-manrope', arabic: '--font-mada' },
  palace: { display: '--font-marcellus', text: '--font-jost', arabic: '--font-naskh' },
  souk: { display: '--font-marcellus', text: '--font-dm-sans', arabic: '--font-reem-kufi' },
  ink: { display: '--font-shippori', text: '--font-manrope', arabic: '--font-naskh' },
  riviera: { display: '--font-dm-serif', text: '--font-outfit', arabic: '--font-vazirmatn' },
  botanical: { display: '--font-young-serif', text: '--font-nunito-sans', arabic: '--font-vazirmatn' },
  pearl: { display: '--font-caslon', text: '--font-manrope', arabic: '--font-naskh' },
  studio: { display: '--font-instrument', text: '--font-manrope', arabic: '--font-mada' },
  ritual: { display: '--font-instrument', text: '--font-outfit', arabic: '--font-mada' },
  terra: { display: '--font-gloock', text: '--font-dm-sans', arabic: '--font-vazirmatn' },
  nordic: { display: '--font-sora', text: '--font-manrope', arabic: '--font-mada' },
  neon: { display: '--font-unbounded', text: '--font-sora', arabic: '--font-zain' },
  cocoa: { display: '--font-dm-serif', text: '--font-jost', arabic: '--font-naskh' },
  gelato: { display: '--font-fredoka', text: '--font-nunito-sans', arabic: '--font-zain' },
  pop: { display: '--font-bricolage', text: '--font-outfit', arabic: '--font-zain' },
  rose: { display: '--font-bellefair', text: '--font-nunito-sans', arabic: '--font-naskh' },
  cloud: { display: '--font-outfit', text: '--font-nunito-sans', arabic: '--font-mada' },
};
