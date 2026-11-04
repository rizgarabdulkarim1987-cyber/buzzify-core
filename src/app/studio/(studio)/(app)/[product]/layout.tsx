import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { SpaceWords } from '@/studio/i18n';
import { productOf } from './product';

/**
 * A Retail product's space (`/studio/supermarket`, `/studio/electronics`, `/studio/clothing`) is for Super Admins only:
 * anyone else gets the Studio's not-found page, and so does any other address at this level. The owners' chooser
 * (`/studio/retail/choose`) and the handoff's Route Handlers sit outside, so they stay open to the owners they serve.
 * Every client screen inside speaks the product's own words (`SpaceWords`): never another product's, a restaurant's or a
 * pharmacy's.
 */
export default async function RetailProductLayout({ children, params }: { children: ReactNode; params: Promise<{ product: string }> }) {
  const product = await productOf(params);
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (!actor.isSuperAdmin) notFound();
  return <SpaceWords space={product}>{children}</SpaceWords>;
}
