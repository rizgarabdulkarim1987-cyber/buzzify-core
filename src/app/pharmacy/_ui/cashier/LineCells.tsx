'use client';

import { Repeat2 } from 'lucide-react';
import { useState } from 'react';

/** Days before its end that a batch counts as near expiry (the Expiry screen's and the header chip's window). */
const NEAR_DAYS = 90;

/**
 * A batch's expiry as the prototype writes it (MM/YYYY) and whether it is past or near, read against `now`. The date is the
 * batch's `YYYY-MM-DD`; a month-precision date is the last day of its month already.
 */
export function expiryOf(date: string, now: Date = new Date()): { text: string; mark: 'expired' | 'near' | null } {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  if (!y || !m) return { text: date, mark: null };
  const end = new Date(y, m - 1, d || 28, 23, 59, 59);
  const days = (end.getTime() - now.getTime()) / 86_400_000;
  return { text: `${String(m).padStart(2, '0')}/${y}`, mark: days < 0 ? 'expired' : days <= NEAR_DAYS ? 'near' : null };
}

/**
 * A number cell of the sale lines that can be typed in (the prototype's row inputs): the value is committed on Enter or when the
 * field is left, and put back as it was when the screen refuses the change (a receipt being paid, a bad number). Clicking in it
 * never selects the row a second time. 44px high.
 */
export function CellInput({ value, label, testId, onCommit }: { value: string; label: string; testId: string; onCommit: (text: string) => boolean }) {
  const [draft, setDraft] = useState<{ base: string; text: string }>({ base: value, text: value });
  // The line changed by another way (keys, keypad): the cell shows the new value (React's "adjust state when a value changes").
  if (draft.base !== value) setDraft({ base: value, text: value });
  const commit = () => {
    if (draft.text.trim() === value) return;
    if (!onCommit(draft.text.trim())) setDraft({ base: value, text: value });
  };
  return (
    <input
      className="min-h-11 w-full min-w-0 rounded-ph-xl border border-ph-line bg-ph-card px-2 text-end font-bold tabular-nums text-ph-text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      data-testid={testId}
      value={draft.text}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraft({ base: value, text: event.target.value })}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/** The unit cell as the prototype's cycle button: shows the line's unit, a press converts it to the next priced unit. */
export function UnitCell({ label, aria, onCycle }: { label: string; aria: string; onCycle: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-11 w-full min-w-0 items-center justify-between gap-1 rounded-ph-xl border border-ph-g8 bg-ph-card px-2 text-sm font-semibold text-ph-text hover:bg-ph-canvas"
      aria-label={aria}
      title={label}
      data-testid="line-unit"
      onClick={(event) => {
        event.stopPropagation();
        onCycle();
      }}
    >
      <span className="truncate" dir="auto">
        {label}
      </span>
      <Repeat2 aria-hidden className="size-4 shrink-0" />
    </button>
  );
}
