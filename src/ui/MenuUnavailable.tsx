import type { Locale } from '@/lib/locale';
import { getTranslator } from '@/lib/messages';

/**
 * What guests see at a suspended or archived menu's address: the restaurant's name and one line, in their language.
 * Neutral on purpose (no menu, no brand, no links), so a paused menu shows nothing about itself.
 */
export function MenuUnavailable({ name, locale }: { name: string; locale: Locale }) {
  const t = getTranslator(locale);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6" data-testid="menu-unavailable">
      <h1 className="font-display text-3xl">{name}</h1>
      <p className="text-muted">{t('menu.unavailable')}</p>
    </main>
  );
}
