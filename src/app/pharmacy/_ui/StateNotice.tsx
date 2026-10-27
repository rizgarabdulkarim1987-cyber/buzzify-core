import { BookOpen, Lock } from 'lucide-react';
import type { Translate } from '@/lib/i18n';
import { formatStamp, ltr } from '@/lib/pos-format';
import type { PhGate } from '@/server/pharmacy/actor';

type Closed = Extract<PhGate, { state: 'closed' }>['reason'];

/**
 * Why the pharmacy cannot work normally: read-only (a lapsed subscription inside its retention window, until a date) or
 * closed (with the reason). The icon and the words carry the state, never the colour alone. No motion.
 */
export function StateNotice({ t, ...state }: ({ kind: 'readOnly'; until: Date } | { kind: 'closed'; reason: Closed }) & { t: Translate }) {
  if (state.kind === 'readOnly') {
    return (
      <div role="status" data-testid="read-only-notice" className="flex items-start gap-3 border-b border-line bg-info-wash px-4 py-3 text-sm text-text sm:px-8">
        <BookOpen aria-hidden size={18} className="mt-0.5 shrink-0 text-info" />
        <p className="min-w-0">
          <strong className="font-semibold">{t('pharmacy.state.readOnly.title')}</strong>
          {'. '}
          <span dir="auto">{t('pharmacy.state.readOnly.body', { date: ltr(formatStamp(state.until)) })}</span>
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="ph-closed-title" className="flex flex-col gap-3 px-4 py-8 sm:px-8">
      <h1 id="ph-closed-title" className="flex items-center gap-2 text-xl font-semibold text-text">
        <Lock aria-hidden size={20} className="shrink-0 text-danger" />
        {t('pharmacy.state.closed.title')}
      </h1>
      <p className="max-w-[72ch] text-base text-muted">{t(`pharmacy.state.closed.${state.reason}`)}</p>
    </section>
  );
}
