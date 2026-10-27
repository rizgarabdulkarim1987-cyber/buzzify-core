import { formatNumber } from '@/lib/pos-format';
import type { SalesBreakdown } from '@/server/pos/report-breakdown';
import type { getStudioTranslator } from '@/studio/messages';
import { moneyLabel } from './stock/view';

type T = ReturnType<typeof getStudioTranslator>;

/** Sales of a range by hour, item, staff member and payment method, with the file to download. */
export function BreakdownTables({ t, breakdown, from, to }: { t: T; breakdown: SalesBreakdown; from: string; to: string }) {
  const methodLabel = (method: string) => t(`pos.method.${method}` as 'pos.method.CASH');
  const sections = [
    {
      key: 'hour',
      title: t('pos.range.byHour'),
      head: [t('pos.range.colHour'), t('pos.range.colOrders'), t('pos.range.colTotal')],
      rows: breakdown.byHour.map((r) => [`${formatNumber(r.hour)}:00`, formatNumber(r.orders), moneyLabel(t, r.total)]),
    },
    {
      key: 'item',
      title: t('pos.range.byItem'),
      head: [t('pos.range.colItem'), t('pos.range.colQuantity'), t('pos.range.colTotal')],
      rows: breakdown.byItem.map((r) => [r.name, formatNumber(r.quantity), moneyLabel(t, r.total)]),
    },
    {
      key: 'staff',
      title: t('pos.range.byStaff'),
      head: [t('pos.range.colStaff'), t('pos.range.colOrders'), t('pos.range.colTotal')],
      rows: breakdown.byStaff.map((r) => [r.name, formatNumber(r.orders), moneyLabel(t, r.total)]),
    },
    {
      key: 'method',
      title: t('pos.range.byMethod'),
      head: [t('pos.range.colMethod'), t('pos.range.colOrders'), t('pos.range.colTotal')],
      rows: breakdown.byMethod.map((r) => [methodLabel(r.method), formatNumber(r.orders), moneyLabel(t, r.total)]),
    },
  ];
  return (
    <section aria-labelledby="range-breakdown" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="range-breakdown" className="text-base font-semibold text-text">
          {t('pos.range.breakdown')}
        </h2>
        <a href={`/api/pos/report/export?from=${from}&to=${to}`} download className="inline-flex min-h-12 items-center rounded-md border border-line px-4 text-base font-medium text-text hover:bg-hover">
          {t('pos.range.exportCsv')}
        </a>
      </div>
      {sections.map((section) => (
        <div key={section.key} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted">{section.title}</h3>
          {section.rows.length === 0 ? (
            <p className="text-sm text-muted">{t('pos.range.noSales')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-96 text-start text-base">
                <thead>
                  <tr className="border-b border-line text-sm text-muted">
                    {section.head.map((label) => (
                      <th key={label} scope="col" className="px-4 py-2 text-start font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row[0]} className="border-b border-line last:border-b-0">
                      {row.map((value, i) => (
                        <td key={i} className="px-4 py-2">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
