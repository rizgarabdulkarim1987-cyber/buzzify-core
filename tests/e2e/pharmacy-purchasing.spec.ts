import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
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
 * The pharmacy purchasing screens: the owner adds a supplier, starts an order from the below-minimum suggestions, places
 * it, receives part of it against the order and finds the order partly received with its figures; a cashier is blocked;
 * the screens read right to left in Arabic with no sideways scroll at 375, 768 and 1280 px and pass axe. Pharmacies,
 * products and people are written straight to the development database and removed afterwards. Screenshots go to
 * PURCHASING_SHOTS when it is set.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const SHOTS = process.env.PURCHASING_SHOTS;

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

/** One product with a tablet / box ladder and a minimum of 50 tablets in the first branch (so the order suggests it). */
async function seedLowProduct(shop: TestPharmacy, tag: string): Promise<string> {
  const client = db();
  try {
    const name = `Reorder ${tag}`;
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
      [1, 'box', 30],
    ] as const) {
      await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level, label, baseQty } });
    }
    await client.phProductBranch.create({ data: { restaurantId: shop.id, branchId: shop.branchIds[0]!, productId: product.id, minQty: 50, reorderQty: 0 } });
    return name;
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

function futureMonth(): string {
  const month = new Date(Date.now() + 430 * DAY);
  return `${String(month.getUTCMonth() + 1).padStart(2, '0')}/${month.getUTCFullYear()}`;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe('Pharmacy purchasing @desktop', () => {
  // One worker: each worker's hooks switch the shared pharmacy application on and then put it back, so parallel workers would switch it off under a running test.
  test.describe.configure({ mode: 'serial' });
  const restaurants: string[] = [];
  const people: string[] = [];
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
    const owner = await createStudioUser({ label: 'ph-purchasing-owner', name: 'Purchasing Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('the owner adds a supplier, orders from the suggestions, receives part of the order and sees it partly received', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = await owned('Order');
    const product = await seedLowProduct(shop, randomUUID().slice(0, 6));
    const supplierName = `Al Noor ${randomUUID().slice(0, 5)}`;
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);

    await page.getByRole('navigation').getByRole('link', { name: 'Purchasing' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Purchasing' })).toBeVisible();
    await expect(page.getByTestId('hub-open-orders')).toContainText('0');
    await expect(page.getByTestId('hub-invoices')).toContainText('Not on screen yet');
    await shoot(page, 'en-hub-1280');

    // A supplier.
    await page.getByRole('link', { name: 'Go to suppliers' }).click();
    await expect(page.getByTestId('suppliers-empty')).toBeVisible();
    await page.getByRole('link', { name: 'New supplier' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill(supplierName);
    await page.getByLabel('Phone').fill('07701234567');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/suppliers\/(?!new$)[^/]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(supplierName);

    // An order from the suggestions. With a supplier that has no history the screen says so, not "nothing is low".
    await page.goto('/pharmacy/purchasing/orders/new');
    await expect(page.getByTestId('po-editor')).toBeVisible();
    await page.getByTestId('po-supplier').selectOption({ label: supplierName });
    await page.getByRole('button', { name: 'Show what is low' }).click();
    await expect(page.getByTestId('po-suggest-empty')).toContainText('No history with this supplier yet');
    await page.getByTestId('po-supplier').selectOption({ value: '' });
    await page.getByTestId('po-supplier').selectOption({ label: supplierName });
    // Without a supplier filter the product below its minimum is listed.
    await page.getByTestId('po-supplier').selectOption({ value: '' });
    await page.getByRole('button', { name: 'Show what is low' }).click();
    await expect(page.getByTestId('po-suggest-list')).toContainText(product);
    await page.getByTestId('po-suggest-add').click();
    await page.getByTestId('po-supplier').selectOption({ label: supplierName });
    const line = page.getByTestId('po-line');
    await expect(line).toHaveCount(1);
    await expect(line.getByTestId('po-qty')).toHaveValue('50');
    await line.getByTestId('po-cost').fill('2500');
    await expect(page.getByTestId('po-totals')).toContainText('125,000');
    await shoot(page, 'en-order-new-1280');
    await page.getByTestId('po-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/orders\/(?!new$)[^/]+$/);
    await expect(page.getByTestId('order-status')).toContainText('Draft');

    // Place the order.
    await page.getByTestId('po-order').click();
    await page.getByRole('button', { name: 'Place the order' }).click();
    await expect(page.getByTestId('order-status')).toContainText('Ordered');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PO-');
    await expect(page.getByTestId('order-line')).toContainText('0 / 50');

    // Receive part of it against the order.
    await page.getByTestId('po-receive').click();
    await expect(page.getByTestId('receipt-editor')).toBeVisible();
    await expect(page.getByTestId('receipt-against-order')).toContainText('Receiving against order PO-');
    await expect(page.getByLabel(/^Supplier/)).toHaveValue(supplierName);
    await expect(page.getByLabel(/^Supplier/)).toHaveJSProperty('readOnly', true);
    const receiptLine = page.getByTestId('receipt-line');
    await expect(receiptLine).toHaveCount(1);
    await expect(receiptLine.locator('input[data-nav="qty"]')).toHaveValue('50');
    await receiptLine.locator('input[data-nav="qty"]').fill('20');
    await receiptLine.locator('input[data-nav="lot"]').fill('po-1');
    await receiptLine.locator('input[data-nav="expiry"]').fill(futureMonth());
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await page.getByTestId('receipt-confirm').getByRole('button', { name: 'Confirm and add to stock' }).click();
    await expect(page.getByTestId('receipt-number')).toBeVisible();

    // The order is partly received with its figures; the receipt names the order and shows the cost beside the order's.
    await page.getByRole('link', { name: 'View the receipt' }).click();
    await expect(page.getByTestId('receipt-order-link')).toContainText('PO-');
    await expect(page.getByTestId('receipt-order-cost')).toContainText('Same as the order');
    await page.getByTestId('receipt-order-link').click();
    await expect(page.getByTestId('order-status')).toContainText('Partly received');
    await expect(page.getByTestId('order-line')).toContainText('20 / 50');
    await expect(page.getByTestId('order-receipts')).toContainText('R-');
    await shoot(page, 'en-order-1280');
    await page.setViewportSize({ width: 375, height: 800 });
    await shoot(page, 'en-order-375');
    await page.setViewportSize({ width: 768, height: 900 });
    await shoot(page, 'en-order-768');

    // An order with something received can be closed, with a reason.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Close order' }).click();
    const form = page.getByTestId('po-close-form');
    await form.getByLabel('Reason').fill('Supplier is out of stock');
    await form.getByRole('button', { name: 'Close the order' }).click();
    await expect(page.getByTestId('order-status')).toContainText('Closed');
    await page.context().close();
  });

  test('a cashier has no Purchasing link and the pages say why, with no data', async ({ browser }) => {
    const { shop } = await owned('Cashier');
    const cashier = await createStudioUser({ label: 'ph-purchasing-cashier', name: 'Purchasing Cashier' });
    people.push(cashier.email);
    await makeCashier(cashier.userId, shop.id);
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop, 1);
    await expect(till.getByRole('navigation').getByRole('link', { name: 'Purchasing' })).toHaveCount(0);
    for (const url of ['/pharmacy/purchasing', '/pharmacy/purchasing/suppliers', '/pharmacy/purchasing/orders', '/pharmacy/purchasing/orders/new']) {
      await till.goto(url);
      await expect(till.getByTestId('purchasing-forbidden')).toContainText('Purchasing is not available to you');
      await expect(till.getByTestId('po-editor')).toHaveCount(0);
    }
    await till.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    await seedLowProduct(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // A supplier and a draft order so the detail pages have something to show.
    await page.goto('/pharmacy/purchasing/suppliers/new');
    await page.getByLabel('الاسم', { exact: true }).fill(`مورد ${randomUUID().slice(0, 5)}`);
    await page.locator('form[data-testid="supplier-form"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/suppliers\/(?!new$)[^/]+$/);
    const supplierUrl = new URL(page.url()).pathname;

    for (const url of ['/pharmacy/purchasing', '/pharmacy/purchasing/suppliers', '/pharmacy/purchasing/suppliers/new', supplierUrl, '/pharmacy/purchasing/orders', '/pharmacy/purchasing/orders/new']) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await scrollsSideways(page), `${url} at ${width}px`).toBe(false);
        expect(await seriousViolations(page), `${url} at ${width}px`).toEqual([]);
        if (url === '/pharmacy/purchasing' || url === '/pharmacy/purchasing/orders/new') await shoot(page, `ar-${url.split('/').pop()}-${width}`);
      }
    }
    await page.context().close();
  });
});
