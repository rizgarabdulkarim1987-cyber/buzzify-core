import { createTranslator, type Messages, type Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import ar from './ar';
import ckb from './ckb';
import en from './en';
import salesDishesAr from './sales-dishes/ar';
import salesDishesCkb from './sales-dishes/ckb';
import salesDishesEn from './sales-dishes/en';

/** The Studio's own catalog, separate from the public menu's. Later tasks add their groups of keys to all three files. */
export const STUDIO_MESSAGES: Record<Locale, Messages> = {
  en: { ...en, ...salesDishesEn },
  ar: { ...ar, ...salesDishesAr },
  ckb: { ...ckb, ...salesDishesCkb },
};

export function getStudioTranslator(locale: Locale): Translate {
  return createTranslator(locale, STUDIO_MESSAGES);
}

/** The catalog a page's client components receive: its language's, without the email texts only the server sends. */
export function clientMessages(locale: Locale): Messages {
  return Object.fromEntries(Object.entries(STUDIO_MESSAGES[locale]).filter(([key]) => !key.startsWith('email.')));
}
