'use client';

// `animate` alone, with no `motion` component: this lives in the product sheet's chunk, and the component
// would need the animation features on every route that shows a price, which the product page does not load.
import { animate } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/ui/AppProviders';
import { EASE_OUT, ROLL_SECONDS } from '@/ui/motion';
import { usePrefersReducedMotion } from '@/ui/use-prefers-reduced-motion';

/**
 * A price that rolls to its new value. The rolling digits are decoration and hidden from assistive
 * technology, which gets the final amount at once. With reduced motion the value simply changes.
 */
export function RollingMoney({ value, className }: { value: number; className?: string }) {
  const { money } = useApp();
  const reduced = usePrefersReducedMotion();
  const digits = useRef<HTMLSpanElement>(null);
  // What is on screen right now, so a change that arrives mid-roll continues from there.
  const shown = useRef(value);
  // React renders the first amount and then leaves this text alone; the effect below owns it from then on.
  const [initial] = useState(() => money(value));

  useEffect(() => {
    const element = digits.current;
    if (!element) return;
    if (reduced) {
      shown.current = value;
      element.textContent = money(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration: ROLL_SECONDS,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        shown.current = latest;
        element.textContent = money(Math.round(latest));
      },
      onComplete: () => {
        shown.current = value;
        element.textContent = money(value);
      },
    });
    return () => controls.stop();
  }, [value, reduced, money]);

  return (
    <>
      <span ref={digits} aria-hidden="true" className={className}>
        {initial}
      </span>
      <span className="sr-only">{money(value)}</span>
    </>
  );
}
