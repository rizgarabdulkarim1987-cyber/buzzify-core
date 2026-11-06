'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useFieldProps } from '@/studio/ui/Field';

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

/** The same lines in the pharmacy redesign's colours (`--ph-*`): the Sell screen uses these (`look="ph"`). */
const PH_NOTE = 'flex items-start gap-2.5 rounded-ph-xl border px-3 py-2.5 text-sm [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0';
const PH_NOTE_TONE: Record<keyof typeof NOTE_TONE, string> = {
  plain: 'border-ph-line bg-ph-card text-ph-text',
  danger: 'border-transparent bg-ph-red-wash text-ph-red',
  success: 'border-transparent bg-ph-g1 text-ph-g6',
  info: 'border-transparent bg-ph-blue-wash text-ph-text',
};

export function Note({
  icon,
  tone = 'plain',
  role,
  testId,
  id,
  look = 'studio',
  children,
}: {
  icon: ReactNode;
  tone?: keyof typeof NOTE_TONE;
  role?: 'status' | 'alert';
  testId?: string;
  id?: string;
  look?: 'studio' | 'ph';
  children: ReactNode;
}) {
  return (
    <p id={id} role={role} data-testid={testId} className={look === 'ph' ? `${PH_NOTE} ${PH_NOTE_TONE[tone]}` : `${NOTE} ${NOTE_TONE[tone]}`}>
      {icon}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** A small state in words and an icon (Rx, no price, out of stock, soon): never a colour alone. */
export function Chip({ icon, tone = 'plain', testId, look = 'studio', children }: { icon: ReactNode; tone?: 'plain' | 'danger'; testId?: string; look?: 'studio' | 'ph'; children: ReactNode }) {
  const colours =
    look === 'ph'
      ? tone === 'danger'
        ? 'rounded-lg border-transparent bg-ph-red-wash text-ph-red'
        : 'rounded-lg border-ph-line bg-ph-canvas text-ph-text'
      : tone === 'danger'
        ? 'rounded-sm border-transparent bg-danger-wash text-danger'
        : 'rounded-sm border-line-strong bg-surface text-text';
  return (
    <span data-testid={testId} className={`inline-flex min-h-6 items-center gap-1.5 border px-1.5 py-0.5 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0 ${colours}`}>
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

/** The pharmacy redesign's controls (`--ph-*`, used by the Sell screen): 44 px, rounder, no motion. */
const PH_TOUCH = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-ph-xl px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45';
export const PH_BTN = `${PH_TOUCH} border border-ph-line bg-ph-card text-ph-text hover:bg-ph-canvas`;
export const PH_PRIMARY = `${PH_TOUCH} bg-ph-g8 px-4 text-ph-on-green hover:bg-ph-g9`;
export const PH_FIELD = 'min-h-11 w-full min-w-0 rounded-ph-xl border border-ph-line bg-ph-canvas px-3 text-base text-ph-text focus:border-ph-accent aria-invalid:border-ph-red disabled:text-ph-muted';

/** A text control inside a `Field`: takes the field's id and description so its label and error reach assistive technology. */
export function FieldInput(props: ComponentProps<'input'>) {
  const field = useFieldProps();
  return <input {...field} {...props} />;
}

export function FieldSelect(props: ComponentProps<'select'>) {
  const field = useFieldProps();
  return <select {...field} {...props} />;
}
