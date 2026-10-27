'use client';

import { CircleCheck, PencilLine } from 'lucide-react';
import { useT } from '@/studio/i18n';

/**
 * Whether the screen holds changes not saved yet, read out politely when it changes. A word and an icon, never only a
 * colour; nothing moves. After a save it says "Saved" until the next edit.
 */
export function UnsavedBadge({ dirty, saved }: { dirty: boolean; saved: boolean }) {
  const t = useT();
  return (
    <span role="status" className="inline-flex min-h-6 items-center">
      {dirty ? (
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text">
          <PencilLine aria-hidden className="size-3.5 shrink-0" />
          {t('pharmacy.catalog.unsaved')}
        </span>
      ) : saved ? (
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-success-wash px-1.5 py-0.5 text-xs font-medium text-success">
          <CircleCheck aria-hidden className="size-3.5 shrink-0" />
          {t('pharmacy.catalog.saved')}
        </span>
      ) : null}
    </span>
  );
}
