'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { numberFormat } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { cx } from './cx';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** The query parameter that holds the page number. */
  param?: string;
}

const STEP =
  'inline-flex size-8 items-center justify-center rounded-md border border-line-strong bg-raised text-text transition-colors hover:bg-hover';

/**
 * "1–50 of 1,000", the page number, and links to the pages either side. The links keep the address's filters and sort
 * and change only the page. Arrows point the reading direction's way.
 */
export function Pagination({ page, pageSize, total, param = 'page' }: PaginationProps) {
  const t = useT();
  const { locale } = useLocale();
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const number = numberFormat(locale);

  const hrefFor = (target: number) => {
    const next = new URLSearchParams(params);
    if (target === 1) next.delete(param);
    else next.set(param, String(target));
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const step = (target: number, label: string, icon: ReactNode) =>
    target >= 1 && target <= pages ? (
      <Link href={hrefFor(target)} aria-label={label} title={label} className={STEP}>
        {icon}
      </Link>
    ) : (
      <span aria-hidden className={cx(STEP, 'pointer-events-none opacity-40')}>
        {icon}
      </span>
    );

  return (
    <nav aria-label={t('common.pagination')} className="flex items-center justify-between gap-4 text-sm text-muted">
      <p>{t('common.rangeOf', { from: number.format(from), to: number.format(to), total: number.format(total) })}</p>
      <div className="flex items-center gap-3">
        <span>{t('common.pageOf', { page: number.format(page), pages: number.format(pages) })}</span>
        <div className="flex gap-1">
          {step(page - 1, t('common.previousPage'), <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />)}
          {step(page + 1, t('common.nextPage'), <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />)}
        </div>
      </div>
    </nav>
  );
}
