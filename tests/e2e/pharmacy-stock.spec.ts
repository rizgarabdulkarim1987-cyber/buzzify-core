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
 * The pharmacy stock screens: the owner reads the stock of a product with its batches soonest-expiry first, changes a
 * batch with a reason (asked twice when stock goes out, refused in words on an expired batch), and reverses a line of the
 * movement list; a cashier only looks; the screens read right to left in Arabic without sideways scroll and pass axe.
 * Pharmacies, stock and people are written straight to the development database and removed afterwards.
 */

const DAY = 86_400_000;
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
    return { id: row.id, name, branchIds };
  } finally {
    await client.$disconnect();
  }
}

/** One product with three batches in the first branch: expired, expiring in 20 days, and a year away. */
async function seedStock(shop: TestPharmacy, tag: string): Promise<{ productName: string }> {
  const client = db();
  try {
    const productName = `Stocked ${tag}`;
    const product = await client.phProduct.create({
      data: {
        restaurantId: shop.id,
        tradeName: productName,
        strength: '500 mg',
        form: 'tablet',
        identityKey: `${productName}|${shop.id}`,
        searchText: searchTextOf({ tradeName: productName, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
      },
      select: { id: true },
    });
    await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 } });
    const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
    for (const [lot, days, qty] of [
      ['OLD-1', -30, 12],
      ['SOON-2', 20, 40],
      ['LATER-3', 400, 100],
    ] as const) {
      const batch = await client.phBatch.create({
        data: { restaurantId: shop.id, productId: product.id, lot, expiryDate: new Date(`${dateIn(days)}T00:00:00.000Z`) },
        select: { id: true },
      });
      await scoped.$transaction(async (tx) => {
        await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branchIds[0]!, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: qty }, reason: '' });
      });
    }
    return { productName };
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

test.describe('Pharmacy stock @desktop', () => {
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
    const owner = await createStudioUser({ label: 'ph-stock-owner', name: 'Stock Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('the owner reads batches soonest expiry first, changes stock with a reason, and reverses it', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Stock');
    const { productName } = await seedStock(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser);
    // All branches: the stock is readable, and the page says to choose one branch to change it.
    await signInAndChoose(page, owner, shop, 0);
    await page.getByRole('navigation').getByRole('link', { name: 'Stock', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Stock' })).toBeVisible();
    await expect(page.getByTestId('stock-pick-branch')).toBeVisible();
    await expect(page.getByTestId('batch-actions')).toHaveCount(0);

    // Choose the first branch, then read the product.
    await page.goto('/pharmacy/select');
    await page.getByRole('group', { name: shop.name }).getByRole('button').nth(1).click();
    await page.goto('/pharmacy/stock');
    const row = page.getByTestId('stock-row').filter({ hasText: productName });
    await expect(row).toBeVisible();
    await row.getByTestId('stock-batches').locator('> summary').click();
    await expect(row.getByTestId('batch-lot')).toHaveText(['OLD-1', 'SOON-2', 'LATER-3']);
    await expect(row.locator('[data-chip="expired"]')).toContainText('Expired');
    await expect(row.locator('[data-chip="expiringSoon"]')).toContainText('Expires soon');

    // Adding to the expired batch is refused in words, inline, and keeps what was typed.
    const expired = row.getByTestId('batch-row').filter({ hasText: 'OLD-1' });
    await expired.getByTestId('batch-actions').locator('> summary').click();
    await expired.getByLabel('Quantity (base units)').fill('5');
    await expired.getByLabel('Reason', { exact: true }).fill('Found more');
    await expired.getByRole('button', { name: 'Save change' }).click();
    await expect(expired.getByTestId('batch-action-error')).toContainText('This batch is expired: it cannot go back on sale');
    await expect(expired.getByLabel('Quantity (base units)')).toHaveValue('5');

    // Removing from the soon batch asks twice, then the balance goes down.
    const soon = row.getByTestId('batch-row').filter({ hasText: 'SOON-2' });
    await soon.getByTestId('batch-actions').locator('> summary').click();
    await soon.getByLabel('What to do').selectOption('out');
    await soon.getByLabel('Quantity (base units)').fill('7');
    await soon.getByLabel('Reason', { exact: true }).fill('Broken box');
    await soon.getByRole('button', { name: 'Review' }).click();
    await expect(soon.getByText('This takes stock out of the shelf')).toBeVisible();
    await soon.getByRole('button', { name: 'Confirm' }).click();
    await expect(soon.getByTestId('batch-action-done')).toContainText('Saved');
    await expect(soon.locator('dl').first()).toContainText('33');

    // The movement list shows the line; reversing it needs a reason and leaves a reversal line behind.
    await page.getByRole('navigation').getByRole('link', { name: 'Stock movements' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Stock movements' })).toBeVisible();
    const line = page.getByTestId('movement-row').filter({ hasText: 'Broken box' });
    await expect(line).toContainText('Adjustment');
    await expect(line.getByTestId('movement-delta')).toHaveText(['−7']);
    await line.getByTestId('reverse-movement').locator('> summary').click();
    await line.getByLabel('Reason for reversing').fill('Counted wrong');
    await line.getByRole('button', { name: 'Reverse this change' }).click();
    await expect(line.locator('[data-chip="reversed"]')).toContainText('Reversed');
    await expect(page.getByTestId('movement-row').filter({ hasText: 'Counted wrong' }).locator('[data-chip="reversal"]')).toBeVisible();
    await page.context().close();
  });

  test('a cashier looks at stock and finds nothing to change, and no movement list', async ({ browser }) => {
    const { shop } = await owned('Cashier');
    await seedStock(shop, randomUUID().slice(0, 6));
    const cashier = await createStudioUser({ label: 'ph-stock-cashier', name: 'Stock Cashier' });
    people.push(cashier.email);
    await makeCashier(cashier.userId, shop.id);
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop, 1);
    await till.goto('/pharmacy/stock');
    await expect(till.getByTestId('stock-row').first()).toBeVisible();
    await expect(till.getByTestId('stock-write-blocked')).toContainText('Your role can look at stock');
    await expect(till.getByTestId('batch-actions')).toHaveCount(0);
    await expect(till.getByRole('navigation').getByRole('link', { name: 'Stock movements' })).toHaveCount(0);
    await expect(till.locator('[data-cost]')).toHaveCount(0);
    await till.goto('/pharmacy/stock/movements');
    await expect(till.getByTestId('movements-forbidden')).toContainText('You cannot see this page');
    await till.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(120_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    await seedStock(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    for (const path of ['/pharmacy/stock', '/pharmacy/stock/movements']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path === '/pharmacy/stock') {
        await page.getByTestId('stock-batches').first().locator('> summary').click();
        await page.getByTestId('batch-actions').first().locator('> summary').click();
      }
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await scrollsSideways(page), `${path} at ${width}px`).toBe(false);
        expect(await seriousViolations(page), `${path} at ${width}px`).toEqual([]);
      }
    }
    await page.context().close();
  });
});
