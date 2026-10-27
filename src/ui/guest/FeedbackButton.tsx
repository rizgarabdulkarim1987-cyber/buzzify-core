'use client';

import { useState } from 'react';
import { ComplaintForm } from '@/app/[tenant]/[locale]/t/[table]/complaint/ComplaintForm';
import { WORDS } from '@/app/[tenant]/[locale]/t/[table]/complaint/words';
import { useApp } from '@/ui/AppProviders';
import { ChatIcon } from '@/ui/Icons';
import { Popup } from './Popup';

/** The box's button, in the header beside the languages; it opens the form in a popup. Absent when the menu switched the box off. */
export function FeedbackButton() {
  const { tenant, locale, table } = useApp();
  const [open, setOpen] = useState(false);
  if (!tenant.feedback) return null;
  const w = WORDS[locale];

  return (
    <>
      <button
        type="button"
        aria-label={w.open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="feedback-button"
        className="grid min-h-11 min-w-11 place-items-center text-muted transition-colors duration-150 [@media(hover:hover)]:hover:text-text"
      >
        <ChatIcon className="size-5" />
      </button>
      {open && (
        <Popup title={w.popupTitle} closeLabel={w.close} onClose={() => setOpen(false)}>
          <p className="mb-4 text-sm text-muted">{w.popupIntro}</p>
          <ComplaintForm slug={tenant.slug} table={table} locale={locale} />
        </Popup>
      )}
    </>
  );
}
