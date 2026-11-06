import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { addFromSearch, discardReceipt, nextReceipt } from './helpers/cashier';
import {
  assignMember,
  createStudioUser,
  hideDevTools,
  removeRestaurants,
  removeStudioUsers,
  uniqueClientAddress,
  type StudioUser,
} from './helpers/studio';

/**
 * The pharmacy sale screen (the cashier, `CashierScreen`): the shift gate, a scanner-speed burst of keys adding an item, the search
 * list and Enter adding the top result, paying cash with change, the receipt (print, a print that fails, reprint as a copy), hold
 * and resume, the offline banner with the receipts kept on the device, a cashier who cannot complete a prescription sale, and Arabic
 * right to left at 375, 768 and 1280 px with no sideways scroll and no serious axe finding. Pharmacies, stock and people are written
 * straight to the development database and removed afterwards. Migrated from the old sale screen (plan Task 11): the quantity is
 * set with the keypad now (no typed quantity field, so the Arabic-digit quantity case went with it), unknown scans share the one
 * message line, and the old screen's pane-scroll layout checks became the cashier's pay-button and 44px checks.
 */

const DAY = 86_400_000;
const BARCODE = '6001234567890';
const BARCODE_2 = '6001234567891';
const BARCODE_3 = '6001234567892';
const db = () => createPrisma(databaseUrl(DEV_DB));
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

interface TestPharmacy {
  id: string;
  name: string;
  branchIds: string[];
}

async function makePharmacy(label: string): Promise<TestPharmacy> {
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
      data: {
        restaurantId: row.id,
        applicationId: 'pharmacy',
        planCode: 'standard',
        status: 'ACTIVE',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(now - DAY),
        currentPeriodEnd: new Date(now + 29 * DAY),
        graceDays: 7,
        version: 1,
      },
    });
    // The settings row the sale reads (currency, rounding step, discount limit); the defaults of the schema.
    await client.phSettings.upsert({ where: { restaurantId: row.id }, create: { restaurantId: row.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' }, update: {} });
    return { id: row.id, name, branchIds };
  } finally {
    await client.$disconnect();
  }
}

/** Products in the first branch: a tablet/strip product with a barcode and two batches, a prescription one, one with no price. */
async function seedCatalog(shop: TestPharmacy, tag: string): Promise<{ sellable: string; rx: string; unpriced: string }> {
  const client = db();
  try {
    const make = async (tradeName: string, rxLevel: 'OTC' | 'RX', price: { tablet: bigint; strip: bigint } | null, stock: boolean) => {
      const product = await client.phProduct.create({
        data: {
          restaurantId: shop.id,
          tradeName,
          strength: '500 mg',
          form: 'tablet',
          rxLevel,
          identityKey: `${tradeName}|${shop.id}`,
          searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
        },
        select: { id: true },
      });
      const tablet = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
      const strip = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
      if (price) {
        for (const [unitId, amountMinor] of [[tablet.id, price.tablet], [strip.id, price.strip]] as const) {
          await client.phPrice.create({ data: { restaurantId: shop.id, productId: product.id, unitId, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
        }
      }
      if (stock) {
        const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
        for (const [lot, days, qty] of [['SOON-1', 60, 100], ['LATE-2', 400, 100]] as const) {
          const batch = await client.phBatch.create({ data: { restaurantId: shop.id, productId: product.id, lot, expiryDate: new Date(`${dateIn(days)}T00:00:00.000Z`) }, select: { id: true } });
          await scoped.$transaction(async (tx) => {
            await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branchIds[0]!, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: qty }, reason: '' });
          });
        }
      }
      return { id: product.id, strip: strip.id };
    };
    const sellable = await make(`Sellable ${tag}`, 'OTC', { tablet: 250n, strip: 2000n }, true);
    await client.phBarcode.create({ data: { restaurantId: shop.id, productId: sellable.id, unitId: sellable.strip, code: BARCODE } });
    await make(`Rxdrug ${tag}`, 'RX', { tablet: 1000n, strip: 9000n }, true);
    await make(`Unpriced ${tag}`, 'OTC', null, true);
    return { sellable: `Sellable ${tag}`, rx: `Rxdrug ${tag}`, unpriced: `Unpriced ${tag}` };
  } finally {
    await client.$disconnect();
  }
}

/** One product with a tablet and a strip (10), optionally priced, stocked in the first branch and with a barcode on the strip. */
async function seedOne(
  shop: TestPharmacy,
  input: { name: string; strength?: string; barcode?: string; tablet?: bigint; strip?: bigint; stock: boolean },
): Promise<{ id: string; name: string }> {
  const client = db();
  try {
    const strength = input.strength ?? '500 mg';
    const product = await client.phProduct.create({
      data: {
        restaurantId: shop.id,
        tradeName: input.name,
        strength,
        form: 'tablet',
        identityKey: `${input.name}|${strength}|${shop.id}`,
        searchText: searchTextOf({ tradeName: input.name, genericName: '', activeIngredient: '', strength, form: 'tablet', manufacturer: '' }),
      },
      select: { id: true },
    });
    const tablet = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
    const strip = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
    if (input.tablet !== undefined && input.strip !== undefined) {
      for (const [unitId, amountMinor] of [[tablet.id, input.tablet], [strip.id, input.strip]] as const) {
        await client.phPrice.create({ data: { restaurantId: shop.id, productId: product.id, unitId, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
      }
    }
    if (input.barcode) await client.phBarcode.create({ data: { restaurantId: shop.id, productId: product.id, unitId: strip.id, code: input.barcode } });
    if (input.stock) {
      const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
      const batch = await client.phBatch.create({ data: { restaurantId: shop.id, productId: product.id, lot: 'LOT-1', expiryDate: new Date(`${dateIn(400)}T00:00:00.000Z`) }, select: { id: true } });
      await scoped.$transaction(async (tx) => {
        await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branchIds[0]!, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: 100 }, reason: '' });
      });
    }
    return { id: product.id, name: input.name };
  } finally {
    await client.$disconnect();
  }
}

async function archiveProduct(productId: string): Promise<void> {
  const client = db();
  try {
    await client.phProduct.update({ where: { id: productId }, data: { active: false } });
  } finally {
    await client.$disconnect();
  }
}

async function completedSales(restaurantId: string): Promise<number> {
  const client = db();
  try {
    return await client.phSale.count({ where: { restaurantId, status: 'COMPLETED' } });
  } finally {
    await client.$disconnect();
  }
}

/** A new open price for one unit of a product (the old one is closed at the same moment). */
async function raisePrice(restaurantId: string, productName: string, unitLabel: string, amountMinor: bigint): Promise<void> {
  const client = db();
  try {
    const product = await client.phProduct.findFirstOrThrow({ where: { restaurantId, tradeName: productName }, select: { id: true } });
    const unit = await client.phProductUnit.findFirstOrThrow({ where: { productId: product.id, label: unitLabel }, select: { id: true } });
    const now = new Date(Date.now() - 1000);
    await client.phPrice.updateMany({ where: { productId: product.id, unitId: unit.id, validTo: null }, data: { validTo: now } });
    await client.phPrice.create({ data: { restaurantId, productId: product.id, unitId: unit.id, currency: 'IQD', amountMinor, validFrom: now, changedById: 'seed' } });
  } finally {
    await client.$disconnect();
  }
}

/** The id of one unit (`tablet` or `strip`) of a product, by its trade name. */
async function unitIdOf(restaurantId: string, productName: string, unitLabel: string): Promise<string> {
  const client = db();
  try {
    const product = await client.phProduct.findFirstOrThrow({ where: { restaurantId, tradeName: productName }, select: { id: true } });
    return (await client.phProductUnit.findFirstOrThrow({ where: { productId: product.id, label: unitLabel }, select: { id: true } })).id;
  } finally {
    await client.$disconnect();
  }
}

async function openShiftInDb(shop: TestPharmacy, userId: string): Promise<void> {
  const client = db();
  try {
    await client.phShift.create({ data: { restaurantId: shop.id, branchId: shop.branchIds[0]!, userId, currency: 'IQD', openingFloatMinor: 0n } });
  } finally {
    await client.$disconnect();
  }
}

async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER' | 'PHARMACIST'): Promise<void> {
  const client = db();
  try {
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    const branch = await client.branch.findFirst({ where: { restaurantId }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
    await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch!.id } });
  } finally {
    await client.$disconnect();
  }
}

async function freshPage(browser: Browser, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

/** Signs in and chooses a place: `branch` 0 is "All branches" for an owner, 1 the first branch. */
async function signInAndChoose(page: Page, user: StudioUser, shop: TestPharmacy, branch = 0): Promise<void> {
  await page.goto('/pharmacy');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shop.name }).getByRole('button').nth(branch).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
}

const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.describe('Pharmacy sell @desktop', () => {
  test.describe.configure({ mode: 'serial' });
  const restaurants: string[] = [];
  const people: string[] = [];
  /** The platform's kill switch for the pharmacy product: switched on for this run and put back after. */
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  /** The shops' plan ('standard') runs with no AI budget here, so the AI Doctor never shows on Sell; put back after. */
  const plan = { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } } as const;
  let planLimitsWas: unknown = null;

  test.beforeAll(async () => {
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
      const row = await client.appPlan.findUnique({ where: plan, select: { limits: true } });
      planLimitsWas = row?.limits ?? null;
      if (row && row.limits && typeof row.limits === 'object') {
        await client.appPlan.update({ where: plan, data: { limits: { ...(row.limits as Record<string, unknown>), aiMonthlyBudgetMinor: 0 } } });
      }
    } finally {
      await client.$disconnect();
    }
  });

  test.afterAll(async () => {
    const client = db();
    try {
      if (applicationWas) await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      if (planLimitsWas !== null) await client.appPlan.update({ where: plan, data: { limits: planLimitsWas as never } });
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  async function owned(label: string, locale: 'en' | 'ar' = 'en') {
    const shop = await makePharmacy(label);
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-sell-owner', name: 'Sell Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('open a shift, scan, search, pay cash with change, print, reprint, hold and resume, offline', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Sell');
    const names = await seedCatalog(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    // The desktop rail (inside the frame's <header>), never the phone's bottom bar: both are named "Main navigation", and before
    // the dev server's stylesheet applies the bar's md:hidden the two can both be in the accessibility tree for a moment.
    await page.locator('header').getByRole('navigation').getByRole('link', { name: 'Sell', exact: true }).click();

    // No shift, no sale: the gate asks for the opening cash first.
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await expect(page.getByTestId('cashier-search')).toHaveCount(0);
    await page.getByTestId('shift-float').fill('10,000');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('cashier-screen')).toBeVisible();
    await expect(page.getByTestId('shift-line')).toContainText('Shift open');
    await expect(page.getByTestId('shift-line')).toContainText('10,000');
    await expect(page.getByTestId('cashier-search')).toBeFocused();

    // A scanner-speed burst (no pauses) ending in Enter adds the strip the barcode names; nothing is left in the field.
    await page.keyboard.type(`${BARCODE}\n`, { delay: 0 });
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('sale-line')).toContainText(names.sellable);
    await expect(page.getByTestId('sale-line')).toContainText('strip');
    await expect(page.getByTestId('cashier-total')).toContainText('2,000');
    await expect(page.getByTestId('cashier-search')).toHaveValue('');

    // An unknown barcode says so on the message line, with nothing added.
    await page.keyboard.type('9990001112223\n', { delay: 0 });
    await expect(page.getByTestId('cashier-message')).toContainText('9990001112223');
    await expect(page.getByTestId('sale-line')).toHaveCount(1);

    // Typing by hand is slow: it searches. The list under the field (never a dialog) says the stock; the Rx and unpriced products
    // say so in words. Enter adds the top result in the cashier's start unit (the tablet: a line of its own).
    await page.keyboard.press('/');
    await page.getByTestId('cashier-search').fill(names.sellable);
    const row = page.getByTestId('suggestion').filter({ hasText: names.sellable });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('suggestion-note')).toContainText('200');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByTestId('cashier-search').press('Enter');
    await expect(page.getByTestId('sale-line')).toHaveCount(2);
    await expect(page.getByTestId('cashier-total')).toContainText('2,250');
    // A click on the suggestion adds one more tablet to that same line.
    await page.getByTestId('cashier-search').fill(names.sellable);
    await row.click();
    await expect(page.getByTestId('sale-line')).toHaveCount(2);
    await expect(page.getByTestId('cashier-total')).toContainText('2,500');
    // The selected line's batches show under the lines, the soonest expiry first.
    await expect(page.getByTestId('line-panels')).toBeVisible();
    await page.getByTestId('cashier-search').fill('Sellable');
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `test-results/sell-en-${width}.png`, fullPage: true });
      expect(await scrollsSideways(page), `sell at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('cashier-search').fill('Unpriced');
    const unpriced = page.getByTestId('suggestion').filter({ hasText: names.unpriced });
    await expect(unpriced.getByTestId('suggestion-note')).toContainText('No price');
    await expect(unpriced).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('cashier-search').fill('Rxdrug');
    await expect(page.getByTestId('suggestion').filter({ hasText: names.rx }).getByTestId('suggestion-note')).toContainText('Rx');
    await page.getByTestId('cashier-search').fill('');

    // Pay with F2: cash handed over, the change shown, then the sale and its receipt in the work panel.
    await page.keyboard.press('F2');
    await expect(page.getByTestId('work-panel')).toHaveAttribute('data-flow', 'cash');
    await expect(page.getByTestId('flow-due')).toContainText('2,500');
    await page.getByTestId('flow-tendered').fill('5000');
    await expect(page.getByTestId('flow-change')).toContainText('2,500');
    await page.getByTestId('flow-confirm').click();
    await expect(page.getByTestId('sale-done')).toBeVisible();
    await expect(page.getByTestId('receipt-number')).toContainText(/\d{8}-\d{6}/);
    await expect(page.getByTestId('sale-total')).toContainText('2,500');
    await expect(page.getByTestId('sale-change')).toContainText('2,500');
    await expect(page.getByTestId('receipt-frame')).toBeVisible();

    // A printer that throws shows a sentence and changes nothing about the sale (no thermal printer here: the browser prints).
    await page.getByTestId('receipt-frame').evaluate((frame) => {
      Object.defineProperty(frame, 'contentWindow', {
        get: () => ({
          focus() {},
          print() {
            throw new Error('no printer');
          },
        }),
      });
    });
    await page.getByTestId('receipt-print').click();
    await expect(page.getByTestId('print-failed')).toBeVisible();
    await expect(page.getByTestId('sale-total')).toContainText('2,500');

    // A reprint is a marked copy.
    await page.getByTestId('receipt-reprint').click();
    await expect(page.getByTestId('flow-receipt')).toContainText('Copy 1');
    await nextReceipt(page);
    await expect(page.getByTestId('cashier-lines')).toBeVisible();

    // Hold with F8, then continue it from the held receipts and pay by card.
    await addFromSearch(page, names.sellable, { unitSteps: 1 });
    await expect(page.getByTestId('sale-line')).toContainText('strip');
    await page.keyboard.press('F8');
    await expect(page.getByTestId('cashier-message')).toContainText('held');
    await expect(page.getByTestId('cashier-lines')).toBeVisible();
    await page.getByTestId('tool-held').click();
    await expect(page.getByTestId('held-row')).toHaveCount(1);
    await page.getByTestId('held-resume').click();
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('sale-line')).toContainText(names.sellable);
    await page.getByTestId('pay-cash').click();
    await page.getByTestId('pay-method-CARD_MANUAL').click();
    await page.getByTestId('flow-confirm').click();
    await expect(page.getByTestId('sale-done')).toBeVisible();
    await nextReceipt(page);
    await page.getByTestId('tool-held').click();
    await expect(page.getByTestId('held-empty')).toBeVisible();
    await page.keyboard.press('Escape');

    // Offline: the sale is not sent, the banner says so, and the receipt stays on this device.
    await addFromSearch(page, names.sellable);
    await page.context().setOffline(true);
    await expect(page.getByTestId('cashier-offline')).toContainText('No connection');
    await page.getByTestId('pay-cash').click();
    await expect(page.getByTestId('flow-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ph-sell-receipts')).length)).toBe(1);
    await page.context().setOffline(false);
    await expect(page.getByTestId('cashier-offline')).toHaveCount(0);

    // Reload: the open receipt comes back from the device.
    await page.reload();
    await expect(page.getByTestId('cashier-restored')).toBeVisible();
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await page.context().close();
  });

  test('a cashier can hold a prescription receipt but not pay for it, and sees no batch choice', async ({ browser }) => {
    test.setTimeout(120_000);
    const { shop } = await owned('Cashier');
    const names = await seedCatalog(shop, randomUUID().slice(0, 6));
    const cashier = await createStudioUser({ label: 'ph-sell-cashier', name: 'Sell Cashier' });
    people.push(cashier.email);
    await makeStaff(cashier.userId, shop.id, 'CASHIER');
    await openShiftInDb(shop, cashier.userId);
    const page = await freshPage(browser);
    await signInAndChoose(page, cashier, shop, 0);
    await page.goto('/pharmacy/sell');
    await addFromSearch(page, names.rx);
    await page.getByTestId('pay-cash').click();
    await expect(page.getByTestId('flow-blocked')).toContainText('needs a pharmacist');
    await expect(page.getByTestId('flow-confirm')).toBeDisabled();
    await page.getByTestId('flow-back').click();
    await expect(page.getByTestId('tool-hold')).toBeEnabled();
    // The selected line's panels show, without the batch choice (batch.override).
    await expect(page.getByTestId('line-panels')).toBeVisible();
    await expect(page.getByTestId('batch-override')).toHaveCount(0);
    await page.context().close();
  });

  // Task 8b -----------------------------------------------------------------------------------------------------------------

  test('two scans that come before the first lookup returns both land; a held product beyond the first 30 name hits resumes intact; discard asks first', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Scans');
    const tag = randomUUID().slice(0, 6);
    const names = await seedCatalog(shop, tag);
    const second = await seedOne(shop, { name: `Second ${tag}`, barcode: BARCODE_2, tablet: 300n, strip: 2500n, stock: true });
    // 34 products share one trade name; the one held is the 35th, so a search by that name (30 hits) would not return it.
    const dupName = `Twin ${tag}`;
    for (let n = 1; n <= 34; n += 1) await seedOne(shop, { name: dupName, strength: `${n} mg`, stock: false });
    const target = await seedOne(shop, { name: dupName, strength: '35 mg', barcode: BARCODE_3, tablet: 400n, strip: 3500n, stock: true });
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/sell');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('cashier-screen')).toBeVisible();

    // Two scans in one burst, the second typed before the first lookup can have returned: both are on the receipt.
    await page.keyboard.type(`${BARCODE}\n${BARCODE_2}\n`, { delay: 0 });
    await expect(page.getByTestId('sale-line')).toHaveCount(2);
    await expect(page.getByTestId('sale-line').nth(0)).toContainText(names.sellable);
    await expect(page.getByTestId('sale-line').nth(1)).toContainText(second.name);
    // Two unknown ones in a row: the message line says the last (one message line, never a stack of dialogs); Escape clears it.
    await page.keyboard.type('9990001112223\n9990001112224\n', { delay: 0 });
    await expect(page.getByTestId('cashier-message')).toContainText('9990001112224');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cashier-message')).toHaveCount(0);
    // A scan typed INSIDE the search field adds once and does not also add the top result of the half-typed text.
    await page.getByTestId('cashier-search').focus();
    await page.keyboard.type(`${BARCODE_2}\n`, { delay: 0 });
    await expect(page.getByTestId('sale-line')).toHaveCount(2);
    await expect(page.getByTestId('cashier-search')).toHaveValue('');

    // Discard both, scan the product beyond the 30 hits, hold it, and continue it: the line comes back as it was held.
    await discardReceipt(page);
    await page.keyboard.type(`${BARCODE_3}\n`, { delay: 0 });
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    // The 35th twin, by its strength (the line's full name and detail are its name cell's title).
    await expect(page.getByTestId('line-name')).toHaveAttribute('title', /35 mg/);
    await page.keyboard.press('F8');
    await expect(page.getByTestId('cashier-message')).toContainText('held');
    await page.getByTestId('tool-held').click();
    await expect(page.getByTestId('held-row')).toHaveCount(1);
    await page.getByTestId('held-resume').click();
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('line-name')).toHaveAttribute('title', /35 mg/);
    await expect(page.getByTestId('line-blocked')).toHaveCount(0);
    await expect(page.getByTestId('pay-cash')).toBeEnabled();
    expect(target.id).toBeTruthy();

    // A held product that is archived meanwhile stays on the receipt, marked; paying says why until it is removed.
    await page.keyboard.press('F8');
    await expect(page.getByTestId('cashier-lines')).toBeVisible();
    await archiveProduct(target.id);
    await page.getByTestId('tool-held').click();
    await page.getByTestId('held-resume').click();
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('sale-line')).toHaveAttribute('data-blocked', 'GONE');
    await expect(page.getByTestId('line-blocked')).toContainText('no longer available');
    await page.getByTestId('pay-cash').click();
    await expect(page.getByTestId('flow-blocked')).toBeVisible();
    await expect(page.getByTestId('flow-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
    // It survives a reload (the mark is part of the receipt kept on the device) and goes only when the cashier removes it.
    await page.reload();
    await expect(page.getByTestId('sale-line')).toHaveAttribute('data-blocked', 'GONE');
    await page.getByTestId('line-remove').click();
    await expect(page.getByTestId('sale-line')).toHaveCount(0);

    // Discarding a held receipt asks first (a press arms it, a second discards).
    await page.keyboard.type(`${BARCODE}\n`, { delay: 0 });
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await page.keyboard.press('F8');
    await expect(page.getByTestId('cashier-lines')).toBeVisible();
    await page.getByTestId('tool-held').click();
    const rows = page.getByTestId('held-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).getByTestId('held-discard').click();
    await expect(rows.nth(0).getByTestId('held-discard')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).getByTestId('held-discard').click();
    await expect(rows).toHaveCount(1);
    await page.context().close();
  });

  test('a sale whose answer is lost: the reload keeps the same keys, the repeat returns the sale that was already recorded, one sale in the books', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Lost');
    await seedCatalog(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/sell');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('cashier-search')).toBeFocused();
    await page.keyboard.type(`${BARCODE}\n`, { delay: 0 });
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await page.keyboard.press('F2');
    await page.getByTestId('flow-tendered').fill('5000');

    // The server records the sale, but the browser never gets the answer.
    await page.route('**/pharmacy/sell', async (route) => {
      if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await page.getByTestId('flow-confirm').click();
    await expect(page.getByTestId('flow-problem')).toContainText('may or may not have been recorded');
    await expect(page.getByTestId('flow-problem')).toContainText('Sales');
    await page.unroute('**/pharmacy/sell');
    expect(await completedSales(shop.id)).toBe(1);
    const attemptOf = () =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('ph-sell-receipts'));
        const kept = key ? (JSON.parse(localStorage.getItem(key)!) as { receipts: { attempt: { key: string; amountMinor: string } | null }[] }) : null;
        return kept?.receipts.find((r) => r.attempt)?.attempt ?? null;
      });
    const stored = await attemptOf();
    expect(stored?.key).toMatch(/^sale-/);
    expect(stored?.amountMinor).toBe('5000');

    // Reload: the receipt and its attempt come back, the screen warns, and the payment is filled in as it was sent.
    await page.reload();
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('attempt-unknown')).toContainText('Check Sales');
    await page.keyboard.press('F2');
    await expect(page.getByTestId('flow-tendered')).toHaveValue('5000');
    await page.getByTestId('flow-confirm').click();
    await expect(page.getByTestId('sale-done')).toContainText('already saved');
    await expect(page.getByTestId('sale-total')).toContainText('2,000');
    expect(await completedSales(shop.id)).toBe(1);
    expect(await attemptOf()).toBeNull();
    await page.context().close();
  });

  test('a price that moved after the receipt was filled: the refused payment shows the server total, refreshes the receipt by id, and the retry sells at the new price', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Moved');
    const names = await seedCatalog(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/sell');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('cashier-search')).toBeFocused();
    await page.keyboard.type(`${BARCODE}\n`, { delay: 0 });
    await expect(page.getByTestId('cashier-total')).toContainText('2,000');
    await raisePrice(shop.id, names.sellable, 'strip', 2200n);
    await page.keyboard.press('F2');
    await page.getByTestId('flow-tendered').fill('2000');
    await page.getByTestId('flow-confirm').click();
    await expect(page.getByTestId('flow-problem')).toContainText('2,200');
    await expect(page.getByTestId('cashier-total')).toContainText('2,200');
    await expect(page.getByTestId('sale-line')).toContainText('2,200');
    // An empty amount is exactly the total.
    await page.getByTestId('flow-tendered').fill('');
    await page.getByTestId('flow-confirm').click();
    await expect(page.getByTestId('sale-total')).toContainText('2,200');
    expect(await completedSales(shop.id)).toBe(1);
    await page.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    const names = await seedCatalog(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.goto('/pharmacy/sell');
    // The gate first.
    await expect(page.getByTestId('open-shift')).toBeVisible();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await scrollsSideways(page), `gate at ${width}px`).toBe(false);
      expect(await seriousViolations(page), `gate at ${width}px`).toEqual([]);
    }
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('cashier-screen')).toBeVisible();
    await addFromSearch(page, names.sellable, { unitSteps: 1 });
    await page.getByTestId('cashier-search').fill('Sellable');
    await expect(page.getByTestId('suggestion').first()).toBeVisible();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `test-results/sell-ar-${width}.png`, fullPage: true });
      expect(await scrollsSideways(page), `cashier at ${width}px`).toBe(false);
      expect(await seriousViolations(page), `cashier at ${width}px`).toEqual([]);
    }
    // The cash flow too.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByTestId('cashier-search').fill('');
    await page.getByTestId('pay-cash').click();
    await expect(page.getByTestId('flow-tendered')).toBeVisible();
    expect(await seriousViolations(page), 'cash flow').toEqual([]);
    await page.context().close();
  });

  // Pharmacy redesign, task 7 ------------------------------------------------------------------------------------------------

  test('`?add=` puts the units on the receipt after the ones kept on the device, says an unknown one in words, and the address loses the parameter', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Add');
    const names = await seedCatalog(shop, randomUUID().slice(0, 6));
    const strip = await unitIdOf(shop.id, names.sellable, 'strip');
    await openShiftInDb(shop, owner.userId);
    const page = await freshPage(browser);
    page.on('dialog', (dialog) => void dialog.accept());
    await signInAndChoose(page, owner, shop, 1);

    await page.goto(`/pharmacy/sell?add=${strip}:2`);
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('sale-line')).toContainText(names.sellable);
    await expect(page.getByTestId('cashier-total')).toContainText('4,000');
    await expect(page).toHaveURL(/\/pharmacy\/sell$/);

    // Handed in again with the receipt kept on the device: the device is read first, so the two are added to it, not replaced by it.
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ph-sell-receipts')).length)).toBe(1);
    await page.goto(`/pharmacy/sell?add=${strip}:2`);
    await expect(page.getByTestId('cashier-total')).toContainText('8,000');
    await expect(page.getByTestId('sale-line')).toHaveCount(1);

    // A unit that is not here is said in words, without its raw id; nothing is added.
    const missing = randomUUID();
    await page.goto(`/pharmacy/sell?add=${missing}:1`);
    await expect(page.getByTestId('cashier-message')).toContainText('not a product here');
    await expect(page.getByTestId('cashier-message')).not.toContainText(missing);
    await expect(page.getByTestId('cashier-total')).toContainText('8,000');
    await page.context().close();
  });

  test('the offline banner and the open receipt survive a reload while the browser says it is offline', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Draft');
    const names = await seedCatalog(shop, randomUUID().slice(0, 6));
    const strip = await unitIdOf(shop.id, names.sellable, 'strip');
    await openShiftInDb(shop, owner.userId);
    const page = await freshPage(browser);
    page.on('dialog', (dialog) => void dialog.accept());
    await signInAndChoose(page, owner, shop, 1);
    await page.goto(`/pharmacy/sell?add=${strip}:3`);
    await expect(page.getByTestId('cashier-total')).toContainText('6,000');
    await expect(page.getByTestId('cashier-offline')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ph-sell-receipts')).length)).toBe(1);

    // From the next load on, the browser reports no connection (the page itself still loads).
    await page.context().addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    });
    await page.reload();
    await expect(page.getByTestId('cashier-offline')).toBeVisible();
    await expect(page.getByTestId('cashier-restored')).toBeVisible();
    await expect(page.getByTestId('sale-line')).toHaveCount(1);
    await expect(page.getByTestId('cashier-total')).toContainText('6,000');
    await page.context().close();
  });

  for (const locale of ['en', 'ckb'] as const) {
    test(`${locale}: the pay buttons are in view at 1280×800 with four lines, every control 44px, no sideways scroll at 375`, async ({ browser }) => {
      test.setTimeout(180_000);
      const shop = await makePharmacy(`Bar ${locale}`);
      restaurants.push(shop.id);
      const owner = await createStudioUser({ label: 'ph-sell-owner', name: 'Sell Owner', locale });
      people.push(owner.email);
      await assignMember(owner.userId, shop.id, 'OWNER');
      const names = await seedCatalog(shop, randomUUID().slice(0, 6));
      const units = [
        await unitIdOf(shop.id, names.sellable, 'strip'),
        await unitIdOf(shop.id, names.sellable, 'tablet'),
        await unitIdOf(shop.id, names.rx, 'strip'),
        await unitIdOf(shop.id, names.rx, 'tablet'),
      ];
      await openShiftInDb(shop, owner.userId);
      const page = await freshPage(browser, { width: 1280, height: 800 });
      await signInAndChoose(page, owner, shop, 1);
      if (locale === 'ckb') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.goto(`/pharmacy/sell?add=${units.map((u) => `${u}:1`).join(',')}`);
      await expect(page.getByTestId('sale-line')).toHaveCount(4);
      // The AI Doctor is not on the sale screen (it has its own page: tests/e2e/pharmacy-doctor.spec.ts).
      await expect(page.getByTestId('doctor-panel')).toHaveCount(0);
      await expect(page.getByTestId('doctor-fab')).toHaveCount(0);

      // The pay buttons are in view with four lines on the receipt, 56px high.
      const pay = page.getByTestId('pay-cash');
      await expect(pay).toBeInViewport({ ratio: 1 });
      expect((await pay.boundingBox())!.height, 'pay at 1280px').toBeGreaterThanOrEqual(56);
      expect(await scrollsSideways(page), 'sideways at 1280px').toBe(false);
      // Every row's remove button, every keypad key: 44px at least.
      for (const id of ['line-remove', 'key-digit']) {
        for (const [n, button] of (await page.getByTestId(id).all()).entries()) {
          const box = (await button.boundingBox())!;
          expect(Math.min(box.width, box.height), `${id} ${n + 1}`).toBeGreaterThanOrEqual(44);
        }
      }
      await page.setViewportSize({ width: 375, height: 667 });
      expect(await scrollsSideways(page), 'sideways at 375px').toBe(false);
      await page.getByTestId('pay-cash').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('pay-cash')).toBeInViewport();

      // Keyboard focus lands on the scan field (the `/` key, from anywhere else on the screen), and Tab moves on from it.
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByTestId('cashier-total').click();
      await expect(page.getByTestId('cashier-search')).not.toBeFocused();
      await page.keyboard.press('/');
      await expect(page.getByTestId('cashier-search')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('cashier-search')).not.toBeFocused();
      await page.context().close();
    });
  }
});
