import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
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
 * The pharmacy receiving screens: the owner starts a receipt, adds two products from the search (one expiry given as a
 * month, one as a day), reads how each date was understood, confirms, and finds the batches in the stock list and the
 * stock changes on the receipt; a cashier only looks; the screens read right to left in Arabic without sideways scroll
 * and pass axe. Pharmacies, products and people are written straight to the development database and removed afterwards.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));

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
    return { id: row.id, name, branchIds };
  } finally {
    await client.$disconnect();
  }
}

/** Two products, each with a tablet / strip / box ladder, found by name. */
async function seedProducts(shop: TestPharmacy, tag: string): Promise<{ first: string; second: string }> {
  const client = db();
  try {
    const names = { first: `Receivable ${tag} one`, second: `Receivable ${tag} two` };
    for (const name of Object.values(names)) {
      const product = await client.phProduct.create({
        data: {
          restaurantId: shop.id,
          tradeName: name,
          strength: '500 mg',
          form: 'tablet',
          identityKey: `${name}|${shop.id}`,
          searchText: searchTextOf({ tradeName: name, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
        },
        select: { id: true },
      });
      for (const [level, label, baseQty] of [
        [0, 'tablet', 1],
        [1, 'strip', 10],
        [2, 'box', 30],
      ] as const) {
        await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level, label, baseQty } });
      }
    }
    return names;
  } finally {
    await client.$disconnect();
  }
}

async function makeCashier(userId: string, restaurantId: string): Promise<void> {
  const client = db();
  try {
    const branches = await client.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role: 'CASHIER' }, select: { id: true } });
    for (const branch of branches) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch.id } });
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

/** MM/YYYY about fourteen months from now, and the DD/MM/YYYY of a day about two years from now. */
function futureDates() {
  const month = new Date(Date.now() + 430 * DAY);
  const day = new Date(Date.now() + 740 * DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    month: `${pad(month.getUTCMonth() + 1)}/${month.getUTCFullYear()}`,
    day: `${pad(day.getUTCDate())}/${pad(day.getUTCMonth() + 1)}/${day.getUTCFullYear()}`,
  };
}

test.describe('Pharmacy receiving @desktop', () => {
  // One worker for the whole describe: each worker's hooks switch the shared pharmacy application on and then put it back off, so parallel workers would switch it off under a running test.
  test.describe.configure({ mode: 'serial' });
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
    const owner = await createStudioUser({ label: 'ph-receive-owner', name: 'Receive Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('the owner receives two products, confirms, and finds the batches in stock and the movements on the receipt', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Receive');
    const names = await seedProducts(shop, randomUUID().slice(0, 6));
    const dates = futureDates();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.getByRole('navigation').getByRole('link', { name: 'Receiving' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Receiving goods' })).toBeVisible();
    await expect(page.getByTestId('receive-empty')).toBeVisible();
    await page.getByRole('link', { name: 'New receipt' }).first().click();
    await expect(page.getByTestId('receipt-editor')).toBeVisible();

    await page.getByLabel(/^Supplier/).fill('Acme Pharma');
    await page.getByLabel(/^Invoice or delivery note/).fill('INV-77');

    // First product: found by name (one match is added at once), expiry as a month.
    const search = page.getByLabel('Add a product');
    await search.fill(names.first);
    await search.press('Enter');
    const lines = page.getByTestId('receipt-line');
    await expect(lines).toHaveCount(1);
    const one = lines.nth(0);
    await expect(one.getByLabel('Pack received')).toHaveValue(/.+/);
    await expect(one.getByLabel('Quantity', { exact: true })).toBeFocused();
    await one.getByLabel('Quantity', { exact: true }).fill('4');
    await one.getByLabel('Lot', { exact: true }).fill('e2e-m1');
    await one.getByLabel(/^Expiry/).fill(dates.month);
    await expect(one.getByTestId('expiry-reading')).toContainText(`Expires ${dates.month} (month only`);
    await one.getByLabel('Cost per pack').fill('2500');
    // Enter on the last field goes back to the search for the next product.
    await one.getByLabel('Cost per pack').press('Enter');
    await expect(search).toBeFocused();

    // Second product: expiry as a day, a bonus,.
    await search.fill(names.second);
    await search.press('Enter');
    await expect(lines).toHaveCount(2);
    const two = lines.nth(1);
    await two.getByLabel('Quantity', { exact: true }).fill('2');
    await two.getByLabel('Bonus quantity').fill('1');
    await two.getByLabel('Lot', { exact: true }).fill('e2e-d2');
    await two.getByLabel(/^Expiry/).fill(dates.day);
    await expect(two.getByTestId('expiry-reading')).toHaveText(`Expires ${dates.day}`);
    await two.getByLabel('Cost per pack').fill('12000');

    await expect(page.getByTestId('receipt-totals')).toContainText('2 items');
    // 4 boxes of 30 = 120, and (2 + 1) boxes of 30 = 90.
    await expect(page.getByTestId('receipt-totals')).toContainText('210 units');

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/stock\/receive\/(?!new$)[^/]+$/);
    await expect(page.getByTestId('receipt-line')).toHaveCount(2);

    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    const confirm = page.getByTestId('receipt-confirm');
    await expect(confirm).toContainText('2 items, 210 units in all, will be added to the stock of');
    await confirm.getByRole('button', { name: 'Confirm and add to stock' }).click();
    await expect(page.getByTestId('receipt-number')).toHaveText('R-000001');

    // The batches are in stock.
    await page.getByRole('link', { name: 'See the stock' }).click();
    await page.goto(`/pharmacy/stock?q=${encodeURIComponent(names.first)}`);
    const row = page.getByTestId('stock-row').filter({ hasText: names.first });
    await expect(row).toBeVisible();
    await row.getByTestId('stock-batches').locator('> summary').click();
    await expect(row.getByTestId('batch-lot')).toHaveText(['E2E-M1']);

    // The receipt is now read only, with the stock changes it made.
    await page.goto('/pharmacy/stock/receive');
    const listed = page.getByTestId('receipt-row').first();
    await expect(listed).toContainText('R-000001');
    await expect(listed).toContainText('Acme Pharma');
    await expect(listed.locator('[data-chip="CONFIRMED"]')).toContainText('Confirmed');
    await listed.click();
    await expect(page.getByTestId('receipt-view')).toBeVisible();
    await expect(page.getByTestId('receipt-view-line')).toHaveCount(2);
    await expect(page.getByTestId('movement-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Confirm receipt' })).toHaveCount(0);
    await page.goto('/pharmacy/stock/receive?status=DRAFT');
    await expect(page.getByTestId('receive-empty')).toBeVisible();
    await page.context().close();
  });

  test('a cashier sees no Receiving link, no New receipt button, and the new page says why', async ({ browser }) => {
    const { shop } = await owned('Cashier');
    const cashier = await createStudioUser({ label: 'ph-receive-cashier', name: 'Receive Cashier' });
    people.push(cashier.email);
    await makeCashier(cashier.userId, shop.id);
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop, 1);
    await expect(till.getByRole('navigation').getByRole('link', { name: 'Receiving' })).toHaveCount(0);
    await till.goto('/pharmacy/stock/receive');
    await expect(till.getByRole('heading', { level: 1, name: 'Receiving goods' })).toBeVisible();
    await expect(till.getByTestId('receive-write-blocked')).toContainText('can look at receipts');
    await expect(till.getByRole('link', { name: 'New receipt' })).toHaveCount(0);
    await till.goto('/pharmacy/stock/receive/new');
    await expect(till.getByTestId('receive-forbidden')).toContainText('You cannot use this page');
    await expect(till.getByTestId('receipt-editor')).toHaveCount(0);
    await till.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    const names = await seedProducts(shop, randomUUID().slice(0, 6));
    const dates = futureDates();
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.goto('/pharmacy/stock/receive/new');
    await expect(page.getByTestId('receipt-editor')).toBeVisible();
    const search = page.locator('[data-testid="receipt-picker"] input');
    await search.fill(names.first);
    await search.press('Enter');
    const line = page.getByTestId('receipt-line');
    await expect(line).toHaveCount(1);
    await line.locator('input[data-nav="qty"]').fill('3');
    await line.locator('input[data-nav="lot"]').fill('AR-1');
    await line.locator('input[data-nav="expiry"]').fill(dates.month);
    await line.locator('input[data-nav="cost"]').fill('1500');
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-save') }).click();
    await expect(page).toHaveURL(/\/pharmacy\/stock\/receive\/(?!new$)[^/]+$/);
    const draftUrl = new URL(page.url()).pathname;

    for (const path of ['/pharmacy/stock/receive', '/pharmacy/stock/receive/new', draftUrl]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await scrollsSideways(page), `${path} at ${width}px`).toBe(false);
        expect(await seriousViolations(page), `${path} at ${width}px`).toEqual([]);
      }
    }

    // The confirmed view too.
    await page.goto(draftUrl);
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-package-check') }).first().click();
    await page.getByTestId('receipt-confirm').getByRole('button').first().click();
    await expect(page.getByTestId('receipt-number')).toBeVisible();
    await page.goto(draftUrl);
    await expect(page.getByTestId('receipt-view')).toBeVisible();
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await scrollsSideways(page), `view at ${width}px`).toBe(false);
      expect(await seriousViolations(page), `view at ${width}px`).toEqual([]);
    }
    await page.context().close();
  });
});
