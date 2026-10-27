import type { PrismaClient } from '@/generated/prisma/client';
import { identityKeyOf, searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { createId } from '@/server/studio/framework/ids';
import { databaseTarget } from '../../scripts/database-target';
import { LOOPBACK_HOSTS } from './local-database';

/**
 * The pharmacy load seed: 50,000 products across two businesses (25,000 each), with a tablet and a box unit, a barcode
 * on the box and a business-wide box price (every seventh product also a branch price), for timing the central search
 * (`tests/load/pharmacy-search.load.ts`). One product in five has an Arabic trade name with Arabic-Indic digits in its
 * strength. It is for measuring: names are made of syllables, not real brands, though the active ingredients are real.
 *
 * It writes only to the private database of the pharmacy worktree (127.0.0.1:54381) and refuses anything else before
 * it connects. It replaces what an earlier run made (the businesses named `Load Pharmacy …`), so it can run again.
 */

export const PRIVATE_DB_PORT = '54381';
export const LOAD_PHARMACY_PREFIX = 'Load Pharmacy';
export const LOAD_PHARMACY_PER_BUSINESS = 25_000;

const BATCH = 5_000;
const LATIN = ['pa', 'na', 'dol', 'bru', 'fen', 'amo', 'xi', 'lin', 'zi', 'tro', 'ma', 'cin', 'lo', 'ra', 'ta', 'vex', 'cor', 'neo', 'pra', 'zol'];
const ARABIC = ['با', 'نا', 'دول', 'برو', 'فين', 'امو', 'كسي', 'لين', 'زي', 'ترو', 'ما', 'سين', 'لو', 'را', 'تا', 'فيكس', 'كور', 'نيو', 'برا', 'زول'];
export const LOAD_INGREDIENTS = [
  'Paracetamol', 'Ibuprofen', 'Amoxicillin', 'Azithromycin', 'Omeprazole', 'Metformin', 'Atorvastatin', 'Amlodipine',
  'Losartan', 'Cetirizine', 'Loratadine', 'Salbutamol', 'Prednisolone', 'Diclofenac', 'Ciprofloxacin', 'Metronidazole',
  'Clarithromycin', 'Pantoprazole', 'Esomeprazole', 'Simvastatin', 'Aspirin', 'Clopidogrel', 'Levothyroxine',
  'Montelukast', 'Domperidone', 'Fluconazole', 'Cholecalciferol', 'Folic acid', 'Ferrous sulfate', 'Loperamide',
];
const STRENGTHS = [100, 250, 500, 1000];
const FORMS = ['tablet', 'capsule', 'syrup', 'cream', 'injection'];
const MANUFACTURERS = ['GSK', 'Pfizer', 'Julphar', 'Hikma', 'Pioneer', 'Spimaco', 'Sanofi'];
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]!);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Throws unless `url` connects to the private database on this machine (127.0.0.1:54381). */
export function assertPrivateDatabase(url: string | undefined): void {
  const target = url ? databaseTarget(url) : null;
  if (!target || !LOOPBACK_HOSTS.includes(target.host) || target.port !== PRIVATE_DB_PORT) {
    throw new Error(`The pharmacy load seed writes only to the private database on 127.0.0.1:${PRIVATE_DB_PORT}; refusing to run.`);
  }
}

/** What the seed made of one product, for the load test to build its queries from. */
export interface LoadPharmacyProduct {
  productId: string;
  tradeName: string;
  arabic: boolean;
  activeIngredient: string;
  barcode: string;
}

export interface LoadPharmacyBusiness {
  id: string;
  branchId: string;
  products: LoadPharmacyProduct[];
}

/** The `n`th product's fields in business `b` (0 or 1): deterministic, so two runs make the same catalog. */
function productOf(b: number, n: number) {
  const k = n % 8000;
  const syllables = [k % 20, Math.floor(k / 20) % 20, Math.floor(k / 400) % 20];
  const arabic = n % 5 === 0;
  const variant = Math.floor(n / 8000);
  const strength = STRENGTHS[variant % STRENGTHS.length]!;
  const ingredient = LOAD_INGREDIENTS[n % LOAD_INGREDIENTS.length]!;
  return {
    tradeName: arabic ? syllables.map((s) => ARABIC[s]).join('') : capital(syllables.map((s) => LATIN[s]).join('')),
    arabic,
    genericName: n % 2 === 0 ? ingredient : '',
    activeIngredient: ingredient,
    strength: arabic ? `${toArabicDigits(strength)} ملغ` : `${strength} mg`,
    form: FORMS[(k + variant) % FORMS.length]!,
    manufacturer: MANUFACTURERS[n % MANUFACTURERS.length]!,
    box: 10 + (n % 21),
    barcode: `629${b}${String(n).padStart(9, '0')}`,
    priceMinor: BigInt(1000 + (n % 50) * 250),
  };
}

async function inBatches<T>(rows: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
}

/**
 * Throws unless the connection `prisma` really has is the private server: asked of the server itself (its address and
 * port), so a client built from some other URL than the one checked, or a tunnel, is still caught. A Unix socket
 * (no address) is refused too.
 */
export async function assertPrivateConnection(prisma: Pick<PrismaClient, '$queryRawUnsafe'>): Promise<void> {
  // A fixed statement with no parameters that reads no table, so tenant scoping does not apply.
  // eslint-disable-next-line no-restricted-properties
  const rows = await prisma.$queryRawUnsafe<{ port: number | null; addr: string | null }[]>(
    'SELECT inet_server_port() AS port, host(inet_server_addr()) AS addr',
  );
  const { port, addr } = rows[0] ?? { port: null, addr: null };
  if (String(port) !== PRIVATE_DB_PORT || addr === null || !['127.0.0.1', '::1'].includes(addr)) {
    throw new Error(
      `The pharmacy load seed writes only to the private database on 127.0.0.1:${PRIVATE_DB_PORT}; this connection is ` +
        `${addr ?? 'a socket'}:${port ?? '?'}. Refusing to run.`,
    );
  }
}

/**
 * Removes the businesses an earlier run made (their prices first: a price holds its product with RESTRICT), after
 * checking the connection is the private one.
 */
export async function clearLoadPharmacy(prisma: PrismaClient): Promise<void> {
  await assertPrivateConnection(prisma);
  const old = await prisma.restaurant.findMany({ where: { name: { startsWith: LOAD_PHARMACY_PREFIX } }, select: { id: true } });
  if (old.length === 0) return;
  const ids = old.map((r) => r.id);
  await prisma.phPrice.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
}

export async function seedLoadPharmacy(
  prisma: PrismaClient,
  options: { databaseUrl: string | undefined; perBusiness?: number; now?: Date },
): Promise<LoadPharmacyBusiness[]> {
  assertPrivateDatabase(options.databaseUrl);
  const perBusiness = options.perBusiness ?? LOAD_PHARMACY_PER_BUSINESS;
  const now = options.now ?? new Date();
  const validFrom = new Date(now.getTime() - 30 * 86_400_000);
  await clearLoadPharmacy(prisma); // checks the live connection before it deletes or writes anything

  const businesses: LoadPharmacyBusiness[] = [];
  for (const b of [0, 1]) {
    const restaurant = await prisma.restaurant.create({
      data: { name: `${LOAD_PHARMACY_PREFIX} ${'AB'[b]}`, sector: 'PHARMACY', status: 'ACTIVE' },
      select: { id: true },
    });
    const branch = await prisma.branch.create({ data: { restaurantId: restaurant.id, name: 'Main', sortOrder: 0 }, select: { id: true } });
    await prisma.phSettings.create({ data: { restaurantId: restaurant.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' } });
    const restaurantId = restaurant.id;

    const products = [];
    const units = [];
    const barcodes = [];
    const prices = [];
    const made: LoadPharmacyProduct[] = [];
    const keys = new Set<string>();
    for (let n = 0; made.length < perBusiness; n += 1) {
      const p = productOf(b, n);
      const packLabel = `${p.box} box`;
      const identityKey = identityKeyOf({ ...p, packLabel });
      if (keys.has(identityKey)) continue; // two syllable runs can spell the same name
      keys.add(identityKey);
      const productId = createId();
      const tabletId = createId();
      const boxId = createId();
      const { tradeName, genericName, activeIngredient, strength, form, manufacturer } = p;
      products.push({
        id: productId,
        restaurantId,
        tradeName,
        genericName,
        activeIngredient,
        strength,
        form,
        manufacturer,
        identityKey,
        searchText: searchTextOf(p),
      });
      units.push(
        { id: tabletId, restaurantId, productId, level: 0, label: 'tablet', baseQty: 1, sellable: true },
        { id: boxId, restaurantId, productId, level: 1, label: 'box', baseQty: p.box, sellable: true },
      );
      barcodes.push({ restaurantId, productId, unitId: boxId, code: p.barcode });
      prices.push({ restaurantId, productId, unitId: boxId, currency: 'IQD' as const, amountMinor: p.priceMinor, validFrom, changedById: 'load-seed', reason: 'Load seed' });
      if (n % 7 === 0) {
        prices.push({ restaurantId, productId, unitId: boxId, branchId: branch.id, currency: 'IQD' as const, amountMinor: p.priceMinor + 250n, validFrom, changedById: 'load-seed', reason: 'Load seed' });
      }
      made.push({ productId, tradeName, arabic: p.arabic, activeIngredient, barcode: p.barcode });
    }
    await inBatches(products, (data) => prisma.phProduct.createMany({ data }));
    await inBatches(units, (data) => prisma.phProductUnit.createMany({ data }));
    await inBatches(barcodes, (data) => prisma.phBarcode.createMany({ data }));
    await inBatches(prices, (data) => prisma.phPrice.createMany({ data }));
    businesses.push({ id: restaurantId, branchId: branch.id, products: made });
  }
  // The steady state autovacuum would reach in a while, at once: fresh statistics for the planner, and the GIN index's
  // pending list (filled by the bulk insert) merged into the index. A fixed statement with no parameters that changes no
  // row, so tenant scoping does not apply.
  // eslint-disable-next-line no-restricted-properties
  await prisma.$executeRawUnsafe('VACUUM ANALYZE "PhProduct", "PhProductUnit", "PhBarcode", "PhPrice"');
  return businesses;
}
