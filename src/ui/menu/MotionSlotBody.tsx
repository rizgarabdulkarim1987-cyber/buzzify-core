'use client';

import { useEffect, useRef, useState } from 'react';
import { direction } from '@/lib/locale';
import { Motion } from '@/motion/Motion';
import type { PlacedMotion } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';

/** How long the page may stay busy before a motion near the screen mounts anyway. */
const IDLE_TIMEOUT_MS = 1200;

/**
 * Mounts a placed motion once its box is within a screen of the viewport and the page has a quiet moment, so motion
 * code never competes with the menu's first paint; once mounted it stays (the motion pauses itself off screen). Reduced
 * motion and a menu whose motion is off show its still frame.
 */
export default function MotionSlotBody({ motion }: { motion: PlacedMotion }) {
  const { locale } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mount = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => setMounted(true), { timeout: IDLE_TIMEOUT_MS });
      else timer = setTimeout(() => setMounted(true), 200);
    };
    if (typeof IntersectionObserver === 'undefined') {
      mount();
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        mount();
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (idle !== undefined) window.cancelIdleCallback(idle);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={box} style={{ position: 'absolute', inset: 0 }}>
      {mounted && <Motion id={motion.motionId} params={motion.params} playing={motion.playing} dir={direction(locale)} />}
    </div>
  );
}
