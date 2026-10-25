'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setPosAiPackage } from '@/app/studio/_actions/pos-ai';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Input } from '@/studio/ui/Input';

/**
 * The Super Admin's switch for one restaurant's AI package: on or off, and how many requests a month. Payment is arranged by
 * hand outside the app; this only records what was agreed. Every change is audited by the action.
 */
export function AiPackageControl({ restaurantId, enabled, limit, used }: { restaurantId: string; enabled: boolean; limit: number; used: number }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [value, setValue] = useState(String(limit > 0 ? limit : 50));
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const parsed = /^\d{1,7}$/.test(value.trim()) ? Number(value.trim()) : null;

  async function save(next: { enabled: boolean; monthlyLimit?: number }) {
    setBusy(true);
    const result = await settle(() => setPosAiPackage({ restaurantId, ...next }));
    setBusy(false);
    if (!result.ok) return void toast.error(describeFailure(t, locale, result.error).message);
    toast.success(t('cashierOverview.aiSaved'));
    startRefresh(() => router.refresh());
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <span className="min-w-28 text-text">{enabled ? t('cashierOverview.aiOn', { used, limit }) : t('cashierOverview.aiOff')}</span>
      <label className="flex flex-col gap-1 text-sm text-muted">
        {t('cashierOverview.aiLimit')}
        <Input inputMode="numeric" dir="ltr" className="w-24" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Button size="md" pending={busy || refreshing} disabled={parsed === null} onClick={() => void save({ enabled, ...(parsed === null ? {} : { monthlyLimit: parsed }) })}>
        {t('cashierOverview.aiSaveLimit')}
      </Button>
      <Button size="md" variant={enabled ? 'secondary' : 'primary'} pending={busy || refreshing} disabled={!enabled && parsed === null} onClick={() => void save(enabled ? { enabled: false } : { enabled: true, ...(parsed === null ? {} : { monthlyLimit: parsed }) })}>
        {enabled ? t('cashierOverview.aiSwitchOff') : t('cashierOverview.aiSwitchOn')}
      </Button>
    </div>
  );
}
