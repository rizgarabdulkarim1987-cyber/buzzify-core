import { DEFAULT_PALETTES, sanitizePalette, type Palette } from '@/lib/brand';
import { guestPalette, guestTheme } from '@/lib/guest-brand';
import type { BrandView } from '@/server/data/tenant';

function declarations(palette: Palette): string {
  return (
    `--bg:${palette.bg};--surface:${palette.surface};--raised:${palette.raised};--accent:${palette.accent};` +
    `--text:${palette.text};--muted:${palette.muted};--line:${palette.line};--on-accent:${palette.onAccent};`
  );
}

/**
 * Builds the tenant's CSS variables. Every value is re-validated as a hex colour. A template menu's palette applies to
 * both theme selectors, so the page has one look whatever the theme attribute says.
 */
export function brandCss(brand: BrandView): string {
  if (brand.design) {
    const palette = sanitizePalette(guestPalette(brand), DEFAULT_PALETTES[brand.design.theme]);
    return `html:root,html:root[data-theme='light']{${declarations(palette)}color-scheme:${brand.design.theme}}`;
  }
  const dark = sanitizePalette(brand.tokens.dark, DEFAULT_PALETTES.dark);
  const light = sanitizePalette(brand.tokens.light, DEFAULT_PALETTES.light);
  return `html:root{${declarations(dark)}color-scheme:dark}html:root[data-theme='light']{${declarations(light)}color-scheme:light}`;
}

/** The logo for the theme guests see: the dark one on a dark theme when there is one, else the logo, else none. */
export function themeLogo(brand: BrandView): { url: string; width: number; height: number } | undefined {
  const logo = guestTheme(brand) === 'dark' ? (brand.logoDark ?? brand.logo) : brand.logo;
  return logo ? { url: logo.url, width: logo.width, height: logo.height } : undefined;
}
