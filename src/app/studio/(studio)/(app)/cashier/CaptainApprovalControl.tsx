'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setPosCaptainApproval } from '@/app/studio/_actions/pos-captain';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';

/** The Super Admin's switch for one restaurant's captain approval step. Every change is audited by the action. */
export function CaptainApprovalControl({ restaurantId, enabled }: { restaurantId: string; enabled: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  async function save() {
    setBusy(true);
    const result = await settle(() => setPosCaptainApproval({ restaurantId, enabled: !enabled }));
    setBusy(false);
    if (!result.ok) return void toast.error(describeFailure(t, locale, result.error).message);
    toast.success(t('cashierOverview.captainSaved'));
    startRefresh(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-16 text-text">{enabled ? t('cashierOverview.captainOn') : t('cashierOverview.captainOff')}</span>
      <Button size="md" variant={enabled ? 'secondary' : 'primary'} pending={busy || refreshing} onClick={() => void save()}>
        {enabled ? t('cashierOverview.captainSwitchOff') : t('cashierOverview.captainSwitchOn')}
      </Button>
    </div>
  );
}
