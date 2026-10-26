'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ComplaintForm } from '@/app/[tenant]/[locale]/t/[table]/complaint/ComplaintForm';
import { WORDS } from '@/app/[tenant]/[locale]/t/[table]/complaint/words';
import { LOCALE_NAMES } from '@/lib/locale';
import { useApp } from '@/ui/AppProviders';
import { ChatIcon, GlobeIcon } from '@/ui/Icons';
import { guestControls } from './controls';
import { Popup } from './Popup';

const BUTTON =
  'pointer-events-auto grid size-12 place-items-center rounded-full border border-line bg-surface text-text shadow-[0_8px_24px_-10px_rgb(0_0_0/0.6)] [@media(hover:hover)]:hover:border-accent';

/**
 * The language and feedback buttons every menu carries, whatever its style. Fixed at the end edge above the cart bar, so no
 * style's header, navigation or cart is covered.
 */
export function GuestChrome() {
  const { tenant, locale, table } = useApp();
  const pathname = usePathname();
  const [open, setOpen] = useState<'language' | 'feedback' | null>(null);
  const show = guestControls({ locales: tenant.locales, feedbackEnabled: tenant.feedback, pathname });
  const w = WORDS[locale];
  const rest = pathname.split('/').slice(3).join('/');
  if (!show.language && !show.feedback) return null;

  return (
    <>
      <div className="pointer-events-none fixed end-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2" data-testid="guest-chrome">
        {show.language && (
          <button type="button" aria-label={w.languageTitle} aria-haspopup="dialog" onClick={() => setOpen('language')} className={BUTTON} data-testid="language-button">
            <GlobeIcon className="size-5" />
          </button>
        )}
        {show.feedback && (
          <button type="button" aria-label={w.open} aria-haspopup="dialog" onClick={() => setOpen('feedback')} className={BUTTON} data-testid="feedback-button">
            <ChatIcon className="size-5" />
          </button>
        )}
      </div>
      {open === 'language' && (
        <Popup title={w.languageTitle} closeLabel={w.close} onClose={() => setOpen(null)}>
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
                  {code === locale && <span aria-hidden="true" className="text-accent">●</span>}
                </a>
              </li>
            ))}
          </ul>
        </Popup>
      )}
      {open === 'feedback' && (
        <Popup title={w.popupTitle} closeLabel={w.close} onClose={() => setOpen(null)}>
          <p className="mb-4 text-sm text-muted">{w.popupIntro}</p>
          <ComplaintForm slug={tenant.slug} table={table} locale={locale} />
        </Popup>
      )}
    </>
  );
}
