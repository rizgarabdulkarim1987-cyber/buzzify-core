'use client';

import { useEffect, type RefObject } from 'react';

/*
 * The pieces the hanging families share (`swing`: dishes hung in a grid; `rope`: dishes hung along a sideways line):
 * the pure maths of each hung dish (its string, its tilt, its swing, the dip of a chain) and the hook that lets the
 * endless sway run only where it is seen and no finger holds it.
 */

/** A number from 0 to 1 that a key (a product id) and a salt always give the same (FNV-1a), so a dish keeps its swing. */
export function hash01(key: string, salt = 0): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let at = 0; at < key.length; at++) {
    hash ^= key.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** One dish's endless sway: its period (s), its start inside the period (s, negative so it starts mid-swing), its swing (deg). */
export interface Sway {
  period: number;
  delay: number;
  angle: number;
}

/** The sway of the dish with this key: a period of 3.4 to 5 s, a start anywhere in it, and a swing of 1.5 to 3.5 deg. */
export function swayOf(key: string): Sway {
  const period = 3.4 + hash01(key, 1) * 1.6;
  return {
    period: round(period),
    delay: round(-hash01(key, 2) * period),
    angle: round(1.5 + hash01(key, 3) * 2),
  };
}

/** The lengths (rem) of the strings in a row, repeating: short, long, middle, so neighbouring dishes hang at different heights. */
export const STRING_LENGTHS = [0.75, 2.75, 1.625] as const;

/** The length (rem) of the string the dish at `at` (its place in its section) hangs from. */
export function stringLength(at: number): number {
  return STRING_LENGTHS[((at % STRING_LENGTHS.length) + STRING_LENGTHS.length) % STRING_LENGTHS.length]!;
}

/** The pegboard's tilts (deg), repeating: no two neighbouring cards hang the same way. */
export const PEG_TILTS = [-3, 2, -1.5, 3, -2, 1] as const;

/** The tilt (deg) of the card at `at` on the pegboard. */
export function pegTilt(at: number): number {
  return PEG_TILTS[((at % PEG_TILTS.length) + PEG_TILTS.length) % PEG_TILTS.length]!;
}

/**
 * How far (0 to 1) the coin in column `column` of a chain of `count` coins hangs below the ends: a chain droops in an
 * arc, so the middle coin is the lowest (1) and the two end coins hang highest (0). One coin, or two, hang level (0).
 */
export function chainDrop(column: number, count: number): number {
  if (count < 3 || column < 0 || column >= count) return 0;
  const end = Math.sin((Math.PI * 0.5) / count);
  const here = Math.sin((Math.PI * (column + 0.5)) / count);
  return round((here - end) / (1 - end));
}

/** The items cut into rows of `size` (the last one shorter): one gold chain per row. */
export function rowsOf<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let at = 0; at < items.length; at += step) rows.push(items.slice(at, at + step));
  return rows;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lets the endless sway of a hanging shape run only where it is seen: every `[data-sway]` group (a section) gets
 * `data-live` while it is within half a screen of the viewport, and `data-held` while a finger or the pointer is
 * pressed on it (the CSS pauses the sway outside `[data-live]` and under `[data-held]`). `data-armed` is set on `root` in
 * the first report, so before the hook runs (or with no script) nothing is paused. Groups added later (a search cleared)
 * are picked up by a MutationObserver. With less motion it does nothing: the CSS draws the dishes still.
 */
export function useSwayLive(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || reduced || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) (entry.target as HTMLElement).toggleAttribute('data-live', entry.isIntersecting);
        host.setAttribute('data-armed', '');
      },
      { rootMargin: '50% 0px' },
    );
    const watching = new WeakSet<Element>();
    const watch = () =>
      host.querySelectorAll<HTMLElement>('[data-sway]').forEach((group) => {
        if (watching.has(group)) return;
        watching.add(group);
        watcher.observe(group);
      });
    const forget = (records: MutationRecord[]) => {
      for (const record of records)
        record.removedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          const gone = node.matches('[data-sway]') ? [node] : [...node.querySelectorAll('[data-sway]')];
          for (const group of gone) {
            if (group.isConnected) continue;
            watcher.unobserve(group);
            watching.delete(group);
          }
        });
    };
    let held: Element | null = null;
    const release = () => {
      held?.removeAttribute('data-held');
      held = null;
    };
    const press = (event: PointerEvent) => {
      release();
      held = (event.target as Element | null)?.closest('[data-sway]') ?? null;
      held?.setAttribute('data-held', '');
    };
    watch();
    const mutations = new MutationObserver((records) => {
      forget(records);
      watch();
    });
    mutations.observe(host, { childList: true, subtree: true });
    // A touch that turns into a scroll is cancelled as a pointer at once, but the finger is still on the glass: a touch
    // holds until it lifts (touchend), a mouse or pen until its button is let go.
    const cancel = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') release();
    };
    host.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', cancel, { passive: true });
    window.addEventListener('touchend', release, { passive: true });
    window.addEventListener('touchcancel', release, { passive: true });
    return () => {
      mutations.disconnect();
      watcher.disconnect();
      host.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchend', release);
      window.removeEventListener('touchcancel', release);
      release();
      host.removeAttribute('data-armed');
      host.querySelectorAll('[data-live]').forEach((group) => group.removeAttribute('data-live'));
    };
  }, [root, reduced]);
}
