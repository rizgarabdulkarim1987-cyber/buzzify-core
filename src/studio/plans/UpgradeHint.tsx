'use client';

import { Lock, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import type { FeatureKey } from '@/server/domain/entitlements';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import { useT } from '@/studio/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { cx } from '@/studio/ui/cx';
import { upgradeLink, upgradeMessage } from './whatsapp';

/**
 * What stands in for a control the restaurant's plan does not include (spec: plans and entitlements, 8.3): a lock and
 * "Part of Pro", then the way to get it. The platform owner gets "Change plan", which opens the restaurant's Plan tab;
 * everyone else gets a WhatsApp chat with the owner, a message naming the restaurant and the feature already typed,
 * or the sentence alone until the owner has set a number. Never an error: the person may use the tool, the restaurant
 * has not bought it.
 */
export function UpgradeHint({ feature, info, className }: { feature: FeatureKey; info: UpgradeInfo; className?: string }) {
  const t = useT();
  const plan = info.lowest[feature];
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 text-sm', className)}>
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Lock aria-hidden className="size-3.5 shrink-0" />
        {plan ? t('upgrade.partOf', { plan: info.planNames[plan] }) : t('upgrade.notInPlan')}
      </span>
      <UpgradeAction feature={feature} info={info} />
    </div>
  );
}

/** The way to get a feature: "Change plan" for the platform owner, the WhatsApp chat for anyone else, or nothing. */
export function UpgradeAction({ feature, info }: { feature: FeatureKey; info: UpgradeInfo }) {
  const t = useT();
  if (info.isOwner) {
    return (
      <Link href={info.planTabHref} className={buttonClasses('secondary', 'sm')}>
        {t('upgrade.changePlan')}
      </Link>
    );
  }
  if (!info.whatsapp) return null;
  return (
    <a
      href={upgradeLink(info.whatsapp, upgradeMessage(t, info, feature))}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses('secondary', 'sm')}
    >
      <MessageCircle aria-hidden />
      {t('upgrade.whatsapp')}
    </a>
  );
}

/** A lock beside a choice the plan does not include, with the plan named for screen readers. */
export function LockMark({ feature, info }: { feature: FeatureKey; info: UpgradeInfo }) {
  const t = useT();
  const plan = info.lowest[feature];
  return (
    <span className="inline-flex items-center text-muted">
      <Lock aria-hidden className="size-3" />
      <span className="sr-only">{plan ? t('upgrade.partOf', { plan: info.planNames[plan] }) : t('upgrade.notInPlan')}</span>
    </span>
  );
}
