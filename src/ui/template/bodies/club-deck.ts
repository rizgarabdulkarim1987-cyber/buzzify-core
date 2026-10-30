/**
 * The pure maths of the club family (ClubBody.tsx: The DJ Decks `dj`, Neon Alley `neon`, Holo Cards `holo`): a
 * section's track letter, a record's phase, a sign's tube colour and buzz, a card's rarity and tilt. No React, no DOM,
 * so it is unit-tested on its own (tests/ui/club-body.test.ts).
 */

/** A steady pseudo-random number in [0, 1) for a seed: the same dish always spins and buzzes the same way. */
export function clubNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A section's side of the record (A, B, C... Z, then AA, AB...), from its place in the full menu. */
export function deckLetter(place: number): string {
  const at = Math.max(0, Math.floor(place));
  const one = String.fromCharCode(65 + (at % 26));
  return at < 26 ? one : deckLetter(Math.floor(at / 26) - 1) + one;
}

/** How long a record takes to turn once (s): slow enough that the dish on its label stays a dish, not a blur. */
export const DECK_TURN = 4.8;

/**
 * How far into its turn a record starts (a negative delay in s, within one turn), so the records of a grid never show
 * their photos at the same angle.
 */
export function deckPhase(seed: number): number {
  return -Number((clubNoise(seed) * DECK_TURN).toFixed(2));
}

/**
 * The tone arm's angle (degrees, from hanging straight down off its pivot at the deck's top end corner): resting beside
 * the platter, or with the needle on the record's outer grooves (never over the photo on the label). Worked out for the
 * geometry in dj.css: the platter 70cqi square at the start, the pivot 9cqi in from the end and 5cqi down, the arm 36cqi.
 */
export const ARM_REST = 6;
export const ARM_PLAY = 50;

/** Where the needle lands for an arm angle, in cqi of the deck's top, from its start corner (the CSS geometry). */
export function needleAt(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: 91 - 36 * Math.sin(rad), y: 5 + 36 * Math.cos(rad) };
}

/** The neon tubes' hues, one per section (pink, cyan, yellow, green, orange, violet), repeating. */
export const NEON_TUBES = [328, 190, 52, 145, 24, 282] as const;

export function neonTube(place: number): number {
  return NEON_TUBES[((place % NEON_TUBES.length) + NEON_TUBES.length) % NEON_TUBES.length]!;
}

/** The section signs that flicker like an old tube (every other one, from the second). */
export function signFlickers(place: number): boolean {
  return place % 2 === 1;
}

/** The lightboxes whose tube buzzes now and then: about one in five, never two neighbours in a row. */
export function boxBuzzes(place: number, at: number): boolean {
  if (at > 0 && clubNoise(place * 97 + at - 1) < 0.2) return false;
  return clubNoise(place * 97 + at) < 0.2;
}

/** A buzzing tube's own clock: its period (s) and its phase (negative s), so two never blink together. */
export function buzzClock(place: number, at: number): { time: number; delay: number } {
  const seed = place * 53 + at * 7 + 3;
  return { time: Number((5 + clubNoise(seed) * 4).toFixed(2)), delay: -Number((clubNoise(seed + 11) * 8).toFixed(2)) };
}

export type HoloRarity = 'legend' | 'rare' | 'common';

/**
 * A card's rarity, from what the restaurant and its guests say about the dish: the house's signature or a most-ordered
 * dish is legendary (gold), a dish on sale or featured is rare (foil in the accent), the rest are common.
 */
export function holoRarity(product: {
  isSignature?: boolean;
  mostOrdered?: true;
  featured?: true;
  percentOff?: number;
  regularPrice?: number;
}): HoloRarity {
  if (product.isSignature || product.mostOrdered) return 'legend';
  if (product.featured || (product.regularPrice !== undefined && product.percentOff)) return 'rare';
  return 'common';
}

/** How far a holo card leans at its edge (degrees). */
export const HOLO_LEAN = 9;

/**
 * A holo card's lean and glare for a pointer at (x, y), fractions of the card from its top left (clamped to it): it
 * leans towards the pointer, the glare sits under it (`mx`, `my` in %), and the foil shifts with it (`fx`, `fy` in -1..1).
 */
export function holoTilt(x: number, y: number): { rx: number; ry: number; mx: number; my: number; fx: number; fy: number } {
  const cx = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
  const cy = Math.min(1, Math.max(0, Number.isFinite(y) ? y : 0.5));
  const round = (value: number) => Math.round(value * 100) / 100 || 0;
  return {
    rx: round((0.5 - cy) * 2 * HOLO_LEAN),
    ry: round((cx - 0.5) * 2 * HOLO_LEAN),
    mx: round(cx * 100),
    my: round(cy * 100),
    fx: round((cx - 0.5) * 2),
    fy: round((cy - 0.5) * 2),
  };
}
