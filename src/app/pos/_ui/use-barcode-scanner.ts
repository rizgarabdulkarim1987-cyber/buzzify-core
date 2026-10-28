'use client';

import { useEffect, useRef } from 'react';
import { createScanner } from '@/server/domain/pos/scan';

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Listens on the whole page for a scanner (a keyboard that types a code fast and presses Enter). Typing into a field is never a scan. */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true): void {
  const latest = useRef(onScan);
  useEffect(() => {
    latest.current = onScan;
  });
  useEffect(() => {
    if (!enabled) return;
    const scanner = createScanner((code) => latest.current(code));
    const handle = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const consumed = scanner.key({ key: event.key, targetIsField: target !== null && (FIELDS.has(target.tagName) || target.isContentEditable) });
      if (consumed) event.preventDefault();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [enabled]);
}
