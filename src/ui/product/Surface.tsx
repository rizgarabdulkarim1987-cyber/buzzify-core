'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DetailKind } from '@/lib/templates/types';

/**
 * Where a template menu opens a product: a bottom sheet, a side drawer, a full page or a centred card. Built on the native
 * <dialog> (focus trap, Escape, inert background). It opens with a CSS animation and closes with the Web Animations API,
 * so the animation library stays out of this chunk; with reduced motion both are instant.
 */
export function Surface({
  kind,
  labelledBy,
  onClose,
  children,
}: {
  kind: Exclude<DetailKind, 'steps'> | 'steps';
  labelledBy: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const [closing, setClosing] = useState(false);
  const latestOnClose = useRef(onClose);
  useEffect(() => {
    latestOnClose.current = onClose;
  });

  useEffect(() => {
    const element = dialog.current;
    opener.current = document.activeElement;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, []);

  // Closing is asked for by state (like Sheet), so `close` can be handed to the content while it renders; the panel
  // then animates away and the parent is told once it has gone.
  const close = useCallback(() => setClosing(true), []);
  useEffect(() => {
    const element = dialog.current;
    if (!closing || !element) return;
    const done = () => latestOnClose.current();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof element.animate !== 'function') {
      done();
      return;
    }
    const panel = element.firstElementChild as HTMLElement | null;
    const rtl = getComputedStyle(element).direction === 'rtl';
    const away: Record<string, Keyframe> = {
      sheet: { transform: 'translateY(56px)', opacity: 0 },
      steps: { transform: 'translateY(56px)', opacity: 0 },
      drawer: { transform: `translateX(${rtl ? '-' : ''}48px)`, opacity: 0 },
      page: { transform: 'translateY(24px)', opacity: 0 },
      card: { transform: 'scale(0.97)', opacity: 0 },
    };
    const animation = (panel ?? element).animate([{ transform: 'none', opacity: 1 }, away[kind]!], { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    // A hidden page does not run animations, so a timer makes sure the surface still closes.
    const fallback = setTimeout(done, 400);
    animation.onfinish = () => {
      clearTimeout(fallback);
      done();
    };
    return () => {
      clearTimeout(fallback);
      animation.onfinish = null;
    };
  }, [closing, kind]);

  const placement = kind === 'steps' ? 'sheet' : kind;
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
      className={`tpl-surface tpl-surface-${placement}`}
    >
      <div className="tpl-surface-panel">{children(close)}</div>
    </dialog>
  );
}
