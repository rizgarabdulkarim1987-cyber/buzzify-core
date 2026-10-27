import { notFound, redirect } from 'next/navigation';
import { getPhAccess, getPhPlaces } from '@/server/pharmacy/actor';
import { PH_SIGN_IN } from '@/server/pharmacy/entry';

/**
 * `/pharmacy` itself has nothing to show: it sends a person who is not signed in to the shared sign-in, a person with no
 * pharmacy to "not found" (never back to the sign-in, which would loop), a person with a place chosen to its home, and
 * anyone else to the picker.
 */
export default async function PharmacyEntryPage() {
  const access = await getPhAccess();
  if (!access.signedIn) redirect(PH_SIGN_IN);
  if (access.place) redirect('/pharmacy/home');
  if ((await getPhPlaces()).length === 0) notFound();
  redirect('/pharmacy/select');
}
