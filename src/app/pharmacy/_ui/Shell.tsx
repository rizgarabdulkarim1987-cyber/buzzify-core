import { Pill, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { PhActor } from '@/server/pharmacy/actor';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';
import { BottomBar } from './BottomBar';
import { Rail } from './Rail';
import { SupportBanner } from './SupportBanner';
import { phNav, type PhNavItem, type PhNavKey, type PhShellLink } from './nav';

/** The places the phone's bottom bar holds; everything else goes in its "More" sheet. */
const BAR = new Set<PhNavKey>(['home', 'sell', 'stock', 'expiry']);

const RAIL_LINK = 'flex min-h-11 items-center gap-2 rounded-ph-xl px-2 text-sm font-medium text-ph-on-green underline underline-offset-2 hover:bg-ph-g9';
const SHEET_LINK = 'flex min-h-12 items-center gap-2 rounded-ph-xl px-3 text-base font-medium text-ph-text underline underline-offset-2 hover:bg-ph-card';

/**
 * The fixed frame of every pharmacy screen once a place is chosen. On a desktop (`md:` and up): the flat green rail at
 * the start side (the pharmacy and branch, the role's places, and the person with change branch, account and sign out at
 * its foot). On a phone: a slim top bar (pharmacy, branch, account), the page, and a bottom bar whose "More" opens a sheet
 * with the rest. The document never scrolls; `<main>` is the one scroll container. Nothing of the frame prints, and in
 * print the frame lets the page run to its full height. Server rendered apart from the parts that know the current
 * path; no motion (the pharmacy's document is marked `data-motion="none"`).
 */
export function Shell({
  actor,
  branchName,
  notice,
  t,
  counts,
  doctorEnabled = false,
  children,
}: {
  actor: PhActor;
  /** The chosen branch; null for "All branches". */
  branchName: string | null;
  /** A state notice above the page (read-only), if any. */
  notice?: ReactNode;
  t: Translate;
  /** The counters on Stock and Expiry; none drawn when absent. */
  counts?: { lowStock: number; expiring: number };
  /** Whether the AI Doctor is a place yet. */
  doctorEnabled?: boolean;
  children: ReactNode;
}) {
  const role = actor.role ? t(`pharmacy.role.${actor.role}`) : t('pharmacy.role.support');
  const where = branchName ?? t('pharmacy.branch.all');
  const nav = phNav(actor.role, { branchCount: actor.branchIds.length, doctorEnabled });
  const link = (item: PhNavItem): PhShellLink => ({
    key: item.key,
    href: item.href,
    label: t(item.labelKey),
    icon: item.icon,
    ...(item.badge && counts ? { count: counts[item.badge] } : {}),
  });
  const primary = nav.primary.map(link);
  const more = nav.more.map(link);
  const navLabel = t('pharmacy.nav.main');
  const moreLabel = t('pharmacy.nav.more');

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ph-canvas text-ph-text md:flex-row print:h-auto print:overflow-visible print:bg-transparent md:print:flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <header className="flex shrink-0 items-center gap-3 bg-ph-g9 px-4 py-2 text-ph-on-green md:w-[196px] md:flex-col md:items-stretch md:gap-1 md:overflow-y-auto md:px-3 md:py-[18px] print:hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none md:px-2 md:pb-[18px]">
          <span className="grid size-9 shrink-0 place-items-center rounded-ph-xl bg-ph-card text-ph-g8">
            <Pill aria-hidden size={20} />
          </span>
          <p className="flex min-w-0 flex-col">
            <span className="sr-only">{t('pharmacy.shell.label')}: </span>
            <span className="truncate text-base font-bold md:whitespace-normal md:break-words" dir="auto">
              {actor.restaurantName}
            </span>
            <span className="flex min-w-0 text-xs text-ph-on-green-muted">
              <span className="sr-only">{t('pharmacy.shell.where')}: </span>
              <span className="truncate md:whitespace-normal md:break-words" dir="auto">
                {where}
              </span>
            </span>
          </p>
        </div>
        <Link
          href="/studio/account"
          aria-label={t('pharmacy.shell.account')}
          className="grid size-11 shrink-0 place-items-center rounded-ph-xl text-ph-on-green hover:bg-ph-g8 md:hidden"
        >
          <UserRound aria-hidden size={22} />
        </Link>
        <Rail primary={primary} more={more} navLabel={navLabel} moreLabel={moreLabel} />
        <div className="hidden md:mt-auto md:flex md:flex-col md:gap-0.5 md:rounded-[14px] md:bg-ph-g8 md:p-2.5 md:text-ph-on-green">
          <span className="break-words px-2 pb-1 text-sm font-semibold" dir="auto">
            {actor.name} · {role}
          </span>
          <Link href="/pharmacy/select" className={RAIL_LINK}>
            {t('pharmacy.shell.changeBranch')}
          </Link>
          <Link href="/studio/account" className={RAIL_LINK}>
            {t('pharmacy.shell.account')}
          </Link>
          <SignOutButton className="inline-flex min-h-11 items-center gap-2 rounded-ph-xl px-2 text-sm font-semibold text-ph-on-green hover:bg-ph-g9 disabled:opacity-60" />
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col print:min-h-0">
        <SupportBanner support={actor.support} locale={actor.locale} />
        {notice ? <div className="shrink-0 print:hidden">{notice}</div> : null}
        {/* The one scroll container: in the tab order, so the keyboard can scroll a page that has nothing focusable (axe scrollable-region-focusable). */}
        <main id="main" tabIndex={0} className="relative flex min-h-0 min-w-0 flex-1 scroll-pb-24 flex-col overflow-y-auto focus-visible:-outline-offset-2 print:overflow-visible">
          {children}
        </main>
      </div>
      <BottomBar
        bar={primary.filter((l) => BAR.has(l.key))}
        sheet={[...primary.filter((l) => !BAR.has(l.key)), ...more]}
        navLabel={navLabel}
        moreLabel={moreLabel}
        closeLabel={t('pharmacy.nav.close')}
        account={
          <div className="flex flex-col gap-1">
            <span className="break-words px-3 pb-1 text-sm font-semibold text-ph-muted" dir="auto">
              {actor.name} · {role} · {where}
            </span>
            <Link href="/pharmacy/select" className={SHEET_LINK}>
              {t('pharmacy.shell.changeBranch')}
            </Link>
            <Link href="/studio/account" className={SHEET_LINK}>
              {t('pharmacy.shell.account')}
            </Link>
            <SignOutButton className="inline-flex min-h-12 items-center gap-2 rounded-ph-xl px-3 text-base font-semibold text-ph-text hover:bg-ph-card disabled:opacity-60" />
          </div>
        }
      />
    </div>
  );
}
