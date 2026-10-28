import { ArrowLeft, Lock, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { EmptyState } from '@/studio/ui/EmptyState';

/** The sentence-and-icon screens every list page can end in: no right to see it, or no branch chosen. */
export function Forbidden({ t, scope, support }: { t: Translate; scope: 'shifts' | 'sales' | 'returns'; support: boolean }) {
  return (
    <div data-testid={`${scope}-forbidden`} className="px-4 py-8 sm:px-8">
      <EmptyState icon={<Lock />} title={t(`pharmacy.${scope}.forbidden.title`)} body={t(support ? 'pharmacy.sell.forbidden.support' : `pharmacy.${scope}.forbidden.role`)} />
    </div>
  );
}

export function PickBranch({ t, scope }: { t: Translate; scope: 'shifts' | 'sales' | 'returns' }) {
  return (
    <div data-testid={`${scope}-pick-branch`} className="px-4 py-8 sm:px-8">
      <EmptyState icon={<MapPin />} title={t('pharmacy.sell.pickBranch.title')} body={t('pharmacy.sell.pickBranch.body')} />
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {children}
    </Link>
  );
}

/** Next and first page links by cursor. */
export function Pager({ t, label, first, next }: { t: Translate; label: string; first: string | null; next: string | null }) {
  if (!first && !next) return null;
  const LINK = 'inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-raised px-4 text-sm font-medium text-text hover:bg-hover';
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {first && (
        <Link href={first} className={LINK}>
          {t('pharmacy.stock.first')}
        </Link>
      )}
      {next && (
        <Link href={next} rel="next" className={LINK} data-testid="page-next">
          {t('pharmacy.stock.next')}
        </Link>
      )}
    </nav>
  );
}
