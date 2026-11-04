'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { countText, NavIcon } from './NavIcon';
import type { PhNavKey, PhShellLink } from './nav';

/**
 * The phone's "More" sheet: a full-height modal `<dialog>` (focus stays inside, Escape closes it) listing every place the
 * bottom bar has no room for, then the person's links (account, change branch, sign out). It opens and closes at once,
 * with no motion; its content is drawn only while it is open.
 */
export function MoreSheet({
  open,
  onClose,
  links,
  active,
  title,
  closeLabel,
  account,
}: {
  open: boolean;
  onClose: () => void;
  links: PhShellLink[];
  active: PhNavKey | null;
  title: string;
  closeLabel: string;
  account: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      id="ph-more-sheet"
      aria-labelledby="ph-more-title"
      onClose={onClose}
      className="m-0 h-dvh max-h-none border-0 w-full max-w-none bg-ph-canvas p-0 text-ph-text md:hidden print:hidden"
    >
      {open ? (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-3 border-b border-ph-line bg-ph-card px-4 py-2">
            <h2 id="ph-more-title" className="min-w-0 flex-1 break-words text-lg font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="grid size-11 shrink-0 place-items-center rounded-ph-xl text-ph-text hover:bg-ph-g1"
            >
              <X aria-hidden size={22} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <ul className="flex flex-col gap-1">
              {links.map((l) => {
                const current = l.key === active;
                return (
                  <li key={l.key}>
                    <Link
                      href={l.href}
                      onClick={onClose}
                      aria-current={current ? 'page' : undefined}
                      className={`flex min-h-12 items-center gap-3 rounded-[14px] px-3 py-1.5 text-base ${
                        current ? 'bg-ph-g1 font-bold text-ph-g8' : 'font-medium text-ph-text hover:bg-ph-card'
                      }`}
                    >
                      <NavIcon name={l.icon} className="shrink-0 text-ph-g6" />
                      <span className="min-w-0 flex-1 break-words">{l.label}</span>
                      {l.count ? (
                        <span className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-ph-red-wash px-1.5 text-xs font-bold text-ph-red">
                          {countText(l.count)}
                        </span>
                      ) : null}
                      {current ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-ph-accent" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 border-t border-ph-line pt-3">{account}</div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
