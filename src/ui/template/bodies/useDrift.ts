'use client';

import { useEffect, type RefObject } from 'react';
import { DRIFT_REST_MS, DRIFT_SPEED, beatPace, driftStart, driftStep, fromScrollLeft, toScrollLeft } from './drift-motion';

interface Row {
  el: HTMLElement;
  direction: 1 | -1;
  at: number;
  /** The `scrollLeft` this hook last wrote (read back, so a browser's rounding is taken as it is). */
  written: number;
  rtl: boolean;
  visible: boolean;
  pressed: boolean;
  hovered: boolean;
  focused: boolean;
  /** No drift before this time (ms, performance clock): a hand just let go. */
  restUntil: number;
  live: boolean;
}

/**
 * The drift family's motion engine. Every `[data-drift]` row inside `root` (its value `1` or `-1`, the direction it
 * starts in) drifts sideways by itself by moving its own `scrollLeft` in one small rAF loop, turning back at its ends.
 *
 * - A row holds still while a finger or the mouse is on it, while keyboard focus is inside it, and for a moment after a
 *   hand let go (a drag's momentum, a wheel): any scroll the hook did not make is taken as the guest's and kept.
 * - Only rows on screen move; the loop stops when none is on screen. A row that moves carries `data-live`, which its CSS
 *   reads to run its own endless animations (a sway, a step, a wave), so those pause off screen and under a hand too.
 * - `beat` makes rows step on the dabka's beat instead of gliding.
 * - With `reduced` the hook does nothing: the rows stay at their first dish, still scrollable by hand.
 *
 * Rows added later (a search cleared) are picked up through a MutationObserver.
 */
export function useDrift(root: RefObject<HTMLElement | null>, reduced: boolean, beat = false): void {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    if (typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return;

    const rows = new Map<HTMLElement, Row>();
    const quit = new AbortController();
    const { signal } = quit;
    let frame = 0;
    let last = 0;

    const maxOf = (el: HTMLElement) => Math.max(0, el.scrollWidth - el.clientWidth);
    const setLive = (row: Row, live: boolean) => {
      if (row.live === live) return;
      row.live = live;
      row.el.toggleAttribute('data-live', live);
    };
    const held = (row: Row, now: number) => row.pressed || row.hovered || row.focused || now < row.restUntil;
    const rest = (row: Row) => {
      row.restUntil = performance.now() + DRIFT_REST_MS;
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const pace = beat ? beatPace(now / 1000) : 1;
      let anyVisible = false;
      for (const row of rows.values()) {
        if (!row.el.isConnected) {
          rows.delete(row.el);
          watcher.unobserve(row.el);
          continue;
        }
        if (!row.visible) {
          setLive(row, false);
          continue;
        }
        anyVisible = true;
        // A scroll the hook did not make is the guest's (a drag, a wheel, focus bringing a dish into view): keep it.
        if (Math.abs(row.el.scrollLeft - row.written) > 2) {
          row.at = fromScrollLeft(row.el.scrollLeft, row.rtl);
          row.written = row.el.scrollLeft;
          rest(row);
        }
        const max = maxOf(row.el);
        if (max <= 0 || held(row, now)) {
          setLive(row, false);
          continue;
        }
        setLive(row, true);
        const next = driftStep(row.at, row.direction, DRIFT_SPEED * dt * pace, max);
        row.at = next.at;
        row.direction = next.direction;
        row.el.scrollLeft = toScrollLeft(row.at, row.rtl);
        row.written = row.el.scrollLeft;
      }
      if (anyVisible) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const row = rows.get(entry.target as HTMLElement);
          if (row) row.visible = entry.isIntersecting;
        }
        wake();
      },
      { rootMargin: '48px 0px' },
    );

    const add = (el: HTMLElement) => {
      if (rows.has(el)) return;
      const rtl = getComputedStyle(el).direction === 'rtl';
      const direction: 1 | -1 = el.getAttribute('data-drift') === '-1' ? -1 : 1;
      const at = driftStart(direction, maxOf(el));
      if (at) el.scrollLeft = toScrollLeft(at, rtl);
      const row: Row = { el, direction, at, written: el.scrollLeft, rtl, visible: false, pressed: false, hovered: false, focused: false, restUntil: 0, live: false };
      rows.set(el, row);
      const opts = { passive: true, signal };
      // A mouse resting on a row holds it; a pen or a mouse button too. Touch is followed by its own events, since a
      // browser cancels the pointer as soon as it takes the finger for a scroll.
      el.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') row.hovered = true; }, opts);
      el.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') { row.hovered = false; row.pressed = false; } }, opts);
      el.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'touch') row.pressed = true; }, opts);
      el.addEventListener('pointerup', (event) => { if (event.pointerType !== 'touch') { row.pressed = false; rest(row); } }, opts);
      // A pen's drag the browser takes for a pan ends in a cancel, with no pointerup.
      el.addEventListener('pointercancel', (event) => { if (event.pointerType !== 'touch') { row.pressed = false; rest(row); } }, opts);
      el.addEventListener('touchstart', () => { row.pressed = true; }, opts);
      el.addEventListener('touchend', () => { row.pressed = false; rest(row); }, opts);
      el.addEventListener('touchcancel', () => { row.pressed = false; rest(row); }, opts);
      el.addEventListener('wheel', () => rest(row), opts);
      el.addEventListener('focusin', () => { row.focused = true; }, { signal });
      el.addEventListener('focusout', (event) => {
        const to = event.relatedTarget as Node | null;
        row.focused = !!to && el.contains(to);
        if (!row.focused) rest(row);
      }, { signal });
      watcher.observe(el);
    };
    const scan = () => host.querySelectorAll<HTMLElement>('[data-drift]').forEach(add);

    scan();
    const changes = new MutationObserver(scan);
    changes.observe(host, { childList: true, subtree: true });

    return () => {
      quit.abort();
      watcher.disconnect();
      changes.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const row of rows.values()) row.el.removeAttribute('data-live');
    };
  }, [root, reduced, beat]);
}
