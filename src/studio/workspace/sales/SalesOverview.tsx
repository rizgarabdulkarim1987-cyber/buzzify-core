'use client';

import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import type { AdviceCode } from '@/server/domain/advisor';
import type { DishClass } from '@/server/domain/engineering';
import type { SalesOverview as Overview } from '@/server/studio/services/insights';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { cx } from '@/studio/ui/cx';
import { StatusBadge } from '@/studio/ui/StatusBadge';
import { formatMoney } from '../content/shared';
import { PageIntro, useNamer } from './shared';

type View = Overview & { upgrade: UpgradeInfo };

/** Where each piece of advice is fixed, under the menu's workspace. */
const FIX_PATH: Record<AdviceCode, string> = {
  NO_PHOTO: '',
  NO_DESCRIPTION: '',
  NO_COST: '',
  LONG_CATEGORY: '',
  VEGETARIAN_SECTION: '',
  TWO_SIZES: '',
  NO_RULES: '/sales/upgrades',
  SET_NOT_A_DEAL: '/sales/sets',
  NO_SIGNATURE: '',
};

/** Fewer guest sessions than this, and the classes are a first look rather than a verdict. */
const ENOUGH_SESSIONS = 30;
const NAMES_SHOWN = 4;

/**
 * The Sales tab's Overview: what to fix next (the advisor), which dishes are stars, workhorses, puzzles and dogs from
 * real guest data, and how often guests take each kind of suggestion.
 */
export function SalesOverview({ menuId, view }: { menuId: string; view: View }) {
  const { currency, defaultLocale } = view;
  const t = useT();
  const { locale } = useLocale();
  const name = useNamer(defaultLocale);
  const number = numberFormat(locale);
  const percent = numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const base = `/studio/menus/${menuId}`;
  const dishName = new Map(view.dishes.map((dish) => [dish.productId, name(dish.names)]));

  const listed = (ids: string[], lookup: (id: string) => string) => {
    const names = ids.slice(0, NAMES_SHOWN).map(lookup).filter(Boolean);
    return ids.length > NAMES_SHOWN ? t('sales.overview.andMore', { names: names.join(', '), count: number.format(ids.length - NAMES_SHOWN) }) : names.join(', ');
  };

  return (
    <div className="flex flex-col gap-8">
      <PageIntro title={t('sales.overview.title')} body={t('sales.overview.intro')} />

      <section aria-labelledby="sales-advice" className="flex flex-col gap-3">
        <h3 id="sales-advice" className="text-md font-semibold text-text">
          {t('sales.overview.advice')}
        </h3>
        {view.advice.length === 0 ? (
          <p className="inline-flex items-center gap-2 text-sm text-success">
            <CheckCircle2 aria-hidden className="size-4" />
            {t('sales.overview.adviceNone')}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
            {view.advice.map((advice) => {
              const about = [
                advice.productIds.length > 0 ? listed(advice.productIds, (id) => dishName.get(id) ?? '') : '',
                advice.categoryIds.length > 0 ? t('sales.overview.categoryCount', { count: number.format(advice.categoryIds.length) }) : '',
                advice.bundleIds.length > 0 ? t('sales.overview.setCount', { count: number.format(advice.bundleIds.length) }) : '',
              ].filter(Boolean);
              return (
                <li key={advice.code} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 px-4 py-3">
                  <div className="flex min-w-0 max-w-[65ch] flex-col gap-0.5">
                    <span className="text-base font-medium text-text">{t(`sales.advice.${advice.code}`)}</span>
                    <span className="text-sm text-muted">{t(`sales.advice.${advice.code}.why`)}</span>
                    {about.length > 0 && <span className="text-sm text-text">{about.join(' · ')}</span>}
                  </div>
                  <Link href={`${base}${FIX_PATH[advice.code]}`} className="shrink-0 text-sm font-medium text-text underline underline-offset-4 hover:text-muted">
                    {t('sales.overview.fix')}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="sales-dishes" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="sales-dishes" className="text-md font-semibold text-text">
            {t('sales.overview.dishes')}
          </h3>
          <p className="max-w-[65ch] text-sm text-muted">{t('sales.overview.dishesIntro')}</p>
        </div>
        {!view.insightsAllowed ? (
          <Alert tone="neutral">
            <div className="flex flex-col gap-2">
              <span>{t('sales.overview.locked')}</span>
              <UpgradeHint feature="selling.insights" info={view.upgrade} />
            </div>
          </Alert>
        ) : (
          <>
            {view.totalSessions < ENOUGH_SESSIONS && <Alert tone="neutral">{t('sales.overview.littleData', { count: number.format(view.totalSessions) })}</Alert>}
            <div className="overflow-x-auto rounded-lg border border-line bg-raised">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-line text-start text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start font-medium">{t('sales.overview.dish')}</th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">{t('sales.overview.class')}</th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">{t('sales.overview.guests')}</th>
                    <th scope="col" className="px-4 py-2 text-end font-medium">{t('sales.overview.margin')}</th>
                    <th scope="col" className="px-4 py-2 text-start font-medium">{t('sales.overview.next')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {view.dishes.map((dish) => (
                    <tr key={dish.productId}>
                      <th scope="row" className="px-4 py-2.5 text-start font-medium text-text">
                        {name(dish.names)}
                      </th>
                      <td className="px-4 py-2.5">
                        <StatusBadge tone={classTone(dish.dishClass)}>{t(`sales.class.${dish.dishClass}`)}</StatusBadge>
                      </td>
                      <td className="px-4 py-2.5 text-end tabular-nums text-text">{number.format(dish.sessions)}</td>
                      <td className="px-4 py-2.5 text-end tabular-nums text-text">{dish.margin === null ? '—' : formatMoney(dish.margin, currency, locale)}</td>
                      <td className="max-w-[28ch] px-4 py-2.5 text-muted">{t(`sales.class.${dish.dishClass}.next`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {view.insightsAllowed && (
        <section aria-labelledby="sales-suggestions" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id="sales-suggestions" className="text-md font-semibold text-text">
              {t('sales.overview.suggestions')}
            </h3>
            <p className="max-w-[65ch] text-sm text-muted">{t('sales.overview.suggestionsIntro')}</p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
            {view.suggestions.map((row) => (
              <div key={row.kind} className="flex flex-col gap-1 bg-raised px-4 py-3">
                <dt className="text-sm text-muted">{t(`sales.suggestion.${row.kind}`)}</dt>
                <dd className={cx('text-lg font-semibold tabular-nums', row.shown === 0 ? 'text-muted' : 'text-text')}>
                  {row.shown === 0 ? '—' : percent.format(row.accepted / row.shown)}
                </dd>
                <dd className="text-xs text-muted">{t('sales.overview.took', { accepted: number.format(row.accepted), shown: number.format(row.shown) })}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function classTone(dishClass: DishClass): 'success' | 'neutral' | 'danger' | 'ink' {
  if (dishClass === 'STAR') return 'success';
  if (dishClass === 'DOG') return 'danger';
  if (dishClass === 'PUZZLE') return 'ink';
  return 'neutral';
}
