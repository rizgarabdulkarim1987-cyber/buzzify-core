import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { batchStateOf } from '@/app/pharmacy/_ui/intake-logic';
import { IntakeBatch } from '@/app/pharmacy/_ui/IntakeBatch';
import { BatchStatus } from '@/app/pharmacy/_ui/intake-parts';
import { peopleOf } from '@/app/pharmacy/_ui/people';
import { phDateTime } from '@/app/pharmacy/_ui/ph-date';
import { getPhPlaces } from '@/server/pharmacy/actor';
import { batchGet } from '@/server/pharmacy/queries/intake-review';
import { list as suppliers } from '@/server/pharmacy/queries/suppliers';
import type { ReviewData } from '@/app/pharmacy/_ui/intake-review-logic';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../../catalog/access';
import { purchasingGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.intake.batchTitle') };
}

/**
 * One batch of invoice pictures: its state, supplier and who started it, then the files with their state and what can be
 * done to each (read, try again, enter by hand), and the place where the lines to check will be shown. Only a role with
 * `purchase.manage` reaches the data; a role without `ai.use` sees it all with the AI controls disabled and why.
 */
export default async function IntakeBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, purchasingGate('pharmacy.intake.batchTitle', { href: '/pharmacy/purchasing/intake', labelKey: 'pharmacy.intake.back' })]);
  if (g.blocked) return g.blocked;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const { access, t, locale } = g;
  const data = await query(batchGet, { ...access.placeInput, batchId: id });
  const [people, places] = await Promise.all([peopleOf(access.placeInput, [data.batch.createdById]), getPhPlaces()]);
  const branches = places.find((p) => p.restaurantId === access.placeInput.restaurantId)?.branches ?? [];
  const branchName = branches.find((b) => b.id === data.batch.branchId)?.name ?? '';
  const branchOk = access.place.branchId === data.batch.branchId;
  const mayAi = roleMay(access.actor, 'ai.use');
  // The header's supplier picker only exists for someone who can edit an open batch.
  const supplierPage = mayAi && data.batch.status === 'OPEN' && g.writable.ok ? await query(suppliers, { ...access.placeInput, active: true }) : null;
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={t('pharmacy.intake.batchTitle')} />
      <div className="flex min-w-0 flex-col gap-5 px-4 pb-10 sm:px-8" data-testid="intake-view">
        {g.writeNotice}
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.receive.col.status')}</dt>
            <dd data-testid="intake-status">
              <BatchStatus status={data.batch.status} t={t} />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.intake.supplier')}</dt>
            <dd dir="auto" className="min-w-0 break-words text-text [overflow-wrap:anywhere]">
              {data.batch.supplierName ?? <span className="text-muted">{t('pharmacy.intake.noSupplier')}</span>}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.intake.created')}</dt>
            <dd className="min-w-0 text-text">
              <bdi dir="ltr">{phDateTime(data.batch.createdAt, locale)}</bdi>
              {' · '}
              <span dir="auto">{people[data.batch.createdById] ?? data.batch.createdById.slice(0, 8)}</span>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted">{t('pharmacy.intake.branch')}</dt>
            <dd dir="auto" className="min-w-0 break-words text-text [overflow-wrap:anywhere]">
              {branchName}
            </dd>
          </div>
        </dl>
        <IntakeBatch
          batchId={data.batch.id}
          initial={batchStateOf(data)}
          initialReview={data as unknown as ReviewData}
          mayAi={mayAi}
          writable={g.writable.ok}
          branchOk={branchOk}
          userId={access.actor.userId}
          restaurantId={access.placeInput.restaurantId}
          branchId={data.batch.branchId}
          suppliers={(supplierPage?.items ?? []).map((s) => ({ id: s.id, name: s.name }))}
        />
      </div>
    </>
  );
}
