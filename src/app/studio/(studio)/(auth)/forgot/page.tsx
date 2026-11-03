import type { Metadata } from 'next';
import Link from 'next/link';
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

/** Asks for a reset link. `next` only comes along from the sign-in page, so the way back keeps its entry (and its frame). */
export default async function ForgotPage({ searchParams }: { searchParams: Params }) {
  const [params, locale] = await Promise.all([searchParams, requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const next = safeNextPath(params.next);
  const entry = authEntryOf(next);
  return (
    <AuthPageFrame entry={entry}>
      <AuthPanel
        title={t('auth.forgot.title')}
        footer={
          <Link href={withNext(SIGN_IN_PATH, next)} className="hover:text-text hover:underline">
            {t('auth.backToSignIn')}
          </Link>
        }
      >
        <ForgotForm entry={entry} />
      </AuthPanel>
    </AuthPageFrame>
  );
}
