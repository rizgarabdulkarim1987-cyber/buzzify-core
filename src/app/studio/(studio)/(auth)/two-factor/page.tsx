import type { Metadata } from 'next';
import Link from 'next/link';
import { SIGN_IN_PATH } from '@/server/studio/framework/paths';
import { authEntryOf, authKey, authTitle, withNext } from '@/studio/auth-entry';
import { getStudioTranslator } from '@/studio/messages';
import { safeNextPath } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { AuthPageFrame } from '../frame';
import { TwoFactorForm } from './TwoFactorForm';

type Params = Promise<{ next?: string | string[] }>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  return { title: authTitle(getStudioTranslator(locale)('auth.twoFactor.title'), authEntryOf(safeNextPath(params.next))) };
}

/**
 * The second step of signing in, for an account with two-factor on. The page holds no state of its own: the challenge
 * is Better Auth's cookie from the first step, and a visit without one is told so when the code is sent. From Buzzify
 * Retail it wears the neutral frame, and the way back to sign in keeps that entry.
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: Params }) {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const next = safeNextPath(params.next);
  const entry = authEntryOf(next);
  const signInHref = withNext(SIGN_IN_PATH, next);
  return (
    <AuthPageFrame entry={entry}>
      <AuthPanel
        title={t('auth.twoFactor.title')}
        footer={
          <Link href={signInHref} className="hover:text-text hover:underline">
            {t('auth.backToSignIn')}
          </Link>
        }
      >
        <TwoFactorForm next={next} intro={t(authKey('auth.twoFactor.intro', entry))} signInHref={signInHref} />
      </AuthPanel>
    </AuthPageFrame>
  );
}
