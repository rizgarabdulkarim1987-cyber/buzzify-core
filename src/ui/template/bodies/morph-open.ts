/**
 * Photo to Details: a tapped tile's photo grows into place in the dish's details (a FLIP-style move, `transform` and
 * `opacity` only). Before the dish opens, the body records where the tile's photo is; once the details are on screen, a
 * copy of that photo (the clone) is shown in the top layer (a manual popover, so it sits above the open dialog), laid out
 * where the details' photo rests, started over the tile and let go: it moves and scales into place, then fades out over
 * the real photo and is removed. Nothing in the shared detail component is touched: its photo is found as the first
 * picture of a useful size in the open dialog. When motion is not wanted, there is no photo to copy, or the details show
 * no picture of their own in time, the dish simply opens and no clone is ever left behind.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How long the photo takes to grow into place. */
export const MORPH_MS = 280;
/** Waits at most this long for the details to appear (their code loads on the first open); then it just opens plain. */
const WAIT_MS = 900;
/** The clone is removed after this at the latest, even when the browser never reports the end of the move. */
const CLEANUP_MS = MORPH_MS + 600;

/**
 * The tile's tall and short heights, in the mosaic's row units: in every three, the middle one is tall, so neighbours
 * always differ. The section's first tile is short, so the next section's first dish still shows on a phone's first screen.
 */
export const TALL_SPAN = 42;
export const SHORT_SPAN = 32;
export function tileSpan(index: number): number {
  return index % 3 === 1 ? TALL_SPAN : SHORT_SPAN;
}

/**
 * The transform that starts the clone (laid out at `to`, scaled from its top start corner) over `from`; null when `to`
 * has no size to grow into. Ends at `none`.
 */
export function morphStart(from: Box, to: Box): string | null {
  if (to.width <= 0 || to.height <= 0) return null;
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

/** A box as plain numbers. */
function boxOf(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Where the details' photo will rest: the open dialog's first picture that is big enough to be the dish's photo (not an
 * icon), measured without the move its ancestors are still making as the sheet slides in (their `transform`s).
 */
function restingPhoto(): { target: Box; picture: Element } | null {
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) return null;
  for (const picture of dialog.querySelectorAll('img, svg')) {
    const rect = picture.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80) continue;
    let dx = 0;
    let dy = 0;
    for (let node: Element | null = picture; node; node = node.parentElement) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      dx += matrix.m41;
      dy += matrix.m42;
      if (node === dialog) break;
    }
    // The picture sits inside a frame (a span) the same size: the frame is what the clone grows into.
    return { target: { left: rect.left - dx, top: rect.top - dy, width: rect.width, height: rect.height }, picture };
  }
  return null;
}

/** Whether the page can draw the clone above the open dialog. */
function canMorph(): boolean {
  return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' && typeof DOMMatrixReadOnly !== 'undefined';
}

/**
 * Opens the dish with `open`, and (unless `reduced`, or the photo cannot be copied) grows `photo` into the details. The
 * clone is `[data-morph-clone]`; it is removed on `transitionend` (and by a timer if that never comes).
 */
export function morphOpen({ photo, open, reduced }: { photo: Element | null; open: () => void; reduced: boolean }): void {
  const source = photo?.firstElementChild;
  const rect = photo?.getBoundingClientRect();
  const motion = !reduced && canMorph() && !!source && !!photo?.querySelector('img, svg') && !!rect && rect.width > 0 && rect.height > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!motion) {
    open();
    return;
  }
  const from = boxOf(rect);
  const copy = source.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  copy.style.cssText = 'position:absolute;inset:0;inline-size:100%;block-size:100%;aspect-ratio:auto;margin:0;';
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
    cancelAnimationFrame(frame);
    clearTimeout(cleanup);
    if (clone.matches(':popover-open')) clone.hidePopover();
    clone.remove();
  };
  const cleanup = window.setTimeout(finish, WAIT_MS + CLEANUP_MS);
  const began = performance.now();
  let frame = 0;
  const attempt = () => {
    if (done) return;
    const resting = restingPhoto();
    if (!resting) {
      if (performance.now() - began > WAIT_MS) finish();
      else frame = requestAnimationFrame(attempt);
      return;
    }
    const start = morphStart(from, resting.target);
    if (!start) {
      finish();
      return;
    }
    const { target } = resting;
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
    document.body.appendChild(clone);
    clone.showPopover();
    clone.addEventListener('transitionend', (event) => {
      if (event.target === clone && event.propertyName === 'opacity') finish();
    });
    // Commit the start state, then let go.
    void clone.offsetWidth;
    clone.style.transition = `transform ${MORPH_MS}ms cubic-bezier(0.23, 1, 0.32, 1), opacity 120ms linear ${MORPH_MS - 80}ms`;
    clone.style.transform = 'none';
    clone.style.opacity = '0';
  };
  frame = requestAnimationFrame(attempt);
}
