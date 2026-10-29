'use client';

import { CircleAlert, Info, Lock, PackageCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { receiveTransfer } from '@/app/pharmacy/_actions/transfers';
import { formatNumber } from '@/lib/pos-format';
import { draftKey, useDraft } from '@/lib/use-draft';
import { useLeaveGuard } from '@/lib/use-leave-guard';
import { formatExpiry, isExpired, type ExpiryPrecision } from '@/server/domain/pharmacy/expiry';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { phMessage } from './ph-failure';
import { attemptKeyFor } from './purchasing-logic';
import { newClientKey } from './sell-logic';
import { TransferFailure } from './TransferFailure';
import { receiveBreakdown, receiveInputOf, receiveSignature, restOfLine, startReceive, type LostReason, type ReceiveLineDraft } from './transfers-logic';
import { UnsavedBadge } from './UnsavedBadge';
import { isolate } from './WriteBlocked';

export interface ReceiveSentLine {
  lineId: string;
  productName: string;
  lot: string;
  expiryDate: string;
  expiryPrecision: ExpiryPrecision;
  batchStatus: 'ACTIVE' | 'RECALLED' | 'BLOCKED';
  sentQty: number;
}

interface ReceiveDraft {
  lines: ReceiveLineDraft[];
  clientKey: string;
  keySig?: string;
}

/**
 * The receive panel of a SENT transfer, opened at the destination. For each sent line the person enters what arrived, what
 * arrived damaged and what is lost (with a reason); every unit sent must go somewhere, and the panel states in words where
 * each one goes (available, quarantine, damaged, lost) while they type. Units from a batch that is recalled, blocked or has
 * expired go to quarantine whatever the toggle says. Closing with lost units needs a role that can view reports. The attempt
 * key is made for exactly these figures and kept with the draft. No motion.
 */
export function TransferReceive({
  userId,
  restaurantId,
  transfer,
  canSeeLoss,
  today,
  lines,
  online,
  onClose,
}: {
  userId: string;
  restaurantId: string;
  transfer: { id: string; version: number; fromBranchName: string; toBranchName: string };
  canSeeLoss: boolean;
  today: string;
  lines: ReceiveSentLine[];
  online: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [firstKey] = useState(() => newClientKey('trr'));
  const start = useMemo<ReceiveDraft>(() => ({ lines: startReceive(lines), clientKey: firstKey }), [lines, firstKey]);
  const draft = useDraft<ReceiveDraft>(draftKey(userId, `transfer-receive@${restaurantId}`, `${transfer.id}:${transfer.version}`), start);
  const value = draft.value;
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; stale: boolean } | null>(null);
  const inFlight = useRef(false);
  useLeaveGuard(draft.dirty, t('pharmacy.catalog.leaveConfirm'));

  const meta = new Map(lines.map((l) => [l.lineId, l]));
  const unsellable = (l: ReceiveSentLine) => l.batchStatus !== 'ACTIVE' || isExpired(l, today);
  const built = receiveInputOf({ transferId: transfer.id, version: transfer.version, clientKey: value.clientKey, lines: value.lines });
  const blockedByRole = built.needsReportView && !canSeeLoss;
  const change = (lineId: string, patch: Partial<ReceiveLineDraft>) => {
    setConfirming(false);
    setFailure(null);
    draft.set({ ...value, lines: value.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)) });
  };

  const totals = value.lines.reduce(
    (sum, l) => {
      const b = receiveBreakdown(l, unsellable(meta.get(l.lineId)!));
      return { available: sum.available + b.goes.available, quarantine: sum.quarantine + b.goes.quarantine, damaged: sum.damaged + b.goes.damaged, lost: sum.lost + b.goes.lost, unaccounted: sum.unaccounted + Math.abs(b.unaccounted) };
    },
    { available: 0, quarantine: 0, damaged: 0, lost: 0, unaccounted: 0 },
  );

  const receive = async () => {
    if (!built.input || inFlight.current || blockedByRole) return;
    inFlight.current = true;
    setPending(true);
    const sig = receiveSignature(transfer.id, value.lines);
    const attempt = attemptKeyFor(value, sig, 'trr');
    if (attempt.clientKey !== value.clientKey || value.keySig !== sig) draft.set({ ...value, ...attempt });
    const result = await settle(() => receiveTransfer({ ...built.input, clientKey: attempt.clientKey }));
    inFlight.current = false;
    setPending(false);
    if (!result.ok) {
      const code = result.error.fields?.phCode;
      if (code === 'CLIENT_KEY_MISMATCH' || code === 'CLIENT_KEY_USED') draft.set({ ...value, clientKey: newClientKey('trr'), keySig: '' });
      setFailure({ message: phMessage(t, locale, result.error, 'pharmacy.transfers'), stale: code === 'VERSION_CONFLICT' || code === 'NOT_SENT' });
      setConfirming(false);
      return;
    }
    setFailure(null);
    draft.clear();
    onClose();
    router.refresh();
  };

  const can = online && !pending;
  const problemText = (code: string | undefined) => (code ? t(`pharmacy.transfers.receive.problem.${code}`) : undefined);

  return (
    <section aria-label={t('pharmacy.transfers.receive.title')} data-testid="transfer-receive-panel" className="flex min-w-0 flex-col gap-4 rounded-md border border-line-strong bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold text-text">{t('pharmacy.transfers.receive.title')}</h2>
        <UnsavedBadge dirty={draft.dirty} saved={false} />
      </div>
      <p className="max-w-[72ch] text-sm text-muted">{t('pharmacy.transfers.receive.intro')}</p>
      <p className="flex max-w-[72ch] items-start gap-2.5 text-sm text-text">
        <ShieldAlert aria-hidden className="mt-px size-4 shrink-0 text-muted" />
        <span className="min-w-0">{t('pharmacy.transfers.receive.autoQuarantine')}</span>
      </p>
      {draft.restored && (
        <p role="status" className="flex items-start gap-2.5 text-sm text-text">
          <Info aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          {t('pharmacy.catalog.draft.restored')}
        </p>
      )}
      {failure && <TransferFailure testId="transfer-receive-error" message={failure.message} stale={failure.stale} onReload={() => router.refresh()} />}

      <ol className="flex flex-col gap-3">
        {value.lines.map((line) => {
          const info = meta.get(line.lineId)!;
          const forced = unsellable(info);
          const b = receiveBreakdown(line, forced);
          const problem = problemText(built.problems[line.lineId]);
          return (
            <li key={line.lineId} data-testid="receive-line" className="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p dir="auto" className="min-w-0 break-words text-base font-medium text-text [overflow-wrap:anywhere]">
                  {info.productName}
                </p>
                <p className="text-sm text-text">
                  <span className="text-muted">{t('pharmacy.transfers.col.lot')}: </span>
                  <bdi dir="ltr" className="tabular-nums">
                    {info.lot}
                  </bdi>
                  <span className="text-muted"> · {t('pharmacy.transfers.col.expiry')}: </span>
                  <bdi dir="ltr" className="tabular-nums">
                    {formatExpiry(info)}
                  </bdi>
                </p>
              </div>
              <p className="text-sm text-text tabular-nums">{t('pharmacy.transfers.receive.sentFigure', { qty: formatNumber(line.sentQty) })}</p>
              {forced && (
                <p data-testid="receive-forced" className="flex items-start gap-2 text-sm font-medium text-text">
                  <ShieldAlert aria-hidden className="mt-px size-4 shrink-0" />
                  <span className="min-w-0">{t(info.batchStatus === 'RECALLED' ? 'pharmacy.transfers.receive.forced.RECALLED' : info.batchStatus === 'BLOCKED' ? 'pharmacy.transfers.receive.forced.BLOCKED' : 'pharmacy.transfers.receive.forced.EXPIRED')}</span>
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('pharmacy.transfers.receive.received')}>
                  <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="receive-received" value={line.received} onChange={(e) => change(line.lineId, { received: e.target.value })} />
                </Field>
                <Field label={t('pharmacy.transfers.receive.damaged')}>
                  <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="receive-damaged" value={line.damaged} onChange={(e) => change(line.lineId, { damaged: e.target.value })} />
                </Field>
                <Field label={t('pharmacy.transfers.receive.lost')}>
                  <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" data-testid="receive-lost" value={line.lost} onChange={(e) => change(line.lineId, { lost: e.target.value })} />
                </Field>
              </div>
              {b.lost > 0 && (
                <Field label={t('pharmacy.transfers.receive.lostReason')} error={b.needsReason ? t('pharmacy.transfers.receive.problem.reason') : undefined}>
                  <Select
                    className="[&_select]:min-h-11"
                    data-testid="receive-lost-reason"
                    value={line.lostReason}
                    onChange={(e) => change(line.lineId, { lostReason: e.target.value as '' | LostReason })}
                    options={[
                      { value: '', label: t('pharmacy.transfers.receive.lostReason.choose') },
                      { value: 'LOST', label: t('pharmacy.transfers.receive.lostReason.LOST') },
                      { value: 'OTHER', label: t('pharmacy.transfers.receive.lostReason.OTHER') },
                    ]}
                  />
                </Field>
              )}
              <label className="inline-flex min-h-11 items-center gap-2.5 text-sm text-text">
                <input
                  type="checkbox"
                  className="size-5"
                  data-testid="receive-quarantine"
                  checked={line.quarantine || forced}
                  disabled={forced}
                  onChange={(e) => change(line.lineId, { quarantine: e.target.checked })}
                />
                {t('pharmacy.transfers.receive.quarantine')}
              </label>
              <p className="text-xs text-muted">{t('pharmacy.transfers.receive.quarantineHint')}</p>

              <div data-testid="receive-goes" className="flex flex-col gap-1 rounded-sm border border-line bg-raised px-3 py-2 text-sm text-text">
                <p className="font-medium">{t('pharmacy.transfers.receive.goes')}</p>
                <p className="tabular-nums">
                  {t('pharmacy.transfers.receive.goesLine', {
                    available: formatNumber(b.goes.available),
                    quarantine: formatNumber(b.goes.quarantine),
                    damaged: formatNumber(b.goes.damaged),
                    lost: formatNumber(b.goes.lost),
                  })}
                </p>
                {b.invalid ? (
                  <p role="alert" className="flex items-start gap-2 text-danger">
                    <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                    {t('pharmacy.transfers.receive.problem.number')}
                  </p>
                ) : b.unaccounted > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="receive-shortfall">
                    <p role="alert" className="flex min-w-0 items-start gap-2 text-danger">
                      <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                      <span className="min-w-0">{t('pharmacy.transfers.receive.shortfall', { count: formatNumber(b.unaccounted) })}</span>
                    </p>
                    <Button size="lg" className="min-h-11" data-testid="receive-rest-lost" disabled={pending} onClick={() => change(line.lineId, restOfLine(line))}>
                      {t('pharmacy.transfers.receive.restLost', { count: formatNumber(b.unaccounted) })}
                    </Button>
                  </div>
                ) : b.unaccounted < 0 ? (
                  <p role="alert" className="flex items-start gap-2 text-danger">
                    <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
                    {t('pharmacy.transfers.receive.excess', { count: formatNumber(-b.unaccounted) })}
                  </p>
                ) : (
                  <p className="flex items-start gap-2 text-muted">
                    <PackageCheck aria-hidden className="mt-px size-4 shrink-0" />
                    {t('pharmacy.transfers.receive.balanced')}
                  </p>
                )}
                {problem && built.problems[line.lineId] === 'reason' && (
                  <p role="alert" className="flex items-start gap-2 text-danger">
                    <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
                    {problem}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p data-testid="receive-summary" role="status" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text tabular-nums">
        <span>{t('pharmacy.transfers.receive.summary', { available: formatNumber(totals.available), quarantine: formatNumber(totals.quarantine), damaged: formatNumber(totals.damaged), lost: formatNumber(totals.lost) })}</span>
        <span className="font-medium">{t(`pharmacy.transfers.receive.closes.${built.status}`)}</span>
      </p>
      {blockedByRole && (
        <p data-testid="receive-loss-blocked" className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-text">
          <Lock aria-hidden className="mt-px size-4 shrink-0 text-muted" />
          <span className="min-w-0">{t('pharmacy.transfers.receive.lossNeedsReports')}</span>
        </p>
      )}

      {!confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg" className="min-h-11" icon={<PackageCheck aria-hidden />} data-testid="receive-review" disabled={!can || !built.input || blockedByRole} onClick={() => setConfirming(true)}>
            {t('pharmacy.transfers.receive.review')}
          </Button>
          <Button size="lg" className="min-h-11" disabled={pending} onClick={onClose}>
            {t('pharmacy.receive.confirm.back')}
          </Button>
        </div>
      ) : (
        <div role="region" aria-label={t('pharmacy.transfers.receive.confirmTitle')} data-testid="receive-confirm" className="flex flex-col gap-3 rounded-md border border-ink bg-surface p-4">
          <p className="flex max-w-[72ch] items-start gap-2.5 text-sm font-medium text-text">
            <TriangleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t('pharmacy.transfers.receive.confirm', { to: isolate(transfer.toBranchName), from: isolate(transfer.fromBranchName) })}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="lg" className="min-h-11" data-testid="receive-confirm-yes" pending={pending} disabled={!can || !built.input || blockedByRole} onClick={() => void receive()}>
              {t('pharmacy.transfers.receive.confirmYes')}
            </Button>
            <Button size="lg" className="min-h-11" disabled={pending} onClick={() => setConfirming(false)}>
              {t('pharmacy.receive.confirm.back')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
