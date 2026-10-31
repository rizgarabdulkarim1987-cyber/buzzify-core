import type { Metadata } from 'next';
import { query } from '@/server/studio/framework/invoke';
import { listInvitations, restaurantMembers, restaurantPolicy, restaurantTillStaff } from '@/server/studio/queries/people';
import { loadRestaurant, tabMetadata } from '../load';
import { PeoplePanel } from './PeoplePanel';
import { PermissionSwitches } from './PermissionSwitches';
import { TillStaffPanel } from './TillStaffPanel';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'people');
}

/**
 * Who works on this restaurant: its members and its pending invitations, with the right to invite an owner and, for
 * Super Admins, to take someone out and to switch what designers and owners may do here. Anyone who may not invite does
 * not have this tab, and the queries refuse them.
 */
export default async function RestaurantPeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const restaurant = await loadRestaurant(id);
  const [members, invitations, policy, tillStaff] = await Promise.all([
    query(restaurantMembers, { restaurantId: restaurant.id }),
    query(listInvitations, { restaurantId: restaurant.id, status: 'pending' }),
    // The switches are for those who may change permissions; the policy is not read for anyone else.
    restaurant.can.permissions ? query(restaurantPolicy, { restaurantId: restaurant.id }) : null,
    // Till accounts are a Super Admin's to make and to see here; a pharmacy has no till.
    restaurant.can.manage && restaurant.sector !== 'PHARMACY' ? query(restaurantTillStaff, { restaurantId: restaurant.id }) : null,
  ]);

  return (
    <div className="flex flex-col gap-10 px-8 py-6">
      <PeoplePanel
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        canManage={restaurant.can.manage}
        members={members}
        invitations={invitations.rows.map((row) => ({ id: row.id, email: row.email, expiresAt: row.expiresAt }))}
      />
      {tillStaff && <TillStaffPanel restaurantId={restaurant.id} staff={tillStaff} />}
      {policy && (
        // Remounted when the version moves, so the switches always start from what is saved.
        <PermissionSwitches key={policy.version} restaurantId={restaurant.id} version={policy.version} policy={policy.policy} />
      )}
    </div>
  );
}
