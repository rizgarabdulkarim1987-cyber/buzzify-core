'use client';

import { LOCALE_NAMES, type Locale } from '@/lib/locale';
import { languageCookieValue } from '@/server/http/language-memory';

const BUTTON =
  'flex min-h-12 items-center justify-center rounded-full border border-white/70 bg-white/15 px-5 text-base font-medium text-white backdrop-blur-sm transition-colors duration-150 [@media(hover:hover)]:hover:bg-white/30';

function rememberLanguage(slug: string, code: Locale) {
  try {
    document.cookie = languageCookieValue(slug, code, location.protocol === 'https:');
  } catch {
    // Cookies blocked: the link still works, it just asks again next time.
  }
}

/**
 * The language choice. Real links to the menu in each language, so they work without JavaScript; with it, the choice is remembered first so
 * the next visit goes straight to the menu. The first language (the menu's default) sits alone, the rest in pairs. One language is one Enter.
 */
export function LanguageButtons({ slug, search, locales, enter, label }: { slug: string; search: string; locales: Locale[]; enter: string; label: string }) {
  const remember = (code: Locale) => rememberLanguage(slug, code);
  const [first, ...rest] = locales;
  if (!first) return null;
  if (rest.length === 0) {
    return (
      <a href={`/${slug}/${first}${search}`} onClick={() => remember(first)} className={`${BUTTON} w-full`}>
        {enter}
      </a>
    );
  }
  return (
    <nav aria-label={label} className="grid w-full grid-cols-2 gap-3">
      {locales.map((code, index) => (
        <a
          key={code}
          href={`/${slug}/${code}${search}`}
          onClick={() => remember(code)}
          lang={code}
          className={`${BUTTON} ${index === 0 ? 'col-span-2' : ''}`}
        >
          {LOCALE_NAMES[code]}
        </a>
      ))}
    </nav>
  );
}
