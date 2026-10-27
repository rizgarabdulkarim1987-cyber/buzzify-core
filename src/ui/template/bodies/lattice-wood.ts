/**
 * The Baghdad Shanashil shape's own fills (the same on every palette: an oriel is carved wood and turquoise glass, not
 * the page's colours). Every text in the shape sits on one of these solid fills, so each pair is a computed contrast
 * (tests/ui/lattice-shape.test.ts). `lattice.css` writes the same values; the test checks they stay in step.
 */
export const WOOD = {
  /** The carved header board, the pane panel and the strip behind the chips. */
  board: '#4a2a12',
  /** The name plaque under a pane. */
  plaque: '#5e3818',
  /** A strip chip's frame (the window it holds is `glass`). */
  chip: '#6b4120',
  /** The dark rim round a pane and a plaque (the focus ring sits on it). */
  edge: '#2b1709',
  /** Text on wood. */
  cream: '#fbeccb',
  /** The price tag, the dish count and the lit chip's frame. */
  brass: '#e2b04a',
  brassInk: '#2a1608',
  /** Turquoise glass: the strip's windows and the section number. */
  glass: '#0f6767',
  /** The window in view on the strip. */
  lit: '#7fe0d6',
  litInk: '#0e2b2a',
  /** The mashrabiya frame round a pane, and its lattice lines. */
  turquoise: '#1f8a8a',
  mesh: '#6fd4cb',
  /** The keyboard focus ring. */
  ring: '#fff4d6',
} as const;
