'use client';

import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { cx } from './cx';
import { IconButton } from './IconButton';

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
 * A modal dialog for a step that must not be missed or must be confirmed. Focus moves in and returns when it closes,
 * Escape closes it, and the page behind does not scroll. The only surface in the Studio with a shadow.
 */
export function Dialog({ open, onOpenChange, title, description, footer, width = 'sm', children }: DialogProps) {
  const t = useT();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-overlay-in" />
        <RadixDialog.Content
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
