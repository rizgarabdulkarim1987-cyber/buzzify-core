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
