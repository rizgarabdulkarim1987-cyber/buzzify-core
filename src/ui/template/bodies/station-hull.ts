/**
 * The Space Station shape's own fills (the same on every palette: a station hull is dark steel and glowing LEDs, not the
 * page colours). Every text in the shape sits on one of these solid fills, so each pair is a computed contrast
 * (tests/ui/station-shape.test.ts). `station.css` writes the same values; the test checks they stay in step. The one
 * colour that follows the palette is the LED text and the lit chip ring (`ledOf`), kept readable by construction.
 */
export const HULL = {
  /** The page behind the modules (the starfield ground). */
  space: '#070b1a',
  /** A module capsule panel. */
  hull: '#1a2240',
  /** A module rim, its rivets and panel lines. */
  hullEdge: '#5b6a92',
  /** The LED window: a price, a count, a lit chip. */
  deep: '#04070f',
  /** A section label plate. */
  plate: '#2b3760',
  /** A porthole status bar (the name) and a resting docking-port chip. */
  bar: '#0e1530',
  /** Text on the plate, the bar and the LED window. */
  ice: '#eef2ff',
  /** The add button and a bezel light steel. */
  steel: '#cfd8f0',
  /** Text on steel. */
  steelInk: '#0a1226',
  /** The sale chip. */
  amber: '#ffb454',
  /** Text on amber. */
  amberInk: '#1a0f00',
} as const;

/** The LED colour for an accent: the accent lifted 55% towards white (shared/rise.ts), so it reads on `HULL.deep`. */
export { riseOf as ledOf } from './shared/rise';
