import { kickDrawer, printDoc, type PrintOptions, type PrintResult } from '@/app/pos/_ui/print/print-client';
import { DEFAULT_RECEIPT_PRINTER, receiptPrinter, type ReceiptPrinterSettings, type WorkstationSettings } from '@/server/domain/pharmacy/print-settings';
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

// The settings form's draft ---------------------------------------------------------------------------------------------------

export interface PrinterDraft {
  transport: 'NETWORK' | 'FILE';
  address: string;
  paperWidth: '58' | '80';
  cut: boolean;
  drawerPin: 'none' | '2' | '5';
  drawerOnCash: boolean;
}

/** A printer shared on this PC is always reached as the PC's own share; the person types only its name. */
const SHARE = '\\\\localhost\\';

export function draftOfPrinter(stored: ReceiptPrinterSettings | undefined): PrinterDraft {
  const p = stored ?? DEFAULT_RECEIPT_PRINTER;
  return { transport: p.transport, address: p.transport === 'FILE' ? p.address.slice(SHARE.length) : p.address, paperWidth: String(p.paperWidth) as '58' | '80', cut: p.cut, drawerPin: p.drawerPin === null ? 'none' : (String(p.drawerPin) as '2' | '5'), drawerOnCash: p.drawerOnCash };
}

/** The draft as stored settings: an empty address is "no thermal printer" (value undefined); a bad one is refused. */
export function printerOfDraft(draft: PrinterDraft): { ok: true; value: ReceiptPrinterSettings | undefined } | { ok: false } {
  if (draft.address.trim() === '') return { ok: true, value: undefined };
  const parsed = receiptPrinter.safeParse({ transport: draft.transport, address: draft.transport === 'FILE' ? `${SHARE}${draft.address.trim()}` : draft.address.trim(), paperWidth: Number(draft.paperWidth), cut: draft.cut, drawerPin: draft.drawerPin === 'none' ? null : Number(draft.drawerPin), drawerOnCash: draft.drawerOnCash });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
