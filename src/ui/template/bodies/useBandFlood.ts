'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * The flood of the Section Ink shape: a band's colour spreads out (a circle growing from its top corner, or from the
 * section chip that was tapped) when the band first scrolls into view. The hook sets `data-armed` on `root` (the CSS hides
 * a not-yet-flooded band only then, so a page with no script shows every band) and `data-in` on each `[data-band]` the
 * first time it is seen. Flooded bands are remembered by their `data-id` (the category), not by node: a band that scrolls
 * out and in, survives a search, or is mounted anew when a search is cleared does not flood again. Bands already on the
 * screen when the hook starts are shown at once (read first, then written), so the server-drawn first screen never
 * jumps. Bands that appear later are added to the watch with a MutationObserver. The effect depends on `reduced` alone,
 * so a new `categories` identity never restarts it; with less motion it does nothing and every band is simply shown.
 *
 * The function it returns is for a tap on a section chip: if that band is off the screen it is reset to unflooded and
 * made to flood from the chip's place on the way in (from the chip's x on the band's top edge), so a tap always shows the
 * flood. A band in view is left as it is.
 */
export function useBandFlood(root: RefObject<HTMLElement | null>, reduced: boolean): (categoryId: string, chip: HTMLElement) => void {
  const shown = useRef(new Set<string>());
  const control = useRef<{ watch(band: HTMLElement): void } | null>(null);

  useEffect(() => {
    const host = root.current;
    if (!host || reduced) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = shown.current;
    const show = (band: HTMLElement) => {
      band.setAttribute('data-in', '');
      if (band.dataset.id) seen.add(band.dataset.id);
    };
    // A band's top edge passing a little above the bottom of the screen is it scrolling into view.
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target as HTMLElement);
          watcher.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0 },
    );
    const watch = () =>
      host.querySelectorAll<HTMLElement>('[data-band]:not([data-in])').forEach((band) => {
        if (band.dataset.id && seen.has(band.dataset.id)) band.setAttribute('data-in', '');
        else watcher.observe(band);
      });
    const bands = [...host.querySelectorAll<HTMLElement>('[data-band]:not([data-in])')];
    const onScreen = bands.filter((band) => {
      const box = band.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    });
    onScreen.forEach(show);
    host.setAttribute('data-armed', '');
    watch();
    const changes = new MutationObserver(watch);
    changes.observe(host, { childList: true, subtree: true });
    control.current = { watch: (band) => watcher.observe(band) };
    return () => {
      control.current = null;
      watcher.disconnect();
      changes.disconnect();
      host.removeAttribute('data-armed');
    };
  }, [root, reduced]);

  return (categoryId: string, chip: HTMLElement) => {
    const host = root.current;
    const api = control.current;
    if (!host || !api) return;
    const band = [...host.querySelectorAll<HTMLElement>('[data-band]')].find((candidate) => candidate.dataset.id === categoryId);
    if (!band) return;
    const box = band.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight * 0.9) return;
    const at = chip.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((at.left + at.width / 2 - box.left) / (box.width || 1)) * 100));
    band.style.setProperty('--fx', `${x.toFixed(1)}%`);
    // Back to unflooded (instant: the band is off the screen), then watched again: it floods on the way in.
    band.removeAttribute('data-in');
    api.watch(band);
  };
}
