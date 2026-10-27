import {
  ClipboardList,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  TriangleAlert,
  Truck,
  Undo2,
  Undo,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { formatNumber, formatStamp, ltr } from '@/lib/pos-format';
import type { MovementView } from '@/server/pharmacy/stock-reads';
import { ReverseButton } from './ReverseButton';

const ICONS: Record<MovementView['type'], ReactNode> = {
  RECEIPT: <PackagePlus aria-hidden />,
  SALE: <ShoppingCart aria-hidden />,
  RETURN_IN: <Undo aria-hidden />,
  RETURN_QUARANTINE: <ShieldAlert aria-hidden />,
  ADJUST: <SlidersHorizontal aria-hidden />,
  DAMAGE: <TriangleAlert aria-hidden />,
  TRANSFER_OUT: <Truck aria-hidden />,
  TRANSFER_IN: <PackageCheck aria-hidden />,
  SUPPLIER_RETURN: <PackageMinus aria-hidden />,
  COUNT: <ClipboardList aria-hidden />,
  QUARANTINE_RELEASE: <ShieldCheck aria-hidden />,
};

/** The types the server lets a person reverse here (ADJUST, DAMAGE, QUARANTINE_RELEASE, RECEIPT). */
export const REVERSIBLE: ReadonlySet<MovementView['type']> = new Set(['ADJUST', 'DAMAGE', 'QUARANTINE_RELEASE', 'RECEIPT']);

const signed = (n: number) => `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n))}`;

export interface MovementListProps {
  items: MovementView[];
  t: Translate;
  /** The chosen branch when the person may reverse changes in it; null hides the reverse control. */
  reverseBranchId: string | null;
}

/**
 * The ledger, newest first. Each line says what kind of change it was (icon and word), how much moved in which bucket
 * (a sign and a number), the lot, who and when, and why. A reversal says it reverses an earlier line, and an original
 * that a reversal on this page undoes says it was reversed. No motion.
 */
export function MovementList({ items, t, reverseBranchId }: MovementListProps) {
  const reversed = new Set(items.flatMap((m) => (m.reversesId ? [m.reversesId] : [])));
  return (
    <ul aria-label={t('pharmacy.movements.title')} className="flex flex-col border-t border-line">
      {items.map((m) => {
        const deltas = (
          [
            ['available', m.availableDelta],
            ['reserved', m.reservedDelta],
            ['quarantine', m.quarantineDelta],
            ['damaged', m.damagedDelta],
          ] as const
        ).filter(([, delta]) => delta !== 0);
        const canReverse = reverseBranchId !== null && m.branchId === reverseBranchId && REVERSIBLE.has(m.type) && !m.reversesId && !reversed.has(m.id);
        return (
          <li key={m.id} data-testid="movement-row" className="flex min-w-0 flex-col gap-1.5 border-b border-line py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="inline-flex items-center gap-2 text-base font-medium text-text [&_svg]:size-4 [&_svg]:shrink-0">
                {ICONS[m.type]}
                {t(`pharmacy.movements.type.${m.type}`)}
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                {deltas.map(([bucket, delta]) => (
                  <span key={bucket} className="flex items-baseline gap-1.5">
                    <span className="text-muted">{t(`pharmacy.stock.bucket.${bucket}`)}</span>
                    <bdi dir="ltr" data-testid="movement-delta" className="font-medium text-text tabular-nums">
                      {signed(delta)}
                    </bdi>
                  </span>
                ))}
              </span>
              {m.reversesId && (
                <span data-chip="reversal" className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text [&_svg]:size-3.5">
                  <Undo2 aria-hidden />
                  {t('pharmacy.movements.reversal')}
                </span>
              )}
              {reversed.has(m.id) && (
                <span data-chip="reversed" className="inline-flex min-h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-1.5 py-0.5 text-xs font-medium text-text [&_svg]:size-3.5">
                  <Undo2 aria-hidden />
                  {t('pharmacy.movements.reversed')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5 text-sm">
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted">{t('pharmacy.movements.col.lot')}</span>
                <bdi dir="ltr" className="font-medium text-text">
                  {m.lot}
                </bdi>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted">{t('pharmacy.movements.col.by')}</span>
                <bdi dir="ltr" data-testid="movement-who" className="text-text">
                  {m.userId.slice(0, 8)}
                </bdi>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted">{t('pharmacy.movements.col.when')}</span>
                <bdi dir="ltr" className="text-text tabular-nums">
                  {ltr(formatStamp(m.createdAt))}
                </bdi>
              </span>
              <Link href={`/pharmacy/stock/movements?product=${encodeURIComponent(m.productId)}`} className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
                {t('pharmacy.stock.history')}
              </Link>
            </div>
            {m.reason.trim() !== '' && (
              <p className="text-sm text-text">
                <span className="text-muted">{t('pharmacy.movements.col.reason')}: </span>
                <span dir="auto" className="break-words [overflow-wrap:anywhere]">
                  {m.reason}
                </span>
              </p>
            )}
            {canReverse && <ReverseButton movementId={m.id} />}
          </li>
        );
      })}
    </ul>
  );
}
