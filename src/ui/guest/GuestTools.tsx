'use client';

import { AboutLink } from './AboutLink';
import { FeedbackButton } from './FeedbackButton';
import { LanguageButton } from './LanguageButton';
import { WhatsAppLink } from './WhatsAppLink';

/** What sits at the end of every menu's header, in every style: the restaurant's own page, the language globe, and the complaints and suggestions box. */
export function GuestTools({ showAbout = true }: { showAbout?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {showAbout && <AboutLink />}
      <WhatsAppLink />
      <LanguageButton />
      <FeedbackButton />
    </div>
  );
}
