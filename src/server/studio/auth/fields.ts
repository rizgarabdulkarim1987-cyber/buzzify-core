import { z } from 'zod';
import { normalizeEmail } from './users';

/**
 * The input fields the account and sign-in actions share. A message here is what the form shows beside the field (in
 * English; the Studio shows its own wording for the error code). Fields that carry a secret are length-capped so a
 * hostile caller cannot make the server hash a megabyte, but their content is never inspected beyond what is said.
 */

/** An email address typed by a person: trimmed and lower-cased, then checked. */
export const emailField = z
  .string()
  .max(254, 'Enter a valid email address')
  .transform(normalizeEmail)
  .pipe(z.email('Enter a valid email address'));

/** A password that exists already (sign-in, a check before a sensitive change). Only its length is checked. */
export const currentPasswordField = z.string().min(1, 'Enter your password').max(1024, 'That password is too long');

/**
 * A password somebody is choosing. Its length is capped here and everything else is the password policy's (the handler
 * runs `checkPasswordPolicy` and answers with its reason), so a too-short one gets the policy's message.
 */
export const newPasswordField = z.string().max(1024, 'Use at most 128 characters');

/** A six-digit code from an authenticator app, typed with or without spaces. */
export const totpCodeField = z
  .string()
  .max(64, 'Enter the 6-digit code')
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

const RECOVERY_CODE = /^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/;

/** Whether `code` has the shape of one of the ten recovery codes (`xxxxx-xxxxx`). */
export const isRecoveryCode = (code: string): boolean => RECOVERY_CODE.test(code);

/** The second step of signing in: a six-digit code, or a recovery code. */
export const signInCodeField = z
  .string()
  .max(64, 'Enter the 6-digit code or a recovery code')
  .transform((value) => {
    const trimmed = value.trim();
    return isRecoveryCode(trimmed) ? trimmed : trimmed.replace(/\s+/g, '');
  })
  .pipe(z.string().regex(/^(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/, 'Enter the 6-digit code or a recovery code'));
