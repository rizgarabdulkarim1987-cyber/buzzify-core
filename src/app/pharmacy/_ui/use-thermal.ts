'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPrintSettings } from '@/app/pharmacy/_actions/print';
import type { ReceiptModel } from '@/server/domain/pharmacy/receipt';
import { DEFAULT_WORKSTATION, readPrintSettings, settingsOfWorkstation, type WorkstationSettings } from '@/server/domain/pharmacy/print-settings';
import { settle } from '@/studio/settle';
import { printerOf, printThermal } from './thermal-print';
import { useWorkstation } from './use-workstation';

/**
 * This workstation's printing settings, read once when a printing screen opens (the workstation is the name kept on this device).
 * `null` while loading or when they cannot be read: the screen then prints through the browser as before, never blocks a sale.
 */
export function useThermal(): WorkstationSettings | null {
  const [workstation] = useWorkstation();
  const [all, setAll] = useState<ReturnType<typeof readPrintSettings> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void settle(() => getPrintSettings({})).then((result) => {
      if (!cancelled && result.ok) setAll(readPrintSettings((result.data as { print: unknown }).print));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (all === null) return null;
  return workstation === null ? DEFAULT_WORKSTATION : settingsOfWorkstation(all, workstation);
}

export type ThermalState = 'idle' | 'printing' | 'ok' | 'bridge' | 'printer';

/** Prints a receipt on this workstation's thermal printer and keeps the outcome for the screen to say; it never throws and never touches the sale. */
export function useThermalJob(ws: WorkstationSettings | null) {
  const [state, setState] = useState<ThermalState>('idle');
  const enabled = ws !== null && printerOf(ws) !== null;
  const run = useCallback(
    async (model: ReceiptModel) => {
      if (!ws || !printerOf(ws)) return;
      setState('printing');
      const font = typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.body).fontFamily || 'sans-serif';
      const result = await printThermal(model, ws, { font, dir: model.dir });
      setState(result.ok ? 'ok' : result.reason === 'printer' ? 'printer' : 'bridge');
    },
    [ws],
  );
  const reset = useCallback(() => setState('idle'), []);
  return { enabled, state, run, reset };
}
