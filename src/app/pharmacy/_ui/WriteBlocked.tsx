'use client';

import { Lock } from 'lucide-react';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { useLocale, useT } from '@/studio/i18n';

/** Whether the person may change the catalog here, and if not, why: a read-only pharmacy, a role that only looks, support. */
export type Writable = { ok: true } | { ok: false; reason: 'readOnly'; until: string } | { ok: false; reason: 'role' | 'support' };

/** Keeps a name from reordering the words around it in a right-to-left sentence (first strong isolate, pop isolate). */
export const isolate = (text: string) => `⁨${text}⁩`;

/**
 * Says why the catalog's write controls are not there: the reason in words with a lock, never the colour alone. The
 * screens render no save button at all while this shows; the fields stay readable.
 */
export function WriteBlocked({ writable, scope = 'catalog' }: { writable: Writable; scope?: 'catalog' | 'sales' }) {
  const t = useT();
  const { locale } = useLocale();
  if (writable.ok) return null;
  const text =
    writable.reason === 'readOnly'
      ? t(`pharmacy.${scope}.blocked.readOnly`, { date: phDate(writable.until, locale) })
      : t(`pharmacy.${scope}.blocked.${writable.reason}`);
  return (
    <p
      data-testid={scope === 'sales' ? 'sales-write-blocked' : 'catalog-write-blocked'}
      className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0"
    >
      <Lock aria-hidden className="text-muted" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}
