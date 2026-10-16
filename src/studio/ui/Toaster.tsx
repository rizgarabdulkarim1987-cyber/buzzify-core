'use client';

import { Toaster as Sonner } from 'sonner';
import { useLocale } from '@/studio/i18n';

/**
 * Where short confirmations appear ("Password changed"): black notes at the bottom end of the screen, read out by
 * screen readers. Call `toast()` from `sonner` to show one. Mounted once, in the Studio's root layout.
 */
export function Toaster() {
  const { dir } = useLocale();
  return (
    <Sonner
      dir={dir}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      gap={8}
      offset={24}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[356px] items-start gap-2.5 rounded-md bg-ink px-4 py-3 text-sm text-on-ink [&_svg]:mt-px [&_svg]:size-4',
          title: 'font-medium',
          description: 'text-on-ink/75',
          actionButton: 'ms-auto rounded-sm px-2 font-medium underline underline-offset-2',
        },
      }}
    />
  );
}
