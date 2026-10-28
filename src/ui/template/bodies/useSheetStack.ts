'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { coverProgress, litSheet, stickyTop } from './stacked-sheets';

/** How far below the strip a sheet's top may sit and still count as the one being read (px). */
const READ_LINE = 80;

/**
 * The scripting of the Stacked Sheets shape. Every sheet (`[data-sheet]` inside `root`, one per section, in page order)
 * is `position: sticky`; what CSS cannot know is set here, once a frame at most and only on what changed:
 *
 * - `--sk-top` on each sheet: where it sticks (`stickyTop`: under the strip, or higher for a sheet taller than the
 *   screen, so its end can be reached), from the sheets' heights and the screen's, re-measured when they change.
 * - `--p` (0 to 1) on each sheet: how far the sheet after it has slid over it; the CSS shrinks and darkens it by that
 *   (a transform and an opacity only). Not set (kept 0) when the guest prefers less motion.
 * - the sheet being read (`onLit`, called when it changes), from where the sheets' tops are: the sticky sheets above it
 *   stay put at the top, so the template's own section tracking (an observer) cannot tell it.
 *
 * It returns `jump(categoryId)`: scrolls the page so that sheet lies at its place under the strip, whatever sheets are
 * stuck above it (a stuck sheet's box is at the top, so a plain scroll-into-view could not take the page back up to it),
 * then moves focus to its heading. No React state is written per frame, and a search (new sheets) is picked up by a
 * MutationObserver.
 */
export function useSheetStack(root: RefObject<HTMLElement | null>, reduced: boolean, onLit: (categoryId: string) => void): (categoryId: string) => void {
  const lit = useRef(onLit);
  useEffect(() => {
    lit.current = onLit;
  }, [onLit]);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const sheets = () => [...host.querySelectorAll<HTMLElement>('[data-sheet]')];
    const strip = () => host.querySelector<HTMLElement>('[data-chips]');
    const done = new WeakMap<HTMLElement, number>();
    let queued = 0;
    let current = '';

    const place = () => {
      const all = sheets();
      const room = strip()?.offsetHeight ?? 0;
      const heights = all.map((sheet) => sheet.offsetHeight);
      all.forEach((sheet, at) => sheet.style.setProperty('--sk-top', `${stickyTop(room, window.innerHeight, heights[at]!)}px`));
    };
    const paint = () => {
      queued = 0;
      const all = sheets();
      if (all.length === 0) return;
      const room = strip()?.offsetHeight ?? 0;
      // Everything is read first, then written: no layout is forced between the writes.
      const boxes = all.map((sheet) => sheet.getBoundingClientRect());
      const heights = all.map((sheet) => sheet.offsetHeight);
      const covers = all.map((_, at) => (reduced || at === all.length - 1 ? 0 : coverProgress(boxes[at]!.top + heights[at]!, boxes[at + 1]!.top, heights[at]!)));
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const at = litSheet(
        boxes.map((box) => box.top),
        room + READ_LINE,
        atEnd,
      );
      all.forEach((sheet, index) => {
        const value = Math.round(covers[index]! * 200) / 200;
        if (done.get(sheet) === value) return;
        done.set(sheet, value);
        sheet.style.setProperty('--p', String(value));
      });
      const id = all[at]!.dataset.sheet ?? '';
      if (id && id !== current) {
        current = id;
        lit.current(id);
      }
    };
    const queue = () => {
      if (!queued) queued = requestAnimationFrame(paint);
    };
    const refresh = () => {
      place();
      queue();
    };
    refresh();
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', refresh);
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
    const watch = () => {
      sizes?.disconnect();
      sheets().forEach((sheet) => sizes?.observe(sheet));
      const bar = strip();
      if (bar) sizes?.observe(bar);
    };
    watch();
    const changes = new MutationObserver(() => {
      watch();
      refresh();
    });
    changes.observe(host, { childList: true, subtree: true });
    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', refresh);
      sizes?.disconnect();
      changes.disconnect();
    };
  }, [root, reduced]);

  return (categoryId: string) => {
    const host = root.current;
    if (!host) return;
    const all = [...host.querySelectorAll<HTMLElement>('[data-sheet]')];
    const at = all.findIndex((sheet) => sheet.dataset.sheet === categoryId);
    if (at < 0) return;
    const room = host.querySelector<HTMLElement>('[data-chips]')?.offsetHeight ?? 0;
    // Where the sheet lies in the page's flow, with the sheets stuck above it laid back where they were: the top of the sheets' column plus the heights before it.
    const column = (host.querySelector('main') ?? all[0]!).getBoundingClientRect().top + window.scrollY;
    const flowTop = column + all.slice(0, at).reduce((sum, sheet) => sum + sheet.offsetHeight, 0);
    window.scrollTo({ top: Math.max(0, flowTop - room), behavior: reduced ? 'auto' : 'smooth' });
    all[at]!.querySelector<HTMLElement>('[data-heading]')?.focus({ preventScroll: true });
  };
}
