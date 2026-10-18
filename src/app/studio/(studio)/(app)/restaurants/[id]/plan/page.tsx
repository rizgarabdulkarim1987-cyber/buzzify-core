import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { restaurantPlan } from '@/server/studio/queries/plans';
import { loadRestaurant, tabMetadata } from '../load';
import { PlanEditor } from './PlanEditor';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'plan');
}

/**
 * What the restaurant has bought (spec: plans and entitlements, 8.1). Everyone who can open the restaurant reads it; the
 * platform owner also changes the plan, each feature beyond it and the note.
 */
export default async function RestaurantPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await loadRestaurant(id);
  const view = await query(restaurantPlan, { restaurantId: restaurant.id });
  return (
    <div className="px-8 py-6">
      {/* Remounted after a save, so the editor starts again from what is stored. */}
      <PlanEditor key={JSON.stringify([view.plan, view.features.map((f) => f.extra), view.note])} restaurantId={restaurant.id} view={view} />
    </div>
  );
}
