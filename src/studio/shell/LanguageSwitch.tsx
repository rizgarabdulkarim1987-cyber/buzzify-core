'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { setStudioLanguage } from '@/app/studio/_actions/account';
import { LOCALE_NAMES, LOCALES, type Locale } from '@/lib/locale';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { STUDIO_LOCALE_COOKIE, STUDIO_LOCALE_COOKIE_MAX_AGE } from '@/studio/locale';
import { cx } from '@/studio/ui/cx';

/**
 * The three interface languages, each written in itself. Signed in, the choice is saved on the person's account (and
 * their emails follow it); signed out, it is kept in a cookie for this browser. The page then renders again in the new
 * language and direction.
 */
export function LanguageSwitch({ signedIn, className }: { signedIn: boolean; className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (next: Locale) => {
    if (next === locale || pending) return;
    startTransition(async () => {
      if (signedIn) {
        const result = await setStudioLanguage({ locale: next });
        if (!result.ok) {
          toast.error(describeFailure(t, locale, result.error).message);
          return;
        }
      } else {
        const secure = window.location.protocol === 'https:' ? '; secure' : '';
        document.cookie = `${STUDIO_LOCALE_COOKIE}=${next}; path=/studio; max-age=${STUDIO_LOCALE_COOKIE_MAX_AGE}; samesite=lax${secure}`;
      }
      router.refresh();
    });
  };

  return (
    <div
      role="group"
      aria-label={t('nav.language')}
      aria-busy={pending || undefined}
      className={cx('inline-flex rounded-md border border-line bg-surface p-0.5', className)}
    >
      {LOCALES.map((option) => {
        const current = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            dir={option === 'en' ? 'ltr' : 'rtl'}
            aria-pressed={current}
            onClick={() => choose(option)}
            className={cx(
              'h-6 rounded-sm px-2 text-sm transition-colors duration-150',
              current ? 'border border-line-strong bg-raised font-medium text-text' : 'border border-transparent text-muted hover:text-text',
            )}
          >
            {LOCALE_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
