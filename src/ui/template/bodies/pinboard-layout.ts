/**
 * The pinboard family's pure maths (no React, no DOM), unit-tested in tests/ui/pinboard-body.test.ts: how far each
 * piece leans, how a tailor's cloth flutters, the numbers on a tape measure. Every value comes from the dish's place, so
 * a dish always leans the same way on every render (never random per render).
 */

export const PINBOARD_MOTIFS = ['album', 'afish', 'pass', 'xayat', 'ticket'] as const;
export type PinboardMotif = (typeof PINBOARD_MOTIFS)[number];

/** Each motif's lean pattern (degrees), repeated down the board: neighbours lean opposite ways, never all alike. */
const TILTS: Record<PinboardMotif, readonly number[]> = {
  album: [-2.4, 1.8, 1.2, -1.6, -0.8, 2.2],
  afish: [-1.6, 1.4],
  pass: [-2.7, 2, -1.3, 2.7, -2, 1.3],
  xayat: [-1.5, 1.2, 0.8, -1, 1.6, -0.6],
  ticket: [-1.2, 1, 0.6, -0.8],
};

/** How far the piece at `at` (0-based in its section) leans, in degrees. */
export function pinTilt(motif: PinboardMotif, at: number): number {
  const pattern = TILTS[motif];
  return pattern[((at % pattern.length) + pattern.length) % pattern.length]!;
}

/** A steady number in [0, 1) for a seed: the same cloth always flutters the same way. */
export function pinNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A tailor's cloth swaying from its pin: its period (s) and phase (s, negative, already swaying), so neighbours differ. */
export function clothSway(seed: number): { time: number; delay: number } {
  return { time: Number((3.6 + pinNoise(seed) * 2).toFixed(2)), delay: -Number((pinNoise(seed + 1) * 4).toFixed(2)) };
}

/** The numbers printed along a tape measure, a mark every ten: 10, 20 … `count` × 10. */
export function tapeMarks(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, at) => (at + 1) * 10);
}

/** An old ticket's serial: its section's place (hundreds) and its place in the section, from 101. */
export function ticketSerial(place: number, at: number): number {
  return (place + 1) * 100 + at + 1;
}
