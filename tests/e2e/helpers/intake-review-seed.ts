import { createHash, randomUUID } from 'node:crypto';
import { createPrisma } from '@/server/data/prisma';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { matchRows } from '@/server/pharmacy/intake/review';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';

/**
 * Seeding for the invoice review suite (phase 5, task 9): one pharmacy with two branches, products that have a sellable unit
 * (the product picker only offers those), staff, and batches written straight to the development database so a test can start
 * from a known state (a clean batch, a 200-line batch) without reading a picture first. Everything is removed with the
 * pharmacy.
 */

export const DAY = 86_400_000;
export const db = () => createPrisma(databaseUrl(DEV_DB));

export interface TestPharmacy {
  id: string;
  name: string;
  branchIds: string[];
}

export async function makePharmacy(label: string): Promise<TestPharmacy> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branchIds: string[] = [];
    for (const [i, branch] of ['Main street', 'Airport road'].entries()) {
      const created = await client.branch.create({ data: { restaurantId: row.id, name: `${branch} ${label}`, sortOrder: i }, select: { id: true } });
      branchIds.push(created.id);
    }
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    return { id: row.id, name, branchIds };
  } finally {
    await client.$disconnect();
  }
}

/** The subscription ended `endedDaysAgo` days ago (more than the 7 grace days reads as read-only); a negative number reopens it. */
export async function endSubscription(shop: TestPharmacy, endedDaysAgo: number): Promise<void> {
  const client = db();
  try {
    await client.subscription.updateMany({ where: { restaurantId: shop.id }, data: { currentPeriodEnd: new Date(Date.now() - endedDaysAgo * DAY) } });
  } finally {
    await client.$disconnect();
  }
}

export async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER' | 'STOCK' | 'ACCOUNTANT'): Promise<void> {
  const client = db();
  try {
    const branches = await client.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    for (const branch of branches) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch.id } });
  } finally {
    await client.$disconnect();
  }
}

export async function makeSupplier(shop: TestPharmacy, userId: string): Promise<{ id: string; name: string }> {
  const client = db();
  try {
    const name = `Al Noor ${randomUUID().slice(0, 5)}`;
    const row = await client.phSupplier.create({ data: { restaurantId: shop.id, name, nameKey: name.toLowerCase(), defaultCurrency: 'IQD', termsDays: 30, clientKey: `e2e-${randomUUID()}`, createdById: userId }, select: { id: true } });
    return { id: row.id, name };
  } finally {
    await client.$disconnect();
  }
}

export interface SeededProduct {
  id: string;
  name: string;
  /** The unit a line is received in (its biggest, sellable). */
  unitId: string;
}

/** A product with a tablet / strip / box ladder, every unit sellable, and (when given) a barcode on its box. */
export async function makeProduct(shop: TestPharmacy, input: { name: string; strength?: string; form?: string; barcode?: string }): Promise<SeededProduct> {
  const client = db();
  try {
    const strength = input.strength ?? '';
    const form = input.form ?? 'tablet';
    const product = await client.phProduct.create({
      data: {
        restaurantId: shop.id,
        tradeName: input.name,
        strength,
        form,
        identityKey: `${input.name}|${strength}|${form}|${shop.id}`,
        searchText: searchTextOf({ tradeName: input.name, genericName: '', activeIngredient: '', strength, form, manufacturer: '' }),
      },
      select: { id: true },
    });
    let top = '';
    for (const [level, label, baseQty] of [
      [0, 'tablet', 1],
      [1, 'strip', 10],
      [2, 'box', 30],
    ] as const) {
      const unit = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level, label, baseQty, sellable: true }, select: { id: true } });
      top = unit.id;
    }
    if (input.barcode) await client.phBarcode.create({ data: { restaurantId: shop.id, productId: product.id, unitId: top, code: input.barcode } });
    return { id: product.id, name: input.name, unitId: top };
  } finally {
    await client.$disconnect();
  }
}

export interface SeedLine {
  name: string | null;
  strength?: string | null;
  form?: string | null;
  pack?: string | null;
  quantity: number | null;
  bonus?: number | null;
  unitCost: number | null;
  lineTotal: number | null;
  lot?: string | null;
  expiry?: string | null;
  barcodeText?: string | null;
  unclear?: string[];
  match?: SeededProduct;
}

/** A line the way the model's answer is stored on a row. */
const extractedOf = (l: SeedLine) => ({
  name: l.name,
  strength: l.strength ?? null,
  form: l.form ?? null,
  pack: l.pack ?? null,
  quantity: l.quantity,
  bonus: l.bonus ?? 0,
  unitCost: l.unitCost,
  lineTotal: l.lineTotal,
  lot: l.lot ?? null,
  expiry: l.expiry ?? null,
  barcodeText: l.barcodeText ?? null,
  unclear: l.unclear ?? [],
  page: 1,
});

/**
 * An open batch holding one read file and these lines (a line with `match` is already chosen for that product; the others are matched by the server as after a reading), written
 * directly (no stored picture). Returns its address.
 */
export async function seedBatch(
  shop: TestPharmacy,
  input: { userId: string; branch?: number; supplier?: { id: string; name: string } | null; invoiceNumber: string | null; currency?: 'IQD' | 'USD'; total: number | null; lines: SeedLine[] },
): Promise<{ batchId: string; fileId: string; path: string }> {
  const client = db();
  try {
    const batch = await client.phIntakeBatch.create({
      data: {
        restaurantId: shop.id,
        branchId: shop.branchIds[input.branch ?? 0]!,
        clientKey: `seed-${randomUUID()}`,
        payloadHash: 'seed',
        createdById: input.userId,
        supplierId: input.supplier?.id ?? null,
        header: { extracted: { supplierName: input.supplier?.name ?? null, invoiceNumber: input.invoiceNumber, invoiceDate: '2026-10-20', currency: input.currency ?? 'IQD', total: input.total } },
      },
      select: { id: true },
    });
    const file = await client.phIntakeFile.create({
      data: {
        restaurantId: shop.id,
        batchId: batch.id,
        sha256: createHash('sha256').update(`seed-${batch.id}`).digest('hex'),
        storageKey: null,
        mediaType: 'image/png',
        bytes: 1234,
        pages: 1,
        status: 'EXTRACTED',
        uploadedById: input.userId,
        extractedAt: new Date(),
        attempts: 1,
        expiresAt: new Date(Date.now() + 30 * DAY),
      },
      select: { id: true },
    });
    for (const [i, line] of input.lines.entries()) {
      await client.phIntakeRow.create({
        data: {
          restaurantId: shop.id,
          fileId: file.id,
          lineNo: i + 1,
          page: 1,
          extracted: extractedOf(line),
          ...(line.match ? { matchedProductId: line.match.id, matchedUnitId: line.match.unitId, matchState: 'CHOSEN' as const } : {}),
        },
      });
    }
    await matchRows(client, { restaurantId: shop.id }, batch.id);
    return { batchId: batch.id, fileId: file.id, path: `/pharmacy/purchasing/intake/${batch.id}` };
  } finally {
    await client.$disconnect();
  }
}

/** The lines of a batch that has nothing to question: complete, matched, with the printed total equal to their sum. */
export function cleanLines(products: SeededProduct[]): { lines: SeedLine[]; total: number } {
  const lines = products.map((p, i): SeedLine => ({ name: p.name, strength: '500 mg', form: 'tablet', quantity: 10 + i, unitCost: 1000, lineTotal: (10 + i) * 1000, lot: `L${i + 1}`, expiry: '2027-03', match: p }));
  return { lines, total: lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0) };
}

/** 200 lines with long names (Latin and Arabic), a few with nothing read, to look at the screen with the most it must carry. */
export function bigLines(count = 200): SeedLine[] {
  const long = 'Amoxicillin and clavulanate potassium film coated tablets for oral suspension 875 mg/125 mg';
  const arabic = 'أموكسيسيلين مع حمض الكلافولانيك أقراص مغلفة بالفيلم للتعليق الفموي بتركيز عالٍ جداً';
  return Array.from({ length: count }, (_, i): SeedLine => {
    if (i % 40 === 7) return { name: null, quantity: null, unitCost: null, lineTotal: null, unclear: ['the whole line'] };
    return { name: i % 3 === 0 ? long : i % 3 === 1 ? arabic : `Item ${i + 1}`, strength: '500 mg', form: 'tablet', quantity: 1 + (i % 9), unitCost: 500, lineTotal: (1 + (i % 9)) * 500, lot: `B${i + 1}`, expiry: '2027-05' };
  });
}

/** What a batch's lines became after approval. */
export async function receiptOf(batchId: string): Promise<{ receiptId: string | null; status: string | null; movements: number }> {
  const client = db();
  try {
    const batch = await client.phIntakeBatch.findUnique({ where: { id: batchId }, select: { status: true, receiptId: true, restaurantId: true } });
    const receiptId = batch?.receiptId ?? null;
    if (!receiptId || !batch) return { receiptId, status: null, movements: 0 };
    const receipt = await client.phReceipt.findUnique({ where: { id: receiptId }, select: { status: true } });
    const movements = await client.phStockMovement.count({ where: { restaurantId: batch.restaurantId } });
    return { receiptId, status: receipt?.status ?? null, movements };
  } finally {
    await client.$disconnect();
  }
}

/** How many stock movements the pharmacy has: approving a batch must not change it. */
export async function movementCount(restaurantId: string): Promise<number> {
  const client = db();
  try {
    return await client.phStockMovement.count({ where: { restaurantId } });
  } finally {
    await client.$disconnect();
  }
}
