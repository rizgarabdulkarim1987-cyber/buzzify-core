'use client';

import { Direction } from 'radix-ui';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, type Messages, type Translate } from '@/lib/i18n';
import { direction, type Locale } from '@/lib/locale';
import { spaceT } from './space-words';
import type { SpaceId } from './spaces';

interface StudioI18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Translate;
}

const Context = createContext<StudioI18n | null>(null);

/**
 * The interface language for the Studio's client components. The root layout passes the one catalog the page needs
 * (without the email texts, which only the server sends), so a page never ships the other two languages. Also sets the
 * reading direction for Radix's menus and dialogs.
 */
export function StudioI18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo<StudioI18n>(
    () => ({ locale, dir: direction(locale), t: createTranslator(locale, { en: messages, ar: messages, ckb: messages }) }),
    [locale, messages],
  );
  return (
    <Context value={value}>
      <Direction.Provider dir={value.dir}>{children}</Direction.Provider>
    </Context>
  );
}

/**
 * Speaks the words of one space to every client component inside it (`spaceT`): the Retail space's shared screens name
 * no restaurant, menu or till. A server component in the space translates with `spaceT` itself.
 */
export function SpaceWords({ space, children }: { space: SpaceId; children: ReactNode }) {
  const parent = useStudioI18n();
  const value = useMemo<StudioI18n>(() => ({ ...parent, t: spaceT(parent.t, space) }), [parent, space]);
  return <Context value={value}>{children}</Context>;
}

function useStudioI18n(): StudioI18n {
  const value = useContext(Context);
  if (!value) throw new Error('A Studio client component rendered outside StudioI18nProvider');
  return value;
}

/** The translator for the page's language. */
export const useT = (): Translate => useStudioI18n().t;

/** The page's language and reading direction. */
export function useLocale(): { locale: Locale; dir: 'ltr' | 'rtl' } {
  const { locale, dir } = useStudioI18n();
  return { locale, dir };
}
