import { PLAN_TIERS } from '@/server/domain/entitlements';

/** The products a restaurant can subscribe to. */
export const APPLICATION_IDS = ['menu', 'cashier', 'pharmacy', 'retail'] as const;
export type ApplicationId = (typeof APPLICATION_IDS)[number];

/**
 * The plan codes the Menu and the Cashier sell: the same three tiers; only the Menu's move the restaurant's plan. The
 * Pharmacy and Retail have no fixed codes: their plans are `AppPlan` rows (`sellablePlanCodes`, in the billing service).
 */
export function planCodesFor(applicationId: ApplicationId): readonly string[] {
  return applicationId === 'pharmacy' || applicationId === 'retail' ? [] : PLAN_TIERS;
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
  { id: 'pharmacy', name: { en: 'Pharmacy', ar: 'الصيدلية', ckb: 'دەرمانخانە' }, status: 'DISABLED', sortOrder: 3 },
  { id: 'retail', name: { en: 'Retail', ar: 'التجزئة', ckb: 'تاکفرۆشی' }, status: 'DISABLED', sortOrder: 4 },
];
