import type { Metadata } from 'next';
import Link from 'next/link';
import { getActor } from '@/server/studio/auth/actor';
import { getStudioTranslator } from '@/studio/messages';
import { safeNextPath } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { Alert } from '@/studio/ui/Alert';
import { isolated } from '@/studio/ui/isolate';
import { SignInForm } from './SignInForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('auth.signIn.title') };
}

/** Notes another page can leave for the sign-in page, by the `notice` parameter. */
const NOTICES = { reset: 'auth.signIn.passwordReset', 'signed-out': 'auth.signIn.signedOut' } as const;

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; notice?: string | string[] }> }) {
  const [params, locale, actor] = await Promise.all([searchParams, requestStudioLocale(), getActor()]);
  const t = getStudioTranslator(locale);
  const next = safeNextPath(params.next);
  const notice = typeof params.notice === 'string' && params.notice in NOTICES ? NOTICES[params.notice as keyof typeof NOTICES] : null;

  return (
    <AuthPanel
      title={t('auth.signIn.title')}
      intro={t('auth.signIn.intro')}
      notices={
        (actor || notice) && (
          <>
            {notice && <Alert tone="success">{t(notice)}</Alert>}
            {actor && (
              <Alert>
                {isolated(t('auth.signIn.already'), { email: actor.email })}{' '}
                <Link href={next ?? '/studio'} className="font-medium text-text underline underline-offset-2">
                  {t('auth.signIn.alreadyAction')}
                </Link>
              </Alert>
            )}
          </>
        )
      }
    >
      <SignInForm next={next} />
    </AuthPanel>
  );
}
