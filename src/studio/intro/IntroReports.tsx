'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { introCsv } from '@/server/domain/intro-report';
import { useT } from '@/studio/i18n';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';

interface Counts {
  views: number;
  clicks: number;
  rate: number;
}

export interface IntroReportView {
  from: string;
  to: string;
  totals: Counts;
  adverts: Array<Counts & { advertId: string; label: string; removed: boolean }>;
  restaurants: Array<Counts & { restaurantId: string; name: string }>;
  menus: Array<Counts & { menuId: string; name: string; restaurant: string }>;
  days: Array<{ day: string; views: number; clicks: number }>;
}

const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

/** Saves rows as a CSV file made in the browser from what is already on the page; nothing more is asked of the server. */
function download(name: string, rows: ReadonlyArray<{ label: string; views: number; clicks: number }>) {
  const blob = new Blob(['﻿', introCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Table({ title, name, head, rows, csv }: { title: string; name: string; head: string; rows: Array<{ key: string; label: ReactNode; views: number; clicks: number; rate: number }>; csv: Array<{ label: string; views: number; clicks: number }> }) {
  const t = useT();
  return (
    <section aria-label={title} className="flex flex-col gap-3 border-t border-line py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-md font-semibold text-text">{title}</h2>
        {rows.length > 0 && (
          <Button size="sm" onClick={() => download(name, csv)}>
            <Download aria-hidden />
            {t('introReports.export')}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('introReports.none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-line text-start text-muted">
                <th scope="col" className="py-2 pe-4 text-start font-medium">
                  {head}
                </th>
                <th scope="col" className="px-4 py-2 text-end font-medium">
                  {t('introReports.views')}
                </th>
                <th scope="col" className="px-4 py-2 text-end font-medium">
                  {t('introReports.clicks')}
                </th>
                <th scope="col" className="py-2 ps-4 text-end font-medium">
                  {t('introReports.rate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-b-0">
                  <td className="max-w-[18rem] truncate py-2 pe-4 text-text">{row.label}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{row.views.toLocaleString()}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{row.clicks.toLocaleString()}</td>
                  <td className="py-2 ps-4 text-end tabular-nums">{percent(row.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The Super Admin's report on the intro adverts: totals, then each advert, restaurant, menu and day, for the days chosen. */
export function IntroReports({ report, error }: { report: IntroReportView | null; error: string | null }) {
  const t = useT();
  const from = report?.from ?? '';
  const to = report?.to ?? '';
  return (
    <div className="flex max-w-6xl flex-col px-8 pb-10 pt-6">
      <p className="max-w-[65ch] pb-4 text-sm text-muted">{t('introReports.intro')}</p>
      <form method="get" className="flex flex-wrap items-end gap-4 pb-4">
        <Field label={t('introReports.from')}>
          <Input type="date" name="from" defaultValue={from} required />
        </Field>
        <Field label={t('introReports.to')}>
          <Input type="date" name="to" defaultValue={to} required />
        </Field>
        <Button type="submit" variant="primary">
          {t('introReports.show')}
        </Button>
        <Link href="/studio/platform/intro" className={buttonClasses('ghost', 'md')}>
          {t('introReports.back')}
        </Link>
      </form>
      {error && (
        <p role="alert" className="pb-4 text-sm text-danger">
          {error}
        </p>
      )}
      {report && (
        <>
          <dl className="grid grid-cols-3 gap-4 pb-4">
            {([
              [t('introReports.views'), report.totals.views.toLocaleString()],
              [t('introReports.clicks'), report.totals.clicks.toLocaleString()],
              [t('introReports.rate'), percent(report.totals.rate)],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-md border border-line p-4">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums text-text">{value}</dd>
              </div>
            ))}
          </dl>
          <Table
            title={t('introReports.adverts')}
            name={`intro-adverts-${from}_${to}.csv`}
            head={t('introReports.advert')}
            rows={report.adverts.map((row) => ({ ...row, key: row.advertId, label: row.removed ? t('introReports.removed') : row.label }))}
            csv={report.adverts.map((row) => ({ label: row.removed ? t('introReports.removed') : row.label, views: row.views, clicks: row.clicks }))}
          />
          <Table
            title={t('introReports.restaurants')}
            name={`intro-restaurants-${from}_${to}.csv`}
            head={t('introReports.restaurant')}
            rows={report.restaurants.map((row) => ({ key: row.restaurantId, label: row.name, ...row }))}
            csv={report.restaurants.map((row) => ({ label: row.name, views: row.views, clicks: row.clicks }))}
          />
          <Table
            title={t('introReports.menus')}
            name={`intro-menus-${from}_${to}.csv`}
            head={t('introReports.menu')}
            rows={report.menus.map((row) => ({ key: row.menuId, label: `${row.name} · ${row.restaurant}`, ...row }))}
            csv={report.menus.map((row) => ({ label: `${row.name} · ${row.restaurant}`, views: row.views, clicks: row.clicks }))}
          />
          <Table
            title={t('introReports.days')}
            name={`intro-days-${from}_${to}.csv`}
            head={t('introReports.day')}
            rows={report.days.map((row) => ({ key: row.day, label: row.day, ...row, rate: row.views > 0 ? row.clicks / row.views : 0 }))}
            csv={report.days.map((row) => ({ label: row.day, views: row.views, clicks: row.clicks }))}
          />
        </>
      )}
    </div>
  );
}
