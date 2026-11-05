import { notFound, redirect } from 'next/navigation';
import { retailStartUrl } from '@/server/retail/entry';
import { getActor } from '@/server/studio/auth/actor';
import { retailOnlyRedirect } from '@/studio/nav';

/**
 * Any /studio address no page claims. Without it Next would offer it to the public menu's `[tenant]/[locale]` route,
 * which answers with the menu's own 404; this shows the Studio's own not-found page instead. Next prefers a route with
 * fixed segments to a catch-all, so every real Studio page, including those in the `(auth)` and `(app)` groups,
 * still wins. An account made for Buzzify Retail is sent into Retail instead, as from every Studio page.
 */
export default async function UnknownStudioPage() {
  const toRetail = retailOnlyRedirect(await getActor(), retailStartUrl());
  if (toRetail) redirect(toRetail);
  notFound();
}
