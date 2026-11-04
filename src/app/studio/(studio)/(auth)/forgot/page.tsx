import type { Metadata } from 'next';
import Link from 'next/link';
import { retailSignInUrl } from '@/server/retail/entry';
import { SIGN_IN_PATH } from '@/server/studio/framework/paths';
import { authEntryOf, authTitle, withNext } from '@/studio/auth-entry';
import { getStudioTranslator } from '@/studio/messages';
import { safeNextPath } from '@/studio/nav';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { AuthPageFrame } from '../frame';
import { ForgotForm } from './ForgotForm';

type Params = Promise<{ next?: string | string[] }>;

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  return { title: authTitle(getStudioTranslator(locale)('auth.forgot.title'), authEntryOf(safeNextPath(params.next))) };
}

/**
 * Asks for a reset link. `next` comes along from the sign-in page and from Buzzify Retail's own sign-in form, so the page
 * keeps its entry (and its frame). From Retail the way back is Retails' sign-in page, where the person started.
 */
export default async function ForgotPage({ searchParams }: { searchParams: Params }) {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const next = safeNextPath(params.next);
  const entry = authEntryOf(next);
  const retailBack = entry === 'retail' ? retailSignInUrl() : null;
  const backClass = 'hover:text-text hover:underline';
  return (
    <AuthPageFrame entry={entry}>
      <AuthPanel
        title={t('auth.forgot.title')}
        footer={
          retailBack ? (
            <a href={retailBack} className={backClass}>
              {t('auth.backToSignIn')}
            </a>
          ) : (
            <Link href={withNext(SIGN_IN_PATH, next)} className={backClass}>
              {t('auth.backToSignIn')}
            </Link>
          )
        }
      >
        <ForgotForm entry={entry} />
      </AuthPanel>
    </AuthPageFrame>
  );
}
