'use client';

import { Check, Minus } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Text beside the box; without it, pass `aria-label`. */
  label?: ReactNode;
  /** Some but not all of what it stands for is checked (a table's "select all"). */
  indeterminate?: boolean;
}

/**
 * The browser's own checkbox drawn in the Studio's style: a black box with a white tick when checked. It stays a real
 * `<input>`, so forms, labels and the keyboard need nothing extra.
 */
export function Checkbox({ label, indeterminate = false, className, ...rest }: CheckboxProps) {
  const box = (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        type="checkbox"
        ref={(node) => {
          if (node) node.indeterminate = indeterminate;
        }}
        className={cx(
          'peer size-4 cursor-pointer appearance-none rounded-sm border border-line-strong bg-raised transition-colors',
          'hover:border-muted checked:border-ink checked:bg-ink indeterminate:border-ink indeterminate:bg-ink',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
        {...rest}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0.5 hidden size-3 text-on-ink peer-checked:block peer-indeterminate:hidden"
      />
      <Minus
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0.5 hidden size-3 text-on-ink peer-indeterminate:block"
      />
    </span>
  );
  if (!label) return <span className={className}>{box}</span>;
  return (
    <label className={cx('inline-flex cursor-pointer items-start gap-2 text-base text-text', className)}>
      <span className="mt-0.5">{box}</span>
      <span>{label}</span>
    </label>
  );
}
