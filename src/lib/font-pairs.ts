/**
 * The curated font pairs a brand kit offers (spec 12): each a Latin display face, a Latin text face and an Arabic-script
 * face with every Sorani letter. `classic` is the pair ATELIER has always used. The faces themselves are loaded in
 * `src/app/fonts.ts`.
 */
export const FONT_PAIR_IDS = ['classic', 'cafe', 'bakery', 'street', 'fine', 'modern'] as const;
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
 * Cairo was measured and left out: its Arabic file lacks ڕ ڵ ۆ ێ ە.
 */
export const FONT_PAIRS: Record<FontPairId, FontPair> = {
  classic: { label: 'Classic', display: 'Bodoni Moda', text: 'Hanken Grotesk', arabic: 'Noto Naskh Arabic' },
  cafe: { label: 'Café', display: 'Fraunces', text: 'DM Sans', arabic: 'Vazirmatn' },
  bakery: { label: 'Bakery', display: 'Playfair Display', text: 'Nunito Sans', arabic: 'Noto Naskh Arabic' },
  street: { label: 'Street', display: 'Anton', text: 'Inter', arabic: 'Noto Kufi Arabic' },
  fine: { label: 'Fine dining', display: 'Cormorant Garamond', text: 'Jost', arabic: 'Noto Naskh Arabic' },
  modern: { label: 'Modern', display: 'Space Grotesk', text: 'Inter', arabic: 'IBM Plex Sans Arabic' },
};
