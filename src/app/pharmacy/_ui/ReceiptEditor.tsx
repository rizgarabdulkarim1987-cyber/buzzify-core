'use client';

import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Info, PackageCheck, PackagePlus, Save, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { confirmReceipt, createReceipt, receiptProduct, updateReceipt, voidReceipt } from '@/app/pharmacy/_actions/receipts';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { formatNumber } from '@/lib/pos-format';
import { utcToday } from '@/server/domain/pharmacy/expiry';
import type { Currency } from '@/server/domain/pharmacy/money';
import type { ProductDetail } from '@/server/pharmacy/products';
import type { SearchResult } from '@/server/pharmacy/search';
import { describeFailure, type DescribedFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button, buttonClasses } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormSection } from '@/studio/ui/FormSection';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { OfflineNotice } from './OfflineNotice';
import { emptyDraft, inputOf, newKey, readExpiry, totalsOf, type Built, type LineDraft, type ReceiptDraft, type UnitChoice } from './receipt-draft';
import { ReceiptProductPicker } from './ReceiptProductPicker';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';
import { useOnline } from './use-online';

export interface ReceiptEditorProps {
  userId: string;
  restaurantId: string;
  branchId: string;
  branchName: string;
  /** The saved draft to open (null for a new receipt) as the form's value, made on the server page. */
  initial: ReceiptDraft | null;
  receiptId: string | null;
  currencies: Currency[];
}

interface Done {
  id: string;
  number: string;
  lines: number;
  baseQty: number;
  warnings: { lineNo: number }[];
}

const FLAG = 'inline-flex min-h-11 items-start gap-2.5 py-2 text-sm text-text';

function unitsOfDetail(p: ProductDetail): UnitChoice[] {
  return [...p.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty }));
}

/**
 * The receiving form: the delivery's header, then the lines, built for speed. A product is found in the catalog search
 * (name or a barcode pasted exactly) and arrives as a line with its largest pack chosen; Enter moves through a line's
 * fields and, from the last one, back to the search for the next product. What the person types is kept on this device
 * (`useDraft`) and saved to the server with "Save draft"; confirming saves first, then adds the stock. Each line says in
 * words how its expiry was understood. Nothing moves.
 */
export function ReceiptEditor({ userId, restaurantId, branchId, branchName, initial, receiptId, currencies }: ReceiptEditorProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const ids = useId();
  const searchRef = useRef<HTMLDivElement>(null);
  const focusLine = useRef<string | null>(null);
  const today = utcToday();

  const [firstKey] = useState(newKey);
  const start = useMemo(() => initial ?? emptyDraft(firstKey, today), [initial, firstKey, today]);
  // The business and branch are part of the screen's name: one pharmacy's draft never opens in another.
  const draft = useDraft<ReceiptDraft>(draftKey(userId, `receipt@${restaurantId}:${branchId}`, receiptId ?? 'new'), start);
  const value = draft.value;
  const [savedId, setSavedId] = useState<string | null>(receiptId);
  const [pending, setPending] = useState<null | 'save' | 'confirm' | 'void'>(null);
  const [failure, setFailure] = useState<{ described: DescribedFailure; raw: Record<string, string> | undefined } | null>(null);
  const [problems, setProblems] = useState<Built['problems']>({});
  const [confirming, setConfirming] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [lineCounter, setLineCounter] = useState(0);

  const stale = savedId !== null && initial !== null && value.version !== initial.version && draft.restored;
  useLeaveGuard(draft.dirty && done === null, t('pharmacy.catalog.leaveConfirm'));

  const change = (patch: Partial<ReceiptDraft>) => {
    setSaved(false);
    setConfirming(false);
    draft.set({ ...value, ...patch });
  };
  const changeLine = (key: string, patch: Partial<LineDraft>) => change({ lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  // After a product is added, its quantity takes focus.
  useEffect(() => {
    if (!focusLine.current) return;
    const target = document.querySelector<HTMLElement>(`[data-line="${focusLine.current}"] [data-nav="qty"]`);
    focusLine.current = null;
    target?.focus();
  }, [value.lines.length]);

  const addProduct = async (found: SearchResult): Promise<string | null> => {
    const result = await settle(() => receiptProduct({ productId: found.productId }));
    if (!result.ok) return describeFailure(t, locale, result.error).message;
    const product = result.data as ProductDetail;
    const units = unitsOfDetail(product);
    const top = units[units.length - 1];
    if (!top) return t('pharmacy.receive.search.noUnits');
    const chosen = found.unitId && units.some((u) => u.id === found.unitId) ? found.unitId : top.id;
    const key = `n${lineCounter + 1}`;
    setLineCounter((n) => n + 1);
    focusLine.current = key;
    change({
      lines: [
        ...value.lines,
        {
          key,
          productId: product.id,
          productName: product.tradeName,
          productMeta: [product.strength, product.form].filter((p) => p.trim() !== '').join(' · '),
          units,
          unitId: chosen,
          qty: '',
          bonusQty: '0',
          lot: '',
          expiry: '',
          cost: '',
          currency: currencies[0] ?? 'IQD',
          freeOfCharge: false,
          acceptExpired: false,
        },
      ],
    });
    return null;
  };

  const onLineKey = (event: KeyboardEvent<HTMLLIElement>) => {
    const target = event.target;
    if (event.key !== 'Enter' || !(target instanceof HTMLElement) || !target.matches('[data-nav]')) return;
    event.preventDefault();
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')];
    const next = all[all.indexOf(target) + 1];
    if (next) next.focus();
    else searchRef.current?.querySelector('input')?.focus();
  };

  /** Saves the draft to the server; the id and version it now has, or null (the reason is on screen). */
  const persist = async (): Promise<{ id: string } | null> => {
    const built = inputOf(value);
    setProblems(built.problems);
    if (!built.input) {
      setFailure(null);
      return null;
    }
    const result = await settle(() =>
      savedId ? updateReceipt({ ...built.input, receiptId: savedId, expectedVersion: value.version }) : createReceipt({ ...built.input, clientKey: value.clientKey }),
    );
    if (!result.ok) {
      setFailure({ described: describeFailure(t, locale, result.error), raw: result.error.fields });
      // A key that was used for other lines: start a new one, the next save makes a new draft.
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newKey() });
      return null;
    }
    const data = result.data as { id: string; version: number };
    setFailure(null);
    setSavedId(data.id);
    draft.clear({ ...value, version: data.version });
    return { id: data.id };
  };

  const save = async () => {
    setPending('save');
    const made = await persist();
    setPending(null);
    if (!made) return;
    setSaved(true);
    if (!receiptId) router.replace(`/pharmacy/stock/receive/${made.id}`);
    else router.refresh();
  };

  const confirmNow = async () => {
    setPending('confirm');
    const needsSave = savedId === null || draft.dirty;
    const made = needsSave ? await persist() : { id: savedId! };
    if (!made) {
      setPending(null);
      setConfirming(false);
      return;
    }
    const result = await settle(() => confirmReceipt({ receiptId: made.id }));
    setPending(null);
    setConfirming(false);
    if (!result.ok) {
      setFailure({ described: describeFailure(t, locale, result.error), raw: result.error.fields });
      return;
    }
    const data = result.data as { id: string; number: string; lines: number; baseQty: number; warnings: { lineNo: number }[] };
    setFailure(null);
    setDone({ id: data.id, number: data.number, lines: data.lines, baseQty: data.baseQty, warnings: data.warnings });
  };

  const voidNow = async () => {
    if (!savedId) {
      draft.clear(emptyDraft(newKey(), today));
      router.push('/pharmacy/stock/receive');
      return;
    }
    setPending('void');
    const result = await settle(() => voidReceipt({ receiptId: savedId }));
    setPending(null);
    setVoiding(false);
    if (!result.ok) {
      setFailure({ described: describeFailure(t, locale, result.error), raw: result.error.fields });
      return;
    }
    draft.clear(value);
    router.push('/pharmacy/stock/receive');
  };

  const BackIcon = locale === 'en' ? ArrowLeft : ArrowRight;
  const back = (
    <Link href="/pharmacy/stock/receive" className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-text underline underline-offset-2">
      <BackIcon aria-hidden className="size-4 shrink-0" />
      {t('pharmacy.receive.back')}
    </Link>
  );

  if (done) {
    return (
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 pt-6 sm:px-8" data-testid="receipt-done">
        <h1 className="flex items-center gap-2.5 break-words text-xl font-semibold text-text">
          <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
          <span>
            {t('pharmacy.receive.done.title')} <bdi dir="ltr" data-testid="receipt-number">{done.number}</bdi>
          </span>
        </h1>
        <p className="max-w-[72ch] text-base text-text">{t('pharmacy.receive.done.body', { lines: done.lines, units: formatNumber(done.baseQty), branch: isolate(branchName) })}</p>
        {done.warnings.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {done.warnings.map((w) => (
              <li key={w.lineNo} className="flex items-start gap-2.5 text-sm text-text">
                <TriangleAlert aria-hidden className="mt-px size-4 shrink-0 text-muted" />
                {t('pharmacy.receive.done.costDiffers', { n: w.lineNo })}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/pharmacy/stock/receive/${done.id}`} className={buttonClasses('primary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.done.view')}
          </Link>
          <Link href="/pharmacy/stock" className={buttonClasses('secondary', 'lg', 'min-h-11')}>
            {t('pharmacy.receive.done.stock')}
          </Link>
          <Link href="/pharmacy/stock/receive/new" className={buttonClasses('secondary', 'lg', 'min-h-11')} onClick={() => router.refresh()}>
            <PackagePlus aria-hidden />
            {t('pharmacy.receive.done.another')}
          </Link>
        </div>
      </div>
    );
  }

  const totals = totalsOf(value, today);
  const serverFields = failure?.described.fields ?? {};
  const lineError = (i: number, field: string): string | undefined => {
    const code = problems[`lines.${i}.${field}`];
    if (code) return t(`pharmacy.receive.problem.${code}`);
    return serverFields[`lines.${i}.${field}`];
  };
  const headerError = (field: string): string | undefined => {
    if (problems[`header.${field}`]) return t('pharmacy.receive.problem.date');
    return serverFields[field];
  };
  const formMessage = (() => {
    if (!failure) return null;
    const names = Object.keys(failure.described.fields);
    const beside = names.length > 0 && names.every((n) => n.startsWith('lines.') || ['supplierName', 'reference', 'receivedOn', 'note'].includes(n));
    return failure.described.code === 'INVALID' && beside ? null : failure.described.message;
  })();
  const busy = pending !== null;
  const canAct = !busy && online;
  const hasLines = value.lines.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 pt-6 sm:px-8" data-testid="receipt-editor">
      <div>{back}</div>
      <header className="flex flex-col gap-2">
        <h1 className="break-words text-xl font-semibold text-text">{receiptId ? t('pharmacy.receive.editTitle') : t('pharmacy.receive.newTitle')}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Info aria-hidden className="size-4 shrink-0" />
            {t('pharmacy.receive.intoBranch', { branch: isolate(branchName) })}
          </span>
          <UnsavedBadge dirty={draft.dirty} saved={saved} />
        </div>
      </header>

      <OfflineNotice />

      {draft.restored && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <span className="flex min-w-0 items-start gap-2.5">
            <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
            <span>{stale ? t('pharmacy.receive.draft.stale') : t('pharmacy.catalog.draft.restored')}</span>
          </span>
          <Button size="lg" className="min-h-11" onClick={() => draft.clear(start)}>
            {t('pharmacy.catalog.draft.discard')}
          </Button>
        </div>
      )}

      {formMessage && (
        <p role="alert" data-testid="receipt-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{formMessage}</span>
        </p>
      )}
      {!formMessage && failure && (
        <p role="alert" className="sr-only">
          {Object.values(serverFields)[0]}
        </p>
      )}

      <fieldset disabled={busy} className="flex min-w-0 flex-col">
        <legend className="sr-only">{t('pharmacy.receive.section.delivery')}</legend>
        <FormSection id={`${ids}-delivery`} title={t('pharmacy.receive.section.delivery')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('pharmacy.receive.field.supplier')} optional error={headerError('supplierName')}>
              <Input className="min-h-11" dir="auto" maxLength={200} autoComplete="off" value={value.supplierName} onChange={(e) => change({ supplierName: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.receive.field.reference')} hint={t('pharmacy.receive.field.referenceHint')} optional error={headerError('reference')}>
              <Input className="min-h-11" dir="ltr" maxLength={100} autoComplete="off" value={value.reference} onChange={(e) => change({ reference: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.receive.field.receivedOn')} error={headerError('receivedOn')}>
              <Input className="min-h-11" dir="ltr" type="date" value={value.receivedOn} onChange={(e) => change({ receivedOn: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.receive.field.note')} optional error={headerError('note')} className="sm:col-span-2 lg:col-span-3">
              <Textarea rows={2} dir="auto" maxLength={1000} value={value.note} onChange={(e) => change({ note: e.target.value })} />
            </Field>
          </div>
        </FormSection>

        <FormSection id={`${ids}-lines`} title={t('pharmacy.receive.section.lines')} intro={t('pharmacy.receive.section.linesIntro')}>
          <ReceiptProductPicker boxRef={searchRef} onPick={addProduct} disabled={busy} />

          {problems.lines && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t('pharmacy.receive.problem.lines')}
            </p>
          )}

          {!hasLines ? (
            <p data-testid="receipt-no-lines" className="flex items-start gap-2.5 text-sm text-muted">
              <PackagePlus aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.receive.noLines')}
            </p>
          ) : (
            <ol aria-label={t('pharmacy.receive.section.lines')} className="flex flex-col gap-3">
              {value.lines.map((line, i) => {
                const reading = readExpiry(line.expiry, today);
                const currencyOptions = (currencies.includes(line.currency) ? currencies : [...currencies, line.currency]).map((c) => ({ value: c, label: c }));
                return (
                  <li
                    key={line.key}
                    data-testid="receipt-line"
                    data-line={line.key}
                    onKeyDown={onLineKey}
                    className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="flex min-w-0 flex-col">
                        <p className="text-xs font-medium text-muted">{t('pharmacy.receive.line.n', { n: i + 1 })}</p>
                        <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                          {line.productName}
                        </p>
                        {line.productMeta && (
                          <p dir="auto" className="min-w-0 break-words text-sm text-muted">
                            {line.productMeta}
                          </p>
                        )}
                        {(lineError(i, 'productId') || lineError(i, 'unitId')) && (
                          <p className="flex items-start gap-1.5 text-sm text-danger">
                            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                            {lineError(i, 'productId') ?? lineError(i, 'unitId')}
                          </p>
                        )}
                      </div>
                      <Button size="lg" className="min-h-11" icon={<Trash2 aria-hidden />} onClick={() => change({ lines: value.lines.filter((l) => l.key !== line.key) })}>
                        {t('pharmacy.receive.line.remove')}
                        <span className="sr-only">
                          {' '}
                          {i + 1}: {line.productName}
                        </span>
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label={t('pharmacy.receive.field.unit')}>
                        <Select
                          className="[&_select]:min-h-11"
                          data-nav="unit"
                          value={line.unitId}
                          onChange={(e) => changeLine(line.key, { unitId: e.target.value })}
                          options={line.units.map((u) => ({ value: u.id, label: u.baseQty > 1 ? `${u.label} (${formatNumber(u.baseQty)})` : u.label }))}
                        />
                      </Field>
                      <Field label={t('pharmacy.receive.field.qty')} error={lineError(i, 'qty')}>
                        <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-nav="qty" value={line.qty} onChange={(e) => changeLine(line.key, { qty: e.target.value })} />
                      </Field>
                      <Field label={t('pharmacy.receive.field.bonus')} hint={t('pharmacy.receive.field.bonusHint')} error={lineError(i, 'bonusQty')}>
                        <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-nav="bonus" value={line.bonusQty} onChange={(e) => changeLine(line.key, { bonusQty: e.target.value })} />
                      </Field>
                      <Field label={t('pharmacy.receive.field.lot')} error={lineError(i, 'lot')}>
                        <Input className="min-h-11 uppercase" dir="ltr" autoComplete="off" maxLength={40} data-nav="lot" value={line.lot} onChange={(e) => changeLine(line.key, { lot: e.target.value })} />
                      </Field>
                      <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                        <Field label={t('pharmacy.receive.field.expiry')} hint={t('pharmacy.receive.field.expiryHint')} error={lineError(i, 'expiry')}>
                          <Input className="min-h-11" dir="ltr" inputMode="text" autoComplete="off" placeholder="MM/YYYY" data-nav="expiry" value={line.expiry} onChange={(e) => changeLine(line.key, { expiry: e.target.value })} />
                        </Field>
                        {line.expiry.trim() !== '' && reading.ok && (
                          <p data-testid="expiry-reading" className="flex items-start gap-1.5 text-sm text-text">
                            {reading.expired ? <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted" />}
                            <span>
                              {t(reading.precision === 'MONTH' ? 'pharmacy.receive.expiry.month' : 'pharmacy.receive.expiry.day', { date: reading.shown })}
                              {reading.expired ? ` ${t('pharmacy.receive.expiry.past')}` : ''}
                            </span>
                          </p>
                        )}
                      </div>
                      <Field label={t('pharmacy.receive.field.currency')}>
                        <Select
                          className="[&_select]:min-h-11"
                          data-nav="currency"
                          value={line.currency}
                          onChange={(e) => changeLine(line.key, { currency: e.target.value as Currency })}
                          options={currencyOptions}
                        />
                      </Field>
                      <Field label={t('pharmacy.receive.field.cost')} error={lineError(i, 'unitCostMinor')}>
                        <Input
                          className="min-h-11"
                          dir="ltr"
                          inputMode="decimal"
                          autoComplete="off"
                          data-nav="cost"
                          disabled={line.freeOfCharge}
                          value={line.freeOfCharge ? '0' : line.cost}
                          onChange={(e) => changeLine(line.key, { cost: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-x-8 gap-y-0 lg:flex-row lg:flex-wrap">
                      <label className={FLAG}>
                        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={line.freeOfCharge} onChange={(e) => changeLine(line.key, { freeOfCharge: e.target.checked })} />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{t('pharmacy.receive.free.label')}</span>
                          <span className="text-muted">{t('pharmacy.receive.free.help')}</span>
                        </span>
                      </label>
                      <label className={FLAG}>
                        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={line.acceptExpired} onChange={(e) => changeLine(line.key, { acceptExpired: e.target.checked })} />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{t('pharmacy.receive.accept.label')}</span>
                          <span className="text-muted">{t('pharmacy.receive.accept.help')}</span>
                        </span>
                      </label>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </FormSection>
      </fieldset>

      {confirming && (
        <div role="region" aria-label={t('pharmacy.receive.confirm.title')} data-testid="receipt-confirm" className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
          <p className="flex items-center gap-2.5 text-md font-semibold text-text">
            <PackageCheck aria-hidden className="size-5 shrink-0" />
            {t('pharmacy.receive.confirm.title')}
          </p>
          <p className="max-w-[72ch] text-sm text-text">{t('pharmacy.receive.confirm.body', { lines: totals.lines, units: formatNumber(totals.baseUnits), branch: isolate(branchName) })}</p>
          {totals.expiredLines > 0 && (
            <p className="flex max-w-[72ch] items-start gap-2.5 text-sm text-text">
              <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.receive.confirm.quarantine', { count: totals.expiredLines })}
            </p>
          )}
          <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.receive.confirm.final')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" className="min-h-11" pending={pending === 'confirm'} disabled={!canAct} onClick={() => void confirmNow()}>
              {t('pharmacy.receive.confirm.yes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={busy} onClick={() => setConfirming(false)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}

      {voiding && (
        <div role="region" aria-label={t('pharmacy.receive.void.title')} data-testid="receipt-void-confirm" className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised p-4">
          <p className="flex items-start gap-2.5 text-sm text-text">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />
            {savedId ? t('pharmacy.receive.void.body') : t('pharmacy.receive.void.bodyLocal')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="danger" size="lg" className="min-h-11" pending={pending === 'void'} disabled={!canAct} onClick={() => void voidNow()}>
              {savedId ? t('pharmacy.receive.void.yes') : t('pharmacy.receive.void.yesLocal')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={busy} onClick={() => setVoiding(false)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 py-3 sm:-mx-8 sm:px-8" data-testid="receipt-footer">
        <p role="status" data-testid="receipt-totals" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text">
          <span>{t('pharmacy.receive.totals.lines', { count: totals.lines })}</span>
          <span>{t('pharmacy.receive.totals.units', { count: formatNumber(totals.baseUnits) })}</span>
          {totals.expiredLines > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <ShieldAlert aria-hidden className="size-4 shrink-0" />
              {t('pharmacy.receive.totals.quarantine', { count: totals.expiredLines })}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className="min-h-11" icon={<Save aria-hidden />} pending={pending === 'save'} disabled={!canAct || !hasLines} onClick={() => void save()}>
            {t('pharmacy.receive.save')}
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="min-h-11"
            icon={<PackageCheck aria-hidden />}
            disabled={!canAct || !hasLines}
            onClick={() => {
              const built = inputOf(value);
              setProblems(built.problems);
              setFailure(null);
              if (built.input) {
                setVoiding(false);
                setConfirming(true);
              }
            }}
          >
            {t('pharmacy.receive.confirm.open')}
          </Button>
          <Button size="lg" className="min-h-11" icon={<Trash2 aria-hidden />} disabled={busy} onClick={() => { setConfirming(false); setVoiding(true); }}>
            {savedId ? t('pharmacy.receive.void.open') : t('pharmacy.receive.discard')}
          </Button>
        </div>
      </div>
    </div>
  );
}
