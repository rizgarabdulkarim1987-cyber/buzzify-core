'use client';

import { CircleAlert, CircleCheck, Hourglass, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/studio/i18n';
import { Note, PH_BTN, PH_PRIMARY } from '../sell-parts';

/** What every payment flow shows besides its own fields: why Pay is held back, the connection, a sale in flight, a refusal, "no print". */
export interface FlowCommon {
  busy: boolean;
  offline: boolean;
  /** Why Pay is held back, in words; null when it may be paid. */
  blocked: string | null;
  /** The last refusal or lost answer of this receipt's sale, in words. */
  problem: string | null;
  /** This receipt has a sale whose outcome is not known. */
  pending: boolean;
  noPrint: boolean;
  onNoPrint: (on: boolean) => void;
  /** Sends the sale in flight again with the same keys. */
  onRetry: () => void;
  /** Lets the sale in flight go (after the armed second tap). */
  onDiscard: () => void;
}

export function FlowNotes({ blocked, offline, problem, pending, noPrint, onNoPrint, busy, onRetry, onDiscard }: FlowCommon) {
  const t = useT();
  // Letting an attempt go is a two-tap action: the first tap arms it and says what it means, the second does it.
  const [armed, setArmed] = useState(false);
  const stuck = pending && !busy;
  return (
    <>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ph-text">
        <input type="checkbox" className="size-5 shrink-0" data-testid="flow-no-print" checked={noPrint} disabled={busy} onChange={(event) => onNoPrint(event.target.checked)} />
        {t('pharmacy.cashier.flow.noPrint')}
      </label>
      {blocked && (
        <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="status" testId="flow-blocked">
          {blocked}
        </Note>
      )}
      {offline && (
        <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="alert">
          {t('pharmacy.sell.offline.pay')}
        </Note>
      )}
      {stuck && !problem && (
        <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="alert" testId="flow-attempt">
          {t('pharmacy.sell.attempt.unknown')}
        </Note>
      )}
      {problem && (
        <Note look="ph" icon={<CircleAlert aria-hidden />} tone="danger" role="alert" testId="flow-problem">
          {problem}
        </Note>
      )}
      {stuck && (
        <div className="flex flex-col gap-1.5" data-testid="flow-stuck">
          {armed && (
            <Note look="ph" icon={<TriangleAlert aria-hidden />} tone="danger" role="alert" testId="flow-discard-warning">
              {t('pharmacy.cashier.flow.discardWarning')}
            </Note>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" className={PH_BTN} data-testid="flow-retry" disabled={offline} onClick={onRetry}>
              <RotateCcw aria-hidden className="size-4" />
              {t('pharmacy.cashier.flow.retry')}
            </button>
            <button
              type="button"
              className={`${PH_BTN} ${armed ? 'border-ph-red text-ph-red' : ''}`}
              data-testid="flow-discard"
              aria-pressed={armed}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setArmed(false);
                onDiscard();
              }}
            >
              <Trash2 aria-hidden className="size-4" />
              {t(armed ? 'pharmacy.cashier.flow.discardArmed' : 'pharmacy.cashier.flow.discard')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** The flow's one confirm button, across the panel (Enter in a field submits the same form). */
export function ConfirmBar({ busy, disabled, label }: { busy: boolean; disabled: boolean; label: string }) {
  const t = useT();
  return (
    <button type="submit" data-testid="flow-confirm" className={`${PH_PRIMARY} min-h-12 w-full text-base`} disabled={disabled}>
      {busy ? <Hourglass aria-hidden className="size-4" /> : <CircleCheck aria-hidden className="size-4" />}
      {busy ? t('pharmacy.sell.pay.saving') : label}
    </button>
  );
}
