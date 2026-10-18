/*
 * The typography motions' faces, self-hosted from their fontsource packages and loaded with the first motion that
 * imports this module (each face carries its script's unicode-range, so a page downloads only the letters it shows).
 * Latin: Fraunces (serif), DM Sans (sans) and Anton (condensed). Arabic and Sorani fall through to Noto Naskh Arabic,
 * IBM Plex Sans Arabic and Noto Kufi Arabic, which carry the Sorani letters ڕ ڵ ۆ ێ ە.
 */
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/noto-naskh-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/noto-kufi-arabic/arabic-700.css';

export const FONTS: Record<string, string> = {
  serif: "'Fraunces', 'Noto Naskh Arabic', Georgia, serif",
  sans: "'DM Sans', 'IBM Plex Sans Arabic', system-ui, sans-serif",
  condensed: "'Anton', 'Noto Kufi Arabic', sans-serif",
};

/** The weight each face is loaded in. */
export const FONT_WEIGHTS: Record<string, number> = { serif: 600, sans: 600, condensed: 400 };

export function fontStyle(name: string): { fontFamily: string; fontWeight: number } {
  return { fontFamily: FONTS[name] ?? FONTS.serif!, fontWeight: FONT_WEIGHTS[name] ?? 600 };
}
