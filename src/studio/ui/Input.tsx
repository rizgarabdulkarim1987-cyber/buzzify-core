'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';
import { useT } from '@/studio/i18n';
import { cx } from './cx';
import { CONTROL_CLASSES, CONTROL_HEIGHTS, useFieldProps, type ControlSize } from './Field';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
}

export function Input({ size = 'md', className, ...rest }: InputProps) {
  const field = useFieldProps();
  return <input {...field} {...rest} className={cx(CONTROL_CLASSES, CONTROL_HEIGHTS[size], className)} />;
}

/** A password input with a button that shows what was typed. */
export function PasswordInput({ size = 'md', className, ...rest }: Omit<InputProps, 'type'>) {
  const t = useT();
  const field = useFieldProps();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...field}
        {...rest}
        type={shown ? 'text' : 'password'}
        className={cx(CONTROL_CLASSES, CONTROL_HEIGHTS[size], size === 'lg' ? 'pe-11' : 'pe-9', className)}
      />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={shown ? t('common.hidePassword') : t('common.showPassword')}
        aria-pressed={shown}
        className={cx(
          'absolute inset-y-1 end-1 inline-flex items-center justify-center rounded-sm text-muted transition-colors',
          'hover:bg-hover hover:text-text',
          size === 'lg' ? 'w-9' : 'w-7',
        )}
      >
        {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}
