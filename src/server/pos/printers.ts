import type { PrismaClient } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { StudioError } from '@/server/studio/framework/result';

/**
 * The thermal printers of a restaurant. The bridge program on each till PC reaches them by address; this is only the
 * list, with the rule for which printer takes which paper.
 */

export interface PrinterView {
  id: string;
  name: string;
  role: 'RECEIPT' | 'KITCHEN';
  transport: 'NETWORK' | 'FILE';
  address: string;
  paperWidth: 58 | 80;
  cut: boolean;
  drawerPin: 2 | 5 | null;
  isDefault: boolean;
  sectionId: string | null;
  sortOrder: number;
}

export interface PrinterInput {
  printerId?: string;
  name: string;
  role: 'RECEIPT' | 'KITCHEN';
  transport: 'NETWORK' | 'FILE';
  address: string;
  paperWidth: 58 | 80;
  cut: boolean;
  drawerPin: 2 | 5 | null;
  isDefault: boolean;
  sectionId: string | null;
}

const SELECT = { id: true, name: true, role: true, transport: true, address: true, paperWidth: true, cut: true, drawerPin: true, isDefault: true, sectionId: true, sortOrder: true } as const;

export async function listPrintersIn(db: PrismaClient, restaurantId: string): Promise<PrinterView[]> {
  const rows = await db.posPrinter.findMany({ where: { restaurantId }, select: SELECT, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] });
  return rows as PrinterView[];
}

export async function savePrinterIn(tx: ScopedTx, restaurantId: string, input: PrinterInput): Promise<{ id: string; created: boolean }> {
  if (input.sectionId !== null && !(await tx.posKitchenSection.findFirst({ where: { id: input.sectionId }, select: { id: true } }))) throw new StudioError('NOT_FOUND');
  const data = {
    name: input.name,
    role: input.role,
    transport: input.transport,
    address: input.address,
    paperWidth: input.paperWidth,
    cut: input.cut,
    drawerPin: input.drawerPin,
    isDefault: input.role === 'RECEIPT' && input.isDefault,
    sectionId: input.role === 'KITCHEN' ? input.sectionId : null,
  };
  let id: string;
  let created = false;
  if (input.printerId === undefined) {
    const last = await tx.posPrinter.aggregate({ _max: { sortOrder: true } });
    created = true;
    id = (await tx.posPrinter.create({ data: { restaurantId, ...data, sortOrder: (last._max.sortOrder ?? -1) + 1 }, select: { id: true } })).id;
  } else {
    const existing = await tx.posPrinter.findFirst({ where: { id: input.printerId }, select: { id: true } });
    if (!existing) throw new StudioError('NOT_FOUND');
    await tx.posPrinter.updateMany({ where: { id: existing.id }, data });
    id = existing.id;
  }
  if (data.isDefault) await tx.posPrinter.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
  return { id, created };
}

export async function removePrinterIn(tx: ScopedTx, printerId: string): Promise<{ id: string; name: string }> {
  const row = await tx.posPrinter.findFirst({ where: { id: printerId }, select: { id: true, name: true } });
  if (!row) throw new StudioError('NOT_FOUND');
  await tx.posPrinter.deleteMany({ where: { id: row.id } });
  return row;
}

/** The printer for receipts, slips and the drawer: the default one, else the first receipt printer. */
export function printerForReceipt(printers: readonly PrinterView[]): PrinterView | null {
  const receipt = printers.filter((p) => p.role === 'RECEIPT');
  return receipt.find((p) => p.isDefault) ?? receipt[0] ?? null;
}

/** The kitchen printer of a section; else the kitchen printer with no section of its own; else none (the screen remains). */
export function printerForSection(printers: readonly PrinterView[], sectionId: string | null): PrinterView | null {
  const kitchen = printers.filter((p) => p.role === 'KITCHEN');
  return (sectionId === null ? undefined : kitchen.find((p) => p.sectionId === sectionId)) ?? kitchen.find((p) => p.sectionId === null) ?? null;
}
