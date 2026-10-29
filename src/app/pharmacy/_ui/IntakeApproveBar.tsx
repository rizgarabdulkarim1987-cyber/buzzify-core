'use client';

import { CircleCheck, Lock, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { formatNumber } from '@/lib/pos-format';
import { useT } from '@/studio/i18n';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Dialog } from '@/studio/ui/Dialog';
import type { ApproveBlock, Blocker, ReviewData } from './intake-review-logic';
import { reviewCounts } from './intake-review-logic';
import { Message } from './intake-review-parts';

export interface IntakeApproveBarProps {
  data: ReviewData;
  blockers: Blocker[];
  /** Why the button is disabled, or false. */
  block: false | ApproveBlock;
  busy: boolean;
  /** Runs the approval; the screen keeps the answer and the message. */
  onConfirm: () => Promise<void>;
  onJump: (blocker: Blocker) => void;
  message: { tone: 'error' | 'ok' | 'info'; text: string } | null;
  /** Where the typed work that is not saved sits (line numbers, header), for the reason line. */
  unsavedText?: string;
  /** Where a duplicate-invoice refusal leads. */
  link: { href: string; label: string } | null;
}

const subscribeWide = (cb: () => void) => {
  const query = window.matchMedia('(min-width: 768px)');
  query.addEventListener('change', cb);
  return () => query.removeEventListener('change', cb);
};

/**
 * The bar at the bottom of the review: how many lines and open items there are, why the batch cannot be approved yet (each
 * reason jumps to the first line it concerns) and the button. Approving asks first and says plainly that it makes a DRAFT
 * receipt and puts nothing into stock. A role without `ai.use` can still approve a batch that is clean. No motion.
 */
export function IntakeApproveBar({ data, blockers, block, busy, onConfirm, onJump, message, link, unsavedText }: IntakeApproveBarProps) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  // The list of reasons starts open where there is room; on a phone it starts closed so the bar does not cover the lines.
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia('(min-width: 768px)').matches, () => true);
  const counts = reviewCounts(data);
  const reasonOfBlock = block && block !== 'blocked' ? t(`pharmacy.intake.reason.${block}`, { where: unsavedText ?? '' }) : null;

  const label = (b: Blocker): string => {
    switch (b.kind) {
      case 'noRows':
        return t('pharmacy.intake.rv.block.noRows');
      case 'processing':
        return t('pharmacy.intake.rv.block.processing', { files: formatNumber(b.files) });
      case 'flag':
        return t('pharmacy.intake.rv.block.flag', { flag: t(`pharmacy.intake.rv.flagChip.${b.flag}`), count: formatNumber(b.count) });
      case 'header':
        return t('pharmacy.intake.rv.block.header');
      default:
        return t(`pharmacy.intake.rv.block.${b.kind}`);
    }
  };
  const jumpLabel = (b: Blocker): string | null => (b.kind === 'flag' ? t('pharmacy.intake.rv.block.jump', { n: formatNumber(b.lineNo) }) : b.kind === 'header' || b.kind === 'supplier' || b.kind === 'currency' || b.kind === 'number' ? t('pharmacy.intake.rv.block.headerJump') : null);

  return (
    <div data-testid="intake-approve-bar" className="sticky bottom-0 z-20 flex min-w-0 flex-col gap-3 border-t border-line-strong bg-raised px-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p data-testid="approve-counts" className="text-base font-medium text-text">
          {t('pharmacy.intake.rv.counts', { rows: formatNumber(counts.rows), flags: formatNumber(counts.openFlags) })}
          {counts.removed > 0 && <span className="ms-3 text-sm font-normal text-muted">{t('pharmacy.intake.rv.countsRemoved', { count: formatNumber(counts.removed) })}</span>}
        </p>
        <div className="flex min-w-0 flex-col gap-1">
          <Button variant="primary" size="lg" className="min-h-11" icon={<ReceiptText aria-hidden />} data-testid="intake-approve" disabled={block !== false || busy} aria-describedby={reasonOfBlock ? 'approve-why' : block === 'blocked' ? 'approve-reasons' : undefined} onClick={() => setConfirming(true)}>
            {busy ? t('pharmacy.intake.rv.bar.working') : t('pharmacy.intake.rv.bar.approve')}
          </Button>
          {reasonOfBlock && (
            <p id="approve-why" data-testid="approve-why" className="flex items-start gap-1.5 text-sm text-muted [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
              <Lock aria-hidden />
              <span className="min-w-0">{reasonOfBlock}</span>
            </p>
          )}
        </div>
      </div>

      {blockers.length > 0 ? (
        <details open={wide} data-testid="approve-blockers" className="min-w-0 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
            {t('pharmacy.intake.rv.bar.why')} ({formatNumber(blockers.length)})
          </summary>
          <ul id="approve-reasons" tabIndex={0} aria-label={t('pharmacy.intake.rv.bar.why')} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {blockers.map((b, i) => {
              const jump = jumpLabel(b);
              return (
                <li key={`${b.kind}-${'flag' in b ? b.flag : i}`} data-testid="approve-blocker" data-kind={b.kind} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words text-text">{label(b)}</span>
                  {jump && (
                    <button type="button" data-testid="approve-jump" onClick={() => onJump(b)} className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
                      {jump}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ) : (
        block === false && (
          <p data-testid="approve-ready" className="flex items-start gap-2 text-sm text-text [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
            <CircleCheck aria-hidden className="text-success" />
            <span className="min-w-0">{t('pharmacy.intake.rv.bar.ready')}</span>
          </p>
        )
      )}

      {message && <Message tone={message.tone} testId="approve-message">{message.text}</Message>}
      {link && (
        <Link href={link.href} data-testid="approve-link" className={buttonClasses('secondary', 'lg', 'min-h-11 w-fit')}>
          {link.label}
        </Link>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(next) => !busy && setConfirming(next)}
        title={t('pharmacy.intake.rv.confirm.title')}
        description={<span data-testid="approve-confirm-body">{t('pharmacy.intake.rv.confirm.body')}</span>}
        footer={
          <>
            <Button size="lg" className="min-h-11" disabled={busy} data-testid="approve-back" onClick={() => setConfirming(false)}>
              {t('pharmacy.intake.rv.confirm.back')}
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="min-h-11"
              data-testid="approve-yes"
              disabled={busy}
              onClick={async () => {
                await onConfirm();
                setConfirming(false);
              }}
            >
              {busy ? t('pharmacy.intake.rv.bar.working') : t('pharmacy.intake.rv.confirm.yes')}
            </Button>
          </>
        }
      />
    </div>
  );
}
