/**
 * The 3D Printer shape's own fills (its default look, every fill drawn from the template palette so Customize recolours it: a print bed is dark steel with a hot orange head, not the
 * page colours). Every text in the shape sits on one of these solid fills, so each pair is a computed contrast
 * (tests/ui/printer-shape.test.ts). `printer.css` resolves to these values with the signature palette (checked in the test). The one colour
 * that follows the palette is the rail's fill and the printhead (`riseOf` in beach-fills.ts: the accent lifted towards white).
 */
export const PRINTER = {
  /** The bed: the page behind the parts. */
  bg: '#121417',
  /** A slab. */
  panel: '#1a1d21',
  /** Rules, the rail and the slab's outline (no text on it). */
  line: '#2a2f35',
  /** The strip's backing. */
  strip: '#15181b',
  /** A resting nozzle chip. */
  chip: '#1d2024',
  /** Text on a resting chip and the strip. */
  chipInk: '#cfd5db',
  /** The part number and layer count pills. */
  pill: '#2a2f35',
  /** Text on the bed, the slab and the pills. */
  ink: '#e9ecef',
  /** Secondary text: layer codes and the meter. */
  muted: '#aab1b9',
  /** The hot orange: price, the lit chip, the sale chip, the add button, focus rings. */
  hot: '#ff7a1a',
  /** Text on the hot fill. */
  hotInk: '#121417',
} as const;
