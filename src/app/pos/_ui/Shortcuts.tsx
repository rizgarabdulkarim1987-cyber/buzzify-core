'use client';

import { useEffect, useRef } from 'react';
import { shortcutFor, type Shortcut } from '@/lib/pos-shortcuts';

/** Listens for the till's keyboard shortcuts while mounted and reports each one; renders nothing. */
export function Shortcuts({ onShortcut }: { onShortcut: (shortcut: Shortcut) => void }) {
  const latest = useRef(onShortcut);
  useEffect(() => {
    latest.current = onShortcut;
  });
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      const found = shortcutFor({
        key: event.key,
        target: event.target instanceof HTMLElement ? event.target : null,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });
      if (found === null) return;
      // Escape is left to open dialogs, which close themselves; `/` and F2 would otherwise type or open browser pages.
      if (found !== 'close') event.preventDefault();
      latest.current(found);
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
  return null;
}
