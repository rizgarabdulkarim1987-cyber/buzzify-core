import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { restaurantBranches } from '@/server/studio/queries/restaurants';
import { loadRestaurant, tabMetadata } from '../load';
import { BranchesManager } from './BranchesManager';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'branches');
}

export default async function BranchesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await loadRestaurant(id);
  const branches = await query(restaurantBranches, { restaurantId: restaurant.id });
  return (
    <div className="px-8 py-6">
      <BranchesManager restaurantId={restaurant.id} branches={branches} canEdit={restaurant.can.edit} />
    </div>
  );
}
