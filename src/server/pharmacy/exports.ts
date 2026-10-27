import { z } from 'zod';
import type { ScopedClient } from '@/server/data/tenant-db';
import type { Currency } from '@/server/domain/billing/money';
import { writeCsv, writeXlsx } from '@/server/sheets/write';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { minorText } from './imports';
import { mayViewCost } from './products';

/**
 * The catalog as a sheet (spec 4.7: reading and exporting stay open while a lapsed pharmacy is read-only). The columns
 * are the import's own (`PRODUCT_COLUMNS` names), so an exported file maps itself when imported again. What a person
 * sees is what they may see: the minimum quantity of their branches only, and cost columns only with `cost.view`.
 * Every cell that a spreadsheet would read as a formula is written as text.
 */

/** The most products one export holds; a bigger catalog is refused rather than cut short. */
export const PH_EXPORT_MAX_ROWS = 50_000;

export const exportInput = z.object({
  format: z.enum(['csv', 'xlsx']),
  active: z.enum(['active', 'archived', 'all']).default('active'),
});
export type ExportInput = z.infer<typeof exportInput>;

const CONTENT_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/**
 * A cell a spreadsheet keeps as text: one starting with `=`, `+`, `-` or `@` (a formula), or with a tab or carriage
 * return (which some spreadsheets strip before reading a formula), gets a leading quote.
 */
export function escapeCell(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/**
 * The cost columns, for a role with `cost.view` only (never a cashier, never support). Products hold no cost yet
 * (purchases record it from Phase 2): the columns are there, empty, so the gate is in place before the data is.
 */
const COST_HEADERS = ['lastPurchaseCost', 'costCurrency'];
const costCells = (): string[] => ['', ''];

export interface ProductExport {
  fileName: string;
  contentType: string;
  /** The file, base64. */
  base64: string;
  rows: number;
}

/**
 * The products of the business as CSV (UTF-8 with a byte order mark, so Excel opens Arabic and Sorani as written) or
 * XLSX. The sale price is the business-wide price of the pack in force now (the first enabled currency that has one);
 * `visibleBranchIds` (the person's branches, or the one chosen) decide which minimum quantities are shown.
 */
export async function exportProducts(
  scoped: ScopedClient,
  ph: PhActor,
  input: ExportInput,
  options: { maxRows?: number; visibleBranchIds?: readonly string[] } = {},
): Promise<ProductExport> {
  const maxRows = options.maxRows ?? PH_EXPORT_MAX_ROWS;
  const where = input.active === 'all' ? {} : { active: input.active === 'active' };
  const count = await scoped.phProduct.count({ where });
  if (count > maxRows) {
    throw new StudioError('INVALID', 'This catalog has too many products for one file', { phCode: 'EXPORT_TOO_LARGE', limit: String(maxRows) });
  }

  const now = new Date();
  const visible = options.visibleBranchIds ?? ph.branchIds;
  const [products, branches, settings, prices, minimums] = await Promise.all([
    scoped.phProduct.findMany({
      where,
      orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tradeName: true,
        genericName: true,
        activeIngredient: true,
        strength: true,
        form: true,
        manufacturer: true,
        rxLevel: true,
        active: true,
        units: { select: { id: true, level: true, label: true, baseQty: true }, orderBy: { level: 'asc' } },
        barcodes: { select: { code: true, unitId: true }, orderBy: { code: 'asc' } },
      },
    }),
    scoped.branch.findMany({ where: { id: { in: [...visible] } }, select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    scoped.phSettings.findFirst({ select: { enabledCurrencies: true } }),
    scoped.phPrice.findMany({
      where: { branchId: null, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
      select: { productId: true, unitId: true, currency: true, amountMinor: true },
    }),
    // A top-level read: the scoped client keeps a branch-limited person to their own branches.
    scoped.phProductBranch.findMany({ where: { branchId: { in: [...visible] } }, select: { productId: true, branchId: true, minQty: true } }),
  ]);

  const currencies = [...new Set([...((settings?.enabledCurrencies ?? ['IQD']) as Currency[]), 'IQD', 'USD'] as Currency[])];
  const priceOf = new Map(prices.map((p) => [`${p.unitId}\n${p.currency}`, p.amountMinor]));
  const minOf = new Map(minimums.map((m) => [`${m.productId}\n${m.branchId}`, m.minQty]));
  const withCost = mayViewCost(ph);

  const headers = [
    'tradeName', 'genericName', 'activeIngredient', 'strength', 'form', 'manufacturer', 'rxLevel',
    'packLabel', 'unitsPerPack', 'barcode', 'otherBarcodes', 'salePrice', 'currency',
    ...(branches.length === 1 ? ['minQty'] : branches.map((b) => `minQty ${b.name}`)),
    'active',
    ...(withCost ? COST_HEADERS : []),
  ];
  const rows = products.map((p) => {
    const top = p.units[p.units.length - 1];
    const packCodes = p.barcodes.filter((b) => b.unitId === top?.id).map((b) => b.code);
    const otherCodes = p.barcodes.map((b) => b.code).filter((code) => code !== packCodes[0]);
    const currency = top ? currencies.find((c) => priceOf.has(`${top.id}\n${c}`)) : undefined;
    const amount = currency && top ? priceOf.get(`${top.id}\n${currency}`)! : null;
    return [
      p.tradeName, p.genericName, p.activeIngredient, p.strength, p.form, p.manufacturer, p.rxLevel,
      top?.label ?? '', top ? String(top.baseQty) : '', packCodes[0] ?? '', otherCodes.join(' '),
      amount !== null && currency ? minorText(amount, currency) : '', amount !== null && currency ? currency : '',
      ...branches.map((b) => {
        const min = minOf.get(`${p.id}\n${b.id}`);
        return min === undefined ? '' : String(min);
      }),
      p.active ? 'yes' : 'no',
      ...(withCost ? costCells() : []),
    ];
  });

  const sheet = [headers, ...rows].map((row) => row.map(escapeCell));
  const body = input.format === 'csv' ? writeCsv(sheet) : await writeXlsx(sheet, 'Products');
  return {
    fileName: `products-${now.toISOString().slice(0, 10)}.${input.format}`,
    contentType: CONTENT_TYPES[input.format],
    base64: Buffer.from(body).toString('base64'),
    rows: rows.length,
  };
}
