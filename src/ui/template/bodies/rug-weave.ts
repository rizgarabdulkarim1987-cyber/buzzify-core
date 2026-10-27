/**
 * The Jajim and Nowruz shape's rugs (RugsBody): woven rugs framed in red, indigo, saffron and green. The colours are CSS
 * variables set in rugs.css, so Customize reaches them: red is the palette's accent, ivory its raised
 * colour; saffron, green and indigo are the rugs' own dyes. A rug's field is a light tint of the raised colour, so the palette's
 * text colour always reads on it.
 */
/** The rugs' colours as the CSS variables rugs.css sets on the body. */
export const RUG_COLOUR = {
  red: 'var(--rg-red)',
  indigo: 'var(--rg-indigo)',
  saffron: 'var(--rg-saffron)',
  green: 'var(--rg-green)',
  ivory: 'var(--rg-plate)',
} as const;
const { red, indigo, saffron, green, ivory } = RUG_COLOUR;

export interface Weave {
  /** The rug's frame pattern, `zigzag`, `diamonds`, `chevrons` or `dots`. */
  pattern: 'zigzag' | 'diamonds' | 'chevrons' | 'dots';
  /** The frame's colours: the base, then two figures woven on it. */
  base: string;
  one: string;
  two: string;
  /** The rug's field: a solid tint of the raised colour, which the palette's text colour reads on. */
  field: string;
}

/** The rugs the sections take in turn, each its own pattern and colours. */
export const WEAVES: readonly Weave[] = [
  {
    pattern: 'zigzag',
    base: saffron,
    one: red,
    two: green,
    field: 'color-mix(in srgb, var(--raised) 60%, var(--bg))',
  },
  {
    pattern: 'diamonds',
    base: ivory,
    one: indigo,
    two: saffron,
    field: 'color-mix(in srgb, var(--raised) 80%, var(--rg-saffron))',
  },
  {
    pattern: 'chevrons',
    base: indigo,
    one: ivory,
    two: red,
    field: 'color-mix(in srgb, var(--raised) 90%, var(--accent))',
  },
  {
    pattern: 'dots',
    base: red,
    one: ivory,
    two: saffron,
    field: 'color-mix(in srgb, var(--raised) 75%, #9db8f0)',
  },
];

/** The weave of the rug at `index`: a place in the cycle, wrapping both ways. */
export function rugWeaveOf(index: number): Weave & { index: number } {
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
