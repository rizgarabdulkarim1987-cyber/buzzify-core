'use client';

import { CircleAlert, Eye, EyeOff, Info, PackagePlus, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { receiptProduct } from '@/app/pharmacy/_actions/receipts';
import { stockBalances } from '@/app/pharmacy/_actions/stock';
import { requestTransfer, updateTransfer } from '@/app/pharmacy/_actions/transfers';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import type { ProductDetail } from '@/server/pharmacy/products';
import type { ProductBalance } from '@/server/pharmacy/stock-reads';
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
import { attemptKeyFor } from './purchasing-logic';
import { ReceiptProductPicker } from './ReceiptProductPicker';
import { newClientKey } from './sell-logic';
import {
  draftSignature,
  emptyTransferDraft,
  endsOf,
  ladderText,
  lineBaseQty,
  mayAt,
  transferInputOf,
  type Reach,
  type TransferDraft,
  type TransferLineDraft,
} from './transfers-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { useOnline } from './use-online';
import { isolate } from './WriteBlocked';

export interface BranchOption {
  id: string;
  name: string;
}

export interface TransferEditorProps {
  userId: string;
  restaurantId: string;
  /** Every branch of the business (names only). */
  branches: BranchOption[];
  reach: Reach;
  /** The branch the person works in now; null for "All branches". Its stock is what the form can show. */
  placeBranchId: string | null;
  /** The saved REQUESTED transfer being edited; null for a new one. */
  edit: { id: string; version: number; draft: TransferDraft } | null;
}

type StockNote = { state: 'loading' } | { state: 'ready'; sellable: number } | { state: 'failed' };

/**
 * The transfer request form: whether the person sends from their own branch or asks for stock into it, the other branch,
 * a note, then the lines (product search, unit, quantity in whole units of that product). Typed values stay on this device
 * until saved; the save key is made for exactly the values sent, so a retry after a lost answer replays. Where the sender's
 * stock can be seen from the branch the person works in, each line says how much is available there. No motion.
 */
export function TransferEditor({ userId, restaurantId, branches, reach, placeBranchId, edit }: TransferEditorProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const searchRef = useRef<HTMLDivElement>(null);
  const [firstKey] = useState(() => newClientKey('tr'));
  const mine = useMemo(() => (reach.allBranches ? branches : branches.filter((b) => reach.branchIds.includes(b.id))), [branches, reach]);
  const start = useMemo<TransferDraft>(() => {
    if (edit) return edit.draft;
    const own = (placeBranchId && mine.some((b) => b.id === placeBranchId) ? placeBranchId : mine[0]?.id) ?? '';
    return emptyTransferDraft(firstKey, 'send', own, branches.find((b) => b.id !== own)?.id ?? '');
  }, [edit, firstKey, mine, branches, placeBranchId]);
  const draft = useDraft<TransferDraft>(draftKey(userId, `transfer@${restaurantId}`, edit ? `${edit.id}:${edit.version}` : 'new'), start);
  const value = draft.value;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale: boolean; fields: Record<string, string> } | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [counter, setCounter] = useState(0);
  const [stock, setStock] = useState<Record<string, StockNote>>({});
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const nameOf = (id: string) => branches.find((b) => b.id === id)?.name ?? '';
  const { fromBranchId, toBranchId } = endsOf(value);
  const change = (patch: Partial<TransferDraft>) => {
    setSaved(false);
    draft.set({ ...value, ...patch });
  };
  const changeLine = (key: string, patch: Partial<TransferLineDraft>) => change({ lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const busy = pending;
  const can = online && !busy;

  // The sender's stock per product, when the branch the person works in is (or includes) the sender. Asked once per product and sender.
  const seesSender = fromBranchId !== '' && (placeBranchId === null || placeBranchId === fromBranchId) && mayAt(reach, fromBranchId);
  const asked = useRef(new Set<string>());
  const productKey = value.lines.map((l) => l.productId).join(',');
  useEffect(() => {
    if (!seesSender) return;
    let live = true;
    for (const line of value.lines) {
      const key = `${fromBranchId}|${line.productId}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      setStock((s) => ({ ...s, [key]: { state: 'loading' } }));
      void settle(() => stockBalances({ productId: line.productId, pageSize: 1 })).then((result) => {
        if (!live) {
          asked.current.delete(key);
          return;
        }
        if (!result.ok) {
          asked.current.delete(key);
          setStock((s) => ({ ...s, [key]: { state: 'failed' } }));
          return;
        }
        const row = (result.data as { items: ProductBalance[] }).items[0];
        const sellable = row?.branches.find((b) => b.branchId === fromBranchId)?.sellable ?? 0;
        setStock((s) => ({ ...s, [key]: { state: 'ready', sellable } }));
      });
    }
    return () => {
      live = false;
    };
    // The lines are read through their product ids; `fromBranchId` decides whose stock it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey, fromBranchId, seesSender]);

  const addProduct = async (found: SearchResult): Promise<string | null> => {
    if (value.lines.some((l) => l.productId === found.productId)) return t('pharmacy.transfers.editor.alreadyOn');
    if (value.lines.length >= 100) return t('pharmacy.transfers.editor.problem.tooMany');
    const result = await settle(() => receiptProduct({ productId: found.productId }));
    if (!result.ok) return describeFailure(t, locale, result.error).message;
    const product = result.data as ProductDetail;
    const units = [...product.units].sort((a, b) => a.level - b.level).map((u) => ({ id: u.id, label: u.label, baseQty: u.baseQty }));
    const base = units[0];
    if (!base) return t('pharmacy.receive.search.noUnits');
    const chosen = found.unitId && units.some((u) => u.id === found.unitId) ? found.unitId : base.id;
    const key = `n${counter + 1}`;
    setCounter((n) => n + 1);
    change({
      lines: [
        ...value.lines,
        { key, productId: product.id, productName: product.tradeName, productMeta: [product.strength, product.form].filter((p) => p.trim() !== '').join(' · '), units, unitId: chosen, qty: '' },
      ],
    });
    return null;
  };

  const save = async () => {
    const built = transferInputOf(value, reach, edit ? 'update' : 'create');
    setProblems(built.problems);
    if (!built.input) {
      setFailure(null);
      return;
    }
    setPending(true);
    const sig = draftSignature(value);
    const attempt = attemptKeyFor(value, sig, 'tr');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle<{ id: string }>(() => (edit ? updateTransfer({ ...built.input, transferId: edit.id, version: edit.version }) : requestTransfer({ ...built.input, clientKey: attempt.clientKey })));
    setPending(false);
    if (!result.ok) {
      const code = result.error.fields?.phCode;
      if (code === 'CLIENT_KEY_MISMATCH' || code === 'CLIENT_KEY_USED') draft.set({ ...value, clientKey: newClientKey('tr'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.transfers'), stale: code === 'VERSION_CONFLICT' || code === 'NOT_REQUESTED', fields: result.error.fields ?? {} });
      return;
    }
    const data = result.data as { id: string };
    setFailure(null);
    setSaved(true);
    draft.clear(value);
    router.replace(`/pharmacy/stock/transfers/${data.id}`);
    router.refresh();
  };

  const problemText = (field: string): string | undefined => {
    const code = problems[field];
    return code ? t(`pharmacy.transfers.editor.problem.${code}`) : undefined;
  };
  const lineError = (i: number, field: string) => problemText(`lines.${i}.${field}`);
  const totalBase = value.lines.reduce((sum, l) => sum + (lineBaseQty(l) ?? 0), 0);

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-6 sm:px-8" data-testid="transfer-editor">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
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
        <div role="alert" data-testid="transfer-error" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
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
              {t('pharmacy.transfers.reload')}
            </Button>
          )}
        </div>
      )}

      <fieldset disabled={busy} className="flex min-w-0 flex-col">
        <legend className="sr-only">{t('pharmacy.transfers.editor.section.branches')}</legend>
        <FormSection id="tr-branches" title={t('pharmacy.transfers.editor.section.branches')}>
          {edit ? (
            <p data-testid="transfer-ends" className="text-sm text-text">
              {t('pharmacy.transfers.editor.ends', { from: isolate(nameOf(fromBranchId)), to: isolate(nameOf(toBranchId)) })}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="flex min-w-0 flex-col gap-1 sm:col-span-2">
                <legend className="text-sm font-medium text-text">{t('pharmacy.transfers.editor.mode')}</legend>
                {(['send', 'request'] as const).map((m) => (
                  <label key={m} className="inline-flex min-h-11 items-center gap-2.5 text-sm text-text">
                    <input type="radio" name="transfer-mode" value={m} checked={value.mode === m} data-testid={`transfer-mode-${m}`} onChange={() => change({ mode: m })} className="size-5" />
                    {t(`pharmacy.transfers.editor.mode.${m}`)}
                  </label>
                ))}
              </fieldset>
              <Field label={t(value.mode === 'send' ? 'pharmacy.transfers.editor.mineFrom' : 'pharmacy.transfers.editor.mineTo')} error={problemText('branches') && problems.branches !== 'same' && problems.branches !== 'missing' ? problemText('branches') : undefined}>
                <Select
                  className="[&_select]:min-h-11"
                  data-testid="transfer-mine"
                  value={value.mineId}
                  onChange={(e) => change({ mineId: e.target.value, otherId: e.target.value === value.otherId ? '' : value.otherId })}
                  options={mine.map((b) => ({ value: b.id, label: b.name }))}
                />
              </Field>
              <Field label={t(value.mode === 'send' ? 'pharmacy.transfers.editor.otherTo' : 'pharmacy.transfers.editor.otherFrom')} error={problems.branches === 'same' || problems.branches === 'missing' ? problemText('branches') : undefined}>
                <Select
                  className="[&_select]:min-h-11"
                  data-testid="transfer-other"
                  value={value.otherId}
                  onChange={(e) => change({ otherId: e.target.value })}
                  options={[{ value: '', label: t('pharmacy.transfers.editor.choose') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
              </Field>
            </div>
          )}
          <Field label={t('pharmacy.transfers.editor.note')} optional>
            <Textarea rows={2} dir="auto" maxLength={500} value={value.note} onChange={(e) => change({ note: e.target.value })} />
          </Field>
        </FormSection>

        <FormSection id="tr-lines" title={t('pharmacy.transfers.editor.section.lines')} intro={t('pharmacy.transfers.editor.section.linesIntro')}>
          <ReceiptProductPicker boxRef={searchRef} onPick={addProduct} disabled={busy} />
          {problems.lines && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {problemText('lines')}
            </p>
          )}
          {value.lines.length === 0 ? (
            <p data-testid="transfer-no-lines" className="flex items-start gap-2.5 text-sm text-muted">
              <PackagePlus aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.transfers.editor.noLines')}
            </p>
          ) : (
            <ol aria-label={t('pharmacy.transfers.editor.section.lines')} className="flex flex-col gap-3">
              {value.lines.map((line, i) => {
                const base = lineBaseQty(line);
                const note = stock[`${fromBranchId}|${line.productId}`];
                return (
                  <li key={line.key} data-testid="transfer-line" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t('pharmacy.receive.field.unit')}>
                        <Select
                          className="[&_select]:min-h-11"
                          value={line.unitId}
                          onChange={(e) => changeLine(line.key, { unitId: e.target.value })}
                          options={line.units.map((u) => ({ value: u.id, label: u.baseQty > 1 ? `${u.label} (${formatNumber(u.baseQty)})` : u.label }))}
                        />
                      </Field>
                      <Field label={t('pharmacy.transfers.editor.qty')} error={lineError(i, 'qty')}>
                        <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="transfer-qty" value={line.qty} onChange={(e) => changeLine(line.key, { qty: e.target.value })} />
                      </Field>
                    </div>
                    <p className="text-sm text-text" data-testid="transfer-line-base">
                      {base === null ? t('pharmacy.transfers.editor.qtyHint') : t('pharmacy.transfers.editor.baseQty', { qty: formatNumber(base), ladder: ladderText(line.units, base) })}
                    </p>
                    <p data-testid="transfer-line-stock" className="flex items-start gap-2 text-sm text-muted">
                      {seesSender && note?.state === 'ready' ? (
                        <>
                          <Eye aria-hidden className="mt-px size-4 shrink-0" />
                          <span className="min-w-0">
                            {t('pharmacy.transfers.editor.senderStock', { branch: isolate(nameOf(fromBranchId)), qty: formatNumber(note.sellable), ladder: ladderText(line.units, note.sellable) })}
                            {base !== null && base > note.sellable ? ` ${t('pharmacy.transfers.editor.senderShort')}` : ''}
                          </span>
                        </>
                      ) : seesSender && note?.state === 'failed' ? (
                        <>
                          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                          <span className="min-w-0">{t('pharmacy.transfers.editor.senderStockFailed')}</span>
                        </>
                      ) : seesSender ? (
                        <>
                          <Eye aria-hidden className="mt-px size-4 shrink-0" />
                          <span className="min-w-0">{t('pharmacy.transfers.editor.senderStockLoading')}</span>
                        </>
                      ) : (
                        <>
                          <EyeOff aria-hidden className="mt-px size-4 shrink-0" />
                          <span className="min-w-0">{t('pharmacy.transfers.editor.senderStockHidden', { branch: isolate(nameOf(fromBranchId)) })}</span>
                        </>
                      )}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </FormSection>
      </fieldset>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-line bg-bg px-4 py-3 sm:-mx-8 sm:px-8">
        <p role="status" data-testid="transfer-totals" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text">
          <span>{t('pharmacy.receive.totals.lines', { count: value.lines.length })}</span>
          <span>{t('pharmacy.transfers.editor.totalUnits', { qty: formatNumber(totalBase) })}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" className="min-h-11" icon={<Save aria-hidden />} data-testid="transfer-save" pending={pending} disabled={!can || value.lines.length === 0} onClick={() => void save()}>
            {t(edit ? 'pharmacy.transfers.editor.saveEdit' : 'pharmacy.transfers.editor.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
