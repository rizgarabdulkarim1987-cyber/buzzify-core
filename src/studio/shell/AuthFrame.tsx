import type { ReactNode } from 'react';
import type { Translate } from '@/lib/i18n';
import type { AuthEntry } from '@/studio/auth-entry';
import { BrandFooter } from './BrandFooter';
import { BrandLogo } from './BrandLogo';
import { LanguageSwitch } from './LanguageSwitch';
import { Wordmark } from './Wordmark';

/** The word "menus" in each of the platform's languages, set as a specimen beside the Studio's sign-in form. */
const SPECIMEN = [
  { lang: 'en', dir: 'ltr', word: 'Menus', name: 'English' },
  { lang: 'ar', dir: 'rtl', word: 'القوائم', name: 'العربية' },
  { lang: 'ckb', dir: 'rtl', word: 'مینیوەکان', name: 'کوردی' },
] as const;

/**
 * The frame of the pages around signing in: the product's mark and the language switch above the form. For the Studio
 * (`entry` "studio") the mark is "Buzzify Core" and, on wide screens, the three languages every menu speaks stand beside
 * it. From Buzzify Retail (`entry` "retail") the mark is the Buzzify logo alone and nothing stands beside the form: no
 * Studio, no menus.
 */
export function AuthFrame({ entry, t, signedIn, children }: { entry: AuthEntry; t: Translate; signedIn: boolean; children: ReactNode }) {
  const neutral = entry === 'retail';
  return (
    <div className={neutral ? 'flex min-h-dvh flex-col' : 'grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(400px,40%)]'}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-ink px-3 py-2 text-on-ink focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50"
        >
          {t('common.skipToContent')}
        </a>
        <header className="flex h-16 items-center justify-between gap-4 px-8">
          {neutral ? <BrandLogo height={16} /> : <Wordmark />}
          <LanguageSwitch signedIn={signedIn} />
        </header>
        <main id="main" className="flex flex-1 flex-col justify-center px-8 pb-24 pt-10">
          {children}
        </main>
        <BrandFooter />
      </div>

      {!neutral && (
        <aside className="hidden flex-col justify-between border-s border-line bg-surface px-12 py-12 lg:flex">
          <p className="max-w-[34ch] text-base text-muted">{t('auth.aside')}</p>
          <ul className="flex flex-col">
            {SPECIMEN.map((item) => (
              <li key={item.lang} lang={item.lang} className="flex items-baseline justify-between gap-6 border-t border-line py-5 last:border-b">
                <span dir={item.dir} className="text-3xl font-medium tracking-[-0.01em] text-text">
                  {item.word}
                </span>
                <span className="shrink-0 text-xs text-muted">{item.name}</span>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
