import { DEFAULT_PALETTES, sanitizePalette, type Palette } from '@/lib/brand';
import type { BrandView } from '@/server/data/tenant';

function declarations(palette: Palette): string {
  return (
    `--bg:${palette.bg};--surface:${palette.surface};--raised:${palette.raised};--accent:${palette.accent};` +
    `--text:${palette.text};--muted:${palette.muted};--line:${palette.line};--on-accent:${palette.onAccent};`
  );
}

/** Builds the tenant's CSS variables. Every value is re-validated as a hex colour. */
export function brandCss(brand: BrandView): string {
  const dark = sanitizePalette(brand.tokens.dark, DEFAULT_PALETTES.dark);
  const light = sanitizePalette(brand.tokens.light, DEFAULT_PALETTES.light);
  return `html:root{${declarations(dark)}color-scheme:dark}html:root[data-theme='light']{${declarations(light)}color-scheme:light}`;
}
