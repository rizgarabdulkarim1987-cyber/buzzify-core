'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { PH_BTN } from '../sell-parts';

/** How long an armed button waits for its second tap before it lets go (the prototype's 4 seconds). */
export const ARM_MS = 4000;

/**
 * A destructive action as two taps (never a confirm dialog): the first tap arms it and says what the second does, the second does
 * it. Left alone it disarms after ARM_MS. No motion: the armed state is the label and the red border.
 */
export function ArmedButton({ label, armedLabel, icon, testId, disabled = false, className = '', onConfirm }: { label: ReactNode; armedLabel: ReactNode; icon?: ReactNode; testId: string; disabled?: boolean; className?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${PH_BTN} ${armed ? 'border-ph-red text-ph-red' : ''} ${className}`}
      data-testid={testId}
      aria-pressed={armed}
      disabled={disabled}
      onClick={() => {
        if (!armed) setArmed(true);
        else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {icon}
      {armed ? armedLabel : label}
    </button>
  );
}
