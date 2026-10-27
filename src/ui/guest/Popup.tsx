'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from '@/ui/Icons';

/**
 * A centred modal on the native <dialog>: it traps focus, closes on Escape, keeps the page behind inert and gives focus back.
 * No motion: it must not compete with a style's own.
 */
export function Popup({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    // No cleanup that closes it: closing fires `close` later, which would shut a popup that Strict Mode re-ran. Removing the
    // element takes it out of the top layer by itself.
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="guest-popup-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-text backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between gap-4 px-5 pt-4">
        <h2 id="guest-popup-title" className="font-display text-xl">
          {title}
        </h2>
        <button type="button" aria-label={closeLabel} onClick={() => dialog.current?.close()} className="grid size-11 shrink-0 place-items-center text-muted">
          <CloseIcon />
        </button>
      </div>
      <div className="px-5 pb-5 pt-2">{children}</div>
    </dialog>
  );
}
