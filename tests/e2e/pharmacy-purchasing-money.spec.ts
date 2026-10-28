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
  setUserLocale,
  uniqueClientAddress,
  type StudioUser,
} from './helpers/studio';

/**
 * The pharmacy purchasing money screens: a supplier's invoices, what is owed, payments (recorded in the books only),
 * credit notes, returns to a supplier and the statement. One serial run follows the money: two invoices from received
 * goods, a refused duplicate, a part payment placed oldest-due-first, the statement against hand figures, a reversal
 * that restores the balances, a void, a credit note applied, a return refused for lack of stock. A stock clerk and a
 * cashier are limited, a pharmacy past its grace is read-only, and the new screens pass axe and do not scroll sideways
 * at 375, 768 and 1280 px in English and Arabic. The last test covers what the order screens left unchecked: the order
 * detail and the receive-against-order editor in both languages, NOT_ON_ORDER and OVER_RECEIPT in words, and the
 * order screens in a read-only pharmacy. Everything is written straight to the development database and removed
 * afterwards. Screenshots go to PURCHASING_SHOTS when it is set.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const SHOTS = process.env.PURCHASING_SHOTS;
const WIDTHS = [375, 768, 1280] as const;
const dayText = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

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

/** The pharmacy's subscription ended `endedDaysAgo` days ago (more than the 7 grace days reads as read-only); a negative number reopens it. */
async function endSubscription(shop: TestPharmacy, endedDaysAgo: number): Promise<void> {
  const client = db();
  try {
    await client.subscription.updateMany({ where: { restaurantId: shop.id }, data: { currentPeriodEnd: new Date(Date.now() - endedDaysAgo * DAY) } });
  } finally {
    await client.$disconnect();
  }
}

async function makeProduct(shop: TestPharmacy, name: string, minQty = 0): Promise<{ id: string; unitIds: string[] }> {
  const client = db();
  try {
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
    const unitIds: string[] = [];
    for (const [level, label, baseQty] of [
      [0, 'tablet', 1],
      [1, 'box', 30],
    ] as const) {
      const unit = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level, label, baseQty }, select: { id: true } });
      unitIds.push(unit.id);
    }
    if (minQty > 0) await client.phProductBranch.create({ data: { restaurantId: shop.id, branchId: shop.branchIds[0]!, productId: product.id, minQty, reorderQty: 0 } });
    return { id: product.id, unitIds };
  } finally {
    await client.$disconnect();
  }
}

interface Seeded {
  supplierId: string;
  supplierName: string;
  productA: string;
  productB: string;
  batchB: string;
}

/**
 * A supplier (IQD, 30 day terms) and one confirmed receipt of two lines at the first branch: product A, 100 tablets at
 * 2,000 (200,000), and product B, 50 tablets at 1,000 (50,000), each in stock. Written directly so the money screens
 * start from received goods without the receiving screens.
 */
async function seedReceived(shop: TestPharmacy, userId: string): Promise<Seeded> {
  const client = db();
  try {
    const supplierName = `Al Noor ${randomUUID().slice(0, 5)}`;
    const supplier = await client.phSupplier.create({
      data: { restaurantId: shop.id, name: supplierName, nameKey: supplierName.toLowerCase(), defaultCurrency: 'IQD', termsDays: 30, clientKey: `e2e-${randomUUID()}`, createdById: userId },
      select: { id: true },
    });
    const productA = `Alpha ${randomUUID().slice(0, 5)}`;
    const productB = `Beta ${randomUUID().slice(0, 5)}`;
    const a = await makeProduct(shop, productA);
    const b = await makeProduct(shop, productB);
    const branchId = shop.branchIds[0]!;
    const receipt = await client.phReceipt.create({
      data: {
        restaurantId: shop.id,
        branchId,
        status: 'CONFIRMED',
        clientKey: `e2e-${randomUUID()}`,
        supplierName,
        supplierId: supplier.id,
        receivedOn: new Date(dayText(0)),
        createdById: userId,
        confirmedById: userId,
        confirmedAt: new Date(),
        number: 'R-000001',
      },
      select: { id: true },
    });
    let batchB = '';
    for (const [lineNo, p, qty, cost, lot] of [
      [1, a, 100, 2000n, 'LA1'],
      [2, b, 50, 1000n, 'LB1'],
    ] as const) {
      const expiry = new Date(dayText(400));
      const batch = await client.phBatch.create({
        data: { restaurantId: shop.id, productId: p.id, lot, expiryDate: expiry, supplierName, unitCostMinor: cost, costCurrency: 'IQD', costUnitId: p.unitIds[0]! },
        select: { id: true },
      });
      const line = await client.phReceiptLine.create({
        data: { restaurantId: shop.id, receiptId: receipt.id, lineNo, productId: p.id, unitId: p.unitIds[0]!, qty, baseQty: qty, lot, expiryDate: expiry, unitCostMinor: cost, costCurrency: 'IQD', batchId: batch.id },
        select: { id: true },
      });
      await client.phBatch.update({ where: { id: batch.id }, data: { receiptLineId: line.id } });
      await client.phStockBalance.create({ data: { restaurantId: shop.id, branchId, productId: p.id, batchId: batch.id, available: qty } });
      if (p === b) batchB = batch.id;
    }
    return { supplierId: supplier.id, supplierName, productA, productB, batchB };
  } finally {
    await client.$disconnect();
  }
}

async function setAvailable(shop: TestPharmacy, batchId: string, available: number): Promise<void> {
  const client = db();
  try {
    await client.phStockBalance.updateMany({ where: { restaurantId: shop.id, batchId }, data: { available } });
  } finally {
    await client.$disconnect();
  }
}

async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER' | 'STOCK'): Promise<void> {
  const client = db();
  try {
    const branches = await client.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    for (const branch of branches) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch.id } });
  } finally {
    await client.$disconnect();
  }
}

async function freshPage(browser: Browser, viewport: { width: number; height: number } = { width: 1280, height: 900 }): Promise<Page> {
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

/** At 375, 768 and 1280 px: no sideways scroll and no serious axe violation. Screenshots when `shot` names the screen. */
async function checkWidths(page: Page, url: string, lang: 'en' | 'ar', shot?: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    expect(await scrollsSideways(page), `${lang} ${url} at ${width}px`).toBe(false);
    expect(await seriousViolations(page), `${lang} ${url} at ${width}px`).toEqual([]);
    if (shot) await shoot(page, `${lang}-${shot}-${width}`);
  }
}

test.describe('Pharmacy purchasing money @desktop', () => {
  // One worker, one order: each worker's hooks switch the shared pharmacy application on and then put it back, and the
  // tests below follow one pharmacy's money from the first invoice to the last return.
  test.describe.configure({ mode: 'serial' });
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;

  /** What the money run leaves behind for the tests after it. */
  const money: {
    shop?: TestPharmacy;
    owner?: StudioUser;
    seeded?: Seeded;
    invoiceA1?: string;
    invoiceA2?: string;
    paymentUrl?: string;
    creditUrl?: string;
    returnUrl?: string;
  } = {};

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
    const owner = await createStudioUser({ label: 'ph-money-owner', name: 'Money Owner' });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  /** The invoice entry screen with the supplier chosen, then the lines of `products` ticked. */
  async function tickLines(page: Page, supplierId: string, products: string[]): Promise<void> {
    await page.goto(`/pharmacy/purchasing/invoices/new?supplier=${supplierId}`);
    await expect(page.getByTestId('invoice-editor')).toBeVisible();
    for (const product of products) {
      await page.getByTestId('invoice-line').filter({ hasText: product }).getByTestId('invoice-line-check').check();
    }
  }

  test('receive, invoice twice (one duplicate refused), pay in part, statement equals hand figures, reverse, void, credit, return', async ({ browser }) => {
    test.setTimeout(420_000);
    const { shop, owner } = await owned('Money');
    const seeded = await seedReceived(shop, owner.userId);
    Object.assign(money, { shop, owner, seeded });
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);

    // The hub's invoice, payment, credit and return cards are real links now.
    await page.getByRole('navigation').getByRole('link', { name: 'Purchasing' }).click();
    for (const id of ['hub-invoices', 'hub-payments', 'hub-credits', 'hub-returns']) await expect(page.getByTestId(id).getByRole('link').first()).toBeVisible();
    await shoot(page, 'en-hub-1280');

    // Invoice 1 bills product A: 100 x 2,000 = 200,000, due in 10 days.
    await page.goto('/pharmacy/purchasing/invoices');
    await expect(page.getByTestId('invoices-empty')).toBeVisible();
    await shoot(page, 'en-invoices-empty-1280');
    await page.getByTestId('invoice-new').first().click();
    await page.getByTestId('invoice-supplier').selectOption({ label: seeded.supplierName });
    await page.getByTestId('invoice-supplier-go').click();
    await expect(page.getByTestId('invoice-editor')).toBeVisible();
    await page.getByTestId('invoice-line').filter({ hasText: seeded.productA }).getByTestId('invoice-line-check').check();
    await page.getByTestId('invoice-line').filter({ hasText: seeded.productA }).getByTestId('invoice-cost').fill('2000');
    await page.getByTestId('invoice-number').fill('INV-A1');
    await page.getByTestId('invoice-due').fill(dayText(10));
    await expect(page.getByTestId('invoice-totals')).toContainText('200,000');
    await shoot(page, 'en-invoice-new-1280');
    await page.getByTestId('invoice-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/invoices\/(?!new$)[^/?]+$/);
    money.invoiceA1 = new URL(page.url()).pathname.split('/').pop();
    await expect(page.getByTestId('invoice-total')).toContainText('200,000');
    await expect(page.getByTestId('invoice-balance')).toContainText('200,000');
    await expect(page.locator('[data-chip="OPEN"]')).toBeVisible();

    // Invoice 2 bills product B (50 x 1,000 = 50,000). The same number from the same supplier is refused with a way to the first.
    await tickLines(page, seeded.supplierId, [seeded.productB]);
    await page.getByTestId('invoice-line').filter({ hasText: seeded.productB }).getByTestId('invoice-cost').fill('1000');
    await page.getByTestId('invoice-number').fill('INV-A1');
    await page.getByTestId('invoice-save').click();
    await expect(page.getByTestId('invoice-error')).toContainText('already entered');
    await expect(page.getByTestId('invoice-existing')).toHaveAttribute('href', new RegExp(`/invoices/${money.invoiceA1}$`));
    await expect(page).toHaveURL(/invoices\/new/);
    await page.getByTestId('invoice-number').fill('INV-A2');
    await page.getByTestId('invoice-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/invoices\/(?!new$)[^/?]+$/);
    money.invoiceA2 = new URL(page.url()).pathname.split('/').pop();
    await expect(page.getByTestId('invoice-total')).toContainText('50,000');

    // What is owed: both invoices, 250,000 in IQD, each currency on its own.
    await page.goto('/pharmacy/purchasing/payables');
    await expect(page.getByTestId('payable-row')).toHaveCount(2);
    await expect(page.getByTestId('payables-total-IQD')).toContainText('250,000');
    await shoot(page, 'en-payables-1280');

    // Pay 220,000 with "oldest due first": INV-A1 (due first) in full, INV-A2 20,000. Books only, said on screen.
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded.supplierId}&currency=IQD`);
    await expect(page.getByTestId('payment-form')).toBeVisible();
    await expect(page.getByTestId('payment-books-only')).toContainText('Recorded in the books only: no cash leaves the drawer');
    await page.getByTestId('pay-amount').fill('220000');
    await expect(page.getByTestId('alloc-status')).toBeVisible();
    await shoot(page, 'en-payment-new-1280');
    await page.getByTestId('pay-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/payments\/(?!new$)[^/?]+$/);
    money.paymentUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('payment-allocations')).toContainText('INV-A1');
    await expect(page.getByTestId('payment-allocations')).toContainText('200,000');
    await expect(page.getByTestId('payment-allocations')).toContainText('INV-A2');
    await expect(page.getByTestId('payment-allocations')).toContainText('20,000');
    await shoot(page, 'en-payment-1280');
    await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA1}`);
    await expect(page.locator('[data-chip="PAID"]')).toBeVisible();
    await expect(page.getByTestId('invoice-balance')).toContainText(/(^|\D)0(\D|$)/);
    await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA2}`);
    await expect(page.locator('[data-chip="PARTIAL"]')).toBeVisible();
    await expect(page.getByTestId('invoice-paid')).toContainText('20,000');
    await expect(page.getByTestId('invoice-balance')).toContainText('30,000');

    // The statement against hand figures: 200,000 + 50,000 billed, 220,000 paid, 30,000 owed, the check agrees.
    const statement = `/pharmacy/purchasing/suppliers/${seeded.supplierId}/statement?currency=IQD`;
    await page.goto(statement);
    await expect(page.getByTestId('statement-row')).toHaveCount(3);
    await expect(page.getByTestId('statement-opening')).toContainText(/(^|\D)0(\D|$)/);
    await expect(page.getByTestId('statement-closing')).toContainText('30,000');
    await expect(page.getByTestId('statement-direction')).toContainText('You owe the supplier');
    await expect(page.getByTestId('statement-invariant-ok')).toBeVisible();
    await shoot(page, 'en-statement-1280');

    // Reverse the payment: both invoices owe again, the original payment says reversed, the statement returns to 250,000.
    await page.goto(money.paymentUrl);
    await page.getByTestId('reverse-open').click();
    await page.getByTestId('reverse-reason').fill('Paid the wrong supplier');
    await page.getByTestId('reverse-confirm').click();
    await expect(page.locator('[data-chip="REVERSED"]').first()).toBeVisible();
    await page.goto('/pharmacy/purchasing/payables');
    await expect(page.getByTestId('payables-total-IQD')).toContainText('250,000');
    await page.goto(statement);
    await expect(page.getByTestId('statement-row')).toHaveCount(4);
    await expect(page.getByTestId('statement-closing')).toContainText('250,000');
    await expect(page.getByTestId('statement-invariant-ok')).toBeVisible();
    await page.goto('/pharmacy/purchasing/payments');
    await expect(page.getByTestId('payment-row')).toHaveCount(1);
    await page.getByTestId('payments-with-reversals').click();
    await expect(page.getByTestId('payment-row')).toHaveCount(2);

    // Void INV-A2 with a reason: it leaves what is owed and its goods can be invoiced again.
    await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA2}`);
    await page.getByTestId('void-open').click();
    await page.getByTestId('void-reason').fill('Entered against the wrong goods');
    await page.getByTestId('void-confirm').click();
    await expect(page.locator('[data-chip="VOID"]')).toBeVisible();
    await page.goto('/pharmacy/purchasing/payables');
    await expect(page.getByTestId('payables-total-IQD')).toContainText('200,000');
    await tickLines(page, seeded.supplierId, [seeded.productB]);
    await expect(page.getByTestId('invoice-line').filter({ hasText: seeded.productB })).toBeVisible();

    // A credit note of 50,000, then applied to INV-A1.
    await page.goto('/pharmacy/purchasing/credits/new');
    await page.getByTestId('credit-supplier').selectOption({ label: seeded.supplierName });
    await page.getByTestId('credit-supplier-go').click();
    await page.getByTestId('cr-number').fill('CN-1');
    await page.getByTestId('cr-amount').fill('50000');
    await shoot(page, 'en-credit-new-1280');
    await page.getByTestId('cr-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/credits\/(?!new$)[^/?]+$/);
    money.creditUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('credit-left')).toContainText('50,000');
    await page.getByTestId('apply-open').click();
    await page.getByTestId('apply-confirm').click();
    await expect(page.getByTestId('apply-done')).toBeVisible();
    await expect(page.getByTestId('credit-left')).toContainText(/(^|\D)0(\D|$)/);
    await expect(page.getByTestId('credit-applications')).toContainText('INV-A1');
    await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA1}`);
    await expect(page.getByTestId('invoice-credited')).toContainText('50,000');
    await expect(page.getByTestId('invoice-balance')).toContainText('150,000');

    // A return to the supplier: stock that fell below the quantity after the line was added is refused in words, then the right quantity goes.
    await page.goto('/pharmacy/purchasing/returns/new');
    await expect(page.getByTestId('return-form')).toBeVisible();
    await page.getByTestId('ret-supplier').selectOption({ label: seeded.supplierName });
    await page.getByTestId('ret-reason').fill('Damaged boxes');
    await page.getByTestId('ret-search').fill(seeded.productB);
    await page.getByTestId('ret-search-go').click();
    await page.getByTestId('ret-result').first().getByTestId('ret-add').click();
    await page.getByTestId('ret-qty').fill('40');
    await setAvailable(shop, seeded.batchB, 10);
    await shoot(page, 'en-return-new-1280');
    await page.getByTestId('ret-save').click();
    await expect(page.getByTestId('return-error')).toContainText('Not enough stock');
    await page.getByTestId('ret-qty').fill('10');
    await page.getByTestId('ret-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/returns\/(?!new$)[^/?]+$/);
    money.returnUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('return-lines')).toContainText('10');
    await page.goto('/pharmacy/purchasing/returns');
    await expect(page.getByTestId('return-row')).toHaveCount(1);

    // Void left INV-A2 out of the statement total: INV-A1 200,000 less the 50,000 credit.
    await page.goto(statement);
    await expect(page.getByTestId('statement-invariant-ok')).toBeVisible();
    await expect(page.getByTestId('statement-closing')).toContainText('150,000');

    // Leave one live payment (1,000, can still be reversed) and one unused credit note (5,000) for the tests that follow.
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded.supplierId}&currency=IQD`);
    await page.getByTestId('pay-amount').fill('1000');
    await page.getByTestId('pay-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/payments\/(?!new$)[^/?]+$/);
    money.paymentUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('reverse-open')).toBeVisible();
    await page.goto(`/pharmacy/purchasing/credits/new?supplier=${seeded.supplierId}`);
    await page.getByTestId('cr-number').fill('CN-2');
    await page.getByTestId('cr-amount').fill('5000');
    await page.getByTestId('cr-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/credits\/(?!new$)[^/?]+$/);
    money.creditUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('apply-open')).toBeVisible();
    await page.context().close();
  });

  test('a stock clerk can look but not pay, void, reverse or use credit; a cashier sees none of it', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, seeded } = money;
    expect(shop && seeded && money.invoiceA1 && money.paymentUrl && money.creditUrl, 'the money run before this one left its records').toBeTruthy();
    const clerk = await createStudioUser({ label: 'ph-money-stock', name: 'Money Stock' });
    people.push(clerk.email);
    await makeStaff(clerk.userId, shop!.id, 'STOCK');
    const page = await freshPage(browser);
    await signInAndChoose(page, clerk, shop!, 1);
    await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA1}`);
    await expect(page.getByTestId('invoice-money-locked')).toBeVisible();
    await expect(page.getByTestId('invoice-pay')).toHaveCount(0);
    await expect(page.getByTestId('void-open')).toHaveCount(0);
    await page.goto(money.paymentUrl!);
    await expect(page.getByTestId('payment-money-locked')).toBeVisible();
    await expect(page.getByTestId('reverse-open')).toHaveCount(0);
    await page.goto(money.creditUrl!);
    await expect(page.getByTestId('credit-money-locked')).toBeVisible();
    await expect(page.getByTestId('apply-open')).toHaveCount(0);
    for (const url of ['/pharmacy/purchasing/payments/new', '/pharmacy/purchasing/credits/new']) {
      await page.goto(url);
      await expect(page.getByTestId(url.includes('payments') ? 'payment-money-locked' : 'credit-money-locked')).toBeVisible();
    }
    await page.context().close();

    const cashier = await createStudioUser({ label: 'ph-money-cashier', name: 'Money Cashier' });
    people.push(cashier.email);
    await makeStaff(cashier.userId, shop!.id, 'CASHIER');
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop!, 1);
    for (const url of [
      '/pharmacy/purchasing/invoices',
      '/pharmacy/purchasing/invoices/new',
      `/pharmacy/purchasing/invoices/${money.invoiceA1}`,
      '/pharmacy/purchasing/payables',
      '/pharmacy/purchasing/payments',
      '/pharmacy/purchasing/payments/new',
      money.paymentUrl!,
      '/pharmacy/purchasing/credits',
      '/pharmacy/purchasing/credits/new',
      money.creditUrl!,
      '/pharmacy/purchasing/returns',
      '/pharmacy/purchasing/returns/new',
      money.returnUrl!,
      `/pharmacy/purchasing/suppliers/${seeded!.supplierId}/statement`,
    ]) {
      await till.goto(url);
      await expect(till.getByTestId('purchasing-forbidden'), url).toContainText('Purchasing is not available to you');
    }
    await till.context().close();
  });

  for (const lang of ['en', 'ar'] as const) {
    test(`the money screens read ${lang === 'ar' ? 'right to left ' : ''}with no sideways scroll at 375, 768 and 1280px and pass axe in ${lang === 'ar' ? 'Arabic' : 'English'}`, async ({ browser }) => {
      test.setTimeout(420_000);
      const { shop, owner, seeded } = money;
      expect(shop && owner && seeded && money.invoiceA1 && money.paymentUrl, 'the money run before this one left its records').toBeTruthy();
      if (lang === 'ar') await setUserLocale(owner!.userId, 'ar');
      const page = await freshPage(browser, { width: 375, height: 800 });
      await signInAndChoose(page, owner!, shop!, 1);
      if (lang === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const screens: Array<[string, string]> = [
        ['/pharmacy/purchasing', 'hub'],
        ['/pharmacy/purchasing/invoices', 'invoices'],
        [`/pharmacy/purchasing/invoices/new?supplier=${seeded!.supplierId}`, 'invoice-new'],
        [`/pharmacy/purchasing/invoices/${money.invoiceA1}`, 'invoice'],
        ['/pharmacy/purchasing/payables', 'payables'],
        [`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD`, 'payment-new'],
        ['/pharmacy/purchasing/payments', 'payments'],
        [money.paymentUrl!, 'payment'],
        ['/pharmacy/purchasing/credits', 'credits'],
        [money.creditUrl!, 'credit'],
        ['/pharmacy/purchasing/returns', 'returns'],
        ['/pharmacy/purchasing/returns/new', 'return-new'],
        [money.returnUrl!, 'return'],
        [`/pharmacy/purchasing/suppliers/${seeded!.supplierId}`, 'supplier'],
        [`/pharmacy/purchasing/suppliers/${seeded!.supplierId}/statement?currency=IQD`, 'statement'],
      ];
      for (const [url, shot] of screens) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await checkWidths(page, url, lang, shot);
      }
      // The payment dialog with the allocation preview open on explicit amounts, and the apply-credit panel.
      await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD&invoice=${money.invoiceA1}`);
      await expect(page.getByTestId('payment-form')).toBeVisible();
      await checkWidths(page, 'payment-new explicit', lang);
      // Money direction in words, not only a sign.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/pharmacy/purchasing/suppliers/${seeded!.supplierId}/statement?currency=IQD`);
      await expect(page.getByTestId('statement-direction')).toContainText(lang === 'ar' ? 'أنت مدين للمورد' : 'You owe the supplier');
      await page.context().close();
      if (lang === 'ar') await setUserLocale(owner!.userId, 'en');
    });
  }

  test('a pharmacy past its grace period is read-only on the money screens: the reason in words and no controls', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, seeded } = money;
    expect(shop && owner && seeded && money.invoiceA1 && money.paymentUrl && money.creditUrl, 'the money run before this one left its records').toBeTruthy();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner!, shop!, 1);
    await endSubscription(shop!, 10);
    try {
      const blocked = (testid = 'receive-write-blocked') => expect(page.getByTestId(testid).first()).toBeVisible();
      await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA1}`);
      await blocked();
      await expect(page.getByTestId('invoice-pay')).toHaveCount(0);
      await expect(page.getByTestId('void-open')).toHaveCount(0);
      await page.goto(money.paymentUrl!);
      await blocked();
      await expect(page.getByTestId('reverse-open')).toHaveCount(0);
      await page.goto(money.creditUrl!);
      await blocked();
      await expect(page.getByTestId('apply-open')).toHaveCount(0);
      for (const [url, absent] of [
        ['/pharmacy/purchasing/invoices/new', 'invoice-editor'],
        [`/pharmacy/purchasing/invoices/new?supplier=${seeded!.supplierId}`, 'invoice-editor'],
        [`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD`, 'payment-form'],
        [`/pharmacy/purchasing/credits/new?supplier=${seeded!.supplierId}`, 'credit-form'],
        ['/pharmacy/purchasing/returns/new', 'return-form'],
        ['/pharmacy/purchasing/orders/new', 'po-editor'],
      ] as const) {
        await page.goto(url);
        await blocked();
        await expect(page.getByTestId(absent), url).toHaveCount(0);
      }
      // The data stays readable.
      await page.goto('/pharmacy/purchasing/payables');
      await expect(page.getByTestId('payable-row')).toHaveCount(1);
      await page.goto(`/pharmacy/purchasing/suppliers/${seeded!.supplierId}/statement?currency=IQD`);
      await expect(page.getByTestId('statement-row').first()).toBeVisible();
      await shoot(page, 'en-read-only-1280');
      await page.goto('/pharmacy/purchasing/invoices');
      await page.setViewportSize({ width: 375, height: 800 });
      await shoot(page, 'en-read-only-375');
    } finally {
      await endSubscription(shop!, -29);
    }
    await page.context().close();
  });

  test('order detail and the receive-against-order editor: axe and no sideways scroll in both languages, NOT_ON_ORDER and OVER_RECEIPT in words, order screens read-only past grace', async ({ browser }) => {
    test.setTimeout(480_000);
    const { shop, owner } = await owned('Order');
    const lowName = `Reorder ${randomUUID().slice(0, 6)}`;
    await makeProduct(shop, lowName, 50);
    const supplierName = `Order Supplier ${randomUUID().slice(0, 5)}`;
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);

    // A supplier and an order of 50 tablets placed, 20 received, so the order is open with room for 30.
    await page.goto('/pharmacy/purchasing/suppliers/new');
    await page.getByLabel('Name', { exact: true }).fill(supplierName);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/suppliers\/(?!new$)[^/]+$/);
    await page.goto('/pharmacy/purchasing/orders/new');
    await page.getByRole('button', { name: 'Show what is low' }).click();
    await expect(page.getByTestId('po-suggest-list')).toContainText(lowName);
    await page.getByTestId('po-suggest-add').click();
    await page.getByTestId('po-supplier').selectOption({ label: supplierName });
    await page.getByTestId('po-line').getByTestId('po-cost').fill('2500');
    await page.getByTestId('po-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/orders\/(?!new$)[^/]+$/);
    const orderUrl = new URL(page.url()).pathname;
    await page.getByTestId('po-order').click();
    await page.getByRole('button', { name: 'Place the order' }).click();
    await expect(page.getByTestId('order-status')).toContainText('Ordered');
    await page.getByTestId('po-receive').click();
    await expect(page.getByTestId('receipt-editor')).toBeVisible();
    const receiveUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    const row = page.getByTestId('receipt-line');
    await row.locator('input[data-nav="qty"]').fill('20');
    await row.locator('input[data-nav="lot"]').fill('o-1');
    await row.locator('input[data-nav="expiry"]').fill(futureMonth());
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await page.getByTestId('receipt-confirm').getByRole('button', { name: 'Confirm and add to stock' }).click();
    await expect(page.getByTestId('receipt-number')).toBeVisible();

    // OVER_RECEIPT: 40 more where the order allows 30.
    await page.goto(receiveUrl);
    await expect(page.getByTestId('receipt-editor')).toBeVisible();
    const again = page.getByTestId('receipt-line');
    await again.locator('input[data-nav="qty"]').fill('40');
    await again.locator('input[data-nav="lot"]').fill('o-2');
    await again.locator('input[data-nav="expiry"]').fill(futureMonth());
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await page.getByTestId('receipt-confirm').getByRole('button', { name: 'Confirm and add to stock' }).click();
    await expect(page.getByTestId('receipt-error')).toContainText('More was entered than the order still allows');
    await shoot(page, 'en-receive-over-receipt-1280');

    // NOT_ON_ORDER: the order line's unit changes under the open editor, so the line no longer matches the order.
    const client = db();
    try {
      const orderId = orderUrl.split('/').pop()!;
      const line = await client.phPurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: orderId }, select: { id: true, productId: true } });
      const box = await client.phProductUnit.findFirstOrThrow({ where: { productId: line.productId, label: 'box' }, select: { id: true } });
      await client.phPurchaseOrderLine.update({ where: { id: line.id }, data: { unitId: box.id } });
    } finally {
      await client.$disconnect();
    }
    await again.locator('input[data-nav="qty"]').fill('5');
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await page.getByTestId('receipt-confirm').getByRole('button', { name: 'Confirm and add to stock' }).click();
    await expect(page.getByText(/This product is not on the order/).first()).toBeVisible();
    await shoot(page, 'en-receive-not-on-order-1280');
    const client2 = db();
    try {
      const orderId = orderUrl.split('/').pop()!;
      const line = await client2.phPurchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: orderId }, select: { id: true, productId: true } });
      const tablet = await client2.phProductUnit.findFirstOrThrow({ where: { productId: line.productId, label: 'tablet' }, select: { id: true } });
      await client2.phPurchaseOrderLine.update({ where: { id: line.id }, data: { unitId: tablet.id } });
    } finally {
      await client2.$disconnect();
    }

    // Axe and no sideways scroll on the order detail and the receive editor, English first.
    await page.goto(orderUrl);
    await expect(page.getByTestId('order-status')).toContainText('Partly received');
    await checkWidths(page, orderUrl, 'en', 'order');
    await page.goto(receiveUrl);
    await expect(page.getByTestId('receipt-editor')).toBeVisible();
    await checkWidths(page, receiveUrl, 'en', 'receive-order');

    // Read-only past grace: the order screens say why and draw no controls.
    await endSubscription(shop, 10);
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(orderUrl);
      await expect(page.getByTestId('receive-write-blocked').first()).toBeVisible();
      await expect(page.getByTestId('po-receive')).toHaveCount(0);
      await page.goto('/pharmacy/purchasing/orders/new');
      await expect(page.getByTestId('receive-write-blocked').first()).toBeVisible();
      await expect(page.getByTestId('po-editor')).toHaveCount(0);
      await page.goto('/pharmacy/purchasing/suppliers/new');
      await expect(page.getByTestId('receive-write-blocked').first()).toBeVisible();
      await shoot(page, 'en-order-read-only-1280');
    } finally {
      await endSubscription(shop, -29);
    }
    await page.context().close();

    // The same two screens in Arabic.
    await setUserLocale(owner.userId, 'ar');
    const arabic = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(arabic, owner, shop, 1);
    await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
    await arabic.goto(orderUrl);
    await expect(arabic.getByTestId('order-status')).toBeVisible();
    await checkWidths(arabic, orderUrl, 'ar', 'order');
    await arabic.goto(receiveUrl);
    await expect(arabic.getByTestId('receipt-editor')).toBeVisible();
    await checkWidths(arabic, receiveUrl, 'ar', 'receive-order');
    await arabic.context().close();
    await setUserLocale(owner.userId, 'en');
  });
});
