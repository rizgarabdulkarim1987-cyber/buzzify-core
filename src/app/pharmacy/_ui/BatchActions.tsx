'use client';

import { CircleAlert, CircleCheck, SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { adjustStock, damageStock, releaseQuarantine } from '@/app/pharmacy/_actions/stock';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { useOnline } from './use-online';

type Op = 'in' | 'out' | 'move' | 'damage' | 'release';
type Bucket = 'available' | 'reserved' | 'quarantine' | 'damaged';
const OPS: readonly Op[] = ['in', 'out', 'move', 'damage', 'release'];
const BUCKETS: readonly Bucket[] = ['available', 'reserved', 'quarantine', 'damaged'];
const HOLDING: readonly Bucket[] = ['available', 'quarantine'];

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Taking stock out is not undone by a second click: these steps ask once more, in words. */
const needsConfirm = (op: Op, decision: string) => op === 'out' || op === 'damage' || (op === 'release' && decision === 'DAMAGE');

/**
 * The form for one batch in the chosen branch: add, remove, move, write off as damaged, or release from quarantine,
 * each with a required reason. It sends the batch and the amounts; the server decides and its refusal is shown in
 * words under the form. A change that takes stock out asks for a second click. The idempotency key is made when the
 * form opens and kept until the change is saved, so a retry after a dropped connection is recorded once.
 */
export function BatchActions({ batchId, lot }: { batchId: string; lot: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [op, setOp] = useState<Op>('in');
  const [from, setFrom] = useState<Bucket>('available');
  const [to, setTo] = useState<Bucket>('available');
  const [decision, setDecision] = useState<'RESTOCK' | 'DAMAGE'>('RESTOCK');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newKey);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [done, setDone] = useState<'saved' | 'replayed' | null>(null);

  /** Any edit drops a pending confirmation and the last answer. */
  const touched = () => {
    setConfirming(false);
    setDone(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    if (needsConfirm(op, decision) && !confirming) {
      setConfirming(true);
      return;
    }
    const baseQty = Number(qty);
    const common = { batchId, ...(qty.trim() !== '' && Number.isFinite(baseQty) ? { baseQty } : {}), reason, clientKey: key };
    setBusy(true);
    setProblem(null);
    const result = await settle(() =>
      op === 'damage'
        ? damageStock({ ...common, fromBucket: from })
        : op === 'release'
          ? releaseQuarantine({ ...common, decision })
          : op === 'in'
            ? adjustStock({ ...common, direction: 'in', bucketTo: to })
            : op === 'out'
              ? adjustStock({ ...common, direction: 'out', bucketFrom: from })
              : adjustStock({ ...common, direction: 'move', bucketFrom: from, bucketTo: to }),
    );
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      const described = describeFailure(t, locale, result.error);
      setProblem({ message: described.message, fields: described.fields });
      return;
    }
    setDone((result.data as { replayed?: boolean }).replayed ? 'replayed' : 'saved');
    setQty('');
    setReason('');
    setKey(newKey());
    router.refresh();
  };

  const bucketOptions = (list: readonly Bucket[]) => list.map((value) => ({ value, label: t(`pharmacy.stock.bucket.${value}`) }));
  const fieldError = (...names: string[]) => names.map((n) => problem?.fields[n]).find(Boolean);
  const showFrom = op === 'out' || op === 'move' || op === 'damage';
  const showTo = op === 'in' || op === 'move';

  return (
    <details data-testid="batch-actions" className="min-w-0">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.stock.act.open')}
        <span className="sr-only" dir="auto">
          {' '}
          {lot}
        </span>
      </summary>
      <form onSubmit={(event) => void submit(event)} className="mt-2 grid gap-3 rounded-md border border-line bg-surface p-3 sm:grid-cols-2">
        <Field label={t('pharmacy.stock.act.op')} className="sm:col-span-2">
          <Select
            className="[&_select]:min-h-11"
            value={op}
            onChange={(event) => {
              const next = event.target.value as Op;
              setOp(next);
              touched();
              if (next === 'release') setFrom('quarantine');
              else if (next === 'damage' && !HOLDING.includes(from)) setFrom('available');
            }}
            options={OPS.map((value) => ({ value, label: t(`pharmacy.stock.act.op.${value}`) }))}
          />
        </Field>
        {showFrom && (
          <Field label={t('pharmacy.stock.act.from')} error={fieldError('bucketFrom', 'fromBucket')}>
            <Select
              className="[&_select]:min-h-11"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value as Bucket);
                touched();
              }}
              options={bucketOptions(op === 'damage' ? HOLDING : BUCKETS)}
            />
          </Field>
        )}
        {showTo && (
          <Field label={t('pharmacy.stock.act.to')} error={fieldError('bucketTo')}>
            <Select
              className="[&_select]:min-h-11"
              value={to}
              onChange={(event) => {
                setTo(event.target.value as Bucket);
                touched();
              }}
              options={bucketOptions(BUCKETS)}
            />
          </Field>
        )}
        {op === 'release' && (
          <Field label={t('pharmacy.stock.act.decision')} error={fieldError('decision')}>
            <Select
              className="[&_select]:min-h-11"
              value={decision}
              onChange={(event) => {
                setDecision(event.target.value as 'RESTOCK' | 'DAMAGE');
                touched();
              }}
              options={(['RESTOCK', 'DAMAGE'] as const).map((value) => ({ value, label: t(`pharmacy.stock.act.decision.${value}`) }))}
            />
          </Field>
        )}
        <Field label={t('pharmacy.stock.act.qty')} error={fieldError('baseQty', 'qty')}>
          <Input
            className="min-h-11"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            required
            value={qty}
            onChange={(event) => {
              setQty(event.target.value);
              touched();
            }}
          />
        </Field>
        <Field label={t('pharmacy.stock.act.reason')} hint={t('pharmacy.stock.act.reasonHint')} error={fieldError('reason')} className="sm:col-span-2">
          <Input
            className="min-h-11"
            dir="auto"
            autoComplete="off"
            required
            minLength={3}
            maxLength={300}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              touched();
            }}
          />
        </Field>

        {confirming && (
          <p role="alert" className="flex items-start gap-2.5 text-sm text-text sm:col-span-2">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0 text-danger" />
            {t('pharmacy.stock.act.confirmText')}
          </p>
        )}
        {problem && (
          <p role="alert" data-testid="batch-action-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger sm:col-span-2">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{problem.message}</span>
          </p>
        )}
        {done && (
          <p role="status" data-testid="batch-action-done" className="flex items-start gap-2.5 rounded-md bg-success-wash px-3 py-2.5 text-sm text-success sm:col-span-2">
            <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t(done === 'saved' ? 'pharmacy.stock.act.done' : 'pharmacy.stock.act.replayed')}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" size="lg" className="min-h-11" variant={confirming ? 'danger' : 'primary'} disabled={busy || !online}>
            {confirming ? t('pharmacy.stock.act.confirm') : needsConfirm(op, decision) ? t('pharmacy.stock.act.review') : t('pharmacy.stock.act.save')}
          </Button>
          {confirming && (
            <Button size="lg" className="min-h-11" onClick={() => setConfirming(false)}>
              {t('pharmacy.stock.act.cancel')}
            </Button>
          )}
        </div>
      </form>
    </details>
  );
}
