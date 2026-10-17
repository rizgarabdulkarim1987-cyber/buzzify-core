import type { Locale } from '@/lib/locale';

/**
 * The one line, here rather than in `src/lib/messages`: that catalog travels to the browser with every menu page, and
 * this page renders on the server only.
 */
const UNAVAILABLE: Record<Locale, string> = {
  en: 'This menu is temporarily unavailable.',
  ar: 'هذه القائمة غير متاحة مؤقتًا.',
  ckb: 'ئەم مینیوویە بۆ ماوەیەکی کاتی بەردەست نییە.',
};

/**
 * What guests see at a suspended or archived menu's address: the restaurant's name and one line, in their language.
 * Neutral on purpose (no menu, no brand, no links), so a paused menu shows nothing about itself.
 */
export function MenuUnavailable({ name, locale }: { name: string; locale: Locale }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6" data-testid="menu-unavailable">
      <h1 className="font-display text-3xl">{name}</h1>
      <p className="text-muted">{UNAVAILABLE[locale]}</p>
    </main>
  );
}
