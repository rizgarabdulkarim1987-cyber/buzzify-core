'use client';

import { CircleAlert, CircleCheck, Info, WalletCards } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { applyCredit } from '@/app/pharmacy/_actions/payments';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { AllocationFields, openInvoiceOf, type OpenInvoiceWire } from './AllocationFields';
import { Amount } from './money-status';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { attemptKeyFor } from './purchasing-logic';
import { applyInputOf, applySignature, type ApplyDraft } from './purchasing-money-logic';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';

/**
 * Spending a credit note on open invoices of its supplier and currency: automatic (oldest due first, the rest stays on the
 * note) or typed per invoice, never more than is left on the note or on an invoice. A note can go on a given invoice once:
 * the server's refusal (CREDIT_ALREADY_ON_INVOICE) is explained in words.
 */
export function ApplyCreditForm({
  userId,
  restaurantId,
  creditNoteId,
  currency,
  availableMinor,
  invoices: wire,
}: {
  userId: string;
  restaurantId: string;
  creditNoteId: string;
  currency: 'IQD' | 'USD';
  availableMinor: string;
  invoices: OpenInvoiceWire[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const invoices = useMemo(() => wire.map(openInvoiceOf), [wire]);
  const available = BigInt(availableMinor);
  const [firstKey] = useState(() => newClientKey('cap'));
  const start = useMemo<ApplyDraft>(() => ({ clientKey: firstKey, mode: 'auto', explicit: {} }), [firstKey]);
  const draft = useDraft<ApplyDraft>(draftKey(userId, `apply@${restaurantId}`, creditNoteId), start);
  const value = draft.value;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const built = applyInputOf(value, creditNoteId, available, invoices);
  const change = (patch: Partial<ApplyDraft>) => {
    setDone(false);
    draft.set({ ...value, ...patch });
  };

  const save = async () => {
    if (!built.input) return;
    setPending(true);
    const sig = applySignature(value, creditNoteId);
    const attempt = attemptKeyFor(value, sig, 'cap');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle(() => applyCredit({ ...built.input, clientKey: attempt.clientKey }));
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('cap'), keySig: '' });
      setFailure(phMessage(t, locale, result.error, 'pharmacy.purchasing'));
      return;
    }
    setFailure(null);
    setDone(true);
    setOpen(false);
    draft.clear(start);
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="apply-credit">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" className="min-h-11" icon={<WalletCards aria-hidden />} data-testid="apply-open" aria-expanded={open} disabled={!online} onClick={() => setOpen((v) => !v)}>
          {t('pharmacy.purchasing.m.cr.applyOpen')}
        </Button>
        <UnsavedBadge dirty={draft.dirty} saved={false} />
      </div>
      <OfflineNotice />
      {done && (
        <p role="status" data-testid="apply-done" className="flex items-start gap-2.5 rounded-md bg-success-wash px-3 py-2.5 text-sm text-success">
          <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
          {t('pharmacy.purchasing.m.cr.applyDone')}
        </p>
      )}
      {open && (
        <form
          role="region"
          aria-label={t('pharmacy.purchasing.m.cr.applyTitle')}
          className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="flex items-start gap-2.5 text-sm text-text">
            <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span className="min-w-0">
              {t('pharmacy.purchasing.m.cr.applyBody')} {t('pharmacy.purchasing.m.cr.left')}: <Amount amount={available} currency={currency} locale={locale} className="font-medium" />
            </span>
          </p>
          {failure && (
            <p role="alert" data-testid="apply-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              <span className="min-w-0">{failure}</span>
            </p>
          )}
          <AllocationFields
            invoices={invoices}
            currency={currency}
            mode={value.mode}
            explicit={value.explicit}
            preview={built.preview}
            onMode={(mode) => change({ mode })}
            onExplicit={(id, v) => change({ explicit: { ...value.explicit, [id]: v } })}
            disabled={pending}
            error={built.error === 'OVER_ALLOCATION' ? t('pharmacy.purchasing.m.cr.overCredit') : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="lg" className="min-h-11" data-testid="apply-confirm" pending={pending} disabled={!online || !built.input}>
              {t('pharmacy.purchasing.m.cr.applyConfirm')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setOpen(false)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
