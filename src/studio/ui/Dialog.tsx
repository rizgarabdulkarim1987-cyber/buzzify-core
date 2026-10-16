'use client';

import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { cx } from './cx';
import { IconButton } from './IconButton';

/**
 * The controls a person last focused or pressed, newest last. Radix gives focus back only to a `Dialog.Trigger`, and the
 * Studio opens its dialogs from plain buttons and from menu items (whose menu is gone by the time the dialog closes), so on
 * close focus fell to the start of the page and a keyboard user had to find their place again. A press counts as well as
 * focus because Safari does not focus a button that is clicked. Kept from the first import on, since a dialog's own
 * component often mounts only when it opens.
 */
const recentlyFocused: HTMLElement[] = [];
const FOCUS_HISTORY = 20;
const CONTROL = 'a[href], button, input, select, textarea, [role="menuitem"], [tabindex]';

function remember(element: Element | null) {
  if (!(element instanceof HTMLElement) || element === document.body || recentlyFocused.at(-1) === element) return;
  recentlyFocused.push(element);
  if (recentlyFocused.length > FOCUS_HISTORY) recentlyFocused.shift();
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => remember(event.target as Element | null));
  document.addEventListener('pointerdown', (event) => remember((event.target as Element | null)?.closest?.(CONTROL) ?? null), true);
}

/**
 * Where focus goes back to when a dialog closes: the newest of the elements focused before it opened that is still on the
 * page, shown, and not inside a dialog. For a dialog opened from a menu that is the menu's button.
 */
function returnTarget(focusedBefore: readonly HTMLElement[]): HTMLElement | undefined {
  for (let index = focusedBefore.length - 1; index >= 0; index--) {
    const element = focusedBefore[index]!;
    if (element.isConnected && element.getClientRects().length > 0 && !element.closest('[role="dialog"], [role="alertdialog"]')) {
      return element;
    }
  }
  return undefined;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** The dialog's buttons, at the bottom end. */
  footer?: ReactNode;
  /** 440 px for a question, 560 px for a form. */
  width?: 'sm' | 'md';
  children?: ReactNode;
}

/**
 * A modal dialog for a step that must not be missed or must be confirmed. Focus moves in and returns when it closes (to
 * what opened it, or the button of the menu it was opened from), Escape closes it, and the page behind does not scroll.
 * The only surface in the Studio with a shadow.
 */
export function Dialog({ open, onOpenChange, title, description, footer, width = 'sm', children }: DialogProps) {
  const t = useT();
  // What had focus when the dialog opened, before focus moved into it.
  const focusedBefore = useRef<HTMLElement[]>([]);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-overlay-in" />
        <RadixDialog.Content
          onOpenAutoFocus={() => {
            focusedBefore.current = [...recentlyFocused];
          }}
          onCloseAutoFocus={(event) => {
            const target = returnTarget(focusedBefore.current);
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className={cx(
            'fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-64px)] w-[calc(100vw-32px)] flex-col',
            'rounded-lg bg-raised shadow-dialog outline-none data-[state=open]:animate-dialog-in',
            width === 'sm' ? 'max-w-[440px]' : 'max-w-[560px]',
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div className="flex flex-col gap-1">
              <RadixDialog.Title className="text-md font-semibold text-text">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="text-base text-muted">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label={t('common.close')} icon={<X aria-hidden />} size="sm" className="-me-2 -mt-0.5" />
            </RadixDialog.Close>
          </div>
          {children && <div className="overflow-y-auto px-6 pt-4">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-6 pb-5 pt-6">{footer}</div>}
          {!footer && <div className="pb-5" />}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
