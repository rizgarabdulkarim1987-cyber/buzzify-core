import { History, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DoctorPanel } from '@/app/pharmacy/_ui/DoctorPanel';
import { doctorAddMode, type DoctorHistoryItem } from '@/app/pharmacy/_ui/doctor-logic';
import { phDateTime } from '@/app/pharmacy/_ui/ph-date';
import { getPhAccess } from '@/server/pharmacy/actor';
import { doctorEnabledThisRequest } from '@/server/pharmacy/doctor/nav';
import { history } from '@/server/pharmacy/queries/doctor-history';
import { query } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.doctor.title') };
}

const OUTCOME_LOOK: Record<DoctorHistoryItem['outcome'], string> = {
  ANSWERED: 'bg-ph-g1 text-ph-g8',
  REFUSED: 'bg-ph-red-wash text-ph-red',
  FAILED: 'bg-ph-canvas text-ph-muted',
};

/**
 * The AI Doctor's full page: the question and answer on one side, the earlier questions on the other (the person's own; the
 * owner's are the pharmacy's), each by its stored text and outcome only. A person without access gets a 404, before anything is
 * read (the action refuses them too). Asking needs one branch (stock is a branch's): on "All branches" the page says so. The
 * frame never scrolls on a desktop; each column scrolls inside itself.
 */
export default async function DoctorPage() {
  const [{ actor, place }, locale] = await Promise.all([getPhAccess(), requestStudioLocale()]);
  if (!actor || !place || !(await doctorEnabledThisRequest(actor))) notFound();
  const t = getStudioTranslator(locale);
  const placeInput = place.branchId ? { restaurantId: place.restaurantId, branchId: place.branchId } : { restaurantId: place.restaurantId };
  const { items } = (await query(history, placeInput)) as { items: DoctorHistoryItem[] };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-4 py-5 md:px-[22px] lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex flex-col lg:col-span-2">
        <h1 className="text-[26px] font-bold leading-8 tracking-tight">{t('pharmacy.doctor.title')}</h1>
        <p className="text-sm text-ph-muted">{t('pharmacy.doctor.tagline')}</p>
      </div>
      <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
        {place.branchId ? (
          <DoctorPanel branchId={place.branchId} addMode={doctorAddMode(actor.role)} header={false} />
        ) : (
          <p data-testid="doctor-pick-branch" className="flex items-start gap-2.5 rounded-[22px] bg-ph-card p-4 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
            <MapPin aria-hidden className="text-ph-muted" />
            {t('pharmacy.doctor.pickBranch')}
          </p>
        )}
      </div>
      <section data-testid="doctor-history" aria-labelledby="doctor-history-title" className="flex min-w-0 flex-col rounded-[22px] bg-ph-card p-4 lg:min-h-0">
        <h2 id="doctor-history-title" className="mb-1 flex items-center gap-2 text-base font-bold">
          <History aria-hidden className="size-5 text-ph-g6" />
          {t(actor.role === 'OWNER' ? 'pharmacy.doctor.history.titleAll' : 'pharmacy.doctor.history.title')}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-ph-muted">{t('pharmacy.doctor.history.empty')}</p>
        ) : (
          <ul className="flex min-h-0 flex-col divide-y divide-ph-line lg:overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} data-testid="doctor-history-item" className="flex min-h-12 flex-col gap-0.5 py-2">
                <span className="break-words font-semibold" dir="auto">
                  {item.questionText ?? t('pharmacy.doctor.history.photo')}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ph-muted">
                  <span>{t(`pharmacy.doctor.history.mode.${item.mode}`)}</span>
                  <span className="tabular-nums" dir="ltr">
                    {phDateTime(new Date(item.createdAt).toISOString(), locale)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${OUTCOME_LOOK[item.outcome]}`}>{t(`pharmacy.doctor.history.outcome.${item.outcome}`)}</span>
                  {actor.role === 'OWNER' && !item.mine ? <span>{t('pharmacy.doctor.history.byStaff')}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
