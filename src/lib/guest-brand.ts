import { DEFAULT_FONT_PAIR, type FontPairId } from '@/lib/font-pairs';
import type { Palette } from '@/lib/brand';
import type { BrandView } from '@/server/data/tenant';

/**
 * What guests are shown of a brand kit. A menu drawn with a template takes its theme, palette and fonts from the
 * template's resolved design; the kit's own (classic) values stay stored for the day the template is removed.
 */

export function guestTheme(brand: BrandView): 'dark' | 'light' {
  return brand.design?.theme ?? brand.theme;
}

export function guestPalette(brand: BrandView): Palette {
  if (!brand.design) return brand.tokens[brand.theme];
  const { bg, surface, raised, accent, text, muted, line, onAccent } = brand.design.palette;
  return { bg, surface, raised, accent, text, muted, line, onAccent };
}

export function guestFontPair(brand: BrandView): FontPairId {
  return brand.design?.type.fontPairId ?? brand.fontPairId ?? DEFAULT_FONT_PAIR;
}
