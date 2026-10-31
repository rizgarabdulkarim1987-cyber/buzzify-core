import { CircleAlert, CircleCheck, Gauge, Info, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { formatNumber } from '@/lib/pos-format';
import { microUsdText, usagePercent, usageState, type UsageFigures } from './intake-logic';

const NOTE = 'flex items-start gap-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * This month's AI spending on invoice reading, for a role that may buy and see reports. Figures are text first (spent,
 * budget, remaining) with a bar as the second reading; the states "not in this plan", "pricing not configured" and
 * "budget used" are sentences with an icon. Static, no motion.
 */
export function IntakeUsage({ view, pricingSet, t }: { view: UsageFigures; pricingSet: boolean; t: Translate }) {
  const state = usageState(view, pricingSet);
  const used = state === 'ok' || state === 'used' ? (BigInt(view.spentMicroUsd ?? '0') + BigInt(view.reservedMicroUsd ?? '0')).toString() : '0';
  const percent = usagePercent(used, view.budgetMicroUsd ?? '0');
  let notice: ReactNode = null;
  if (state === 'notInPlan') {
    notice = (
      <p data-testid="usage-not-in-plan" className={NOTE}>
        <Lock aria-hidden className="text-muted" />
        <span className="min-w-0">{t('pharmacy.intake.usage.notInPlan')}</span>
      </p>
    );
  }
  if (state === 'noPricing') {
    notice = (
      <p data-testid="usage-no-pricing" className={NOTE}>
        <Info aria-hidden className="text-muted" />
        <span className="min-w-0">{t('pharmacy.intake.usage.noPricing')}</span>
      </p>
    );
  }
  if (state === 'used') {
    notice = (
      <p data-testid="usage-used" className={NOTE}>
        <CircleAlert aria-hidden className="text-danger" />
        <span className="min-w-0">{t('pharmacy.intake.usage.used')}</span>
      </p>
    );
  }
  const figure = (label: string, value: string, testId: string) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted">{label}</dt>
      <dd data-testid={testId} className="font-medium text-text tabular-nums">
        <bdi dir="ltr">{value}</bdi>
      </dd>
    </div>
  );
  return (
    <section data-testid="intake-usage" aria-labelledby="intake-usage-title" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <h2 id="intake-usage-title" className="flex items-center gap-2 text-sm font-medium text-muted [&_svg]:size-4 [&_svg]:shrink-0">
        <Gauge aria-hidden />
        {t('pharmacy.intake.usage.title')}
      </h2>
      {notice}
      {(state === 'ok' || state === 'used') && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {figure(t('pharmacy.intake.usage.month'), view.month, 'usage-month')}
            {figure(t('pharmacy.intake.usage.spent'), microUsdText(used), 'usage-spent')}
            {figure(t('pharmacy.intake.usage.budget'), microUsdText(view.budgetMicroUsd ?? '0'), 'usage-budget')}
            {figure(t('pharmacy.intake.usage.remaining'), microUsdText(view.remainingMicroUsd ?? '0'), 'usage-remaining')}
          </dl>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex items-center justify-between gap-2 text-sm text-text">
              <span className="text-muted">{t('pharmacy.intake.usage.percent')}</span>
              <span className="tabular-nums">
                <bdi dir="ltr">{percent}%</bdi>
              </span>
            </p>
            <div
              role="meter"
              aria-label={t('pharmacy.intake.usage.percent')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 w-full overflow-hidden rounded-sm border border-line-strong bg-surface"
            >
              <div className="h-full bg-ink" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </>
      )}
      {state === 'countsOnly' && <p className="text-sm text-muted">{t('pharmacy.intake.usage.countsOnly')}</p>}
      <p className="flex items-center gap-1.5 text-sm text-muted [&_svg]:size-4 [&_svg]:shrink-0">
        <CircleCheck aria-hidden />
        <span>
          {t('pharmacy.intake.usage.calls')}:{' '}
          <bdi dir="ltr" className="tabular-nums">
            {formatNumber(view.calls)}
          </bdi>
        </span>
      </p>
    </section>
  );
}
