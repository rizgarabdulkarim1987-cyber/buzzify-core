import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import type { StudioFailure } from '@/server/studio/framework/result';

/**
 * The server's refusals, by their English text, and the Studio message that says each in the person's language. The
 * server answers in English (its `message` and its `fields` are also what the logs read); the Studio never shows that
 * English on an Arabic or Sorani page. tests/studio/messages.test.ts scans the server code for refusals missing here.
 */
export const SERVER_TEXT: Readonly<Record<string, string>> = {
  // The framework's defaults, one per code
  'Sign in to continue': 'error.UNAUTHENTICATED',
  'Set up two-factor authentication to continue': 'error.TWO_FACTOR_REQUIRED',
  'You do not have permission to do this': 'error.FORBIDDEN',
  'Not found': 'error.NOT_FOUND',
  'Check the highlighted fields': 'error.INVALID',
  'Someone else changed this while you were editing. Reload to see their changes.': 'error.CONFLICT',
  'Too many attempts. Try again later.': 'error.RATE_LIMITED',
  'Something went wrong': 'error.unexpected',

  // Signing in, two-factor, passwords
  'Wrong email or password': 'error.text.signInFailed',
  'Your sign-in has expired. Sign in again.': 'error.text.signInExpired',
  'Enter a valid email address': 'error.text.emailInvalid',
  'This is already your email address': 'error.text.emailSame',
  'This is already their email address': 'error.text.emailSameTheirs',
  'An account with this email already exists': 'error.text.emailTaken',
  'Change your own address on your account page, where both addresses confirm it': 'error.text.emailOwnOnAccount',
  'Enter your password': 'error.text.passwordEnter',
  'That password is too long': 'error.text.passwordInputTooLong',
  'That password is not correct': 'error.text.passwordWrong',
  'Choose a password': 'error.text.passwordChoose',
  'Use at least 12 characters': 'error.text.passwordTooShort',
  'Use at most 128 characters': 'error.text.passwordTooLong',
  'This password is too common. Choose one that is harder to guess': 'error.text.passwordCommon',
  'Enter your name': 'error.text.nameEnter',
  'Use at most 120 characters': 'error.text.nameTooLong',
  'That code is not correct': 'error.text.codeWrong',
  'Enter the 6-digit code': 'error.text.codeFormat',
  'Enter the 6-digit code or a recovery code': 'error.text.codeOrRecoveryFormat',
  'Start the setup again': 'error.text.setupRestart',
  'Two-factor authentication is already on': 'error.text.twoFactorOn',
  'Two-factor authentication is not on': 'error.text.twoFactorOff',
  'Super Admins must keep two-factor authentication on': 'error.text.twoFactorKeep',
  'Choose one of the languages offered': 'error.text.languageChoose',
  'This link has expired or was already used. Ask for a new one.': 'error.text.resetLinkInvalid',

  // Invitations and people
  'This invitation has expired. Ask for a new one': 'error.text.inviteExpired',
  'This invitation was already used': 'error.text.inviteUsed',
  'This invitation is no longer valid': 'error.text.inviteRevoked',
  'This invitation link is not valid': 'error.text.inviteUnknown',
  'Sign in with the invited account to accept this invitation': 'error.text.inviteSignIn',
  'This invitation is for another account. Sign out and open the link again.': 'error.text.inviteOtherAccount',
  'An account with this address was just created. Sign in and open the link again': 'error.text.inviteAccountCreated',
  'This address already has a pending invitation. Resend it instead': 'error.text.invitePending',
  'This invitation was used or withdrawn in the meantime': 'error.text.inviteChanged',
  'This person already has access to this restaurant': 'error.text.personHasAccess',
  'This person already has an account. Assign them to a client instead': 'error.text.personHasAccount',
  'This person is already a Super Admin': 'error.text.personIsSuperAdmin',
  'There must always be one active Super Admin': 'error.text.lastSuperAdmin',
  'This account is already deactivated': 'error.text.alreadyDeactivated',
  'This account is not deactivated': 'error.text.notDeactivated',
  'You cannot deactivate your own account': 'error.text.deactivateSelf',
};

/** What a form shows for a failed action: one message for the form, and one per field it names. */
export interface DescribedFailure {
  code: StudioFailure['code'];
  message: string;
  fields: Record<string, string>;
}

/** Details the server sends in `fields` that are not about a field the person filled in. */
const DETAILS = new Set(['retryAfterSec']);

/**
 * A failure in the person's language. A text the catalog knows is shown in its wording; one it does not know is shown
 * as is in English, and as the general message for its code (or for a field) in Arabic and Sorani, never in English.
 */
export function describeFailure(t: Translate, locale: Locale, failure: StudioFailure): DescribedFailure {
  const say = (text: string, fallbackKey: string) => {
    const key = SERVER_TEXT[text];
    if (key) return t(key);
    return locale === 'en' ? text : t(fallbackKey);
  };

  let message = say(failure.message, `error.${failure.code}`);
  const retryAfter = Number(failure.fields?.retryAfterSec);
  if (failure.code === 'RATE_LIMITED' && Number.isFinite(retryAfter) && retryAfter > 0) {
    message = t('error.retryIn', { count: Math.ceil(retryAfter / 60) });
  }

  const fields: Record<string, string> = {};
  for (const [name, text] of Object.entries(failure.fields ?? {})) {
    if (!DETAILS.has(name)) fields[name] = say(text, 'error.field');
  }
  return { code: failure.code, message, fields };
}
