import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { retailStartUrl } from '@/server/retail/entry';
import { getActor } from '@/server/studio/auth/actor';
import { authEntryOf, authKey, authTitle } from '@/studio/auth-entry';
import { getStudioTranslator } from '@/studio/messages';
import { retailOnlyRedirect, safeNextPath } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { Alert } from '@/studio/ui/Alert';
import { isolated } from '@/studio/ui/isolate';
import { AuthPageFrame } from '../frame';
import { SignInForm } from './SignInForm';

type Params = Promise<{ next?: string | string[]; notice?: string | string[] }>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  return { title: authTitle(getStudioTranslator(locale)('auth.signIn.title'), authEntryOf(safeNextPath(params.next))) };
}

/** Notes another page can leave for the sign-in page, by the `notice` parameter. */
const NOTICES = { reset: 'auth.signIn.passwordReset', 'signed-out': 'auth.signIn.signedOut' } as const;

/**
 * Email and password. Sent here by Buzzify Retail (`next` is the handoff's way back), the page wears the neutral Buzzify
 * frame and texts (`authEntryOf`), and a right password returns straight through the handoff to Retail.
 */
export default async function SignInPage({ searchParams }: { searchParams: Params }) {
  const [params, locale, actor] = await Promise.all([searchParams, requestStudioLocale(), getActor()]);
  const t = getStudioTranslator(locale);
  const next = safeNextPath(params.next);
  const entry = authEntryOf(next);
  // An account made for Buzzify Retail that is already signed in goes on into Retail: back through the handoff it came
  // from, or by Retails' own start.
  const toRetail = retailOnlyRedirect(actor, retailStartUrl());
  if (toRetail) redirect(entry === 'retail' && next ? next : toRetail);
  const notice = typeof params.notice === 'string' && params.notice in NOTICES ? NOTICES[params.notice as keyof typeof NOTICES] : null;

  return (
    <AuthPageFrame entry={entry}>
      <AuthPanel
        title={t('auth.signIn.title')}
        intro={t(authKey('auth.signIn.intro', entry))}
        notices={
          (actor || notice) && (
            <>
              {notice && <Alert tone="success">{t(notice)}</Alert>}
              {actor && (
                <Alert>
                  {isolated(t('auth.signIn.already'), { email: actor.email })}{' '}
                  <Link href={next ?? '/studio'} className="font-medium text-text underline underline-offset-2">
                    {t(authKey('auth.signIn.alreadyAction', entry))}
                  </Link>
                </Alert>
              )}
            </>
          )
        }
      >
        <SignInForm next={next} />
      </AuthPanel>
    </AuthPageFrame>
  );
}
