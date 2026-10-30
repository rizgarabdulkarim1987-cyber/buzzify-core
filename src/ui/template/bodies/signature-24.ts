/**
 * Pure helpers of batch 24, the signature styles (spec 2026-10-28-menu-styles-77-addendum.md): The Blueprint (`blueprint`),
 * Giant Type (`giant-type`) and The Open Wall (`wall`). Kept apart from the bodies so they are unit-tested without React.
 */

import type { MediaItem } from '@/lib/media';

/** A number as two digits in the menu's numerals (`n` formats one number): 3 gives "03", 12 gives "12". */
export function twoDigits(value: number, n: (value: number) => string): string {
  return value < 10 ? n(0) + n(value) : n(value);
}

// ------------------------------------------------------------------------------------------------ The Blueprint

/** A dish's drawing number, from its section's place and its own (both 0-based): "DWG-02·05". */
export function drawingRef(section: number, dish: number, n: (value: number) => string): string {
  return `DWG-${twoDigits(section + 1, n)}·${twoDigits(dish + 1, n)}`;
}

/** A section's sheet number in its title block: its place (0-based) of all the menu's sections, "03/07". */
export function sheetOf(place: number, total: number, n: (value: number) => string): string {
  return `${twoDigits(place + 1, n)}/${twoDigits(Math.max(total, place + 1), n)}`;
}

// ------------------------------------------------------------------------------------------------ Giant Type

/** The largest and smallest giant heading, in `cqi` (hundredths of the section's width). */
export const GIANT_MAX = 26;
export const GIANT_MIN = 9;
/** Never smaller than this, even for a single very long word (about 19px on a phone). */
export const GIANT_FLOOR = 5;
/** A display glyph's mean advance, in em: on the wide side for Arabic, so a word never runs past the edge. */
const GLYPH = 0.62;
/** The share of the section's width a line may fill, in cqi. */
const ROOM = 94;

/**
 * The size (cqi) of a section's giant name: as large as fits the whole name on one line, between GIANT_MIN and
 * GIANT_MAX. A longer name wraps between its words (never inside one: Arabic letters stay joined), so the size is also
 * capped so the longest word fits the width by itself.
 */
export function giantSize(name: string): number {
  const text = name.trim().replace(/\s+/g, ' ');
  const whole = ROOM / (Math.max(1, [...text].length) * GLYPH);
  const longest = Math.max(1, ...text.split(' ').map((word) => [...word].length));
  const word = ROOM / (longest * GLYPH);
  const size = Math.max(GIANT_FLOOR, Math.min(GIANT_MAX, Math.max(GIANT_MIN, whole), word));
  return Math.floor(size * 10) / 10;
}

/** The picture that fills a section's giant letters: the first of its dishes with a photo (or a video's poster). */
export function fillOf(products: readonly { media: readonly MediaItem[] }[]): string | null {
  for (const product of products) {
    const first = product.media[0];
    if (first?.kind === 'image') return first.url;
    if (first && (first.kind === 'video' || first.kind === 'model3d') && first.poster) return first.poster;
  }
  return null;
}

/** A URL as a CSS `url()` value, quoted and escaped so it can never end the declaration. */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (char) => encodeURIComponent(char))}")`;
}

/** The five section colours of Giant Type (the accent turned round the wheel), repeating; a place gives its tone. */
export const GIANT_TONES = 5;
export function giantTone(place: number): number {
  return ((place % GIANT_TONES) + GIANT_TONES) % GIANT_TONES;
}

/** How long one loop of a section's band of names takes (s): longer for more names, so they read at one pace. */
export function bandSeconds(names: number): number {
  return Math.max(14, Math.round(names * 3.5));
}

// ------------------------------------------------------------------------------------------------ The Open Wall

/** The wall's tile sizes (rem), farthest first: the guest steps between them with − and +. */
export const WALL_TILES = [5.5, 6.75, 9] as const;
export const WALL_START = 1;

/** The next zoom level from `level` one step `by` (−1 farther, +1 closer), kept in range. */
export function wallStep(level: number, by: -1 | 1): number {
  return Math.min(WALL_TILES.length - 1, Math.max(0, level + by));
}

/** How many zones sit side by side on the wall: about square, at most three, so a guest pans both ways. */
export function wallColumns(sections: number): number {
  if (sections <= 1) return 1;
  return Math.min(3, Math.ceil(Math.sqrt(sections)));
}

/** How many tiles a zone sets in a row: three, or fewer when it has fewer dishes. */
export function zoneColumns(dishes: number): number {
  return Math.min(3, Math.max(1, dishes));
}

export interface Box {
  top: number;
  left: number;
  right: number;
}

/**
 * How far the wall must scroll (physical px, for `scrollBy`) to bring a zone to its start corner with `pad` around it:
 * the top-left corner, or the top-right one in a right-to-left menu.
 */
export function wallDelta(zone: Box, frame: Box, rtl: boolean, pad: number): { left: number; top: number } {
  return {
    top: zone.top - frame.top - pad,
    left: rtl ? zone.right - frame.right + pad : zone.left - frame.left - pad,
  };
}

/**
 * The scroll position that keeps the middle of the view on the same spot when the wall grows by `ratio`. `scroll` is
 * `scrollLeft` (negative in a right-to-left wall, which counts from its right edge) or `scrollTop`.
 */
export function zoomScroll(scroll: number, client: number, ratio: number, rtl: boolean): number {
  if (rtl) return Math.min(0, -((-scroll + client / 2) * ratio - client / 2));
  return Math.max(0, (scroll + client / 2) * ratio - client / 2);
}
