import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The pharmacy's home dashboard: the greeting, four KPI cards, the sales chart with its period tabs and its empty state,
 * the attention list, and a frame that does not scroll at 1280x800.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 800 };

async function makePharmacy(label: string): Promise<{ id: string; name: string; branch: { id: string; name: string } }> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branch = await client.branch.create({ data: { restaurantId: row.id, name: `Main street ${label}`, sortOrder: 0 }, select: { id: true, name: true } });
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
    return { id: row.id, name, branch };
  } finally {
    await client.$disconnect();
  }
}

/** Two completed sales today and one yesterday, straight in the database, on an open shift of `userId`. */
async function seedSales(restaurantId: string, branchId: string, userId: string): Promise<void> {
  const client = db();
  try {
    const shift = await client.phShift.create({ data: { restaurantId, branchId, userId, currency: 'IQD', openingFloatMinor: 0n }, select: { id: true } });
    const now = Date.now();
    const at = [new Date(now - 60_000), new Date(now - 120_000), new Date(now - DAY)];
    for (const [i, completedAt] of at.entries()) {
      const total = BigInt([12_000, 8_000, 10_000][i]!);
      await client.phSale.create({
        data: {
          restaurantId,
          branchId,
          shiftId: shift.id,
          number: `E2E-${randomUUID().slice(0, 8)}`,
          status: 'COMPLETED',
          currency: 'IQD',
          subtotalMinor: total,
          totalMinor: total,
          paidMinor: total,
          clientKey: randomUUID(),
          soldById: userId,
          completedAt,
        },
      });
    }
  } finally {
    await client.$disconnect();
  }
}

async function freshPage(browser: Browser, viewport = DESKTOP): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

async function enter(page: Page, user: StudioUser, shopName: string, branchName: string): Promise<void> {
  await page.goto('/pharmacy');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shopName }).getByRole('button', { name: branchName }).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
}

const kpis = (page: Page) => page.getByRole('list', { name: 'Today at a glance' }).getByRole('listitem');

test.describe('Pharmacy home dashboard @desktop', () => {
  test.describe.configure({ mode: 'serial' });
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  const restaurants: string[] = [];
  const people: string[] = [];

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
    const owner = await createStudioUser({ label: 'ph-home-owner', name: 'Sara Ahmed', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('a new pharmacy: four KPI cards at 0, the chart empty state, no trend chip, and no page scroll at 1280x800', async ({ browser }) => {
    const { shop, owner } = await owned('Empty');
    const page = await freshPage(browser);
    await enter(page, owner, shop.name, shop.branch.name);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Sara$/);
    await expect(page.getByTestId('home-place')).toHaveText(shop.branch.name);
    await expect(page.getByRole('link', { name: 'New sale' })).toHaveAttribute('href', '/pharmacy/sell');
    await expect(kpis(page)).toHaveCount(4);
    await expect(page.getByTestId('home-kpi-sales')).toContainText('0 IQD');
    await expect(page.getByTestId('home-kpi-invoices')).toContainText('0');
    await expect(page.getByTestId('home-kpi-low')).toContainText('0');
    await expect(page.getByTestId('home-kpi-expiring')).toContainText('0');
    await expect(page.getByTestId('home-trend')).toHaveCount(0);
    await expect(page.getByTestId('home-chart')).toBeVisible();
    await expect(page.getByTestId('home-chart-empty')).toHaveText('No sales in this period yet');
    await expect(page.getByTestId('home-attention')).toContainText('Nothing needs your attention');
    await expect(page.getByTestId('home-other-currencies')).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toMatch(/NaN|Infinity/);

    const scroll = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(scroll.height).toBeLessThanOrEqual(scroll.inner);
    expect(await seriousViolations(page)).toEqual([]);

    // The period tabs are links; the chosen one is marked.
    const periods = page.getByRole('navigation', { name: 'Period' });
    await expect(periods.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    await periods.getByRole('link', { name: 'Year' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/home\?period=12m$/);
    await expect(periods.getByRole('link', { name: 'Year' })).toHaveAttribute('aria-current', 'page');
    await expect(periods.getByRole('link', { name: '7 days' })).not.toHaveAttribute('aria-current', 'page');
    await page.context().close();
  });

  test('with sales: the KPIs, the trend chip and the drawn chart', async ({ browser }) => {
    const { shop, owner } = await owned('Sales');
    await seedSales(shop.id, shop.branch.id, owner.userId);
    const page = await freshPage(browser);
    await enter(page, owner, shop.name, shop.branch.name);

    await expect(page.getByTestId('home-kpi-sales')).toContainText('20,000 IQD');
    await expect(page.getByTestId('home-kpi-invoices')).toContainText('2');
    await expect(page.getByTestId('home-kpi-invoices')).toContainText('Average 10,000 IQD');
    await expect(page.getByTestId('home-trend')).toHaveText('100% above yesterday');
    await expect(page.getByTestId('home-chart').getByRole('img')).toBeVisible();
    await expect(page.getByTestId('home-chart-empty')).toHaveCount(0);
    await page.context().close();
  });

  test('in Arabic at 375px and 1280px: right to left, no sideways scroll, axe clean', async ({ browser }) => {
    const { shop, owner } = await owned('Arabic', 'ar');
    const page = await freshPage(browser, PHONE);
    await enter(page, owner, shop.name, shop.branch.name);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByTestId('home-chart-empty')).toHaveText('لا توجد مبيعات في هذه الفترة بعد');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${width}px`).toBe(false);
      expect(await seriousViolations(page)).toEqual([]);
    }
    await page.context().close();
  });
});
