import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The pharmacy shift, sales and returns screens: open a shift, sell, paid in and paid out (and the refusal of too much
 * cash out), a partial return then the cancel of what is left, a reprint logged as a copy, closing with a counted
 * difference and its reason, the history and the report, the sales filters; a cashier who cannot return (UI hidden) and
 * the manager path when a difference is above the limit; Arabic right to left with axe and no sideways scroll at
 * 375, 768 and 1280 px. Pharmacies, stock and people are written straight to the development database and removed.
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

async function makePharmacy(label: string, varianceLimit = 0n): Promise<TestPharmacy> {
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
    await client.phSettings.upsert({
      where: { restaurantId: row.id },
      create: { restaurantId: row.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD', shiftVarianceLimitMinor: varianceLimit },
      update: {},
    });
    return { id: row.id, name, branchIds };
  } finally {
    await client.$disconnect();
  }
}

/** One product in the first branch: tablet 250 and strip (10 tablets) 2,000, a barcode on the strip, 200 tablets in stock. */
async function seedProduct(shop: TestPharmacy, tag: string): Promise<string> {
  const client = db();
  try {
    const tradeName = `Sellable ${tag}`;
    const product = await client.phProduct.create({
      data: {
        restaurantId: shop.id,
        tradeName,
        strength: '500 mg',
        form: 'tablet',
        identityKey: `${tradeName}|${shop.id}`,
        searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
      },
      select: { id: true },
    });
    const tablet = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
    const strip = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
    for (const [unitId, amountMinor] of [[tablet.id, 250n], [strip.id, 2000n]] as const) {
      await client.phPrice.create({ data: { restaurantId: shop.id, productId: product.id, unitId, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
    }
    await client.phBarcode.create({ data: { restaurantId: shop.id, productId: product.id, unitId: strip.id, code: BARCODE } });
    const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
    const batch = await client.phBatch.create({ data: { restaurantId: shop.id, productId: product.id, lot: 'LOT-9', expiryDate: new Date(`${dateIn(400)}T00:00:00.000Z`) }, select: { id: true } });
    await scoped.$transaction(async (tx) => {
      await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branchIds[0]!, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: 200 }, reason: '' });
    });
    return tradeName;
  } finally {
    await client.$disconnect();
  }
}

async function openShiftInDb(shop: TestPharmacy, userId: string, floatMinor = 0n): Promise<string> {
  const client = db();
  try {
    const row = await client.phShift.create({ data: { restaurantId: shop.id, branchId: shop.branchIds[0]!, userId, currency: 'IQD', openingFloatMinor: floatMinor }, select: { id: true } });
    return row.id;
  } finally {
    await client.$disconnect();
  }
}

async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER' | 'BRANCH_MANAGER'): Promise<void> {
  const client = db();
  try {
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    const branch = await client.branch.findFirst({ where: { restaurantId }, orderBy: { sortOrder: 'asc' }, select: { id: true } });
    await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch!.id } });
  } finally {
    await client.$disconnect();
  }
}

/** Closed shifts straight into the table, to make the history longer than one page. */
async function manyClosedShifts(shop: TestPharmacy, userId: string, count: number): Promise<void> {
  const client = db();
  try {
    for (let i = 0; i < count; i += 1) {
      await client.phShift.create({
        data: {
          restaurantId: shop.id,
          branchId: shop.branchIds[0]!,
          userId,
          currency: 'IQD',
          status: 'CLOSED',
          openedAt: new Date(Date.now() - (i + 2) * DAY),
          closedAt: new Date(Date.now() - (i + 2) * DAY + 3_600_000),
          expectedMinor: 0n,
          countedMinor: 0n,
          varianceMinor: 0n,
        },
      });
    }
  } finally {
    await client.$disconnect();
  }
}

const stateOf = async (shiftId: string) => {
  const client = db();
  try {
    return await client.phShift.findUniqueOrThrow({ where: { id: shiftId }, select: { status: true, approvedById: true, varianceMinor: true, closeReason: true } });
  } finally {
    await client.$disconnect();
  }
};

async function freshPage(browser: Browser, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

async function signInAndChoose(page: Page, user: StudioUser, shop: TestPharmacy, branch = 0): Promise<void> {
  await page.goto('/pharmacy');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shop.name }).getByRole('button').nth(branch).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
}

/** Screenshots at the three widths, and no sideways scroll at any of them. */
async function shoot(page: Page, label: string): Promise<void> {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/shifts-returns-${label}-en-${width}.png`, fullPage: true });
    expect(await scrollsSideways(page), `${label} at ${width}px`).toBe(false);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const SHOTS = process.env.SHOTS_DIR ?? 'test-results';
const shotPath = (name: string) => `${SHOTS}/shifts-returns-9b-${name}.png`;

/** An open dialog at 375 and 1280 px: a screenshot of the viewport, no sideways scroll and no serious axe violation. */
async function dialogShots(page: Page, name: string): Promise<void> {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: shotPath(`${name}-${width}`) });
    expect(await scrollsSideways(page), `${name} at ${width}px`).toBe(false);
    expect(await seriousViolations(page), `${name} at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** The server does the next Server Action on `url` and the browser never gets the answer (a dropped connection). */
async function dropNextAnswer(page: Page, url: string): Promise<void> {
  let dropped = false;
  await page.route(url, async (route) => {
    if (!dropped && route.request().method() === 'POST' && route.request().headers()['next-action']) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
}

const cashMovements = async (shiftId: string) => {
  const client = db();
  try {
    return await client.phCashMovement.count({ where: { shiftId, type: { in: ['PAID_IN', 'PAID_OUT'] } } });
  } finally {
    await client.$disconnect();
  }
};

/** One strip chosen from the search results and paid `tendered` in cash on the sale screen (an open shift is needed). */
async function sellStrip(page: Page, tendered: string): Promise<void> {
  await page.goto('/pharmacy/sell');
  await expect(page.getByTestId('shift-line')).toBeVisible();
  await page.getByTestId('sell-search').fill('Sellable');
  await page.getByTestId('result').first().getByTestId('add-unit').nth(1).click();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.keyboard.press('F4');
  await page.getByTestId('pay-tendered').fill(tendered);
  await page.getByTestId('pay-confirm').click();
  await expect(page.getByTestId('sale-done')).toBeVisible();
  await page.getByTestId('receipt-done').click();
}

test.describe('Pharmacy shifts, sales and returns @desktop', () => {
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

  async function owned(label: string, locale: 'en' | 'ar' = 'en', varianceLimit = 0n) {
    const shop = await makePharmacy(label, varianceLimit);
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-sr-owner', name: 'Shifts Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('open, sell, paid in and out, partial return, cancel the rest, reprint, close with a difference, history, report, filters', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = await owned('Flow');
    const name = await seedProduct(shop, randomUUID().slice(0, 6));
    await manyClosedShifts(shop, owner.userId, 21);
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);

    // The shifts page: no shift yet, so the opening panel (the same as the sale screen's).
    await page.getByRole('navigation').getByRole('link', { name: 'Shifts', exact: true }).click();
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await page.getByTestId('shift-float').fill('10,000');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('shift-card')).toBeVisible();
    await expect(page.getByTestId('expected-live')).toContainText('10,000');

    // A sale of one strip (2,000) paid with 5,000: change 3,000. Expected cash = 10,000 + 5,000 - 3,000.
    await sellStrip(page, '5000');
    await page.goto('/pharmacy/shifts');
    await expect(page.getByTestId('expected-live')).toContainText('12,000');
    await expect(page.getByTestId('cash-sales')).toContainText('5,000');
    await expect(page.getByTestId('cash-change')).toContainText('3,000');
    await expect(page.getByTestId('sales-count')).toContainText('1');

    // Paid in 1,000; paid out more than the drawer holds is refused with what is available; then a smaller one works.
    await page.getByTestId('paid-in-open').click();
    await page.getByTestId('cash-amount').fill('1000');
    await page.getByTestId('cash-reason').fill('Float top up');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('shift-notice')).toBeVisible();
    await expect(page.getByTestId('expected-live')).toContainText('13,000');
    await shoot(page, 'shifts');
    await page.getByTestId('paid-out-open').click();
    await page.getByTestId('cash-amount').fill('20000');
    await expect(page.getByTestId('cash-over')).toContainText('13,000');
    await page.getByTestId('cash-reason').fill('Supplier cash');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('cash-problem')).toContainText('13,000');
    await page.getByTestId('cash-amount').fill('500');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('expected-live')).toContainText('12,500');

    // The sale in the list and its detail.
    await page.getByRole('navigation').getByRole('link', { name: 'Sales', exact: true }).click();
    await expect(page.getByTestId('sale-row')).toHaveCount(1);
    await expect(page.getByTestId('sale-status-COMPLETED')).toBeVisible();
    await page.getByTestId('sale-number').click();
    await expect(page.getByTestId('sale-detail')).toBeVisible();
    await expect(page.getByTestId('sale-line')).toContainText(name);
    await expect(page.getByTestId('line-returned')).toContainText('Returned 0 of 10');
    await expect(page.getByTestId('detail-total')).toContainText('2,000');
    await expect(page.getByTestId('detail-change')).toContainText('3,000');
    await shoot(page, 'sale');

    // A partial return of 4 smallest units: the server's figure is shown first (800), then it is made.
    await page.getByTestId('sale-return').click();
    await expect(page.getByTestId('return-form')).toBeVisible();
    await page.getByTestId('return-qty').fill('٤');
    await expect(page.getByTestId('preview-refund')).toContainText('800');
    await page.getByTestId('return-qty').fill('11');
    await expect(page.getByTestId('return-confirm')).toBeDisabled();
    await page.getByTestId('return-qty').fill('4');
    await page.getByTestId('return-reason').fill('Box damaged');
    await shoot(page, 'return');
    await expect(page.getByTestId('return-method').locator('option')).toHaveCount(1);
    await page.getByTestId('return-confirm').click();
    await expect(page.getByTestId('return-done')).toBeVisible();
    await expect(page.getByTestId('done-refund')).toContainText('800');
    await page.getByTestId('slip-open').click();
    await expect(page.getByTestId('receipt-frame')).toBeVisible();
    await page.getByTestId('receipt-done').click();
    await page.getByTestId('back-to-sale').click();
    await expect(page.getByTestId('sale-status-RETURNED_PARTIAL')).toBeVisible();
    await expect(page.getByTestId('line-returned')).toContainText('Returned 4 of 10');
    await expect(page.getByTestId('sale-returns')).toContainText('800');

    // Cancel what is left: asks first, then the whole sale is returned (1,200 more).
    await page.getByTestId('sale-cancel').click();
    await expect(page.getByTestId('cancel-confirm')).toBeDisabled();
    await page.getByTestId('cancel-reason').fill('Customer left');
    await page.getByTestId('cancel-confirm').click();
    await expect(page.getByTestId('sale-status-RETURNED_FULL')).toBeVisible();
    await expect(page.getByTestId('line-returned')).toContainText('Returned 10 of 10');
    await expect(page.getByTestId('sale-return')).toHaveCount(0);
    await expect(page.getByTestId('nothing-to-return')).toBeVisible();

    // The receipt can be printed again: a COPY, logged.
    await page.getByTestId('sale-print').click();
    await expect(page.getByTestId('receipt-frame')).toBeVisible();
    await page.getByTestId('receipt-reprint').click();
    await expect(page.getByTestId('receipt-copy')).toContainText('Copy 1');
    await expect(page.getByTestId('reprint-logged')).toBeVisible();
    await page.getByTestId('receipt-done').click();

    // Sales list filters.
    await page.goto('/pharmacy/sales?status=RETURNED_FULL');
    await expect(page.getByTestId('sale-row')).toHaveCount(1);
    await page.goto('/pharmacy/sales?status=COMPLETED');
    await expect(page.getByTestId('sales-empty')).toBeVisible();
    await page.goto('/pharmacy/sales?number=NOPE-0');
    await expect(page.getByTestId('sales-empty')).toBeVisible();

    // Returns list and detail.
    await page.getByRole('navigation').getByRole('link', { name: 'Returns', exact: true }).click();
    await expect(page.getByTestId('return-row')).toHaveCount(2);
    await page.getByTestId('return-row').first().getByRole('link').click();
    await expect(page.getByTestId('return-detail')).toContainText('Customer left');

    // Close: expected = 12,500 - 800 - 1,200 = 10,500. Counting 10,000 is 500 short and needs a reason.
    await page.goto('/pharmacy/shifts');
    await expect(page.getByTestId('expected-live')).toContainText('10,500');
    await page.getByTestId('close-open').click();
    await page.getByTestId('close-counted').fill('10000');
    await expect(page.getByTestId('close-variance')).toContainText('Less cash than expected');
    await expect(page.getByTestId('close-variance')).toContainText('500');
    await expect(page.getByTestId('close-confirm')).toBeDisabled();
    await page.getByTestId('close-reason-input').fill('Counted short');
    await page.getByTestId('close-confirm').click();
    await expect(page.getByTestId('open-shift')).toBeVisible();

    // History: the closed shift with its difference; the report keeps the stored figures.
    await expect(page.getByTestId('shift-row').first()).toContainText('Closed');
    await expect(page.getByTestId('row-variance').first()).toContainText('500');
    await page.getByTestId('shift-open-report').first().click();
    await expect(page.getByTestId('cash-expected')).toContainText('10,500');
    await expect(page.getByTestId('cash-counted')).toContainText('10,000');
    await expect(page.getByTestId('variance')).toContainText('Less cash than expected');
    await shoot(page, 'report');
    await expect(page.getByTestId('close-reason')).toContainText('Counted short');
    await expect(page.getByTestId('returns-refund')).toContainText('2,000');

    // Pagination of the history by cursor: 22 shifts, 20 a page.
    await page.goto('/pharmacy/shifts');
    await expect(page.getByTestId('shift-row')).toHaveCount(20);
    await page.getByTestId('page-next').click();
    await expect(page.getByTestId('shift-row')).toHaveCount(2);
    await page.context().close();
  });

  test('a cashier cannot return (the screen says so), a difference above the limit goes to a manager who closes it', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop } = await owned('Approval', 'en', 500n);
    await seedProduct(shop, randomUUID().slice(0, 6));
    const cashier = await createStudioUser({ label: 'ph-sr-cashier', name: 'Shifts Cashier' });
    const manager = await createStudioUser({ label: 'ph-sr-manager', name: 'Shifts Manager' });
    people.push(cashier.email, manager.email);
    await makeStaff(cashier.userId, shop.id, 'CASHIER');
    await makeStaff(manager.userId, shop.id, 'BRANCH_MANAGER');
    const shiftId = await openShiftInDb(shop, cashier.userId, 1000n);

    const page = await freshPage(browser);
    await signInAndChoose(page, cashier, shop, 0);
    // The cashier's navigation has no Returns; sale detail says why there is no return.
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Returns', exact: true })).toHaveCount(0);
    await sellStrip(page, '2000');
    await page.goto('/pharmacy/sales');
    await page.getByTestId('sale-number').click();
    await expect(page.getByTestId('sale-detail')).toBeVisible();
    await expect(page.getByTestId('return-hidden')).toContainText('Your role cannot make returns');
    await expect(page.getByTestId('sale-return')).toHaveCount(0);
    await expect(page.getByTestId('sale-cancel')).toHaveCount(0);
    const saleUrl = page.url();
    await page.goto(`/pharmacy/returns/new?sale=${saleUrl.split('/').pop()}`);
    await expect(page.getByTestId('return-hidden')).toBeVisible();
    await expect(page.getByTestId('return-form')).toHaveCount(0);
    await page.goto('/pharmacy/returns');
    await expect(page.getByTestId('returns-forbidden')).toBeVisible();

    // Expected 1,000 + 2,000 = 3,000. Counting 100 is 2,900 short, above the limit of 500: the cashier is told to ask a manager.
    await page.goto('/pharmacy/shifts');
    await page.getByTestId('close-open').click();
    await page.getByTestId('close-counted').fill('100');
    await page.getByTestId('close-reason-input').fill('Drawer short');
    await page.getByTestId('close-confirm').click();
    await expect(page.getByTestId('needs-approval')).toContainText('Ask a manager');
    await expect(page.getByTestId('close-confirm')).toBeDisabled();
    expect((await stateOf(shiftId)).status).toBe('OPEN');
    await page.context().close();

    // The manager sees the open shift in the branch history and closes it, with a reason.
    const managerPage = await freshPage(browser);
    await signInAndChoose(managerPage, manager, shop, 0);
    await managerPage.goto('/pharmacy/shifts?status=OPEN');
    await expect(managerPage.getByTestId('shift-row')).toHaveCount(1);
    await managerPage.getByTestId('shift-open-report').click();
    await expect(managerPage.getByTestId('cash-expected')).toContainText('3,000');
    await managerPage.getByTestId('close-open').click();
    await managerPage.getByTestId('close-counted').fill('100');
    await expect(managerPage.getByTestId('close-confirm')).toBeDisabled();
    await managerPage.getByTestId('close-reason-input').fill('Counted with the cashier');
    await managerPage.getByTestId('close-confirm').click();
    await expect(managerPage.getByTestId('variance')).toContainText('Less cash than expected');
    const closed = await stateOf(shiftId);
    expect(closed.status).toBe('CLOSED');
    expect(closed.approvedById).toBe(manager.userId);
    expect(closed.varianceMinor).toBe(-2900n);
    await managerPage.context().close();
  });

  test('reads in Arabic right to left at 375, 768 and 1280px with no sideways scroll, and passes axe', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    await seedProduct(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const audit = async (label: string) => {
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: `test-results/shifts-returns-${label}-ar-${width}.png`, fullPage: true });
        expect(await scrollsSideways(page), `${label} at ${width}px`).toBe(false);
        expect(await seriousViolations(page), `${label} at ${width}px`).toEqual([]);
      }
    };

    await page.goto('/pharmacy/shifts');
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await audit('shifts-open');
    await page.getByTestId('shift-open').click();
    await expect(page.getByTestId('shift-card')).toBeVisible();
    await sellStrip(page, '2000');
    await page.goto('/pharmacy/shifts');
    await expect(page.getByTestId('shift-card')).toBeVisible();
    await audit('shifts');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByTestId('close-open').click();
    await page.getByTestId('close-counted').fill('1500');
    await expect(page.getByTestId('close-variance')).toBeVisible();
    expect(await seriousViolations(page), 'close dialog').toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByTestId('paid-out-open').click();
    await page.getByTestId('cash-amount').fill('99999');
    await expect(page.getByTestId('cash-over')).toBeVisible();
    expect(await seriousViolations(page), 'paid out dialog').toEqual([]);
    await page.keyboard.press('Escape');

    await page.goto('/pharmacy/sales');
    await expect(page.getByTestId('sale-row')).toHaveCount(1);
    await audit('sales');
    await page.getByTestId('sale-number').click();
    await expect(page.getByTestId('sale-detail')).toBeVisible();
    await audit('sale');
    await page.getByTestId('sale-return').click();
    await expect(page.getByTestId('return-form')).toBeVisible();
    await page.getByTestId('return-all').click();
    await expect(page.getByTestId('preview-refund')).toContainText('2,000');
    await page.getByTestId('return-reason').fill('سبب الإرجاع');
    await audit('return');
    await page.getByTestId('return-confirm').click();
    await expect(page.getByTestId('return-done')).toBeVisible();
    await audit('return-done');
    await page.goto('/pharmacy/returns');
    await expect(page.getByTestId('return-row')).toHaveCount(1);
    await audit('returns');
    await page.getByTestId('return-row').getByRole('link').click();
    await expect(page.getByTestId('return-detail')).toBeVisible();
    await audit('return-detail');
    await page.context().close();
  });

  test('a lost answer: the paid in is recorded once after the dialog was closed and reopened; a close that landed says so; a stale list address; a read-only pharmacy says why', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = await owned('Lost');
    await seedProduct(shop, randomUUID().slice(0, 6));
    const shiftId = await openShiftInDb(shop, owner.userId, 10_000n);
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/shifts');
    await expect(page.getByTestId('expected-live')).toContainText('10,000');

    // Paid in: the server records it, the browser never hears. The dialog is closed, opened again and the same movement typed again.
    await dropNextAnswer(page, '**/pharmacy/shifts');
    await page.getByTestId('paid-in-open').click();
    await page.getByTestId('cash-amount').fill('1000');
    await page.getByTestId('cash-reason').fill('Float top up');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('cash-problem')).toContainText('not known');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cash-amount')).toHaveCount(0);
    await page.getByTestId('paid-in-open').click();
    await page.getByTestId('cash-amount').fill('1000');
    await page.getByTestId('cash-reason').fill('Float top up');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('shift-notice')).toBeVisible();
    await expect(page.getByTestId('expected-live')).toContainText('11,000');
    expect(await cashMovements(shiftId)).toBe(1);

    // A different amount after a lost answer is a different movement (its own key): both are recorded.
    await dropNextAnswer(page, '**/pharmacy/shifts');
    await page.getByTestId('paid-in-open').click();
    await page.getByTestId('cash-amount').fill('200');
    await page.getByTestId('cash-reason').fill('Coins');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('cash-problem')).toContainText('not known');
    await page.keyboard.press('Escape');
    await page.getByTestId('paid-in-open').click();
    await page.getByTestId('cash-amount').fill('300');
    await page.getByTestId('cash-reason').fill('Coins');
    await page.getByTestId('cash-confirm').click();
    await expect(page.getByTestId('shift-notice')).toBeVisible();
    expect(await cashMovements(shiftId)).toBe(3);

    // The figures of the close dialog say when they were read, and can be read again.
    await page.getByTestId('close-open').click();
    await expect(page.getByTestId('close-as-of')).toContainText('UTC');
    await page.getByTestId('close-refresh').click();
    await expect(page.getByTestId('close-as-of')).toContainText('UTC');
    await expect(page.getByTestId('close-expected')).toContainText('11,500');

    // Close: the server closes the shift, the answer is lost, the person presses Close again: "it closed", no error.
    await dropNextAnswer(page, '**/pharmacy/shifts');
    await page.getByTestId('close-counted').fill('11500');
    await page.getByTestId('close-confirm').click();
    await expect(page.getByTestId('close-problem')).toContainText('not known');
    expect((await stateOf(shiftId)).status).toBe('CLOSED');
    await page.getByTestId('close-confirm').click();
    await expect(page.getByTestId('close-probably')).toContainText('probably');
    await expect(page.getByTestId('close-problem')).toHaveCount(0);
    await page.getByTestId('close-open-report').click();
    await expect(page.getByTestId('cash-counted')).toContainText('11,500');

    // A list address whose cursor the server no longer knows: a "page not found" state with a way to the first page.
    for (const path of ['shifts', 'sales', 'returns']) {
      await page.goto(`/pharmacy/${path}?cursor=nothing-here`);
      await expect(page.getByTestId('stale-cursor')).toBeVisible();
      await page.getByTestId('stale-first').click();
      await expect(page.getByTestId('stale-cursor')).toHaveCount(0);
    }

    // A read-only pharmacy: the sale detail says why there is no return or cancel.
    await openShiftInDb(shop, owner.userId, 0n);
    await sellStrip(page, '2000');
    const client = db();
    try {
      await client.subscription.updateMany({ where: { restaurantId: shop.id }, data: { currentPeriodEnd: new Date(Date.now() - 30 * DAY) } });
    } finally {
      await client.$disconnect();
    }
    await page.goto('/pharmacy/sales');
    await page.getByTestId('sale-number').first().click();
    await expect(page.getByTestId('sale-detail')).toBeVisible();
    await expect(page.getByTestId('sales-write-blocked')).toContainText('read only');
    await expect(page.getByTestId('sale-cancel')).toHaveCount(0);
    await expect(page.getByTestId('sale-return')).toHaveCount(0);
    await page.context().close();
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`evidence: the close, paid in/out, cancel and print dialogs and the returns list, ${locale}, at 375 and 1280px`, async ({ browser }) => {
      test.setTimeout(540_000);
      const { shop, owner } = await owned(`Vis ${locale}`, locale, 500n);
      await seedProduct(shop, randomUUID().slice(0, 6));
      const cashier = await createStudioUser({ label: 'ph-sr-vis-cashier', name: 'Vis Cashier', locale });
      people.push(cashier.email);
      await makeStaff(cashier.userId, shop.id, 'CASHIER');
      await openShiftInDb(shop, cashier.userId, 1000n);
      const reason = locale === 'ar' ? 'سبب تجريبي' : 'Because';

      // The cashier: sells, then the cash dialogs. Expected cash 1,000 + 2,000.
      const cashierPage = await freshPage(browser);
      await signInAndChoose(cashierPage, cashier, shop, 0);
      await sellStrip(cashierPage, '2000');
      await cashierPage.goto('/pharmacy/shifts');
      await expect(cashierPage.getByTestId('expected-live')).toContainText('3,000');
      await cashierPage.getByTestId('paid-in-open').click();
      await cashierPage.getByTestId('cash-amount').fill('500');
      await cashierPage.getByTestId('cash-reason').fill(reason);
      await dialogShots(cashierPage, `paid-in-${locale}`);
      await cashierPage.keyboard.press('Escape');
      await cashierPage.getByTestId('paid-out-open').click();
      await cashierPage.getByTestId('cash-amount').fill('99999');
      await cashierPage.getByTestId('cash-reason').fill(reason);
      await expect(cashierPage.getByTestId('cash-over')).toBeVisible();
      await dialogShots(cashierPage, `paid-out-${locale}`);
      await cashierPage.keyboard.press('Escape');
      await cashierPage.getByTestId('close-open').click();
      await cashierPage.getByTestId('close-counted').fill('100');
      await cashierPage.getByTestId('close-reason-input').fill(reason);
      await expect(cashierPage.getByTestId('close-variance')).toBeVisible();
      await dialogShots(cashierPage, `close-short-${locale}`);
      await cashierPage.getByTestId('close-confirm').click();
      await expect(cashierPage.getByTestId('needs-approval')).toBeVisible();
      await dialogShots(cashierPage, `close-needs-approval-${locale}`);
      await cashierPage.context().close();

      // The owner: the sale's cancel and print dialogs, then the cancel itself, then the returns list with its row.
      await openShiftInDb(shop, owner.userId, 0n);
      const page = await freshPage(browser);
      await signInAndChoose(page, owner, shop, 1);
      await page.goto('/pharmacy/sales');
      await expect(page.getByTestId('sale-row')).toHaveCount(1);
      await page.getByTestId('sale-number').click();
      await expect(page.getByTestId('sale-detail')).toBeVisible();
      await page.getByTestId('sale-cancel').click();
      await expect(page.getByTestId('cancel-refund')).toContainText('2,000');
      await page.getByTestId('cancel-reason').fill(reason);
      await dialogShots(page, `cancel-${locale}`);
      await page.getByTestId('cancel-confirm').click();
      await expect(page.getByTestId('sale-status-RETURNED_FULL')).toBeVisible();
      await page.getByTestId('sale-print').click();
      await expect(page.getByTestId('receipt-frame')).toBeVisible();
      await dialogShots(page, `print-${locale}`);
      await page.getByTestId('receipt-done').click();
      await page.goto('/pharmacy/returns');
      await expect(page.getByTestId('return-row')).toHaveCount(1);
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByTestId('return-row')).toBeVisible();
        await page.screenshot({ path: shotPath(`returns-list-${locale}-${width}`), fullPage: true });
        expect(await scrollsSideways(page), `returns list at ${width}px`).toBe(false);
      }
      await page.context().close();
    });
  }
});
