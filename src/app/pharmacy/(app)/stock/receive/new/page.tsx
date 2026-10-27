import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ReceiptEditor } from '@/app/pharmacy/_ui/ReceiptEditor';
import { ReceiveBlocked } from '@/app/pharmacy/_ui/ReceiveBlocked';
import { currencies } from '@/server/pharmacy/queries/prices';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.receive.newTitle') };
}

/**
 * A new receipt. Only a role that receives goods has this screen, in the one branch the person chose; the others get a
 * sentence saying why. The form keeps its draft on this device under "new" for this person, pharmacy and branch.
 */
export default async function NewReceiptPage() {
  const [access, locale] = await Promise.all([catalogAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const { actor, place } = access;
  const back = (
    <Link href="/pharmacy/stock/receive" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t('pharmacy.receive.back')}
    </Link>
  );
  const writable = access.writable('purchase.manage');
  if (!roleMay(actor, 'purchase.manage') || !writable.ok) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.newTitle')} above={back} />
        <div className="flex flex-col gap-4 px-4 pb-10 sm:px-8" data-testid="receive-forbidden">
          {!writable.ok && <ReceiveBlocked reason={writable.reason} t={t} />}
          <EmptyState icon={<Lock />} title={t('pharmacy.receive.forbidden.title')} body={t('pharmacy.receive.forbidden.role')} />
        </div>
      </>
    );
  }
  if (place.branchId === null) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.receive.newTitle')} above={back} />
        <div className="px-4 pb-10 sm:px-8">
          <p data-testid="receive-pick-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.receive.pickBranch')}</span>
          </p>
        </div>
      </>
    );
  }
  const currencyList = await query(currencies, access.placeInput);
  return (
    <ReceiptEditor
      userId={actor.userId}
      restaurantId={access.placeInput.restaurantId}
      branchId={place.branchId}
      branchName={place.branchName ?? ''}
      initial={null}
      receiptId={null}
      currencies={currencyList}
    />
  );
}
