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
import { initialSectorOf } from '@/studio/sector-param';
import { businessPath } from '@/studio/spaces';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CreateRestaurantForm } from '../RestaurantForm';

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Params): Promise<Metadata> {
  const pharmacy = initialSectorOf(await searchParams) === 'PHARMACY';
  return { title: getStudioTranslator(await requestStudioLocale())(pharmacy ? 'pharmacies.new' : 'restaurants.new') };
}

/**
 * A new client. Only Super Admins create restaurants: everyone else gets the not-found page. `?sector=PHARMACY` (the
 * Pharmacy page's "New pharmacy") opens the same form on the Pharmacy sector, with the way back to the Pharmacy page.
 * A Super Admin works in closed spaces, so an old link naming another sector opens that space's own form instead.
 */
export default async function NewRestaurantPage({ searchParams }: Params) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  await query(newRestaurantAccess, {});
  const t = getStudioTranslator(actor.locale);
  const sector = initialSectorOf(await searchParams);
  if (actor.isSuperAdmin && sector !== 'FOOD') redirect(businessPath(sector, 'new'));
  const pharmacy = sector === 'PHARMACY';
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
          <Link
            href={pharmacy ? '/studio/pharmacies' : '/studio/restaurants'}
            className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text"
          >
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
            {t(pharmacy ? 'pharmacies.title' : 'restaurants.title')}
          </Link>
        }
        title={t(pharmacy ? 'pharmacies.new' : 'restaurants.new')}
        description={t(pharmacy ? 'pharmacies.newDescription' : 'restaurants.newDescription')}
      />
      <div className="px-8 pb-2">
        <CreateRestaurantForm planNames={planNames} initialSector={sector} {...(actor.isSuperAdmin ? { space: pharmacy ? ('pharmacy' as const) : ('food' as const) } : {})} />
      </div>
    </>
  );
}
