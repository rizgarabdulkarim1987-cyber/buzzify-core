'use client';

import { formatNumber, formatStamp } from '@/lib/pos-format';
import type { OrderView } from '@/server/pos/orders';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { useMoney } from './money';
import { usePrint } from './print/PrintProvider';

/** The driver's paper: where to go, what is in the bag (no prices) and the cash to collect. Printable at 80 mm. */
export function DeliverySlip({ order }: { order: OrderView }) {
  const t = useT();
  const money = useMoney();
  const { hasReceiptPrinter, printDelivery } = usePrint();
  const info = order.offPremise;
  if (info === null || order.kind !== 'DELIVERY') return null;
  const paid = order.status === 'PAID';
  return (
    <div className="mx-auto flex w-full max-w-[80mm] flex-col gap-3 px-4 py-6 print:max-w-none print:p-0">
      <header className="text-center">
        <h1 className="text-lg font-semibold">{t('pos.slip.title')}</h1>
        <p className="text-base font-semibold">{t('pos.receipt.kindDelivery', { n: formatNumber(info.queueNumber) })}</p>
        <p className="text-sm text-muted">
          <time dateTime={new Date(order.seatedAt).toISOString()}>{formatStamp(order.seatedAt)}</time>
        </p>
      </header>
      <div className="flex flex-col gap-1 border-y border-dashed border-line-strong py-2 text-base">
        {info.customerName ? <p className="font-medium" dir="auto">{info.customerName}</p> : null}
        {info.customerPhone ? <p dir="ltr">{info.customerPhone}</p> : null}
        <p dir="auto">{[info.zoneName, info.address].filter(Boolean).join(' · ')}</p>
        {info.addressNote ? <p className="text-sm text-muted" dir="auto">{info.addressNote}</p> : null}
        {info.driverName ? <p className="text-sm text-muted">{t('pos.offp.driver')}: {info.driverName}</p> : null}
      </div>
      <ul className="flex flex-col gap-1 text-base">
        {order.lines
          .filter((line) => !line.cancelled)
          .map((line) => (
            <li key={line.id}>
              {formatNumber(line.quantity)} × {line.name}
              {line.options.length > 0 ? <span className="block text-sm text-muted">{line.options.map((o) => o.name).join(' · ')}</span> : null}
            </li>
          ))}
      </ul>
      <p className="flex justify-between border-t border-dashed border-line-strong pt-2 text-lg font-semibold">
        <span>{paid ? t('pos.slip.paidAlready') : t('pos.slip.toCollect')}</span>
        <span>{paid ? money(0) : money(order.totals.total)}</span>
      </p>
      <div className="flex flex-col gap-2 print:hidden">
        <Button variant="primary" size="lg" className="min-h-12" onClick={async () => {
            // The receipt printer takes it silently; the browser's print dialog stays the way out when there is none or it fails.
            if (hasReceiptPrinter && (await printDelivery(order)).ok) return;
            window.print();
          }}>
          {t('pos.receipt.print')}
        </Button>
      </div>
    </div>
  );
}
