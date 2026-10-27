'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { WORDS } from '@/app/[tenant]/[locale]/t/[table]/complaint/words';
import { LOCALE_NAMES } from '@/lib/locale';
import { useApp } from '@/ui/AppProviders';
import { LanguageIcon } from '@/ui/Icons';
import { Popup } from './Popup';

/** The globe in the header: it opens the menu's languages. Absent when the menu has one language. */
export function LanguageButton() {
  const { tenant, locale } = useApp();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (tenant.locales.length < 2) return null;
  const w = WORDS[locale];
  // Path shape is /{tenant}/{locale}/...rest
  const rest = pathname.split('/').slice(3).join('/');

  return (
    <>
      <button
        type="button"
        aria-label={w.languageTitle}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="language-button"
        className="grid min-h-11 min-w-11 place-items-center text-muted transition-colors duration-150 [@media(hover:hover)]:hover:text-text"
      >
        <LanguageIcon className="size-6" />
      </button>
      {open && (
        <Popup title={w.languageTitle} closeLabel={w.close} onClose={() => setOpen(false)}>
          <ul className="flex flex-col">
            {tenant.locales.map((code) => (
              <li key={code}>
                <a
                  href={`/${tenant.slug}/${code}${rest ? `/${rest}` : ''}`}
                  lang={code}
                  hrefLang={code}
                  aria-current={code === locale ? 'true' : undefined}
                  className={`flex min-h-12 items-center justify-between gap-3 border-b border-line px-1 text-lg ${code === locale ? 'text-text' : 'text-muted'}`}
                >
                  {LOCALE_NAMES[code]}
                  {code === locale && (
                    <span aria-hidden="true" className="text-accent">
                      ●
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </Popup>
      )}
    </>
  );
}
