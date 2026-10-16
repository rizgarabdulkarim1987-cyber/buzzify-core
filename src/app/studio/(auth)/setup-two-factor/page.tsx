import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/server/studio/auth/actor';
import { SIGN_IN_PATH, TWO_FACTOR_SETUP_PATH } from '@/server/studio/framework/paths';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { SetupTwoFactor } from './SetupTwoFactor';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('auth.setup.title') };
}

/**
 * Turning on two-factor: where the signed-in layout and `query()` send a Super Admin who has not, and where anyone else
 * may come from their account page. It sits outside the signed-in layout (whose own redirect would loop) and checks
 * for a signed-in person itself.
 */
export default async function SetupTwoFactorPage() {
  const actor = await getActor();
  if (!actor) redirect(`${SIGN_IN_PATH}?next=${encodeURIComponent(TWO_FACTOR_SETUP_PATH)}`);
  const t = getStudioTranslator(actor.locale);

  return (
    <AuthPanel title={t('auth.setup.title')} intro={actor.isSuperAdmin ? t('auth.setup.required') : t('auth.setup.optional')} width="md">
      <SetupTwoFactor
        email={actor.email}
        alreadyOn={actor.twoFactorEnabled}
        finishHref={actor.isSuperAdmin ? '/studio' : '/studio/account'}
      />
    </AuthPanel>
  );
}
