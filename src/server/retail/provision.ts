import type { ScopedTx } from '@/server/data/tenant-db';
import type { PhCurrency } from '@/server/domain/restaurant-profile';
import { createInvitation, type InvitationOptions } from '@/server/studio/services/invitations';

/**
 * Sets a new retail business up: its branches, its `RetailLink` row (the currencies it prices in, nothing sent to
 * Retails yet: `stateVersion` stays 0) and the invitation that makes the given person its owner. It runs on the
 * transaction of the action that creates the business, so a failure in any step leaves nothing behind. The `retail`
 * subscription is not started here; the billing screens do that.
 */

export interface RetailBranchInput {
  /** 1..80 characters (Retails' own cap), unique within the business ignoring case. */
  name: string;
  city?: string;
}

export interface ProvisionRetailArgs {
  restaurantId: string;
  branches: readonly RetailBranchInput[];
  /** The currencies the business may price in; the first is its default. */
  currencies: readonly PhCurrency[];
  /** The person to invite as owner. Needs `invitedById` (the Super Admin creating the business). */
  ownerEmail?: string;
  invitedById?: string;
  afterCommit?: InvitationOptions['afterCommit'];
}

export async function provisionRetail(
  tx: ScopedTx,
  args: ProvisionRetailArgs,
): Promise<{ branchIds: string[]; invitationId: string | null }> {
  if (args.branches.length === 0) throw new Error('A retail business needs at least one branch');
  if (args.currencies.length === 0) throw new Error('A retail business needs at least one currency');
  const currencies = [...new Set(args.currencies)];

  // One nested write on the business's own row, as the pharmacy does: the platform's transaction refuses top-level
  // reads and writes of restaurant-scoped models (it has no restaurant yet), and this keeps the branches and the link in
  // the same statement set as the business that action just created.
  const written = await tx.restaurant.update({
    where: { id: args.restaurantId },
    data: {
      branches: { create: args.branches.map((branch, sortOrder) => ({ name: branch.name, city: branch.city ?? '', sortOrder })) },
      retailLink: { create: { currencies } },
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
