'use client';

import { Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useT } from '@/studio/i18n';
import { cx } from '@/studio/ui/cx';

/**
 * The till header's person cluster (name, PIN, account, layout, sign-out). From lg up it sits inline in the header; on a
 * phone it folds behind one button so the header stays a single slim row.
 */
export function HeaderMenu({ children, summary }: { children: ReactNode; summary: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('common.moreActions')}
        onClick={() => setOpen((now) => !now)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-raised px-3 text-sm font-semibold text-text lg:hidden"
      >
        {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
        <span className="max-w-[9ch] truncate">{summary}</span>
      </button>
      <div
        className={cx(
          'absolute inset-x-3 top-full z-40 mt-1 flex-col gap-4 rounded-2xl border border-line bg-raised p-4 text-base shadow-lg',
          'lg:static lg:mt-0 lg:flex lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-3 lg:gap-y-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:text-sm lg:shadow-none',
          open ? 'flex' : 'hidden',
        )}
      >
        {children}
      </div>
    </>
  );
}
