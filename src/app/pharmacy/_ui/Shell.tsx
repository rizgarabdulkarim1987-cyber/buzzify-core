import { MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { canPh } from '@/server/domain/pharmacy/permissions';
import type { PhActor } from '@/server/pharmacy/actor';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';
import { SupportBanner } from './SupportBanner';

const LINK = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover';

/**
 * The frame of every pharmacy screen once a place is chosen: the support strip for a support actor, a header saying
 * where the person works (pharmacy and branch, with the way to change it) and who they are, then the page. Server
 * rendered, no motion (the pharmacy's document is marked `data-motion="none"`); it wraps on a phone and never scrolls
 * sideways.
 */
export function Shell({
  actor,
  branchName,
  notice,
  t,
  children,
}: {
  actor: PhActor;
  /** The chosen branch; null for "All branches". */
  branchName: string | null;
  /** A state notice under the header (read-only), if any. */
  notice?: ReactNode;
  t: Translate;
  children: ReactNode;
}) {
  const role = actor.role ? t(`pharmacy.role.${actor.role}`) : t('pharmacy.role.support');
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <SupportBanner support={actor.support} locale={actor.locale} />
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-4 py-2 sm:px-8 print:hidden">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex min-w-0 flex-col">
            <span className="text-xs font-medium text-muted">{t('pharmacy.shell.label')}</span>
            <span className="break-words text-base font-semibold text-text" dir="auto">
              {actor.restaurantName}
            </span>
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-text">
            <MapPin aria-hidden size={16} className="shrink-0 text-muted" />
            <span className="sr-only">{t('pharmacy.shell.where')}: </span>
            <span className="break-words" dir="auto">
              {branchName ?? t('pharmacy.branch.all')}
            </span>
          </p>
          <Link href="/pharmacy/select" className={LINK}>
            {t('pharmacy.shell.changeBranch')}
          </Link>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span dir="auto">
            {actor.name} · {role}
          </span>
          <Link href="/studio/account" className={LINK}>
            {t('pharmacy.shell.account')}
          </Link>
          <SignOutButton />
        </div>
      </header>
      <nav aria-label={t('pharmacy.nav.label')} className="flex flex-wrap items-center gap-x-2 border-b border-line px-2 sm:px-6 print:hidden">
        <Link href="/pharmacy/home" className={LINK}>
          {t('pharmacy.nav.home')}
        </Link>
        <Link href="/pharmacy/catalog" className={LINK}>
          {t('pharmacy.nav.catalog')}
        </Link>
        {actor.role !== null && canPh(actor.role, 'shift.use') && (
          <Link href="/pharmacy/sell" className={LINK}>
            {t('pharmacy.nav.sell')}
          </Link>
        )}
        {actor.role !== null && (canPh(actor.role, 'shift.use') || canPh(actor.role, 'report.view')) && (
          <Link href="/pharmacy/shifts" className={LINK}>
            {t('pharmacy.nav.shifts')}
          </Link>
        )}
        {actor.role !== null && (canPh(actor.role, 'shift.use') || canPh(actor.role, 'report.view')) && (
          <Link href="/pharmacy/sales" className={LINK}>
            {t('pharmacy.nav.sales')}
          </Link>
        )}
        {actor.role !== null && (canPh(actor.role, 'return.approve') || canPh(actor.role, 'report.view')) && (
          <Link href="/pharmacy/returns" className={LINK}>
            {t('pharmacy.nav.returns')}
          </Link>
        )}
        {actor.role !== null && canPh(actor.role, 'catalog.view') && (
          <Link href="/pharmacy/stock" className={LINK}>
            {t('pharmacy.nav.stock')}
          </Link>
        )}
        {actor.role !== null && canPh(actor.role, 'catalog.view') && (
          <Link href="/pharmacy/stock/expiry" className={LINK}>
            {t('pharmacy.nav.expiry')}
          </Link>
        )}
        {actor.role !== null && canPh(actor.role, 'stock.count') && (
          <Link href="/pharmacy/stock/counts" className={LINK}>
            {t('pharmacy.nav.counts')}
          </Link>
        )}
        {actor.role !== null && canPh(actor.role, 'purchase.manage') && (
          <Link href="/pharmacy/stock/receive" className={LINK}>
            {t('pharmacy.nav.receiving')}
          </Link>
        )}
        {actor.role !== null && canPh(actor.role, 'purchase.manage') && (
          <Link href="/pharmacy/purchasing" className={LINK}>
            {t('pharmacy.nav.purchasing')}
          </Link>
        )}
        {actor.role !== null && canPh(actor.role, 'report.view') && (
          <Link href="/pharmacy/stock/movements" className={LINK}>
            {t('pharmacy.nav.movements')}
          </Link>
        )}
      </nav>
      {notice}
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
