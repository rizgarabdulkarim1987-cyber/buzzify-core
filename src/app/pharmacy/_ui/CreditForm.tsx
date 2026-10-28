'use client';

import { CircleAlert, Info, Link2, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { recordCredit } from '@/app/pharmacy/_actions/payments';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import type { Currency } from '@/server/domain/pharmacy/money';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { attemptKeyFor } from './purchasing-logic';
import { creditInputOf, creditSignature, emptyCreditDraft, type CreditDraft } from './purchasing-money-logic';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';
import { useOnline } from './use-online';

/**
 * Recording a credit note from a supplier: number, currency, amount, date, and (optionally) the supplier return it answers.
 * A credit note is money owed back: it lowers what is owed once it is applied to invoices (done on its own page).
 */
export function CreditForm({
  userId,
  restaurantId,
  supplier,
  currencies,
  linkedReturn,
  today,
}: {
  userId: string;
  restaurantId: string;
  supplier: { id: string; name: string; defaultCurrency: Currency };
  currencies: Currency[];
  /** A supplier return this note answers, from `?return=`. */
  linkedReturn: { id: string; number: string | null } | null;
  today: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [firstKey] = useState(() => newClientKey('cn'));
  const start = useMemo<CreditDraft>(
    () => ({ ...emptyCreditDraft(firstKey, supplier.defaultCurrency, today), supplierId: supplier.id, supplierReturnId: linkedReturn?.id ?? '' }),
    [firstKey, supplier, linkedReturn, today],
  );
  const draft = useDraft<CreditDraft>(draftKey(userId, `credit@${restaurantId}:${supplier.id}`, linkedReturn?.id ?? 'new'), start);
  const value = draft.value;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saved, setSaved] = useState(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const built = creditInputOf(value);
  const change = (patch: Partial<CreditDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  const problem = (field: string) => {
    const code = (built.problems as Record<string, string>)[field];
    return showProblems && code ? t(`pharmacy.purchasing.m.cr.problem.${code}`) : failure?.fields[field];
  };

  const save = async () => {
    setShowProblems(true);
    if (!built.input) return;
    setPending(true);
    const sig = creditSignature(value);
    const attempt = attemptKeyFor(value, sig, 'cn');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle<{ id: string }>(() => recordCredit({ ...built.input, clientKey: attempt.clientKey }));
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('cn'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), fields: result.error.fields ?? {} });
      return;
    }
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    router.replace(`/pharmacy/purchasing/credits/${result.data.id}`);
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 sm:px-8" data-testid="credit-form">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.purchasing.m.cr.forSupplier', { supplier: isolate(supplier.name) })}
        </span>
        <UnsavedBadge dirty={draft.dirty} saved={saved} />
      </div>
      <OfflineNotice />
      {failure && (
        <div role="alert" data-testid="credit-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{failure.message}</span>
        </div>
      )}
      {linkedReturn && value.supplierReturnId !== '' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text">
          <Link2 aria-hidden className="size-4 shrink-0 text-muted" />
          <span>
            {t('pharmacy.purchasing.m.cr.linkedReturn')}:{' '}
            <Link href={`/pharmacy/purchasing/returns/${linkedReturn.id}`} className="font-medium underline underline-offset-2">
              <bdi dir="ltr">{linkedReturn.number ?? linkedReturn.id.slice(0, 8)}</bdi>
            </Link>
          </span>
          <Button size="lg" className="min-h-11" onClick={() => change({ supplierReturnId: '' })}>
            {t('pharmacy.purchasing.m.cr.unlink')}
          </Button>
        </p>
      )}
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <legend className="sr-only">{t('pharmacy.purchasing.m.cr.newTitle')}</legend>
        <Field label={t('pharmacy.purchasing.m.cr.number')} error={problem('number')}>
          <Input className="min-h-11" dir="ltr" maxLength={60} autoComplete="off" data-testid="cr-number" value={value.number} onChange={(e) => change({ number: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.purchasing.m.cr.noteDate')} error={problem('noteDate')}>
          <Input className="min-h-11" dir="ltr" type="date" data-testid="cr-date" value={value.noteDate} onChange={(e) => change({ noteDate: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.purchasing.po.currency')}>
          <Select className="[&_select]:min-h-11" value={value.currency} onChange={(e) => change({ currency: e.target.value as Currency })} options={currencies.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label={t('pharmacy.purchasing.m.cr.amount', { currency: value.currency })} error={problem('amount')}>
          <Input className="min-h-11" dir="ltr" inputMode="decimal" autoComplete="off" data-testid="cr-amount" value={value.amount} onChange={(e) => change({ amount: e.target.value })} />
        </Field>
        <Field label={t('pharmacy.purchasing.po.note')} optional className="sm:col-span-2">
          <Textarea rows={2} dir="auto" maxLength={300} value={value.note} onChange={(e) => change({ note: e.target.value })} />
        </Field>
      </fieldset>
      <div>
        <Button variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="cr-save" pending={pending} disabled={!online} onClick={() => void save()}>
          {t('pharmacy.purchasing.m.cr.save')}
        </Button>
      </div>
    </div>
  );
}
