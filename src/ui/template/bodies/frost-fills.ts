/**
 * The Frosted Window shape's own fills (its default look, every fill drawn from the template palette so Customize recolours it: a winter window is night blue and frost, not the page
 * colours). Every text in the shape sits on one of these solid fills, so each pair is a computed contrast
 * (tests/ui/frost-shape.test.ts). `frost.css` resolves to these values with the signature palette (checked in the test). The one colour
 * that follows the palette is the lit chip's ring (`riseOf`), kept visible on the deep chip by construction.
 */
export const FROST = {
  /** The page behind the panes (a winter night). */
  night: '#0b1730',
  /** The glass of a pane. */
  dusk: '#16294d',
  /** The window frame, the rime, a resting chip and the label plate. */
  frame: '#dcebf8',
  /** Text on the frame. */
  frameInk: '#0c1f3a',
  /** A lit chip, the number and the count badges. */
  deep: '#0a1a33',
  /** Text on the deep fill. */
  ice: '#eaf4ff',
  /** A frost card. */
  card: '#f2f8ff',
  /** The dish name on the card. */
  cardInk: '#0c1f3a',
  /** The price on the card. */
  priceInk: '#0b2f5e',
  /** The sale chip. */
  sale: '#7a0c2c',
  /** Text on the sale chip. */
  saleInk: '#ffffff',
  /** The add button. */
  add: '#0c1f3a',
  /** The plus on the add button. */
  addInk: '#f2f8ff',
  /** The strongest the condensation ever gets over a card (its text still reads through it). */
  fogOpacity: 0.3,
} as const;

/** The lit ring colour for an accent (shared/rise.ts: the accent lifted 55% towards white, as the CSS draws it). */
export { riseOf } from './shared/rise';

/** `top` laid over `under` at `opacity`, as a hex colour (what a fog of `top` leaves of `under`). */
export function blendOver(under: string, top: string, opacity: number): string {
  const mixed = [1, 3, 5].map((at) => Math.round(parseInt(under.slice(at, at + 2), 16) * (1 - opacity) + parseInt(top.slice(at, at + 2), 16) * opacity));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
