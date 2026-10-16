import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** What the button does, read by screen readers and shown on hover. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
}

/** A square button that shows only an icon. Its `label` names it for assistive technology and in a tooltip. */
export function IconButton({ label, icon, size = 'md', variant = 'ghost', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 ease-out',
        'hover:bg-hover hover:text-text active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'secondary' && 'border border-line-strong bg-raised',
        size === 'sm' ? 'size-7 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
