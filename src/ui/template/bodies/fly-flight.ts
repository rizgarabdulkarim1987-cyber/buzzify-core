/**
 * Fly to Cart: when a guest adds a dish with the card's + button, a small copy of the dish's photo flies from the card to
 * the cart bar in an arc and the bar pulses once. The copy (`[data-fly-clone]`) is a fixed-position circle moved with
 * `transform` and `opacity` only (the Web Animations API), and is removed when it lands, whatever happens. Nothing in the
 * cart bar or the dish details is touched: the bar is found by its existing `data-testid="cart-bar"`, and only gets a
 * class for a moment. When motion is not wanted, there is no bar to fly to, or the browser cannot animate it, the dish is
 * simply added and no copy is ever left behind.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How long the flight takes. */
export const FLY_MS = 450;
/** The flying photo's diameter. */
export const FLY_SIZE = 56;
/** The class the cart bar wears for one pulse (the shape's CSS draws it). */
export const FLY_PULSE = 'fly-pulse';
/** The cart bar's existing hook (CartBar.tsx). */
const BAR = '[data-testid="cart-bar"]';
/** The first add shows the bar a moment later (it renders once the cart has a line): wait this long for it at most. */
const BAR_WAIT_MS = 600;
/** The copy is removed after this at the latest, even when the browser never reports the end of the flight. */
const CLEANUP_MS = FLY_MS + 400;

/**
 * The flight as keyframes: the copy (laid out at the viewport's top start corner, `size` square) moves its centre from
 * the photo's centre, over a peak above both ends, to the target's centre, shrinking as it lands. `transform` and
 * `opacity` only.
 */
export function flightFrames(from: Box, to: Box, size: number = FLY_SIZE): Keyframe[] {
  const x0 = from.left + from.width / 2 - size / 2;
  const y0 = from.top + from.height / 2 - size / 2;
  const x1 = to.left + to.width / 2 - size / 2;
  const y1 = to.top + to.height / 2 - size / 2;
  const peak = Math.min(y0, y1) - 90;
  const at = (x: number, y: number, scale: number) => `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  return [
    { transform: at(x0, y0, 1.1), opacity: 1, offset: 0 },
    { transform: at((x0 + x1) / 2, peak, 0.9), opacity: 1, offset: 0.5 },
    { transform: at(x1, y1, 0.35), opacity: 0.85, offset: 1 },
  ];
}

function boxOf(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Whether the page can draw the flight. */
function canFly(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function' && typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The bar pulses once: its class is on for a moment (the CSS animates it), then off. Not for less motion. */
function pulse(bar: Element) {
  if (bar.classList.contains(FLY_PULSE)) {
    bar.classList.remove(FLY_PULSE);
    void (bar as HTMLElement).offsetWidth;
  }
  bar.classList.add(FLY_PULSE);
  const off = () => bar.classList.remove(FLY_PULSE);
  bar.addEventListener('animationend', off, { once: true });
  window.setTimeout(off, 900);
}

/**
 * Flies a copy of `photo`'s picture (a plain disc in the button's colours when the dish has none) from the photo to the
 * cart bar, then pulses the bar. Call it right after the dish is added; `button` is the add button (it lends its
 * colours). Does nothing when `reduced`.
 */
export function flyToCart({ photo, button, reduced }: { photo: Element | null; button: Element; reduced: boolean }): void {
  if (reduced || !photo || !canFly()) return;
  const rect = photo.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const from = boxOf(rect);
  const look = getComputedStyle(button);
  const flyer = document.createElement('div');
  flyer.setAttribute('data-fly-clone', '');
  flyer.setAttribute('aria-hidden', 'true');
  flyer.style.cssText = [
    'position:fixed',
    'inset:0 auto auto 0',
    'margin:0',
    'padding:0',
    'z-index:60',
    'pointer-events:none',
    'overflow:hidden',
    'border-radius:50%',
    `width:${FLY_SIZE}px`,
    `height:${FLY_SIZE}px`,
    `border:3px solid ${look.color}`,
    `background:${look.backgroundColor}`,
    'box-shadow:0 8px 18px rgb(0 0 0 / 0.3)',
    'box-sizing:border-box',
    'will-change:transform,opacity',
    'transform:translate3d(-200px,-200px,0)',
    'opacity:0',
  ].join(';');
  const source = photo.querySelector('img, svg');
  if (source) {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.style.cssText = 'display:block;position:static;inline-size:100%;block-size:100%;max-inline-size:none;object-fit:cover;margin:0;';
    flyer.appendChild(copy);
  }
  let done = false;
  let frame = 0;
  let animation: Animation | undefined;
  const finish = (landed: Element | null) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(cleanup);
    animation?.cancel();
    flyer.remove();
    if (landed?.isConnected) pulse(landed);
  };
  const cleanup = window.setTimeout(() => finish(null), BAR_WAIT_MS + CLEANUP_MS);
  const began = performance.now();
  const attempt = () => {
    if (done) return;
    const bar = document.querySelector(BAR);
    if (!bar) {
      if (performance.now() - began > BAR_WAIT_MS) finish(null);
      else frame = requestAnimationFrame(attempt);
      return;
    }
    const target = bar.getBoundingClientRect();
    document.body.appendChild(flyer);
    animation = flyer.animate(flightFrames(from, boxOf(target)), { duration: FLY_MS, easing: 'cubic-bezier(0.55, 0, 0.3, 1)', fill: 'forwards' });
    animation.onfinish = () => finish(bar);
    animation.oncancel = () => finish(null);
  };
  frame = requestAnimationFrame(attempt);
}
