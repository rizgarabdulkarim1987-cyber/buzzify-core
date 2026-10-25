'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ComplaintForm } from '@/app/[tenant]/[locale]/t/[table]/complaint/ComplaintForm';
import { COMPLAINT_LINK, COMPLAINT_TITLE } from '@/app/[tenant]/[locale]/t/[table]/complaint/words';
import { useApp } from '@/ui/AppProviders';

/** The table whose page may take a complaint, or null when the restaurant has not turned complaints on for it. */
const Context = createContext<number | null>(null);

export function ComplaintEntryProvider({ table, children }: { table: number | null; children: ReactNode }) {
  return <Context.Provider value={table}>{children}</Context.Provider>;
}

/** A button in the menu's header that opens the complaint form in a dialog; nothing when complaints are off. */
export function ComplaintButton() {
  const table = useContext(Context);
  const { tenant, locale } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  if (table === null) return null;
  const words = COMPLAINT_LINK(locale);
  const title = COMPLAINT_TITLE(locale, table);
  return (
    <>
      <button
        type="button"
        data-testid="complaint-open"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-12 items-center rounded-md border border-line px-4 text-sm text-text transition-colors duration-150 [@media(hover:hover)]:hover:border-accent"
      >
        {words.open}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="complaint-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-bg p-0 text-text backdrop:bg-black/60"
      >
        {open ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted">
                  <span dir="auto">{tenant.name}</span> · {title.table}
                </p>
                <h2 id="complaint-title" className="font-display text-2xl text-text">
                  {title.title}
                </h2>
              </div>
              <button type="button" aria-label={words.close} onClick={() => setOpen(false)} className="grid min-h-12 min-w-12 shrink-0 place-items-center rounded-md text-xl text-muted">
                ×
              </button>
            </div>
            <p className="text-base text-muted">{title.intro}</p>
            <ComplaintForm slug={tenant.slug} table={table} locale={locale} />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
