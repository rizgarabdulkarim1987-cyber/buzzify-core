import type { StageArt } from './stage';

/**
 * How the menu's category rail moves. Each restaurant picks one in its brand settings:
 * - grains: the active category's dish, made of gold grains, melts and reforms as the category changes
 * - drum: the names ride a turning 3D drum with the active one facing the guest
 * - flap: the active name flips into place letter by letter, like a station departures board
 * - deck: the categories are a fanned deck of cards; the active card lifts to the front
 * - plain: a row of names with a sliding underline
 */
export const RAIL_STYLES = ['grains', 'drum', 'flap', 'deck', 'plain'] as const;
export type RailStyle = (typeof RAIL_STYLES)[number];

export const DEFAULT_RAIL_STYLE: RailStyle = 'grains';

/** The dish a category is shown with: the model of its first product with a 3D stage, else a plate. */
export type RailDish = StageArt | 'plate';

export function isRailStyle(value: unknown): value is RailStyle {
  return typeof value === 'string' && (RAIL_STYLES as readonly string[]).includes(value);
}

/** The style the menu uses: the restaurant's choice, or the plain rail when it has turned motion off. */
export function resolveRailStyle(stored: unknown, motion: 'none' | 'subtle' | 'expressive'): RailStyle {
  if (motion === 'none') return 'plain';
  return isRailStyle(stored) ? stored : DEFAULT_RAIL_STYLE;
}

/** A style to preview instead of the restaurant's own, from `?rail=` in the address. */
export function railStyleFromQuery(search: string): RailStyle | null {
  const value = new URLSearchParams(search).get('rail');
  return isRailStyle(value) ? value : null;
}

export interface CardPose {
  /** Pixels along the rail, positive toward the end of the line. */
  x: number;
  /** Pixels down. */
  y: number;
  /** Pixels toward the guest. */
  z: number;
  /** Degrees. */
  rotateY: number;
  /** Degrees. */
  rotateZ: number;
  /** Cards stay solid so the ones in front hide the ones behind; only the far ends fade out. */
  opacity: number;
  /** How much darker than the active card, 0 to 1: cards further back sit in shadow. */
  shade: number;
  /** Stacking order: the card nearest the front is on top. */
  layer: number;
}

const DECK = { spread: 78, depth: 70, turn: 28, tilt: 4, drop: 5, lift: 8, rise: 30, solid: 2, fade: 1.5, shadow: 0.22 };

/**
 * Where a card in the fanned deck sits, given how many places it is from the active card (fractional while
 * the guest drags the fan). Cards fan toward the end of the line, so the fan mirrors in right-to-left layouts.
 */
export function deckPose(offset: number, rtl: boolean): CardPose {
  const side = rtl ? -1 : 1;
  const away = Math.abs(offset);
  const front = Math.max(0, 1 - away);
  return {
    x: side * offset * DECK.spread + 0,
    y: away * DECK.drop - front * DECK.lift,
    z: front * DECK.rise - away * DECK.depth,
    rotateY: -side * offset * DECK.turn + 0,
    rotateZ: side * offset * DECK.tilt + 0,
    opacity: Math.max(0, Math.min(1, 1 - (away - DECK.solid) / DECK.fade)),
    shade: Math.min(0.6, away * DECK.shadow),
    layer: 100 - Math.round(away * 10),
  };
}

/** Degrees between neighbouring names on the drum: 40, or less when that many would not fit round it. */
export function drumStep(count: number): number {
  return Math.min(40, 360 / Math.max(1, count));
}

/** The drum's radius in pixels for names `width` wide, `step` degrees apart, so neighbours just touch. */
export function drumRadius(step: number, width: number): number {
  return width / (2 * Math.sin(((step / 2) * Math.PI) / 180));
}
