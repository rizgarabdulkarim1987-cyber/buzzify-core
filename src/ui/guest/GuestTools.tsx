'use client';

import { FeedbackButton } from './FeedbackButton';
import { LanguageButton } from './LanguageButton';

/** What sits at the end of every menu's header, in every style: the language globe, and the complaints and suggestions box. */
export function GuestTools() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <LanguageButton />
      <FeedbackButton />
    </div>
  );
}
