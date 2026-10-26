import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH } from '@/server/studio/framework/invoke';
import { getStudioTranslator } from '@/studio/messages';
import { isOwnerOnly } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { StyleLibrary } from '@/studio/styles/StyleLibrary';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('styles.library.title') };
}

/**
 * The Menu Styles area: the 35 complete looks a menu can take, for the people who build menus (Super Admins and
 * designers). An owner works on their own restaurant and is sent to it, as on Motion.
 */
export default async function StylesPage() {
  const actor = await getActor();
  if (!actor) redirect(SIGN_IN_PATH);
  if (isOwnerOnly(actor)) redirect('/studio');
  return (
    // The gallery reads its group and search from the address.
    <Suspense>
      <StyleLibrary />
    </Suspense>
  );
}
