import { redirect } from 'next/navigation';
import { posLanding } from '@/server/domain/pos/permissions';
import { getPosAccess } from '@/server/pos/actor';

/** The till's landing: the kitchen goes to its screen, everyone else to the tables board. */
export default async function PosHomePage() {
  const { actor } = await getPosAccess();
  // The layout has already refused anyone without a till; this keeps the type honest.
  if (!actor) return null;
  redirect(posLanding(actor.role) === 'kitchen' ? '/pos/kitchen' : '/pos/tables');
}
