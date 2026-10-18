import { allows, lowestPlanWith, type Entitlements, type FeatureKey, type Plans } from '@/server/domain/entitlements';
import { upgradeRequired } from './result';

/**
 * What the framework knows about the target restaurant's plan, next to the person's permissions: its entitlements, and
 * the plans (for naming the lowest one that includes a refused feature). Null on platform and self targets.
 */
export interface PlanAccess {
  entitlements: Entitlements;
  plans: Plans;
}

/**
 * Refuses, with `UPGRADE_REQUIRED` and the lowest plan that includes it, a feature the target restaurant's plan lacks.
 * For a handler whose need depends on its input (the brand save choosing a font pair); a definition's own `feature` is
 * checked by the framework before the handler runs. Without a restaurant there is no plan, and that is a bug.
 */
export function requireFeature(plan: PlanAccess | null, key: FeatureKey): void {
  if (plan === null) throw new Error(`requireFeature(${key}) needs a restaurant or menu target`);
  if (!allows(plan.entitlements, key)) throw upgradeRequired({ feature: key, plan: lowestPlanWith(plan.plans, key) });
}
