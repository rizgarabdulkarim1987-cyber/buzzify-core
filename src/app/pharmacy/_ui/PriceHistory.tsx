'use client';

import { CircleAlert, CircleCheck, History, Tag } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { priceHistory, setPrice } from '@/app/pharmacy/_actions/catalog';
import { formatPhMoney, type Currency } from '@/server/domain/pharmacy/money';
import type { PriceHistoryRow } from '@/server/pharmacy/prices';
import type { ProductUnitView } from '@/server/pharmacy/products';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { phDateTime } from '@/app/pharmacy/_ui/ph-date';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Alert, FailureAlert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { EmptyState } from '@/studio/ui/EmptyState';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { StatusBadge } from '@/studio/ui/StatusBadge';

export interface PriceHistoryProps {
  productId: string;
  units: ProductUnitView[];
  currencies: Currency[];
  initial: { items: PriceHistoryRow[]; nextCursor: string | null };
  /** Branch names by id, for the rows' "where". */
  branchNames: Record<string, string>;
  /** The branch the person chose; null for "All branches", where a price is the business-wide one. */
  place: { branchId: string | null; branchName: string | null };
  /** The form is drawn only when the person may change prices here now. */
  canChange: boolean;
}

/**
 * A product's prices, newest first, and the form that starts a new one: a change never edits an old row, it closes it
 * and opens the next, with a reason. The price is for the branch the person works in, or for every branch without one of
 * its own when they work on all branches; the form says which.
 */
export function PriceHistory({ productId, units, currencies, initial, branchNames, place, canChange }: PriceHistoryProps) {
  const t = useT();
  const { locale } = useLocale();
  const sellable = [...units].filter((u) => u.sellable).sort((a, b) => b.level - a.level);
  const [rows, setRows] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [unitId, setUnitId] = useState(sellable[0]?.id ?? '');
  const [currency, setCurrency] = useState<Currency>(currencies[0] ?? 'IQD');
  const [amount, setAmount] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<DescribedFailure | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState(false);

  const unitLabel = (id: string) => units.find((u) => u.id === id)?.label ?? '';
  const where = (branchId: string | null) =>
    branchId === null ? t('pharmacy.price.everyBranch') : (branchNames[branchId] ?? t('pharmacy.price.otherBranch'));
  const shown = (row: PriceHistoryRow) => {
    try {
      return formatPhMoney({ amount: BigInt(row.amountMinor), currency: row.currency }, locale);
    } catch {
      return `${row.amountMinor} ${row.currency}`;
    }
  };

  // Reading the history again (after a change) or further (older rows) can fail: the screen says so and offers the
  // same read again, never a list that silently stays as it was.
  const [loadFailed, setLoadFailed] = useState<'refresh' | 'more' | null>(null);

  const refresh = async () => {
    const result = await settle(() => priceHistory({ productId }));
    if (!result.ok) return setLoadFailed('refresh');
    const page = result.data as { items: PriceHistoryRow[]; nextCursor: string | null };
    setLoadFailed(null);
    setRows(page.items);
    setCursor(page.nextCursor);
  };

  const more = async () => {
    const result = await settle(() => priceHistory({ productId, cursor }));
    if (!result.ok) return setLoadFailed('more');
    const page = result.data as { items: PriceHistoryRow[]; nextCursor: string | null };
    setLoadFailed(null);
    setRows((was) => [...was, ...page.items]);
    setCursor(page.nextCursor);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempt((n) => n + 1);
    setSaved(false);
    const errors: Record<string, string> = {};
    if (amount.trim() === '') errors.amount = t('pharmacy.price.amountMissing');
    if (reason.trim().length < 3) errors.reason = t('pharmacy.price.reasonMissing');
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    const result = await settle(() =>
      setPrice({
        productId,
        unitId,
        currency,
        amount: amount.trim(),
        validFrom: validFrom === '' ? new Date().toISOString() : new Date(validFrom).toISOString(),
        reason: reason.trim(),
      }),
    );
    setPending(false);
    if (!result.ok) {
      setFailure(describeFailure(t, locale, result.error));
      return;
    }
    setFailure(null);
    setAmount('');
    setReason('');
    setValidFrom('');
    setSaved(true);
    await refresh();
  };

  const errors = { ...(failure?.fields ?? {}), ...clientErrors };
  const formFields = ['unitId', 'currency', 'amount', 'validFrom', 'reason'];
  const elsewhere = failure && Object.keys(failure.fields).every((name) => !formFields.includes(name)) ? failure.message : null;

  return (
    <section aria-labelledby="price-history-title" className="flex flex-col gap-4 py-6">
      <div className="flex flex-col gap-1">
        <h2 id="price-history-title" className="flex items-center gap-2 text-md font-semibold text-text">
          <History aria-hidden className="size-4 shrink-0 text-muted" />
          {t('pharmacy.price.title')}
        </h2>
        <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.price.intro')}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Tag />} title={canChange ? t('pharmacy.price.none') : t('pharmacy.price.noneViewOnly')} className="py-4" />
      ) : (
        <ul className="flex flex-col border-t border-line" aria-label={t('pharmacy.price.title')}>
          {rows.map((row) => (
            <li key={row.id} className="grid gap-x-6 gap-y-1 border-b border-line py-3 text-sm md:grid-cols-[minmax(0,9rem)_minmax(0,8rem)_minmax(0,10rem)_minmax(0,1fr)]">
              <p className="flex flex-wrap items-center gap-2 font-medium text-text tabular-nums">
                {shown(row)}
                {row.validTo === null && <StatusBadge tone="success">{t('pharmacy.price.current')}</StatusBadge>}
              </p>
              <p className="min-w-0 text-text">
                <span dir="auto" className="break-words">
                  {unitLabel(row.unitId)}
                </span>
                <span className="text-muted"> · </span>
                <span dir="auto" className="break-words">
                  {where(row.branchId)}
                </span>
              </p>
              <p className="text-muted">
                <span className="sr-only">{t('pharmacy.price.col.from')}: </span>
                {phDateTime(row.validFrom, locale)}
                {row.validTo && (
                  <>
                    {' – '}
                    <span className="sr-only">{t('pharmacy.price.col.to')}: </span>
                    {phDateTime(row.validTo, locale)}
                  </>
                )}
              </p>
              <p className="min-w-0 text-text">
                <span className="sr-only">{t('pharmacy.price.col.reason')}: </span>
                <span dir="auto" className="break-words">
                  {row.reason}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
      {loadFailed && (
        <div
          data-testid="price-history-failed"
          role="alert"
          className="flex flex-wrap items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('pharmacy.price.loadFailed')}</span>
          <Button size="sm" onClick={() => void (loadFailed === 'more' ? more() : refresh())}>
            {t('pharmacy.catalog.retry')}
          </Button>
        </div>
      )}
      {cursor && (
        <div>
          <Button size="sm" onClick={() => void more()}>
            {t('pharmacy.price.loadMore')}
          </Button>
        </div>
      )}

      {canChange && sellable.length > 0 && (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex max-w-2xl flex-col gap-4 rounded-md border border-line p-4">
          <p className="text-sm text-text" dir="auto">
            {place.branchId === null ? t('pharmacy.price.scopeAll') : t('pharmacy.price.scopeBranch', { branch: `⁨${place.branchName ?? ''}⁩` })}
          </p>
          {!pending && <FailureAlert attempt={attempt} message={elsewhere} fieldMessage={Object.values(errors)[0]} />}
          {saved && !failure && (
            <Alert tone="success">
              <span className="inline-flex items-center gap-1.5">{t('pharmacy.price.saved')}</span>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('pharmacy.price.unit')} error={errors.unitId}>
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)} options={sellable.map((u) => ({ value: u.id, label: u.label }))} />
            </Field>
            <Field label={t('pharmacy.price.amount')} hint={t('pharmacy.price.amountHint')} error={errors.amount}>
              <Input inputMode="decimal" dir="ltr" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label={t('pharmacy.price.currency')} error={errors.currency}>
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} options={currencies.map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <Field label={t('pharmacy.price.validFrom')} hint={t('pharmacy.price.validFromHint')} optional error={errors.validFrom}>
              <Input type="datetime-local" dir="ltr" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label={t('pharmacy.price.reason')} hint={t('pharmacy.price.reasonHint')} error={errors.reason}>
              <Input dir="auto" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button type="submit" variant="primary" pending={pending} icon={<CircleCheck aria-hidden />}>
              {t('pharmacy.price.save')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
