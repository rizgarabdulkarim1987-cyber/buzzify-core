import { ChevronRight, Info, Languages, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { phGate } from '@/app/pharmacy/_ui/ph-gate';
import { Note } from '@/app/pharmacy/_ui/sell-parts';
import type { RxReviewItem } from '@/server/pharmacy/staff-doctor';
import { rxReview } from '@/server/pharmacy/queries/rx-review';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { roleMay } from '../../catalog/access';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.doctorReview.title') };
}

/**
 * The prescription-only check before the AI Doctor is switched on (plan Task 9): the OTC products that name a prescription-only
 * ingredient, each linked to its product form, where its prescription level is corrected. For the owner and a branch manager
 * (`staff.manage` and `catalog.manage`); anyone else gets a 404 before anything is read. The note about Kurdish answers is the
 * app's own fixed line.
 */
export default async function DoctorReviewPage() {
  const g = await phGate({ permission: 'staff.manage', titleKey: 'pharmacy.doctorReview.title', backTo: { href: '/pharmacy/settings', labelKey: 'pharmacy.staffDoctor.back' }, testid: 'review-forbidden', messages: 'pharmacy.settings' });
  if (!g.may || !roleMay(g.access.actor, 'catalog.manage')) notFound();
  const { access, t, back } = g;
  const { items, truncated } = (await query(rxReview, access.placeInput)) as { items: RxReviewItem[]; truncated: boolean };
  return (
    <>
      <PageHeader className="max-sm:px-4" title={t('pharmacy.doctorReview.title')} description={t('pharmacy.doctorReview.intro')} above={back} />
      <div className="flex min-w-0 max-w-3xl flex-col gap-4 px-4 pb-10 sm:px-8">
        <Note look="ph" icon={<Languages aria-hidden />} tone="info" testId="review-kurdish-note">
          {t('pharmacy.doctorReview.kurdishNote')}
        </Note>
        {truncated && (
          <Note look="ph" icon={<Info aria-hidden />} tone="info" testId="review-truncated">
            {t('pharmacy.doctorReview.truncated')}
          </Note>
        )}
        {items.length === 0 ? (
          <p data-testid="review-empty" className="flex items-start gap-2.5 rounded-[22px] bg-ph-card p-4 text-sm text-ph-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
            <ShieldCheck aria-hidden className="text-ph-g6" />
            {t('pharmacy.doctorReview.empty')}
          </p>
        ) : (
          <section aria-labelledby="review-list-title" className="flex min-w-0 flex-col rounded-[22px] bg-ph-card px-4 py-2">
            <h2 id="review-list-title" className="py-2 text-base font-bold text-ph-text">
              {t('pharmacy.doctorReview.count', { n: String(items.length) })}
            </h2>
            <ul className="flex min-w-0 flex-col divide-y divide-ph-line">
              {items.map((item) => (
                <li key={item.productId} data-testid="review-item" data-product-id={item.productId}>
                  <Link href={`/pharmacy/catalog/${item.productId}`} className="flex min-h-12 min-w-0 items-center gap-3 py-2 hover:bg-ph-canvas">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="break-words font-semibold text-ph-text" dir="auto">
                        {item.tradeName}
                        {item.strength ? <span className="font-normal text-ph-muted"> {item.strength}</span> : null}
                      </span>
                      <span className="break-words text-sm text-ph-muted" dir="auto">
                        {[item.genericName, item.activeIngredient].filter(Boolean).join(' · ')}
                      </span>
                      <span className="text-sm text-ph-red">
                        {t('pharmacy.doctorReview.matched', { term: item.matched })}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-ph-text underline underline-offset-2">
                      {t('pharmacy.doctorReview.open')}
                      <ChevronRight aria-hidden className="size-4 rtl:rotate-180" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
