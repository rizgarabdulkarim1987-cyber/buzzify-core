import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkPasswordPolicy,
  isCommonPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/server/studio/auth/password-policy';

const LIST = 'src/server/studio/auth/common-passwords.txt';

describe('checkPasswordPolicy', () => {
  it('refuses a password shorter than the minimum', () => {
    expect(checkPasswordPolicy('short')).toBe('TOO_SHORT');
    expect(checkPasswordPolicy('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('TOO_SHORT');
    expect(checkPasswordPolicy('')).toBe('TOO_SHORT');
  });

  it('accepts a password of exactly the minimum and the maximum length', () => {
    expect(checkPasswordPolicy('qZ7!vK2#mR9$')).toBeNull();
    expect(checkPasswordPolicy('k'.repeat(MAX_PASSWORD_LENGTH - 1) + 'Q')).toBeNull();
  });

  it('refuses a password longer than the maximum', () => {
    expect(checkPasswordPolicy('k'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('TOO_LONG');
  });

  it('matches the limits Better Auth enforces on its own routes (12 and 128)', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(MAX_PASSWORD_LENGTH).toBe(128);
  });

  it('refuses a common password even when it is long enough', () => {
    expect(checkPasswordPolicy('password1234')).toBe('COMMON');
    expect(checkPasswordPolicy('unbelievable')).toBe('COMMON'); // a word in the list that is 12 characters long
    expect(checkPasswordPolicy('contortionist')).toBe('COMMON');
  });

  it('compares in lower case', () => {
    expect(checkPasswordPolicy('UnBelievable')).toBe('COMMON');
    expect(checkPasswordPolicy('PASSWORD1234')).toBe('COMMON');
  });

  it('refuses a common word followed only by digits or punctuation, the commonest way of lengthening one', () => {
    expect(checkPasswordPolicy('Password1234!')).toBe('COMMON');
    expect(checkPasswordPolicy('monkey2026#!!')).toBe('COMMON');
    expect(checkPasswordPolicy('dragon20262026')).toBe('COMMON');
  });

  it('accepts a passphrase and passwords in other scripts', () => {
    expect(checkPasswordPolicy('correct horse battery staple')).toBeNull();
    expect(checkPasswordPolicy('عصير البرتقال الطازج كل صباح')).toBeNull();
    expect(checkPasswordPolicy('پاسۆردی تایبەتی من هەیە')).toBeNull();
  });

  it('does not treat a word inside a longer phrase as common', () => {
    expect(checkPasswordPolicy('password manager is great')).toBeNull();
    expect(checkPasswordPolicy('monkey 1 banana 2 river')).toBeNull();
  });

  it('reports the length problem before the common-list problem', () => {
    expect(checkPasswordPolicy('password')).toBe('TOO_SHORT');
  });

  it('counts length the way Better Auth does, in UTF-16 code units', () => {
    // 6 emoji = 12 code units: long enough for Better Auth, so long enough here.
    expect(checkPasswordPolicy('🔑🌲🦊🔥🌊🎲')).toBeNull();
  });
});

describe('common-passwords.txt', () => {
  const lines = readFileSync(LIST, 'utf8').split(/\r?\n/);

  it('names its source and MIT licence on the first line, which is a comment the loader skips', () => {
    expect(lines[0]).toMatch(/^#/);
    expect(lines[0]).toContain('SecLists');
    expect(lines[0]).toContain('10k-most-common.txt');
    expect(lines[0]).toMatch(/MIT/);
  });

  it('holds the 10,000 most common passwords after the header', () => {
    const entries = lines.slice(1).filter(Boolean);
    expect(entries.length).toBeGreaterThanOrEqual(10_000);
    expect(entries).toContain('qwertyuiop');
  });

  it('does not treat the header as a password', () => {
    expect(isCommonPassword(lines[0] as string)).toBe(false);
    expect(isCommonPassword('password')).toBe(true);
  });
});
