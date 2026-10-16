'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { ActionResult } from '@/server/studio/framework/result';
import { describeFailure, type DescribedFailure } from './errors';
import { useLocale, useT } from './i18n';

/** A form's text fields, by name. */
export type FormValues = Record<string, string>;

interface FormState<T> {
  result: ActionResult<T> | null;
  /** Fields kept after a failed submit, so the person does not type them again (never passwords). */
  values: FormValues;
}

export interface ActionFormOptions<T> {
  /** Fields to put back after the server refused. Secrets are never kept. */
  keep?: readonly string[];
  /**
   * Checks what can be checked without the server, and returns messages by field, or nothing. A form that fails it is
   * not sent and keeps everything typed in it.
   */
  validate?: (values: FormValues) => Record<string, string> | null;
  /** Runs after the server said yes, with its answer and the values sent. */
  onSuccess?: (data: T, values: FormValues) => void | Promise<void>;
}

export interface ActionForm<T> {
  /** Spread on the `<form>`: its action (React runs it in a transition, then resets the fields) and the client check. */
  props: {
    action: (formData: FormData) => void;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    noValidate: true;
    ref: RefObject<HTMLFormElement | null>;
  };
  pending: boolean;
  /** The server's last answer, when it said yes. */
  data: T | null;
  /** The last refusal, in the person's language; none while the client's own check has the last word. */
  failure: DescribedFailure | null;
  /** The messages by field of the last failed submit: the client's check, else the server's. */
  errors: Record<string, string>;
  /** The message for one field: the client's check first, then the server's. */
  fieldError: (name: string) => string | undefined;
  /** A kept value, for the field's `defaultValue`. */
  value: (name: string) => string | undefined;
  /**
   * Counts the submits. A failure's announcement is keyed by it, so the same refusal twice is a new alert and is read out
   * again.
   */
  attempt: number;
}

function textValues(formData: FormData): FormValues {
  const values: FormValues = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string' && !name.startsWith('$ACTION')) values[name] = value;
  }
  return values;
}

/** Moves focus to the first control (in the form's order) that one of `names` belongs to; false when there is none. */
export function focusFirstField(form: HTMLFormElement | null, names: readonly string[]): boolean {
  if (!form || names.length === 0) return false;
  const first = [...form.elements].find((element) => names.includes((element as HTMLInputElement).name)) as HTMLElement | undefined;
  first?.focus();
  return first !== undefined;
}

/**
 * A form wired to a Studio Server Action through `useActionState`: it checks what it can before sending, sends the
 * form's fields, keeps the ones worth keeping, and turns a refusal into messages in the person's language (never the
 * server's English). After any refusal that names fields, focus goes to the first of them; `FormError` says what went
 * wrong for assistive technology.
 */
export function useActionForm<T>(
  submit: (values: FormValues) => Promise<ActionResult<T>>,
  options: ActionFormOptions<T> = {},
): ActionForm<T> {
  const t = useT();
  const { locale } = useLocale();
  const ref = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [clientErrors, setClientErrors] = useState<Record<string, string> | null>(null);
  const [state, formAction, pending] = useActionState<FormState<T>, FormData>(
    async (_previous, formData) => {
      const values = textValues(formData);
      const kept = Object.fromEntries((options.keep ?? []).filter((name) => name in values).map((name) => [name, values[name]!]));
      const result = await submit(values);
      if (result.ok) await options.onSuccess?.(result.data, values);
      return { result, values: kept };
    },
    { result: null, values: {} },
  );

  // The server's answer is a new state object each time: when it refused fields, the first of them takes focus, as after
  // the client's own check (React has reset the form by then, which leaves focus alone).
  useEffect(() => {
    const result = state.result;
    if (result && !result.ok && result.error.fields) focusFirstField(ref.current, Object.keys(result.error.fields));
  }, [state]);

  // Checked in `onSubmit`, before React starts the action: a form that is not sent is not reset either.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = event.currentTarget;
    setAttempt((count) => count + 1);
    const errors = options.validate?.(textValues(new FormData(form)));
    if (errors && Object.keys(errors).length > 0) {
      event.preventDefault();
      setClientErrors(errors);
      focusFirstField(form, Object.keys(errors));
    } else {
      setClientErrors(null);
    }
  };

  const failure = !clientErrors && state.result && !state.result.ok ? describeFailure(t, locale, state.result.error) : null;
  const errors = clientErrors ?? failure?.fields ?? {};
  return {
    props: { action: formAction, onSubmit, noValidate: true, ref },
    pending,
    data: state.result?.ok ? state.result.data : null,
    failure,
    errors,
    fieldError: (name) => errors[name],
    value: (name) => state.values[name],
    attempt,
  };
}

/** Messages for the fields of `messages` that were left empty: the check a form can make before sending anything. */
export function requireFields(values: FormValues, messages: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).filter(([name]) => !(values[name] ?? '').trim()));
}

/**
 * The message a form shows above its fields for a failure. A problem with something the form does not show (the token
 * of a link) is said there; when every problem has a field of its own, nothing is ("Check the highlighted fields" adds
 * nothing to the marked fields); otherwise the failure's own sentence.
 */
export function formMessage(failure: DescribedFailure | null, fieldNames: readonly string[]): string | null {
  if (!failure) return null;
  const elsewhere = Object.entries(failure.fields)
    .filter(([name]) => !fieldNames.includes(name))
    .map(([, message]) => message);
  if (elsewhere.length > 0) return elsewhere.join(' ');
  if (failure.code === 'INVALID' && Object.keys(failure.fields).length > 0) return null;
  return failure.message;
}
