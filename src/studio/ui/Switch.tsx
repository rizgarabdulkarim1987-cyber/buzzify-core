'use client';

import { Switch as RadixSwitch } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cx } from './cx';

export type SwitchProps = ComponentProps<typeof RadixSwitch.Root>;

/**
 * An on/off switch (`role="switch"`), for a setting that applies at once, such as a client's permission. Black when
 * on; the thumb moves toward the end of the line in either reading direction.
 */
export function Switch({ className, ...rest }: SwitchProps) {
  return (
    <RadixSwitch.Root
      className={cx(
        'group inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-line-strong p-0.5',
        'transition-colors duration-150 data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...rest}
    >
      <RadixSwitch.Thumb
        className={cx(
          'block size-4 rounded-full bg-raised transition-transform duration-150 ease-out',
          'data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4',
        )}
      />
    </RadixSwitch.Root>
  );
}
