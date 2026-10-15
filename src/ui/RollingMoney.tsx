'use client';

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { useApp } from '@/ui/AppProviders';
import { EASE_OUT, ROLL_SECONDS } from '@/ui/motion';

/**
 * A price that rolls to its new value. The rolling digits are decoration and hidden from assistive
 * technology, which gets the final amount at once. With reduced motion the value simply changes.
 */
export function RollingMoney({ value, className }: { value: number; className?: string }) {
  const { money } = useApp();
  const reduced = useReducedMotion();
  const shown = useMotionValue(value);
  const text = useTransform(shown, (amount) => money(Math.round(amount)));

  useEffect(() => {
    if (reduced) {
      shown.set(value);
      return;
    }
    const controls = animate(shown, value, { duration: ROLL_SECONDS, ease: EASE_OUT });
    return () => controls.stop();
  }, [value, reduced, shown]);

  return (
    <>
      <motion.span aria-hidden="true" className={className}>
        {text}
      </motion.span>
      <span className="sr-only">{money(value)}</span>
    </>
  );
}
