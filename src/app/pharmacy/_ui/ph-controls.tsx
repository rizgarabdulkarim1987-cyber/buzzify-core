'use client';

import { Checkbox, type CheckboxProps } from '@/studio/ui/Checkbox';
import { cx } from '@/studio/ui/cx';
import { IconButton, type IconButtonProps } from '@/studio/ui/IconButton';
import { Input, type InputProps } from '@/studio/ui/Input';
import { Select, type SelectProps } from '@/studio/ui/Select';

/**
 * The Studio's form controls at the pharmacy's touch size (pharmacy redesign, task 11): each is at least 44px tall, and a
 * checkbox's whole label row is the target. Only the size changes here; the Studio's own controls keep their defaults
 * for the other screens.
 */
export function PhInput({ className, ...rest }: InputProps) {
  return <Input {...rest} className={cx('min-h-11', className)} />;
}

export function PhSelect({ className, ...rest }: SelectProps) {
  return <Select {...rest} className={cx('[&_select]:min-h-11', className)} />;
}

export function PhCheckbox({ className, ...rest }: CheckboxProps) {
  return <Checkbox {...rest} className={cx('min-h-11 items-center!', className)} />;
}

export function PhIconButton({ className, ...rest }: IconButtonProps) {
  return <IconButton {...rest} className={cx('min-h-11 min-w-11', className)} />;
}
