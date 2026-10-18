'use client';

import dynamic from 'next/dynamic';
import type { PlacedMotion } from '@/server/data/menu-view';

// Loaded on demand, and only by a menu that places a motion: the library's catalog and the `Motion` component stay out
// of the menu route's first JavaScript, and each motion's own code arrives only when it is about to be seen.
const MotionSlotBody = dynamic(() => import('./MotionSlotBody'), { ssr: false });

/**
 * Where a slot sits. `backdrop` is a template menu's top of the menu: behind its header and hero, adding no height
 * (spec: 2026-10-18-template-motions-design.md, section 2).
 */
export type MotionSlotPlace = 'hero' | 'signature' | 'category' | 'backdrop';

/** Each place's box, reserved before anything loads so the page never shifts. The signature's is its stage's own. */
const BOX: Record<MotionSlotPlace, string> = {
  hero: 'relative aspect-[2/1] max-h-[280px] w-full',
  category: 'relative aspect-[3/1] max-h-40 w-full',
  signature: 'absolute inset-0 -z-10',
  backdrop: 'absolute inset-x-0 top-0 -z-10 h-[min(75svh,640px)]',
};

/** The band fades into the page at its edges, so no text ever sits on its moving part. The stage masks its own. */
const FADE: Record<MotionSlotPlace, string> = {
  hero: '[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]',
  category: '[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]',
  signature: '',
  backdrop: '[mask-image:linear-gradient(to_bottom,#000,#000_55%,transparent)]',
};

/**
 * A motion from the library at one of the menu's places (spec: 2026-10-18-menu-motions-design.md, section 9). It is
 * decoration: hidden from assistive technology, never focusable, and it never takes a tap or a scroll. `veil` lays the
 * page colour (`--bg`) over it at that opacity, so text in front of a backdrop stays readable; `paused` holds a still
 * frame (a template menu's pause button).
 */
export function MotionSlot({
  place,
  motion,
  className = '',
  veil = 0,
  paused = false,
}: {
  place: MotionSlotPlace;
  motion: PlacedMotion;
  className?: string;
  veil?: number;
  paused?: boolean;
}) {
  return (
    <div
      aria-hidden
      inert
      data-motion-slot={place}
      className={`pointer-events-none overflow-hidden ${BOX[place]} ${FADE[place]} ${className}`}
    >
      <MotionSlotBody motion={paused ? { ...motion, playing: false } : motion} />
      {veil > 0 && <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', opacity: veil }} />}
    </div>
  );
}
