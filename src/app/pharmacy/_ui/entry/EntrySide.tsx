'use client';

import { CheckCheck } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { ArmedButton } from '../cashier/ArmedButton';
import { formatMinor } from '../sell-logic';
import { Num } from '../sell-parts';
import type { EntryDraft } from './entry-fields';

/**
 * The "entered now" list beside the form (the prototype's aside), newest first, a new product tagged, and Finish under it:
 * two taps (never a dialog) post the whole entry as one receipt. Finish is off with nothing entered and while a call runs.
 */
export function EntrySide({ draft, busy, finishing, onFinish }: { draft: EntryDraft; busy: boolean; finishing: boolean; onFinish: () => void }) {
  const t = useT();
  const lines = draft?.lines ?? [];
  return (
    <aside aria-labelledby="entry-side-title" className="flex min-w-0 flex-col gap-3 rounded-ph-2xl border border-ph-line bg-ph-card p-3">
      <h2 id="entry-side-title" className="text-sm font-semibold text-ph-muted">
        {t('pharmacy.entry.side.title')}
      </h2>
      {lines.length === 0 ? (
        <p data-testid="entry-done-empty" className="px-2 py-3 text-center text-sm text-ph-muted">
          {t('pharmacy.entry.side.empty')}
        </p>
      ) : (
        <ol className="flex max-h-[min(60vh,32rem)] min-w-0 flex-col gap-1.5 overflow-y-auto">
          {lines.map((l) => (
            <li key={l.lineNo} data-testid="entry-done-item" className={`flex min-w-0 flex-col gap-0.5 rounded-ph-xl border px-3 py-1.5 text-sm ${l.isNew ? 'border-ph-blue' : 'border-ph-line'}`}>
              <b className="flex min-w-0 flex-wrap items-center gap-1.5 text-ph-text">
                <span dir="auto" className="min-w-0 break-words">
                  {l.productName}
                </span>
                {l.isNew && <span className="rounded-sm bg-ph-blue-wash px-1.5 text-xs font-semibold text-ph-blue">{t('pharmacy.entry.side.new')}</span>}
              </b>
              <small className="text-xs text-ph-muted">
                <Num>{l.qty}</Num> {l.unitLabel}
                {' · '}
                {t('pharmacy.entry.side.expires', { expiry: l.expiry })}
                {l.sellPriceMinor !== null && (
                  <>
                    {' · '}
                    {t('pharmacy.entry.side.sells', { price: `${formatMinor(BigInt(l.sellPriceMinor), l.currency)} ${l.currency}` })}
                  </>
                )}
              </small>
            </li>
          ))}
        </ol>
      )}
      <ArmedButton
        testId="entry-finish"
        className="w-full"
        icon={<CheckCheck aria-hidden className="size-4 shrink-0" />}
        label={finishing ? t('pharmacy.entry.finishing') : t('pharmacy.entry.finish')}
        armedLabel={t('pharmacy.entry.finishArmed', { count: lines.length })}
        disabled={lines.length === 0 || busy || finishing}
        onConfirm={onFinish}
      />
      <p className="text-xs text-ph-muted">{t('pharmacy.entry.finishHint')}</p>
    </aside>
  );
}
