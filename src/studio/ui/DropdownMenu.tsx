'use client';

import { DropdownMenu as Menu } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cx } from './cx';

/** A menu of actions that opens from a button: arrow keys move, Enter acts, Escape closes, typing jumps to an item. */
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({ className, sideOffset = 6, align = 'start', ...rest }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cx(
          'z-50 min-w-48 overflow-hidden rounded-md border border-line-strong bg-raised p-1 text-base text-text outline-none',
          className,
        )}
        {...rest}
      />
    </Menu.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof Menu.Item> {
  /** Shown before the label. With `asChild`, put the icon inside the child instead: this one is not used. */
  icon?: ReactNode;
  /** An action that takes something away: shown in the danger colour. */
  danger?: boolean;
}

export function DropdownMenuItem({ icon, danger, className, children, asChild, ...rest }: DropdownMenuItemProps) {
  return (
    <Menu.Item
      asChild={asChild}
      className={cx(
        'flex h-8 cursor-pointer select-none items-center gap-2 rounded-sm px-2 outline-none',
        'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&_svg]:size-4',
        danger ? 'text-danger' : 'text-text [&_svg]:text-muted',
        className,
      )}
      {...rest}
    >
      {/* With asChild the item becomes its one child (a link): Radix cannot slot onto a list, even one with an empty
          icon in it, and opening the menu threw. */}
      {asChild ? (
        children
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </Menu.Item>
  );
}

export function DropdownMenuLabel({ className, ...rest }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cx('px-2 py-1.5 text-xs text-muted', className)} {...rest} />;
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cx('-mx-1 my-1 h-px bg-line', className)} {...rest} />;
}
