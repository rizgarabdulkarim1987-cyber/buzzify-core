/**
 * The pure maths of batch 25's three bodies (the Fighter Radar `hud`, the Aquarium `aqua`, the Bank of Taste `bank`):
 * target codes, the fish's swim and the bubbles, the banknotes' colours and serial numbers. No React, no DOM, so it is
 * unit-tested on its own (tests/ui/signature-25-body.test.ts).
 */

/** A steady pseudo-random number in [0, 1) for a seed: the same dish always swims the same way. */
export function sigNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A section's letter on the radar, from its place in the full menu: A to Z, then AA, AB... (never empty). */
export function sectorLetter(place: number): string {
  const at = Math.max(0, Math.floor(place));
  const one = String.fromCharCode(65 + (at % 26));
  return at < 26 ? one : sectorLetter(Math.floor(at / 26) - 1) + one;
}

/** A dish's target code on the radar: its section's letter and its place in the section from 1 (`B3`). */
export function targetCode(place: number, at: number): string {
  return `${sectorLetter(place)}${at + 1}`;
}

/** A fish's swim: its period (s), its phase (s, negative: already swimming) and its sideways drift (px, ±5). */
export function aquaSwim(seed: number): { time: number; delay: number; dx: number } {
  return {
    time: Number((3.6 + sigNoise(seed) * 2).toFixed(2)),
    delay: -Number((sigNoise(seed + 11) * 5).toFixed(2)),
    dx: Math.round((sigNoise(seed + 23) - 0.5) * 10),
  };
}

/** The bubbles rising in a section: where each starts across (% of the width), its size (px), its rise (s) and phase (s). */
export function aquaBubbles(count: number, seed: number): { x: number; size: number; time: number; delay: number }[] {
  return Array.from({ length: count }, (_, at) => ({
    x: Math.round(4 + ((at + sigNoise(seed * 13 + at)) / Math.max(1, count)) * 90),
    size: 6 + Math.round(sigNoise(seed * 7 + at * 5 + 1) * 10),
    time: Number((7 + sigNoise(seed * 3 + at * 11 + 2) * 5).toFixed(2)),
    delay: -Number((sigNoise(seed * 5 + at * 17 + 3) * 10).toFixed(2)),
  }));
}

/**
 * How far (degrees round the colour wheel) a section's banknote turns from the palette's accent: each section is its
 * own denomination, like a currency's notes. The first keeps the accent itself; the lightness stays the accent's, so
 * the note's words (`--on-accent`) keep their contrast.
 */
const NOTE_TURNS = [0, 150, 245, 60, 300, 105] as const;
export function noteTurn(place: number): number {
  return NOTE_TURNS[((place % NOTE_TURNS.length) + NOTE_TURNS.length) % NOTE_TURNS.length]!;
}

/** A banknote's serial number: its section's letter, its place (two digits) and six steady digits (`B03 598671`). */
export function noteSerial(place: number, at: number): string {
  const tail = String((483920 + at * 7919 + place * 104729) % 1_000_000).padStart(6, '0');
  return `${sectorLetter(place)}${String(at + 1).padStart(2, '0')} ${tail}`;
}
