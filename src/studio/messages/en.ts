import type { Messages } from '@/lib/i18n';

const en: Messages = {
  // Email: shared parts
  'email.greeting': 'Hello {name},',
  'email.greetingNoName': 'Hello,',
  'email.linkFallback': 'If the button does not work, copy this link into your browser:',
  'email.footer': 'You received this email because of activity on a Buzzify Studio account.',

  // Email: invitation
  'email.invite.subject': 'You are invited to Buzzify Studio',
  'email.invite.intro': '{inviter} has invited you to join Buzzify Studio.',
  'email.invite.introNoInviter': 'You have been invited to join Buzzify Studio.',
  'email.invite.restaurant': 'Restaurant: {restaurant}',
  'email.invite.role': 'Your role: {role}',
  'email.invite.action': 'Accept the invitation',
  'email.invite.expiry': 'This link can be used once and expires in 7 days.',
  'email.invite.ignore': 'If you were not expecting this invitation, you can ignore this email.',

  // Email: password reset
  'email.reset.subject': 'Reset your Buzzify Studio password',
  'email.reset.intro': 'We received a request to reset the password of your Buzzify Studio account.',
  'email.reset.action': 'Choose a new password',
  'email.reset.expiry': 'This link can be used once and expires in 1 hour.',
  'email.reset.ignore': 'If you did not ask for this, ignore this email. Your password stays the same.',

  // Email: changing the sign-in address, step one (sent to the current address)
  'email.changeEmailConfirm.subject': 'Approve the change of your Buzzify Studio email',
  'email.changeEmailConfirm.intro':
    'You asked to change the email of your Buzzify Studio account to {newEmail}. Approve the change to continue.',
  'email.changeEmailConfirm.action': 'Approve the change',
  'email.changeEmailConfirm.ignore': 'If you did not ask for this, ignore this email. Your address stays the same.',

  // Email: changing the sign-in address, step two (sent to the new address)
  'email.verifyNewEmail.subject': 'Confirm your new Buzzify Studio email address',
  'email.verifyNewEmail.intro':
    'Confirm that this address is yours to finish changing the email you sign in with at Buzzify Studio.',
  'email.verifyNewEmail.action': 'Confirm this email address',
  'email.verifyNewEmail.ignore': 'If you did not ask for this, you can ignore this email.',

  // Email: notice to the old address after the change
  'email.emailChanged.subject': 'Your Buzzify Studio email was changed',
  'email.emailChanged.intro': 'The email of your Buzzify Studio account was changed to {newEmail}.',
  'email.emailChanged.warning': 'If you did not make this change, contact your Buzzify Studio administrator right away.',

  // Email: notice after a password change
  'email.passwordChanged.subject': 'Your Buzzify Studio password was changed',
  'email.passwordChanged.intro': 'The password of your Buzzify Studio account was just changed.',
  'email.passwordChanged.warning':
    'If you did not make this change, reset your password now and contact your Buzzify Studio administrator.',
};

export default en;
