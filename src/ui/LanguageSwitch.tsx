'use client';

import { usePathname } from 'next/navigation';
import { LOCALE_NAMES } from '@/lib/locale';
import { useApp } from '@/ui/AppProviders';

export function LanguageSwitch() {
  const { tenant, locale, t } = useApp();
  const pathname = usePathname();
  // Path shape is /{tenant}/{locale}/...rest
  const rest = pathname.split('/').slice(3).join('/');

  return (
    <nav aria-label={t('lang.switch')} className="flex shrink-0 items-center gap-1 text-sm">
      {tenant.locales.map((code) => (
        <a
          key={code}
          href={`/${tenant.slug}/${code}${rest ? `/${rest}` : ''}`}
          lang={code}
          hrefLang={code}
          aria-current={code === locale ? 'true' : undefined}
          className={`grid min-h-11 min-w-11 place-items-center px-2.5 transition-colors duration-150 ${
            code === locale
              ? 'text-text underline decoration-accent decoration-2 underline-offset-[10px]'
              : 'text-muted [@media(hover:hover)]:hover:text-text'
          }`}
        >
          {LOCALE_NAMES[code]}
        </a>
      ))}
    </nav>
  );
}
