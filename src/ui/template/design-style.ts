import type { CSSProperties } from 'react';
import { accentInk, mix } from '@/lib/templates/palette';
import type { MenuDesign } from '@/lib/templates/types';

/** Corner radius of cards and of buttons, per corner style. */
const RADIUS: Record<MenuDesign['layout']['corners'], { card: string; button: string; image: string }> = {
  none: { card: '0px', button: '0px', image: '0px' },
  soft: { card: '10px', button: '8px', image: '6px' },
  round: { card: '22px', button: '9999px', image: '16px' },
  pill: { card: '30px', button: '9999px', image: '24px' },
};

const SHADOW: Record<MenuDesign['layout']['shadow'], string> = {
  none: 'none',
  soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 10px 28px -16px rgb(0 0 0 / 0.28)',
  lifted: '0 2px 4px rgb(0 0 0 / 0.12), 0 24px 48px -22px rgb(0 0 0 / 0.55)',
};

/** Space between and inside elements, as a multiple of the comfortable spacing. */
const SPACE: Record<MenuDesign['layout']['density'], number> = { airy: 1.3, comfortable: 1, compact: 0.72 };

const RATIO: Record<MenuDesign['layout']['imageRatio'], string> = {
  square: '1 / 1',
  portrait: '4 / 5',
  landscape: '4 / 3',
  wide: '16 / 9',
  circle: '1 / 1',
  arch: '4 / 5',
};

/**
 * The CSS variables a template menu is drawn with, set on its root. The palette keeps the brand kit's variable names, so
 * the shared parts (the cart bar, the sheet) follow the template without knowing about it.
 */
export function designStyle(design: MenuDesign): CSSProperties {
  const { palette, layout, type } = design;
  const radius = RADIUS[layout.corners];
  const vars: Record<string, string> = {
    '--bg': palette.bg,
    '--surface': palette.surface,
    '--raised': palette.raised,
    '--card': palette.card,
    '--text': palette.text,
    '--muted': palette.muted,
    '--line': palette.line,
    '--accent': palette.accent,
    '--on-accent': palette.onAccent,
    '--button': palette.button,
    '--on-button': palette.onButton,
    '--accent-ink': accentInk(palette),
    '--veil': mix(palette.bg, palette.text, 0.04),
    // The drawings' backdrop, in the template's own colours.
    '--art-bg-from': design.theme === 'dark' ? mix(palette.raised, palette.text, 0.08) : palette.card,
    '--art-bg-to': design.theme === 'dark' ? mix(palette.bg, palette.raised, 0.5) : mix(palette.raised, palette.card, 0.35),
    '--art-shadow': design.theme === 'dark' ? '0.4' : '0.16',
    '--radius-card': radius.card,
    '--radius-button': radius.button,
    '--radius-image': layout.imageRatio === 'circle' ? '9999px' : radius.image,
    '--shadow-card': SHADOW[layout.shadow],
    '--space': String(SPACE[layout.density]),
    '--type-scale': String(type.scale),
    '--display-case': type.displayCase === 'upper' ? 'uppercase' : 'none',
    '--display-tracking': `${type.tracking}em`,
    '--ratio': RATIO[layout.imageRatio],
    colorScheme: design.theme,
  };
  return vars as CSSProperties;
}

/** Spacing in rem, scaled by the density. */
export const space = (rem: number) => `calc(var(--space) * ${rem}rem)`;
