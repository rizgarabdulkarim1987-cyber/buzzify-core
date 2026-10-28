'use client';

import { CircleAlert, Info, Lightbulb, PackagePlus, Save, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { createOrder, findSuppliers, suggestOrder, updateOrder } from '@/app/pharmacy/_actions/purchase-orders';
import { receiptProduct } from '@/app/pharmacy/_actions/receipts';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { formatPhMoney, type Currency } from '@/server/domain/pharmacy/money';
import type { ProductDetail } from '@/server/pharmacy/products';
import type { PoSuggestion } from '@/server/pharmacy/purchase-orders';
import type { SearchResult } from '@/server/pharmacy/search';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormSection } from '@/studio/ui/FormSection';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { OfflineNotice } from './OfflineNotice';
import { phMessage } from './ph-failure';
import { emptyPoDraft, mergeSuggestions, poInputOf, poSignature, poTotals, type PoDraft, type PoDraftLine, type PoProblem } from './purchasing-logic';
import { ReceiptProductPicker } from './ReceiptProductPicker';
import { keyFor, newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';
import { useOnline } from './use-online';

export interface SupplierOption {
  id: string;
  name: string;
  defaultCurrency: Currency;
}

export interface PurchaseOrderEditorProps {
  userId: string;
  restaurantId: string;
  branchId: string;
  branchName: string;
  currencies: Currency[];
  suppliers: SupplierOption[];
  /** The saved draft order to edit as the form's value; null for a new one. */
  initial: PoDraft | null;
  orderId: string | null;
}

type Suggestions = { state: 'idle' } | { state: 'loading' } | { state: 'failed'; message: string } | { state: 'done'; items: PoSuggestion[]; supplierId: string };

/**
 * The purchase order form: supplier, currency, expected date, note, then the lines (product search, unit, quantity,
 * bonus, unit cost) with the total per currency and the below-minimum suggestions that add lines in one click. Typed
 * values stay on this device; the save key is made for exactly the values sent, so a retry after a lost answer replays.
 * A refusal is shown as its translated sentence and the form keeps what was typed. No motion.
 */
export function PurchaseOrderEditor({ userId, restaurantId, branchId, branchName, currencies, suppliers: initialSuppliers, initial, orderId }: PurchaseOrderEditorProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const searchRef = useRef<HTMLDivElement>(null);
  const [firstKey] = useState(() => newClientKey('po'));
  const start = useMemo(() => initial ?? emptyPoDraft(firstKey, currencies[0] ?? 'IQD'), [initial, firstKey, currencies]);
  const draft = useDraft<PoDraft>(draftKey(userId, `po@${restaurantId}:${branchId}`, orderId ?? 'new'), start);
  const value = draft.value;
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(initialSuppliers);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [pending, setPending] = useState<null | 'save'>(null);
  const [failure, setFailure] = useState<{ message: string; stale: boolean; fields: Record<string, string> } | null>(null);
  const [problems, setProblems] = useState<Record<string, PoProblem>>({});
  const [saved, setSaved] = useState(false);
  const [counter, setCounter] = useState(0);
  const [suggest, setSuggest] = useState<Suggestions>({ state: 'idle' });
  const [note, setNote] = useState<string | null>(null);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const change = (patch: Partial<PoDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  const changeLine = (key: string, patch: Partial<PoDraftLine>) => change({ lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const busy = pending !== null;
  const can = online && !busy;
  const totals = poTotals(value);
  const lineError = (i: number, field: string): string | undefined => {
    const code = problems[`lines.${i}.${field}`];
    return code ? t(`pharmacy.purchasing.po.problem.${code}`) : failure?.fields[`lines.${i}.${field}`];
  };
  const headerError = (field: string): string | undefined => {
    const code = problems[field];
    return code ? t(`pharmacy.purchasing.po.problem.${code}`) : failure?.fields[field];
  };

  const searchSuppliers = async () => {
    const result = await settle(() => findSuppliers({ search: supplierSearch, active: true }));
    if (!result.ok) return;
    const rows = (result.data as { items: SupplierOption[] }).items;
    setSuppliers(rows.map((s) => ({ id: s.id, name: s.name, defaultCurrency: s.defaultCurrency })));
  };

  const pickSupplier = (id: string) => {
    const found = suppliers.find((s) => s.id === id);
    change({ supplierId: id, supplierName: found?.name ?? '', ...(found && value.lines.length === 0 ? { currency: found.defaultCurrency } : {}) });
    setSuggest({ state: 'idle' });
  };

  const addProduct = async (found: SearchResult): Promise<string | null> => {
    const result = await settle(() => receiptProduct({ productId: found.productId }));
    if (!result.ok) return describeFailure(t, locale, result.error).message;
    const product = result.data as ProductDetail;
    const units = [...product.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty }));
    const top = units[units.length - 1];
    if (!top) return t('pharmacy.receive.search.noUnits');
    const chosen = found.unitId && units.some((u) => u.id === found.unitId) ? found.unitId : top.id;
    const key = `n${counter + 1}`;
    setCounter((n) => n + 1);
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
          bonus: '0',
          cost: '',
        },
      ],
    });
    return null;
  };

  const loadSuggestions = async () => {
    setSuggest({ state: 'loading' });
    setNote(null);
    const result = await settle(() => suggestOrder(value.supplierId ? { supplierId: value.supplierId } : {}));
    if (!result.ok) {
      setSuggest({ state: 'failed', message: phMessage(t, locale, result.error, 'pharmacy.purchasing') });
      return;
    }
    setSuggest({ state: 'done', items: result.data as PoSuggestion[], supplierId: value.supplierId });
  };

  const addSuggestions = (items: PoSuggestion[]) => {
    const merged = mergeSuggestions(value.lines, items, counter);
    setCounter((n) => n + merged.added);
    change({ lines: merged.lines });
    setNote(t('pharmacy.purchasing.po.suggest.added', { added: merged.added, skipped: merged.skipped }));
  };

  const save = async () => {
    const built = poInputOf(value);
    setProblems(built.problems);
    if (!built.input) {
      setFailure(null);
      return;
    }
    setPending('save');
    const sig = poSignature(value);
    const attempt = keyFor(value.keySig ? { sig: value.keySig, key: value.clientKey } : null, sig, 'po');
    if (attempt.key !== value.clientKey || value.keySig !== sig) draft.set({ ...value, clientKey: attempt.key, keySig: sig });
    const result = await settle<{ id: string }>(() =>
      orderId ? updateOrder({ ...built.input, purchaseOrderId: orderId, expectedVersion: value.version }) : createOrder({ ...built.input, clientKey: attempt.key }),
    );
    setPending(null);
    if (!result.ok) {
      const code = result.error.fields?.phCode;
      if (code === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('po'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), stale: result.error.code === 'CONFLICT' && !code, fields: result.error.fields ?? {} });
      return;
    }
    const data = result.data as { id: string };
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    router.replace(`/pharmacy/purchasing/orders/${data.id}`);
    router.refresh();
  };

  const money = (amount: bigint, currency: Currency) => {
    try {
      return formatPhMoney({ amount, currency }, locale);
    } catch {
      return `${amount} ${currency}`;
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 sm:px-8" data-testid="po-editor">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.purchasing.po.forBranch', { branch: isolate(branchName) })}
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
        <div role="alert" data-testid="po-error" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <span className="flex min-w-0 items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{failure.message}</span>
          </span>
          {failure.stale && (
            <Button
              size="lg"
              className="min-h-11"
              onClick={() => {
                draft.clear(start);
                setFailure(null);
                router.refresh();
              }}
            >
              {t('pharmacy.purchasing.reload')}
            </Button>
          )}
        </div>
      )}

      <fieldset disabled={busy} className="flex min-w-0 flex-col">
        <legend className="sr-only">{t('pharmacy.purchasing.po.section.header')}</legend>
        <FormSection id="po-head" title={t('pharmacy.purchasing.po.section.header')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
              <Field label={t('pharmacy.purchasing.po.supplier')} error={headerError('supplierId')}>
                <Select
                  className="[&_select]:min-h-11"
                  data-testid="po-supplier"
                  value={value.supplierId}
                  onChange={(e) => pickSupplier(e.target.value)}
                  options={[
                    { value: '', label: t('pharmacy.purchasing.po.supplierChoose') },
                    ...(value.supplierId && !suppliers.some((s) => s.id === value.supplierId) ? [{ value: value.supplierId, label: value.supplierName }] : []),
                    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('pharmacy.purchasing.po.supplierFind')} optional className="min-w-0 flex-1">
                  <Input
                    className="min-h-11"
                    dir="auto"
                    autoComplete="off"
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void searchSuppliers();
                      }
                    }}
                  />
                </Field>
                <Button size="lg" className="min-h-11" icon={<Search aria-hidden />} onClick={() => void searchSuppliers()}>
                  {t('pharmacy.purchasing.po.supplierFindGo')}
                </Button>
              </div>
            </div>
            <Field label={t('pharmacy.purchasing.po.currency')} error={headerError('currency')}>
              <Select
                className="[&_select]:min-h-11"
                value={value.currency}
                disabled={value.lines.length > 0}
                onChange={(e) => change({ currency: e.target.value as Currency })}
                options={currencies.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label={t('pharmacy.purchasing.po.expectedOn')} optional error={headerError('expectedOn')}>
              <Input className="min-h-11" dir="ltr" type="date" value={value.expectedOn} onChange={(e) => change({ expectedOn: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.purchasing.po.note')} optional error={headerError('note')} className="sm:col-span-2">
              <Textarea rows={2} dir="auto" maxLength={500} value={value.note} onChange={(e) => change({ note: e.target.value })} />
            </Field>
          </div>
        </FormSection>

        <FormSection id="po-suggest" title={t('pharmacy.purchasing.po.suggest.title')} intro={t('pharmacy.purchasing.po.suggest.intro')}>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" className="min-h-11" icon={<Lightbulb aria-hidden />} pending={suggest.state === 'loading'} disabled={!online} onClick={() => void loadSuggestions()}>
              {t('pharmacy.purchasing.po.suggest.load')}
            </Button>
          </div>
          {suggest.state === 'failed' && (
            <p role="alert" className="flex items-start gap-2.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              {suggest.message}
            </p>
          )}
          {suggest.state === 'done' && suggest.items.length === 0 && (
            <p data-testid="po-suggest-empty" className="flex items-start gap-2.5 text-sm text-text">
              <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
              {suggest.supplierId ? t('pharmacy.purchasing.po.suggest.noHistory') : t('pharmacy.purchasing.po.suggest.nothingLow')}
            </p>
          )}
          {suggest.state === 'done' && suggest.items.length > 0 && (
            <div className="flex flex-col gap-2" data-testid="po-suggest-list">
              <ul className="flex flex-col border-t border-line">
                {suggest.items.map((s) => (
                  <li key={s.productId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2 text-sm text-text">
                    <span dir="auto" className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                      {s.productName}
                    </span>
                    <span className="text-muted">
                      {t('pharmacy.purchasing.po.suggest.row', { available: formatNumber(s.available), min: formatNumber(s.minQty), qty: formatNumber(s.suggestedQty), unit: s.baseUnitLabel })}
                    </span>
                  </li>
                ))}
              </ul>
              <div>
                <Button size="lg" className="min-h-11" icon={<PackagePlus aria-hidden />} data-testid="po-suggest-add" onClick={() => addSuggestions((suggest as { items: PoSuggestion[] }).items)}>
                  {t('pharmacy.purchasing.po.suggest.addAll', { count: suggest.items.length })}
                </Button>
              </div>
            </div>
          )}
          {note && (
            <p role="status" className="flex items-start gap-2.5 text-sm text-text">
              <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
              {note}
            </p>
          )}
        </FormSection>

        <FormSection id="po-lines" title={t('pharmacy.purchasing.po.section.lines')} intro={t('pharmacy.purchasing.po.section.linesIntro')}>
          <ReceiptProductPicker boxRef={searchRef} onPick={addProduct} disabled={busy} />
          {problems.lines && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t('pharmacy.purchasing.po.problem.lines')}
            </p>
          )}
          {value.lines.length === 0 ? (
            <p data-testid="po-no-lines" className="flex items-start gap-2.5 text-sm text-muted">
              <PackagePlus aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.purchasing.po.noLines')}
            </p>
          ) : (
            <ol aria-label={t('pharmacy.purchasing.po.section.lines')} className="flex flex-col gap-3">
              {value.lines.map((line, i) => (
                <li key={line.key} data-testid="po-line" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
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
                      {lineError(i, 'productId') && (
                        <p className="flex items-start gap-1.5 text-sm text-danger">
                          <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                          {lineError(i, 'productId')}
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
                    <Field label={t('pharmacy.receive.field.unit')} error={lineError(i, 'unitId')}>
                      <Select
                        className="[&_select]:min-h-11"
                        value={line.unitId}
                        onChange={(e) => changeLine(line.key, { unitId: e.target.value })}
                        options={line.units.map((u) => ({ value: u.id, label: u.baseQty > 1 ? `${u.label} (${formatNumber(u.baseQty)})` : u.label }))}
                      />
                    </Field>
                    <Field label={t('pharmacy.purchasing.po.qty')} error={lineError(i, 'qty')}>
                      <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="po-qty" value={line.qty} onChange={(e) => changeLine(line.key, { qty: e.target.value })} />
                    </Field>
                    <Field label={t('pharmacy.receive.field.bonus')} hint={t('pharmacy.purchasing.po.bonusHint')} error={lineError(i, 'bonus')}>
                      <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" value={line.bonus} onChange={(e) => changeLine(line.key, { bonus: e.target.value })} />
                    </Field>
                    <Field label={t('pharmacy.purchasing.po.cost', { currency: value.currency })} error={lineError(i, 'cost')}>
                      <Input className="min-h-11" dir="ltr" inputMode="decimal" autoComplete="off" data-testid="po-cost" value={line.cost} onChange={(e) => changeLine(line.key, { cost: e.target.value })} />
                    </Field>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </FormSection>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 py-3 sm:-mx-8 sm:px-8">
        <p role="status" data-testid="po-totals" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text">
          <span>{t('pharmacy.receive.totals.lines', { count: value.lines.length })}</span>
          {totals.map((row) => (
            <span key={row.currency}>
              {t('pharmacy.purchasing.po.total')}:{' '}
              <bdi dir="ltr" className="tabular-nums">
                {money(row.totalMinor, row.currency)}
              </bdi>
            </span>
          ))}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="po-save" pending={pending === 'save'} disabled={!can || value.lines.length === 0} onClick={() => void save()}>
            {t('pharmacy.purchasing.po.saveDraft')}
          </Button>
        </div>
      </div>
    </div>
  );
}
