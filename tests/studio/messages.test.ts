import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/locale';
import { PERMISSIONS } from '@/server/domain/permissions';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordProblemMessage } from '@/server/studio/auth/password-policy';
import type { ErrorCode } from '@/server/studio/framework/result';
import { slugMessage } from '@/server/studio/services/menus';
import { SERVER_TEXT } from '@/studio/errors';
import { STUDIO_MESSAGES, getStudioTranslator } from '@/studio/messages';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Every `ErrorCode`, listed through a type that fails to compile when a code is added without being listed here. */
const ERROR_CODES = Object.keys({
  UNAUTHENTICATED: true,
  TWO_FACTOR_REQUIRED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID: true,
  CONFLICT: true,
  RATE_LIMITED: true,
  UPGRADE_REQUIRED: true,
} satisfies Record<ErrorCode, true>) as ErrorCode[];

describe('studio messages', () => {
  const englishKeys = Object.keys(STUDIO_MESSAGES.en);

  it('has every English key in Arabic and Sorani', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      const missing = englishKeys.filter((key) => !(key in STUDIO_MESSAGES[locale]) && !PLURAL.test(key));
      expect(missing, `${locale} is missing keys`).toEqual([]);
    }
  });

  it('has no key in Arabic or Sorani that English lacks', () => {
    const english = new Set(englishKeys.map(base));
    for (const locale of ['ar', 'ckb'] as const) {
      const extra = Object.keys(STUDIO_MESSAGES[locale]).filter((key) => !english.has(base(key)));
      expect(extra, `${locale} has keys English does not`).toEqual([]);
    }
  });

  it('provides an "other" plural form wherever English has plural forms', () => {
    const pluralBases = new Set(englishKeys.filter((key) => PLURAL.test(key)).map(base));
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const key of pluralBases) expect(STUDIO_MESSAGES[locale][`${key}_other`], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('uses the same placeholders as English for non-plural messages', () => {
    for (const key of englishKeys.filter((k) => !PLURAL.test(k))) {
      for (const locale of ['ar', 'ckb'] as const) {
        expect(placeholders(STUDIO_MESSAGES[locale][key] as string), `${locale} ${key}`).toEqual(
          placeholders(STUDIO_MESSAGES.en[key] as string),
        );
      }
    }
  });

  it('has no empty strings', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const [key, value] of Object.entries(STUDIO_MESSAGES[locale])) {
        expect(value.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('translates with interpolation in every language', () => {
    expect(getStudioTranslator('en')('email.greeting', { name: 'Lina' })).toBe('Hello Lina,');
    expect(getStudioTranslator('ar')('email.greeting', { name: 'Lina' })).toContain('Lina');
    expect(getStudioTranslator('ckb')('email.greeting', { name: 'Lina' })).toContain('Lina');
  });

  it('has the groups of keys the Studio is built from', () => {
    for (const group of ['nav.', 'common.', 'auth.', 'account.', 'email.', 'status.', 'permission.', 'error.', 'role.']) {
      expect(englishKeys.some((key) => key.startsWith(group)), group).toBe(true);
    }
  });

  it('labels every permission key in every language', () => {
    for (const locale of LOCALES) {
      const missing = PERMISSIONS.filter((key) => !STUDIO_MESSAGES[locale][`permission.${key}`]);
      expect(missing, locale).toEqual([]);
    }
  });

  it('labels every error code in every language', () => {
    for (const locale of LOCALES) {
      const missing = ERROR_CODES.filter((code) => !STUDIO_MESSAGES[locale][`error.${code}`]);
      expect(missing, locale).toEqual([]);
    }
  });
});

/**
 * The server answers in English (`StudioFailure.message` and `fields`); the Studio shows its own wording, found by that
 * English text in `SERVER_TEXT`. These tests keep the two in step: a message added on the server without a translation
 * fails here instead of reaching an Arabic page in English.
 */
describe('server texts', () => {
  const ROOT = process.cwd();
  const files = (dir: string) =>
    readdirSync(path.join(ROOT, dir))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `${dir}/${name}`);

  /** The server code whose refusals reach a person: actions, public actions, services, field rules and the defaults. */
  const SOURCES = [
    ...files('src/server/studio/actions'),
    ...files('src/server/studio/public-actions'),
    ...files('src/server/studio/queries'),
    ...files('src/server/studio/services'),
    ...files('src/server/pharmacy'),
    ...files('src/server/pharmacy/actions'),
    ...files('src/server/pharmacy/queries'),
    ...files('src/server/pharmacy/intake'),
    'src/server/studio/auth/fields.ts',
    'src/server/studio/auth/password-policy.ts',
    'src/server/studio/framework/result.ts',
  ];

  /** Sentences in those files that are never shown: errors for programmers, and the role name in mail. */
  const NOT_SHOWN = new Set([
    'A Super Admin invitation is not for a restaurant',
    'An invitation names a restaurant and a role together, or neither',
    'Better Auth gave a two-factor link without a key',
    'Better Auth started a two-factor method other than an authenticator app',
    'A restaurant action ran without a restaurant',
    'A restaurant query ran without a restaurant',
    'A menu action ran without a menu',
    'A menu import ran without a menu',
    'A menu import ran without a restaurant',
    'A menu action ran without a restaurant',
    'A menu query ran without a menu',
    'A media action ran without a restaurant',
    'A till action ran without a till',
    'A till query ran without a restaurant',
    'A menu action ran without its restaurant’s plan',
    'The brand kit is saved on a menu, whose restaurant has a plan',
    'A design is saved on a menu, whose restaurant has a plan',
    'An audit entry names a restaurant other than its target',
    'A pharmacy definition ran without its pharmacy',
    'Invoice storage is not configured',
    'An intake storage key is made from plain ids',
    'Not an intake storage key',
    'A pharmacy needs at least one branch',
    'A pharmacy needs at least one currency',
    'Import defaults passed the input schema but not the row rules',
    'A list of products is created without shared barcodes',
    'An owner invitation needs the person sending it',
    'Super Admin',
  ]);

  /** Single-quoted literals that read as a sentence: a capital letter, then at least one space. */
  const sentences = (source: string) => [...source.matchAll(/'([A-Z][^'\n]* [^'\n]*)'/g)].map((match) => match[1]!);

  it('translates every message the Studio server code can answer with', () => {
    const found = new Set(SOURCES.flatMap((file) => sentences(readFileSync(path.join(ROOT, file), 'utf8'))));
    const untranslated = [...found].filter((text) => !NOT_SHOWN.has(text) && !(text in SERVER_TEXT));
    expect(untranslated).toEqual([]);
    expect(found.size).toBeGreaterThan(20);
  });

  it('translates the password policy and length messages built from numbers', () => {
    for (const problem of ['TOO_SHORT', 'TOO_LONG', 'COMMON'] as const) {
      expect(SERVER_TEXT[passwordProblemMessage(problem)], problem).toBeTruthy();
    }
    expect(SERVER_TEXT[`Use at least ${MIN_PASSWORD_LENGTH} characters`]).toBeTruthy();
    expect(SERVER_TEXT[`Use at most ${MAX_PASSWORD_LENGTH} characters`]).toBeTruthy();
    expect(SERVER_TEXT['Use at most 120 characters']).toBeTruthy();
  });

  it('translates every slug problem, including those built from the length limits', () => {
    for (const problem of ['taken', 'RESERVED', 'TOO_SHORT', 'TOO_LONG', 'BAD_CHARACTERS'] as const) {
      expect(SERVER_TEXT[slugMessage(problem)], problem).toBeTruthy();
    }
  });

  it('points every server text at a message that exists in every language', () => {
    for (const [text, key] of Object.entries(SERVER_TEXT)) {
      for (const locale of LOCALES) expect(STUDIO_MESSAGES[locale][key], `${locale} ${key} (${text})`).toBeTruthy();
    }
  });

  it('says in English what the server says, for the texts that are plain sentences', () => {
    // The English catalog may word a refusal better than the server; it must not lose a placeholder-free text's meaning
    // by pointing at an unrelated key. Spot-check the ones a person meets first.
    const en = getStudioTranslator('en');
    expect(en(SERVER_TEXT['Wrong email or password']!)).toBe('Wrong email or password');
    expect(en(SERVER_TEXT['That code is not correct']!)).toBe('That code is not correct');
    expect(en(SERVER_TEXT['Enter a valid email address']!)).toBe('Enter a valid email address');
  });
});

describe('the browse shape messages', () => {
  const keys = ['design.layout.body', 'design.body.scroll', 'design.body.book', 'design.body.magazine', 'design.body.board', 'design.setByShape'];

  it.each(['en', 'ar', 'ckb'] as const)('%s has the body label, every shape name and the set-by-shape line', (locale) => {
    for (const key of keys) expect(STUDIO_MESSAGES[locale][key], key).toBeTruthy();
    expect(STUDIO_MESSAGES[locale]['design.setByShape']).toContain('{shape}');
  });
});
