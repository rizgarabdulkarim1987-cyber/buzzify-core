'use client';

import { useEffect, useRef } from 'react';
import { createScanQueue } from '../sell-logic';
import { useScannerCapture } from '../useScannerCapture';

/**
 * Barcodes from a keyboard-wedge scanner anywhere on the page, handled ONE AT A TIME in the order they arrived (see
 * `createScanQueue`). The latest `handle` is used without re-subscribing. Nothing is captured while `enabled` is false
 * (no shift yet, or the receipts on this device not read yet: an early scan would be replaced by the restore).
 */
export function useScanQueue(handle: (code: string) => Promise<void>, enabled: boolean): void {
  const handler = useRef(handle);
  useEffect(() => {
    handler.current = handle;
  });
  const queue = useRef<ReturnType<typeof createScanQueue> | null>(null);
  useEffect(() => {
    queue.current = createScanQueue((code) => handler.current(code));
  }, []);
  useScannerCapture((code) => queue.current?.push(code), { enabled });
}
