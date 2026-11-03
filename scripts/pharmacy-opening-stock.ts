import { readFileSync } from 'node:fs';
import { getPrisma } from '@/server/data/prisma';
import * as importActions from '@/server/pharmacy/actions/imports';
import * as receiptActions from '@/server/pharmacy/actions/receipts';
import * as priceActions from '@/server/pharmacy/actions/prices';
import { loadActor, type Actor } from '@/server/studio/auth/actor';
import { runAction, type ActionDef } from '@/server/studio/framework/action';
import { describeDatabase } from './database-target';

/**
 * Opening stock for one pharmacy: `DATABASE_URL=... npx tsx scripts/pharmacy-opening-stock.ts [--apply] [--name "Rizgar Pharmacy"]`.
 *
 * Gives every product of the pharmacy that has a price a first lot in the branch, by the same actions the Receive screen
 * runs (`ph.stock.receipt.create` then `.confirm`, as the business's Studio OWNER), so batches, balances, movements and
 * the audit trail are written exactly as by hand. Without `--apply` it prints the plan and writes nothing. A re-run is
 * safe: each chunk has a fixed client key, and a chunk already confirmed is skipped.
 *
 * `DATABASE_URL` is required (this script never falls back to a local database or reads `.env`), and the line printed
 * first says which database it will change.
 */

const NAME_FLAG = process.argv.indexOf('--name');
const NAME = NAME_FLAG === -1 ? 'Rizgar Pharmacy' : (process.argv[NAME_FLAG + 1] ?? '');
const APPLY = process.argv.includes('--apply');
const IMPORT_FLAG = process.argv.indexOf('--import');
const IMPORT_FILE = IMPORT_FLAG === -1 ? null : (process.argv[IMPORT_FLAG + 1] ?? null);
const CHUNK = 40;
const META = { ip: '127.0.0.1', userAgent: 'pharmacy-opening-stock' };
const DAY = 86_400_000;

type Run = <I, O>(def: ActionDef<I, O>, input: unknown) => Promise<O>;

interface Plan {
  productId: string;
  name: string;
  unitId: string;
  label: string;
  qty: number;
  costMinor: bigint;
  lot: string;
  expiry: string;
}

const isoDay = (at: Date) => at.toISOString().slice(0, 10);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to the database to change; this script does not guess one');
  if (!NAME) throw new Error('--name needs a pharmacy name');
  console.log(`Database: ${describeDatabase(process.env)}`);
  console.log(APPLY ? 'Mode: APPLY (writes)' : 'Mode: dry run (writes nothing; add --apply)');

  const prisma = getPrisma();
  try {
    const found = await prisma.restaurant.findMany({ where: { name: NAME, sector: 'PHARMACY' }, select: { id: true, status: true } });
    if (found.length !== 1) throw new Error(`Expected exactly one pharmacy named "${NAME}", found ${found.length}`);
    const restaurant = found[0]!;
    if (restaurant.status !== 'ACTIVE') throw new Error('The pharmacy is not ACTIVE');

    const branches = await prisma.branch.findMany({ where: { restaurantId: restaurant.id }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } });
    if (branches.length === 0) throw new Error('The pharmacy has no branch');
    const branch = branches[0]!;
    if (branches.length > 1) console.log(`Note: ${branches.length} branches; using the first, "${branch.name}"`);

    const owner = await prisma.membership.findFirst({ where: { restaurantId: restaurant.id, role: 'OWNER' }, select: { userId: true } });
    if (!owner) throw new Error('The pharmacy has no Studio OWNER to act as');
    const actor = (await loadActor(prisma, owner.userId)) as Actor;
    const run: Run = async (def, input) => {
      const result = await runAction(prisma, actor, def, input, META);
      if (!result.ok) throw new Error(`${def.name}: ${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.fields ?? {})}`);
      return result.data;
    };

    // `--import file.csv`: the catalog import's own preview and apply, only into an empty catalog; an error row stops it.
    if (IMPORT_FILE !== null) {
      const have = await prisma.phProduct.count({ where: { restaurantId: restaurant.id } });
      const rows = readFileSync(IMPORT_FILE, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
      if (have > 0) console.log(`Import: skipped, the catalog already has ${have} products`);
      else if (!APPLY) console.log(`Import: would import ${rows} products from ${IMPORT_FILE}`);
      else {
        const place = { restaurantId: restaurant.id, branchId: branch.id };
        const preview = await run(importActions.preview, {
          ...place,
          fileName: IMPORT_FILE.split(/[\\/]/).pop()!,
          fileBase64: readFileSync(IMPORT_FILE).toString('base64'),
          defaults: { rxLevel: 'OTC' },
        });
        const s = preview.summary;
        console.log(`Import preview: ${s.rows} rows, ${s.ok} ok, ${s.warnings} warnings, ${s.errors} errors`);
        if (s.errors > 0) throw new Error(`The import has ${s.errors} error rows; nothing was imported: ${JSON.stringify(preview.firstRowsWithIssues).slice(0, 1500)}`);
        const applied = await run(importActions.apply, { ...place, batchId: preview.batchId, batchHash: preview.batchHash, acceptWarnings: true, excludeRowNumbers: [] });
        console.log(`Import applied: ${JSON.stringify(applied).slice(0, 200)}`);
      }
    }

    // A pack ladder's lowest unit (the tablet) gets the business-wide price of its top unit divided by the base units in it,
    // to the nearest 25 IQD, when it has none yet; the pack's own price is never touched.
    const priceOf = (productId: string, unitId: string) =>
      prisma.phPrice.findFirst({
        where: { restaurantId: restaurant.id, productId, unitId, currency: 'IQD', validTo: null, OR: [{ branchId: branch.id }, { branchId: null }] },
        orderBy: { branchId: { sort: 'asc', nulls: 'last' } },
        select: { amountMinor: true },
      });
    const ladders = await prisma.phProduct.findMany({
      where: { restaurantId: restaurant.id, active: true },
      select: { id: true, units: { orderBy: { level: 'asc' }, select: { id: true, baseQty: true, sellable: true } } },
    });
    let lowPrices = 0;
    for (const ladder of ladders) {
      if (ladder.units.length < 2) continue;
      const low = ladder.units[0]!;
      const top = ladder.units[ladder.units.length - 1]!;
      if (!low.sellable || (await priceOf(ladder.id, low.id))) continue;
      const topPrice = await priceOf(ladder.id, top.id);
      if (!topPrice) continue;
      const amount = Math.max(25, Math.round(Number(topPrice.amountMinor) / (top.baseQty / low.baseQty) / 25) * 25);
      lowPrices += 1;
      if (APPLY) {
        await run(priceActions.set, { restaurantId: restaurant.id, productId: ladder.id, unitId: low.id, currency: 'IQD', amount: String(amount), validFrom: isoDay(new Date()), reason: 'Price per tablet from the pack price' });
      }
    }
    console.log(`Single-unit prices ${APPLY ? 'set' : 'to set'}: ${lowPrices}`);

    const products = await prisma.phProduct.findMany({
      where: { restaurantId: restaurant.id, active: true },
      orderBy: { tradeName: 'asc' },
      select: { id: true, tradeName: true, units: { orderBy: { level: 'desc' }, take: 1, select: { id: true, label: true, level: true } } },
    });
    const now = Date.now();
    const plan: Plan[] = [];
    let unpriced = 0;
    for (const [index, product] of products.entries()) {
      const unit = product.units[0];
      if (!unit) continue;
      const price = await prisma.phPrice.findFirst({
        where: { restaurantId: restaurant.id, productId: product.id, unitId: unit.id, currency: 'IQD', validTo: null, OR: [{ branchId: branch.id }, { branchId: null }] },
        // The branch's own price wins over the business-wide one.
        orderBy: { branchId: { sort: 'asc', nulls: 'last' } },
        select: { amountMinor: true },
      });
      if (!price) {
        unpriced += 1;
        continue;
      }
      // Deterministic, so a re-run plans the same lots. Most expire in 8 to 30 months; every 12th within 2 months, so the
      // Expiry screen has something to show.
      const months = index % 12 === 11 ? 2 : 8 + ((index * 7) % 23);
      plan.push({
        productId: product.id,
        name: product.tradeName,
        unitId: unit.id,
        label: unit.label,
        qty: 6 + ((index * 11) % 35),
        costMinor: (price.amountMinor * 70n) / 100n,
        lot: `OB-${String(index + 1).padStart(3, '0')}`,
        expiry: isoDay(new Date(now + months * 30 * DAY)),
      });
    }
    console.log(`Products: ${products.length}; to stock: ${plan.length}; without an IQD price (skipped): ${unpriced}`);
    for (const row of plan.slice(0, 8)) console.log(`  ${row.name}: ${row.qty} x ${row.label}, lot ${row.lot}, expiry ${row.expiry}, cost ${row.costMinor}`);
    if (plan.length > 8) console.log(`  ... and ${plan.length - 8} more`);
    if (!APPLY || plan.length === 0) return;

    const today = isoDay(new Date(now));
    for (let at = 0; at < plan.length; at += CHUNK) {
      const lines = plan.slice(at, at + CHUNK);
      const clientKey = `opening-stock-${restaurant.id}-${Math.floor(at / CHUNK) + 1}`;
      const existing = await prisma.phReceipt.findFirst({ where: { restaurantId: restaurant.id, clientKey }, select: { status: true } });
      if (existing?.status === 'CONFIRMED') {
        console.log(`Chunk ${Math.floor(at / CHUNK) + 1}: already confirmed, skipped`);
        continue;
      }
      const draft = await run(receiptActions.create, {
        restaurantId: restaurant.id,
        branchId: branch.id,
        clientKey,
        supplierName: 'Opening stock',
        reference: 'OPENING',
        receivedOn: today,
        note: 'Opening stock entered by script',
        lines: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: l.qty, lot: l.lot, expiry: l.expiry, unitCostMinor: l.costMinor, currency: 'IQD' })),
      });
      const done = await run(receiptActions.confirm, { restaurantId: restaurant.id, branchId: branch.id, receiptId: draft.id });
      console.log(`Chunk ${Math.floor(at / CHUNK) + 1}: ${done.number}, ${done.lines} lines, ${done.baseQty} base units`);
    }
    console.log('Done. Open a shift in Shifts, then try Sell.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
