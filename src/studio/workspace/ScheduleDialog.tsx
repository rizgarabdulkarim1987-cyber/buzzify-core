'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { issueText } from '@/app/studio/(studio)/(app)/menus/menu-text';
import { schedulePublish } from '@/app/studio/_actions/revisions';
import type { PublishIssue } from '@/server/domain/publish-rules';
import { utcToZonedLocal, zonedLocalToUtc } from '@/server/domain/schedule-time';
import type { UpgradeInfo } from '@/server/studio/services/plans';
import { describeFailure } from '@/studio/errors';
import { formatDateTime } from '@/studio/format';
import { useLocale, useT } from '@/studio/i18n';
import { UpgradeHint } from '@/studio/plans/UpgradeHint';
import { Alert } from '@/studio/ui/Alert';
import { Button } from '@/studio/ui/Button';
import { Dialog } from '@/studio/ui/Dialog';
import { Field } from '@/studio/ui/Field';
import { Input } from '@/studio/ui/Input';
import { Textarea } from '@/studio/ui/Textarea';

export interface ScheduleDialogProps {
  menuId: string;
  /** The menu's own clock: the time is picked and shown in it. */
  timezone: string;
  /** The revision already waiting, which a new schedule replaces. */
  pending: { number: number; goLiveAt: string } | null;
  onClose: () => void;
}

/** What the Schedule entry opens when the restaurant's plan has no scheduled publishing: the hint, not the form. */
export function ScheduleLocked({ upgrade, onClose }: { upgrade: UpgradeInfo; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('schedule.title')}
      description={t('schedule.intro')}
      width="md"
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <UpgradeHint feature="publish.scheduling" info={upgrade} />
    </Dialog>
  );
}

/**
 * Publishing at a time (spec 10.6): the draft as it stands now goes live at a date and time on the menu's clock. Only
 * one revision waits at a time, so with one pending the dialog says which and offers to replace it.
 */
export function ScheduleDialog({ menuId, timezone, pending: initialPending, onClose }: ScheduleDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const formId = useId();
  // Tomorrow at 09:00 on the menu's clock, worked out once when the dialog opens.
  const [when, setWhen] = useState(() => `${utcToZonedLocal(new Date(Date.now() + 86_400_000), timezone).slice(0, 10)}T09:00`);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(initialPending);
  const [problem, setProblem] = useState<{ message: string; field?: string; issues?: PublishIssue[]; attempt: number } | null>(null);
  const [saving, startSaving] = useTransition();

  const submit = () =>
    startSaving(async () => {
      const attempt = (problem?.attempt ?? 0) + 1;
      let goLiveAt: string;
      try {
        goLiveAt = zonedLocalToUtc(when, timezone).toISOString();
      } catch {
        setProblem({ message: t('error.INVALID'), field: t('error.text.dateInvalid'), attempt });
        return;
      }
      const result = await schedulePublish({ menuId, goLiveAt, ...(note.trim() ? { note } : {}), replacePending: pending !== null });
      if (result.ok) {
        toast.success(t('schedule.done', { number: result.data.number }));
        router.refresh();
        onClose();
        return;
      }
      const described = describeFailure(t, locale, result.error);
      const pendingNumber = result.error.fields?.pendingNumber;
      const pendingAt = result.error.fields?.pendingAt;
      if (result.error.code === 'CONFLICT' && pendingNumber && pendingAt) {
        // Someone scheduled one meanwhile: name it, and let the person replace it.
        setPending({ number: Number(pendingNumber), goLiveAt: pendingAt });
        setProblem(null);
        return;
      }
      setProblem({ message: described.message, ...(described.fields.goLiveAt ? { field: described.fields.goLiveAt } : {}), ...(result.error.issues ? { issues: result.error.issues } : {}), attempt });
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('schedule.title')}
      description={t('schedule.intro')}
      width="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} pending={saving}>
            {pending ? t('schedule.replace') : t('schedule.confirm')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        {pending && (
          <Alert tone="neutral">
            {t('schedule.pending', { number: pending.number, time: formatDateTime(pending.goLiveAt, locale, timezone) })}
          </Alert>
        )}
        {problem && !problem.field && (
          <Alert key={problem.attempt} tone="danger">
            <span className="flex flex-col gap-1">
              <span>{problem.message}</span>
              {problem.issues
                ?.filter((issue) => issue.severity === 'block')
                .map((issue, index) => (
                  <span key={index}>· {issueText(t, issue)}</span>
                ))}
            </span>
          </Alert>
        )}
        <Field label={t('schedule.when')} hint={t('schedule.zone', { zone: timezone })} error={problem?.field} className="max-w-72">
          <Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} dir="ltr" className="tabular-nums" />
        </Field>
        <Field label={t('schedule.note')} optional>
          <Textarea rows={2} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
