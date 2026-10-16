'use client';

import type { ReactNode } from 'react';
import { formMessage, type ActionForm } from '@/studio/forms';
import { FailureAlert } from './Alert';

export interface FormErrorProps {
  form: Pick<ActionForm<unknown>, 'failure' | 'errors' | 'attempt' | 'pending'>;
  /** The form's fields, in their order: problems with them are shown beside them, others here. */
  fields: readonly string[];
  /** What follows the form's sentence: a link to the way on. */
  children?: ReactNode;
}

/**
 * The failure of a form made with `useActionForm`, above its fields: its sentence, or an announcement of the first field
 * message. Nothing while the form is being sent, so the last attempt's alert never speaks for the next one.
 */
export function FormError({ form, fields, children }: FormErrorProps) {
  if (form.pending) return null;
  const message = formMessage(form.failure, fields);
  const fieldMessage = fields.map((name) => form.errors[name]).find(Boolean) ?? Object.values(form.errors)[0];
  return (
    <FailureAlert attempt={form.attempt} message={message} fieldMessage={fieldMessage}>
      {message ? children : null}
    </FailureAlert>
  );
}
