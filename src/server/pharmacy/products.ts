import { z } from 'zod';
import type { ScopedClient, ScopedDb, ScopedTx } from '@/server/data/tenant-db';
import { normalizeScan } from '@/server/domain/pharmacy/barcode';
import { canPh } from '@/server/domain/pharmacy/permissions';
import { identityKeyOf, searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { packLabelOf, validateLadder, type LadderCode, type UnitLevel } from '@/server/domain/pharmacy/units';
import { updateWithVersion } from '@/server/studio/framework/concurrency';
import { StudioError } from '@/server/studio/framework/result';
import type { PhActor } from './actor';
import { BARCODE_IN_USE_MESSAGE, barcodeInUse, barcodeRow, heldElsewhere, inUse, syncBarcodes, type SharedCode } from './barcodes';

/**
 * A pharmacy's products: the services behind `ph.products.*`. Each takes the scoped client or transaction of the
 * action or query that calls it and returns plain data; the actions audit and orchestrate. The identity that stops
 * duplicates (`identityKeyOf`) and every row's `restaurantId` come from the server (the product's own business),
 * never from the input.
 */

/** The pharmacy actor and its scoped client of a `ph` definition's context, which the framework always fills. */
export function pharmacyOf(ctx: { ph: PhActor | null; scoped: ScopedClient | null }): { ph: PhActor; scoped: ScopedClient } {
  if (!ctx.ph || !ctx.scoped) throw new Error('A pharmacy definition ran without its pharmacy');
  return { ph: ctx.ph, scoped: ctx.scoped };
}

// Input ---------------------------------------------------------------------------------------------------------------

const TOO_LONG = 'Use at most 200 characters';
const WHOLE = 'Enter a whole number';
const text = z.string().trim().max(200, TOO_LONG).default('');
const count = z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(1_000_000, 'Enter a smaller number');

export const unitLevelInput = z.object({
  level: z.number(WHOLE).int(WHOLE).min(0, 'Use 0 or more').max(9, 'Enter a smaller number'),
  // An empty label is the ladder's own refusal (EMPTY_LABEL), with the other ladder codes.
  label: z.string().trim().max(40, 'Use at most 40 characters'),
  baseQty: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(1_000_000, 'Enter a smaller number'),
  sellable: z.boolean().default(true),
});

const barcodeInput = z.object({
  code: z.string().max(48, 'Use at most 48 characters'),
  level: z.number(WHOLE).int(WHOLE),
  shared: z.boolean().optional(),
});

const branchSettingInput = z.object({
  branchId: z.string().min(1).max(64),
  minQty: count,
  reorderQty: count,
});

/** What the person enters for a product: its identity, how it is packed, its barcodes and its stock levels per branch. */
export const productInput = z.object({
  tradeName: z.string().trim().min(1, 'Enter the trade name').max(200, TOO_LONG),
  genericName: text,
  activeIngredient: text,
  strength: text,
  form: text,
  manufacturer: text,
  rxLevel: z.enum(['OTC', 'RX', 'RESTRICTED']).default('OTC'),
  levels: z.array(unitLevelInput).max(10, 'Use at most 10 units'),
  barcodes: z.array(barcodeInput).max(50, 'Use at most 50 barcodes').default([]),
  branchSettings: z.array(branchSettingInput).max(100, 'Use at most 100 branches').default([]),
});
export type ProductInput = z.infer<typeof productInput>;

/** The product list's paging and filter: archived products are hidden unless asked for. */
export const productListInput = z.object({
  active: z.enum(['active', 'archived', 'all']).default('active'),
  cursor: z.string().min(1).max(64).nullish(),
  pageSize: z.number(WHOLE).int(WHOLE).min(1, 'Use 1 or more').max(100, 'Enter a smaller number').default(50),
});

// Rules ---------------------------------------------------------------------------------------------------------------

const LADDER_MESSAGES: Record<LadderCode, string> = {
  NO_BASE: 'Start the units with the base unit at level 0',
  BASE_NOT_ONE: 'The base unit holds exactly 1',
  NOT_ASCENDING: 'Each unit must hold more than the one below it',
  NOT_A_MULTIPLE: 'Each unit must hold a whole number of the one below it',
  NONE_SELLABLE: 'Make at least one unit sellable',
  DUPLICATE_LEVEL: 'Each unit level may appear once',
  EMPTY_LABEL: 'Name every unit',
};

const invalid = (field: string, message: string, extra: Record<string, string> = {}) =>
  new StudioError('INVALID', undefined, { [field]: message, ...extra });

export { packLabelOf };

/**
 * The input checked beyond its shape: the ladder (`validateLadder`, refused on `levels` with its code in `phCode`),
 * every barcode on a level of it and entered once, every branch once. Returns the ladder from the base up and the
 * barcodes as stored text.
 */
export function checkProduct(input: ProductInput): { levels: UnitLevel[]; barcodes: ProductInput['barcodes'] } {
  const levels = [...input.levels].sort((a, b) => a.level - b.level);
  const verdict = validateLadder(levels);
  if (!verdict.ok) throw invalid('levels', LADDER_MESSAGES[verdict.code], { phCode: verdict.code });

  const seen = new Set<string>();
  const barcodes = input.barcodes.map((b, i) => {
    const code = normalizeScan(b.code);
    if (code === '') throw invalid(`barcodes.${i}.code`, 'Enter a barcode');
    if (!levels.some((l) => l.level === b.level)) throw invalid(`barcodes.${i}.level`, 'Choose one of the product’s units for this barcode');
    if (seen.has(code)) throw invalid(`barcodes.${i}.code`, 'Each barcode may appear once');
    seen.add(code);
    return { ...b, code };
  });

  const branches = new Set<string>();
  input.branchSettings.forEach((s, i) => {
    if (branches.has(s.branchId)) throw invalid(`branchSettings.${i}.branchId`, 'Each branch may appear once');
    branches.add(s.branchId);
  });
  return { levels, barcodes };
}

/** A person writes stock levels only for branches they work in (the owner: every branch of the business). */
export function assertBranchSettings(ph: PhActor, settings: ProductInput['branchSettings']): void {
  if (settings.some((s) => !ph.branchIds.includes(s.branchId))) throw new StudioError('FORBIDDEN');
}

/** The key that makes a product the same as another: trade name, strength, form, manufacturer and pack. */
export function identityOf(input: Pick<ProductInput, 'tradeName' | 'strength' | 'form' | 'manufacturer'>, levels: readonly UnitLevel[]): string {
  return identityKeyOf({ ...input, packLabel: packLabelOf(levels) });
}

export const DUPLICATE_PRODUCT_MESSAGE = 'This product is already in the catalog';

const duplicateOf = (found: { id: string; tradeName: string }) =>
  new StudioError('CONFLICT', DUPLICATE_PRODUCT_MESSAGE, { phCode: 'DUPLICATE_PRODUCT', productId: found.id, productName: found.tradeName });

async function findDuplicate(scoped: ScopedDb, identityKey: string, exceptId?: string) {
  return scoped.phProduct.findFirst({
    where: { identityKey, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, tradeName: true },
  });
}

/**
 * For a write that lost a race (`P2002` from the database, after the checks in the transaction found nothing): the
 * unique identity, as `DUPLICATE_PRODUCT` naming the product that won, or a barcode that is not shared
 * ("PhBarcode_one_unshared_code"), as `BARCODE_IN_USE` naming its holder. Which one is found by reading again, not from
 * the error's metadata. Any other error is returned as it is. `exceptId` is the product being updated.
 */
export async function asLostRace(scoped: ScopedClient, error: unknown, input: ProductInput, exceptId?: string): Promise<unknown> {
  if ((error as { code?: unknown } | null)?.code !== 'P2002') return error;
  const levels = [...input.levels].sort((a, b) => a.level - b.level);
  const found = await findDuplicate(scoped, identityOf(input, levels), exceptId);
  if (found) return duplicateOf(found);
  const codes = input.barcodes.map((b, index) => ({ index, code: normalizeScan(b.code), shared: b.shared === true }));
  return (await barcodeInUse(scoped, codes, exceptId)) ?? error;
}

// Phase 2 guards ------------------------------------------------------------------------------------------------------

/**
 * The models that hold stock or sales of a unit (batches, sale lines). None exist before Phase 2, so the guards below
 * find nothing; `tests/pharmacy/products.test.ts` fails when a Ph model appears that is neither a known catalog model nor
 * listed here, and a model listed here makes the guards fail closed until they read it.
 */
export const PH_STOCK_RECORD_MODELS: readonly string[] = [];

function stockGuardUnwired(): never {
  throw new Error(`The product stock guard does not read ${PH_STOCK_RECORD_MODELS.join(', ')} yet`);
}

/** The units of `unitIds` that a batch or sale names. */
async function unitsWithStock(_tx: ScopedTx, unitIds: readonly string[]): Promise<string[]> {
  if (unitIds.length === 0) return [];
  if (PH_STOCK_RECORD_MODELS.length > 0) stockGuardUnwired();
  return [];
}

/** The products of `productIds` that an open record (an open batch, a held sale) names, so they may not be archived. */
async function productsWithOpenRecords(_tx: ScopedTx, productIds: readonly string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  if (PH_STOCK_RECORD_MODELS.length > 0) stockGuardUnwired();
  return [];
}

// Writes --------------------------------------------------------------------------------------------------------------

const FIELDS = ['tradeName', 'genericName', 'activeIngredient', 'strength', 'form', 'manufacturer', 'rxLevel'] as const;
type Fields = Pick<ProductInput, (typeof FIELDS)[number]>;
const fieldsOf = (input: Fields): Fields => Object.fromEntries(FIELDS.map((f) => [f, input[f]])) as Fields;

export type Changes = Record<string, { before: unknown; after: unknown }>;

/** What a product write did, for the action to audit and answer with. */
export interface ProductWrite {
  id: string;
  version: number;
  changes: Changes;
  shared: SharedCode[];
}

// Row builders: the single save and the list form (`createProducts`) both write through these, so the rows they store
// cannot drift apart.

/** A product row: its fields, the identity that stops duplicates and the text the search reads. */
function productRow(restaurantId: string, input: ProductInput, identityKey: string) {
  return { restaurantId, ...fieldsOf(input), identityKey, searchText: searchTextOf(input) };
}

/** A unit row of a product. */
function unitRow(restaurantId: string, productId: string, l: UnitLevel) {
  return { restaurantId, productId, level: l.level, label: l.label, baseQty: l.baseQty, sellable: l.sellable };
}

/** A branch's minimum and reorder quantities of a product. */
function branchSettingRow(restaurantId: string, productId: string, s: ProductInput['branchSettings'][number]) {
  return { restaurantId, branchId: s.branchId, productId, minQty: s.minQty, reorderQty: s.reorderQty };
}

const ladderText = (levels: readonly Pick<UnitLevel, 'level' | 'label' | 'baseQty' | 'sellable'>[]) =>
  [...levels].sort((a, b) => a.level - b.level).map((l) => `${l.level}:${l.label}:${l.baseQty}${l.sellable ? '' : ':not sold'}`);

async function writeBranchSettings(tx: ScopedTx, product: { id: string; restaurantId: string }, settings: ProductInput['branchSettings']) {
  for (const s of settings) {
    await tx.phProductBranch.upsert({
      where: { branchId_productId: { branchId: s.branchId, productId: product.id } },
      create: branchSettingRow(product.restaurantId, product.id, s),
      update: { minQty: s.minQty, reorderQty: s.reorderQty },
      select: { id: true },
    });
  }
}

/** Creates the product, its units, barcodes and branch settings on `tx`. Branch settings must be checked first. */
export async function createProduct(tx: ScopedTx, restaurantId: string, input: ProductInput): Promise<ProductWrite> {
  const { levels, barcodes } = checkProduct(input);
  const identityKey = identityOf(input, levels);
  const duplicate = await findDuplicate(tx, identityKey);
  if (duplicate) throw duplicateOf(duplicate);

  const product = await tx.phProduct.create({
    data: productRow(restaurantId, input, identityKey),
    select: { id: true, restaurantId: true, version: true },
  });
  const unitIdByLevel = new Map<number, string>();
  for (const l of levels) {
    const unit = await tx.phProductUnit.create({ data: unitRow(product.restaurantId, product.id, l), select: { id: true } });
    unitIdByLevel.set(l.level, unit.id);
  }
  const synced = await syncBarcodes(tx, product, unitIdByLevel, barcodes);
  await writeBranchSettings(tx, product, input.branchSettings);

  const changes: Changes = Object.fromEntries(FIELDS.map((f) => [f, { before: null, after: input[f] }]));
  changes.units = { before: null, after: ladderText(levels) };
  if (synced.codes.length > 0) changes.barcodes = { before: null, after: synced.codes };
  if (input.branchSettings.length > 0) changes.branchSettings = { before: null, after: input.branchSettings };
  return { id: product.id, version: product.version, changes, shared: synced.shared };
}

/** A refusal of one entry of a list written together (`createProducts`, `setFirstPrices`): `index` is its position. */
export class ListEntryError extends Error {
  constructor(
    readonly index: number,
    readonly refusal: unknown,
  ) {
    super(`List entry ${index} was refused`);
    this.name = 'ListEntryError';
  }
}

/** How many products `createProducts` writes per statement. */
const LIST_CHUNK = 1_000;

/**
 * Creates many new products (a catalog import) in a few statements per thousand, with `createProduct`'s checks and
 * exactly its rows: each entry passes `checkProduct`, its identity is `identityOf` and its search text `searchTextOf`; an
 * entry already in the catalog (or written by an earlier chunk) is `DUPLICATE_PRODUCT` naming it, and a barcode another
 * product holds is `BARCODE_IN_USE` naming the holder. An entry the same as an earlier entry, or with an earlier entry's
 * barcode, is refused the same way, without a holder (it does not exist yet). The first refusal by position is thrown
 * as a `ListEntryError`, before anything of that chunk is written. Barcodes are never shared here: sharing is the single
 * save's, with its audit line. Branch settings must be checked first, as for `createProduct`. A test in
 * tests/pharmacy/imports.test.ts compares the rows of both paths.
 */
export async function createProducts(
  tx: ScopedTx,
  restaurantId: string,
  inputs: readonly ProductInput[],
): Promise<{ id: string; unitIds: Record<number, string> }[]> {
  const written: { id: string; unitIds: Record<number, string> }[] = [];
  for (let at = 0; at < inputs.length; at += LIST_CHUNK) written.push(...(await createChunk(tx, restaurantId, inputs.slice(at, at + LIST_CHUNK), at)));
  return written;
}

async function createChunk(tx: ScopedTx, restaurantId: string, inputs: readonly ProductInput[], offset: number) {
  // Per entry, the first refusal in the order the single save meets them: the input, the identity, the barcodes.
  const refusals = new Map<number, unknown>();
  const note = (index: number, refusal: unknown) => {
    if (!refusals.has(index)) refusals.set(index, refusal);
  };
  const checked = inputs.map((input, index) => {
    if (input.barcodes.some((b) => b.shared === true)) throw new Error('A list of products is created without shared barcodes');
    try {
      const { levels, barcodes } = checkProduct(input);
      return { input, levels, barcodes, identityKey: identityOf(input, levels) };
    } catch (error) {
      note(index, error);
      return null;
    }
  });

  const firstOfKey = new Map<string, number>();
  checked.forEach((entry, index) => {
    if (!entry) return;
    if (firstOfKey.has(entry.identityKey)) note(index, new StudioError('CONFLICT', DUPLICATE_PRODUCT_MESSAGE, { phCode: 'DUPLICATE_PRODUCT' }));
    else firstOfKey.set(entry.identityKey, index);
  });
  const found = firstOfKey.size === 0 ? [] : await tx.phProduct.findMany({ where: { identityKey: { in: [...firstOfKey.keys()] } }, select: { id: true, tradeName: true, identityKey: true } });
  const foundByKey = new Map(found.map((row) => [row.identityKey, row]));
  checked.forEach((entry, index) => {
    const duplicate = entry && foundByKey.get(entry.identityKey);
    if (duplicate) note(index, duplicateOf(duplicate));
  });

  const held = await heldElsewhere(tx, checked.flatMap((entry) => entry?.barcodes.map((b) => b.code) ?? []));
  const holderOf = new Map<string, (typeof held)[number]>();
  for (const row of held) if (!holderOf.has(row.code)) holderOf.set(row.code, row);
  const firstOfCode = new Map<string, number>();
  checked.forEach((entry, index) => {
    entry?.barcodes.forEach((b, position) => {
      const holder = holderOf.get(b.code);
      if (holder) note(index, inUse(position, holder));
      else if (firstOfCode.has(b.code)) {
        note(index, new StudioError('CONFLICT', BARCODE_IN_USE_MESSAGE, { phCode: 'BARCODE_IN_USE', [`barcodes.${position}.code`]: BARCODE_IN_USE_MESSAGE }));
      } else firstOfCode.set(b.code, index);
    });
  });
  if (refusals.size > 0) {
    const first = Math.min(...refusals.keys());
    throw new ListEntryError(offset + first, refusals.get(first));
  }

  const entries = checked as NonNullable<(typeof checked)[number]>[];
  const products = await tx.phProduct.createManyAndReturn({
    data: entries.map((e) => productRow(restaurantId, e.input, e.identityKey)),
    select: { id: true, identityKey: true },
  });
  // Matched by identity (unique in the chunk), not by the order the database returns the rows in.
  const idOf = new Map(products.map((p) => [p.identityKey, p.id]));
  const units = await tx.phProductUnit.createManyAndReturn({
    data: entries.flatMap((e) => e.levels.map((l) => unitRow(restaurantId, idOf.get(e.identityKey)!, l))),
    select: { id: true, productId: true, level: true },
  });
  const unitOf = new Map(units.map((u) => [`${u.productId}\n${u.level}`, u.id]));
  const codes = entries.flatMap((e) =>
    e.barcodes.map((b) => {
      const productId = idOf.get(e.identityKey)!;
      return barcodeRow(restaurantId, productId, unitOf.get(`${productId}\n${b.level}`)!, b.code, false);
    }),
  );
  if (codes.length > 0) await tx.phBarcode.createMany({ data: codes });
  const settings = entries.flatMap((e) => e.input.branchSettings.map((s) => branchSettingRow(restaurantId, idOf.get(e.identityKey)!, s)));
  if (settings.length > 0) await tx.phProductBranch.createMany({ data: settings });

  return entries.map((e) => {
    const id = idOf.get(e.identityKey)!;
    return { id, unitIds: Object.fromEntries(e.levels.map((l) => [l.level, unitOf.get(`${id}\n${l.level}`)!])) };
  });
}

/**
 * Saves the product if it is still at `expectedVersion` (`updateWithVersion`: `CONFLICT` naming who changed it). Units
 * are matched by level: a new level is added, a level no longer listed is removed, and a unit whose size changes or that
 * is removed must have no stock or sales (and a removed one no prices). Barcodes become exactly the ones entered; branch
 * settings are written for the branches listed and left as they are elsewhere.
 */
export async function updateProduct(tx: ScopedTx, productId: string, expectedVersion: number, input: ProductInput): Promise<ProductWrite> {
  const { levels, barcodes } = checkProduct(input);
  const current = await tx.phProduct.findFirst({
    where: { id: productId },
    select: {
      id: true,
      restaurantId: true,
      ...Object.fromEntries(FIELDS.map((f) => [f, true])),
      units: { select: { id: true, level: true, label: true, baseQty: true, sellable: true } },
      barcodes: { select: { code: true } },
    },
  });
  if (!current) throw new StudioError('NOT_FOUND');
  const identityKey = identityOf(input, levels);
  const duplicate = await findDuplicate(tx, identityKey, productId);
  if (duplicate) throw duplicateOf(duplicate);

  await updateWithVersion(tx.phProduct, { id: productId, version: expectedVersion, data: { ...fieldsOf(input), identityKey, searchText: searchTextOf(input) }, entityType: 'PhProduct' }, tx);

  const removed = current.units.filter((u) => !levels.some((l) => l.level === u.level));
  const resized = current.units.filter((u) => levels.some((l) => l.level === u.level && l.baseQty !== u.baseQty));
  if ((await unitsWithStock(tx, resized.map((u) => u.id))).length > 0) {
    throw new StudioError('CONFLICT', 'This unit has stock or sales, so its size cannot change', { phCode: 'UNIT_IN_USE' });
  }
  const removedIds = removed.map((u) => u.id);
  const priced = removedIds.length === 0 ? 0 : await tx.phPrice.count({ where: { unitId: { in: removedIds } } });
  if (priced > 0 || (await unitsWithStock(tx, removedIds)).length > 0) {
    throw new StudioError('CONFLICT', 'This unit has prices, stock or sales, so it cannot be removed', { phCode: 'UNIT_IN_USE' });
  }
  if (removedIds.length > 0) await tx.phProductUnit.deleteMany({ where: { id: { in: removedIds } } });

  const unitIdByLevel = new Map<number, string>();
  for (const l of levels) {
    const unit = current.units.find((u) => u.level === l.level);
    if (!unit) {
      const created = await tx.phProductUnit.create({ data: unitRow(current.restaurantId, productId, l), select: { id: true } });
      unitIdByLevel.set(l.level, created.id);
      continue;
    }
    if (unit.label !== l.label || unit.baseQty !== l.baseQty || unit.sellable !== l.sellable) {
      await tx.phProductUnit.updateMany({ where: { id: unit.id }, data: { label: l.label, baseQty: l.baseQty, sellable: l.sellable } });
    }
    unitIdByLevel.set(l.level, unit.id);
  }
  const before = await tx.phProductBranch.findMany({
    where: { productId, branchId: { in: input.branchSettings.map((s) => s.branchId) } },
    select: { branchId: true, minQty: true, reorderQty: true },
  });
  const synced = await syncBarcodes(tx, { id: productId, restaurantId: current.restaurantId }, unitIdByLevel, barcodes);
  await writeBranchSettings(tx, { id: productId, restaurantId: current.restaurantId }, input.branchSettings);

  const changes: Changes = {};
  const was = current as unknown as Record<string, unknown>;
  for (const f of FIELDS) if (was[f] !== input[f]) changes[f] = { before: was[f], after: input[f] };
  const [ladderBefore, ladderAfter] = [ladderText(current.units), ladderText(levels)];
  if (ladderBefore.join('|') !== ladderAfter.join('|')) changes.units = { before: ladderBefore, after: ladderAfter };
  const codesBefore = [...new Set(current.barcodes.map((b) => b.code))].sort();
  if (codesBefore.join('|') !== synced.codes.join('|')) changes.barcodes = { before: codesBefore, after: synced.codes };
  if (input.branchSettings.length > 0) changes.branchSettings = { before, after: input.branchSettings };
  return { id: productId, version: expectedVersion + 1, changes, shared: synced.shared };
}

/** Archives the product (it stays, inactive, out of the default list and the till) unless an open record names it. */
export async function archiveProduct(
  tx: ScopedTx,
  productId: string,
  expectedVersion: number,
): Promise<{ id: string; version: number; changed: boolean }> {
  const current = await tx.phProduct.findFirst({ where: { id: productId }, select: { id: true, active: true, version: true } });
  if (!current) throw new StudioError('NOT_FOUND');
  if ((await productsWithOpenRecords(tx, [productId])).length > 0) {
    throw new StudioError('CONFLICT', 'This product is on open records, so it cannot be archived', { phCode: 'PRODUCT_IN_USE' });
  }
  if (!current.active && current.version === expectedVersion) return { id: productId, version: current.version, changed: false };
  await updateWithVersion(tx.phProduct, { id: productId, version: expectedVersion, data: { active: false }, entityType: 'PhProduct' }, tx);
  return { id: productId, version: expectedVersion + 1, changed: true };
}

// Reads ---------------------------------------------------------------------------------------------------------------

/** Whether the actor may see what products cost: a role with `cost.view`. A support actor holds no role, so never. */
export function mayViewCost(ph: PhActor): boolean {
  return ph.role !== null && canPh(ph.role, 'cost.view');
}

/**
 * A product's cost, shown only to a role with `cost.view` (the key is absent otherwise). Empty until purchases record
 * costs (Phase 2); later fields join this object.
 */
export interface ProductCost {
  lastPurchaseMinor: string | null;
  currency: 'IQD' | 'USD' | null;
}

const NO_COST: ProductCost = { lastPurchaseMinor: null, currency: null };

export interface ProductUnitView {
  id: string;
  level: number;
  label: string;
  baseQty: number;
  sellable: boolean;
}

export interface ProductSummary {
  id: string;
  tradeName: string;
  genericName: string;
  activeIngredient: string;
  strength: string;
  form: string;
  manufacturer: string;
  rxLevel: 'OTC' | 'RX' | 'RESTRICTED';
  active: boolean;
  version: number;
  packLabel: string;
  units: ProductUnitView[];
  cost?: ProductCost;
}

export interface ProductDetail extends ProductSummary {
  barcodes: { code: string; level: number; shared: boolean }[];
  /** The stock levels of the branches the actor works in. */
  branchSettings: { branchId: string; minQty: number; reorderQty: number }[];
}

const SUMMARY = {
  id: true,
  ...Object.fromEntries(FIELDS.map((f) => [f, true])),
  active: true,
  version: true,
  units: { select: { id: true, level: true, label: true, baseQty: true, sellable: true }, orderBy: { level: 'asc' } },
} as const;

type SummaryRow = Omit<ProductSummary, 'packLabel' | 'cost'>;

const summaryOf = (row: SummaryRow, withCost: boolean): ProductSummary => ({
  ...row,
  packLabel: packLabelOf(row.units),
  ...(withCost ? { cost: { ...NO_COST } } : {}),
});

/** One product of the business, with its barcodes and the stock levels of the actor's branches. */
export async function getProduct(scoped: ScopedClient, productId: string, withCost: boolean): Promise<ProductDetail> {
  const row = (await scoped.phProduct.findFirst({
    where: { id: productId },
    select: { ...SUMMARY, barcodes: { select: { code: true, shared: true, unit: { select: { level: true } } }, orderBy: { code: 'asc' } } },
  })) as (SummaryRow & { barcodes: { code: string; shared: boolean; unit: { level: number } }[] }) | null;
  if (!row) throw new StudioError('NOT_FOUND');
  // A top-level read, so the client keeps a branch-limited actor to their own branches.
  const settings = await scoped.phProductBranch.findMany({
    where: { productId },
    select: { branchId: true, minQty: true, reorderQty: true },
    orderBy: { branchId: 'asc' },
  });
  const { barcodes, ...summary } = row;
  return {
    ...summaryOf(summary, withCost),
    barcodes: barcodes.map((b) => ({ code: b.code, level: b.unit.level, shared: b.shared })),
    branchSettings: settings,
  };
}

/** A page of the catalog by trade name; `nextCursor` continues it (null on the last page). */
export async function listProducts(
  scoped: ScopedClient,
  input: z.infer<typeof productListInput>,
  withCost: boolean,
): Promise<{ items: ProductSummary[]; nextCursor: string | null }> {
  const rows = (await scoped.phProduct.findMany({
    where: input.active === 'all' ? {} : { active: input.active === 'active' },
    select: SUMMARY,
    orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
    take: input.pageSize + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  })) as SummaryRow[];
  const more = rows.length > input.pageSize;
  const page = more ? rows.slice(0, input.pageSize) : rows;
  return { items: page.map((row) => summaryOf(row, withCost)), nextCursor: more ? page[page.length - 1]!.id : null };
}
