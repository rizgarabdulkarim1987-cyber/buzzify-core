'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import { useApp } from '@/ui/AppProviders';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';

/** The most the photo leans, in degrees. */
export const LIVING_TILT_MAX = 6;

/** Where the finger or pointer is inside the photo (0 to 1 each way) as a lean in degrees; the sheen follows the same point. */
export function tiltFor(x: number, y: number, max = LIVING_TILT_MAX): { rx: number; ry: number } {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { rx: Number(((0.5 - clamp(y)) * 2 * max).toFixed(2)), ry: Number(((clamp(x) - 0.5) * 2 * max).toFixed(2)) };
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

/**
 * The open dish's photo leans toward the finger and catches a moving sheen (plan feature `guest.livingPhotos`). It is
 * only ever the one photo of the open dish, never a list card, and plain pictures stay still for reduced motion and
 * data saver. One short sweep of light plays when the dish opens.
 */
export function LivingPhoto({ children }: { children: ReactNode }) {
  const { tenant } = useApp();
  const reduced = usePrefersReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const on = tenant.features.livingPhotos === true && !reduced;

  if (!on) return <>{children}</>;

  const lean = (event: PointerEvent<HTMLDivElement>) => {
    const element = box.current;
    if (!element || saveData()) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const { rx, ry } = tiltFor(x, y);
    element.style.setProperty('--lp-rx', `${rx}deg`);
    element.style.setProperty('--lp-ry', `${ry}deg`);
    element.style.setProperty('--lp-x', `${Math.round(x * 100)}%`);
    element.dataset.lean = '';
  };
  const rest = () => {
    const element = box.current;
    if (!element) return;
    element.style.removeProperty('--lp-rx');
    element.style.removeProperty('--lp-ry');
    element.style.removeProperty('--lp-x');
    delete element.dataset.lean;
  };

  return (
    <div ref={box} className="living-photo" onPointerMove={lean} onPointerLeave={rest} onPointerCancel={rest} onPointerUp={rest}>
      {children}
    </div>
  );
}
