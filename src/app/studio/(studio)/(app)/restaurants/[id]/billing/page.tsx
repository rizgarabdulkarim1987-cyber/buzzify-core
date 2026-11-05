import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { billingOverview, restaurantBilling } from '@/server/studio/queries/billing';
import { getPlans } from '@/server/studio/queries/plans';
import { spaceOfSector } from '@/studio/space-words';
import { loadRestaurant, tabMetadata } from '../load';
import { RestaurantBilling } from './RestaurantBilling';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'billing');
}

/**
 * What the restaurant subscribes to and what it has paid (docs/superpowers/plans/2026-10-22-business-core-in-menu.md,
 * Task 5). Super Admins read it; the platform owner also starts trials, records payments, changes plans, cancels and
 * reactivates. Anyone else gets the not-found page (the queries need `platform.settings`).
 */
export default async function RestaurantBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await loadRestaurant(id);
  const [view, overview, plans] = await Promise.all([
    query(restaurantBilling, { restaurantId: restaurant.id }),
    // The prices of the business's own project's products (a retail shop's are Retail's, not the Menu's and the Cashier's).
    query(billingOverview, { space: spaceOfSector(restaurant.sector, restaurant.retailActivity) }),
    query(getPlans, {}),
  ]);
  const planNames = Object.fromEntries(Object.entries(plans.plans).map(([code, plan]) => [code, plan.names]));
  return (
    <div className="px-8 py-6">
      <RestaurantBilling view={view} products={overview.applications} planNames={planNames} />
    </div>
  );
}
