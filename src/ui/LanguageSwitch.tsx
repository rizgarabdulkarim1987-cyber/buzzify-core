'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { LOCALE_NAMES } from '@/lib/locale';
import { useApp } from '@/ui/AppProviders';

/** The menu's language choice: one button showing the current language, and a small menu of the others that opens under it. */
export function LanguageSwitch() {
  const { tenant, locale, t } = useApp();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Path shape is /{tenant}/{locale}/...rest
  const rest = pathname.split('/').slice(3).join('/');

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0 text-sm">
      <button
        type="button"
        aria-label={t('lang.switch')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-12 items-center gap-2 rounded-md border border-line px-3 text-text transition-colors duration-150 [@media(hover:hover)]:hover:border-accent"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9S9.4 5.7 12 3z" />
        </svg>
        <span lang={locale}>{LOCALE_NAMES[locale]}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <nav id={listId} aria-label={t('lang.switch')} className="absolute end-0 top-full z-40 mt-1 flex min-w-40 flex-col rounded-md border border-line bg-bg py-1 shadow-lg">
          {tenant.locales.map((code) => (
            <a
              key={code}
              href={`/${tenant.slug}/${code}${rest ? `/${rest}` : ''}`}
              lang={code}
              hrefLang={code}
              aria-current={code === locale ? 'true' : undefined}
              className={`flex min-h-12 items-center px-4 transition-colors duration-150 ${code === locale ? 'text-text underline decoration-accent decoration-2 underline-offset-[6px]' : 'text-muted [@media(hover:hover)]:hover:text-text'}`}
            >
              {LOCALE_NAMES[code]}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
