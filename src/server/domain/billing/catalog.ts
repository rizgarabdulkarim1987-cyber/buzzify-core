import { PLAN_TIERS } from '@/server/domain/entitlements';

/** The products a restaurant can subscribe to. */
export const APPLICATION_IDS = ['menu', 'cashier'] as const;
export type ApplicationId = (typeof APPLICATION_IDS)[number];

/** The plan codes an application sells: the Menu's three tiers; the Cashier has none yet. */
export function planCodesFor(applicationId: ApplicationId): readonly string[] {
  return applicationId === 'menu' ? PLAN_TIERS : [];
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
