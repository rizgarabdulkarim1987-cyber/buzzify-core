import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  FileText,
  History,
  Home,
  MapPin,
  Network,
  PackagePlus,
  Pill,
  Receipt,
  Settings,
  ShoppingCart,
  Sparkles,
  Tag,
  Timer,
  Truck,
  Undo2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import { canPh } from '@/server/domain/pharmacy/permissions';
import type { PhActor } from '@/server/pharmacy/actor';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';
import { NavLink } from './NavLink';
import { SupportBanner } from './SupportBanner';

const LINK = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-text hover:bg-hover';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
}

/** The links this person may use, in the order they are shown: the same permissions as before, listed once. */
function navItems(actor: PhActor, t: Translate): NavItem[] {
  const role = actor.role;
  const may = (permission: Parameters<typeof canPh>[1]) => role !== null && canPh(role, permission);
  const items: (NavItem | false)[] = [
    { href: '/pharmacy/home', label: t('pharmacy.nav.home'), icon: <Home aria-hidden /> },
    { href: '/pharmacy/catalog', label: t('pharmacy.nav.catalog'), icon: <Pill aria-hidden /> },
    may('shift.use') && { href: '/pharmacy/sell', label: t('pharmacy.nav.sell'), icon: <ShoppingCart aria-hidden /> },
    (may('shift.use') || may('report.view')) && { href: '/pharmacy/shifts', label: t('pharmacy.nav.shifts'), icon: <Timer aria-hidden /> },
    (may('shift.use') || may('report.view')) && { href: '/pharmacy/sales', label: t('pharmacy.nav.sales'), icon: <Receipt aria-hidden /> },
    (may('return.approve') || may('report.view')) && { href: '/pharmacy/returns', label: t('pharmacy.nav.returns'), icon: <Undo2 aria-hidden /> },
    may('rx.dispense') && { href: '/pharmacy/prescriptions', label: t('pharmacy.nav.prescriptions'), icon: <FileText aria-hidden /> },
    (may('customer.manage') || may('credit.sell')) && { href: '/pharmacy/customers', label: t('pharmacy.nav.customers'), icon: <Users aria-hidden /> },
    may('catalog.view') && { href: '/pharmacy/stock', label: t('pharmacy.nav.stock'), icon: <Boxes aria-hidden />, exact: true },
    may('catalog.view') && { href: '/pharmacy/stock/expiry', label: t('pharmacy.nav.expiry'), icon: <CalendarClock aria-hidden /> },
    may('stock.count') && { href: '/pharmacy/stock/counts', label: t('pharmacy.nav.counts'), icon: <ClipboardCheck aria-hidden /> },
    may('purchase.manage') && { href: '/pharmacy/stock/receive', label: t('pharmacy.nav.receiving'), icon: <PackagePlus aria-hidden /> },
    may('transfer.manage') && { href: '/pharmacy/stock/transfers', label: t('pharmacy.nav.transfers'), icon: <ArrowLeftRight aria-hidden /> },
    may('purchase.manage') && { href: '/pharmacy/purchasing', label: t('pharmacy.nav.purchasing'), icon: <Truck aria-hidden /> },
    may('report.view') && { href: '/pharmacy/stock/movements', label: t('pharmacy.nav.movements'), icon: <History aria-hidden /> },
    may('report.view') && { href: '/pharmacy/reports', label: t('pharmacy.nav.reports'), icon: <BarChart3 aria-hidden /> },
    may('catalog.view') && { href: '/pharmacy/assistant', label: t('pharmacy.nav.assistant'), icon: <Sparkles aria-hidden /> },
    may('catalog.view') && { href: '/pharmacy/print/labels', label: t('pharmacy.print.labels.title'), icon: <Tag aria-hidden /> },
    may('report.view') && actor.branchIds.length > 1 && { href: '/pharmacy/chain', label: t('pharmacy.nav.chain'), icon: <Network aria-hidden /> },
    (role === 'OWNER' || role === 'BRANCH_MANAGER') && { href: '/pharmacy/settings', label: t('pharmacy.nav.settings'), icon: <Settings aria-hidden /> },
  ];
  return items.filter((item): item is NavItem => item !== false);
}

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
  const items = navItems(actor, t);
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
            <span className="break-words text-lg font-semibold leading-tight text-text" dir="auto">
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
      <nav aria-label={t('pharmacy.nav.label')} className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 sm:flex-wrap sm:overflow-visible sm:px-6 print:hidden">
        {items.map((item) => (
          <NavLink key={item.href} href={item.href} icon={item.icon} exact={item.exact}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      {notice ? <div className="print:hidden">{notice}</div> : null}
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
