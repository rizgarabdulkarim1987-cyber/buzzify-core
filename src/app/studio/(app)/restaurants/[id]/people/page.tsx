import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { listInvitations, restaurantMembers } from '@/server/studio/queries/people';
import { loadRestaurant, tabMetadata } from '../load';
import { PeoplePanel } from './PeoplePanel';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'people');
}

/**
 * Who works on this restaurant: its members and its pending invitations, with the right to invite an owner and, for
 * Super Admins, to take someone out. Anyone who may not invite does not have this tab, and the queries refuse them.
 */
export default async function RestaurantPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await loadRestaurant(id);
  const [members, invitations] = await Promise.all([
    query(restaurantMembers, { restaurantId: restaurant.id }),
    query(listInvitations, { restaurantId: restaurant.id, status: 'pending' }),
  ]);

  return (
    <div className="px-8 py-6">
      <PeoplePanel
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        canManage={restaurant.can.manage}
        members={members}
        invitations={invitations.rows.map((row) => ({ id: row.id, email: row.email, expiresAt: row.expiresAt }))}
      />
    </div>
  );
}
