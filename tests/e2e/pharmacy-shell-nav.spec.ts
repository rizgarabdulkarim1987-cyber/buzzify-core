import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
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
 * The pharmacy's frame: the green rail on a desktop, the bottom bar and its "More" sheet on a phone, which places each
 * role sees, and the fixed frame (the page itself never scrolls; `<main>` does).
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 800 };

async function makePharmacy(label: string): Promise<{ id: string; name: string; branches: Array<{ id: string; name: string }> }> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branches = [];
    for (const [i, branch] of ['Main street', 'Airport road'].entries()) {
      branches.push(
        await client.branch.create({ data: { restaurantId: row.id, name: `${branch} ${label}`, sortOrder: i }, select: { id: true, name: true } }),
      );
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
    return { id: row.id, name, branches };
  } finally {
    await client.$disconnect();
  }
}

async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER', branchIds: string[]): Promise<void> {
  const client = db();
  try {
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    for (const branchId of branchIds) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId } });
  } finally {
    await client.$disconnect();
  }
}

async function freshPage(browser: Browser, viewport = DESKTOP): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

/** Signs in through `/pharmacy` and chooses the first branch. */
async function enter(page: Page, user: StudioUser, shopName: string, branchName: string): Promise<void> {
  await page.goto('/pharmacy');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shopName }).getByRole('button', { name: branchName }).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
}

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const link = (scope: Locator, name: string) => scope.getByRole('link', { name, exact: true });

/** Every visible link and button inside `scope` is at least 44px tall. */
async function expectTouchTargets(scope: Locator): Promise<void> {
  const heights = await scope.locator('a:visible, button:visible, summary:visible').evaluateAll((els) =>
    els.map((el) => [el.textContent?.trim() ?? '', el.getBoundingClientRect().height] as const),
  );
  expect(heights.length).toBeGreaterThan(0);
  for (const [name, height] of heights) expect(height, name).toBeGreaterThanOrEqual(44);
}

test.describe('Pharmacy shell navigation @desktop', () => {
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

  async function owned(label: string) {
    const shop = await makePharmacy(label);
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-nav-owner', name: 'Nav Owner' });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('an owner at 1280px: the rail shows the five places, marks the current one, and the page never scrolls', async ({ browser }) => {
    const { shop, owner } = await owned('Rail');
    const page = await freshPage(browser);
    await enter(page, owner, shop.name, shop.branches[0]!.name);

    const rail = mainNav(page);
    await expect(rail).toBeVisible();
    for (const name of ['Home', 'Sell', 'Stock', 'Expiry', 'Reports']) await expect(link(rail, name)).toBeVisible();
    await expect(link(rail, 'Home')).toHaveAttribute('aria-current', 'page');
    await expect(link(rail, 'Stock')).not.toHaveAttribute('aria-current', 'page');
    // No AI Doctor until it is switched on.
    await expect(rail.getByRole('link', { name: 'AI Doctor' })).toHaveCount(0);

    // The rest sits under "More", closed at first.
    await expect(link(rail, 'Purchasing')).toBeHidden();
    await rail.getByText('More', { exact: true }).click();
    await expect(link(rail, 'Purchasing')).toBeVisible();
    await expect(link(rail, 'Settings')).toBeVisible();
    await expectTouchTargets(rail);

    // The frame is fixed: the document does not scroll, <main> is the scroll container.
    const scroll = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, inner: window.innerHeight }));
    expect(scroll.height).toBeLessThanOrEqual(scroll.inner);
    await expect(page.locator('main#main')).toHaveCSS('overflow-y', 'auto');
    expect(await seriousViolations(page)).toEqual([]);

    await link(rail, 'Stock').click();
    await expect(page).toHaveURL(/\/pharmacy\/stock$/);
    await expect(link(rail, 'Stock')).toHaveAttribute('aria-current', 'page');
    await expect(link(rail, 'Home')).not.toHaveAttribute('aria-current', 'page');
    await page.context().close();
  });

  test('an owner at 375px: the bottom bar has five items and "More" opens a sheet with the rest', async ({ browser }) => {
    const { shop, owner } = await owned('Bar');
    const page = await freshPage(browser, PHONE);
    await enter(page, owner, shop.name, shop.branches[0]!.name);

    const bar = mainNav(page);
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link')).toHaveText(['Home', 'Sell', 'Stock', 'Expiry']);
    const more = bar.getByRole('button', { name: 'More' });
    await expect(more).toBeVisible();
    await expect(link(bar, 'Home')).toHaveAttribute('aria-current', 'page');
    await expectTouchTargets(bar);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

    await more.click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet).toBeVisible();
    for (const name of ['Reports', 'Purchasing', 'Settings']) await expect(link(sheet, name)).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Account and language' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Change branch' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expectTouchTargets(sheet);
    expect(await seriousViolations(page)).toEqual([]);

    await link(sheet, 'Purchasing').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing$/);
    await expect(sheet).toBeHidden();
    await expect(more).toHaveAttribute('aria-current', 'page');
    await page.context().close();
  });

  test('a cashier sees no Reports and no Settings, on the rail or in the sheet', async ({ browser }) => {
    const shop = await makePharmacy('Cashier');
    restaurants.push(shop.id);
    const cashier = await createStudioUser({ label: 'ph-nav-cashier', name: 'Till Person' });
    people.push(cashier.email);
    await makeStaff(cashier.userId, shop.id, 'CASHIER', [shop.branches[0]!.id]);

    const page = await freshPage(browser);
    await enter(page, cashier, shop.name, shop.branches[0]!.name);
    const rail = mainNav(page);
    await expect(link(rail, 'Sell')).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await rail.getByText('More', { exact: true }).click();
    await expect(link(rail, 'Catalog')).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(rail.getByRole('link', { name: 'Purchasing' })).toHaveCount(0);

    await page.setViewportSize(PHONE);
    const bar = mainNav(page);
    await bar.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(link(sheet, 'Catalog')).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await expect(sheet.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.context().close();
  });

  test('a read-only pharmacy keeps its notice inside the new frame', async ({ browser }) => {
    const { shop, owner } = await owned('ReadOnly');
    const page = await freshPage(browser);
    await enter(page, owner, shop.name, shop.branches[0]!.name);
    const client = db();
    try {
      await client.subscription.updateMany({
        where: { restaurantId: shop.id, applicationId: 'pharmacy' },
        data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) },
      });
    } finally {
      await client.$disconnect();
    }
    await page.goto('/pharmacy/home');
    await expect(page.getByTestId('read-only-notice')).toBeVisible();
    await expect(link(mainNav(page), 'Home')).toHaveAttribute('aria-current', 'page');
    await page.context().close();
  });
});
