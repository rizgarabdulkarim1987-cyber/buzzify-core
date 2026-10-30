'use client';

import { useEffect, type RefObject } from 'react';

/*
 * The motion of the `float` family (and the lamps of the `dense` family): pure maths for a dish's depth, tilt and clock,
 * the scroll parallax, and the "endless motion only while seen and untouched" switch.
 */

/** How far a dish floats from the screen: 0 far (smaller, dimmer), 1 middle, 2 near (larger, brighter). */
export type FloatDepth = 0 | 1 | 2;

/** The largest parallax shift of a dish, in px either way. */
export const FLOAT_LIMIT = 8;
/** The largest tilt of a dish, in degrees either way. */
export const FLOAT_TILT = 2.5;
/** How far the sway lifts a dish, in px (upward only). */
export const FLOAT_RISE = 4;
/** How much each depth moves against the scroll: far lags, near runs ahead (from the mockup's parallax). */
export const FLOAT_PULL: Readonly<Record<FloatDepth, number>> = { 0: 0.08, 1: 0, 2: -0.1 };

/**
 * A steady number in [0, 1) from a key (FNV-1a), so a dish keeps its depth, tilt and clock whatever a search hides or
 * reorders. `salt` gives independent numbers from one key.
 */
export function floatSeed(key: string, salt = 0): number {
  let hash = (2166136261 ^ Math.imul(salt + 1, 2654435761)) >>> 0;
  for (let at = 0; at < key.length; at++) {
    hash ^= key.charCodeAt(at);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 10007) / 10007;
}

export function floatDepth(key: string): FloatDepth {
  return Math.min(2, Math.floor(floatSeed(key, 3) * 3)) as FloatDepth;
}

/** The dish's resting tilt in degrees, within ±`FLOAT_TILT`, to one decimal. */
export function floatTilt(key: string): number {
  return Math.round((floatSeed(key, 1) - 0.5) * 2 * FLOAT_TILT * 10) / 10;
}

/** The sway's own clock: a period of 5 to 8 seconds and a negative delay, so no two dishes move together. */
export function floatClock(key: string): { period: number; delay: number } {
  return { period: Math.round((5 + floatSeed(key, 5) * 3) * 100) / 100, delay: -Math.round(floatSeed(key, 7) * 600) / 100 };
}

/** The parallax shift of a dish whose centre is `distance` px below the screen's centre, capped at `limit`. */
export function floatShift(distance: number, depth: FloatDepth, limit = FLOAT_LIMIT): number {
  const shift = Math.max(-limit, Math.min(limit, distance * FLOAT_PULL[depth]));
  return Math.round(shift * 10) / 10 || 0;
}

/**
 * How far a card of `width` × `height` px can reach outside its own box at worst, up and down: the parallax, the sway's
 * lift, and the corners of the tilted card. Two neighbours in a column stay apart while `up + down` of the two is under
 * the row gap, so no dish's name, price or add button ever covers another's.
 */
export function floatReach(width: number, height: number): { up: number; down: number } {
  const angle = (FLOAT_TILT * Math.PI) / 180;
  const corners = (width * Math.sin(angle) + height * (1 - Math.cos(angle))) / 2;
  return { up: FLOAT_LIMIT + FLOAT_RISE + corners, down: FLOAT_LIMIT + corners };
}

/**
 * The scroll parallax: every `[data-fl]` item inside `root` (with `data-z` its depth) gets `--fl-y`, its shift, set from
 * its own box (the item itself never moves; its inside does), once per animation frame while the page scrolls. Only the
 * items on screen are measured (an IntersectionObserver keeps the set), so it costs nothing off screen. Nothing with
 * less motion. A MutationObserver watches the items a search brings back.
 */
export function useFloatParallax(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced || typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<HTMLElement>();
    let queued = 0;
    const paint = () => {
      queued = 0;
      const middle = window.innerHeight / 2;
      const shifts: [HTMLElement, number][] = [];
      for (const item of seen) {
        if (!item.isConnected) {
          seen.delete(item);
          continue;
        }
        const box = item.getBoundingClientRect();
        const depth = Number(item.dataset.z ?? 1) as FloatDepth;
        shifts.push([item, floatShift(box.top + box.height / 2 - middle, depth)]);
      }
      // All read, then all written: no layout forced between the writes.
      for (const [item, shift] of shifts) item.style.setProperty('--fl-y', `${shift}px`);
    };
    const queue = () => {
      if (!queued) queued = requestAnimationFrame(paint);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target as HTMLElement);
          else seen.delete(entry.target as HTMLElement);
        }
        queue();
      },
      { rootMargin: '10% 0px' },
    );
    const watch = () => host.querySelectorAll<HTMLElement>('[data-fl]').forEach((item) => watcher.observe(item));
    watch();
    // Items a search removes are let go, so the observer holds only what is on the page.
    const changes = new MutationObserver(() => {
      for (const item of seen) if (!item.isConnected) { seen.delete(item); watcher.unobserve(item); }
      watch();
    });
    changes.observe(host, { childList: true, subtree: true });
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue, { passive: true });
    return () => {
      if (queued) cancelAnimationFrame(queued);
      watcher.disconnect();
      changes.disconnect();
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      host.querySelectorAll<HTMLElement>('[data-fl]').forEach((item) => item.style.removeProperty('--fl-y'));
    };
  }, [root, reduced]);
}

/**
 * Endless motion (a sway, a blinking lamp, a radar) runs only where the CSS sees `data-live`: this sets it on every
 * `selector` element inside `root` while it is on screen and no finger or pointer is pressed on it. With less motion it
 * sets nothing, so everything stays still. A page whose observer never reports simply stays still too.
 */
export function useLiveInView(root: RefObject<HTMLElement | null>, selector: string, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced || typeof IntersectionObserver === 'undefined') return;
    const shown = new Set<Element>();
    let held: Element | null = null;
    const mark = (node: Element) => {
      if (shown.has(node) && node !== held) node.setAttribute('data-live', '');
      else node.removeAttribute('data-live');
    };
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) shown.add(entry.target);
        else shown.delete(entry.target);
        mark(entry.target);
      }
    });
    const watch = () => host.querySelectorAll(selector).forEach((node) => watcher.observe(node));
    watch();
    const changes = new MutationObserver(() => {
      for (const node of shown) if (!node.isConnected) { shown.delete(node); watcher.unobserve(node); }
      watch();
    });
    changes.observe(host, { childList: true, subtree: true });
    const press = (event: PointerEvent) => {
      const node = (event.target as Element | null)?.closest(selector) ?? null;
      if (!node || !host.contains(node)) return;
      held = node;
      mark(node);
    };
    const release = () => {
      const node = held;
      held = null;
      if (node) mark(node);
    };
    host.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    return () => {
      watcher.disconnect();
      changes.disconnect();
      host.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      host.querySelectorAll(selector).forEach((node) => node.removeAttribute('data-live'));
    };
  }, [root, selector, reduced]);
}
