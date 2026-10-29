'use client';

import { CircleAlert, Info, Lock, Plus, RotateCcw, Send, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { stockBalances } from '@/app/pharmacy/_actions/stock';
import { sendTransfer } from '@/app/pharmacy/_actions/transfers';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { formatExpiry } from '@/server/domain/pharmacy/expiry';
import type { ProductBalance } from '@/server/pharmacy/stock-reads';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { phMessage } from './ph-failure';
import { attemptKeyFor } from './purchasing-logic';
import { newClientKey } from './sell-logic';
import { TransferFailure } from './TransferFailure';
import {
  isOverridePicks,
  proposeSend,
  rowKey,
  rowQty,
  sendInputOf,
  sendSignature,
  sendableBatch,
  type SendProposal,
  type SendRow,
  type SendStockBatch,
} from './transfers-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';

export interface SendRequestRow {
  lineId: string;
  productId: string;
  productName: string;
  requestedQty: number;
}

interface SendDraft {
  /** Typed quantities by `<lineId>|<batchId>`. */
  edits: Record<string, string>;
  /** Batches added with "Pick another batch", by line. */
  extra: Record<string, string[]>;
  clientKey: string;
  keySig?: string;
  /** What the sender's stock looked like when these edits were made: a changed stock drops them. */
  basis: string;
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; stock: SendStockBatch[] };

/** The sender's batches with what is available there, one stock read per product. */
async function readStock(rows: readonly SendRequestRow[], fromBranchId: string): Promise<Load> {
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const answers = await Promise.all(productIds.map((productId) => settle(() => stockBalances({ productId, pageSize: 1 }))));
  if (answers.some((a) => !a.ok)) return { state: 'failed' };
  const stock: SendStockBatch[] = [];
  answers.forEach((answer, i) => {
    const item = (answer as { ok: true; data: { items: ProductBalance[] } }).data.items[0];
    for (const b of item?.batches ?? []) {
      const mine = b.buckets.find((bucket) => bucket.branchId === fromBranchId);
      if (mine) stock.push({ batchId: b.batchId, productId: productIds[i]!, lot: b.lot, expiryDate: b.expiryDate, expiryPrecision: b.expiryPrecision, status: b.status, available: mine.available });
    }
  });
  return { state: 'ready', stock };
}

const NO_STOCK: SendStockBatch[] = [];
const basisOf = (stock: readonly SendStockBatch[]) => JSON.stringify([...stock].sort((a, b) => (a.batchId < b.batchId ? -1 : 1)).map((b) => [b.batchId, b.available, b.status]));

/**
 * The send panel of a REQUESTED transfer, opened at the sender. It reads the sender's stock fresh, proposes the batches FEFO
 * (earliest expiry first) for every request line as a table, lets the person send less from a row (never above the batch or the
 * request), and asks before it takes the stock out. Taking a batch out of expiry order needs `batch.override` and is flagged
 * in words. The attempt key is made for exactly these picks and kept with the draft, so a double tap or a lost answer
 * sends once. No motion.
 */
export function TransferSend({
  userId,
  restaurantId,
  transfer,
  canOverride,
  today,
  rows,
  online,
  onClose,
}: {
  userId: string;
  restaurantId: string;
  transfer: { id: string; version: number; fromBranchId: string; fromBranchName: string; toBranchName: string };
  canOverride: boolean;
  today: string;
  rows: SendRequestRow[];
  online: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [firstKey] = useState(() => newClientKey('trs'));
  const start = useMemo<SendDraft>(() => ({ edits: {}, extra: {}, clientKey: firstKey, basis: '' }), [firstKey]);
  const draft = useDraft<SendDraft>(draftKey(userId, `transfer-send@${restaurantId}`, `${transfer.id}:${transfer.version}`), start);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale: boolean } | null>(null);
  const [dropped, setDropped] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    void readStock(rows, transfer.fromBranchId).then((answer) => {
      if (live) setLoad(answer);
    });
    return () => {
      live = false;
    };
  }, [rows, transfer.fromBranchId, reads]);
  const reloadStock = () => {
    setLoad({ state: 'loading' });
    setReads((n) => n + 1);
  };

  const stock = useMemo(() => (load.state === 'ready' ? load.stock : NO_STOCK), [load]);
  const basis = useMemo(() => basisOf(stock), [stock]);
  // A draft restored from an earlier visit was made on another stock: its quantities no longer mean what they did, so the
  // proposal is shown instead (the old draft is replaced by the first edit).
  const stale = load.state === 'ready' && draft.restored && draft.value.basis !== basis;
  const value = stale ? start : draft.value;
  const dirty = stale ? false : draft.dirty;
  useLeaveGuard(dirty, t('pharmacy.catalog.leaveConfirm'));

  const proposal = useMemo<SendProposal[]>(() => proposeSend(rows.map((r) => ({ lineId: r.lineId, productId: r.productId, requestedQty: r.requestedQty })), stock, today), [rows, stock, today]);
  const built = useMemo(
    () => sendInputOf({ transferId: transfer.id, version: transfer.version, proposal, edits: value.edits, extra: value.extra, stock, today, canOverride }),
    [transfer.id, transfer.version, proposal, value.edits, value.extra, stock, today, canOverride],
  );
  const edit = (patch: Partial<SendDraft>) => {
    if (stale) setDropped(true);
    setConfirming(false);
    setFailure(null);
    draft.set({ ...value, ...patch, basis });
  };

  const send = async () => {
    if (!built.input || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const sig = sendSignature(transfer.id, built.input.picks);
    const attempt = attemptKeyFor(value, sig, 'trs');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle(() => sendTransfer({ ...built.input, clientKey: attempt.clientKey }));
    inFlight.current = false;
    setPending(false);
    if (!result.ok) {
      const code = result.error.fields?.phCode;
      if (code === 'CLIENT_KEY_MISMATCH' || code === 'CLIENT_KEY_USED') draft.set({ ...value, clientKey: newClientKey('trs'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.transfers'), stale: code === 'VERSION_CONFLICT' || code === 'NOT_REQUESTED' });
      setConfirming(false);
      if (code === 'INSUFFICIENT_STOCK' || code === 'BATCH_NOT_SENDABLE') reloadStock();
      return;
    }
    setFailure(null);
    draft.clear();
    onClose();
    router.refresh();
  };

  const busy = pending;
  const can = online && !busy;
  const rowsOf = (line: SendProposal): SendRow[] => [...line.rows, ...(value.extra[line.lineId] ?? []).filter((id) => !line.rows.some((r) => r.batchId === id)).map((batchId) => ({ batchId, qty: 0 }))];
  const lineOver = (line: SendProposal) => {
    const filled = rowsOf(line).map((r) => ({ batchId: r.batchId, qty: rowQty(value.edits, line.lineId, r) ?? 0 }));
    return isOverridePicks(filled, stock.filter((b) => b.productId === line.productId), today);
  };
  const problemText = (code: string | undefined) => (code ? t(`pharmacy.transfers.send.problem.${code}`) : undefined);
  const needsOverride = built.problems.override === 'needed';

  return (
    <section aria-label={t('pharmacy.transfers.send.title')} data-testid="transfer-send-panel" className="flex min-w-0 flex-col gap-4 rounded-md border border-line-strong bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold text-text">{t('pharmacy.transfers.send.title')}</h2>
        <UnsavedBadge dirty={dirty} saved={false} />
      </div>
      <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.transfers.send.intro')}</p>
      {draft.restored && !stale && !dropped && (
        <p role="status" className="flex items-start gap-2.5 text-sm text-text">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          {t('pharmacy.catalog.draft.restored')}
        </p>
      )}
      {(stale || dropped) && (
        <p role="status" data-testid="send-stock-changed" className="flex items-start gap-2.5 text-sm text-text">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          {t('pharmacy.transfers.send.stockChanged')}
        </p>
      )}
      {failure && <TransferFailure testId="transfer-send-error" message={failure.message} stale={failure.stale} onReload={() => router.refresh()} />}

      {load.state === 'loading' && (
        <p role="status" className="flex items-center gap-2.5 text-sm text-muted">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('pharmacy.transfers.send.loading')}
        </p>
      )}
      {load.state === 'failed' && (
        <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
          <span className="flex min-w-0 items-start gap-2.5">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            {t('pharmacy.transfers.send.loadFailed')}
          </span>
          <Button size="lg" className="min-h-11" icon={<RotateCcw aria-hidden />} onClick={reloadStock}>
            {t('pharmacy.stock.retry')}
          </Button>
        </div>
      )}

      {load.state === 'ready' && (
        <>
          <ol className="flex flex-col gap-3">
            {proposal.map((line) => {
              const row = rows.find((r) => r.lineId === line.lineId)!;
              const lineRows = rowsOf(line);
              const total = lineRows.reduce((sum, r) => sum + (rowQty(value.edits, line.lineId, r) ?? 0), 0);
              const over = lineOver(line);
              const others = stock.filter((b) => b.productId === line.productId && sendableBatch(b, today) && b.available > 0 && !lineRows.some((r) => r.batchId === b.batchId));
              const lineProblem = problemText(built.problems[line.lineId]);
              return (
                <li key={line.lineId} data-testid="send-line" data-over={over || undefined} className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                      {row.productName}
                    </p>
                    <p className="text-sm text-text tabular-nums">
                      {t('pharmacy.transfers.send.line.figures', { requested: formatNumber(line.requestedQty), available: formatNumber(line.availableQty), sending: formatNumber(total) })}
                    </p>
                  </div>
                  {line.short && (
                    <p data-testid="send-short" className="flex items-start gap-2 text-sm text-danger">
                      <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                      <span className="min-w-0">{line.availableQty === 0 ? t('pharmacy.transfers.send.line.none') : t('pharmacy.transfers.send.line.short', { available: formatNumber(line.availableQty) })}</span>
                    </p>
                  )}
                  {lineProblem && (
                    <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                      <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                      <span className="min-w-0">{lineProblem}</span>
                    </p>
                  )}
                  {lineRows.length > 0 && (
                    <ul className="flex flex-col border-t border-line">
                      {lineRows.map((r) => {
                        const batch = stock.find((b) => b.batchId === r.batchId)!;
                        const problem = problemText(built.problems[rowKey(line.lineId, r.batchId)]);
                        const label = t('pharmacy.transfers.send.row.qty', { lot: batch.lot });
                        return (
                          <li key={r.batchId} data-testid="send-row" className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 border-b border-line py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_minmax(0,7rem)_minmax(0,8rem)] sm:items-center">
                            <span className="text-sm text-text">
                              <span className="text-muted">{t('pharmacy.transfers.col.lot')}: </span>
                              <bdi dir="ltr" className="font-medium tabular-nums">
                                {batch.lot}
                              </bdi>
                            </span>
                            <span className="text-sm text-text">
                              <span className="text-muted">{t('pharmacy.transfers.col.expiry')}: </span>
                              <bdi dir="ltr" className="tabular-nums">
                                {formatExpiry({ expiryDate: batch.expiryDate, expiryPrecision: batch.expiryPrecision })}
                              </bdi>
                            </span>
                            <span className="text-sm text-text tabular-nums">
                              <span className="text-muted">{t('pharmacy.transfers.col.available')}: </span>
                              {formatNumber(batch.available)}
                            </span>
                            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
                              <span className="sr-only">{label}</span>
                              <span aria-hidden>{t('pharmacy.transfers.col.send')}</span>
                              <Input
                                className="min-h-11"
                                dir="ltr"
                                inputMode="numeric"
                                autoComplete="off"
                                data-testid="send-qty"
                                aria-invalid={problem ? true : undefined}
                                disabled={busy}
                                value={value.edits[rowKey(line.lineId, r.batchId)] ?? String(r.qty)}
                                onChange={(e) => edit({ edits: { ...value.edits, [rowKey(line.lineId, r.batchId)]: e.target.value } })}
                              />
                            </label>
                            {problem && (
                              <p role="alert" className="flex items-start gap-2 text-sm text-danger sm:col-span-4">
                                <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                                {problem}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {over && (
                    <p data-testid="send-override-flag" className="flex items-start gap-2 text-sm font-medium text-text">
                      <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                      <span className="min-w-0">{canOverride ? t('pharmacy.transfers.send.override.flag') : t('pharmacy.transfers.send.override.flagNeeds')}</span>
                    </p>
                  )}
                  {others.length > 0 && (
                    <div className="flex flex-wrap items-end gap-2">
                      {canOverride ? (
                        <>
                          <label className="flex min-w-0 flex-col gap-1 text-sm text-text">
                            {t('pharmacy.transfers.send.pickAnother')}
                            <Select
                              className="[&_select]:min-h-11"
                              data-testid="send-pick-select"
                              value={pick[line.lineId] ?? ''}
                              onChange={(e) => setPick({ ...pick, [line.lineId]: e.target.value })}
                              options={[
                                { value: '', label: t('pharmacy.transfers.send.pickChoose') },
                                ...others.map((b) => ({ value: b.batchId, label: `${b.lot} · ${formatExpiry({ expiryDate: b.expiryDate, expiryPrecision: b.expiryPrecision })} · ${formatNumber(b.available)}` })),
                              ]}
                            />
                          </label>
                          <Button
                            size="lg"
                            className="min-h-11"
                            icon={<Plus aria-hidden />}
                            data-testid="send-pick-add"
                            disabled={!pick[line.lineId] || busy}
                            onClick={() => {
                              const id = pick[line.lineId]!;
                              setPick({ ...pick, [line.lineId]: '' });
                              edit({ extra: { ...value.extra, [line.lineId]: [...(value.extra[line.lineId] ?? []), id] } });
                            }}
                          >
                            {t('pharmacy.transfers.send.pickAdd')}
                          </Button>
                        </>
                      ) : (
                        <div className="flex min-w-0 flex-col gap-1">
                          <Button size="lg" className="min-h-11" icon={<Lock aria-hidden />} data-testid="send-pick-disabled" disabled aria-describedby={`why-${line.lineId}`}>
                            {t('pharmacy.transfers.send.pickAnother')}
                          </Button>
                          <p id={`why-${line.lineId}`} className="flex items-start gap-2 text-sm text-muted">
                            <Lock aria-hidden className="mt-px size-4 shrink-0" />
                            {t('pharmacy.transfers.send.pickWhy')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          {built.problems.nothing && (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.transfers.send.problem.nothing')}
            </p>
          )}
          {needsOverride && (
            <p role="alert" data-testid="send-override-needed" className="flex items-start gap-2 text-sm text-danger">
              <Lock aria-hidden className="mt-px size-4 shrink-0" />
              {t('pharmacy.transfers.send.problem.needed')}
            </p>
          )}

          {!confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="lg" className="min-h-11" icon={<Send aria-hidden />} data-testid="send-review" disabled={!can || !built.input} onClick={() => setConfirming(true)}>
                {t('pharmacy.transfers.send.review')}
              </Button>
              <Button size="lg" className="min-h-11" disabled={busy} onClick={onClose}>
                {t('pharmacy.receive.confirm.back')}
              </Button>
            </div>
          ) : (
            <div role="region" aria-label={t('pharmacy.transfers.send.confirmTitle')} data-testid="send-confirm" className="flex flex-col gap-3 rounded-md border border-ink bg-surface p-4">
              <p className="flex max-w-[72ch] items-start gap-2.5 text-sm font-medium text-text">
                <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                <span className="min-w-0">
                  {t('pharmacy.transfers.send.confirm', { qty: formatNumber(built.totalQty), from: isolate(transfer.fromBranchName), to: isolate(transfer.toBranchName) })}
                </span>
              </p>
              {built.overridden && (
                <p className="flex items-start gap-2.5 text-sm text-text">
                  <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                  {t('pharmacy.transfers.send.confirmOverride')}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="lg" className="min-h-11" data-testid="send-confirm-yes" pending={pending} disabled={!can || !built.input} onClick={() => void send()}>
                  {t('pharmacy.transfers.send.confirmYes')}
                </Button>
                <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>
                  {t('pharmacy.receive.confirm.back')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
