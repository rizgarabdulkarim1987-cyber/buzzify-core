import { Pill } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPhAccess, getPhPlaces } from '@/server/pharmacy/actor';
import { PH_SIGN_IN } from '@/server/pharmacy/entry';
import { getActor } from '@/server/studio/auth/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { BranchPicker } from '@/app/pharmacy/_ui/BranchPicker';
import { firstNameOf, greetingOf } from '@/app/pharmacy/_ui/home-logic';
import { SignOutButton } from '@/app/pos/_ui/SignOutButton';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.select.title') };
}

/**
 * The business and branch picker (pharmacy redesign, task 12): a centred column with the brand, a greeting, and one card
 * per place. The shell is not mounted here (no rail, no bottom bar). It lists only what the person may use now (from the
 * database, never from the cookie); the place their cookie names is marked when it is still one of them. A person with no
 * pharmacy gets a 404.
 */
export default async function PharmacySelectPage() {
  const [access, places, locale, person] = await Promise.all([getPhAccess(), getPhPlaces(), requestStudioLocale(), getActor()]);
  if (!access.signedIn) redirect(PH_SIGN_IN);
  if (places.length === 0) notFound();
  const t = getStudioTranslator(locale);
  // The person, not the pharmacy actor: before a place is chosen there is no actor, but there is a name.
  const name = firstNameOf(person?.name ?? '');
  const greeting = name ? t(`pharmacy.home.greeting.${greetingOf(new Date())}`, { name }).replace(/[,،]\s*$/, '') : null;
  return (
    <div className="flex min-h-dvh flex-col bg-ph-canvas text-ph-text">
      <a
        href="#main"
        className="sr-only rounded-ph-xl bg-ph-g8 px-3 py-2 text-ph-on-green focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <header className="mx-auto flex w-full max-w-[30rem] items-center justify-between gap-2 px-4 pt-4">
        <p className="flex min-w-0 items-center gap-2.5 font-bold">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-ph-xl bg-ph-g8 text-ph-on-green">
            <Pill size={20} />
          </span>
          <span className="min-w-0 break-words">{t('pharmacy.shell.label')}</span>
        </p>
        <SignOutButton className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-ph-xl px-3 text-sm font-semibold text-ph-text hover:bg-ph-card disabled:opacity-60" />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[30rem] flex-col gap-6 px-4 pb-12 pt-8">
        <div className="flex flex-col gap-1.5">
          {greeting ? (
            <p data-testid="select-greeting" className="text-sm font-semibold text-ph-g6">
              {greeting}
            </p>
          ) : null}
          <h1 className="text-2xl font-bold">{t('pharmacy.select.title')}</h1>
          <p className="text-sm text-ph-muted">{t('pharmacy.select.intro')}</p>
        </div>
        <BranchPicker places={places} current={access.place} t={t} />
      </main>
    </div>
  );
}
