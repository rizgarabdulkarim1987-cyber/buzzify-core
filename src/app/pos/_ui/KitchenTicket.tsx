'use client';

import { formatNumber } from '@/lib/pos-format';
import type { KitchenTicket as Ticket } from '@/server/pos/kitchen';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';

/** The kitchen's paper: one sheet per section and round, then the cancellation slips. Printable at 80 mm. */
export function KitchenTicket({ ticket }: { ticket: Ticket }) {
  const t = useT();
  const head = (
    <p className="text-sm text-muted">
      {ticket.kind !== 'DINE_IN' && ticket.queueNumber !== null
        ? t(ticket.kind === 'DELIVERY' ? 'pos.ticket.delivery' : 'pos.ticket.takeaway', { n: formatNumber(ticket.queueNumber) })
        : ticket.tableNumber !== null
          ? t('pos.ticket.table', { n: formatNumber(ticket.tableNumber) })
          : ''}
      {ticket.areaName ? ` · ${ticket.areaName}` : ''} · {ticket.cashierName}
    </p>
  );
  return (
    <div className="mx-auto flex w-full max-w-[80mm] flex-col gap-4 px-4 py-6 print:max-w-none print:p-0">
      {ticket.sheets.map((sheet) => (
        <section key={`${sheet.sectionId}-${sheet.batch}`} className="flex flex-col gap-2 break-after-page border-b border-dashed border-line-strong pb-3">
          <h1 className="text-lg font-semibold">
            {sheet.sectionName} · {t('pos.ticket.order', { n: formatNumber(ticket.orderNumber) })}
          </h1>
          {head}
          <ul className="flex flex-col gap-1 text-lg">
            {sheet.lines.map((line, index) => (
              <li key={index}>
                <span className="font-semibold">{formatNumber(line.quantity)} ×</span> {line.name}
                {line.options.length > 0 ? <span className="block text-sm">{line.options.join(' · ')}</span> : null}
                {line.note ? <span className="block text-sm">“{line.note}”</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ticket.cancelSlips.map((slip) => (
        <section key={`cancel-${slip.sectionId}`} className="flex flex-col gap-2 break-after-page border-b border-dashed border-line-strong pb-3">
          <h1 className="text-lg font-semibold text-danger">
            {t('pos.ticket.cancelled')} · {slip.sectionName}
          </h1>
          {head}
          <ul className="flex flex-col gap-1 text-lg">
            {slip.lines.map((line, index) => (
              <li key={index}>
                <span className="font-semibold">{formatNumber(line.quantity)} ×</span> <s>{line.name}</s>
                {line.reason ? <span className="block text-sm">{line.reason}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ticket.sheets.length === 0 && ticket.cancelSlips.length === 0 ? <p className="text-center text-base text-muted">{t('pos.ticket.nothing')}</p> : null}
      <Button variant="primary" size="lg" className="min-h-12 print:hidden" onClick={() => window.print()}>
        {t('pos.receipt.print')}
      </Button>
    </div>
  );
}
