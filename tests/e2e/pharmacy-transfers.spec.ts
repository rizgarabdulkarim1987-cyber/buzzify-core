import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The transfer screens, end to end: A requests 30 units for B, sends them first-expiry-first across two batches (a double
 * click is one effect), B receives 25 and records 5 as lost; the stock screens and the sale screen show the figures at each
 * step; a role without `report.view` is refused for lost units; a third branch and another business see nothing; a cashier
 * is blocked; a read-only pharmacy shows the data without controls; a lost answer replays to the same effect; a stale
 * version, the offline notice, English, Arabic and Sorani with axe and no sideways scroll at three widths, and a 500-line
 * transfer at 375px. Run: `npx playwright test -c playwright.transfers.config.ts --workers=1 tests/e2e/pharmacy-transfers.spec.ts`.
 */

const DAY = 86_400_000;
const SHOTS = '.superpowers/sdd/2026-10-31-pharmacy-phase-6/task-3-shots';
const db = () => createPrisma(databaseUrl(DEV_DB));
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

interface Shop {
  id: string;
  name: string;
  branches: { id: string; name: string }[];
}

async function makeShop(label: string, branchNames: string[]): Promise<Shop> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branches: Shop['branches'] = [];
    for (const [i, b] of branchNames.entries()) {
      const bn = `${b} ${randomUUID().slice(0, 4)}`;
      const created = await client.branch.create({ data: { restaurantId: row.id, name: bn, sortOrder: i }, select: { id: true } });
      branches.push({ id: created.id, name: bn });
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

/** One product with a tablet / strip / box ladder and three batches at the first branch: 18 soon, 20 later, 40 last. */
async function seedStock(shop: Shop, productName: string): Promise<void> {
  const client = db();
  try {
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
    for (const [level, label, baseQty] of [[0, 'tablet', 1], [1, 'strip', 10], [2, 'box', 100]] as const) {
      await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level, label, baseQty } });
    }
    const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
    for (const [lot, days, qty] of [['SOON-1', 60, 18], ['MID-2', 200, 20], ['LAST-3', 400, 40]] as const) {
      const batch = await client.phBatch.create({
        data: { restaurantId: shop.id, productId: product.id, lot, expiryDate: new Date(`${dateIn(days)}T00:00:00.000Z`) },
        select: { id: true },
      });
      await scoped.$transaction(async (tx) => {
        await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branches[0]!.id, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: qty }, reason: '' });
      });
    }
  } finally {
    await client.$disconnect();
  }
}

async function staff(userId: string, shop: Shop, role: 'BRANCH_MANAGER' | 'STOCK' | 'CASHIER', branchIndexes: number[]): Promise<void> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId, restaurantId: shop.id, role }, select: { id: true } });
    for (const i of branchIndexes) await client.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: shop.branches[i]!.id } });
  } finally {
    await client.$disconnect();
  }
}

/** Signs in and chooses a place: a branch by name, or `null` for "All branches" (an owner). */
async function session(browser: Browser, user: StudioUser, shop: Shop, branch: string | null, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  const page = await context.newPage();
  await page.goto('/pharmacy');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  const group = page.getByRole('group', { name: shop.name });
  await (branch === null ? group.getByRole('button').first() : group.getByRole('button', { name: new RegExp(branch) })).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
  return page;
}

const idOf = (page: Page) => new URL(page.url()).pathname.split('/').pop()!;

/** A request from the person's branch to `otherName` for `qty` base units of the product; ends on its detail page. */
async function request(page: Page, otherName: string, productName: string, qty: string): Promise<string> {
  await page.goto('/pharmacy/stock/transfers/new');
  await expect(page.getByTestId('transfer-editor')).toBeVisible();
  await page.getByTestId('transfer-mode-send').check();
  await page.getByTestId('transfer-other').selectOption({ label: otherName });
  const search = page.locator('[data-testid="receipt-picker"] input');
  await search.fill(productName);
  await search.press('Enter');
  await expect(page.getByTestId('transfer-line')).toHaveCount(1);
  await page.getByTestId('transfer-unit').selectOption({ label: 'tablet' });
  await page.getByTestId('transfer-qty').fill(qty);
  await page.getByTestId('transfer-save').click();
  await expect(page).toHaveURL(/\/pharmacy\/stock\/transfers\/(?!new$)[^/]+$/);
  await expect(page.getByTestId('transfer-view')).toBeVisible();
  return idOf(page);
}

async function openShift(page: Page): Promise<void> {
  await page.goto('/pharmacy/sell');
  await expect(page.getByTestId('open-shift').or(page.getByTestId('sell-workspace'))).toBeVisible();
  if (await page.getByTestId('open-shift').isVisible()) {
    await page.getByTestId('shift-float').fill('10,000');
    await page.getByTestId('shift-open').click();
  }
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Pharmacy transfers @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let shop: Shop;
  let other: Shop;
  let productName: string;
  let mgrA: StudioUser;
  let mgrB: StudioUser;
  let mgrC: StudioUser;
  let stockAB: StudioUser;
  let cashier: StudioUser;
  let owner: StudioUser;
  let owner2: StudioUser;
  let A: string;
  let B: string;
  let C: string;
  /** The transfers the scenarios leave behind, by the state the screens are checked in. */
  const ids: { partial?: string; received?: string; sent?: string; requested?: string; bulk?: string } = {};

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      console.log(`Application(pharmacy) before: ${applicationWas}, set to ACTIVE for this run`);
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
    } finally {
      await client.$disconnect();
    }
    shop = await makeShop('Transfers', ['Alpha', 'Bravo', 'Charlie']);
    other = await makeShop('Other', ['Delta']);
    restaurants.push(shop.id, other.id);
    [A, B, C] = shop.branches.map((b) => b.name) as [string, string, string];
    productName = `Trf${randomUUID().slice(0, 6)}`;
    await seedStock(shop, productName);
    const make = async (label: string) => {
      const user = await createStudioUser({ label: `ph-trf-${label}`, name: `Trf ${label}` });
      people.push(user.email);
      return user;
    };
    [mgrA, mgrB, mgrC, stockAB, cashier, owner, owner2] = await Promise.all(['mgr-a', 'mgr-b', 'mgr-c', 'stock', 'cashier', 'owner', 'owner2'].map(make)) as [StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser];
    await staff(mgrA.userId, shop, 'BRANCH_MANAGER', [0]);
    await staff(mgrB.userId, shop, 'BRANCH_MANAGER', [1]);
    await staff(mgrC.userId, shop, 'BRANCH_MANAGER', [2]);
    await staff(stockAB.userId, shop, 'STOCK', [0, 1]);
    await staff(cashier.userId, shop, 'CASHIER', [0]);
    await assignMember(owner.userId, shop.id, 'OWNER');
    await assignMember(owner2.userId, other.id, 'OWNER');
    mkdirSync(SHOTS, { recursive: true });
  });

  test.afterAll(async () => {
    if (applicationWas) {
      const client = db();
      try {
        await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
        console.log(`Application(pharmacy) restored to ${applicationWas}`);
      } finally {
        await client.$disconnect();
      }
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  test('A requests 30 for B, sends them first-expiry-first across two batches with a double click, B receives 25 and 5 are lost', async ({ browser }) => {
    test.setTimeout(240_000);
    const a = await session(browser, mgrA, shop, A);
    await a.goto('/pharmacy/stock/transfers');
    await expect(a.getByTestId('transfers-empty')).toBeVisible();

    // The request: the ladder is shown, the sender's stock is shown, the figures are base units.
    await a.goto('/pharmacy/stock/transfers/new');
    await a.getByTestId('transfer-mode-send').check();
    await a.getByTestId('transfer-other').selectOption({ label: B });
    const search = a.locator('[data-testid="receipt-picker"] input');
    await search.fill(productName);
    await search.press('Enter');
    await expect(a.getByTestId('transfer-line')).toHaveCount(1);
    await expect(a.getByTestId('transfer-line-stock')).toContainText('78');
    await a.getByTestId('transfer-unit').selectOption({ label: 'strip (10)' });
    await a.getByTestId('transfer-qty').fill('3');
    await expect(a.getByTestId('transfer-line-base')).toContainText('30');
    await expect(a.getByTestId('transfer-line-base')).toContainText('3 strip');
    await a.getByTestId('transfer-save').click();
    await expect(a.getByTestId('transfer-view')).toBeVisible();
    const id = idOf(a);
    ids.partial = id;
    await expect(a.getByTestId('transfer-status')).toContainText('Requested');
    await expect(a.getByTestId('transfer-turn')).toContainText('has to send this');

    // The send: FEFO proposes 18 from the soonest batch and 12 from the next; the double click is one effect.
    await a.getByTestId('transfer-send').click();
    await expect(a.getByTestId('send-row')).toHaveCount(2);
    await expect(a.getByTestId('send-qty')).toHaveCount(2);
    expect(await a.getByTestId('send-qty').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(['18', '12']);
    await a.getByTestId('send-review').click();
    await expect(a.getByTestId('send-confirm')).toContainText('30');
    await a.getByTestId('send-confirm-yes').dblclick();
    await expect(a.getByTestId('transfer-status')).toContainText('Sent');
    {
      const client = db();
      try {
        expect(await client.phTransferLine.count({ where: { transferId: id, sentQty: { gt: 0 } } })).toBe(2);
        expect(await client.phTransfer.count({ where: { restaurantId: shop.id, status: 'SENT' } })).toBe(1);
      } finally {
        await client.$disconnect();
      }
    }

    // The stock screens at A: 48 left, 30 on the road to B; the sale screen at A sells from the 48 only.
    await a.goto('/pharmacy/stock');
    const rowA = a.getByTestId('stock-row').filter({ hasText: productName });
    await expect(rowA).toContainText('48');
    await expect(rowA.getByTestId('stock-in-transit')).toContainText('30');
    await expect(rowA.getByTestId('stock-in-transit')).toContainText(B);
    await openShift(a);
    await a.getByTestId('sell-search').fill(productName);
    await expect(a.getByTestId('result').filter({ hasText: productName }).getByTestId('sellable-qty')).toContainText('48');
    await a.context().close();

    // B: its turn; nothing of it is sellable at B yet.
    const b = await session(browser, mgrB, shop, B);
    await b.goto('/pharmacy/stock/transfers');
    await expect(b.getByTestId('transfer-row').first()).toContainText('Your turn: receive');
    await openShift(b);
    await b.getByTestId('sell-search').fill(productName);
    const atB = b.getByTestId('result').filter({ hasText: productName });
    if (await atB.count()) await expect(atB.getByTestId('sellable-qty')).not.toContainText('30');
    await b.goto(`/pharmacy/stock/transfers/${id}`);
    await expect(b.getByTestId('transfer-in-transit')).toContainText('30');
    await b.getByTestId('transfer-receive').click();
    await expect(b.getByTestId('receive-line')).toHaveCount(2);
    const lines = b.getByTestId('receive-line');
    await lines.nth(0).getByTestId('receive-received').fill('18');
    await lines.nth(1).getByTestId('receive-received').fill('7');
    await lines.nth(1).getByTestId('receive-lost').fill('5');
    await lines.nth(1).getByTestId('receive-lost-reason').selectOption('LOST');
    await expect(b.getByTestId('receive-summary')).toContainText('25');
    await b.getByTestId('receive-review').click();
    await b.getByTestId('receive-confirm-yes').dblclick();
    await expect(b.getByTestId('transfer-status')).toContainText('Partly received');
    await expect(b.getByTestId('transfer-differences')).toBeVisible();
    await expect(b.getByTestId('transfer-diff-totals')).toContainText('received 25');
    await expect(b.getByTestId('transfer-diff-totals')).toContainText('lost 5');
    await expect(b.getByTestId('transfer-in-transit')).toHaveCount(0);

    // After: 25 at B (sellable), no more "on the road" at A.
    await b.goto('/pharmacy/stock');
    await expect(b.getByTestId('stock-row').filter({ hasText: productName })).toContainText('25');
    await openShift(b);
    await b.getByTestId('sell-search').fill(productName);
    await expect(b.getByTestId('result').filter({ hasText: productName }).getByTestId('sellable-qty')).toContainText('25');
    await b.context().close();
    const a2 = await session(browser, mgrA, shop, A);
    await a2.goto('/pharmacy/stock');
    await expect(a2.getByTestId('stock-row').filter({ hasText: productName }).getByTestId('stock-in-transit')).toHaveCount(0);
    await a2.context().close();
  });

  test('a stock-room role cannot pick another batch and is refused for lost units; a complete receive goes through', async ({ browser }) => {
    test.setTimeout(240_000);
    const s = await session(browser, stockAB, shop, A);
    const id = await request(s, B, productName, '5');
    ids.received = id;
    await s.getByTestId('transfer-send').click();
    await expect(s.getByTestId('send-row').first()).toBeVisible();
    // 48 left in MID-2 (8) and LAST-3 (40): the pick of the other batch needs batch.override, which this role lacks.
    await expect(s.getByTestId('send-pick-disabled').first()).toBeDisabled();
    await expect(s.getByTestId('send-pick-select')).toHaveCount(0);
    await s.getByTestId('send-review').click();
    await s.getByTestId('send-confirm-yes').click();
    await expect(s.getByTestId('transfer-status')).toContainText('Sent');
    await s.context().close();

    const r = await session(browser, stockAB, shop, B);
    await r.goto(`/pharmacy/stock/transfers/${id}`);
    await r.getByTestId('transfer-receive').click();
    const line = r.getByTestId('receive-line').first();
    await line.getByTestId('receive-received').fill('3');
    await line.getByTestId('receive-lost').fill('2');
    await line.getByTestId('receive-lost-reason').selectOption('LOST');
    await expect(r.getByTestId('receive-loss-blocked')).toBeVisible();
    await expect(r.getByTestId('receive-review')).toBeDisabled();
    await line.getByTestId('receive-lost').fill('0');
    await line.getByTestId('receive-received').fill('5');
    await expect(r.getByTestId('receive-review')).toBeEnabled();
    await r.getByTestId('receive-review').click();
    await r.getByTestId('receive-confirm-yes').click();
    await expect(r.getByTestId('transfer-status')).toContainText('Received');
    await r.context().close();
  });

  test('a lost answer replays to one effect', async ({ browser }) => {
    test.setTimeout(240_000);
    const a = await session(browser, mgrA, shop, A);
    const id = await request(a, B, productName, '2');
    ids.sent = id;
    await a.getByTestId('transfer-send').click();
    await expect(a.getByTestId('send-row').first()).toBeVisible();
    await a.getByTestId('send-review').click();
    // The first answer is dropped after the server did the work; the form keeps its key and the second try replays.
    let dropped = false;
    await a.route('**/*', async (route) => {
      const request = route.request();
      if (!dropped && request.method() === 'POST' && request.headers()['next-action']) {
        dropped = true;
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await a.getByTestId('send-confirm-yes').click();
    await expect(a.getByTestId('transfer-send-error')).toBeVisible();
    await a.getByTestId('send-review').click();
    await a.getByTestId('send-confirm-yes').click();
    await expect(a.getByTestId('transfer-status')).toContainText('Sent');
    const client = db();
    try {
      expect(await client.phTransferLine.count({ where: { transferId: id, sentQty: { gt: 0 } } })).toBe(1);
    } finally {
      await client.$disconnect();
    }
    await a.context().close();
  });

  test('a stale version is said in words; offline keeps the form', async ({ browser }) => {
    test.setTimeout(240_000);
    const a = await session(browser, mgrA, shop, A);
    const id = await request(a, B, productName, '4');
    ids.requested = id;
    const tab2 = await a.context().newPage();
    await tab2.goto(`/pharmacy/stock/transfers/${id}`);
    await expect(tab2.getByTestId('transfer-cancel')).toBeVisible();
    // Tab 1 edits the quantity (the version moves on); tab 2 still holds the old one.
    await a.goto(`/pharmacy/stock/transfers/${id}/edit`);
    await expect(a.getByTestId('transfer-qty')).toBeVisible();
    await a.getByTestId('transfer-qty').fill('6');
    await a.getByTestId('transfer-save').click();
    await expect(a.getByTestId('transfer-view')).toBeVisible();
    await tab2.getByTestId('transfer-cancel').click();
    await tab2.getByTestId('transfer-cancel-yes').click();
    await expect(tab2.getByTestId('transfer-action-error')).toBeVisible();
    await expect(tab2.getByTestId('transfer-status')).toContainText('Requested');
    await tab2.close();

    // Offline: the notice shows, the save waits, the typed form stays.
    await a.goto('/pharmacy/stock/transfers/new');
    await a.getByTestId('transfer-other').selectOption({ label: C });
    const search = a.locator('[data-testid="receipt-picker"] input');
    await search.fill(productName);
    await search.press('Enter');
    await a.getByTestId('transfer-qty').fill('9');
    await a.context().setOffline(true);
    await expect(a.getByTestId('stock-offline')).toBeVisible();
    await expect(a.getByTestId('transfer-save')).toBeDisabled();
    await expect(a.getByTestId('transfer-qty')).toHaveValue('9');
    await a.context().setOffline(false);
    await expect(a.getByTestId('stock-offline')).toHaveCount(0);
    await expect(a.getByTestId('transfer-save')).toBeEnabled();
    await expect(a.getByTestId('transfer-qty')).toHaveValue('9');
    await a.context().close();
  });

  test('a third branch and another business see nothing; a cashier is blocked', async ({ browser }) => {
    const c = await session(browser, mgrC, shop, C);
    await c.goto('/pharmacy/stock/transfers');
    await expect(c.getByTestId('transfers-empty')).toBeVisible();
    await expect(c.getByTestId('transfer-row')).toHaveCount(0);
    await c.goto(`/pharmacy/stock/transfers/${ids.partial}`);
    await expect(c.getByTestId('transfer-view')).toHaveCount(0);
    await c.context().close();

    const o = await session(browser, owner2, other, null);
    await o.goto('/pharmacy/stock/transfers');
    await expect(o.getByTestId('transfer-row')).toHaveCount(0);
    await o.goto(`/pharmacy/stock/transfers/${ids.partial}`);
    await expect(o.getByTestId('transfer-view')).toHaveCount(0);
    await o.context().close();

    const till = await session(browser, cashier, shop, A);
    await till.goto('/pharmacy/stock/transfers');
    await expect(till.getByTestId('transfers-forbidden')).toBeVisible();
    await expect(till.getByTestId('transfer-row')).toHaveCount(0);
    await expect(till.getByRole('navigation').getByRole('link', { name: 'Transfers', exact: true })).toHaveCount(0);
    await till.goto(`/pharmacy/stock/transfers/${ids.partial}`);
    await expect(till.getByTestId('transfers-forbidden')).toBeVisible();
    await till.goto('/pharmacy/stock/transfers/new');
    await expect(till.getByTestId('transfers-forbidden')).toBeVisible();
    await till.context().close();
  });

  test('a read-only pharmacy shows the data without controls', async ({ browser }) => {
    test.setTimeout(120_000);
    const client = db();
    let was: Date | null = null;
    try {
      was = (await client.subscription.findFirstOrThrow({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, select: { currentPeriodEnd: true } })).currentPeriodEnd;
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
      const a = await session(browser, mgrA, shop, A);
      await a.goto(`/pharmacy/stock/transfers/${ids.requested}`);
      await expect(a.getByTestId('transfer-view')).toBeVisible();
      await expect(a.getByTestId('transfer-send')).toHaveCount(0);
      await expect(a.getByTestId('transfer-cancel')).toHaveCount(0);
      await expect(a.getByTestId('transfer-edit')).toHaveCount(0);
      await a.goto('/pharmacy/stock/transfers/new');
      await expect(a.getByTestId('transfer-write-blocked')).toBeVisible();
      await expect(a.getByTestId('transfer-editor')).toHaveCount(0);
      await a.goto('/pharmacy/stock/transfers');
      await expect(a.getByTestId('transfer-row').first()).toBeVisible();
      await a.context().close();
    } finally {
      if (was) await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: was } });
      await client.$disconnect();
    }
  });

  test('English, Arabic and Sorani: no sideways scroll at 375, 768 and 1280 and axe clean on every screen and state', async ({ browser }) => {
    test.setTimeout(600_000);
    const states: [string, string][] = [
      ['list', '/pharmacy/stock/transfers'],
      ['new', '/pharmacy/stock/transfers/new'],
      ['requested', `/pharmacy/stock/transfers/${ids.requested}`],
      ['sent', `/pharmacy/stock/transfers/${ids.sent}`],
      ['received', `/pharmacy/stock/transfers/${ids.received}`],
      ['partial', `/pharmacy/stock/transfers/${ids.partial}`],
    ];
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      await setUserLocale(owner.userId, locale);
      const page = await session(browser, owner, shop, null, { width: 375, height: 800 });
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'en' ? 'ltr' : 'rtl');
      for (const [name, path] of states) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        for (const width of [375, 768, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await scrollsSideways(page), `${locale} ${name} at ${width}px`).toBe(false);
          expect(await seriousViolations(page), `${locale} ${name} at ${width}px`).toEqual([]);
          await page.screenshot({ path: `${SHOTS}/${locale}-${name}-${width}.png`, fullPage: true });
        }
        // The panels, open: send on the request, receive on the sent one.
        const opener = name === 'requested' ? 'transfer-send' : name === 'sent' ? 'transfer-receive' : null;
        if (opener && (await page.getByTestId(opener).count())) {
          await page.getByTestId(opener).click();
          await expect(page.getByTestId(opener === 'transfer-send' ? 'transfer-send-panel' : 'transfer-receive-panel')).toBeVisible();
          for (const width of [375, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            expect(await scrollsSideways(page), `${locale} ${name} panel at ${width}px`).toBe(false);
            expect(await seriousViolations(page), `${locale} ${name} panel at ${width}px`).toEqual([]);
            await page.screenshot({ path: `${SHOTS}/${locale}-${name}-panel-${width}.png`, fullPage: true });
          }
        }
      }
      await page.context().close();
    }
    await setUserLocale(owner.userId, 'en');
  });

  test('a 500-line transfer is usable at 375px', async ({ browser }) => {
    test.setTimeout(300_000);
    const client = db();
    try {
      const products: { id: string; batches: string[] }[] = [];
      const productRows = [];
      const batchRows = [];
      for (let n = 0; n < 100; n++) {
        const id = randomUUID();
        const name = `Bulk ${n} ${randomUUID().slice(0, 4)}`;
        productRows.push({
          id,
          restaurantId: shop.id,
          tradeName: name,
          strength: '',
          form: 'tablet',
          identityKey: `${name}|${shop.id}`,
          searchText: searchTextOf({ tradeName: name, genericName: '', activeIngredient: '', strength: '', form: 'tablet', manufacturer: '' }),
        });
        const batches: string[] = [];
        for (let k = 0; k < 5; k++) {
          const batchId = randomUUID();
          batches.push(batchId);
          batchRows.push({ id: batchId, restaurantId: shop.id, productId: id, lot: `B${n}-${k}`, expiryDate: new Date(`${dateIn(60 + k * 30)}T00:00:00.000Z`) });
        }
        products.push({ id, batches });
      }
      await client.phProduct.createMany({ data: productRows as never });
      await client.phBatch.createMany({ data: batchRows as never });
      const from = shop.branches[0]!.id;
      const to = shop.branches[1]!.id;
      const t = await client.phTransfer.create({
        data: {
          restaurantId: shop.id,
          fromBranchId: from,
          toBranchId: to,
          number: `T-BULK-${randomUUID().slice(0, 4)}`,
          clientKey: `bulk-${randomUUID()}`,
          payloadHash: 'h',
          requestedById: 'seed',
          requestedAt: new Date(Date.now() - 2 * DAY),
        } as never,
        select: { id: true },
      });
      ids.bulk = t.id;
      const requestIds = products.map(() => randomUUID());
      await client.phTransferLine.createMany({
        data: products.map((p, i) => ({ id: requestIds[i], restaurantId: shop.id, transferId: t.id, fromBranchId: from, toBranchId: to, lineNo: i + 1, productId: p.id, requestedQty: 50 })) as never,
      });
      let lineNo = 1000;
      await client.phTransferLine.createMany({
        data: products.flatMap((p, i) =>
          p.batches.map((batchId) => ({ restaurantId: shop.id, transferId: t.id, fromBranchId: from, toBranchId: to, lineNo: lineNo++, productId: p.id, batchId, requestLineId: requestIds[i], requestedQty: 0, sentQty: 10 })),
        ) as never,
      });
      // Lines are added while it is a request; then it is marked sent, as the service leaves it.
      await client.phTransfer.update({ where: { id: t.id }, data: { status: 'SENT', sentAt: new Date(), sentById: 'seed', sendKey: `bulk-send-${randomUUID()}`, sendHash: 'sh' } as never });
    } finally {
      await client.$disconnect();
    }
    const page = await session(browser, owner, shop, null, { width: 375, height: 800 });
    await page.goto(`/pharmacy/stock/transfers/${ids.bulk}`);
    await expect(page.getByTestId('transfer-view')).toBeVisible();
    await expect(page.getByTestId('transfer-sent-line')).toHaveCount(500);
    expect(await scrollsSideways(page)).toBe(false);
    await page.getByTestId('transfer-receive').click();
    await expect(page.getByTestId('receive-line')).toHaveCount(500);
    expect(await scrollsSideways(page)).toBe(false);
    await expect(page.getByTestId('receive-summary')).toContainText('5');
    await page.getByTestId('receive-review').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('receive-review')).toBeEnabled();
    expect(await seriousViolations(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/bulk-500-375.png` });
    await page.context().close();
  });
});
