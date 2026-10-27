/**
 * Shared pieces of the shapes that copy a dish's photo into a fixed overlay and move it (Photo to Details' grown photo,
 * morph-open.ts; Fly to Cart's flight, fly-flight.ts): a box as plain numbers, the picture of a photo frame, and a
 * once-a-frame wait for something to appear.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A box as plain numbers. */
export function boxOf(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * The dish's picture in a photo frame (`[data-photo]`): looked for inside the media only (the frame's first child, the
 * dish's `ProductMedia`), never the add button's icon or a chip on the photo. Null for a dish with no media.
 */
export function pictureIn(photo: Element | null | undefined): Element | null {
  return photo?.firstElementChild?.querySelector('img, svg') ?? null;
}

/**
 * Looks for something once a frame: `found` gets it the first time `find` returns it, `missed` runs when `waitMs` pass
 * without it. Returns a function that stops the wait.
 */
export function waitForFrame<T>(find: () => T | null, waitMs: number, found: (value: T) => void, missed: () => void): () => void {
  const began = performance.now();
  let frame = 0;
  let stopped = false;
  const attempt = () => {
    if (stopped) return;
    const value = find();
    if (value !== null) found(value);
    else if (performance.now() - began > waitMs) missed();
    else frame = requestAnimationFrame(attempt);
  };
  frame = requestAnimationFrame(attempt);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
