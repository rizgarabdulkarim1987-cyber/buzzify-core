import { ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getPhBranches } from '@/server/pharmacy/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../catalog/access';

/**
 * Who is on a report screen. A role without `report.view` (and a support actor) gets the blocked state and NO data is fetched: the page
 * returns `blocked` before any query. Reports are reads, so a read-only pharmacy keeps them (and the exports) open: there is no
 * write gate here. `mayMargin` is profit.view AND cost.view, the two keys margin needs besides report.view.
 */
export async function reportsGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const back = backTo ? (
    <Link href={backTo.href} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t(backTo.labelKey)}
    </Link>
  ) : undefined;
  let blocked: ReactNode = null;
  if (!roleMay(access.actor, 'report.view')) {
    blocked = (
      <>
        <PageHeader className="max-sm:px-4" title={t(titleKey)} above={back} />
        <div data-testid="reports-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.reports.forbidden.title')} body={t(access.actor.role === null ? 'pharmacy.reports.forbidden.support' : 'pharmacy.reports.forbidden.role')} />
        </div>
      </>
    );
  }
  return {
    access,
    locale,
    t,
    back,
    blocked,
    mayMargin: roleMay(access.actor, 'profit.view') && roleMay(access.actor, 'cost.view'),
    mayTransfers: roleMay(access.actor, 'transfer.manage'),
    /** The branches the person works in, by id and name (after the gate: nothing is read for a blocked role). */
    branches: async () => {
      const all = await getPhBranches(access.actor.restaurantId);
      return all.filter((b) => access.actor.branchIds.includes(b.id));
    },
  };
}
