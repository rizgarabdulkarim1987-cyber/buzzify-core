import type { Locale } from './locale';

export type Messages = Record<string, string>;
export type Translate = (key: string, params?: Record<string, string | number>) => string;

function pluralRules(locale: Locale): Intl.PluralRules {
  const supported = Intl.PluralRules.supportedLocalesOf([locale]).length > 0;
  return new Intl.PluralRules(supported ? locale : 'en');
}

export function createTranslator(locale: Locale, catalog: Record<Locale, Messages>): Translate {
  const rules = pluralRules(locale);
  const own = catalog[locale];
  const fallback = catalog.en;

  return (key, params) => {
    let template: string | undefined;
    if (params && typeof params.count === 'number') {
      const category = rules.select(params.count);
      template =
        own[`${key}_${category}`] ?? own[`${key}_other`] ?? fallback[`${key}_${category}`] ?? fallback[`${key}_other`];
    }
    template ??= own[key] ?? fallback[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name];
      return value === undefined ? placeholder : String(value);
    });
  };
}
