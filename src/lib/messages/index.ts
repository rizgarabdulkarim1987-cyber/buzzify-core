import { createTranslator, type Messages, type Translate } from '../i18n';
import type { Locale } from '../locale';
import ar from './ar';
import ckb from './ckb';
import en from './en';

export const MESSAGES: Record<Locale, Messages> = { en, ar, ckb };

export function getTranslator(locale: Locale): Translate {
  return createTranslator(locale, MESSAGES);
}
