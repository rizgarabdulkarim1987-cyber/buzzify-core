'use client';

import { useMemo, useState } from 'react';
import { acknowledgePosCancellations, markPosLinesReady } from '@/app/studio/_actions/pos';
import { elapsedLabel, elapsedMinutes, formatNumber, type ElapsedText } from '@/lib/pos-format';
import { isLate } from '@/lib/pos-view';
import type { KitchenCard } from '@/server/pos/kitchen';
import { useLocale, useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { useLiveRefresh, useNow } from './live';
import { usePosCall } from './use-pos-call';

const REFRESH_MS = 5_000;

/** The kitchen's cards, oldest first: what to cook, what is ready, and what the cashier cancelled. */
export function KitchenScreen({ cards, canFilter }: { cards: KitchenCard[]; canFilter: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const { call, pending } = usePosCall();
  const [section, setSection] = useState<string | null | undefined>(undefined);
  const now = useNow(15_000);
  useLiveRefresh(REFRESH_MS);

  const text: ElapsedText = useMemo(
    () => ({
      justNow: t('pos.time.justNow'),
      one: t('pos.time.one'),
      two: t('pos.time.two'),
      few: t('pos.time.few'),
      many: t('pos.time.many'),
      other: t('pos.time.other'),
      hours: t('pos.time.hours'),
    }),
    [t],
  );
  const sections = useMemo(() => {
    const seen = new Map<string | null, string>();
    for (const card of cards) seen.set(card.sectionId, card.sectionName || t('pos.kitchen.noSection'));
    return [...seen.entries()];
  }, [cards, t]);
  const shown = section === undefined ? cards : cards.filter((card) => card.sectionId === section);

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      {canFilter && sections.length > 1 ? (
        <div role="tablist" aria-label={t('pos.kitchen.sections')} className="flex gap-1 overflow-x-auto">
          {[[undefined, t('pos.board.allAreas')] as const, ...sections].map(([id, name]) => (
            <button
              key={id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => setSection(id)}
              className={cx('min-h-11 shrink-0 rounded-md border px-4 text-base whitespace-nowrap', section === id ? 'border-ink bg-ink text-on-ink' : 'border-line-strong text-text hover:bg-hover')}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState title={t('pos.kitchen.empty')} body={t('pos.kitchen.emptyHint')} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {shown.map((card) => {
            const sent = new Date(card.sentAt).getTime();
            const late = isLate(sent, now);
            const pendingLines = card.lines.filter((line) => !line.ready);
            return (
              <li
                key={`${card.orderId}-${card.batch}-${card.sectionId}`}
                className={cx('flex flex-col gap-2 rounded-lg border-2 p-3', card.orderCancelled ? 'border-danger bg-danger-wash' : late ? 'border-danger' : 'border-line-strong bg-raised')}
              >
                <header className="flex items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    {card.tableNumber !== null ? t('pos.kitchen.table', { n: formatNumber(card.tableNumber) }) : t('pos.kitchen.order', { n: formatNumber(card.orderNumber) })}
                  </h2>
                  <span className={cx('text-sm', late ? 'font-semibold text-danger' : 'text-muted')}>
                    {late ? `${t('pos.kitchen.late')} · ` : ''}
                    {elapsedLabel(elapsedMinutes(sent, now), text, locale)}
                  </span>
                </header>
                <p className="text-sm text-muted">
                  {t('pos.kitchen.round', { n: formatNumber(card.batch) })}
                  {card.sectionName ? ` · ${card.sectionName}` : ''}
                  {card.areaName ? ` · ${card.areaName}` : ''}
                </p>
                {card.orderCancelled ? <p className="text-base font-semibold text-danger">{t('pos.kitchen.orderCancelled')}</p> : null}
                <ul className="flex flex-col gap-1">
                  {card.lines.map((line) => (
                    <li key={line.id} className="flex items-start justify-between gap-2">
                      <span className={cx('text-lg', line.ready && 'text-muted line-through')}>
                        <span className="font-semibold">{formatNumber(line.quantity)} ×</span> {line.name}
                        {line.options.length > 0 ? <span className="block text-sm text-muted">{line.options.join(' · ')}</span> : null}
                        {line.note ? <span className="block text-sm">“{line.note}”</span> : null}
                      </span>
                      {!line.ready && !card.orderCancelled ? (
                        <Button variant="secondary" size="lg" disabled={pending} onClick={() => void call(() => markPosLinesReady({ lineIds: [line.id] }))}>
                          {t('pos.kitchen.ready')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {card.cancelled.length > 0 ? (
                  <div className="flex flex-col gap-1 rounded-md bg-danger-wash p-2">
                    <p className="text-sm font-semibold text-danger">{t('pos.kitchen.cancelled')}</p>
                    <ul>
                      {card.cancelled.map((line) => (
                        <li key={line.id} className="text-base">
                          <s>
                            {formatNumber(line.quantity)} × {line.name}
                          </s>
                          {line.reason ? <span className="block text-sm text-muted">{line.reason}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <Button variant="secondary" size="lg" disabled={pending} onClick={() => void call(() => acknowledgePosCancellations({ lineIds: card.cancelled.map((line) => line.id) }))}>
                      {t('pos.kitchen.seen')}
                    </Button>
                  </div>
                ) : null}
                {pendingLines.length > 1 && !card.orderCancelled ? (
                  <Button size="lg" className="min-h-12" disabled={pending} onClick={() => void call(() => markPosLinesReady({ lineIds: pendingLines.map((line) => line.id) }))}>
                    {t('pos.kitchen.allReady')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
