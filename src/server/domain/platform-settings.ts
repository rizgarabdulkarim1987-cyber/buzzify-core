import { z } from 'zod';
import { LOCALES, type Locale } from '@/lib/locale';
import { normalizeSlugInput, SLUG_MAX } from './slug';

/**
 * The platform's own settings (spec 10.3): the words no menu may use as an address, the name emails come from, and what a
 * new menu starts with. Pure, so the server and the Settings form share one definition. How they are stored (one row per
 * key) and read is `getPlatformSettings`; this module only knows their shape, their defaults and their rules.
 */

export interface PlatformSettings {
  /** Words that cannot be menu addresses, in addition to the built-in list (`RESERVED_SLUGS`). Always normalized. */
  reservedSlugs: string[];
  /** The display name of every Studio email's sender. The address comes from the environment. */
  emailSenderName: string;
  /** What a new menu starts with when its form leaves a value out. */
  defaults: {
    locales: Locale[];
    defaultLocale: Locale;
    currency: string;
    timezone: string;
  };
}

/** What the platform uses for anything that has not been set. */
export function defaultPlatformSettings(): PlatformSettings {
  return {
    reservedSlugs: [],
    emailSenderName: 'Buzzify Studio',
    defaults: { locales: [...LOCALES], defaultLocale: 'en', currency: 'IQD', timezone: 'Asia/Baghdad' },
  };
}

/** The keys settings are stored under, one row each. */
export const SETTING_KEYS = ['reservedSlugs', 'emailSenderName', 'defaults'] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

// Rules -----------------------------------------------------------------------------------------------------------------

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** An ISO 4217 code the runtime knows. */
export const currencyField = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Choose one of the currencies offered')
  .refine((code) => CURRENCIES.has(code), 'Choose one of the currencies offered');

/** An IANA time zone the runtime knows. */
export const timeZoneField = z.string().min(1).max(64).refine(isTimeZone, 'Choose one of the time zones offered');

/** A menu's languages: at least one, each once. */
export const localesField = z
  .array(z.enum(LOCALES, 'Choose one of the languages offered'))
  .min(1, 'Choose at least one language')
  .refine((list) => new Set(list).size === list.length, 'Choose each language once');

/**
 * What an email's sender may be called. It goes into a `From` header as a display name, so quotes, angle brackets,
 * commas, colons, `@` and line breaks (all of which can change what the header means) are not allowed: letters of any
 * script, digits, spaces and a few marks are.
 */
export const senderNameField = z
  .string()
  .trim()
  .min(1, 'Enter the sender name')
  .max(60, 'Use at most 60 characters')
  .regex(/^[\p{L}\p{N} .&()-]+$/u, 'Use letters, digits, spaces and . & ( ) - only');

/** The most reserved words the setting holds. */
export const MAX_RESERVED_SLUGS = 500;

/**
 * Reserved words in the form slugs are compared in: trimmed, lowercased and cleaned like a typed slug (so "Café Bar"
 * reserves `cafe-bar`), without blanks or repeats, in the order first seen. Anything that is not text is dropped.
 */
export function normalizeReservedSlugs(words: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const word of words) {
    if (typeof word !== 'string') continue;
    const normalized = normalizeSlugInput(word);
    if (normalized !== '' && normalized.length <= SLUG_MAX) seen.add(normalized);
  }
  return [...seen];
}

// Reading stored settings -------------------------------------------------------------------------------------------------

const storedDefaults = z.object({
  locales: localesField.optional().catch(undefined),
  defaultLocale: z.enum(LOCALES).optional().catch(undefined),
  currency: currencyField.optional().catch(undefined),
  timezone: timeZoneField.optional().catch(undefined),
});

/**
 * The settings from their stored rows: the built-in defaults, with each key's stored value on top when it is valid. A
 * row whose value is not what its key holds (written by hand, or by an older version) is ignored for that key (and, for
 * the defaults, for that part of them) instead of failing the whole read. The default language is always one of the
 * languages: when the stored one is not, the first language stands in.
 */
export function readPlatformSettings(rows: ReadonlyArray<{ key: string; value: unknown }>): PlatformSettings {
  const settings = defaultPlatformSettings();
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  // A list with an entry that is not text keeps the entries that are (the cleaning drops the rest).
  const reserved = z.array(z.unknown()).safeParse(stored.get('reservedSlugs'));
  if (reserved.success) settings.reservedSlugs = normalizeReservedSlugs(reserved.data);

  const sender = senderNameField.safeParse(stored.get('emailSenderName'));
  if (sender.success) settings.emailSenderName = sender.data;

  const defaults = storedDefaults.safeParse(stored.get('defaults'));
  if (defaults.success) {
    const { locales, defaultLocale, currency, timezone } = defaults.data;
    if (locales) settings.defaults.locales = locales;
    if (defaultLocale) settings.defaults.defaultLocale = defaultLocale;
    if (currency) settings.defaults.currency = currency;
    if (timezone) settings.defaults.timezone = timezone;
  }
  if (!settings.defaults.locales.includes(settings.defaults.defaultLocale)) {
    settings.defaults.defaultLocale = settings.defaults.locales[0] ?? 'en';
  }
  return settings;
}

/**
 * Each stored value of `settings`, by key and in the form it is stored in. Compared by `JSON.stringify`, so the order of
 * a list (the reserved words, the languages) is part of a value.
 */
export function settingValues(settings: PlatformSettings): Record<SettingKey, unknown> {
  return { reservedSlugs: settings.reservedSlugs, emailSenderName: settings.emailSenderName, defaults: settings.defaults };
}
