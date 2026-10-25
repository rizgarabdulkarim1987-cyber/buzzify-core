import type { Metadata } from 'next';
import { formatNumber, ltr } from '@/lib/pos-format';
import { SUMMARY_KINDS } from '@/server/ai/summary';
import { query } from '@/server/studio/framework/invoke';
import { posAiSummary } from '@/server/studio/queries/pos-ai';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { SectionTabs, moneyLabel } from '@/app/pos/_ui/stock/view';
import { SummaryPanel } from '@/app/pos/_ui/ai/SummaryPanel';
import { AiOff } from '@/app/pos/_ui/ai/view';
import { aiPage } from '../guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.ai.summary.title') };
}

/**
 * A finished period in figures, each next to the period before, and a short text the AI writes from those figures only.
 * The figures come first and need no request; the text is one request, kept for the same figures.
 */
export default async function AiSummaryPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const [{ kind: asked }, { actor, t, off, tabs, mayOpenPackage }] = await Promise.all([searchParams, aiPage('summary')]);
  const kind = SUMMARY_KINDS.find((k) => k === asked) ?? 'DAILY';
  const result = off ? null : await query(posAiSummary, { kind, locale: actor.locale });
  const summary = result && result.ok ? result.summary : null;
  const facts = summary?.facts;
  const stats = facts
    ? [
        { key: 'sales', value: facts.totals.grossSales, before: facts.previous.grossSales },
        { key: 'net', value: facts.totals.netSales, before: facts.previous.netSales },
        { key: 'refunds', value: facts.totals.refundsTotal, before: null },
        { key: 'purchases', value: facts.totals.purchasesTotal, before: facts.previous.purchasesTotal },
      ]
    : [];
  return (
    <>
      <PageHeader title={t('pos.ai.summary.title')} description={t('pos.ai.summary.intro')} />
      <SectionTabs label={t('pos.ai.tabs')} current="summary" items={tabs} />
      {off ? (
        <AiOff t={t} showPackageLink={mayOpenPackage} />
      ) : (
        <div className="flex flex-col gap-5 pb-8">
          <SectionTabs label={t('pos.ai.summary.kinds')} current={kind} items={SUMMARY_KINDS.map((k) => ({ key: k, href: `/pos/ai/summary?kind=${k}`, label: t(`pos.ai.summary.kind.${k}`) }))} />
          <div className="flex flex-col gap-5 px-8">
            {result && !result.ok ? (
              <p role="alert" className="text-base text-danger">
                {t(`pos.ai.error.${result.code}`)}
              </p>
            ) : null}
            {facts && summary ? (
              <>
                <p className="text-base text-muted" dir="auto">
                  {ltr(t('pos.ai.summary.period', { from: facts.period.from, to: facts.period.to }))}
                </p>
                {facts.totals.grossSales === 0 && facts.totals.purchasesTotal === 0 ? <p className="text-base text-muted">{t('pos.ai.summary.noSales')}</p> : null}
                <dl className="grid max-w-3xl gap-3 sm:grid-cols-2">
                  {stats.map((stat) => (
                    <div key={stat.key} className="flex flex-col gap-0.5 rounded-lg border border-line px-4 py-3">
                      <dt className="text-sm text-muted">{t(`pos.ai.summary.${stat.key}`)}</dt>
                      <dd className="text-lg font-semibold text-text">{moneyLabel(t, stat.value)}</dd>
                      {stat.before !== null ? <dd className="text-sm text-muted">{t('pos.ai.summary.before', { value: moneyLabel(t, stat.before) })}</dd> : null}
                    </div>
                  ))}
                  <div className="flex flex-col gap-0.5 rounded-lg border border-line px-4 py-3">
                    <dt className="text-sm text-muted">{t('pos.ai.summary.lowStock')}</dt>
                    <dd className="text-lg font-semibold text-text">{ltr(formatNumber(facts.lowStockCount))}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-lg border border-line px-4 py-3">
                    <dt className="text-sm text-muted">{t('pos.ai.summary.newComplaints')}</dt>
                    <dd className="text-lg font-semibold text-text">{ltr(formatNumber(facts.newComplaints))}</dd>
                  </div>
                </dl>
                {facts.topProducts.length > 0 ? (
                  <div className="flex max-w-3xl flex-col gap-2">
                    <h2 className="text-base font-semibold text-text">{t('pos.ai.summary.top')}</h2>
                    <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
                      {facts.topProducts.map((product, index) => (
                        <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                          <span className="text-base text-text [overflow-wrap:anywhere]" dir="auto">
                            {product.name}
                          </span>
                          <span className="text-sm text-muted">{moneyLabel(t, product.sales)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <SummaryPanel key={`${kind}-${summary.text ?? ''}`} kind={kind} locale={actor.locale} text={summary.text} />
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
