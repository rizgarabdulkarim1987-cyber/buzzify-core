'use client';

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { focusFirstField } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { FailureAlert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';

/** Why a confirmed action did not happen: a sentence for the whole dialog, messages by field, or both. */
export interface ConfirmProblem {
  message?: string;
  fields?: Record<string, string>;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What will happen, in a sentence. */
  body?: ReactNode;
  confirmLabel: string;
  /** `danger` for what cannot be undone or takes something away. */
  tone?: 'danger' | 'primary';
  /**
   * Runs the confirmed action with the dialog's fields. Resolve `true` to close the dialog, or the problem (in the
   * person's language) to keep it open: field messages go to their fields through `children`, the first field with one
   * takes focus, and the problem is announced.
   */
  onConfirm: (form: FormData) => Promise<true | ConfirmProblem>;
  /** Fields the confirmation needs, such as the person's password; given the field messages of the last attempt. */
  children?: ReactNode | ((errors: Record<string, string>) => ReactNode);
}

/** A question before an action that is hard to undo. Enter confirms; Escape and Cancel close it without acting. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, tone = 'danger', onConfirm, children }: ConfirmDialogProps) {
  const t = useT();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<ConfirmProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const errors = problem?.fields ?? {};

  // After a refusal that names fields, the first of them takes focus (the confirm button had it).
  useEffect(() => {
    if (problem?.fields) focusFirstField(form.current, Object.keys(problem.fields));
  }, [problem]);

  const close = (next: boolean) => {
    if (pending) return;
    if (!next) setProblem(null);
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant={tone === 'danger' ? 'danger' : 'primary'} pending={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={form}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setAttempt((count) => count + 1);
          startTransition(async () => {
            const outcome = await onConfirm(data);
            if (outcome === true) {
              setProblem(null);
              onOpenChange(false);
            } else {
              setProblem(outcome);
            }
          });
        }}
      >
        {!pending && problem && (
          <FailureAlert attempt={attempt} message={problem.message ?? null} fieldMessage={Object.values(errors)[0]} />
        )}
        {typeof children === 'function' ? children(errors) : children}
      </form>
    </Dialog>
  );
}
