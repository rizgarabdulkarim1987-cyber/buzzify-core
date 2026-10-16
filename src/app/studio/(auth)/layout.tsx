import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { LanguageSwitch } from '@/studio/shell/LanguageSwitch';
import { Wordmark } from '@/studio/shell/Wordmark';

/** The word "menus" in each of the platform's languages, set as a specimen beside the sign-in form. */
const SPECIMEN = [
  { lang: 'en', dir: 'ltr', word: 'Menus', name: 'English' },
  { lang: 'ar', dir: 'rtl', word: 'القوائم', name: 'العربية' },
  { lang: 'ckb', dir: 'rtl', word: 'مینیوەکان', name: 'کوردی' },
] as const;

/**
 * The frame of the pages around signing in: the product's name and the language switch above the form, and beside it
 * on wide screens, the three languages every menu on the platform speaks. The language comes from the root layout
 * (the switch's cookie, then the browser's languages); a signed-in person on these pages keeps their own.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const [locale, actor] = await Promise.all([requestStudioLocale(), getActor()]);
  const t = getStudioTranslator(locale);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(400px,40%)]">
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
        >
          {t('common.skipToContent')}
        </a>
        <header className="flex h-16 items-center justify-between gap-4 px-8">
          <Wordmark />
          <LanguageSwitch signedIn={actor !== null} />
        </header>
        <main id="main" className="flex flex-1 flex-col justify-center px-8 pb-24 pt-10">
          {children}
        </main>
      </div>

      <aside className="hidden flex-col justify-between border-s border-line bg-surface px-12 py-12 lg:flex">
        <p className="max-w-[34ch] text-base text-muted">{t('auth.aside')}</p>
        <ul className="flex flex-col">
          {SPECIMEN.map((entry) => (
            <li key={entry.lang} lang={entry.lang} className="flex items-baseline justify-between gap-6 border-t border-line py-5 last:border-b">
              <span dir={entry.dir} className="text-3xl font-medium tracking-[-0.01em] text-text">
                {entry.word}
              </span>
              <span className="shrink-0 text-xs text-muted">{entry.name}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
