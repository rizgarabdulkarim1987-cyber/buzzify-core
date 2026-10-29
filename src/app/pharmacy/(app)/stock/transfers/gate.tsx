import { ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { getPhBranches } from '@/server/pharmacy/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../catalog/access';

/**
 * Who is on a transfer screen. A role without `transfer.manage` (and a support actor) gets the blocked state and no data is
 * fetched: the page returns `blocked` before any query. `writable` is whether the pharmacy is open for writing and the role
 * may move stock; a read-only pharmacy shows the data with the controls missing and the reason in words.
 */
export async function transfersGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const back = backTo ? (
    <Link href={backTo.href} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t(backTo.labelKey)}
    </Link>
  ) : undefined;
  const may = roleMay(access.actor, 'transfer.manage');
  let blocked: ReactNode = null;
  if (!may) {
    blocked = (
      <>
        <PageHeader className="max-sm:px-4" title={t(titleKey)} above={back} />
        <div data-testid="transfers-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.transfers.forbidden.title')} body={t(access.actor.role === null ? 'pharmacy.transfers.forbidden.support' : 'pharmacy.transfers.forbidden.role')} />
        </div>
      </>
    );
  }
  const writable = access.writable('transfer.manage');
  const reach = { allBranches: access.actor.allBranches, branchIds: access.actor.branchIds };
  return {
    access,
    locale,
    t,
    back,
    blocked,
    writable,
    reach,
    /** Every branch of the business by id (names only), fetched by the screens that need them after the gate. */
    branches: () => getPhBranches(access.actor.restaurantId),
    writeNotice: !writable.ok && may ? <ReceiveBlocked reason={writable.reason} t={t} /> : null,
  };
}
