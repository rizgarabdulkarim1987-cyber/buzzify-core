import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
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
 * The pharmacy sale screen: the shift gate, a scanner-speed burst of keys adding an item, the search and Enter adding the
 * top result, paying cash with change, the receipt (print, a print that fails, reprint as a copy), hold and resume, the
 * offline banner with the cart kept on the device, a cashier who cannot complete a prescription sale, and Arabic right to
 * left at 375, 768 and 1280 px with no sideways scroll and no serious axe finding. Pharmacies, stock and people are written
 * straight to the development database and removed afterwards.
 */

const DAY = 86_400_000;
const BARCODE = '6001234567890';
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
  const restaurants: string[] = [];
  const people: string[] = [];
  /** The platform's kill switch for the pharmacy product: switched on for this run and put back after. */
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;

  test.beforeAll(async () => {
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
    } finally {
      await client.$disconnect();
    }
  });

  test.afterAll(async () => {
    if (applicationWas) {
      const client = db();
      try {
        await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      } finally {
        await client.$disconnect();
      }
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
    await page.getByRole('navigation').getByRole('link', { name: 'Sell', exact: true }).click();

    // No shift, no sale: the gate asks for the opening cash first.
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await expect(page.getByTestId('sell-search')).toHaveCount(0);
    await page.getByTestId('shift-float').fill('10,000');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('sell-workspace')).toBeVisible();
    await expect(page.getByTestId('shift-line')).toContainText('Shift open');
    await expect(page.getByTestId('sell-search')).toBeFocused();

    // A scanner-speed burst (no pauses) ending in Enter adds the strip the barcode names; nothing is left in the box.
    await page.keyboard.type(`${BARCODE}\n`, { delay: 0 });
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-line')).toContainText(names.sellable);
    await expect(page.getByTestId('line-total')).toContainText('2,000');
    await expect(page.getByTestId('sell-search')).toHaveValue('');

    // An unknown barcode says so, with nothing added.
    await page.keyboard.type('9990001112223\n', { delay: 0 });
    await expect(page.getByTestId('scan-unknown')).toContainText('9990001112223');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);

    // Typing by hand is slow: it searches. The result carries its badges, stock and soonest-expiry strip; the Rx and
    // unpriced products say so in words. Enter adds the top result in the unit the search names (the strip: a second one).
    await page.keyboard.press('F2');
    await page.getByTestId('sell-search').fill(names.sellable);
    const result = page.getByTestId('result').filter({ hasText: names.sellable });
    await expect(result).toBeVisible();
    await expect(result.getByTestId('batch-strip')).toContainText('SOON-1');
    await expect(result.getByTestId('sellable-qty')).toContainText('200');
    await page.getByTestId('sell-search').press('Enter');
    await expect(page.getByTestId('qty-input')).toHaveValue('2');
    await expect(page.getByTestId('cart-total')).toContainText('4,000');
    await expect(page.getByTestId('estimate-mark')).toBeVisible();
    // A button adds a chosen unit: one tablet as its own line.
    await page.getByTestId('sell-search').fill(names.sellable);
    await result.getByTestId('add-unit').first().click();
    await expect(page.getByTestId('cart-line')).toHaveCount(2);
    await expect(page.getByTestId('cart-total')).toContainText('4,250');
    await page.getByTestId('sell-search').fill('Sellable');
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `test-results/sell-en-${width}.png`, fullPage: true });
      expect(await scrollsSideways(page), `sell at ${width}px`).toBe(false);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByTestId('sell-search').fill('');

    await page.getByTestId('sell-search').fill('Unpriced');
    await expect(page.getByTestId('result').filter({ hasText: names.unpriced }).getByTestId('chip-noPrice')).toBeVisible();
    await expect(page.getByTestId('result').filter({ hasText: names.unpriced }).getByTestId('add-unit').first()).toBeDisabled();
    await page.getByTestId('sell-search').fill('Rxdrug');
    await expect(page.getByTestId('result').filter({ hasText: names.rx }).getByTestId('chip-rx')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sell-search')).toHaveValue('');

    // Pay with F4: cash handed over, the change shown, then the sale and its receipt.
    await page.keyboard.press('F4');
    await expect(page.getByTestId('pay-total')).toContainText('4,250');
    await page.getByTestId('pay-tendered').fill('5000');
    await expect(page.getByTestId('pay-change')).toContainText('750');
    await page.getByTestId('pay-confirm').click();
    await expect(page.getByTestId('sale-done')).toBeVisible();
    await expect(page.getByTestId('receipt-number')).toContainText(/\d{8}-\d{6}/);
    await expect(page.getByTestId('sale-total')).toContainText('4,250');
    await expect(page.getByTestId('sale-change')).toContainText('750');
    await expect(page.getByTestId('receipt-frame')).toBeVisible();

    // A printer that throws shows a sentence and changes nothing about the sale.
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
    await expect(page.getByTestId('sale-total')).toContainText('4,250');

    // A reprint is a marked copy.
    await page.getByTestId('receipt-reprint').click();
    await expect(page.getByRole('dialog')).toContainText('Copy 1');
    await page.getByTestId('receipt-done').click();
    await expect(page.getByTestId('cart-empty')).toBeVisible();

    // Hold with F8, then continue it from the held list and pay by card.
    await page.getByTestId('sell-search').fill(names.sellable);
    await page.getByTestId('result').filter({ hasText: names.sellable }).getByTestId('add-unit').nth(1).click();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await page.keyboard.press('F8');
    await expect(page.getByTestId('sell-notice')).toContainText('Cart held');
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await page.getByTestId('open-holds').click();
    await expect(page.getByTestId('hold-row')).toHaveCount(1);
    await page.getByTestId('hold-resume').click();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-line')).toContainText(names.sellable);
    await page.getByTestId('pay-open').click();
    await page.getByTestId('pay-CARD_MANUAL').check({ force: true });
    await page.getByTestId('pay-confirm').click();
    await expect(page.getByTestId('sale-done')).toBeVisible();
    await page.getByTestId('receipt-done').click();
    await page.getByTestId('open-holds').click();
    await expect(page.getByTestId('hold-row')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Offline: the sale is not sent, the banner says so, and the cart stays on this device.
    await page.getByTestId('sell-search').fill(names.sellable);
    await page.getByTestId('result').filter({ hasText: names.sellable }).getByTestId('add-unit').first().click();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await page.context().setOffline(true);
    await expect(page.getByTestId('sell-offline')).toContainText('No connection');
    await page.getByTestId('pay-open').click();
    await expect(page.getByTestId('pay-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ph-sell-draft')).length)).toBe(1);
    await page.context().setOffline(false);
    await expect(page.getByTestId('sell-offline')).toHaveCount(0);

    // Reload: the draft cart comes back from the device.
    await page.reload();
    await expect(page.getByTestId('draft-restored')).toBeVisible();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await page.context().close();
  });

  test('a cashier can hold a prescription cart but not pay for it, and sees no batch control', async ({ browser }) => {
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
    await page.getByTestId('sell-search').fill(names.rx);
    await page.getByTestId('result').filter({ hasText: names.rx }).getByTestId('add-unit').first().click();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('pay-open')).toBeDisabled();
    await expect(page.getByTestId('pay-blocked')).toContainText('needs a pharmacist');
    await expect(page.getByTestId('hold-cart')).toBeEnabled();
    await page.getByTestId('line-more').locator('> summary').click();
    await expect(page.getByTestId('batch-select')).toHaveCount(0);
    await page.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    await seedCatalog(shop, randomUUID().slice(0, 6));
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
    await expect(page.getByTestId('sell-workspace')).toBeVisible();
    await page.getByTestId('sell-search').fill('Sellable');
    await page.getByTestId('result').first().getByTestId('add-unit').nth(1).click();
    await page.getByTestId('sell-search').fill('Sellable');
    await expect(page.getByTestId('result').first()).toBeVisible();
    await page.getByTestId('line-more').locator('> summary').click();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `test-results/sell-ar-${width}.png`, fullPage: true });
      expect(await scrollsSideways(page), `workspace at ${width}px`).toBe(false);
      expect(await seriousViolations(page), `workspace at ${width}px`).toEqual([]);
    }
    // The payment dialog too.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByTestId('pay-open-bar').click();
    await expect(page.getByTestId('pay-tendered')).toBeVisible();
    expect(await seriousViolations(page), 'pay dialog').toEqual([]);
    await page.context().close();
  });
});
