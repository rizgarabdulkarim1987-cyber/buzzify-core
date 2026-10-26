import type { Metadata } from 'next';
import { baghdadDayOf, isCalendarDay } from '@/lib/baghdad';
import { formatNumber, ltr } from '@/lib/pos-format';
import { query } from '@/server/studio/framework/invoke';
import { posAiAlerts } from '@/server/studio/queries/pos-ai';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { SectionTabs, StockState, moneyLabel, quantityLabel } from '@/app/pos/_ui/stock/view';
import { AiOff } from '@/app/pos/_ui/ai/view';
import type { StockUnitKey } from '@/server/domain/pos/stock';
import { aiPage } from '../guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ai.alerts.title') };
}

/**
 * What the day's report holds that is worth a second look, from fixed rules, with low stock beside it. Each line says so in
 * the same calm words ("worth reviewing"); none says that anyone did something wrong. No request is spent here.
 */
export default async function AiAlertsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const [{ day: asked }, { t, off, tabs, mayOpenPackage }] = await Promise.all([searchParams, aiPage('alerts')]);
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && isCalendarDay(asked) ? asked : baghdadDayOf(new Date());
  const result = off ? null : await query(posAiAlerts, { day });
  const alerts = result && result.ok ? result.alerts : null;
  return (
    <>
      <PageHeader title={t('pos.ai.alerts.title')} description={t('pos.ai.alerts.intro')} />
      <SectionTabs label={t('pos.ai.tabs')} current="alerts" items={tabs} />
      {off ? (
        <AiOff t={t} showPackageLink={mayOpenPackage} />
      ) : (
        <div className="flex flex-col gap-6 px-8 pb-8">
          <form className="flex flex-wrap items-end gap-3" action="/pos/ai/alerts">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="alerts-day" className="text-sm font-medium text-text">
                {t('pos.ai.alerts.day')}
              </label>
              <input id="alerts-day" name="day" type="date" dir="ltr" defaultValue={day} className="min-h-12 rounded-md border border-line-strong bg-raised px-3 text-base text-text" />
            </div>
            <button type="submit" className="min-h-12 rounded-md bg-ink px-4 text-base font-medium text-on-ink">
              {t('pos.ai.alerts.show')}
            </button>
          </form>
          {result && !result.ok ? (
            <p role="alert" className="text-base text-danger">
              {t(`pos.ai.error.${result.code}`)}
            </p>
          ) : null}
          {alerts ? (
            <>
              {alerts.operations.length === 0 ? (
                <p className="text-base text-muted">{t('pos.ai.alerts.none')}</p>
              ) : (
                <ul className="flex max-w-3xl flex-col gap-2">
                  {alerts.operations.map((op, index) => (
                    <li key={index} className="rounded-lg border border-line px-4 py-3 text-base text-text [overflow-wrap:anywhere]" dir="auto">
                      {t(`pos.ai.alerts.${op.kind}`, { name: op.cashierName ?? '', amount: moneyLabel(t, Math.abs(op.amount)), count: ltr(formatNumber(op.count)) })}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex max-w-3xl flex-col gap-2">
                <h2 className="text-base font-semibold text-text">{t('pos.ai.alerts.lowStock')}</h2>
                {alerts.lowStock.length === 0 ? (
                  <p className="text-base text-muted">{t('pos.ai.alerts.lowStockNone')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                    {alerts.lowStock.map((item, index) => (
                      <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <span className="text-base text-text [overflow-wrap:anywhere]" dir="auto">
                          {item.name}
                        </span>
                        <span className="flex items-center gap-2 text-sm text-muted">
                          {quantityLabel(t, item.onHand, item.unit as StockUnitKey)}
                          <StockState t={t} state={item.state as 'negative' | 'low' | 'ok'} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
