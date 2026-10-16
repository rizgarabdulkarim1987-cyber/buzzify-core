import type { ReactNode } from 'react';
import { cx } from '@/studio/ui/cx';

export interface AuthPanelProps {
  title: ReactNode;
  intro?: ReactNode;
  /** 380 px for a short form, 520 px for the two-factor setup. */
  width?: 'sm' | 'md';
  /** Notes above the form: a notice, or who is signed in. */
  notices?: ReactNode;
  /** The way back, under a hairline. */
  footer?: ReactNode;
  children?: ReactNode;
}

/** The column every signed-out page sets its form in: the page's `h1`, a line on what to do, the form, the way back. */
export function AuthPanel({ title, intro, width = 'sm', notices, footer, children }: AuthPanelProps) {
  return (
    <div className={cx('mx-auto w-full', width === 'sm' ? 'max-w-[380px]' : 'max-w-[520px]')}>
      <h1 className="text-2xl font-semibold tracking-[-0.01em] text-text">{title}</h1>
      {intro && <p className="mt-2 text-base text-muted">{intro}</p>}
      {notices && <div className="mt-6 flex flex-col gap-3">{notices}</div>}
      {children && <div className="mt-8">{children}</div>}
      {footer && <div className="mt-8 border-t border-line pt-5 text-sm text-muted">{footer}</div>}
    </div>
  );
}
