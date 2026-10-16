'use client';

import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import { CONTROL_CLASSES, CONTROL_HEIGHTS, useFieldProps, type ControlSize } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  /** The option's own language, when it is a language's name written in that language. */
  lang?: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
  options: readonly SelectOption[];
}

/** The browser's own select in the Studio's style: keyboard, forms and screen readers work as they always do. */
export function Select({ size = 'md', options, className, ...rest }: SelectProps) {
  const field = useFieldProps();
  return (
    <div className={cx('relative', className)}>
      <select {...field} {...rest} className={cx(CONTROL_CLASSES, CONTROL_HEIGHTS[size], 'cursor-pointer appearance-none pe-8')}>
        {options.map((option) => (
          <option key={option.value} value={option.value} lang={option.lang}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
