import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';

/** The Pharmacy space is for Super Admins only: anyone else gets the Studio's not-found page. */
export default async function PharmacySpaceLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (!actor.isSuperAdmin) notFound();
  return children;
}
