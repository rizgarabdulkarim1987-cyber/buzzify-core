'use client';

import { CircleAlert, Hourglass, PackageOpen, Play, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useLocale, useT } from '@/studio/i18n';
import { phDateTime } from '../ph-date';
import { formatMinor } from '../sell-logic';
import { Note, Num, PH_BTN } from '../sell-parts';
import { ArmedButton } from './ArmedButton';
import type { HoldFlow } from './use-hold-flow';

/**
 * The held receipts of the branch, inline in the work panel (the old held-carts dialog's list): the total, the lines, who held it and
 * when. Continue opens one in a receipt tab; Discard is a two-tap button. The list is read again each time it opens.
 */
export function HeldList({ holds }: { holds: HoldFlow }) {
  const t = useT();
  const { locale } = useLocale();
  const { items, hasMore, problem, busyId } = holds.held;
  const { load } = holds;
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read each time the list opens
  }, []);
  return (
    <div className="flex flex-col gap-2" data-testid="held-list">
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="held-problem">
          {problem}
        </Note>
      )}
      {items === null && (
        <Note look="ph" icon={<Hourglass aria-hidden />} role="status">
          {t('pharmacy.sell.loading')}
        </Note>
      )}
      {hasMore && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="info" role="status">
          {t('pharmacy.sell.holds.more')}
        </Note>
      )}
      {items?.length === 0 && !problem && (
        <p className="flex items-center gap-2.5 py-3 text-sm text-ph-muted" data-testid="held-empty">
          <PackageOpen aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.cashier.held.empty')}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {items?.map((hold) => (
          <li key={hold.id} data-testid="held-row" className="flex flex-col gap-1.5 rounded-ph-xl border border-ph-line p-2.5">
            <p className="flex min-w-0 flex-col text-sm text-ph-text">
              <span className="font-semibold">
                <Num>{formatMinor(BigInt(hold.totalPreviewMinor), hold.currency)}</Num> {hold.currency}
              </span>
              <span className="text-ph-muted">
                {t('pharmacy.sell.holds.lines', { count: hold.lineCount })} · {hold.mine ? t('pharmacy.sell.holds.mine') : t('pharmacy.sell.holds.other')} · <Num>{phDateTime(hold.createdAt, locale)}</Num>
              </span>
            </p>
            <span className="grid grid-cols-2 gap-1.5">
              <button type="button" data-testid="held-resume" className={PH_BTN} disabled={busyId !== null} onClick={() => void holds.resume(hold.id)}>
                <Play aria-hidden className="size-4" />
                {t('pharmacy.sell.holds.resume')}
              </button>
              <ArmedButton
                testId="held-discard"
                disabled={busyId !== null}
                icon={<Trash2 aria-hidden className="size-4" />}
                label={t('pharmacy.sell.holds.discard')}
                armedLabel={t('pharmacy.cashier.held.discardArmed')}
                onConfirm={() => void holds.discard(hold.id)}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
