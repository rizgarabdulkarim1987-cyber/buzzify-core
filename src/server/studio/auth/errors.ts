import { isAPIError } from 'better-auth/api';
import type { PasswordProblem } from './password-policy';

/**
 * The stable code of a failure that Better Auth raised (`INVALID_PASSWORD`, `INVALID_CODE`, `PASSWORD_POLICY`, ...), or
 * `null` for anything else. The Studio's actions map these codes to their own results and let every other error through
 * to the framework, which logs it and answers a generic failure.
 */
export function authErrorCode(error: unknown): string | null {
  if (!isAPIError(error)) return null;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

const PROBLEMS: readonly PasswordProblem[] = ['TOO_SHORT', 'TOO_LONG', 'COMMON'];

/**
 * Why Better Auth's `PASSWORD_POLICY` refusal (the hook in `auth.ts`) turned a password down. The actions check the
 * policy first and say why, so this is the second layer's answer for a password that got past them.
 */
export function policyProblemOf(error: unknown): PasswordProblem {
  const reason = isAPIError(error) ? (error.body as { reason?: unknown } | undefined)?.reason : undefined;
  return PROBLEMS.find((problem) => problem === reason) ?? 'COMMON';
}
