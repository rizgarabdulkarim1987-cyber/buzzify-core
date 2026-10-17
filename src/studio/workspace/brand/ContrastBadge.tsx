'use client';

import { Check, TriangleAlert, X } from 'lucide-react';
import type { Palette } from '@/lib/brand';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

export type ContrastState = 'pass' | 'warn' | 'fail';

export interface ContrastCheck {
  foreground: keyof Palette;
  background: keyof Palette;
  /** Text must reach 4.5:1 or the kit cannot be saved; the accent should reach 3:1. */
  needs: number;
  blocking: boolean;
}

/** The pairs the palette is checked on (spec 12), text first; the same rules as `paletteProblems`. */
export const CONTRAST_CHECKS: readonly ContrastCheck[] = [
  { foreground: 'text', background: 'bg', needs: 4.5, blocking: true },
  { foreground: 'text', background: 'surface', needs: 4.5, blocking: true },
  { foreground: 'muted', background: 'bg', needs: 4.5, blocking: true },
  { foreground: 'muted', background: 'surface', needs: 4.5, blocking: true },
  { foreground: 'onAccent', background: 'accent', needs: 3, blocking: false },
  { foreground: 'accent', background: 'bg', needs: 3, blocking: false },
  { foreground: 'accent', background: 'surface', needs: 3, blocking: false },
];

export function contrastState(ratio: number, check: ContrastCheck): ContrastState {
  if (ratio >= check.needs) return 'pass';
  return check.blocking ? 'fail' : 'warn';
}

/** A pair's ratio and whether it passes, as a mark, a number and words for assistive technology. */
export function ContrastBadge({ ratio, state }: { ratio: number | null; state: ContrastState | null }) {
  const t = useT();
  if (ratio === null || state === null) return <span className="text-sm text-muted">{t('brand.contrast.unknown')}</span>;
  const Icon = state === 'pass' ? Check : state === 'warn' ? TriangleAlert : X;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-sm tabular-nums',
        state === 'pass' && 'bg-success-wash text-success',
        state === 'warn' && 'bg-accent-wash text-text',
        state === 'fail' && 'bg-danger-wash text-danger',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      <span dir="ltr">{ratio.toFixed(2)}:1</span>
      <span className="sr-only">{t(`brand.contrast.${state}`)}</span>
    </span>
  );
}
