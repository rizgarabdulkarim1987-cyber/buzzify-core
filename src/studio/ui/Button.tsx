import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  's-btn inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
  'transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-45 aria-busy:cursor-progress';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-on-ink hover:bg-ink-hover active:bg-ink-hover',
  secondary: 'border border-line-strong bg-raised text-text hover:bg-hover active:bg-pressed',
  ghost: 'text-text hover:bg-hover active:bg-pressed',
  danger: 'bg-danger text-on-status hover:bg-danger-hover active:bg-danger-hover',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-sm [&_svg]:size-3.5',
  md: 'h-8 px-3 text-base [&_svg]:size-4',
  lg: 'h-10 px-4 text-base [&_svg]:size-4',
};

/** The classes of a button, for a link that looks like one. */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Waiting on the action it started: disabled, with a spinner in place of the icon. */
  pending?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  pending = false,
  icon,
  iconEnd,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : icon}
      {children}
      {iconEnd}
    </button>
  );
}
