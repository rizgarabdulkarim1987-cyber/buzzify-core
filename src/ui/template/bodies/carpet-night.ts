/**
 * The One Thousand and One Nights shape's fixed colours (CarpetBody): a purple night, woven carpets, gold thread. They are
 * the shape's own and the same on every palette, so every text has a known fill and each pair is unit-tested for contrast.
 */
export const CARPET = {
  /** The solid behind the sticky strip of rolled carpets. */
  stripBacking: '#140826',
  /** A rolled carpet that is not the one in view. */
  chipFill: '#2A1556',
  chipInk: '#FFE9C4',
  /** The rolled carpet in view. */
  litFill: '#FFCC66',
  litInk: '#1A0B33',
  /** Names under the medallions, on a carpet's weave. */
  ink: '#FFE9C4',
  /** Gold thread: the embroidered title, the number badge, the add button. */
  gold: '#FFCC66',
  goldInk: '#1A0B33',
  /** The price tag: parchment edged in gold. */
  tagFill: '#FFF1D6',
  tagInk: '#2A1055',
  tagEdge: '#E0A93C',
  /** A keyboard focus ring: seen on the dark strip, the dark weaves and the gold chip's inset. */
  ring: '#FFF4DC',
  /** The top of the night sky. */
  sky: '#1A0B33',
} as const;

/**
 * The fixed colours as custom properties on the body (`--cp-<name>`, `tagFill` as `--cp-tag-fill`): carpet.css reads
 * these and writes none of them itself, so the stylesheet and the tested constants are one source.
 */
export const CARPET_VARS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CARPET).map(([name, hex]) => [`--cp-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, hex]),
);

export interface Weave {
  /** The carpet's solid ground, which every text on it is measured against. */
  base: string;
  /** The lighter thread woven over the ground (still dark enough for the ink). */
  thread: string;
}

/** The colourways the carpets take in turn: crimson, indigo, teal and plum. */
export const WEAVES: readonly Weave[] = [
  { base: '#5A1530', thread: '#7A2142' },
  { base: '#2B1B6B', thread: '#43309A' },
  { base: '#0F4048', thread: '#17606B' },
  { base: '#4A1560', thread: '#69258A' },
];

/** The weave of the carpet at `index`: a place in the cycle, wrapping both ways. */
export function carpetWeaveOf(index: number): Weave {
  return WEAVES[((index % WEAVES.length) + WEAVES.length) % WEAVES.length]!;
}
