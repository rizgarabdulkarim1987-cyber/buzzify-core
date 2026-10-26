import { PLAN_TIERS } from '@/server/domain/entitlements';

/** The products a restaurant can subscribe to. */
export const APPLICATION_IDS = ['menu', 'cashier'] as const;
export type ApplicationId = (typeof APPLICATION_IDS)[number];

/** The plan codes an application sells: the same three tiers for the Menu and the Cashier; only the Menu's move the restaurant's plan. */
export function planCodesFor(_applicationId: ApplicationId): readonly string[] {
  return PLAN_TIERS;
}

export interface DefaultApplication {
  id: ApplicationId;
  /** The ar and ckb names are machine-drafted. */
  name: { en: string; ar: string; ckb: string };
  status: 'ACTIVE' | 'DISABLED';
  sortOrder: number;
}

export const DEFAULT_APPLICATIONS: readonly DefaultApplication[] = [
  { id: 'menu', name: { en: 'Menu', ar: 'المنيو', ckb: 'مێنو' }, status: 'ACTIVE', sortOrder: 1 },
  { id: 'cashier', name: { en: 'Cashier', ar: 'الكاشير', ckb: 'کاشێر' }, status: 'DISABLED', sortOrder: 2 },
];
