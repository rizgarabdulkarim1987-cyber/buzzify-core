'use client';

import { CircleAlert } from 'lucide-react';
import { useId, useTransition, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { Button } from './Button';
import { Dialog } from './Dialog';

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
   * Runs the confirmed action with the dialog's fields. Resolve true to close the dialog, false to keep it open (the
   * caller then shows why, through `error` or its fields' own errors).
   */
  onConfirm: (form: FormData) => Promise<boolean>;
  /** Why the last attempt failed, for the whole dialog. */
  error?: string;
  /** Fields the confirmation needs, such as the person's password. */
  children?: ReactNode;
}

/** A question before an action that is hard to undo. Enter confirms; Escape and Cancel close it without acting. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, tone = 'danger', onConfirm, error, children }: ConfirmDialogProps) {
  const t = useT();
  const formId = useId();
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={title}
      description={body}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
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
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(async () => {
            if (await onConfirm(data)) onOpenChange(false);
          });
        }}
      >
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-wash px-3 py-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {error}
          </p>
        )}
        {children}
      </form>
    </Dialog>
  );
}
