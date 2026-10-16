import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type AlertTone = 'danger' | 'success' | 'neutral';

const TONES: Record<AlertTone, { box: string; icon: ReactNode }> = {
  danger: { box: 'bg-danger-wash text-danger', icon: <CircleAlert aria-hidden /> },
  success: { box: 'bg-success-wash text-success', icon: <CircleCheck aria-hidden /> },
  neutral: { box: 'bg-surface text-text border border-line', icon: <Info aria-hidden className="text-muted" /> },
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  tone?: AlertTone;
  children: ReactNode;
}

/**
 * A sentence about the whole form or page: why a submit failed, or what just happened. A failure is announced at once
 * (`role="alert"`); other notes politely.
 */
export function Alert({ tone = 'neutral', children, className, ...rest }: AlertProps) {
  const style = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0', style.box, className)}
      {...rest}
    >
      {style.icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export interface FailureAlertProps {
  /** Which submit failed. Each one gives a new alert, so the same refusal twice is read out twice. */
  attempt: number;
  /** A sentence for the whole form, shown above the fields; null when every problem has a field of its own. */
  message: string | null;
  /** The first field's message, announced (not shown again) when there is no sentence for the whole form. */
  fieldMessage?: string;
  /** What follows the sentence: a link to the way on. */
  children?: ReactNode;
}

/**
 * Says why a submit failed, for everyone: a visible alert with the form's sentence, or, when the messages sit beside
 * their fields, an alert only assistive technology reads with the first of them. Keyed by the attempt, so a repeated
 * refusal is a fresh alert (`data-attempt` tells them apart) and screen readers announce it again.
 */
export function FailureAlert({ attempt, message, fieldMessage, children }: FailureAlertProps) {
  if (message) {
    return (
      <Alert key={attempt} tone="danger" data-attempt={attempt}>
        {message}
        {children}
      </Alert>
    );
  }
  if (fieldMessage) {
    return (
      <p key={attempt} role="alert" data-attempt={attempt} className="sr-only">
        {fieldMessage}
      </p>
    );
  }
  return null;
}
