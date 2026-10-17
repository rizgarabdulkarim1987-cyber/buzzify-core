/**
 * Every action name the Studio writes to the audit log, in the order the Activity filter lists them. Each has a label in
 * the Studio's message catalog (`activity.action.<name>`) in every language; a test fails when the code writes a name
 * this list lacks, or this list names one without a label.
 */
export const AUDIT_ACTIONS = [
  'restaurant.created',
  'restaurant.updated',
  'restaurant.status_changed',
  'restaurant.permission_policy_changed',
  'restaurant.deleted',
  'branch.created',
  'branch.updated',
  'branch.reordered',
  'branch.deleted',
  'menu.created',
  'menu.published',
  'menu.status_changed',
  'menu.slug_changed',
  'menu.duplicated',
  'menu.deleted',
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'membership.assigned',
  'membership.removed',
  'user.deactivated',
  'user.reactivated',
  'user.email_changed',
  'settings.updated',
  'account.password_changed',
  'account.password_reset',
  'account.email_change_requested',
  'account.language_changed',
  'account.two_factor_enabled',
  'account.two_factor_disabled',
  'account.recovery_codes_regenerated',
  'account.recovery_code_used',
  'account.session_ended',
  'account.other_sessions_ended',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The kinds of row the audit log names (its `entityType`), each with a label (`activity.entity.<type>`). */
export const AUDIT_ENTITY_TYPES = [
  'Restaurant',
  'RestaurantStatus',
  'Branch',
  'BranchOrder',
  'Menu',
  'MenuStatus',
  'User',
  'Invitation',
  'Session',
  'PlatformSetting',
] as const;
