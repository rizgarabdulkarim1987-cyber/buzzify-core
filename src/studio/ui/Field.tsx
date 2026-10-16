'use client';

import { CircleAlert } from 'lucide-react';
import { createContext, useContext, useId, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { cx } from './cx';

interface FieldContext {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const Context = createContext<FieldContext | null>(null);

/** The id, description and error state a control inside a `Field` takes on; nothing outside one. */
export function useFieldProps(): Partial<{ id: string; 'aria-describedby': string; 'aria-invalid': true }> {
  const field = useContext(Context);
  if (!field) return {};
  return {
    id: field.id,
    ...(field.describedBy ? { 'aria-describedby': field.describedBy } : {}),
    ...(field.invalid ? { 'aria-invalid': true as const } : {}),
  };
}

/** The look every text control shares: one border, one focus edge, one error edge. */
export const CONTROL_CLASSES =
  'w-full min-w-0 rounded-md border border-line-strong bg-raised text-text transition-colors duration-150 ' +
  'hover:border-muted/60 focus:border-ink aria-invalid:border-danger ' +
  'disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted [&[readonly]]:bg-surface';

/** Control heights: 32 px in tables and toolbars, 40 px in the sign-in forms. */
export const CONTROL_HEIGHTS = { md: 'h-8 px-2.5 text-base', lg: 'h-10 px-3 text-base' } as const;

export type ControlSize = keyof typeof CONTROL_HEIGHTS;

export interface FieldProps {
  label: ReactNode;
  /** Help shown under the control while there is no error. */
  hint?: ReactNode;
  /** What is wrong with the value, in the person's language. Replaces the hint. */
  error?: string;
  /** Marks the field as optional beside its label. */
  optional?: boolean;
  /** Something at the label's far end, such as a "Forgot your password?" link. */
  aside?: ReactNode;
  /** Keeps the label for assistive technology only, where a heading right above already says the same. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/** A label, its control, and a hint or an error, wired together for assistive technology. */
export function Field({ label, hint, error, optional, aside, hideLabel, className, children }: FieldProps) {
  const t = useT();
  const id = useId();
  const messageId = `${id}-message`;
  const message = error || hint;
  return (
    <Context value={{ id, describedBy: message ? messageId : undefined, invalid: Boolean(error) }}>
      <div className={cx('flex flex-col gap-1.5', className)}>
        <div className={cx('flex items-baseline justify-between gap-3', hideLabel && !aside && 'sr-only')}>
          <label htmlFor={id} className={cx('text-sm font-medium text-text', hideLabel && 'sr-only')}>
            {label}
            {optional && <span className="ms-1.5 font-normal text-muted">({t('common.optional')})</span>}
          </label>
          {aside}
        </div>
        {children}
        {error ? (
          <p id={messageId} className="flex items-start gap-1.5 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : hint ? (
          <p id={messageId} className="text-sm text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </Context>
  );
}
