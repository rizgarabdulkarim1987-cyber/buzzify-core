import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { Alert } from '@/studio/ui/Alert';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RouteTabs, type RouteTab } from '@/studio/ui/RouteTabs';
import { RestaurantStatusBadge } from '../RestaurantStatusBadge';
import { SectorBadge } from '../SectorBadge';
import { loadRestaurant } from './load';
import { RestaurantActions } from './RestaurantActions';

/**
 * The frame of one restaurant: its name, client ID and status, what the person may do to it as a whole, and its tabs.
 * A tab the person may not use is not there (People needs the right to invite, Activity the right to see the log, Billing
 * a Super Admin).
 */
export async function BusinessLayout({
  children,
  params,
  space,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
  /** The space the page is in. A Super Admin keeps to it: its address base and list are its own. */
  space: 'food' | 'pharmacy';
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurant = await loadRestaurant(id);

  const base = space === 'pharmacy' ? `/studio/pharmacy/${restaurant.id}` : `/studio/restaurants/${restaurant.id}`;
  const listHref = space === 'pharmacy' ? '/studio/pharmacy' : '/studio/restaurants';
  const listLabel = space === 'pharmacy' ? t('pharmacies.title') : t('restaurants.title');
  // A pharmacy has no menus, menu plan or menu media library: those tabs are for food businesses only.
  const food = restaurant.sector === 'FOOD';
  const tabs: RouteTab[] = [
    { href: base, label: t('restaurants.tabs.profile'), exact: true },
    { href: `${base}/branches`, label: t('restaurants.tabs.branches') },
    ...(food ? [{ href: `${base}/menus`, label: t('restaurants.tabs.menus') }] : []),
    // What the restaurant has bought: everyone may read it; only the platform owner changes it there.
    ...(food ? [{ href: `${base}/plan`, label: t('restaurants.tabs.plan') }] : []),
    // Its subscriptions and payments: Super Admins read them; only the platform owner changes them there.
    ...(actor.isSuperAdmin ? [{ href: `${base}/billing`, label: t('restaurants.tabs.billing') }] : []),
    // What guests send through the menus' box: everyone of the restaurant reads it. A pharmacy has no menus, so no box.
    ...(food ? [{ href: `${base}/feedback`, label: t('restaurants.tabs.feedback') }] : []),
    ...(food && restaurant.can.media ? [{ href: `${base}/media`, label: t('restaurants.tabs.media') }] : []),
    ...(restaurant.can.invite ? [{ href: `${base}/people`, label: t('restaurants.tabs.people') }] : []),
    ...(restaurant.can.audit ? [{ href: `${base}/activity`, label: t('restaurants.tabs.activity') }] : []),
  ];

  return (
    <>
      <PageHeader
        above={
          // An owner has this one restaurant and no list to go back to.
          isOwnerOnly(actor) ? undefined : (
            <Link href={listHref} className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
              <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
              {listLabel}
            </Link>
          )
        }
        title={restaurant.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span dir="ltr" className="font-mono text-sm">
              {restaurant.clientId}
            </span>
            {food ? <span>{t(`restaurants.type.${restaurant.type}`)}</span> : <SectorBadge sector={restaurant.sector} t={t} />}
            {restaurant.city && <span>{restaurant.city}</span>}
            <RestaurantStatusBadge status={restaurant.status} t={t} />
          </span>
        }
        actions={
          <RestaurantActions
            restaurantId={restaurant.id}
            name={restaurant.name}
            status={restaurant.status}
            menuCount={restaurant.menuCount}
            canChangeStatus={restaurant.can.status}
            canDelete={restaurant.can.delete}
            listHref={listHref}
            {...(actor.isSuperAdmin ? { space } : {})}
          />
        }
        below={<RouteTabs tabs={tabs} label={t('restaurants.tabs.label')} />}
      />
      {restaurant.status !== 'ACTIVE' && (
        <div className="px-8 pt-5">
          <Alert tone="neutral">{t(`restaurants.notice.${restaurant.status}`)}</Alert>
        </div>
      )}
      {children}
    </>
  );
}
