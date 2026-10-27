/**
 * The Ishtar Gate shape's own fills (the same on every palette: a glazed gate is lapis, gold and sand, not the page's
 * colours). Every text in the shape sits on one of these solid fills, so each pair is a computed contrast
 * (tests/ui/gate-shape.test.ts). `gate.css` writes the same values; the test checks they stay in step.
 */
export const BRICK = {
  /** The glazed brick of the gate, a name cartouche, a resting chip and a door leaf. */
  lapis: '#1d4b9b',
  /** The lintel, the strip, the opening's shadow, the window of a chip. */
  deep: '#10285a',
  /** Rosettes, the badge, the lit chip, the dish count. */
  gold: '#e1b64a',
  /** Text on gold. */
  goldInk: '#2a1a05',
  /** Text on lapis and on deep blue. */
  cream: '#fff3c4',
  /** A relief tile's ground. */
  sand: '#e6c98c',
  /** The tile's rim. */
  sandEdge: '#8a5f1a',
} as const;
