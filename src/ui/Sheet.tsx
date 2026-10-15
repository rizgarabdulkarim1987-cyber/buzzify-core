'use client';

import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface SheetProps {
  labelledBy: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}

/**
 * A modal bottom sheet built on the native <dialog>, which supplies focus trapping,
 * Escape handling and an inert background. Motion animates the panel in and out.
 */
export function Sheet({ labelledBy, onClose, children }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const element = dialog.current;
    opener.current = document.activeElement;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="m-0 mt-auto h-auto max-h-[94dvh] w-full max-w-none overflow-hidden rounded-t-2xl border-0 bg-surface p-0 text-text sm:mx-auto sm:mb-auto sm:max-w-xl sm:rounded-2xl"
    >
      <motion.div
        className="flex max-h-[94dvh] flex-col"
        initial={{ y: 48 }}
        animate={{ y: open ? 0 : 48, opacity: open ? 1 : 0 }}
        transition={{ type: 'spring', duration: 0.36, bounce: 0.1 }}
        onAnimationComplete={() => {
          if (!open) onClose();
        }}
      >
        {children(close)}
      </motion.div>
    </dialog>
  );
}
