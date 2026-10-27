import type { ReactNode } from 'react';

/** A number, amount or date kept in reading order inside a right-to-left sentence. */
export function Num({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** The classes of a message line: an icon and words together, the wash only repeats them. */
export const NOTE = 'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0';
export const NOTE_TONE = {
  plain: 'border-line bg-surface text-text',
  danger: 'border-transparent bg-danger-wash text-danger',
  success: 'border-transparent bg-success-wash text-success',
  info: 'border-transparent bg-info-wash text-text',
} as const;

export function Note({ icon, tone = 'plain', role, testId, children }: { icon: ReactNode; tone?: keyof typeof NOTE_TONE; role?: 'status' | 'alert'; testId?: string; children: ReactNode }) {
  return (
    <p role={role} data-testid={testId} className={`${NOTE} ${NOTE_TONE[tone]}`}>
      {icon}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** A small state in words and an icon (Rx, no price, out of stock, soon): never a colour alone. */
export function Chip({ icon, tone = 'plain', testId, children }: { icon: ReactNode; tone?: 'plain' | 'danger'; testId?: string; children: ReactNode }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${
        tone === 'danger' ? 'border-transparent bg-danger-wash text-danger' : 'border-line-strong bg-surface text-text'
      }`}
    >
      {icon}
      {children}
    </span>
  );
}

/** A 44 px square-or-wider control, the minimum for a touch. */
export const TOUCH = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium';
export const TOUCH_BTN = `${TOUCH} border border-line-strong bg-raised text-text hover:bg-hover active:bg-pressed disabled:cursor-not-allowed disabled:opacity-45`;
export const TOUCH_PRIMARY = `${TOUCH} bg-ink px-4 text-on-ink hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-45`;
export const FIELD = 'min-h-11 w-full min-w-0 rounded-md border border-line-strong bg-raised px-3 text-base text-text hover:border-muted/60 focus:border-ink aria-invalid:border-danger disabled:bg-surface disabled:text-muted';
