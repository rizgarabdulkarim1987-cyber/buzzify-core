import { ArrowLeft, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CountBlocked } from '@/app/pharmacy/_ui/CountBlocked';
import { CountStatus } from '@/app/pharmacy/_ui/CountStatus';
import { CountWorkspace } from '@/app/pharmacy/_ui/CountWorkspace';
import { OfflineNotice } from '@/app/pharmacy/_ui/OfflineNotice';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { get } from '@/server/pharmacy/queries/counts';
import { categories } from '@/server/pharmacy/queries/products';
import { query } from '@/server/studio/framework/invoke';
import { formatDateTime } from '@/studio/format';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { catalogAccess, roleMay } from '../../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.counts.title') };
}

/**
 * One count: the counting sheet while it is open, the review once submitted, a read-only record after. Entering numbers,
 * submitting and cancelling need `stock.count`, approving needs `stock.adjust`, both in an open pharmacy and in the
 * branch the count belongs to; otherwise the page shows the same lines read only and says why in words.
 */
export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, access, locale, places] = await Promise.all([params, catalogAccess(), requestStudioLocale(), getPhPlaces()]);
  const t = getStudioTranslator(locale);
  const { actor } = access;
  const back = (
    <Link href="/pharmacy/stock/counts" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
      <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
      {t('pharmacy.counts.back')}
    </Link>
  );
  if (actor.role === null || !roleMay(actor, 'stock.count')) {
    return (
      <>
        <PageHeader className="max-sm:px-4" title={t('pharmacy.counts.title')} above={back} />
        <div data-testid="counts-forbidden" className="px-4 pb-10 sm:px-8">
          <EmptyState icon={<Lock />} title={t('pharmacy.counts.forbidden.title')} body={t(actor.role === null ? 'pharmacy.counts.forbidden.support' : 'pharmacy.counts.forbidden.role')} />
        </div>
      </>
    );
  }
  if (!/^[\w-]{1,64}$/.test(id)) notFound();

  const [count, categoryList] = await Promise.all([query(get, { ...access.placeInput, countId: id }), query(categories, access.placeInput)]);
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchName = branches.find((b) => b.id === count.branchId)?.name ?? '';
  const inBranch = access.place.branchId === count.branchId;
  const mayCount = access.writable('stock.count');
  const mayApprove = access.writable('stock.adjust');
  const value = count.scope === 'CATEGORY' ? (categoryList.find((c) => c.id === count.scopeValue)?.name ?? '') : count.scope === 'LOCATION' ? count.scopeValue : '';
  const scope = t(`pharmacy.counts.scope.${count.scope}`);
  const blocked = !mayCount.ok ? mayCount : !mayApprove.ok && count.status === 'SUBMITTED' ? mayApprove : null;

  return (
    <>
      <PageHeader
        className="max-sm:px-4"
        above={back}
        title={t('pharmacy.counts.detail.title', { scope: value ? t('pharmacy.counts.detail.scopeValue', { scope, value }) : scope })}
        description={[branchName ? t('pharmacy.counts.detail.branch', { branch: branchName }) : '', t('pharmacy.counts.detail.started', { time: formatDateTime(count.createdAt, locale) })].filter(Boolean).join(' · ')}
        actions={<CountStatus status={count.status} t={t} />}
      />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {blocked && !blocked.ok && <CountBlocked reason={blocked.reason} t={t} />}
        {!inBranch && (
          <p data-testid="count-wrong-branch" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
            <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">{t('pharmacy.counts.detail.wrongBranch', { branch: branchName })}</span>
          </p>
        )}
        <OfflineNotice />
        <CountWorkspace
          userId={actor.userId}
          restaurantId={access.placeInput.restaurantId}
          count={count}
          canCount={inBranch && mayCount.ok}
          canApprove={inBranch && mayApprove.ok}
        />
      </div>
    </>
  );
}
