import { ArrowLeft, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../catalog/access';

/**
 * Who is on a purchasing screen. A role without `purchase.manage` (and a support actor) gets the blocked state and no data
 * is fetched: the page returns `blocked` before any query. `writable` is whether the pharmacy is open for writing and the
 * role may buy; read-only pharmacies see the data with the controls missing and the reason in words.
 */
export async function purchasingGate(titleKey: string, backTo?: { href: string; labelKey: string }) {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const back = backTo ? (
    <Link href={backTo.href} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t(backTo.labelKey)}
    </Link>
  ) : undefined;
  const mayBuy = roleMay(access.actor, 'purchase.manage');
  let blocked: ReactNode = null;
  if (!mayBuy) {
    blocked = (
      <>
        <PageHeader className="max-sm:px-4" title={t(titleKey)} above={back} />
        <div data-testid="purchasing-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState
            icon={<Lock />}
            title={t('pharmacy.purchasing.forbidden.title')}
            body={t(access.actor.role === null ? 'pharmacy.purchasing.forbidden.support' : 'pharmacy.purchasing.forbidden.role')}
          />
        </div>
      </>
    );
  }
  const writable = access.writable('purchase.manage');
  return { access, locale, t, back, blocked, writable, writeNotice: !writable.ok && mayBuy ? <ReceiveBlocked reason={writable.reason} t={t} /> : null };
}
