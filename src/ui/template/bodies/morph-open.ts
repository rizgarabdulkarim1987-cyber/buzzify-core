/**
 * Photo to Details: a tapped tile's photo grows into place in the dish's details (a FLIP-style move, `transform` and
 * `opacity` only). Before the dish opens, the body records where the tile's photo is; once the details are on screen, a
 * copy of that photo (the clone) is shown in the top layer (a manual popover, so it sits above the open dialog), laid out
 * where the details' photo rests, started over the tile and let go: it moves and scales into place, then fades out over
 * the real photo and is removed. The clone's box is scaled to the tile's box; the picture inside it is counter-scaled, so
 * the picture itself always scales the same across and down (never squashed). Nothing in the shared detail component is
 * touched: its photo is found as the first picture of a useful size in the open dialog. When motion is not wanted, the
 * dish has no picture, or the details show no picture of their own in time, the dish simply opens and no clone is ever
 * left behind. A new tap, going Back and the body unmounting (`cancelMorph`) end a clone at once.
 */

import { boxOf, pictureIn, waitForFrame, type Box } from './shared/photo-overlay';

export type { Box } from './shared/photo-overlay';

/** How long the photo takes to grow into place. */
export const MORPH_MS = 280;
/** Waits at most this long for the details to appear (their code loads on the first open); then it just opens plain. */
const WAIT_MS = 900;
/** The clone is removed after this at the latest, even when the browser never reports the end of the move. */
const CLEANUP_MS = MORPH_MS + 600;
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * The transform that starts the clone's box (laid out at `to`, scaled from its top start corner) over `from`; null when
 * `to` has no size to grow into. Ends at `none`.
 */
export function morphStart(from: Box, to: Box): string | null {
  if (to.width <= 0 || to.height <= 0) return null;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

/**
 * The counter-scale that starts the picture inside the clone (from its centre): with the box's own scale it makes the
 * picture's scale the larger of the two (the same across and down, so it covers the tile unsquashed). Ends at `none`.
 */
export function morphCounter(from: Box, to: Box): string | null {
  if (to.width <= 0 || to.height <= 0 || from.width <= 0 || from.height <= 0) return null;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const s = Math.max(sx, sy);
  return `scale(${s / sx}, ${s / sy})`;
}

/**
 * Where the details' photo will rest: the open dialog's first picture that is big enough to be the dish's photo (not an
 * icon), measured as it will be once the entrance its ancestors are still playing (a slide, a scale) has ended: those
 * animations are moved to their end for the measure and put back at once, in the same task, so nothing is painted.
 */
function restingPhoto(): Box | null {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return null;
  for (const picture of dialog.querySelectorAll('img, svg')) {
    const rect = picture.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 70) continue;
    const moving = dialog.getAnimations({ subtree: true }).filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return !!target && target.contains(picture) && animation.playState !== 'finished';
    });
    const times = moving.map((animation) => animation.currentTime);
    for (const animation of moving) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end)) animation.currentTime = end;
    }
    const resting = boxOf(picture.getBoundingClientRect());
    moving.forEach((animation, at) => {
      animation.currentTime = times[at] ?? null;
    });
    return resting.width >= 120 && resting.height >= 80 ? resting : null;
  }
  return null;
}

/** Whether the page can draw the clone above the open dialog. */
function canMorph(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' && typeof Element.prototype.getAnimations === 'function';
}

/** Ends the clone in flight (if any) at once. */
let active: (() => void) | null = null;

/** Ends the clone in flight, if any (the body unmounting). */
export function cancelMorph(): void {
  active?.();
}

/**
 * Opens the dish with `open`, and (unless `reduced`, or the dish has no picture) grows `photo`'s picture into the
 * details. The clone is `[data-morph-clone]`; it is removed on `transitionend` (and by a timer if that never comes). A
 * second call ends the first one's clone, so a double tap draws one.
 */
export function morphOpen({ photo, open, reduced }: { photo: Element | null; open: () => void; reduced: boolean }): void {
  cancelMorph();
  const source = photo?.firstElementChild;
  const rect = photo?.getBoundingClientRect();
  const motion = !reduced && canMorph() && !!source && !!pictureIn(photo) && !!rect && rect.width > 0 && rect.height > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!motion) {
    open();
    return;
  }
  const from = boxOf(rect);
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  open();

  const clone = document.createElement('div');
  clone.setAttribute('data-morph-clone', '');
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('popover', 'manual');
  clone.appendChild(copy);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    stopWait();
    window.clearTimeout(cleanup);
    window.removeEventListener('popstate', finish);
    if (clone.matches(':popover-open')) clone.hidePopover();
    clone.remove();
    if (active === finish) active = null;
  };
  active = finish;
  const cleanup = window.setTimeout(finish, WAIT_MS + CLEANUP_MS);
  window.addEventListener('popstate', finish);
  const grow = (target: Box) => {
    const start = morphStart(from, target);
    const counter = morphCounter(from, target);
    if (!start || !counter) {
      finish();
      return;
    }
    clone.style.cssText = [
      'position:fixed',
      'inset:auto',
      'margin:0',
      'padding:0',
      'border:0',
      'background:none',
      'overflow:hidden',
      'pointer-events:none',
      `width:${target.width}px`,
      `height:${target.height}px`,
      `left:${target.left}px`,
      `top:${target.top}px`,
      'transform-origin:0 0',
      `transform:${start}`,
      'opacity:1',
      'will-change:transform,opacity',
    ].join(';');
    copy.style.cssText = `position:absolute;inset:0;inline-size:100%;block-size:100%;aspect-ratio:auto;margin:0;transform-origin:50% 50%;transform:${counter};will-change:transform`;
    document.body.appendChild(clone);
    clone.showPopover();
    clone.addEventListener('transitionend', (event) => {
      if (event.target === clone && event.propertyName === 'opacity') finish();
    });
    // Commit the start state, then let go.
    void clone.offsetWidth;
    clone.style.transition = `transform ${MORPH_MS}ms ${EASE}, opacity 120ms linear ${MORPH_MS - 80}ms`;
    copy.style.transition = `transform ${MORPH_MS}ms ${EASE}`;
    clone.style.transform = 'none';
    copy.style.transform = 'none';
    clone.style.opacity = '0';
  };
  const stopWait = waitForFrame(restingPhoto, WAIT_MS, grow, finish);
}
