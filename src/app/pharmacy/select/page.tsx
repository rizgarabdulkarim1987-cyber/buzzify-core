import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPhAccess, getPhPlaces } from '@/server/pharmacy/actor';
import { PH_SIGN_IN } from '@/server/pharmacy/entry';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { BranchPicker } from '@/app/pharmacy/_ui/BranchPicker';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.select.title') };
}

/**
 * The business and branch picker. It lists only what the person may use now (from the database, never from the
 * cookie); the place their cookie names is marked when it is still one of them. A person with no pharmacy gets a 404.
 */
export default async function PharmacySelectPage() {
  const [access, places, locale] = await Promise.all([getPhAccess(), getPhPlaces(), requestStudioLocale()]);
  if (!access.signedIn) redirect(PH_SIGN_IN);
  if (places.length === 0) notFound();
  const t = getStudioTranslator(locale);
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <a
        href="#main"
        className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 sm:px-8">
        <p className="text-base font-semibold text-text">{t('pharmacy.shell.label')}</p>
        <SignOutButton />
      </header>
      <main id="main" className="flex w-full max-w-2xl flex-col self-center pb-12">
        <PageHeader title={t('pharmacy.select.title')} description={t('pharmacy.select.intro')} />
        <div className="px-8">
          <BranchPicker places={places} current={access.place} t={t} />
        </div>
      </main>
    </div>
  );
}
