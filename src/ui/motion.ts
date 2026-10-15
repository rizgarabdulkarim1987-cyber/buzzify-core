/**
 * The motion vocabulary. Springs and easings live here so the whole menu moves with one voice.
 *
 * - Things that respond to a tap use `SPRING`: it is interruptible, so a second tap redirects the
 *   motion instead of restarting it.
 * - Things that settle (numbers, fades) use `EASE_OUT`: strong at the start, so the interface answers
 *   at once, and gentle at the end.
 * - Nothing animates on keyboard actions that are repeated all day, and the slow moments (the
 *   stack assembling) happen once.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export const SPRING = { type: 'spring', duration: 0.4, bounce: 0.12 } as const;

/** How long a price takes to roll to its new value. */
export const ROLL_SECONDS = 0.38;
