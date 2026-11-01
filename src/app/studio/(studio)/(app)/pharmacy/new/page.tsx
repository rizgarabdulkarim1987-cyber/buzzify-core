import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { query, SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import type { PlanTier } from '@/server/domain/entitlements';
import { getPlans } from '@/server/studio/queries/plans';
import { newRestaurantAccess } from '@/server/studio/queries/restaurants';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CreateRestaurantForm } from '../../restaurants/RestaurantForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacies.new') };
}

/** A new pharmacy: the create form fixed on the Pharmacy sector, with the way back to the Pharmacy list. */
export default async function NewPharmacyPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  await query(newRestaurantAccess, {});
  const t = getStudioTranslator(actor.locale);
  const planNames = actor.isPlatformOwner
    ? (Object.fromEntries(Object.entries((await query(getPlans, {})).plans).map(([tier, plan]) => [tier, plan.names[actor.locale]])) as Record<
        PlanTier,
        string
      >)
    : null;

  return (
    <>
      <PageHeader
        above={
          <Link href="/studio/pharmacy" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('pharmacies.title')}
          </Link>
        }
        title={t('pharmacies.new')}
        description={t('pharmacies.newDescription')}
      />
      <div className="px-8 pb-2">
        <CreateRestaurantForm planNames={planNames} initialSector="PHARMACY" space="pharmacy" />
      </div>
    </>
  );
}
