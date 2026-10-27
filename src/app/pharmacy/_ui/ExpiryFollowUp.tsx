'use client';

import { CircleAlert, CircleCheck, ClipboardPen, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { setExpiryStatus } from '@/app/pharmacy/_actions/expiry';
import { formatNumber } from '@/lib/pos-format';
import type { ExpiryStatus } from '@/server/pharmacy/expiry';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';
import { Textarea } from '@/studio/ui/Textarea';
import { digitsOf } from './count-draft';
import { phMessage } from './ph-failure';
import { useOnline } from './use-online';

/** The same list as the server's (a type import only, so no server code reaches the browser). */
const STATUSES: readonly ExpiryStatus[] = ['NEW', 'IN_PROGRESS', 'MOVED', 'DISPOSED', 'RETURNED'];

export interface ExpiryFollowUpProps {
  batchId: string;
  lot: string;
  userId: string;
  current: { status: ExpiryStatus; assigneeId: string | null; note: string };
  /** Units still in available and quarantine: what DISPOSED must write off. */
  left: number;
}

/**
 * The follow-up of one batch: status, who it is assigned to and a note. Marking it disposed with stock left needs the exact
 * quantity, which the server writes off as damaged; Moved and Returned are labels only for now, and the form says so.
 */
export function ExpiryFollowUp({ batchId, lot, userId, current, left }: ExpiryFollowUpProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [status, setStatus] = useState<ExpiryStatus>(current.status);
  const mine = current.assigneeId === userId;
  const someoneElse = current.assigneeId !== null && !mine;
  const [assignee, setAssignee] = useState<'keep' | 'me' | 'none'>(someoneElse ? 'keep' : mine ? 'me' : 'none');
  const [note, setNote] = useState(current.note);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const needsQty = status === 'DISPOSED' && left > 0;
  const label = status === 'MOVED' || status === 'RETURNED';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    const result = await settle(() =>
      setExpiryStatus({
        batchId,
        status,
        ...(assignee === 'me' ? { assigneeId: userId } : assignee === 'none' ? { assigneeId: null } : {}),
        note,
        ...(needsQty && qty.trim() !== '' ? { disposeQty: Number(qty) } : {}),
      }),
    );
    setBusy(false);
    if (!result.ok) {
      const described = describeFailure(t, locale, result.error);
      setProblem({ message: phMessage(t, locale, result.error, 'pharmacy.expiry'), fields: described.fields });
      return;
    }
    const data = result.data as { changed: boolean; disposedQty: number; labelOnly: boolean };
    setDone(
      !data.changed
        ? t('pharmacy.expiry.saved.same')
        : data.disposedQty > 0
          ? t('pharmacy.expiry.saved.disposed', { qty: formatNumber(data.disposedQty) })
          : data.labelOnly
            ? t('pharmacy.expiry.saved.label')
            : t('pharmacy.expiry.saved'),
    );
    router.refresh();
  };

  return (
    <details data-testid="expiry-followup" className="min-w-0">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
        <ClipboardPen aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.expiry.follow.open')}
        <span className="sr-only" dir="ltr">
          {' '}
          {lot}
        </span>
      </summary>
      <form onSubmit={(event) => void submit(event)} className="mt-2 grid gap-3 rounded-md border border-line bg-surface p-3 md:grid-cols-2">
        <Field label={t('pharmacy.expiry.status.label')} {...(problem?.fields.status ? { error: problem.fields.status } : {})}>
          <Select
            className="[&_select]:min-h-11"
            value={status}
            onChange={(event) => setStatus(event.target.value as ExpiryStatus)}
            options={STATUSES.map((value) => ({ value, label: t(`pharmacy.expiry.status.${value}`) }))}
          />
        </Field>
        <Field label={t('pharmacy.expiry.assignee')} {...(problem?.fields.assigneeId ? { error: problem.fields.assigneeId } : {})}>
          <Select
            className="[&_select]:min-h-11"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value as 'keep' | 'me' | 'none')}
            options={[
              ...(someoneElse ? [{ value: 'keep', label: t('pharmacy.expiry.assignee.other') }] : []),
              { value: 'me', label: t('pharmacy.expiry.assignee.me') },
              { value: 'none', label: t('pharmacy.expiry.assignee.none') },
            ]}
          />
        </Field>
        {needsQty && (
          <div className="md:col-span-2">
            <Field
              label={t('pharmacy.expiry.dispose.qty')}
              hint={t('pharmacy.expiry.dispose.hint', { qty: formatNumber(left) })}
              {...(problem?.fields.disposeQty ? { error: problem.fields.disposeQty } : {})}
            >
              <Input className="min-h-11" dir="ltr" inputMode="numeric" autoComplete="off" required value={qty} onChange={(event) => setQty(digitsOf(event.target.value))} />
            </Field>
          </div>
        )}
        <div className="md:col-span-2">
          <Field label={t('pharmacy.expiry.note')} hint={t('pharmacy.expiry.note.hint')} {...(problem?.fields.note ? { error: problem.fields.note } : {})}>
            <Textarea dir="auto" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        {label && (
          <p data-testid="expiry-label-only" className="flex items-start gap-2.5 text-sm text-muted md:col-span-2">
            <Info aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t('pharmacy.expiry.labels')}</span>
          </p>
        )}
        {problem && (
          <p role="alert" data-testid="expiry-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger md:col-span-2">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{problem.message}</span>
          </p>
        )}
        {done && (
          <p role="status" data-testid="expiry-saved" className="flex items-start gap-2.5 rounded-md bg-success-wash px-3 py-2.5 text-sm text-success md:col-span-2">
            <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{done}</span>
          </p>
        )}
        <div className="md:col-span-2">
          <Button type="submit" size="lg" className="min-h-11" disabled={busy || !online}>
            {t('pharmacy.expiry.save')}
          </Button>
        </div>
      </form>
    </details>
  );
}
