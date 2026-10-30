'use client';

import { CircleAlert, Info, PackageMinus, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { stockBalances } from '@/app/pharmacy/_actions/stock';
import { createSupplierReturn } from '@/app/pharmacy/_actions/supplier-returns';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import type { ProductBalance } from '@/server/pharmacy/stock-reads';
import { phDate } from '@/app/pharmacy/_ui/ph-date';
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
import { attemptKeyFor } from './purchasing-logic';
import { addReturnLine, emptyReturnDraft, returnInputOf, returnSignature, type ReturnDraft } from './purchasing-money-logic';
import { newClientKey } from './sell-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';
import { useOnline } from './use-online';

type Found = { state: 'idle' } | { state: 'loading' } | { state: 'failed'; message: string } | { state: 'done'; items: ProductBalance[]; q: string };

/**
 * Returning stock to a supplier from the chosen branch: supplier, reason, then lines picked from the branch's batches
 * (available or quarantine), each in whole base units of the product. A line above what the branch holds is refused here
 * and again by the server (INSUFFICIENT_STOCK, in words). Typed values stay on this device.
 */
export function SupplierReturnForm({
  userId,
  restaurantId,
  branchId,
  branchName,
  suppliers,
}: {
  userId: string;
  restaurantId: string;
  branchId: string;
  branchName: string;
  suppliers: { id: string; name: string }[];
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [firstKey] = useState(() => newClientKey('sr'));
  const start = useMemo(() => emptyReturnDraft(firstKey), [firstKey]);
  const draft = useDraft<ReturnDraft>(draftKey(userId, `return@${restaurantId}:${branchId}`, 'new'), start);
  const value = draft.value;
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found>({ state: 'idle' });
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saved, setSaved] = useState(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const built = returnInputOf(value);
  const change = (patch: Partial<ReturnDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  const problem = (field: string) => {
    const code = (built.problems as Record<string, string>)[field];
    return showProblems && code ? t(`pharmacy.purchasing.m.ret.problem.${code}`) : failure?.fields[field];
  };

  const search = async () => {
    setFound({ state: 'loading' });
    const asked = q.trim();
    const result = await settle(() => stockBalances({ search: asked, onlyWithStock: true, pageSize: 20 }));
    if (!result.ok) {
      setFound({ state: 'failed', message: phMessage(t, locale, result.error, 'pharmacy.purchasing') });
      return;
    }
    setFound({ state: 'done', items: (result.data as { items: ProductBalance[] }).items, q: asked });
  };

  const save = async () => {
    setShowProblems(true);
    if (!built.input) return;
    setPending(true);
    const sig = returnSignature(value);
    const attempt = attemptKeyFor(value, sig, 'sr');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle<{ id: string }>(() => createSupplierReturn({ ...built.input, clientKey: attempt.clientKey }));
    setPending(false);
    if (!result.ok) {
      if (result.error.fields?.phCode === 'CLIENT_KEY_MISMATCH') draft.set({ ...value, clientKey: newClientKey('sr'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.purchasing'), fields: result.error.fields ?? {} });
      return;
    }
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    router.replace(`/pharmacy/purchasing/returns/${result.data.id}`);
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 sm:px-8" data-testid="return-form">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.purchasing.m.ret.fromBranch', { branch: isolate(branchName) })}
        </span>
        <UnsavedBadge dirty={draft.dirty} saved={saved} />
      </div>
      <OfflineNotice />
      {failure && (
        <div role="alert" data-testid="return-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          <span className="min-w-0">{failure.message}</span>
        </div>
      )}
      <fieldset disabled={pending} className="flex min-w-0 flex-col">
        <legend className="sr-only">{t('pharmacy.purchasing.m.ret.newTitle')}</legend>
        <FormSection id="ret-head" title={t('pharmacy.purchasing.m.ret.header')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('pharmacy.purchasing.po.supplier')} error={problem('supplierId')}>
              <Select
                className="[&_select]:min-h-11"
                data-testid="ret-supplier"
                value={value.supplierId}
                onChange={(e) => change({ supplierId: e.target.value })}
                options={[{ value: '', label: t('pharmacy.purchasing.po.supplierChoose') }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
              />
            </Field>
            <Field label={t('pharmacy.purchasing.m.reason')} error={problem('reason')} hint={t('pharmacy.purchasing.m.reasonHint')}>
              <Input className="min-h-11" dir="auto" maxLength={300} autoComplete="off" data-testid="ret-reason" value={value.reason} onChange={(e) => change({ reason: e.target.value })} />
            </Field>
            <Field label={t('pharmacy.purchasing.po.note')} optional className="sm:col-span-2">
              <Textarea rows={2} dir="auto" maxLength={500} value={value.note} onChange={(e) => change({ note: e.target.value })} />
            </Field>
          </div>
        </FormSection>

        <FormSection id="ret-lines" title={t('pharmacy.purchasing.m.ret.lines')} intro={t('pharmacy.purchasing.m.ret.linesIntro')}>
          <form
            role="search"
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <Field label={t('pharmacy.purchasing.m.ret.find')} className="min-w-0 flex-1">
              <Input className="min-h-11" dir="auto" autoComplete="off" data-testid="ret-search" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Button type="submit" size="lg" className="min-h-11" icon={<Search aria-hidden />} data-testid="ret-search-go" pending={found.state === 'loading'} disabled={!online}>
              {t('pharmacy.purchasing.m.ret.findGo')}
            </Button>
          </form>
          {found.state === 'failed' && (
            <p role="alert" className="flex items-start gap-2.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              {found.message}
            </p>
          )}
          {found.state === 'done' && found.items.length === 0 && (
            <p data-testid="ret-none" className="flex items-start gap-2.5 text-sm text-text">
              <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
              {t('pharmacy.purchasing.m.ret.noneFound')}
            </p>
          )}
          {found.state === 'done' && found.items.length > 0 && (
            <ul aria-label={t('pharmacy.receive.search.results')} className="flex flex-col border-t border-line" data-testid="ret-results">
              {found.items.flatMap((p) =>
                p.batches.map((b) => {
                  const mine = b.buckets.find((x) => x.branchId === branchId);
                  if (!mine) return [];
                  return (['AVAILABLE', 'QUARANTINE'] as const)
                    .map((bucket) => ({ bucket, have: bucket === 'AVAILABLE' ? mine.available : mine.quarantine }))
                    .filter((x) => x.have > 0)
                    .map(({ bucket, have }) => (
                      <li key={`${b.batchId}-${bucket}`} data-testid="ret-result" className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2 text-sm text-text">
                        <span className="flex min-w-0 flex-col">
                          <span dir="auto" className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                            {p.tradeName}
                          </span>
                          <span className="text-muted">
                            {t('pharmacy.stock.batch.lot')} <bdi dir="ltr">{b.lot}</bdi> · {phDate(`${b.expiryDate}T00:00:00.000Z`, locale)} · {t(`pharmacy.stock.bucket.${bucket.toLowerCase()}`)}: <bdi dir="ltr">{formatNumber(have)}</bdi>
                          </span>
                        </span>
                        <Button
                          size="lg"
                          className="min-h-11"
                          icon={<Plus aria-hidden />}
                          data-testid="ret-add"
                          onClick={() => change({ lines: addReturnLine(value.lines, { batchId: b.batchId, bucket, qty: '', max: have, productName: p.tradeName, lot: b.lot, expiry: b.expiryDate }) })}
                        >
                          {t('pharmacy.purchasing.m.ret.add')}
                          <span className="sr-only">
                            {' '}
                            {p.tradeName} {b.lot} {t(`pharmacy.stock.bucket.${bucket.toLowerCase()}`)}
                          </span>
                        </Button>
                      </li>
                    ));
                }),
              )}
            </ul>
          )}
          {problem('lines') && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {problem('lines')}
            </p>
          )}
          {value.lines.length === 0 ? (
            <p data-testid="ret-no-lines" className="flex items-start gap-2.5 text-sm text-muted">
              <PackageMinus aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.purchasing.m.ret.noLines')}
            </p>
          ) : (
            <ol aria-label={t('pharmacy.purchasing.m.ret.lines')} className="flex flex-col gap-3">
              {value.lines.map((l, i) => (
                <li key={`${l.batchId}-${l.bucket}`} data-testid="ret-line" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="flex min-w-0 flex-col">
                      <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                        {l.productName}
                      </p>
                      <p className="text-sm text-muted">
                        {t('pharmacy.stock.batch.lot')} <bdi dir="ltr">{l.lot}</bdi> · {phDate(`${l.expiry}T00:00:00.000Z`, locale)} · {t(`pharmacy.stock.bucket.${l.bucket.toLowerCase()}`)} ({t('pharmacy.purchasing.m.ret.upTo', { max: formatNumber(l.max) })})
                      </p>
                    </div>
                    <Button size="lg" className="min-h-11" icon={<Trash2 aria-hidden />} onClick={() => change({ lines: value.lines.filter((_, j) => j !== i) })}>
                      {t('pharmacy.receive.line.remove')}
                      <span className="sr-only">
                        {' '}
                        {l.productName} {l.lot}
                      </span>
                    </Button>
                  </div>
                  <Field label={t('pharmacy.purchasing.m.ret.qty')} error={problem(`lines.${i}.qty`) ?? problem(`lines.${i}.batchId`)} className="max-w-xs">
                    <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="ret-qty" value={l.qty} onChange={(e) => change({ lines: value.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
                  </Field>
                </li>
              ))}
            </ol>
          )}
        </FormSection>
      </fieldset>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 py-3 sm:-mx-8 sm:px-8">
        <p role="status" className="text-sm text-text">
          {t('pharmacy.receive.totals.lines', { count: value.lines.length })}
        </p>
        <div>
          <Button variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="ret-save" pending={pending} disabled={!online || value.lines.length === 0} onClick={() => void save()}>
            {t('pharmacy.purchasing.m.ret.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
