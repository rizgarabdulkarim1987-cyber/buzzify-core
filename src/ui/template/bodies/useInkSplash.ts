'use client';

import { useCallback, useEffect, useRef } from 'react';

/** The ink's spread, then its fade (ms): the mockup's 420 and 260. */
export const INK_SPREAD_MS = 420;
export const INK_FADE_MS = 260;

/**
 * The signature motion of the Section Ink shape: a tap on a section chip pours that section's colour over the screen
 * from the finger (a circle growing from the chip, `clip-path`), the page jumps to the section while the screen is covered, and
 * the colour fades away to show it. The returned function takes the tapped chip, the section's colour and what to do once
 * the screen is covered (the jump). The layer is one fixed `aria-hidden` element on the document, taking no taps; it is
 * removed when it has faded. With less motion, with no Web Animations, or when the page is not drawn (a hidden tab), the
 * jump happens at once and nothing is drawn. A second tap while the colour is out finishes the first at once. Nothing
 * runs at any other time.
 */
export function useInkSplash(reduced: boolean): (chip: HTMLElement, colour: string, cover: () => void) => void {
  const live = useRef<{ layer: HTMLElement; finish: () => void } | null>(null);

  useEffect(
    () => () => {
      live.current?.finish();
    },
    [],
  );

  return useCallback(
    (chip, colour, cover) => {
      live.current?.finish();
      if (reduced || typeof document === 'undefined' || typeof Element.prototype.animate !== 'function' || document.visibilityState === 'hidden') {
        cover();
        return;
      }
      const at = chip.getBoundingClientRect();
      const x = Math.round(at.left + at.width / 2);
      const y = Math.round(at.top + at.height / 2);
      const layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('data-ink-splash', '');
      layer.style.cssText = `position:fixed;inset:0;z-index:66;pointer-events:none;background:${colour};clip-path:circle(0px at ${x}px ${y}px)`;
      document.body.appendChild(layer);
      let covered = false;
      let done = false;
      const timers: number[] = [];
      const jump = () => {
        if (covered) return;
        covered = true;
        cover();
      };
      const finish = () => {
        if (done) return;
        done = true;
        timers.forEach((timer) => window.clearTimeout(timer));
        jump();
        layer.remove();
        if (live.current?.layer === layer) live.current = null;
      };
      live.current = { layer, finish };
      const spread = layer.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(150% at ${x}px ${y}px)` }], { duration: INK_SPREAD_MS, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' });
      const fade = () => {
        jump();
        const out = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: INK_FADE_MS, easing: 'ease-out', fill: 'forwards' });
        out.onfinish = finish;
      };
      spread.onfinish = fade;
      // A frame that is never drawn (a background tab) must not leave the page unmoved or the colour on it.
      timers.push(window.setTimeout(finish, INK_SPREAD_MS + INK_FADE_MS + 400));
    },
    [reduced],
  );
}
