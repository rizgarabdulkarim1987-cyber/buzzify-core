/**
 * The arithmetic of the Stacked Sheets shape (the motion-stk mockup): where a sheet sticks, how far the sheet over it
 * has covered it, which sheet is the one being read. Pure functions, so they are tested without a page.
 */

/** The sheets' hues (degrees), spread around the wheel so neighbours differ: peach, yellow, mint, pink, blue, lilac. */
export const STACK_HUES = [14, 46, 140, 335, 220, 270] as const;

/** The room a sheet leaves at the bottom of the screen when it is taller than the screen (the cart bar's, about). */
export const STACK_DOCK = 52;

/** The hue of the nth sheet; the set repeats once it is used up. */
export function stackHue(index: number): number {
  return STACK_HUES[((index % STACK_HUES.length) + STACK_HUES.length) % STACK_HUES.length]!;
}

/**
 * Where a sheet sticks (its `top`, px from the top of the screen): under the strip, but no lower than leaves its whole
 * foot (`dock` px above the screen's bottom) on the screen, so a sheet taller than the screen scrolls until its end shows
 * and only then stays while the next slides over it (a negative `top`).
 */
export function stickyTop(strip: number, viewport: number, sheet: number, dock: number = STACK_DOCK): number {
  return Math.min(strip, viewport - sheet - dock);
}

/** How much of a sheet (0 to 1) the sheet after it has slid over: the overlap of the two, in the sheet's own height. */
export function coverProgress(sheetBottom: number, nextTop: number, sheetHeight: number): number {
  if (sheetHeight <= 0) return 0;
  return Math.min(1, Math.max(0, (sheetBottom - nextTop) / sheetHeight));
}

/**
 * The index of the sheet being read: the last whose top has reached `line` (px from the top of the screen), 0 before any
 * has, and the last one when the page is scrolled to its end (a short last sheet may never reach the line).
 */
export function litSheet(tops: readonly number[], line: number, atEnd: boolean): number {
  if (tops.length === 0) return 0;
  if (atEnd) return tops.length - 1;
  let lit = 0;
  tops.forEach((top, index) => {
    if (top <= line) lit = index;
  });
  return lit;
}
