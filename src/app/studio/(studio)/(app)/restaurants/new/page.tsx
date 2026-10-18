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
import { CreateRestaurantForm } from '../RestaurantForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('restaurants.new') };
}

/** A new client. Only Super Admins create restaurants: everyone else gets the not-found page. */
export default async function NewRestaurantPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  await query(newRestaurantAccess, {});
  const t = getStudioTranslator(actor.locale);
  // The platform owner chooses the new restaurant's plan; it is the plans' names they need, in their language.
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
          <Link href="/studio/restaurants" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t('restaurants.title')}
          </Link>
        }
        title={t('restaurants.new')}
        description={t('restaurants.newDescription')}
      />
      <div className="px-8 pb-2">
        <CreateRestaurantForm planNames={planNames} />
      </div>
    </>
  );
}
