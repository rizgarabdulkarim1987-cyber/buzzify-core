import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { businessPath, movedBusinessAddressOf, pharmacyAddressOf } from '@/studio/spaces';
import { BusinessLayout } from './BusinessLayout';
import { loadRestaurant } from './load';

/**
 * The frame of one restaurant in Menu and Cashier (see BusinessLayout). A Super Admin who opens a pharmacy or a retail
 * shop here (an old link, a bookmark) lands on the same page in the Pharmacy or Retail space; everyone else is never moved.
 */
export default async function RestaurantLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  const restaurant = await loadRestaurant((await params).id);
  if (actor.isSuperAdmin && restaurant.sector === 'PHARMACY') {
    const target = pharmacyAddressOf((await headers()).get(REQUEST_PATH_HEADER) ?? '', restaurant.id);
    redirect(target ?? `/studio/pharmacy/${restaurant.id}`);
  }
  if (actor.isSuperAdmin && restaurant.sector === 'RETAIL') {
    const target = movedBusinessAddressOf((await headers()).get(REQUEST_PATH_HEADER) ?? '', restaurant.id, 'RETAIL');
    redirect(target ?? businessPath('RETAIL', restaurant.id));
  }
  return (
    <BusinessLayout space="food" params={params}>
      {children}
    </BusinessLayout>
  );
}
