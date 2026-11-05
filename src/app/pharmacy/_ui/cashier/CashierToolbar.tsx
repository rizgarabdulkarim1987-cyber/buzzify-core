'use client';

import { CircleX, LayoutGrid, List, Pause, Percent, Printer, Undo2, Unlock } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Note, Num, PH_BTN } from '../sell-parts';
import { ArmedButton } from './ArmedButton';
import type { WorkFlow } from './sale-flow-logic';

const TOOL = `${PH_BTN} flex-col gap-0 px-3 leading-tight`;
const KEY = 'text-[11px] font-normal text-ph-muted';

/**
 * The toolbar row of layout A, under the header: discard the receipt's data (two taps), print a copy of the last receipt (only once
 * a sale was made on this screen), all operations, hold (F8), the held receipts with their count, the receipt discount (F9) and, at
 * the far end, return mode (a return against an original sale).
 * Every button opens its flow inline in the work panel or acts at once; none opens a dialog.
 */
export function CashierToolbar({
  flow,
  canDiscard,
  onDiscard,
  canReprint,
  canOps,
  canHold,
  holding,
  heldCount,
  heldMore,
  canDiscount,
  onOpen,
  onHold,
  onRelease,
}: {
  flow: WorkFlow | null;
  canDiscard: boolean;
  onDiscard: () => void;
  canReprint: boolean;
  canOps: boolean;
  canHold: boolean;
  holding: boolean;
  heldCount: number | null;
  /** More held receipts than counted. */
  heldMore: boolean;
  canDiscount: boolean;
  onOpen: (flow: 'copy' | 'ops' | 'held' | 'discount' | 'return') => void;
  onHold: () => void;
  /** Given while the active receipt's hold got no answer: lets it go (two taps). */
  onRelease?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-stretch gap-1.5" role="toolbar" aria-label={t('pharmacy.cashier.tools.region')} data-testid="cashier-toolbar">
      <ArmedButton testId="tool-discard" disabled={!canDiscard} icon={<CircleX aria-hidden className="size-4" />} label={t('pharmacy.cashier.tools.discard')} armedLabel={t('pharmacy.cashier.tools.discardArmed')} onConfirm={onDiscard} />
      {canReprint && (
        <button type="button" className={TOOL} data-testid="tool-reprint" aria-pressed={flow === 'copy'} onClick={() => onOpen('copy')}>
          <span className="inline-flex items-center gap-1.5">
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.cashier.tools.reprint')}
          </span>
          <small className={KEY}>{t('pharmacy.cashier.tools.reprintHint')}</small>
        </button>
      )}
      {canOps && (
        <button type="button" className={PH_BTN} data-testid="tool-ops" aria-pressed={flow === 'ops'} onClick={() => onOpen('ops')}>
          <LayoutGrid aria-hidden className="size-4" />
          {t('pharmacy.cashier.tools.ops')}
        </button>
      )}
      <button type="button" className={TOOL} data-testid="tool-hold" disabled={!canHold || holding} onClick={onHold}>
        <span className="inline-flex items-center gap-1.5">
          <Pause aria-hidden className="size-4" />
          {t('pharmacy.cashier.tools.hold')}
        </span>
        <small className={KEY}>F8</small>
      </button>
      {onRelease && <ArmedButton testId="tool-hold-release" icon={<Unlock aria-hidden className="size-4" />} label={t('pharmacy.cashier.hold.release')} armedLabel={t('pharmacy.cashier.hold.releaseArmed')} onConfirm={onRelease} />}
      <button type="button" className={PH_BTN} data-testid="tool-held" aria-pressed={flow === 'held'} onClick={() => onOpen('held')}>
        <List aria-hidden className="size-4" />
        {t('pharmacy.cashier.tools.held')} (<span data-testid="held-count"><Num>{heldCount ?? 0}</Num>
          {heldMore && '+'}
        </span>
        )
      </button>
      {canDiscount && (
        <button type="button" className={TOOL} data-testid="tool-discount" aria-pressed={flow === 'discount'} onClick={() => onOpen('discount')}>
          <span className="inline-flex items-center gap-1.5">
            <Percent aria-hidden className="size-4" />
            {t('pharmacy.cashier.tools.discount')}
          </span>
          <small className={KEY}>F9</small>
        </button>
      )}
      <span className="flex-1" />
      <button type="button" className={PH_BTN} data-testid="tool-return" aria-pressed={flow === 'return'} onClick={() => onOpen('return')}>
        <Undo2 aria-hidden className="size-4" />
        {t('pharmacy.cashier.tools.return')}
      </button>
    </div>
  );
}

/** The leave guard's question, inline under the toolbar: the old screen's "leave with items?" with Leave and Stay. */
export function LeaveNote({ onStay, onGo }: { onStay: () => void; onGo: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5" data-testid="leave-note">
      <Note look="ph" icon={<Undo2 aria-hidden />} tone="danger" role="alert">
        <b>{t('pharmacy.sell.leave.title')}</b> {t('pharmacy.sell.leave.body')}
      </Note>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={PH_BTN} data-testid="leave-stay" onClick={onStay}>
          {t('pharmacy.sell.leave.stay')}
        </button>
        <button type="button" className={`${PH_BTN} border-ph-red text-ph-red`} data-testid="leave-go" onClick={onGo}>
          {t('pharmacy.sell.leave.go')}
        </button>
      </div>
    </div>
  );
}
