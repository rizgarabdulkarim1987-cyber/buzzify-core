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
          className={`grid min-h-11 min-w-11 place-items-center rounded-full px-3 transition-colors ${
            code === locale ? 'bg-raised text-text' : 'text-muted hover:text-text'
          }`}
        >
          {LOCALE_NAMES[code]}
        </a>
      ))}
    </nav>
  );
}
