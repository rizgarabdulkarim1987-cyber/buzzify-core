'use client';

import { useEffect, type RefObject } from 'react';
import { holoTilt } from './club-deck';

const VARS = ['--rx', '--ry', '--mx', '--my', '--fx', '--fy'] as const;

function settle(card: HTMLElement | null) {
  if (!card) return;
  for (const name of VARS) card.style.removeProperty(name);
  card.removeAttribute('data-tilt');
}

/**
 * Holo Cards' lean: the card under a pointer (`[data-holo]` inside `root`) leans towards it, its glare follows it and its
 * foil shifts (`--rx`, `--ry`, `--mx`, `--my`, `--fx`, `--fy`, and `data-tilt` while it does). One frame at most per
 * animation frame. The card settles back when the pointer leaves it, and when a finger lifts or the browser takes the
 * touch for a scroll (`pointercancel`), so a card never stays leaning under a finger. Off when `active` is false (less
 * motion).
 */
export function useHoloTilt(root: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const host = root.current;
    if (!host || !active) return;
    let card: HTMLElement | null = null;
    let point: { x: number; y: number } | null = null;
    let frame = 0;

    const draw = () => {
      frame = 0;
      if (!card || !point || !card.isConnected) return;
      const box = card.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const tilt = holoTilt((point.x - box.left) / box.width, (point.y - box.top) / box.height);
      card.style.setProperty('--rx', String(tilt.rx));
      card.style.setProperty('--ry', String(tilt.ry));
      card.style.setProperty('--mx', `${tilt.mx}%`);
      card.style.setProperty('--my', `${tilt.my}%`);
      card.style.setProperty('--fx', String(tilt.fx));
      card.style.setProperty('--fy', String(tilt.fy));
      card.setAttribute('data-tilt', '');
    };
    const move = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-holo]') : null;
      const next = target && host.contains(target) ? target : null;
      if (next !== card) {
        settle(card);
        card = next;
      }
      point = { x: event.clientX, y: event.clientY };
      if (card && !frame) frame = requestAnimationFrame(draw);
    };
    const leave = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      settle(card);
      card = null;
      point = null;
    };
    const lift = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') leave();
    };

    host.addEventListener('pointermove', move, { passive: true });
    host.addEventListener('pointerleave', leave, { passive: true });
    window.addEventListener('pointerup', lift, { passive: true });
    window.addEventListener('pointercancel', leave, { passive: true });
    return () => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointerup', lift);
      window.removeEventListener('pointercancel', leave);
      leave();
    };
  }, [root, active]);
}
