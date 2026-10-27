import { z } from 'zod';
import type { ScopedDb } from '@/server/data/tenant-db';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { buildReceipt, renderReceiptHtml, renderReceiptText, type ReceiptLocale, type ReceiptModel, type ReceiptWidth, type StoredDocument } from '@/server/domain/pharmacy/receipt';
import { isLocale } from '@/lib/locale';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';

/**
 * Printing data (phase 3, task 6). A receipt is rendered from the STORED sale or return, never from what a screen holds.
 * Reading one never writes anything and has no state: there is no "printed" flag, so a printer that fails changes nothing.
 * Only a REPRINT is logged (`PhReceiptReprint`: who, when, width, a number per document). Who may print: any holder of
 * `shift.use` or `report.view` in the sale's branch; a support actor and other roles cannot. No cost, no profit, and no
 * patient or customer field exists in the input of the builder, so none can appear.
 */

const idText = z.string().min(1).max(64);
const widthField = z.enum(['80', '58'], 'Choose a receipt width');
const localeField = z.enum(['en', 'ar', 'ckb'], 'Choose a language');
const clientKey = z.string().trim().min(8, 'Use at least 8 characters').max(100, 'Use at most 100 characters');

export const receiptGetInput = z.object({ saleId: idText, width: widthField.default('80'), locale: localeField.optional() });
export const returnReceiptInput = z.object({ returnId: idText, width: widthField.default('80'), locale: localeField.optional() });
export const reprintInput = z
  .object({
    saleId: idText.optional(),
    returnId: idText.optional(),
    width: widthField.default('80'),
    locale: localeField.optional(),
    reason: z.string().trim().max(200, 'Use at most 200 characters').default(''),
    clientKey,
  })
  .refine((v) => (v.saleId === undefined) !== (v.returnId === undefined), { message: 'Choose a sale or a return', path: ['saleId'] });

export interface ReceiptResult {
  html: string;
  text: string;
  model: ReceiptModel;
  /** The reprint's number (1 for the first copy); 0 for the first print, which is not logged. */
  copyNumber: number;
  replayed: boolean;
}

/** Anyone who sells or reviews sales may print a receipt of their branch. */
export function mayPrint(ph: PhActor): void {
  if (ph.role === null || ph.support !== null) throw new StudioError('FORBIDDEN');
  if (!canPh(ph.role, 'shift.use') && !canPh(ph.role, 'report.view')) throw new StudioError('FORBIDDEN');
}

const PRINTABLE = new Set(['COMPLETED', 'RETURNED_PARTIAL', 'RETURNED_FULL']);

async function shopOf(scoped: ScopedDb, branchId: string): Promise<{ name: string; address?: string; phone?: string }> {
  const [restaurant, branch] = await Promise.all([
    scoped.restaurant.findFirst({ select: { name: true, address: true, phone: true } }),
    scoped.branch.findFirst({ where: { id: branchId }, select: { address: true, phone: true } }),
  ]);
  const address = branch?.address || restaurant?.address || '';
  const phone = branch?.phone || restaurant?.phone || '';
  return { name: restaurant?.name ?? '', ...(address ? { address } : {}), ...(phone ? { phone } : {}) };
}

async function nameOf(scoped: ScopedDb, userId: string): Promise<string | null> {
  const user = await scoped.user.findFirst({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}

interface Loaded {
  doc: StoredDocument;
  branchId: string;
  saleId: string | null;
  returnId: string | null;
}

async function loadSale(scoped: ScopedDb, saleId: string, branchId: string | undefined): Promise<Loaded> {
  const sale = await scoped.phSale.findFirst({
    where: { id: saleId, ...(branchId ? { branchId } : {}) },
    select: {
      id: true,
      branchId: true,
      number: true,
      status: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      roundingMinor: true,
      totalMinor: true,
      paidMinor: true,
      changeMinor: true,
      soldById: true,
      createdAt: true,
      completedAt: true,
      payments: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { method: true, amountMinor: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        select: {
          lineNo: true,
          qty: true,
          unitPriceMinor: true,
          discountMinor: true,
          totalMinor: true,
          rxLevel: true,
          product: { select: { tradeName: true, strength: true } },
          unit: { select: { label: true } },
        },
      },
    },
  });
  if (!sale) throw new StudioError('NOT_FOUND', 'Sale not found');
  if (!PRINTABLE.has(sale.status) || sale.number === null) throw new StudioError('CONFLICT', 'This sale has no receipt', { phCode: 'NOT_PRINTABLE' });
  return {
    branchId: sale.branchId,
    saleId: sale.id,
    returnId: null,
    doc: {
      kind: 'sale',
      sale: {
        number: sale.number,
        currency: sale.currency,
        at: sale.completedAt ?? sale.createdAt,
        subtotalMinor: sale.subtotalMinor,
        discountMinor: sale.discountMinor,
        roundingMinor: sale.roundingMinor,
        totalMinor: sale.totalMinor,
        paidMinor: sale.paidMinor,
        changeMinor: sale.changeMinor,
        cashierName: await nameOf(scoped, sale.soldById),
        lines: sale.lines.map((l) => ({
          lineNo: l.lineNo,
          name: l.product.tradeName,
          strength: l.product.strength,
          qty: l.qty,
          unitLabel: l.unit.label,
          unitPriceMinor: l.unitPriceMinor,
          discountMinor: l.discountMinor,
          totalMinor: l.totalMinor,
          rxLevel: l.rxLevel,
        })),
        payments: sale.payments.map((p) => ({ method: p.method, amountMinor: p.amountMinor })),
      },
    },
  };
}

async function loadReturn(scoped: ScopedDb, returnId: string, branchId: string | undefined): Promise<Loaded> {
  const row = await scoped.phReturn.findFirst({
    where: { id: returnId, ...(branchId ? { branchId } : {}) },
    select: {
      id: true,
      branchId: true,
      number: true,
      currency: true,
      refundMinor: true,
      refundMethod: true,
      approvedById: true,
      createdAt: true,
      sale: { select: { number: true } },
      lines: {
        orderBy: { id: 'asc' },
        select: {
          baseQty: true,
          refundMinor: true,
          allocation: { select: { saleLine: { select: { rxLevel: true, product: { select: { tradeName: true, strength: true } } } } } },
        },
      },
    },
  });
  if (!row) throw new StudioError('NOT_FOUND', 'Return not found');
  return {
    branchId: row.branchId,
    saleId: null,
    returnId: row.id,
    doc: {
      kind: 'return',
      ret: {
        number: row.number,
        saleNumber: row.sale.number,
        currency: row.currency,
        at: row.createdAt,
        refundMinor: row.refundMinor,
        refundMethod: row.refundMethod,
        approverName: await nameOf(scoped, row.approvedById),
        lines: row.lines.map((l) => ({
          name: l.allocation.saleLine.product.tradeName,
          strength: l.allocation.saleLine.product.strength,
          baseQty: l.baseQty,
          refundMinor: l.refundMinor,
          rxLevel: l.allocation.saleLine.rxLevel,
        })),
      },
    },
  };
}

function render(doc: StoredDocument, shop: Awaited<ReturnType<typeof shopOf>>, opts: { width: ReceiptWidth; locale: ReceiptLocale; copy: boolean; copyNumber?: number }): Omit<ReceiptResult, 'copyNumber' | 'replayed'> {
  const model = buildReceipt(doc, { ...opts, shop });
  return { html: renderReceiptHtml(model), text: renderReceiptText(model), model };
}

const localeOf = (ph: PhActor, wanted: ReceiptLocale | undefined): ReceiptLocale => wanted ?? (isLocale(ph.locale) ? (ph.locale as ReceiptLocale) : 'en');

/** The first print of a sale: read-only, not logged. NOT_FOUND outside the actor's branches, CONFLICT for a held sale. */
export async function receiptOfSale(scoped: ScopedDb, ph: PhActor, input: z.infer<typeof receiptGetInput> & { branchId?: string }): Promise<ReceiptResult> {
  mayPrint(ph);
  const loaded = await loadSale(scoped, input.saleId, input.branchId);
  const shop = await shopOf(scoped, loaded.branchId);
  return { ...render(loaded.doc, shop, { width: input.width, locale: localeOf(ph, input.locale), copy: false }), copyNumber: 0, replayed: false };
}

/** The return slip, read-only and not logged. */
export async function receiptOfReturn(scoped: ScopedDb, ph: PhActor, input: z.infer<typeof returnReceiptInput> & { branchId?: string }): Promise<ReceiptResult> {
  mayPrint(ph);
  const loaded = await loadReturn(scoped, input.returnId, input.branchId);
  const shop = await shopOf(scoped, loaded.branchId);
  return { ...render(loaded.doc, shop, { width: input.width, locale: localeOf(ph, input.locale), copy: false }), copyNumber: 0, replayed: false };
}

export interface ReprintAudit {
  documentId: string;
  documentType: 'PhSale' | 'PhReturn';
  branchId: string;
  copyNumber: number;
  width: ReceiptWidth;
}

/**
 * A reprint: logs one `PhReceiptReprint` row and returns the document marked COPY. A repeated `clientKey` for the same
 * document returns the copy already logged without a second row; the same key for another document is refused. The
 * unique indexes (document + copy number, business + key) make two parallel reprints each get their own number or the
 * same row; a loser gets P2002, which the action retries.
 */
export async function reprint(tx: ScopedDb, ph: PhActor, input: z.infer<typeof reprintInput> & { branchId?: string }): Promise<{ result: ReceiptResult; audit: ReprintAudit | null }> {
  mayPrint(ph);
  const loaded = input.saleId ? await loadSale(tx, input.saleId, input.branchId) : await loadReturn(tx, input.returnId!, input.branchId);
  const shop = await shopOf(tx, loaded.branchId);
  const locale = localeOf(ph, input.locale);
  const width = input.width;

  const existing = await tx.phReceiptReprint.findFirst({ where: { clientKey: input.clientKey }, select: { saleId: true, returnId: true, copyNumber: true, width: true } });
  if (existing) {
    if (existing.saleId !== loaded.saleId || existing.returnId !== loaded.returnId) throw new StudioError('CONFLICT', 'This key was already used for a different receipt', { phCode: 'CLIENT_KEY_MISMATCH' });
    return { result: { ...render(loaded.doc, shop, { width, locale, copy: true, copyNumber: existing.copyNumber }), copyNumber: existing.copyNumber, replayed: true }, audit: null };
  }

  const last = await tx.phReceiptReprint.aggregate({ where: loaded.saleId ? { saleId: loaded.saleId } : { returnId: loaded.returnId }, _max: { copyNumber: true } });
  const copyNumber = (last._max.copyNumber ?? 0) + 1;
  await tx.phReceiptReprint.create({
    data: {
      restaurantId: ph.restaurantId,
      saleId: loaded.saleId,
      returnId: loaded.returnId,
      userId: ph.userId,
      copyNumber,
      width: Number(width),
      reason: input.reason,
      clientKey: input.clientKey,
    },
    select: { id: true },
  });
  return {
    result: { ...render(loaded.doc, shop, { width, locale, copy: true, copyNumber }), copyNumber, replayed: false },
    audit: { documentId: (loaded.saleId ?? loaded.returnId)!, documentType: loaded.saleId ? 'PhSale' : 'PhReturn', branchId: loaded.branchId, copyNumber, width },
  };
}
