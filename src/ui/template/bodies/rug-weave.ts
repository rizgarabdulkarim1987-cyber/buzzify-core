/**
 * The Jajim and Nowruz shape's fixed colours (RugsBody): a bright ivory ground, woven rugs framed in red, indigo, saffron
 * and green. They are the shape's own and the same on every palette, so every text sits on a known solid fill and each
 * pair is unit-tested for contrast.
 */
export const RUG = {
  /** The page behind the rugs. */
  page: '#F4E6C8',
  /** Names and body text, on a rug's field. */
  ink: '#2A1810',
  /** A secondary line (a crossed-out price, a note). */
  muted: '#5A4636',
  /** Prices, on a rug's field. */
  priceInk: '#8E1822',
  /** The cartouche woven into a rug's top border, and a resting swatch's label. */
  plate: '#FFF8E8',
  plateInk: '#2A1810',
  /** The dish count: a green pill. */
  green: '#2F7D4A',
  greenInk: '#FFFFFF',
  /** The section number, a saffron disc; and the lit swatch's label. */
  saffron: '#E9A51B',
  saffronInk: '#2A1810',
  red: '#B3202A',
  indigo: '#23306B',
  /** The solid behind the sticky strip of swatches. */
  stripBacking: '#E9D5A8',
  /** A keyboard focus ring: dark, drawn on the strip's backing, a rug's field or the add button's surround. */
  ring: '#2A1810',
  /** A resting swatch's label under the pointer. */
  hover: '#FFE9B0',
} as const;

/**
 * The fixed colours as custom properties on the body (`--rg-<name>`, `priceInk` as `--rg-price-ink`): rugs.css reads only
 * these, so the stylesheet and the tested constants are one source.
 */
export const RUG_VARS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RUG).map(([name, hex]) => [`--rg-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, hex]),
);

export interface Weave {
  /** The rug's frame pattern, `zigzag`, `diamonds`, `chevrons` or `dots`. */
  pattern: 'zigzag' | 'diamonds' | 'chevrons' | 'dots';
  /** The frame's colours: the base, then two figures woven on it. */
  base: string;
  one: string;
  two: string;
  /** The rug's field: a solid, light tint every text on it is measured against. */
  field: string;
}

/** The rugs the sections take in turn, each its own pattern and colours. */
export const WEAVES: readonly Weave[] = [
  {
    pattern: 'zigzag',
    base: '#E9A51B',
    one: '#B3202A',
    two: '#2F7D4A',
    field: '#FBF3E0',
  },
  {
    pattern: 'diamonds',
    base: '#FFF8E8',
    one: '#23306B',
    two: '#E9A51B',
    field: '#FCEBC9',
  },
  {
    pattern: 'chevrons',
    base: '#23306B',
    one: '#FFF8E8',
    two: '#B3202A',
    field: '#F9E6DC',
  },
  {
    pattern: 'dots',
    base: '#B3202A',
    one: '#FFF8E8',
    two: '#E9A51B',
    field: '#EAEFF8',
  },
];

/** The weave of the rug at `index`: a place in the cycle, wrapping both ways. */
export function weaveOf(index: number): Weave & { index: number } {
  const at = ((index % WEAVES.length) + WEAVES.length) % WEAVES.length;
  return { ...WEAVES[at]!, index: at };
}

/**
 * A rug's woven frame as a CSS `background` (gradients only), its pattern repeating every `tile` pixels: zigzags (saffron
 * ground), diamonds (ivory ground), chevrons (indigo ground) or dots (red ground), in the weave's colours. The rug's frame
 * and a strip swatch both use it, at their own tile size.
 */
export function frameOf(weave: Weave, tile: number): string {
  const half = tile / 2;
  const size = `${tile}px ${tile}px`;
  const { base, one, two } = weave;
  switch (weave.pattern) {
    case 'zigzag':
      return [
        `linear-gradient(135deg, ${one} 25%, transparent 25%) -${half}px 0/${size}`,
        `linear-gradient(225deg, ${one} 25%, transparent 25%) -${half}px 0/${size}`,
        `linear-gradient(315deg, ${two} 25%, transparent 25%) 0 0/${size}`,
        `linear-gradient(45deg, ${two} 25%, transparent 25%) 0 0/${size}`,
        base,
      ].join(', ');
    case 'diamonds':
      return [
        `linear-gradient(45deg, ${one} 25%, transparent 25%, transparent 75%, ${one} 75%) 0 0/${size}`,
        `linear-gradient(45deg, ${two} 25%, transparent 25%, transparent 75%, ${two} 75%) ${half}px ${half}px/${size}`,
        base,
      ].join(', ');
    case 'chevrons':
      return [
        `linear-gradient(135deg, ${one} 25%, transparent 25%) -${half}px 0/${size}`,
        `linear-gradient(225deg, ${one} 25%, transparent 25%) -${half}px 0/${size}`,
        `linear-gradient(0deg, ${two} 0 ${Math.round(tile / 7)}px, transparent ${Math.round(tile / 7)}px)`,
        base,
      ].join(', ');
    case 'dots':
      return [
        `radial-gradient(circle, ${one} 0 ${tile / 5}px, transparent ${tile / 5 + 0.5}px) 0 0/${size}`,
        `radial-gradient(circle, ${two} 0 ${tile / 8}px, transparent ${tile / 8 + 0.5}px) ${half}px ${half}px/${size}`,
        base,
      ].join(', ');
  }
}
