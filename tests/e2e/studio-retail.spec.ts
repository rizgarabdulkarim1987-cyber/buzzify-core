import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { removeRestaurants, SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * The Studio's Retail section at 375 px, as the Super Admin the setup project saved: the list shows a shop whose delivery
 * failed, "Failed only" keeps it, its Retail tab shows the error code, and Resync queues it again so the row no longer
 * says "Not delivered". The link to Buzzify Retail is off in the development server (no RETAIL_URL), so after Resync the
 * shop waits "Queued to send" instead of going on to "Retrying"; a second shop that already failed once shows the retry
 * wording. Everything is written straight to the development database and removed afterwards.
 */

const prisma = () => createPrisma(databaseUrl(DEV_DB));

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
    storageState: SUPER_ADMIN_FILE,
    viewport: { width: 375, height: 800 },
  });
  return context.newPage();
}

async function retailShop(name: string, outbox: { attempts: number; failedAt: Date | null; lastError: string }): Promise<string> {
  const db = prisma();
  try {
    const shop = await db.restaurant.create({ data: { name, sector: 'RETAIL', city: '' }, select: { id: true } });
    await db.retailLink.create({ data: { restaurantId: shop.id, stateVersion: 1 } });
    await db.retailOutbox.create({ data: { restaurantId: shop.id, dueVersion: 1, nextAttemptAt: new Date(Date.now() + 60_000), ...outbox } });
    return shop.id;
  } finally {
    await db.$disconnect();
  }
}

test.describe('Studio retail section @desktop', () => {
  const ids: string[] = [];
  // The link and outbox rows go with the restaurant (they cascade).
  test.afterAll(async () => {
    await removeRestaurants(ids.splice(0));
  });

  test('a Super Admin sees a failed shop, filters to it and Resync queues it again', async ({ browser }) => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const failedName = `E2E Retail Failed ${suffix}`;
    const retryName = `E2E Retail Retry ${suffix}`;
    const failedId = await retailShop(failedName, { attempts: 1, failedAt: new Date(), lastError: 'INVALID_INPUT' });
    const retryId = await retailShop(retryName, { attempts: 2, failedAt: null, lastError: 'HTTP_503' });
    ids.push(failedId, retryId);

    const page = await freshPage(browser);
    await page.goto('/studio/retail');
    await expect(page.getByRole('heading', { level: 1, name: 'Retail' })).toBeVisible();
    const failedRow = page.getByRole('row', { name: new RegExp(failedName) });
    await expect(failedRow).toContainText('Not delivered: INVALID_INPUT');
    await expect(page.getByRole('row', { name: new RegExp(retryName) })).toContainText(/Retrying: attempt 2/);
    expect(await seriousViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('link', { name: 'Failed only' }).click();
    await expect(page).toHaveURL(/failed=1/);
    await expect(page.getByRole('row', { name: new RegExp(failedName) })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(retryName) })).toHaveCount(0);

    await page.getByRole('link', { name: failedName }).click();
    await expect(page).toHaveURL(new RegExp(`/studio/restaurants/${failedId}/retail$`));
    await expect(page.getByText('Not delivered: INVALID_INPUT').first()).toBeVisible();
    await expect(page.getByText('Retails refused these details')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Resync' }).click();
    await expect(page.getByText('Queued: the details will be sent again')).toBeVisible();

    await page.goto('/studio/retail');
    const after = page.getByRole('row', { name: new RegExp(failedName) });
    await expect(after).not.toContainText('Not delivered');
    await expect(after).toContainText(/Queued to send|Retrying/);
  });
});
