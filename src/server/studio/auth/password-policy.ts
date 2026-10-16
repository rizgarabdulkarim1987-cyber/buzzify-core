import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Better Auth enforces the same limits on its own change, set and reset password routes (`emailAndPassword` in auth.ts). */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'COMMON';

/** The password does not meet the policy; `reason` says how. */
export class PasswordPolicyError extends Error {
  constructor(readonly reason: PasswordProblem) {
    super(`The password is not acceptable: ${reason}`);
    this.name = 'PasswordPolicyError';
  }
}

let common: ReadonlySet<string> | undefined;

/**
 * The 10,000 most common passwords (SecLists, MIT licence: the file's first line says so and is skipped). Read on first
 * use. Resolved from the working directory like the development mail folder, which is where `next start`, the tests
 * and the seed all run.
 */
function commonPasswords(): ReadonlySet<string> {
  common ??= new Set(
    readFileSync(path.join(process.cwd(), 'src', 'server', 'studio', 'auth', 'common-passwords.txt'), 'utf8')
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  );
  return common;
}

/**
 * Whether the password is on the list in lower case, or is a listed word followed only by digits and punctuation
 * (`Password1234!`): the usual way of stretching a common password to a required length.
 */
export function isCommonPassword(password: string): boolean {
  const list = commonPasswords();
  const lower = password.toLowerCase();
  if (list.has(lower)) return true;
  const stem = lower.replace(/[^\p{L}]+$/u, '');
  return stem !== '' && stem !== lower && list.has(stem);
}

/**
 * Why a password is not acceptable, or `null`. Length is counted in UTF-16 code units, as Better Auth counts it, so a
 * password this accepts is never refused by its change or reset routes.
 */
export function checkPasswordPolicy(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'TOO_SHORT';
  if (password.length > MAX_PASSWORD_LENGTH) return 'TOO_LONG';
  if (isCommonPassword(password)) return 'COMMON';
  return null;
}

const PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  TOO_SHORT: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
  TOO_LONG: `Use at most ${MAX_PASSWORD_LENGTH} characters`,
  COMMON: 'This password is too common. Choose one that is harder to guess',
};

/** What a form shows next to the password field for a problem `checkPasswordPolicy` found. */
export function passwordProblemMessage(problem: PasswordProblem): string {
  return PROBLEM_MESSAGES[problem];
}
