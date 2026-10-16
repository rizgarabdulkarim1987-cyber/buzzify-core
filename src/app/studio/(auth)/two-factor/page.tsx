import type { Metadata } from 'next';
import Link from 'next/link';
import { getStudioTranslator } from '@/studio/messages';
import { safeNextPath } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { TwoFactorForm } from './TwoFactorForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('auth.twoFactor.title') };
}

/**
 * The second step of signing in, for an account with two-factor on. The page holds no state of its own: the challenge
 * is Better Auth's cookie from the first step, and a visit without one is told so when the code is sent.
 */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const next = safeNextPath(params.next);
  return (
    <AuthPanel
      title={t('auth.twoFactor.title')}
      footer={
        <Link href="/studio/sign-in" className="hover:text-text hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <TwoFactorForm next={next} />
    </AuthPanel>
  );
}
