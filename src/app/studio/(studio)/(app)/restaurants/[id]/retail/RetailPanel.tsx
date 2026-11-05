'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { resyncRetail, setRetailAiIntake } from '@/app/studio/_actions/retail';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert } from '@/studio/ui/Alert';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { StatusBadge, type StatusTone } from '@/studio/ui/StatusBadge';
import { Switch } from '@/studio/ui/Switch';

/** The least a reason may be, as the action requires (`retail.setAiIntake`). */
const REASON_MIN = 3;

export interface RetailPanelProps {
  restaurantId: string;
  syncText: string;
  syncTone: StatusTone;
  /** Retails refused the details: only a change or Resync sends them again. */
  permanentFailure: boolean;
  notProvisioned: boolean;
  /** Label and value pairs, already formatted. Nothing secret is in them. */
  facts: Array<{ label: string; value: string }>;
  aiIntake: boolean;
  /** Whether the reader may change the AI switch (the platform owner); others see it off with a note. */
  canSetAi: boolean;
  /** Whether the reader owns this shop and so may open it in Retails. */
  canOpen: boolean;
}

/** The Retail tab: delivery state and facts, the AI switch with a required reason, Resync, and for an owner "Open Retails". */
export function RetailPanel({ restaurantId, syncText, syncTone, permanentFailure, notProvisioned, facts, aiIntake, canSetAi, canOpen }: RetailPanelProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [enabled, setEnabled] = useState(aiIntake);
  const [reason, setReason] = useState('');
  const [saving, startSaving] = useTransition();
  const [resyncing, startResync] = useTransition();
  const [failure, setFailure] = useState<DescribedFailure | null>(null);

  const changed = enabled !== aiIntake;
  const canSave = canSetAi && changed && reason.trim().length >= REASON_MIN && !saving;

  const saveAi = () =>
    startSaving(async () => {
      const result = await settle(() => setRetailAiIntake({ restaurantId, enabled, reason }));
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      setReason('');
      toast.success(t(enabled ? 'retail.ai.savedOn' : 'retail.ai.savedOff'));
      router.refresh();
    });

  const resync = () =>
    startResync(async () => {
      const result = await settle(() => resyncRetail({ restaurantId }));
      if (!result.ok) return setFailure(describeFailure(t, locale, result.error));
      setFailure(null);
      toast.success(t('retail.resync.done'));
      router.refresh();
    });

  const reasonError = failure?.fields.reason;
  const generalMessage = failure && Object.keys(failure.fields).length === 0 ? failure.message : null;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section aria-labelledby="retail-delivery" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="retail-delivery" className="text-md font-semibold text-text">
            {t('retail.panel.delivery')}
          </h2>
          <StatusBadge tone={syncTone} className="h-auto min-h-5 whitespace-normal py-0.5">
            {syncText}
          </StatusBadge>
        </div>
        {notProvisioned && <Alert>{t('retail.panel.notProvisioned')}</Alert>}
        {permanentFailure && <Alert tone="danger">{t('retail.panel.permanent')}</Alert>}
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted">{fact.label}</dt>
              <dd className="break-words text-base tabular-nums text-text">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={<RefreshCw aria-hidden />} onClick={resync} pending={resyncing}>
            {t('retail.resync')}
          </Button>
          <span className="text-sm text-muted">{t('retail.resync.hint')}</span>
        </div>
        {canOpen && (
          // A plain link, not next/link: a prefetch must never run the handoff's Route Handler.
          <div className="flex flex-wrap items-center gap-3">
            <a href={`/studio/retail/open/${restaurantId}`} className={buttonClasses('primary')}>
              <ExternalLink aria-hidden />
              {t('retail.open')}
            </a>
            <span className="text-sm text-muted">{t('retail.open.hint')}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="retail-ai" className="flex flex-col gap-4 border-t border-line pt-6">
        <h2 id="retail-ai" className="text-md font-semibold text-text">
          {t('retail.ai.label')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('retail.ai.hint')}</p>
        <label className="flex items-center gap-3 text-base text-text">
          <Switch checked={enabled} disabled={!canSetAi || saving} onCheckedChange={setEnabled} aria-label={t('retail.ai.label')} />
          <span>{t(enabled ? 'status.on' : 'status.off')}</span>
        </label>
        {!canSetAi ? (
          <Alert>{t('retail.askOwner')}</Alert>
        ) : (
          <>
            <Field label={t('retail.ai.reason')} hint={t('retail.ai.reasonHint')} error={reasonError}>
              <Input value={reason} maxLength={300} disabled={saving} onChange={(event) => setReason(event.target.value)} />
            </Field>
            {generalMessage && <Alert tone="danger">{generalMessage}</Alert>}
            <div>
              <Button variant="primary" onClick={saveAi} disabled={!canSave} pending={saving}>
                {t('retail.ai.save')}
              </Button>
            </div>
          </>
        )}
      </section>
      {!canSetAi && generalMessage && <Alert tone="danger">{generalMessage}</Alert>}
    </div>
  );
}
