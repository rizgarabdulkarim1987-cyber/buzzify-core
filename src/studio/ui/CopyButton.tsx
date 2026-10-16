'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useT } from '@/studio/i18n';
import { Button, type ButtonSize, type ButtonVariant } from './Button';

export interface CopyButtonProps {
  /** What goes on the clipboard. */
  value: string;
  /** The button's text; "Copy" when left out. */
  label?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}

/** Copies `value` and says so on the button itself for a moment ("Copied", with a tick), announced to screen readers. */
export function CopyButton({ value, label, size = 'sm', variant = 'secondary', className }: CopyButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
          toast.error(t('common.copyFailed'));
        }
      }}
    >
      <span aria-live="polite">{copied ? t('common.copied') : (label ?? t('common.copy'))}</span>
    </Button>
  );
}
