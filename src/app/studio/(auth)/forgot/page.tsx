import type { Metadata } from 'next';
import Link from 'next/link';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthPanel } from '@/studio/shell/AuthPanel';
import { ForgotForm } from './ForgotForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('auth.forgot.title') };
}

export default async function ForgotPage() {
  const t = getStudioTranslator(await requestStudioLocale());
  return (
    <AuthPanel
      title={t('auth.forgot.title')}
      footer={
        <Link href="/studio/sign-in" className="hover:text-text hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      <ForgotForm />
    </AuthPanel>
  );
}
