'use client';

import dynamic from 'next/dynamic';
import type { PlacedMotion } from '@/server/data/menu-view';

// Loaded on demand, and only by a menu that places a motion: the library's catalog and the `Motion` component stay out
// of the menu route's first JavaScript, and each motion's own code arrives only when it is about to be seen.
const MotionSlotBody = dynamic(() => import('./MotionSlotBody'), { ssr: false });

export type MotionSlotPlace = 'hero' | 'signature' | 'category';

/** Each place's box, reserved before anything loads so the page never shifts. The signature's is its stage's own. */
const BOX: Record<MotionSlotPlace, string> = {
  hero: 'relative aspect-[2/1] max-h-[280px] w-full',
  category: 'relative aspect-[3/1] max-h-40 w-full',
  signature: 'absolute inset-0 -z-10',
};

/** The band fades into the page at both edges, so no text ever sits on its moving part. The stage masks its own. */
const FADE: Record<MotionSlotPlace, string> = {
  hero: '[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]',
  category: '[mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_62%,transparent)]',
  signature: '',
};

/**
 * A motion from the library at one of the menu's places (spec: 2026-10-18-menu-motions-design.md, section 9). It is
 * decoration: hidden from assistive technology, never focusable, and it never takes a tap or a scroll.
 */
export function MotionSlot({ place, motion, className = '' }: { place: MotionSlotPlace; motion: PlacedMotion; className?: string }) {
  return (
    <div
      aria-hidden
      inert
      data-motion-slot={place}
      className={`pointer-events-none overflow-hidden ${BOX[place]} ${FADE[place]} ${className}`}
    >
      <MotionSlotBody motion={motion} />
    </div>
  );
}
