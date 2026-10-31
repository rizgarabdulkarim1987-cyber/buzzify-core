'use client';

import { CircleAlert, HandCoins, Info, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createPayment } from '@/app/pharmacy/_actions/payments';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { parseMoney } from '@/server/domain/pharmacy/money';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { AllocationFields, openInvoiceOf, type OpenInvoiceWire } from './AllocationFields';
import { Amount } from './money-status';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { attemptKeyFor } from './purchasing-logic';
import { emptyPaymentDraft, minorText, PAYMENT_METHODS, paymentInputOf, paymentSignature, type PaymentDraft } from './purchasing-money-logic';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';

/**
 * Recording a payment to a supplier: method, amount, date, reference, then where it goes (oldest due first, or typed per
 * invoice). Typed values stay on this device with the leave guard; the key is made for exactly the values sent, so a retry
 * after a lost answer replays. The refusals (UNALLOCATED, OVER_ALLOCATION, CURRENCY_MISMATCH, INVOICE_VOID) show in words.
 * It is a record in the books only: no cash moves, and the screen says so.
 */
export function PaymentForm({
  userId,
  restaurantId,
  supplier,
  currency,
  invoices: wire,
  preselected,
  today,
  hasMore,
}: {
  userId: string;
  restaurantId: string;
  supplier: { id: string; name: string };
  currency: 'IQD' | 'USD';
  invoices: OpenInvoiceWire[];
  preselected: string[];
  today: string;
  hasMore: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const invoices = useMemo(() => wire.map(openInvoiceOf), [wire]);
  const [firstKey] = useState(() => newClientKey('pay'));
  const start = useMemo<PaymentDraft>(() => {
    const base = emptyPaymentDraft(firstKey, today);
    const chosen = invoices.filter((i) => preselected.includes(i.id));
    if (chosen.length === 0) return base;
    return {
      ...base,
      mode: 'explicit',
      amount: minorText(
        chosen.reduce((s, i) => s + i.balanceMinor, 0n),
        currency,
      ),
      explicit: Object.fromEntries(chosen.map((i) => [i.id, minorText(i.balanceMinor, currency)])),
    };
  }, [firstKey, today, invoices, preselected, currency]);
  const draft = useDraft<PaymentDraft>(draftKey(userId, `pay@${restaurantId}:${supplier.id}:${currency}`, preselected.join(',') || 'new'), start);
  const value = draft.value;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saved, setSaved] = useState(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const built = paymentInputOf(value, supplier.id, currency, invoices);
  const typed = parseMoney(value.amount, currency);
  const change = (patch: Partial<PaymentDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  const problem = (field: string) => {
    const code = (built.problems as Record<string, string>)[field];
    if (!showProblems || !code) return failure?.fields[field];
    return t(`pharmacy.purchasing.m.pay.problem.${code}`);
  };

  const save = async () => {
    setShowProblems(true);
    if (!built.input) return;
    setPending(true);
    const sig = paymentSignature(value, supplier.id, currency);
    const attempt = attemptKeyFor(value, sig, 'pay');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle<{ id: string }>(() => createPayment({ ...built.input, clientKey: attempt.clientKey }));
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('pay'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), fields: result.error.fields ?? {} });
      return;
    }
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    router.replace(`/pharmacy/purchasing/payments/${result.data.id}`);
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 sm:px-8" data-testid="payment-form">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <HandCoins aria-hidden className="size-4 shrink-0" />
          <span dir="auto">{supplier.name}</span> · <bdi dir="ltr">{currency}</bdi>
        </span>
        <UnsavedBadge dirty={draft.dirty} saved={saved} />
      </div>
      <p data-testid="payment-books-only" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
        <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
        <span className="min-w-0">{t('pharmacy.purchasing.m.pay.booksOnly')}</span>
      </p>
      <OfflineNotice />
      {draft.restored && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <span className="flex min-w-0 items-start gap-2.5">
            <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            {t('pharmacy.catalog.draft.restored')}
          </span>
          <Button size="lg" className="min-h-11" onClick={() => draft.clear(start)}>
            {t('pharmacy.catalog.draft.discard')}
          </Button>
        </div>
      )}
      {failure && (
        <div role="alert" data-testid="payment-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{failure.message}</span>
        </div>
      )}
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <legend className="sr-only">{t('pharmacy.purchasing.m.pay.title')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('pharmacy.purchasing.m.pay.method')}>
            <Select
              className="[&_select]:min-h-11"
              data-testid="pay-method"
              value={value.method}
              onChange={(e) => change({ method: e.target.value as PaymentDraft['method'] })}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`pharmacy.purchasing.m.pay.method.${m}`) }))}
            />
          </Field>
          <Field label={t('pharmacy.purchasing.m.pay.amount', { currency })} error={problem('amount')}>
            <Input className="min-h-11" dir="ltr" inputMode="decimal" autoComplete="off" data-testid="pay-amount" value={value.amount} onChange={(e) => change({ amount: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.purchasing.m.pay.paidOn')} error={problem('paidOn')}>
            <Input className="min-h-11" dir="ltr" type="date" data-testid="pay-date" value={value.paidOn} onChange={(e) => change({ paidOn: e.target.value })} />
          </Field>
          <Field label={t('pharmacy.purchasing.m.pay.reference')} optional>
            <Input className="min-h-11" dir="auto" maxLength={100} autoComplete="off" data-testid="pay-reference" value={value.reference} onChange={(e) => change({ reference: e.target.value })} />
          </Field>
        </div>
        <AllocationFields
          invoices={invoices}
          currency={currency}
          mode={value.mode}
          explicit={value.explicit}
          preview={built.preview}
          onMode={(mode) => change({ mode })}
          onExplicit={(id, v) => change({ explicit: { ...value.explicit, [id]: v } })}
          error={showProblems && (built.problems as Record<string, string>).allocations ? t(`pharmacy.purchasing.m.alloc.err.${(built.problems as Record<string, string>).allocations}`) : undefined}
        />
        {hasMore && (
          <p className="flex items-start gap-2.5 text-sm text-muted">
            <Info aria-hidden className="mt-px size-4 shrink-0" />
            {t('pharmacy.purchasing.m.pay.moreInvoices')}
          </p>
        )}
      </fieldset>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 py-3 sm:-mx-8 sm:px-8">
        <p role="status" data-testid="pay-total" className="text-sm text-text">
          {t('pharmacy.purchasing.m.pay.total')}: {typed && typed.amount > 0n ? <Amount amount={typed.amount} currency={currency} locale={locale} className="font-medium" /> : <span className="text-muted">—</span>}
        </p>
        <div>
          <Button variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="pay-save" pending={pending} disabled={!online} onClick={() => void save()}>
            {t('pharmacy.purchasing.m.pay.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
