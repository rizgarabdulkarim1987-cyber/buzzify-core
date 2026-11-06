'use client';

import { useEffect, useRef } from 'react';
import { getPrescription } from '@/app/pharmacy/_actions/prescriptions';
import { settle } from '@/studio/settle';
import type { OpenReceipt } from '../sell-receipts';

/**
 * The old sale screen's check of a prescription restored from the device: each prescription id on a receipt that was not recorded
 * in this session is read once; gone or already used by a sale, the receipt lets it go (`onGone`) and the screen says so. Still
 * unused, its number is shown again (memory only). A receipt with a sale in flight is left alone: that sale carries its own
 * prescription and may be the one that used it.
 */
export function useRxCheck(o: {
  receipts: readonly OpenReceipt[];
  /** The receipts were read from the device and this person may dispense. */
  enabled: boolean;
  /** Prescription ids recorded (or already checked) in this session, with their numbers. */
  numbers: Readonly<Record<string, string>>;
  onGone: (receiptKey: string, prescriptionId: string) => void;
  onNumber: (prescriptionId: string, number: string) => void;
}) {
  const checked = useRef(new Set<string>());
  const latest = useRef(o);
  useEffect(() => {
    latest.current = o;
  });
  useEffect(() => {
    if (!o.enabled) return;
    for (const r of o.receipts) {
      const id = r.prescriptionId;
      if (!id || r.done || r.attempt || checked.current.has(id) || id in o.numbers) continue;
      checked.current.add(id);
      void settle(() => getPrescription({ prescriptionId: id })).then((result) => {
        if (result.ok) {
          const found = result.data as { number?: string; saleId: string | null };
          if (found.saleId) latest.current.onGone(r.key, id);
          else if (found.number) latest.current.onNumber(id, found.number);
        } else if (result.error.code === 'NOT_FOUND') latest.current.onGone(r.key, id);
      });
    }
  }, [o.enabled, o.receipts, o.numbers]);
}
