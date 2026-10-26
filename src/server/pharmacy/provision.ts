import type { ScopedTx } from '@/server/data/tenant-db';
import type { PhCurrency } from '@/server/domain/restaurant-profile';
import { createInvitation, type InvitationOptions } from '@/server/studio/services/invitations';

/**
 * Sets a new pharmacy business up: its branches, its `PhSettings` row and, when an email is given, the invitation that
 * makes that person its owner. It runs on the transaction of the action that creates the business, so a failure in
 * any step leaves nothing behind. The `pharmacy` subscription is not started here; the billing screens do that.
 */

export interface PharmacyBranchInput {
  name: string;
  city?: string;
}

export interface ProvisionArgs {
  restaurantId: string;
  branches: readonly PharmacyBranchInput[];
  /** The currencies the business may price in; the first is its default. */
  currencies: readonly PhCurrency[];
  /** The person to invite as owner. Needs `invitedById` (the Super Admin creating the business). */
  ownerEmail?: string;
  invitedById?: string;
  afterCommit?: InvitationOptions['afterCommit'];
}

export async function provisionPharmacy(
  tx: ScopedTx,
  args: ProvisionArgs,
): Promise<{ branchIds: string[]; invitationId: string | null }> {
  if (args.branches.length === 0) throw new Error('A pharmacy needs at least one branch');
  if (args.currencies.length === 0) throw new Error('A pharmacy needs at least one currency');
  const currencies = [...new Set(args.currencies)];

  // One nested write on the business's own row. The platform's transaction refuses top-level reads and writes of
  // restaurant-scoped models (it has no restaurant yet), and this keeps the branches and the settings in the same
  // statement set as the business that action just created.
  const written = await tx.restaurant.update({
    where: { id: args.restaurantId },
    data: {
      branches: { create: args.branches.map((branch, sortOrder) => ({ name: branch.name, city: branch.city ?? '', sortOrder })) },
      phSettings: { create: { enabledCurrencies: currencies, defaultCurrency: currencies[0]! } },
    },
    select: { branches: { select: { id: true }, orderBy: { sortOrder: 'asc' } } },
  });
  const branchIds = written.branches.map((branch) => branch.id);

  let invitationId: string | null = null;
  if (args.ownerEmail !== undefined) {
    if (!args.invitedById) throw new Error('An owner invitation needs the person sending it');
    const invitation = await createInvitation(
      tx,
      { email: args.ownerEmail, restaurantId: args.restaurantId, role: 'OWNER', asSuperAdmin: false, invitedById: args.invitedById, now: new Date() },
      { afterCommit: args.afterCommit },
    );
    invitationId = invitation.invitationId;
  }
  return { branchIds, invitationId };
}
