import { kickDrawer, printDoc, type PrintOptions, type PrintResult } from '@/app/pos/_ui/print/print-client';
import type { WorkstationSettings } from '@/server/domain/pharmacy/print-settings';
import type { ReceiptModel } from '@/server/domain/pharmacy/receipt';
import { receiptPaperDoc, tookCash } from '@/server/domain/pharmacy/receipt-paper';
import type { PrinterView } from '@/server/pos/printers';

/**
 * The pharmacy's thermal printer, through the same print bridge the restaurant cashier uses. The printer belongs to the workstation
 * (its settings), not to the pharmacy. Nothing here throws: a failure is a result the screen shows calmly, and the sale is never touched.
 */

export type ThermalResult = PrintResult | { ok: false; reason: 'none'; message: string };
type Opts = Pick<PrintOptions, 'fetchImpl' | 'render' | 'bridgeUrl' | 'dir' | 'font'>;

const NONE: ThermalResult = { ok: false, reason: 'none', message: 'no receipt printer' };

/** The workstation's receipt printer in the shape the print client takes; null while none is set up. */
export function printerOf(ws: WorkstationSettings): PrinterView | null {
  const p = ws.receiptPrinter;
  if (!p || p.address.trim() === '') return null;
  return { id: 'workstation', name: 'Receipt', role: 'RECEIPT', transport: p.transport, address: p.address.trim(), paperWidth: p.paperWidth, cut: p.cut, drawerPin: p.drawerPin, isDefault: true, sectionId: null, sortOrder: 0 };
}

/** The drawer opens for an original sale that took cash, on a printer with a drawer pin and the cash rule on. Never for a copy or a return slip. */
export function thermalDrawerPlan(model: ReceiptModel, ws: WorkstationSettings): boolean {
  const printer = printerOf(ws);
  return printer !== null && printer.drawerPin !== null && ws.receiptPrinter?.drawerOnCash === true && !model.copyMarker && tookCash(model);
}

/** Prints the receipt (a sale, a copy or a return slip) on the workstation's thermal printer, opening the drawer when the rule says so. */
export async function printThermal(model: ReceiptModel, ws: WorkstationSettings, opts: Opts = {}): Promise<ThermalResult> {
  const printer = printerOf(ws);
  if (!printer) return NONE;
  return printDoc(receiptPaperDoc(model), printer, { ...opts, drawer: thermalDrawerPlan(model, ws) });
}

/** Opens the cash drawer by hand, with no paper. */
export async function openThermalDrawer(ws: WorkstationSettings, opts: Pick<Opts, 'fetchImpl' | 'bridgeUrl'> = {}): Promise<ThermalResult> {
  const printer = printerOf(ws);
  return printer ? kickDrawer(printer, opts) : NONE;
}

/** A short page to check the printer, paper width and cut. */
export async function printThermalTest(ws: WorkstationSettings, opts: Opts = {}): Promise<ThermalResult> {
  const printer = printerOf(ws);
  if (!printer) return NONE;
  return printDoc({ rows: [{ kind: 'text', align: 'center', left: 'Buzzify Pharmacy', size: 2, bold: true }, { kind: 'text', align: 'center', left: `${printer.paperWidth} mm` }, { kind: 'rule' }, { kind: 'text', align: 'start', left: 'Test', right: '123,456' }, { kind: 'gap' }] }, printer, { ...opts, drawer: false });
}
