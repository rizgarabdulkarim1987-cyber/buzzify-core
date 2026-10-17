import type { Metadata } from 'next';
import Link from 'next/link';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { buttonClasses } from '@/studio/ui/Button';
import { ResetForm } from './ResetForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('auth.reset.title') };
}

/** The page a reset email links to (`/studio/reset?token=…`). Without a token there is nothing to reset. */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const token = typeof params.token === 'string' && params.token.length > 0 && params.token.length <= 256 ? params.token : null;
  const back = (
    <Link href="/studio/sign-in" className="hover:text-text hover:underline">
      {t('auth.backToSignIn')}
    </Link>
  );

  if (!token) {
    return (
      <AuthPanel title={t('auth.reset.missingTitle')} intro={t('auth.reset.missingBody')} footer={back}>
        <Link href="/studio/forgot" className={buttonClasses('secondary', 'lg')}>
          {t('auth.reset.requestNew')}
        </Link>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title={t('auth.reset.title')} intro={t('auth.reset.intro')} footer={back}>
      <ResetForm token={token} />
    </AuthPanel>
  );
}
