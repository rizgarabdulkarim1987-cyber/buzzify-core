import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
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

interface SeededUsd {
  supplierId: string;
  supplierName: string;
  productU1: string;
  productU2: string;
  productIqd: string;
}

/**
 * A second supplier (USD, 14 day terms) and one confirmed receipt of three lines at the first branch: U1 20 at 2.50 USD,
 * U2 10 at 1.00 USD, and one line costed in IQD (5 at 1,000), so a USD invoice cannot take it. USD is switched on for the
 * pharmacy. Written directly, like `seedReceived`.
 */
async function seedUsd(shop: TestPharmacy, userId: string): Promise<SeededUsd> {
  const client = db();
  try {
    await client.phSettings.upsert({
      where: { restaurantId: shop.id },
      create: { restaurantId: shop.id, enabledCurrencies: ['IQD', 'USD'], defaultCurrency: 'IQD' },
      update: { enabledCurrencies: ['IQD', 'USD'] },
    });
    const supplierName = `Dollar ${randomUUID().slice(0, 5)}`;
    const supplier = await client.phSupplier.create({
      data: { restaurantId: shop.id, name: supplierName, nameKey: supplierName.toLowerCase(), defaultCurrency: 'USD', termsDays: 14, clientKey: `e2e-${randomUUID()}`, createdById: userId },
      select: { id: true },
    });
    const names = [`Uno ${randomUUID().slice(0, 5)}`, `Duo ${randomUUID().slice(0, 5)}`, `Tri ${randomUUID().slice(0, 5)}`];
    const products = [await makeProduct(shop, names[0]!), await makeProduct(shop, names[1]!), await makeProduct(shop, names[2]!)];
    const branchId = shop.branchIds[0]!;
    const receipt = await client.phReceipt.create({
      data: { restaurantId: shop.id, branchId, status: 'CONFIRMED', clientKey: `e2e-${randomUUID()}`, supplierName, supplierId: supplier.id, receivedOn: new Date(dayText(0)), createdById: userId, confirmedById: userId, confirmedAt: new Date(), number: 'R-000002' },
      select: { id: true },
    });
    const specs = [
      { p: products[0]!, qty: 20, cost: 250n, currency: 'USD' as const, lot: 'UA1' },
      { p: products[1]!, qty: 10, cost: 100n, currency: 'USD' as const, lot: 'UB1' },
      { p: products[2]!, qty: 5, cost: 1000n, currency: 'IQD' as const, lot: 'UC1' },
    ];
    for (const [i, spec] of specs.entries()) {
      const expiry = new Date(dayText(400));
      const batch = await client.phBatch.create({
        data: { restaurantId: shop.id, productId: spec.p.id, lot: spec.lot, expiryDate: expiry, supplierName, unitCostMinor: spec.cost, costCurrency: spec.currency, costUnitId: spec.p.unitIds[0]! },
        select: { id: true },
      });
      const line = await client.phReceiptLine.create({
        data: { restaurantId: shop.id, receiptId: receipt.id, lineNo: i + 1, productId: spec.p.id, unitId: spec.p.unitIds[0]!, qty: spec.qty, baseQty: spec.qty, lot: spec.lot, expiryDate: expiry, unitCostMinor: spec.cost, costCurrency: spec.currency, batchId: batch.id },
        select: { id: true },
      });
      await client.phBatch.update({ where: { id: batch.id }, data: { receiptLineId: line.id } });
      await client.phStockBalance.create({ data: { restaurantId: shop.id, branchId, productId: spec.p.id, batchId: batch.id, available: spec.qty } });
    }
    return { supplierId: supplier.id, supplierName, productU1: names[0]!, productU2: names[1]!, productIqd: names[2]! };
  } finally {
    await client.$disconnect();
  }
}

async function paymentCount(shop: TestPharmacy, supplierId: string): Promise<number> {
  const client = db();
  try {
    return await client.phSupplierPayment.count({ where: { restaurantId: shop.id, supplierId } });
  } finally {
    await client.$disconnect();
  }
}

async function mkShot(page: Page, name: string, fullPage = true): Promise<void> {
  if (!SHOTS) return;
  const file = path.join(SHOTS, '..', 'task-11b-shots', `${name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage });
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

/** A signed-in person's cookies, by person and place: the Studio limits sign-ins per account, and this run signs the owner in many times. */
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** Signs in and chooses a place: `branch` 0 is "All branches" for an owner, 1 the first branch. */
async function signInAndChoose(page: Page, user: StudioUser, shop: TestPharmacy, branch = 0): Promise<void> {
  const key = `${user.email}:${shop.id}:${branch}`;
  const saved = sessions.get(key);
  if (saved) {
    await page.context().addCookies(saved.cookies);
    await page.goto('/pharmacy/home');
    if (/\/pharmacy\/home$/.test(page.url())) return;
  }
  await page.goto('/pharmacy');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shop.name }).getByRole('button').nth(branch).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
  sessions.set(key, await page.context().storageState());
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
async function checkWidths(page: Page, url: string, lang: 'en' | 'ar' | 'ckb', shot?: string): Promise<void> {
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
  test('a STOCK clerk sees the blocked state on a new return to a supplier', async ({ browser }) => {
    const { shop } = money;
    expect(shop, 'the money run left its pharmacy').toBeTruthy();
    const clerk = await createStudioUser({ label: 'ph-money-stock2', name: 'Money Stock Two' });
    people.push(clerk.email);
    await makeStaff(clerk.userId, shop!.id, 'STOCK');
    const page = await freshPage(browser);
    await signInAndChoose(page, clerk, shop!, 1);
    await page.goto('/pharmacy/purchasing/returns/new');
    await expect(page.getByTestId('return-blocked')).toContainText('may change stock');
    await expect(page.getByTestId('return-form')).toHaveCount(0);
    await page.context().close();
  });

  test('an answer lost on the way back is replayed by the same key, an edited payment gets a new one, and offline keeps the form', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, seeded } = money;
    expect(shop && owner && seeded, 'the money run left its records').toBeTruthy();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner!, shop!, 1);
    const before = await paymentCount(shop!, seeded!.supplierId);
    let lost = 0;
    let loseNext = true;
    await page.route('**/pharmacy/purchasing/payments/new**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST' && request.headers()['next-action'] && loseNext) {
        loseNext = false;
        lost += 1;
        // The server does the work and the answer never arrives.
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD`);
    await page.getByTestId('pay-amount').fill('1000');
    await page.getByTestId('pay-save').click();
    await expect(page.getByTestId('payment-error')).toBeVisible();
    expect(lost).toBe(1);
    expect(await paymentCount(shop!, seeded!.supplierId)).toBe(before + 1);
    // Retry with nothing changed: the same key, so the server replays and no second payment is made.
    await page.getByTestId('pay-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/payments\/(?!new$)[^/?]+$/);
    expect(await paymentCount(shop!, seeded!.supplierId)).toBe(before + 1);

    // A lost answer, then the person edits the amount: a different request, so a new key and a second payment.
    loseNext = true;
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD`);
    await page.getByTestId('pay-amount').fill('2000');
    await page.getByTestId('pay-save').click();
    await expect(page.getByTestId('payment-error')).toBeVisible();
    await page.getByTestId('pay-amount').fill('3000');
    await page.getByTestId('pay-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/payments\/(?!new$)[^/?]+$/);
    expect(await paymentCount(shop!, seeded!.supplierId)).toBe(before + 3);
    // Offline, on a fresh form: the notice says so, what was typed stays, saving is off until the connection is back.
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD`);
    await page.getByTestId('pay-amount').fill('4321');
    await page.getByTestId('pay-reference').fill('Slip 77');
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByTestId('stock-offline')).toBeVisible();
    await expect(page.getByTestId('pay-save')).toBeDisabled();
    await expect(page.getByTestId('pay-amount')).toHaveValue('4321');
    await expect(page.getByTestId('pay-reference')).toHaveValue('Slip 77');
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('stock-offline')).toHaveCount(0);
    await expect(page.getByTestId('pay-save')).toBeEnabled();
    await expect(page.getByTestId('pay-amount')).toHaveValue('4321');
    await page.context().close();
  });

  test('a USD supplier end to end: one currency per invoice, then an explicit allocation across two invoices', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = money;
    expect(shop && owner, 'the money run left its pharmacy').toBeTruthy();
    const usd = await seedUsd(shop!, owner!.userId);
    const page = await freshPage(browser);
    await signInAndChoose(page, owner!, shop!, 1);

    // Tick the USD line: the IQD line cannot join it, said in words.
    await tickLines(page, usd.supplierId, [usd.productU1]);
    const iqdLine = page.getByTestId('invoice-line').filter({ hasText: usd.productIqd });
    await expect(iqdLine.getByTestId('invoice-line-check')).toBeDisabled();
    await expect(iqdLine).toContainText('invoice is in another currency');
    await expect(page.getByTestId('invoice-cost')).toHaveValue('2.50');
    await page.getByTestId('invoice-number').fill('INV-U1');
    await page.getByTestId('invoice-due').fill(dayText(5));
    await expect(page.getByTestId('invoice-totals')).toContainText('50.00');
    await page.getByTestId('invoice-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/invoices\/(?!new$)[^/?]+$/);
    const u1 = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByTestId('invoice-total')).toContainText('50.00');

    await tickLines(page, usd.supplierId, [usd.productU2]);
    await page.getByTestId('invoice-number').fill('INV-U2');
    await page.getByTestId('invoice-due').fill(dayText(9));
    await page.getByTestId('invoice-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/invoices\/(?!new$)[^/?]+$/);
    const u2 = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByTestId('invoice-total')).toContainText('10.00');

    // What is owed is counted in USD on its own; nothing is added to an IQD total.
    await page.goto(`/pharmacy/purchasing/payables?supplier=${usd.supplierId}`);
    await expect(page.getByTestId('payables-total-USD')).toContainText('60.00');
    await expect(page.getByTestId('payables-total-IQD')).toHaveCount(0);
    // In IQD the supplier has nothing open: said on the payment screen.
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${usd.supplierId}&currency=IQD`);
    await expect(page.getByTestId('alloc-none')).toBeVisible();

    // Explicit allocation: 20.00 to INV-U1 (of 50.00) and all 10.00 of INV-U2, 30.00 in all.
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${usd.supplierId}&currency=USD&invoice=${u1},${u2}`);
    await expect(page.getByTestId('alloc-explicit')).toBeChecked();
    await page.getByTestId('pay-amount').fill('30');
    await page.getByLabel('Amount for invoice INV-U1').fill('20');
    await page.getByLabel('Amount for invoice INV-U2').fill('10');
    await expect(page.getByTestId('alloc-status')).toContainText('fully placed');
    await page.getByTestId('pay-save').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/payments\/(?!new$)[^/?]+$/);
    await expect(page.getByTestId('payment-allocations')).toContainText('INV-U1');
    await expect(page.getByTestId('payment-allocations')).toContainText('20.00');
    await expect(page.getByTestId('payment-allocations')).toContainText('INV-U2');
    await page.goto(`/pharmacy/purchasing/invoices/${u1}`);
    await expect(page.locator('[data-chip="PARTIAL"]')).toBeVisible();
    await expect(page.getByTestId('invoice-balance')).toContainText('30.00');
    await page.goto(`/pharmacy/purchasing/invoices/${u2}`);
    await expect(page.locator('[data-chip="PAID"]')).toBeVisible();
    await page.goto(`/pharmacy/purchasing/suppliers/${usd.supplierId}/statement?currency=USD`);
    await expect(page.getByTestId('statement-closing')).toContainText('30.00');
    await expect(page.getByTestId('statement-invariant-ok')).toBeVisible();
    await shoot(page, 'en-usd-statement-1280');
    await page.context().close();
  });

  test('Sorani: the invoice and the statement render right to left, pass axe and have no sideways scroll; Arabic dates are in order', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, seeded } = money;
    expect(shop && owner && seeded && money.invoiceA1, 'the money run left its records').toBeTruthy();
    await setUserLocale(owner!.userId, 'ckb');
    try {
      const page = await freshPage(browser, { width: 375, height: 800 });
      await signInAndChoose(page, owner!, shop!, 1);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.goto(`/pharmacy/purchasing/invoices/${money.invoiceA1}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('invoice-head')).toContainText(/\d{4}-\d{2}-\d{2}/);
      await checkWidths(page, 'invoice', 'ckb', 'invoice');
      await page.goto(`/pharmacy/purchasing/suppliers/${seeded!.supplierId}/statement?currency=IQD`);
      await expect(page.getByTestId('statement-row').first()).toContainText(/\d{4}-\d{2}-\d{2}/);
      await checkWidths(page, 'statement', 'ckb', 'statement');
      await page.context().close();
    } finally {
      await setUserLocale(owner!.userId, 'ar');
    }
    const arabic = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(arabic, owner!, shop!, 1);
    for (const [url, shot] of [
      [`/pharmacy/purchasing/invoices/${money.invoiceA1}`, 'invoice'],
      [`/pharmacy/purchasing/suppliers/${seeded!.supplierId}/statement?currency=IQD`, 'statement'],
    ] as const) {
      await arabic.goto(url);
      await expect(arabic.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(arabic.locator('main, body').first()).toContainText(/\d{4}-\d{2}-\d{2}/);
      await mkShot(arabic, `after/ar-${shot}-375`);
    }
    await arabic.context().close();
    await setUserLocale(owner!.userId, 'en');
  });

  test('payment allocation at 375px: the sticky footer never covers the allocation controls, checked by clicking and by position', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, seeded } = money;
    expect(shop && owner && seeded && money.invoiceA1, 'the money run left its records').toBeTruthy();
    const page = await freshPage(browser, { width: 375, height: 700 });
    await signInAndChoose(page, owner!, shop!, 1);
    await page.goto(`/pharmacy/purchasing/payments/new?supplier=${seeded!.supplierId}&currency=IQD`);
    await expect(page.getByTestId('payment-form')).toBeVisible();
    // Clicking needs the radio to be the topmost thing at its point, so a covered radio fails here.
    await page.getByTestId('alloc-explicit').scrollIntoViewIfNeeded();
    await page.getByTestId('alloc-explicit').click();
    await expect(page.getByTestId('alloc-explicit')).toBeChecked();
    await page.getByTestId('alloc-auto').click();
    await page.getByTestId('pay-amount').fill('500');
    await mkShot(page, 'after/en-payment-new-375-viewport', false);
    // At the very end of the page the allocation status sits above the footer.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const status = page.getByTestId('alloc-status');
    const footer = page.getByTestId('pay-total').locator('xpath=..');
    const statusBox = await status.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(statusBox && footerBox, 'both are on screen').toBeTruthy();
    expect(statusBox!.y + statusBox!.height, 'the allocation status ends above the footer').toBeLessThanOrEqual(footerBox!.y + 1);
    await mkShot(page, 'after/en-payment-new-375-bottom', false);
    await page.context().close();
  });
});
