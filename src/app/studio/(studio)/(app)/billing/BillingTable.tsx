'use client';

import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import { formatMoney } from '@/server/domain/billing/money';
import type { BillingRestaurants } from '@/studio/billing';
import { SUBSCRIPTION_TONE } from '@/studio/billing';
import { formatDate } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { DataTable } from '@/studio/ui/DataTable';
import { StatusBadge } from '@/studio/ui/StatusBadge';

type Row = BillingRestaurants['rows'][number];
type Names = { en: string; ar: string; ckb: string };

const iso = (date: Date | string) => (typeof date === 'string' ? date : date.toISOString());

/**
 * One row per restaurant: a column per product with its subscription's status, plan and the day it is paid until (or
 * its trial ends), then the last payment. A restaurant's name opens its Billing tab, where everything is done.
 */
export function BillingTable({
  rows,
  applications,
  planNames,
}: {
  rows: Row[];
  applications: BillingRestaurants['applications'];
  planNames: Record<string, Names>;
}) {
  const t = useT();
  const { locale } = useLocale();

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: t('billingList.restaurant'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link href={`/studio/restaurants/${row.original.id}/billing`} className="font-medium text-text underline-offset-2 hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      ...applications.map<ColumnDef<Row, unknown>>((app, index) => ({
        id: `product-${app.id}`,
        header: app.name[locale] || app.id,
        enableSorting: false,
        cell: ({ row }) => {
          const sub = row.original.products[index]?.subscription;
          if (!sub) return <StatusBadge>{t('billing.status.NONE')}</StatusBadge>;
          const plan = planNames[sub.planCode]?.[locale] || sub.planCode;
          return (
            <div className="flex flex-col items-start gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={SUBSCRIPTION_TONE[sub.status]}>{t(`billing.status.${sub.status}`)}</StatusBadge>
                <span className="text-text">{plan}</span>
              </div>
              <span className="whitespace-nowrap text-xs text-muted">
                {sub.trial ? t('billing.trialEnds') : t('billing.paidUntil')}{' '}
                <time dateTime={iso(sub.currentPeriodEnd)}>{formatDate(iso(sub.currentPeriodEnd), locale)}</time>
              </span>
            </div>
          );
        },
      })),
      {
        id: 'lastPayment',
        header: t('billingList.lastPayment'),
        enableSorting: false,
        cell: ({ row }) => {
          const payment = row.original.lastPayment;
          if (!payment) return <span className="text-muted">{t('billingList.noPayment')}</span>;
          return (
            <div className="flex flex-col items-start gap-1">
              <span className="whitespace-nowrap tabular-nums text-text">{formatMoney(payment.amountMinor, payment.currency, locale)}</span>
              <time dateTime={iso(payment.paidAt)} className="whitespace-nowrap text-xs text-muted">
                {formatDate(iso(payment.paidAt), locale)}
              </time>
            </div>
          );
        },
      },
    ],
    [t, locale, applications, planNames],
  );

  return <DataTable columns={columns} data={rows} getRowId={(row) => row.id} caption={t('billingList.description')} />;
}
