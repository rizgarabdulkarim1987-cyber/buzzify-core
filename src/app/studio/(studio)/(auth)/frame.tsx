import type { ReactNode } from 'react';
import { getActor } from '@/server/studio/auth/actor';
import type { AuthEntry } from '@/studio/auth-entry';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { AuthFrame } from '@/studio/shell/AuthFrame';

/**
 * The frame every page around signing in sets itself in (`AuthFrame`). Each page passes its entry, which only the page
 * knows (a layout never sees the query): the neutral Buzzify frame when Buzzify Retail sent the person, else the
 * Studio's. The language comes from the root layout (the switch's cookie, then the browser's languages); a signed-in
 * person on these pages keeps their own.
 */
export async function AuthPageFrame({ entry = 'studio', children }: { entry?: AuthEntry; children: ReactNode }) {
  const [locale, actor] = await Promise.all([requestStudioLocale(), getActor()]);
  return (
    <AuthFrame entry={entry} t={getStudioTranslator(locale)} signedIn={actor !== null}>
      {children}
    </AuthFrame>
  );
}
