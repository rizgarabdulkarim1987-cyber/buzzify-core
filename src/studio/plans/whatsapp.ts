import type { Translate } from '@/lib/i18n';
import type { FeatureKey } from '@/server/domain/entitlements';
import type { UpgradeInfo } from '@/server/studio/services/plans';

/**
 * The upgrade button's link (spec: plans and entitlements, 8.3): a WhatsApp chat with the platform owner's number, with
 * a message ready to send that names the restaurant, the feature and the plan, in the reader's language.
 */

/** A chat with `digits` (the number with its country code) and `text` typed in. */
export function upgradeLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** The message: who wants what, and the plan that has it when one does. */
export function upgradeMessage(t: Translate, info: UpgradeInfo, feature: FeatureKey): string {
  const plan = info.lowest[feature];
  // The feature's name is quoted in the message, so it reads as written in every language.
  const vars = { feature: t(`plans.feature.${feature}`), restaurant: info.restaurantName };
  return plan ? t('upgrade.message', { ...vars, plan: info.planNames[plan] }) : t('upgrade.messageNoPlan', vars);
}
