'use client';

import { CircleAlert, Lock, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { voidInvoice } from '@/app/pharmacy/_actions/invoices';
import { reversePayment } from '@/app/pharmacy/_actions/payments';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { reasonAttempt } from './purchasing-money-logic';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';

interface ReasonDraft {
  reason: string;
  clientKey: string;
  keySig?: string | undefined;
}

/**
 * Voiding an invoice or reversing a payment: a reason of at least three characters, then a confirmation that says what it
 * does. The reason is kept on this device while it is typed (with the leave guard); a reversal's key is kept with it, so a
 * retry after a lost answer replays and an edited reason gets a new key. The server's refusal is shown in words.
 */
export function ReasonAction({
  kind,
  targetId,
  version,
  userId,
  restaurantId,
}: {
  kind: 'void' | 'reverse';
  targetId: string;
  /** The invoice's version, for a void. */
  version?: number;
  userId: string;
  restaurantId: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [first] = useState(() => newClientKey('rv'));
  const draft = useDraft<ReasonDraft>(draftKey(userId, `${kind}@${restaurantId}`, targetId), { reason: '', clientKey: first });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));
  const value = draft.value;
  const short = value.reason.trim().length < 3;

  const submit = async () => {
    if (short || pending || !online) return;
    setPending(true);
    const attempt = reasonAttempt(value, newClientKey);
    if (attempt.clientKey !== value.clientKey || value.keySig !== attempt.keySig) draft.set({ ...value, ...attempt });
    const reason = value.reason.trim();
    const result = await settle<unknown>(() =>
      kind === 'void' ? voidInvoice({ invoiceId: targetId, expectedVersion: version, reason }) : reversePayment({ paymentId: targetId, reason, clientKey: attempt.clientKey }),
    );
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('rv'), keySig: '' });
      setError({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), stale: result.error.code === 'CONFLICT' && !result.error.fields?.phCode });
      return;
    }
    setError(null);
    draft.clear({ reason: '', clientKey: newClientKey('rv') });
    setOpen(false);
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={`${kind}-action`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" className="min-h-11" variant="danger" icon={<Undo2 aria-hidden />} data-testid={`${kind}-open`} aria-expanded={open} disabled={!online} onClick={() => setOpen((v) => !v)}>
          {t(kind === 'void' ? 'pharmacy.purchasing.m.void.open' : 'pharmacy.purchasing.m.pay.reverseOpen')}
        </Button>
        <UnsavedBadge dirty={draft.dirty} saved={false} />
      </div>
      <OfflineNotice />
      {open && (
        <form
          role="region"
          aria-label={t(kind === 'void' ? 'pharmacy.purchasing.m.void.title' : 'pharmacy.purchasing.m.pay.reverseTitle')}
          data-testid={`${kind}-form`}
          className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="max-w-[72ch] text-sm text-text">{t(kind === 'void' ? 'pharmacy.purchasing.m.void.body' : 'pharmacy.purchasing.m.pay.reverseBody')}</p>
          <Field label={t('pharmacy.purchasing.m.reason')} hint={t('pharmacy.purchasing.m.reasonHint')}>
            <Input className="min-h-11" dir="auto" maxLength={300} autoComplete="off" data-testid={`${kind}-reason`} value={value.reason} onChange={(e) => draft.set({ ...value, reason: e.target.value })} />
          </Field>
          {error && (
            <div role="alert" data-testid={`${kind}-error`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
              <span className="flex min-w-0 items-start gap-2.5">
                <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                <span className="min-w-0">{error.message}</span>
              </span>
              {error.stale && (
                <Button size="lg" className="min-h-11" onClick={() => router.refresh()}>
                  {t('pharmacy.purchasing.reload')}
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="lg" className="min-h-11" data-testid={`${kind}-confirm`} pending={pending} disabled={short || !online}>
              {t(kind === 'void' ? 'pharmacy.purchasing.m.void.confirm' : 'pharmacy.purchasing.m.pay.reverseConfirm')}
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

/** Why a money control is not there: the reason in words with a lock. */
export function MoneyLocked({ text, testId }: { text: string; testId?: string }) {
  return (
    <p data-testid={testId} className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0">
      <Lock aria-hidden className="text-muted" />
      <span className="min-w-0">{text}</span>
    </p>
  );
}
