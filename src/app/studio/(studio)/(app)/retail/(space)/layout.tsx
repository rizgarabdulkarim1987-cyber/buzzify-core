import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { SpaceWords } from '@/studio/i18n';

/**
 * The Retail space is for Super Admins only: anyone else gets the Studio's not-found page. The owners' chooser
 * (`/studio/retail/choose`) and the handoff's Route Handlers share the prefix but sit outside this group, so they stay open
 * to the owners they serve. Every client screen inside speaks the space's own words (`SpaceWords`): the shared screens
 * name no restaurant, menu, till or pharmacy here.
 */
export default async function RetailSpaceLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (!actor.isSuperAdmin) notFound();
  return <SpaceWords space="retail">{children}</SpaceWords>;
}
