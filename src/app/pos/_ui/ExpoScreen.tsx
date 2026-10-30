'use client';

import { useMemo } from 'react';
import { elapsedLabel, elapsedMinutes, formatNumber, type ElapsedText } from '@/lib/pos-format';
import type { ExpoOrder } from '@/server/domain/pos/expo';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';
import { EmptyState } from '@/studio/ui/EmptyState';
import { useLiveRefresh, useNow } from './live';

const REFRESH_MS = 5_000;

/** The pass: one tile per order, each section waiting or ready in words, and the whole table marked when it can go out. */
export function ExpoScreen({ orders, readAt }: { orders: ExpoOrder[]; readAt: Date }) {
  const t = useT();
  const { locale } = useLocale();
  const now = useNow(new Date(readAt).getTime(), 15_000);
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

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 sm:px-8">
      {orders.length === 0 ? (
        <EmptyState title={t('pos.expo.empty')} body={t('pos.expo.emptyHint')} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {orders.map((order) => (
            <li key={order.orderId} className={cx('flex flex-col gap-2 rounded-lg border-2 p-3', order.allReady && !order.served ? 'border-ink bg-hover' : 'border-line-strong bg-raised')}>
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {order.kind !== 'DINE_IN' && order.queueNumber !== null
                    ? t(order.kind === 'DELIVERY' ? 'pos.kitchen.delivery' : 'pos.kitchen.takeaway', { n: formatNumber(order.queueNumber) })
                    : order.tableNumber !== null
                      ? t('pos.kitchen.table', { n: formatNumber(order.tableNumber) })
                      : t('pos.kitchen.order', { n: formatNumber(order.orderNumber) })}
                </h2>
                <span className="text-sm text-muted">{elapsedLabel(elapsedMinutes(new Date(order.oldestAt).getTime(), now), text, locale)}</span>
              </header>
              {order.allReady && !order.served ? <p className="text-base font-bold">{t('pos.expo.readyToRun')}</p> : null}
              <ul className="flex flex-col gap-1">
                {order.sections.map((section) => (
                  <li key={section.sectionId ?? 'none'} className="flex items-center justify-between gap-2 text-lg">
                    <span dir="auto">{section.name || t('pos.kitchen.noSection')}</span>
                    <span className={cx('text-base', section.ready ? 'font-semibold' : 'text-muted')}>{section.ready ? t('pos.expo.ready') : t('pos.expo.waiting')}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
