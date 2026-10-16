'use client';

import type { TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { CONTROL_CLASSES, useFieldProps } from './Field';

export function Textarea({ className, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useFieldProps();
  return <textarea {...field} rows={rows} {...rest} className={cx(CONTROL_CLASSES, 'px-2.5 py-1.5 text-base', className)} />;
}
