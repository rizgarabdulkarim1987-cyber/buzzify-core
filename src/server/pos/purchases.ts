import type { PosSupplierPayMethod } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';
import { nameKey, SUPPLIER_PAY_METHODS } from '@/server/domain/pos/stock';
import { StudioError } from '@/server/studio/framework/result';
import { isUniqueViolation, refuse } from './errors';
import { applyMovements } from './inventory';

/**
 * Suppliers and their purchase invoices. An invoice is posted when it is saved: its lines never change and each brings
 * stock in; a wrong one is voided (the exact opposite movements) and entered again. Paid or unpaid is only a record: it never
 * touches a shift's drawer (a supplier paid from the drawer is also a cash expense on the shift page).
 */

const INT32_MAX = 2_147_483_647;
export { SUPPLIER_PAY_METHODS };

export interface SupplierRow {
  id: string;
  name: string;
  phone: string;
  notes: string;
  active: boolean;
}

export async function createSupplier(db: AnyDb, restaurantId: string, input: { name: string; phone: string; notes: string }) {
  try {
    const supplier = await db.posSupplier.create({ data: { restaurantId, name: input.name, nameKey: nameKey(input.name), phone: input.phone, notes: input.notes }, select: { id: true } });
    return supplier.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'A supplier with this name already exists');
    throw error;
  }
}

export async function updateSupplier(db: AnyDb, restaurantId: string, supplierId: string, input: { name?: string; phone?: string; notes?: string; active?: boolean }) {
  const supplier = await db.posSupplier.findFirst({ where: { id: supplierId, restaurantId } });
  if (!supplier) throw new StudioError('NOT_FOUND');
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const data: { name?: string; nameKey?: string; phone?: string; notes?: string; active?: boolean } = {};
  for (const key of ['name', 'phone', 'notes', 'active'] as const) {
    const next = input[key];
    if (next !== undefined && next !== supplier[key]) {
      (data as Record<string, unknown>)[key] = next;
      before[key] = supplier[key];
      after[key] = next;
    }
  }
  if (data.name !== undefined) data.nameKey = nameKey(data.name);
  if (Object.keys(data).length === 0) return { changed: false as const, before, after };
  try {
    await db.posSupplier.update({ where: { id: supplierId }, data });
  } catch (error) {
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'A supplier with this name already exists');
    throw error;
  }
  return { changed: true as const, before, after };
}

export async function listSuppliers(db: AnyDb, restaurantId: string, includeInactive = false): Promise<SupplierRow[]> {
  const rows = await db.posSupplier.findMany({ where: { restaurantId, ...(includeInactive ? {} : { active: true }) }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  return rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, notes: row.notes, active: row.active }));
}

export interface InvoiceInput {
  clientKey: string;
  supplierId: string;
  invoiceDay: string;
  number?: string;
  note: string;
  lines: { itemId: string; quantity: number; lineTotal: number }[];
  paidMethod?: PosSupplierPayMethod;
}

/**
 * Re-derives each item's last cost from its latest non-voided purchase line (latest invoice day, then creation): two integers,
 * or both null when none is left.
 */
export async function refreshLastCost(db: AnyDb, restaurantId: string, itemIds: readonly string[]): Promise<void> {
  for (const itemId of new Set(itemIds)) {
    const latest = await db.posPurchaseLine.findFirst({
      where: { restaurantId, itemId, invoice: { voidedAt: null } },
      orderBy: [{ invoice: { invoiceDay: 'desc' } }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { quantity: true, lineTotal: true },
    });
    await db.posInventoryItem.updateMany({
      where: { id: itemId, restaurantId },
      data: { lastCostAmount: latest?.lineTotal ?? null, lastCostQuantity: latest?.quantity ?? null },
    });
  }
}

/** Saves and posts an invoice: lines, one PURCHASE movement per line, last costs. The same key or the same supplier and number twice is refused. */
export async function createPurchaseInvoice(db: AnyDb, restaurantId: string, userId: string, input: InvoiceInput) {
  const supplier = await db.posSupplier.findFirst({ where: { id: input.supplierId, restaurantId, active: true }, select: { id: true } });
  if (!supplier) throw new StudioError('NOT_FOUND');
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const items = await db.posInventoryItem.findMany({ where: { restaurantId, id: { in: itemIds } }, select: { id: true, active: true } });
  if (items.length !== itemIds.length) throw new StudioError('NOT_FOUND');
  if (items.some((item) => !item.active)) throw refuse('CONFLICT', 'This item is switched off');
  const total = input.lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (total > INT32_MAX) throw refuse('INVALID', 'The sum of the lines is too large');

  let invoiceId: string;
  try {
    const invoice = await db.posPurchaseInvoice.create({
      data: {
        restaurantId,
        supplierId: supplier.id,
        invoiceDay: input.invoiceDay,
        number: input.number ?? null,
        note: input.note,
        total,
        clientKey: input.clientKey,
        userId,
        ...(input.paidMethod ? { paidAt: new Date(), paidMethod: input.paidMethod } : {}),
      },
      select: { id: true },
    });
    invoiceId = invoice.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw refuse('CONFLICT', 'This invoice was already saved');
    throw error;
  }
  const lines = [];
  for (const line of input.lines) {
    lines.push(await db.posPurchaseLine.create({ data: { restaurantId, invoiceId, itemId: line.itemId, quantity: line.quantity, lineTotal: line.lineTotal }, select: { id: true, itemId: true, quantity: true, lineTotal: true } }));
  }
  await applyMovements(
    db,
    restaurantId,
    userId,
    lines.map((line) => ({ itemId: line.itemId, kind: 'PURCHASE' as const, quantity: line.quantity, costTotal: line.lineTotal, purchaseLineId: line.id })),
  );
  await refreshLastCost(db, restaurantId, itemIds);
  return { invoiceId, total, lines: lines.length, paid: input.paidMethod !== undefined };
}

/** Voids an invoice: the stock goes back down by the same amounts (even below zero) and the previous last cost returns. */
export async function voidPurchaseInvoice(db: AnyDb, restaurantId: string, userId: string, invoiceId: string, reason: string) {
  const invoice = await db.posPurchaseInvoice.findFirst({ where: { id: invoiceId, restaurantId }, include: { lines: true } });
  if (!invoice) throw new StudioError('NOT_FOUND');
  const { count } = await db.posPurchaseInvoice.updateMany({ where: { id: invoiceId, restaurantId, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason } });
  if (count === 0) throw refuse('CONFLICT', 'This invoice was already voided');
  await applyMovements(
    db,
    restaurantId,
    userId,
    invoice.lines.map((line) => ({ itemId: line.itemId, kind: 'PURCHASE_VOID' as const, quantity: -line.quantity, costTotal: -line.lineTotal, reason, purchaseLineId: line.id })),
  );
  await refreshLastCost(db, restaurantId, invoice.lines.map((line) => line.itemId));
  return { total: invoice.total };
}

/** Marks an invoice paid (with the method) or unpaid. A voided invoice cannot change. Returns whether anything changed. */
export async function setPurchasePaid(db: AnyDb, restaurantId: string, invoiceId: string, input: { paid: boolean; method?: PosSupplierPayMethod }) {
  const invoice = await db.posPurchaseInvoice.findFirst({ where: { id: invoiceId, restaurantId } });
  if (!invoice) throw new StudioError('NOT_FOUND');
  if (invoice.voidedAt) throw refuse('CONFLICT', 'This invoice was already voided');
  const wasPaid = invoice.paidAt !== null;
  const method = input.paid ? (input.method ?? null) : null;
  if (wasPaid === input.paid && (!input.paid || invoice.paidMethod === method)) return { changed: false as const, from: wasPaid, to: input.paid };
  await db.posPurchaseInvoice.update({ where: { id: invoiceId }, data: { paidAt: input.paid ? new Date() : null, paidMethod: method } });
  return { changed: true as const, from: wasPaid, to: input.paid, method };
}

export interface PurchaseListRow {
  id: string;
  supplierName: string;
  invoiceDay: string;
  number: string | null;
  total: number;
  paid: boolean;
  voided: boolean;
  lines: number;
}

export async function listPurchaseInvoices(
  db: AnyDb,
  restaurantId: string,
  input: { from?: string; to?: string; supplierId?: string; unpaidOnly?: boolean; take?: number },
): Promise<PurchaseListRow[]> {
  const rows = await db.posPurchaseInvoice.findMany({
    where: {
      restaurantId,
      ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      ...(input.from || input.to ? { invoiceDay: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
      ...(input.unpaidOnly ? { paidAt: null, voidedAt: null } : {}),
    },
    orderBy: [{ invoiceDay: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(input.take ?? 50, 100),
    include: { supplier: { select: { name: true } }, _count: { select: { lines: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    supplierName: row.supplier.name,
    invoiceDay: row.invoiceDay,
    number: row.number,
    total: row.total,
    paid: row.paidAt !== null,
    voided: row.voidedAt !== null,
    lines: row._count.lines,
  }));
}

export interface PurchaseDetail {
  id: string;
  supplierName: string;
  invoiceDay: string;
  number: string | null;
  note: string;
  total: number;
  paidAt: Date | null;
  paidMethod: PosSupplierPayMethod | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  userName: string;
  lines: { id: string; itemName: string; unit: 'GRAM' | 'MILLILITER' | 'PIECE'; quantity: number; lineTotal: number }[];
}

export async function readPurchaseInvoice(db: AnyDb, restaurantId: string, invoiceId: string): Promise<PurchaseDetail> {
  const invoice = await db.posPurchaseInvoice.findFirst({
    where: { id: invoiceId, restaurantId },
    include: { supplier: { select: { name: true } }, lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { item: { select: { name: true, unit: true } } } } },
  });
  if (!invoice) throw new StudioError('NOT_FOUND');
  const user = invoice.userId ? await db.user.findFirst({ where: { id: invoice.userId }, select: { name: true } }) : null;
  return {
    id: invoice.id,
    supplierName: invoice.supplier.name,
    invoiceDay: invoice.invoiceDay,
    number: invoice.number,
    note: invoice.note,
    total: invoice.total,
    paidAt: invoice.paidAt,
    paidMethod: invoice.paidMethod,
    voidedAt: invoice.voidedAt,
    voidReason: invoice.voidReason,
    createdAt: invoice.createdAt,
    userName: user?.name ?? '',
    lines: invoice.lines.map((line) => ({ id: line.id, itemName: line.item.name, unit: line.item.unit, quantity: line.quantity, lineTotal: line.lineTotal })),
  };
}
