import { createTranslator, type Messages, type Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import ar from './ar';
import ckb from './ckb';
import en from './en';

/** The Studio's own catalog, separate from the public menu's. Later tasks add their groups of keys to all three files. */
export const STUDIO_MESSAGES: Record<Locale, Messages> = { en, ar, ckb };

export function getStudioTranslator(locale: Locale): Translate {
  return createTranslator(locale, STUDIO_MESSAGES);
}
