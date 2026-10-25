import { canPos, type PosRole } from './permissions';

/**
 * Who sees which part of the AI package (pure). Everything but the owner's package page is hidden while the package is off:
 * no disabled button, no teaser. The permissions are the ones of the data each feature reads.
 */
export interface AiVisibility {
  nav: boolean;
  ask: boolean;
  summary: boolean;
  alerts: boolean;
  supplyEntry: boolean;
  complaintLabels: boolean;
  /** The package page tells the owner whether the package is on, so it exists in both states. */
  packagePage: boolean;
}

export function aiVisibility(role: PosRole, enabled: boolean): AiVisibility {
  const report = enabled && canPos(role, 'report.view');
  return {
    nav: report,
    ask: report,
    summary: report,
    alerts: report,
    supplyEntry: enabled && canPos(role, 'purchase.manage'),
    complaintLabels: enabled && canPos(role, 'complaint.manage'),
    packagePage: canPos(role, 'settings.manage'),
  };
}

export const AI_LOCALES = ['ar', 'ckb', 'en'] as const;
export type AiLocale = (typeof AI_LOCALES)[number];
