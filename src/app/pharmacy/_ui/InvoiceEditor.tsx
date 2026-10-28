'use client';

import { CircleAlert, FileSearch, Info, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createInvoice } from '@/app/pharmacy/_actions/invoices';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { parseMoney, type Currency } from '@/server/domain/pharmacy/money';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Checkbox } from '@/studio/ui/Checkbox';
import { Field } from '@/studio/ui/Field';
import { FormSection } from '@/studio/ui/FormSection';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Amount } from './money-status';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { attemptKeyFor } from './purchasing-logic';
import {
  dueFrom,
  editLine,
  emptyInvoiceDraft,
  invoiceInputOf,
  invoiceLinesStart,
  invoiceSignature,
  invoiceTotalsOf,
  tickLine,
  type InvoiceableRow,
  type InvoiceDraft,
} from './purchasing-money-logic';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';
import { useOnline } from './use-online';

/**
 * Entering a supplier's invoice: tick the received lines it bills (quantity to invoice and the invoiced unit cost per
 * line, over-quantity refused per line), then number, dates, a signed adjustment with a reason, and live totals. The
 * currency follows the ticked lines. A duplicate number is refused with a link to the invoice that already has it. Typed
 * values stay on this device; the key is made for exactly the values sent, so a retry after a lost answer replays.
 */
export function InvoiceEditor({
  userId,
  restaurantId,
  supplier,
  rows,
  currencies,
  truncated,
  today,
}: {
  userId: string;
  restaurantId: string;
  supplier: { id: string; name: string; termsDays: number; defaultCurrency: Currency };
  rows: InvoiceableRow[];
  currencies: Currency[];
  /** True when the server offered its limit of lines: there may be more. */
  truncated: boolean;
  /** The pharmacy's today (YYYY-MM-DD): the invoice date starts there and the due date follows the supplier's terms. */
  today: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [firstKey] = useState(() => newClientKey('inv'));
  const start = useMemo<InvoiceDraft>(() => {
    const currency = rows.find((r) => r.currency !== null)?.currency ?? supplier.defaultCurrency;
    return { ...emptyInvoiceDraft(firstKey, currency), supplierId: supplier.id, invoiceDate: today, dueDate: dueFrom(today, supplier.termsDays), lines: invoiceLinesStart(rows, currency) };
  }, [firstKey, rows, supplier, today]);
  const draft = useDraft<InvoiceDraft>(draftKey(userId, `invoice@${restaurantId}:${supplier.id}`, 'new'), start);
  const value = draft.value;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saved, setSaved] = useState(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const built = invoiceInputOf(value, rows);
  const chosen = rows.filter((r) => value.lines[r.receiptLineId]?.checked);
  const forced = chosen.find((r) => r.currency !== null)?.currency ?? null;
  const totals = invoiceTotalsOf(
    chosen.map((r) => value.lines[r.receiptLineId]!),
    value.adjustment,
    value.currency,
  );
  const change = (patch: Partial<InvoiceDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  // A draft restored from an earlier visit may not know a line received since: both start it from the receipt line.
  const changeLine = (row: InvoiceableRow, patch: Partial<InvoiceDraft['lines'][string]>) => {
    setSaved(false);
    draft.set(editLine(value, row, patch));
  };
  const problem = (field: string) => {
    const code = (built.problems as Record<string, string>)[field];
    return showProblems && code ? t(`pharmacy.purchasing.m.inv.problem.${code}`) : failure?.fields[field];
  };
  const toggle = (row: InvoiceableRow, on: boolean) => {
    const currency = on && row.currency !== null ? row.currency : value.currency;
    setSaved(false);
    draft.set({ ...tickLine(value, row, on), currency });
  };
  const setInvoiceDate = (invoiceDate: string) => {
    const follows = value.dueDate === '' || value.dueDate === dueFrom(value.invoiceDate, supplier.termsDays);
    change({ invoiceDate, ...(follows ? { dueDate: dueFrom(invoiceDate, supplier.termsDays) } : {}) });
  };
  const existing = failure?.fields.existingInvoiceId;

  const save = async () => {
    setShowProblems(true);
    if (!built.input) return;
    setPending(true);
    const sig = invoiceSignature(value);
    const attempt = attemptKeyFor(value, sig, 'inv');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle<{ id: string }>(() => createInvoice({ ...built.input, clientKey: attempt.clientKey }));
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('inv'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), fields: result.error.fields ?? {} });
      return;
    }
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    router.replace(`/pharmacy/purchasing/invoices/${result.data.id}`);
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 sm:px-8" data-testid="invoice-editor">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.purchasing.m.inv.forSupplier', { supplier: isolate(supplier.name) })}
        </span>
        <UnsavedBadge dirty={draft.dirty} saved={saved} />
      </div>
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
        <div role="alert" data-testid="invoice-error" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <span className="flex min-w-0 items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{failure.message}</span>
          </span>
          {existing && (
            <Link href={`/pharmacy/purchasing/invoices/${existing}`} data-testid="invoice-existing" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 font-medium underline underline-offset-2">
              <FileSearch aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.purchasing.m.inv.openExisting')}
            </Link>
          )}
        </div>
      )}

      <fieldset disabled={pending} className="flex min-w-0 flex-col">
        <legend className="sr-only">{t('pharmacy.purchasing.m.inv.newTitle')}</legend>
        <FormSection id="inv-lines" title={t('pharmacy.purchasing.m.inv.lines')} intro={t('pharmacy.purchasing.m.inv.linesIntro')}>
          {problem('lines') && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {problem('lines')}
            </p>
          )}
          {rows.length === 0 ? (
            <p data-testid="invoice-no-lines" className="flex items-start gap-2.5 text-sm text-muted">
              <Info aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.purchasing.m.inv.noLines')}
            </p>
          ) : (
            <ol aria-label={t('pharmacy.purchasing.m.inv.lines')} className="flex flex-col gap-3">
              {rows.map((r) => {
                const l = value.lines[r.receiptLineId] ?? { checked: false, qty: String(r.invoiceableQty), cost: '' };
                const blocked = r.currency !== null && forced !== null && r.currency !== forced;
                const qtyProblem = problem(`lines.${r.receiptLineId}.qty`);
                const costProblem = problem(`lines.${r.receiptLineId}.cost`);
                const qtyN = Number(l.qty);
                const cost = parseMoney(l.cost, value.currency);
                const lineTotal = l.checked && Number.isInteger(qtyN) && qtyN > 0 && cost ? cost.amount * BigInt(qtyN) : null;
                return (
                  <li key={r.receiptLineId} data-testid="invoice-line" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
                    <Checkbox
                      label={
                        <span dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                          {r.productName}
                        </span>
                      }
                      checked={l.checked}
                      disabled={blocked}
                      data-testid="invoice-line-check"
                      onChange={(e) => toggle(r, e.target.checked)}
                    />
                    <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
                      <span>
                        {t('pharmacy.purchasing.m.inv.receipt')}: <bdi dir="ltr">{r.receiptNumber ?? '—'}</bdi>
                      </span>
                      <span>
                        {t('pharmacy.stock.batch.lot')}: <bdi dir="ltr">{r.lot}</bdi>
                      </span>
                      <span>
                        {t('pharmacy.purchasing.m.inv.expiry')}: <bdi dir="ltr">{phDate(`${r.expiry}T00:00:00.000Z`, locale)}</bdi>
                      </span>
                      <span>
                        {t('pharmacy.purchasing.m.inv.left')}: <bdi dir="ltr">{formatNumber(r.invoiceableQty)}</bdi> {r.unitLabel}
                      </span>
                    </p>
                    {blocked && (
                      <p className="flex items-start gap-1.5 text-sm text-muted">
                        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        {t('pharmacy.purchasing.m.inv.otherCurrency', { currency: r.currency ?? '' })}
                      </p>
                    )}
                    {l.checked && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label={t('pharmacy.purchasing.m.inv.qty')} error={qtyProblem}>
                          <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="invoice-qty" value={l.qty} onChange={(e) => changeLine(r, { qty: e.target.value })} />
                        </Field>
                        <Field label={t('pharmacy.purchasing.m.inv.cost', { currency: value.currency })} error={costProblem}>
                          <Input className="min-h-11" dir="ltr" inputMode="decimal" autoComplete="off" data-testid="invoice-cost" value={l.cost} onChange={(e) => changeLine(r, { cost: e.target.value })} />
                        </Field>
                        <p className="flex flex-col gap-1 text-sm text-text">
                          <span className="text-muted">{t('pharmacy.purchasing.m.inv.lineTotal')}</span>
                          {lineTotal !== null ? <Amount amount={lineTotal} currency={value.currency} locale={locale} className="font-medium" /> : <span className="text-muted">—</span>}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {truncated && (
            <p className="flex items-start gap-2.5 text-sm text-muted">
              <Info aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.purchasing.m.inv.truncated')}
            </p>
          )}
        </FormSection>

        <FormSection id="inv-head" title={t('pharmacy.purchasing.m.inv.header')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('pharmacy.purchasing.m.inv.number')} error={problem('number') ?? failure?.fields.number} hint={t('pharmacy.purchasing.m.inv.numberHint')}>
              <Input className="min-h-11" dir="ltr" maxLength={60} autoComplete="off" data-testid="invoice-number" value={value.number} onChange={(e) => change({ number: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.purchasing.po.currency')} hint={forced ? t('pharmacy.purchasing.m.inv.currencyForced') : undefined}>
              <Select
                className="[&_select]:min-h-11"
                value={value.currency}
                disabled={forced !== null}
                onChange={(e) => change({ currency: e.target.value as Currency })}
                options={currencies.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label={t('pharmacy.purchasing.m.inv.invoiceDate')} error={problem('invoiceDate')}>
              <Input className="min-h-11" dir="ltr" type="date" data-testid="invoice-date" value={value.invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </Field>
            <Field label={t('pharmacy.purchasing.m.inv.dueDate')} error={problem('dueDate')} hint={t('pharmacy.purchasing.m.inv.dueHint', { days: supplier.termsDays })}>
              <Input className="min-h-11" dir="ltr" type="date" data-testid="invoice-due" value={value.dueDate} onChange={(e) => change({ dueDate: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.purchasing.m.inv.adjustment', { currency: value.currency })} error={problem('adjustment') ?? problem('total')} hint={t('pharmacy.purchasing.m.inv.adjustmentHint')} optional>
              <Input className="min-h-11" dir="ltr" inputMode="decimal" autoComplete="off" data-testid="invoice-adjustment" value={value.adjustment} onChange={(e) => change({ adjustment: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.purchasing.m.inv.adjustmentReason')} error={problem('adjustmentReason')} optional>
              <Input className="min-h-11" dir="auto" maxLength={200} autoComplete="off" data-testid="invoice-adjustment-reason" value={value.adjustmentReason} onChange={(e) => change({ adjustmentReason: e.target.value })} />
            </Field>
          </div>
        </FormSection>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 py-3 sm:-mx-8 sm:px-8">
        <p role="status" data-testid="invoice-totals" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text">
          <span>{t('pharmacy.receive.totals.lines', { count: chosen.length })}</span>
          {totals ? (
            <>
              <span>
                {t('pharmacy.purchasing.m.inv.linesTotal')}: <Amount amount={totals.linesMinor} currency={value.currency} locale={locale} />
              </span>
              {totals.adjustmentMinor !== 0n && (
                <span>
                  {t('pharmacy.purchasing.m.inv.adjustmentTotal')}: <Amount amount={totals.adjustmentMinor} currency={value.currency} locale={locale} />
                </span>
              )}
              <span className="font-medium">
                {t('pharmacy.purchasing.po.total')}: <Amount amount={totals.totalMinor} currency={value.currency} locale={locale} />
              </span>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </p>
        <div>
          <Button variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="invoice-save" pending={pending} disabled={!online || chosen.length === 0} onClick={() => void save()}>
            {t('pharmacy.purchasing.m.inv.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
