'use client';

import { useEffect, type RefObject } from 'react';

/**
 * The spine family's watch: sets `mark` on every `selector` inside `root` while it crosses the band `rootMargin` names,
 * and takes it off when it leaves. With `rootMargin` 0 it marks what is on the screen (endless motion runs only there);
 * with a thin band round the middle it marks what sits at mid-screen (the dengbêj singing). Nodes added later (a search
 * cleared) are watched through a MutationObserver. Nothing runs when `active` is false (less motion, or a motif with no
 * such motion), so the CSS shows the still structure.
 */
export function useSpineWatch(root: RefObject<HTMLElement | null>, active: boolean, selector: string, mark: string, rootMargin = '0px') {
  useEffect(() => {
    const host = root.current;
    if (!host || !active || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) entry.target.toggleAttribute(mark, entry.isIntersecting);
      },
      { threshold: 0, rootMargin },
    );
    const watched = new Set<Element>();
    const watch = () =>
      host.querySelectorAll(selector).forEach((node) => {
        if (watched.has(node)) return;
        watched.add(node);
        watcher.observe(node);
      });
    watch();
    const changes = new MutationObserver(() => {
      for (const node of watched) if (!node.isConnected) { watched.delete(node); watcher.unobserve(node); }
      watch();
    });
    changes.observe(host, { childList: true, subtree: true });
    return () => {
      watcher.disconnect();
      changes.disconnect();
      host.querySelectorAll(`[${mark}]`).forEach((node) => node.removeAttribute(mark));
    };
  }, [root, active, selector, mark, rootMargin]);
}

/**
 * While a finger (or a mouse button) is down on the menu, `data-hold` sits on `root`, and the family's CSS pauses its
 * endless motion (swaying torches, rising sparks, turning rosettes), so a dish never moves under the finger.
 */
export function useSpineHold(root: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || !active) return;
    const down = () => host.setAttribute('data-hold', '');
    const up = () => host.removeAttribute('data-hold');
    host.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    return () => {
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      up();
    };
  }, [root, active]);
}
