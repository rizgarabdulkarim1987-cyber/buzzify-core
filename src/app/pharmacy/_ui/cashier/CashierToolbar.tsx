'use client';

import { CircleX, LayoutGrid, List, Pause, Percent, Plus, Printer, Undo2, Unlock } from 'lucide-react';
import { useT } from '@/studio/i18n';
import { Note, Num, PH_BTN } from '../sell-parts';
import { ArmedButton } from './ArmedButton';
import type { WorkFlow } from './sale-flow-logic';

const TOOL = `${PH_BTN} flex-col gap-0 px-3 leading-tight`;
const KEY = 'text-[11px] font-normal text-ph-muted';

/**
 * The toolbar row of layout A, under the header, in the prototype's order: a new receipt (F4), discard the receipt's data (two
 * taps; with nothing to discard, or a receipt being paid, it says so instead), print a copy of the last receipt (with "do not
 * print" under it; with no earlier sale it says so), all operations, hold (F8), the held receipts with their count, the receipt
 * discount (F9) and, at the far end, return mode (a return against an original sale), whose caption turns into "End return"
 * while it is on and which a second press closes. Every button opens its flow inline in the work panel or acts at once; none
 * opens a dialog.
 */
export function CashierToolbar({
  flow,
  onNew,
  canDiscard,
  onDiscard,
  onDiscardRefused,
  onReprint,
  noPrint,
  noPrintLocked,
  onNoPrint,
  canOps,
  canHold,
  holding,
  heldCount,
  heldMore,
  showDiscount,
  canDiscount,
  onOpen,
  onReturn,
  onHold,
  onRelease,
}: {
  flow: WorkFlow | null;
  onNew: () => void;
  canDiscard: boolean;
  onDiscard: () => void;
  /** A press while there is nothing to discard (or the receipt is frozen): the screen says why. */
  onDiscardRefused: () => void;
  /** Opens the copy of the last receipt, or says there is none. */
  onReprint: () => void;
  noPrint: boolean;
  /** A sale is being sent: the box keeps its value until it is answered. */
  noPrintLocked: boolean;
  onNoPrint: (on: boolean) => void;
  canOps: boolean;
  canHold: boolean;
  holding: boolean;
  heldCount: number | null;
  /** More held receipts than counted. */
  heldMore: boolean;
  /** The person may discount (the button is there). */
  showDiscount: boolean;
  /** There is something to discount on this receipt now. */
  canDiscount: boolean;
  onOpen: (flow: 'ops' | 'held' | 'discount') => void;
  /** Turns return mode on, or off when it is on. */
  onReturn: () => void;
  onHold: () => void;
  /** Given while the active receipt's hold got no answer: lets it go (two taps). */
  onRelease?: () => void;
}) {
  const t = useT();
  const returning = flow === 'return';
  return (
    // Under 1440px wide (a 1366x768 or 1280x800 laptop) the buttons and gaps are tighter, so the whole row stays on one line.
    <div className="flex min-w-0 flex-wrap items-stretch gap-1.5 [@media(max-width:1439px)]:gap-1 [@media(max-width:1439px)]:[&_button]:px-2" role="toolbar" aria-label={t('pharmacy.cashier.tools.region')} data-testid="cashier-toolbar">
      <button type="button" className={TOOL} data-testid="tool-new" onClick={onNew}>
        <span className="inline-flex items-center gap-1.5">
          <Plus aria-hidden className="size-4" />
          {t('pharmacy.cashier.tools.new')}
        </span>
        <small className={KEY}>F4</small>
      </button>
      {canDiscard ? (
        <ArmedButton testId="tool-discard" icon={<CircleX aria-hidden className="size-4" />} label={t('pharmacy.cashier.tools.discard')} armedLabel={t('pharmacy.cashier.tools.discardArmed')} onConfirm={onDiscard} />
      ) : (
        // Kept in reach and named, as in the prototype: a press answers why there is nothing to do.
        <button type="button" className={`${PH_BTN} aria-disabled:opacity-60`} data-testid="tool-discard" aria-disabled="true" onClick={onDiscardRefused}>
          <CircleX aria-hidden className="size-4" />
          {t('pharmacy.cashier.tools.discard')}
        </button>
      )}
      <div className="flex items-stretch gap-1.5" data-testid="tool-print-group">
        <button type="button" className={TOOL} data-testid="tool-reprint" aria-pressed={flow === 'copy'} onClick={onReprint}>
          <span className="inline-flex items-center gap-1.5">
            <Printer aria-hidden className="size-4" />
            {t('pharmacy.cashier.tools.reprint')}
          </span>
          <small className={KEY}>{t('pharmacy.cashier.tools.reprintHint')}</small>
        </button>
        <label className="flex min-h-11 max-w-28 cursor-pointer items-center gap-1.5 text-xs leading-tight text-ph-muted">
          <input type="checkbox" className="size-4 shrink-0" data-testid="flow-no-print" checked={noPrint} disabled={noPrintLocked} onChange={(event) => onNoPrint(event.target.checked)} />
          {t('pharmacy.cashier.flow.noPrint')}
        </label>
      </div>
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
      {showDiscount && (
        <button type="button" className={TOOL} data-testid="tool-discount" aria-pressed={flow === 'discount'} disabled={!canDiscount} onClick={() => onOpen('discount')}>
          <span className="inline-flex items-center gap-1.5">
            <Percent aria-hidden className="size-4" />
            {t('pharmacy.cashier.tools.discount')}
          </span>
          <small className={KEY}>F9</small>
        </button>
      )}
      <span className="flex-1" />
      <button type="button" className={`${PH_BTN} ${returning ? 'border-ph-amber-ink bg-ph-amber-wash text-ph-amber-ink' : ''}`} data-testid="tool-return" aria-pressed={returning} onClick={onReturn}>
        <Undo2 aria-hidden className="size-4" />
        {t(returning ? 'pharmacy.cashier.tools.returnEnd' : 'pharmacy.cashier.tools.return')}
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
