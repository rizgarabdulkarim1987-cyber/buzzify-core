'use client';

import { CircleAlert, CircleCheck, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { reverseMovement } from '@/app/pharmacy/_actions/stock';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { settle } from '@/studio/settle';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { useOnline } from './use-online';

/** Reverses one movement with a reason. The server decides whether it can be reversed and says why not in words. */
export function ReverseButton({ movementId }: { movementId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; reason?: string } | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !online) return;
    setBusy(true);
    setProblem(null);
    const result = await settle(() => reverseMovement({ movementId, reason }));
    setBusy(false);
    if (!result.ok) {
      const described = describeFailure(t, locale, result.error);
      setProblem({ message: described.message, ...(described.fields.reason ? { reason: described.fields.reason } : {}) });
      return;
    }
    setDone(true);
    setReason('');
    router.refresh();
  };

  return (
    <details data-testid="reverse-movement" className="min-w-0">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-text underline underline-offset-2 hover:bg-hover">
        <Undo2 aria-hidden className="size-4 shrink-0" />
        {t('pharmacy.movements.reverse')}
      </summary>
      <form onSubmit={(event) => void submit(event)} className="mt-2 flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
        <Field label={t('pharmacy.movements.reverse.reason')} hint={t('pharmacy.stock.act.reasonHint')} {...(problem?.reason ? { error: problem.reason } : {})}>
          <Input className="min-h-11" dir="auto" autoComplete="off" required minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {problem && (
          <p role="alert" data-testid="reverse-error" className="flex items-start gap-2.5 rounded-md bg-danger-wash px-3 py-2.5 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{problem.message}</span>
          </p>
        )}
        {done && (
          <p role="status" className="flex items-start gap-2.5 rounded-md bg-success-wash px-3 py-2.5 text-sm text-success">
            <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
            <span className="min-w-0">{t('pharmacy.movements.reverse.done')}</span>
          </p>
        )}
        <div>
          <Button type="submit" size="lg" className="min-h-11" variant="danger" disabled={busy || !online}>
            {t('pharmacy.movements.reverse.confirm')}
          </Button>
        </div>
      </form>
    </details>
  );
}
