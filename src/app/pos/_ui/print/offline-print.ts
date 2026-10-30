import type { LocalOrder } from '@/lib/pos-sync/local-state';
import type { SyncSnapshot } from '@/lib/pos-sync/snapshot';
import { offlineKitchenDocs, offlineReceiptDoc } from '@/server/domain/pos/offline-docs';
import type { PaperFormat, PaperText } from '@/server/domain/pos/paper-docs';
import { printerForReceipt, printerForSection, type PrinterView } from '@/server/pos/printers';
import { kickDrawer, printDoc, type PrintResult } from './print-client';
import { printedSlips, rememberSlip } from './slip-memory';

/** What the offline till can print on: the default receipt printer of the saved snapshot (none in a snapshot saved before printers were kept). */
export function offlinePrintTargets(snapshot: Pick<SyncSnapshot, 'printers'>): { receipt: PrinterView | null; hasDrawer: boolean } {
  const receipt = printerForReceipt(snapshot.printers ?? []);
  return { receipt, hasDrawer: receipt?.drawerPin != null };
}

/** The offline "Open drawer" button: a receipt printer holding the drawer, and an open shift for the audit note to belong to. */
export function canOpenOfflineDrawer(snapshot: Pick<SyncSnapshot, 'printers' | 'openShift'>): boolean {
  return snapshot.openShift !== null && snapshot.openShift !== undefined && offlinePrintTargets(snapshot).hasDrawer;
}

const noPrinter: PrintResult = { ok: false, reason: 'printer', message: 'no printer' };

interface Context {
  snapshot: SyncSnapshot;
  order: LocalOrder;
  tableNumber: number | null;
  t: PaperText;
  fmt: PaperFormat;
  font: string;
}

/** The provisional receipt through the bridge, opening the drawer for an original (a cash sale), never for a copy. */
export async function printOfflineReceipt(ctx: Context, opts: { copy: boolean; drawer: boolean }): Promise<PrintResult> {
  const { receipt } = offlinePrintTargets(ctx.snapshot);
  if (!receipt) return noPrinter;
  const doc = offlineReceiptDoc(ctx.order, ctx.tableNumber, ctx.snapshot, ctx.t, ctx.fmt, { copy: opts.copy });
  return printDoc(doc, receipt, { drawer: opts.drawer, font: ctx.font });
}

/** The unsent lines of the order (and new cancellation slips) on each section's printer. A section with no printer is reported, never dropped. */
export async function printOfflineRound(ctx: Context): Promise<PrintResult[]> {
  const printers = ctx.snapshot.printers ?? [];
  if (!printers.some((p) => p.role === 'KITCHEN')) return [];
  const printed = printedSlips();
  const results: PrintResult[] = [];
  for (const { sectionId, doc, slipKey } of offlineKitchenDocs(ctx.order, ctx.tableNumber, ctx.snapshot, ctx.t, ctx.fmt, printed)) {
    const printer = printerForSection(printers, sectionId);
    if (!printer) {
      results.push(noPrinter);
      continue;
    }
    const result = await printDoc(doc, printer, { drawer: false, font: ctx.font });
    if (result.ok && slipKey) rememberSlip(printed, slipKey);
    results.push(result);
  }
  return results;
}

/** Opens the drawer by hand (the caller queues the audit note). */
export async function openOfflineDrawer(snapshot: Pick<SyncSnapshot, 'printers'>): Promise<PrintResult> {
  const { receipt, hasDrawer } = offlinePrintTargets(snapshot);
  return receipt && hasDrawer ? kickDrawer(receipt) : noPrinter;
}
