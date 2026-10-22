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
import { loadRestaurant } from './load';
import { RestaurantActions } from './RestaurantActions';

/**
 * The frame of one restaurant: its name, client ID and status, what the person may do to it as a whole, and its tabs.
 * A tab the person may not use is not there (People needs the right to invite, Activity the right to see the log, Billing
 * a Super Admin).
 */
export default async function RestaurantLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const t = getStudioTranslator(actor.locale);
  const restaurant = await loadRestaurant(id);

  const base = `/studio/restaurants/${restaurant.id}`;
  const tabs: RouteTab[] = [
    { href: base, label: t('restaurants.tabs.profile'), exact: true },
    { href: `${base}/branches`, label: t('restaurants.tabs.branches') },
    { href: `${base}/menus`, label: t('restaurants.tabs.menus') },
    // What the restaurant has bought: everyone may read it; only the platform owner changes it there.
    { href: `${base}/plan`, label: t('restaurants.tabs.plan') },
    // Its subscriptions and payments: Super Admins read them; only the platform owner changes them there.
    ...(actor.isSuperAdmin ? [{ href: `${base}/billing`, label: t('restaurants.tabs.billing') }] : []),
    ...(restaurant.can.media ? [{ href: `${base}/media`, label: t('restaurants.tabs.media') }] : []),
    ...(restaurant.can.invite ? [{ href: `${base}/people`, label: t('restaurants.tabs.people') }] : []),
    ...(restaurant.can.audit ? [{ href: `${base}/activity`, label: t('restaurants.tabs.activity') }] : []),
  ];

  return (
    <>
      <PageHeader
        above={
          // An owner has this one restaurant and no list to go back to.
          isOwnerOnly(actor) ? undefined : (
            <Link href="/studio/restaurants" className="inline-flex w-fit items-center gap-1 text-sm text-muted transition-colors hover:text-text">
              <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
              {t('restaurants.title')}
            </Link>
          )
        }
        title={restaurant.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span dir="ltr" className="font-mono text-sm">
              {restaurant.clientId}
            </span>
            <span>{t(`restaurants.type.${restaurant.type}`)}</span>
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
