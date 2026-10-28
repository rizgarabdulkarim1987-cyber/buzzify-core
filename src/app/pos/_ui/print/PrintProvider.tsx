'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { fetchOrderKitchenTicket } from '@/app/studio/_actions/pos';
import { kitchenDocs, receiptDoc, shiftDoc, type PaperFormat } from '@/server/domain/pos/paper-docs';
import { formatNumber, formatStamp } from '@/lib/pos-format';
import type { PaperDoc } from '@/server/domain/pos/paper';
import { printerForReceipt, printerForSection, type PrinterView } from '@/server/pos/printers';
import type { Receipt } from '@/server/pos/payments';
import type { ShiftSummary } from '@/server/pos/shifts';
import { useT } from '@/studio/i18n';
import { useMoney } from '../money';
import { kickDrawer, printDoc, type PrintResult } from './print-client';

const PrintersContext = createContext<PrinterView[]>([]);
const noPrinter: PrintResult = { ok: false, reason: 'printer', message: 'no printer' };

/** The restaurant's printers, read once by the till frame, for every screen that prints. */
export function PrintProvider({ printers, children }: { printers: PrinterView[]; children: ReactNode }) {
  return <PrintersContext.Provider value={printers}>{children}</PrintersContext.Provider>;
}

function bodyFont(): string {
  return typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.body).fontFamily || 'sans-serif';
}

/**
 * Silent printing for a screen. Every function answers with a result and never throws; a screen that must tell the cashier
 * (the receipt) shows it, the others raise a toast. Nothing here can undo a sale.
 */
export function usePrint() {
  const printers = useContext(PrintersContext);
  const t = useT();
  const money = useMoney();
  const latest = useRef({ printers, t, money });
  useEffect(() => {
    latest.current = { printers, t, money };
  });

  const format = useCallback((): PaperFormat => ({ money: latest.current.money, number: formatNumber, stamp: formatStamp }), []);
  const fail = useCallback((result: PrintResult) => {
    if (!result.ok) toast.error(latest.current.t('pos.print.failed', { message: result.message }));
    return result;
  }, []);

  const printReceipt = useCallback(
    async (receipt: Receipt, opts: { copy: boolean; drawer: boolean }): Promise<PrintResult> => {
      const printer = printerForReceipt(latest.current.printers);
      if (!printer) return noPrinter;
      const doc = receiptDoc(receipt, latest.current.t, format(), { copy: opts.copy });
      return printDoc(doc, printer, { drawer: opts.drawer, font: bodyFont() });
    },
    [format],
  );

  const printShift = useCallback(
    async (summary: ShiftSummary): Promise<PrintResult> => {
      const printer = printerForReceipt(latest.current.printers);
      if (!printer) return noPrinter;
      return fail(await printDoc(shiftDoc(summary, latest.current.t, format()), printer, { drawer: false, font: bodyFont() }));
    },
    [fail, format],
  );

  /** Sends the round just sent to the kitchen to each section's printer; a section with no printer keeps the screen. */
  const printKitchenRound = useCallback(
    async (orderId: string) => {
      if (!latest.current.printers.some((p) => p.role === 'KITCHEN')) return;
      const fetched = await fetchOrderKitchenTicket({ orderId });
      if (!fetched.ok) return;
      for (const { sectionId, doc } of kitchenDocs(fetched.data, latest.current.t, format())) {
        const printer = printerForSection(latest.current.printers, sectionId);
        if (printer) fail(await printDoc(doc as PaperDoc, printer, { drawer: false, font: bodyFont() }));
      }
    },
    [fail, format],
  );

  /** The printer that holds the drawer, if any. */
  const drawerPrinter = useCallback((): PrinterView | null => {
    const receipt = printerForReceipt(latest.current.printers);
    return receipt && receipt.drawerPin !== null ? receipt : null;
  }, []);

  const openDrawer = useCallback(async (): Promise<PrintResult> => {
    const printer = drawerPrinter();
    return printer ? fail(await kickDrawer(printer)) : noPrinter;
  }, [drawerPrinter, fail]);

  return { hasReceiptPrinter: printerForReceipt(printers) !== null, hasDrawer: printerForReceipt(printers)?.drawerPin != null, printReceipt, printShift, printKitchenRound, openDrawer };
}
