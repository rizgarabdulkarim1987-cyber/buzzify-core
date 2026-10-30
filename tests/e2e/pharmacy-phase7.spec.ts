import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * Phase 7 screens, end to end: a pharmacist sells a controlled medicine with a prescription and a photo (a cashier cannot); the
 * attachment viewer fetches bytes only on a click and only for a role that may; a credit sale within the limit, one over it
 * (refused before it is sent), a mixed credit and cash sale, and a payment, with the balance on screen equal to the hand figure
 * and to the statement and to the ledger summed in SQL; a lapsed subscription (lists, statements and the register readable, no
 * write control); the settings with the confirm dialog for controlled sales; 1,000 customers usable at 375 px; and English,
 * Arabic and Sorani with axe and no sideways scroll at three widths on every new screen and state.
 * Run: `npx playwright test -c playwright.phase7.config.ts --workers=1 tests/e2e/pharmacy-phase7.spec.ts`.
 */

const DAY = 86_400_000;
const SHOTS = '.superpowers/sdd/2026-11-01-pharmacy-phase-7/task-5-shots';
const db = () => createPrisma(databaseUrl(DEV_DB));
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const baghdadToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
/** A 1x1 PNG: the smallest real image the upload accepts. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

interface Shop {
  id: string;
  name: string;
  branches: { id: string; name: string }[];
}

async function makeShop(label: string): Promise<Shop> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const bn = `Main ${randomUUID().slice(0, 4)}`;
    const created = await client.branch.create({ data: { restaurantId: row.id, name: bn, sortOrder: 0 }, select: { id: true } });
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    await client.phSettings.upsert({
      where: { restaurantId: row.id },
      create: { restaurantId: row.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD', controlledEnabled: true, creditEnabled: true },
      update: {},
    });
    return { id: row.id, name, branches: [{ id: created.id, name: bn }] };
  } finally {
    await client.$disconnect();
  }
}

/** Morphex (RESTRICTED, 500 IQD a tablet) and Panadol (OTC, 250 IQD a tablet), 200 tablets of each at the branch. */
async function seedCatalog(shop: Shop, tag: string): Promise<{ restricted: string; otc: string }> {
  const client = db();
  try {
    const make = async (tradeName: string, rxLevel: 'OTC' | 'RESTRICTED', tablet: bigint, strip: bigint) => {
      const product = await client.phProduct.create({
        data: {
          restaurantId: shop.id,
          tradeName,
          strength: '500 mg',
          form: 'tablet',
          rxLevel,
          identityKey: `${tradeName}|${shop.id}`,
          searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
        },
        select: { id: true },
      });
      const tabletUnit = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
      const stripUnit = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
      for (const [unitId, amountMinor] of [[tabletUnit.id, tablet], [stripUnit.id, strip]] as const) {
        await client.phPrice.create({ data: { restaurantId: shop.id, productId: product.id, unitId, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
      }
      const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
      const batch = await client.phBatch.create({ data: { restaurantId: shop.id, productId: product.id, lot: 'LOT-1', expiryDate: new Date(`${dateIn(400)}T00:00:00.000Z`) }, select: { id: true } });
      await scoped.$transaction(async (tx) => {
        await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branches[0]!.id, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: 200 }, reason: '' });
      });
    };
    await make(`Morphex ${tag}`, 'RESTRICTED', 500n, 4500n);
    await make(`Panadol ${tag}`, 'OTC', 250n, 2000n);
    return { restricted: `Morphex ${tag}`, otc: `Panadol ${tag}` };
  } finally {
    await client.$disconnect();
  }
}

async function staff(userId: string, shop: Shop, role: 'BRANCH_MANAGER' | 'PHARMACIST' | 'CASHIER'): Promise<void> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId, restaurantId: shop.id, role }, select: { id: true } });
    await client.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: shop.branches[0]!.id } });
  } finally {
    await client.$disconnect();
  }
}

const logins = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** Signs in (once per person) and chooses a place: the branch by name, or `null` for "All branches" (an owner). */
async function session(browser: Browser, user: StudioUser, shop: Shop, branch: string | null, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const saved = logins.get(user.email);
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport, ...(saved ? { storageState: saved } : {}) });
  await hideDevTools(context);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  if (saved) {
    await page.goto('/pharmacy/select');
  } else {
    await page.goto('/pharmacy');
    await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/pharmacy\/select$/);
    logins.set(user.email, await context.storageState());
  }
  const group = page.getByRole('group', { name: shop.name });
  await (branch === null ? group.getByRole('button').first() : group.getByRole('button', { name: new RegExp(branch) })).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
  return page;
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

/** Finds a product by name and adds `qty` tablets to the cart. */
async function addTablets(page: Page, name: string, qty: number): Promise<void> {
  await page.getByTestId('sell-search').fill(name);
  await page.getByTestId('result').filter({ hasText: name }).getByTestId('add-unit').first().click();
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  if (qty !== 1) await page.getByTestId('qty-input').fill(String(qty));
}

async function clearCart(page: Page): Promise<void> {
  const clear = page.getByTestId('clear-cart');
  if ((await clear.isVisible()) && (await clear.isEnabled())) {
    await clear.click();
    await page.getByTestId('ask-confirm').click();
    await expect(page.getByTestId('cart-line')).toHaveCount(0);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Pharmacy phase 7 @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let shop: Shop;
  let other: Shop;
  let names: { restricted: string; otc: string };
  let owner: StudioUser;
  let ownerB: StudioUser;
  let manager: StudioUser;
  let pharmacist: StudioUser;
  let cashier: StudioUser;
  let branch: string;
  const ids: { customer?: string; rx?: string; creditSale?: string } = {};

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
    shop = await makeShop('Phase7');
    other = await makeShop('Other7');
    restaurants.push(shop.id, other.id);
    branch = shop.branches[0]!.name;
    names = await seedCatalog(shop, randomUUID().slice(0, 5));
    const make = async (label: string) => {
      const user = await createStudioUser({ label: `ph-p7-${label}`, name: `P7 ${label}` });
      people.push(user.email);
      return user;
    };
    [owner, ownerB, manager, pharmacist, cashier] = (await Promise.all(['owner', 'ownerb', 'manager', 'pharmacist', 'cashier'].map(make))) as [StudioUser, StudioUser, StudioUser, StudioUser, StudioUser];
    await staff(manager.userId, shop, 'BRANCH_MANAGER');
    await staff(pharmacist.userId, shop, 'PHARMACIST');
    await staff(cashier.userId, shop, 'CASHIER');
    await assignMember(owner.userId, shop.id, 'OWNER');
    await assignMember(ownerB.userId, other.id, 'OWNER');
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

  test('a pharmacist sells a controlled medicine with a prescription and a photo; a cashier cannot', async ({ browser }) => {
    test.setTimeout(240_000);
    const p = await session(browser, pharmacist, shop, branch);
    await openShift(p);
    await addTablets(p, names.restricted, 2);
    // Controlled: the product carries its chip, the panel asks for the prescription, and paying is blocked in words.
    await expect(p.getByTestId('rx-panel')).toBeVisible();
    await expect(p.getByTestId('rx-missing')).toBeVisible();
    await expect(p.getByTestId('pay-open')).toBeDisabled();
    await expect(p.getByTestId('pay-blocked')).toContainText('prescription');
    await p.getByTestId('rx-open').click();
    await expect(p.getByTestId('rx-drawer')).toBeVisible();
    await p.getByTestId('rx-save').click();
    await expect(p.getByTestId('rx-invalid')).toBeVisible();
    await p.getByTestId('rx-number').fill('RX-100');
    await p.getByTestId('rx-prescriber').fill('Dr Strange');
    await p.getByTestId('rx-license').fill('LIC-77');
    await p.getByTestId('rx-patient').fill('Layla Hassan');
    await p.getByTestId('rx-idnote').fill('National ID: 4821');
    await p.getByTestId('rx-date').fill(baghdadToday());
    await p.getByTestId('rx-file').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: PNG });
    await expect(p.getByTestId('rx-file-chosen')).toBeVisible();
    await p.getByTestId('rx-save').click();
    await expect(p.getByTestId('rx-attached')).toBeVisible();
    // The patient's words are never kept on the device.
    const stored = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('Layla');
    expect(stored).not.toContain('4821');
    // The prescription belongs to the lines it was recorded for: take the controlled line out, sell an unrelated OTC item, and
    // the recorded prescription is neither sent with that sale nor consumed by it.
    const sent: string[] = [];
    p.on('request', (request) => {
      if (request.method() === 'POST') sent.push(request.postData() ?? '');
    });
    await p.getByTestId('remove-line').click();
    await expect(p.getByTestId('cart-line')).toHaveCount(0);
    await expect(p.getByTestId('rx-attached')).toHaveCount(0);
    await addTablets(p, names.otc, 1);
    await p.getByTestId('pay-open').click();
    await p.getByTestId('pay-confirm').click();
    await expect(p.getByTestId('sale-done')).toBeVisible();
    await p.getByTestId('receipt-done').click();
    expect(sent.some((body) => body.includes('prescriptionId'))).toBe(false);
    {
      const probe = db();
      try {
        const kept = await probe.phPrescription.findFirstOrThrow({ where: { restaurantId: shop.id, number: 'RX-100' }, select: { id: true, saleId: true } });
        expect(kept.saleId).toBeNull();
        // It stays unused; remove it so the real sale below records its own and the register keeps one row.
        await probe.phRxAttachment.deleteMany({ where: { restaurantId: shop.id, prescriptionId: kept.id } });
        await probe.phPrescription.delete({ where: { id: kept.id } });
        expect(await probe.phSale.count({ where: { restaurantId: shop.id, status: 'COMPLETED' } })).toBe(1);
      } finally {
        await probe.$disconnect();
      }
    }
    // Back with the controlled medicine, the earlier prescription is not silently attached to the next customer.
    await addTablets(p, names.restricted, 2);
    await expect(p.getByTestId('rx-missing')).toBeVisible();
    await expect(p.getByTestId('rx-attached')).toHaveCount(0);
    await p.getByTestId('rx-open').click();
    await expect(p.getByTestId('rx-drawer')).toBeVisible();
    await p.getByTestId('rx-number').fill('RX-100');
    await p.getByTestId('rx-prescriber').fill('Dr Strange');
    await p.getByTestId('rx-license').fill('LIC-77');
    await p.getByTestId('rx-patient').fill('Layla Hassan');
    await p.getByTestId('rx-idnote').fill('National ID: 4821');
    await p.getByTestId('rx-date').fill(baghdadToday());
    await p.getByTestId('rx-file').setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer: PNG });
    await p.getByTestId('rx-save').click();
    await expect(p.getByTestId('rx-attached')).toBeVisible();
    await p.getByTestId('pay-open').click();
    await p.getByTestId('pay-confirm').click();
    await expect(p.getByTestId('sale-done')).toBeVisible();
    await p.getByTestId('receipt-done').click();
    const client = db();
    try {
      const rx = await client.phPrescription.findFirstOrThrow({ where: { restaurantId: shop.id, number: 'RX-100' }, select: { id: true, saleId: true, patientName: true } });
      ids.rx = rx.id;
      expect(rx.saleId).not.toBeNull();
      expect(rx.patientName).toBe('Layla Hassan');
      expect(await client.phSale.count({ where: { restaurantId: shop.id, status: 'COMPLETED' } })).toBe(2);
      expect(await client.phControlledEntry.count({ where: { restaurantId: shop.id, prescriptionId: rx.id } })).toBeGreaterThan(0);
      expect(await client.phRxAttachment.count({ where: { restaurantId: shop.id, prescriptionId: rx.id } })).toBe(1);
    } finally {
      await client.$disconnect();
    }
    await p.context().close();

    // The cashier can put it in the cart but cannot record a prescription or complete the sale.
    const c = await session(browser, cashier, shop, branch);
    await openShift(c);
    await addTablets(c, names.restricted, 1);
    await expect(c.getByTestId('rx-needs-pharmacist')).toBeVisible();
    await expect(c.getByTestId('rx-open')).toHaveCount(0);
    await expect(c.getByTestId('pay-open')).toBeDisabled();
    await c.context().close();
  });

  test('the attachment viewer fetches bytes only on a click and only for a role that may; a cashier is blocked with no fetch', async ({ browser }) => {
    test.setTimeout(180_000);
    const fetches: string[] = [];
    const watch = (page: Page) => page.on('request', (request) => {
      if (request.url().includes('/api/pharmacy/rx-attachments/')) fetches.push(`${request.method()} ${request.url()}`);
    });
    const p = await session(browser, pharmacist, shop, branch);
    watch(p);
    await p.goto('/pharmacy/prescriptions');
    await expect(p.getByTestId('rx-row')).toHaveCount(1);
    await expect(p.getByTestId('rx-has-file')).toBeVisible();
    await p.getByTestId('rx-open').click();
    await expect(p.getByTestId('rx-detail')).toBeVisible();
    await expect(p.getByTestId('rx-attachments')).toBeVisible();
    expect(fetches).toEqual([]);
    await p.getByTestId('rx-file-show').click();
    await expect(p.getByTestId('rx-image')).toBeVisible();
    expect(fetches).toHaveLength(1);
    const client = db();
    let attachmentId = '';
    try {
      attachmentId = (await client.phRxAttachment.findFirstOrThrow({ where: { restaurantId: shop.id }, select: { id: true } })).id;
    } finally {
      await client.$disconnect();
    }
    await p.context().close();

    const c = await session(browser, cashier, shop, branch);
    watch(c);
    const before = fetches.length;
    await c.goto('/pharmacy/prescriptions');
    await expect(c.getByTestId('rx-forbidden')).toBeVisible();
    await c.goto(`/pharmacy/prescriptions/${ids.rx}`);
    await expect(c.getByTestId('rx-forbidden')).toBeVisible();
    expect(fetches.length).toBe(before);
    // The route itself refuses a role without the permission, whatever the page does.
    const direct = await c.request.get(`/api/pharmacy/rx-attachments/${attachmentId}?restaurantId=${shop.id}&branchId=${shop.branches[0]!.id}`);
    expect(direct.ok()).toBe(false);
    await c.context().close();

    // Another business's owner cannot read it either.
    const o = await session(browser, ownerB, other, null);
    const foreign = await o.request.get(`/api/pharmacy/rx-attachments/${attachmentId}?restaurantId=${other.id}&branchId=${other.branches[0]!.id}`);
    expect(foreign.ok()).toBe(false);
    await o.context().close();
  });

  test('credit: within the limit, over it (refused before it is sent), mixed with cash, a payment and a correction; the balance equals the hand figure, the statement and the ledger', async ({ browser }) => {
    test.setTimeout(420_000);
    // A customer with a limit of 5 000 IQD, made on the customer screen.
    const o = await session(browser, owner, shop, null);
    await o.goto('/pharmacy/customers');
    await expect(o.getByTestId('customers-empty')).toBeVisible();
    await o.getByTestId('customer-new').click();
    await o.getByTestId('customer-save').click();
    await expect(o.getByText('Enter the customer’s name').first()).toBeVisible();
    await o.getByTestId('customer-name').fill('Credit Customer');
    await o.getByTestId('customer-phone').fill('0770 123 4567');
    await o.getByTestId('customer-limit').fill('5000');
    await o.getByTestId('customer-save').click();
    await expect(o.getByTestId('customer-detail')).toBeVisible();
    ids.customer = new URL(o.url()).pathname.split('/').pop()!;
    await expect(o.getByTestId('customer-balance')).toContainText('0');
    await expect(o.getByTestId('customer-limit-figure')).toContainText(/5,?000/);
    await expect(o.getByTestId('customer-remaining')).toContainText(/5,?000/);
    await o.context().close();

    const p = await session(browser, pharmacist, shop, branch);
    await openShift(p);

    // 1. Within the limit: 4 tablets of 250 = 1 000 wholly on the account.
    await addTablets(p, names.otc, 4);
    await p.getByTestId('pay-open').click();
    await p.getByTestId('pay-credit-toggle').check();
    await p.getByTestId('customer-search').fill('Credit');
    await p.getByTestId('customer-option').first().click();
    await expect(p.getByTestId('customer-picked').getByTestId('customer-figures')).toContainText(/5,?000/);
    await p.getByTestId('pay-credit-amount').fill('1000');
    await expect(p.getByTestId('pay-all-credit')).toBeVisible();
    await p.getByTestId('pay-confirm').click();
    await expect(p.getByTestId('sale-done')).toBeVisible();
    await expect(p.getByTestId('sale-credit')).toContainText(/1,?000/);
    await expect(p.getByTestId('sale-credit-label')).toContainText('Credit Customer');
    await p.getByTestId('receipt-done').click();

    // 2. Over the limit: 20 tablets = 5 000 on the account would make 6 000 against 5 000; refused on screen, nothing sent.
    await clearCart(p);
    await addTablets(p, names.otc, 20);
    await p.getByTestId('pay-open').click();
    await p.getByTestId('pay-credit-toggle').check();
    await p.getByTestId('customer-search').fill('Credit');
    await p.getByTestId('customer-option').first().click();
    await p.getByTestId('pay-credit-amount').fill('5000');
    await expect(p.getByText('This would go over the customer’s credit limit').first()).toBeVisible();
    await expect(p.getByTestId('pay-confirm')).toBeDisabled();
    const posted: string[] = [];
    p.on('request', (request) => {
      if (request.method() === 'POST') posted.push(request.url());
    });
    await p.getByTestId('pay-confirm').click({ force: true });
    await p.waitForTimeout(500);
    expect(posted).toEqual([]);
    await p.keyboard.press('Escape');

    // 3. Mixed: 12 tablets = 3 000, 2 000 on the account (exactly the 4 000 left minus 2 000) and 1 000 in cash.
    await clearCart(p);
    await addTablets(p, names.otc, 12);
    await p.getByTestId('pay-open').click();
    await p.getByTestId('pay-credit-toggle').check();
    await p.getByTestId('customer-search').fill('Credit');
    await p.getByTestId('customer-option').first().click();
    await p.getByTestId('pay-credit-amount').fill('2000');
    await expect(p.getByTestId('credit-after')).toContainText(/3,?000/);
    await p.getByTestId('pay-tendered').fill('1500');
    await expect(p.getByTestId('pay-change')).toContainText(/500/);
    await p.getByTestId('pay-confirm').click();
    await expect(p.getByTestId('sale-done')).toBeVisible();
    await expect(p.getByTestId('sale-credit')).toContainText(/2,?000/);
    await p.getByTestId('receipt-done').click();
    await p.context().close();

    const client = db();
    try {
      const sale = await client.phSale.findFirstOrThrow({ where: { restaurantId: shop.id, customerId: ids.customer }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      ids.creditSale = sale.id;
      // The ledger summed in SQL: 1 000 + 2 000.
      // eslint-disable-next-line no-restricted-properties -- the test sums the ledger itself, to check the screens against it
      const rows = await client.$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM("amountMinor"), 0)::bigint AS s FROM "PhCustomerLedger" WHERE "customerId" = ${ids.customer}`;
      expect(rows[0]!.s).toBe(3000n);
    } finally {
      await client.$disconnect();
    }

    // The manager records a card payment of 500: 3 000 - 500 = 2 500 on screen, in the statement and in the ledger.
    const m = await session(browser, manager, shop, branch);
    await m.goto(`/pharmacy/customers/${ids.customer}`);
    await expect(m.getByTestId('customer-balance')).toContainText(/3,?000/);
    await expect(m.getByTestId('customer-remaining')).toContainText(/2,?000/);
    await m.getByTestId('payment-open').click();
    await m.getByTestId('payment-amount').fill('9000');
    await expect(m.getByText('More than the customer owes').first()).toBeVisible();
    await expect(m.getByTestId('payment-confirm')).toBeDisabled();
    await m.getByTestId('cpay-CARD').check({ force: true });
    await m.getByTestId('payment-amount').fill('500');
    await m.getByTestId('payment-confirm').click();
    await expect(m.getByTestId('payment-done')).toBeVisible();
    await expect(m.getByTestId('customer-balance')).toContainText(/2,?500/);
    await expect(m.getByTestId('statement-row')).toHaveCount(3);
    await expect(m.getByTestId('statement-closing')).toContainText(/2,?500/);
    await expect(m.getByTestId('statement-balance').last()).toContainText(/2,?500/);
    await expect(m.getByTestId('ageing')).toBeVisible();

    // The sale shows the credit as its own line with the customer's name.
    await m.goto(`/pharmacy/sales/${ids.creditSale}`);
    await expect(m.getByTestId('detail-credit')).toContainText(/1,?000/);
    await expect(m.getByTestId('detail-customer')).toContainText('Credit Customer');

    // The payment is corrected once: the debt comes back and the button is gone.
    await m.goto(`/pharmacy/customers/${ids.customer}`);
    await m.getByTestId('payment-correct').click();
    await m.getByTestId('payment-correct-confirm').click();
    await expect(m.getByTestId('customer-balance')).toContainText(/3,?000/);
    await expect(m.getByTestId('statement-corrected')).toBeVisible();
    await expect(m.getByTestId('payment-correct')).toHaveCount(0);
    await m.context().close();
  });

  test('a lapsed subscription: lists, statements and the register stay readable; no write control is drawn', async ({ browser }) => {
    test.setTimeout(180_000);
    const client = db();
    let was: Date | null = null;
    try {
      was = (await client.subscription.findFirstOrThrow({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, select: { currentPeriodEnd: true } })).currentPeriodEnd;
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
      const m = await session(browser, manager, shop, branch);
      await m.goto('/pharmacy/customers');
      await expect(m.getByTestId('customer-row')).toHaveCount(1);
      await expect(m.getByTestId('customer-new')).toHaveCount(0);
      await m.goto(`/pharmacy/customers/${ids.customer}`);
      await expect(m.getByTestId('customer-balance')).toContainText(/3,?000/);
      await expect(m.getByTestId('statement-row').first()).toBeVisible();
      await expect(m.getByTestId('payment-open')).toHaveCount(0);
      await expect(m.getByTestId('payment-correct')).toHaveCount(0);
      await expect(m.getByTestId('customer-edit')).toHaveCount(0);
      await m.goto('/pharmacy/prescriptions');
      await expect(m.getByTestId('rx-row')).toHaveCount(1);
      await m.goto('/pharmacy/prescriptions/register');
      await expect(m.getByTestId('register-row').first()).toBeVisible();
      await m.context().close();
      const o = await session(browser, owner, shop, null);
      await o.goto('/pharmacy/settings');
      await expect(o.getByTestId('pharmacy-settings')).toBeVisible();
      await expect(o.getByTestId('settings-readonly')).toBeVisible();
      await expect(o.getByTestId('settings-controlled-save')).toHaveCount(0);
      await expect(o.getByTestId('settings-credit-save')).toHaveCount(0);
      await o.context().close();
    } finally {
      if (was) await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: was } });
      await client.$disconnect();
    }
  });

  test('settings: the owner confirms before switching controlled sales on; a manager reads and cannot change', async ({ browser }) => {
    test.setTimeout(180_000);
    const o = await session(browser, owner, shop, null);
    await o.goto('/pharmacy/settings');
    await expect(o.getByTestId('settings-question-b')).toContainText('question B');
    // Off needs no confirmation.
    await o.getByTestId('settings-controlled-on').uncheck();
    await o.getByTestId('settings-controlled-save').click();
    await expect(o.getByTestId('settings-controlled-message')).toContainText('Saved');
    // The till now shows it as unavailable at search time (text and icon, never an error after the fact).
    const p = await session(browser, pharmacist, shop, branch);
    await openShift(p);
    await p.getByTestId('sell-search').fill(names.restricted);
    await expect(p.getByTestId('result').filter({ hasText: names.restricted }).getByTestId('chip-notSellable')).toBeVisible();
    await expect(p.getByTestId('result').filter({ hasText: names.restricted }).getByTestId('add-unit').first()).toBeDisabled();
    await p.context().close();
    // On asks first, and says what it means.
    await o.getByTestId('settings-controlled-on').check();
    await o.getByTestId('settings-controlled-save').click();
    await expect(o.getByTestId('settings-confirm-body')).toContainText('prescription');
    await o.getByTestId('settings-confirm-cancel').click();
    await o.getByTestId('settings-controlled-save').click();
    await o.getByTestId('settings-confirm-ok').click();
    await expect(o.getByTestId('settings-controlled-message')).toContainText('Saved');
    // The credit switch shares the row's version and still saves right after.
    await o.getByTestId('settings-credit-on').uncheck();
    await o.getByTestId('settings-credit-save').click();
    await expect(o.getByTestId('settings-credit-message')).toContainText('Saved');
    await o.getByTestId('settings-credit-on').check();
    await o.getByTestId('settings-credit-save').click();
    await expect(o.getByTestId('settings-credit-message')).toContainText('Saved');
    await o.context().close();
    const client = db();
    try {
      expect(await client.phSettings.findFirstOrThrow({ where: { restaurantId: shop.id }, select: { controlledEnabled: true, creditEnabled: true } })).toEqual({ controlledEnabled: true, creditEnabled: true });
    } finally {
      await client.$disconnect();
    }
    const m = await session(browser, manager, shop, branch);
    await m.goto('/pharmacy/settings');
    await expect(m.getByTestId('settings-readonly')).toBeVisible();
    await expect(m.getByTestId('settings-controlled-save')).toHaveCount(0);
    await expect(m.getByTestId('settings-controlled-on')).toBeDisabled();
    await m.context().close();
    const c = await session(browser, cashier, shop, branch);
    await c.goto('/pharmacy/settings');
    await expect(c.getByTestId('settings-forbidden')).toBeVisible();
    await c.context().close();
  });

  /** No sideways scroll and no serious axe finding at 375, 768 and 1280 (a screenshot of each). */
  async function check(page: Page, name: string, widths = [375, 768, 1280]): Promise<void> {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await scrollsSideways(page), `${name} at ${width}px`).toBe(false);
      expect(await seriousViolations(page), `${name} at ${width}px`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
    }
  }

  test('1,000 customers: the list is usable at 375px, searchable and read 50 at a time', async ({ browser }) => {
    test.setTimeout(300_000);
    const client = db();
    try {
      await client.phCustomer.createMany({
        data: Array.from({ length: 1000 }, (_, i) => ({ restaurantId: shop.id, name: `Bulk ${String(i).padStart(4, '0')} ${'Long Name '.repeat(i % 5)}`.trim(), currency: 'IQD' as const, creditLimitMinor: 100000n })),
      });
    } finally {
      await client.$disconnect();
    }
    const o = await session(browser, owner, shop, null, { width: 375, height: 800 });
    await o.goto('/pharmacy/customers');
    await expect(o.getByTestId('customer-row')).toHaveCount(50);
    await expect(o.getByTestId('customers-more')).toBeVisible();
    await check(o, 'customers-1000', [375]);
    await o.getByTestId('customers-more').click();
    await expect(o.getByTestId('customer-row')).toHaveCount(100);
    await o.getByTestId('customers-q').fill('Bulk 0777');
    await o.getByRole('button', { name: 'Search' }).click();
    await expect(o.getByTestId('customer-row')).toHaveCount(1);
    // What was typed is never in the address, the history or a link on the page.
    expect(decodeURIComponent(o.url())).not.toMatch(/Bulk|0777|[?&]q=/);
    const links = await o.locator('a[href]').evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''));
    expect(links.filter((href) => /Bulk|0777|[?&]q=/.test(decodeURIComponent(href)))).toEqual([]);
    await o.context().close();
    const cleanup = db();
    try {
      await cleanup.phCustomer.deleteMany({ where: { restaurantId: shop.id, name: { startsWith: 'Bulk ' } } });
    } finally {
      await cleanup.$disconnect();
    }
  });

  async function auditLocale(browser: Browser, locale: 'en' | 'ar' | 'ckb'): Promise<void> {
    for (const u of [owner, manager, pharmacist, cashier]) await setUserLocale(u.userId, locale);
    const dir = locale === 'en' ? 'ltr' : 'rtl';
    const small = { width: 375, height: 800 };

    // The owner: every new screen and its states.
    const o = await session(browser, owner, shop, branch, small);
    await expect(o.locator('html')).toHaveAttribute('dir', dir);
    const states: [string, string][] = [
      ['customers', '/pharmacy/customers'],
      ['customer-new', '/pharmacy/customers/new'],
      ['customer', `/pharmacy/customers/${ids.customer}`],
      ['customer-edit', `/pharmacy/customers/${ids.customer}/edit`],
      ['customer-range-wrong', `/pharmacy/customers/${ids.customer}?from=2026-02-30&to=2026-03-01`],
      ['rx-list', '/pharmacy/prescriptions'],
      ['rx-unused-empty', '/pharmacy/prescriptions?unused=1'],
      ['rx-detail', `/pharmacy/prescriptions/${ids.rx}`],
      ['rx-register', '/pharmacy/prescriptions/register'],
      ['rx-register-empty', '/pharmacy/prescriptions/register?from=2020-01-01&to=2020-01-31'],
      ['settings', '/pharmacy/settings'],
      ['sale-detail-credit', `/pharmacy/sales/${ids.creditSale}`],
    ];
    for (const [name, path] of states) {
      await o.goto(path);
      await expect(o.locator('main')).toBeVisible();
      await check(o, `${locale}-${name}`);
    }
    await o.goto('/pharmacy/customers');
    await o.getByTestId('customers-q').fill('nobody-by-this-name');
    await o.getByTestId('customers-q').press('Enter');
    await expect(o.getByTestId('customers-empty')).toBeVisible();
    expect(o.url()).not.toContain('nobody');
    await check(o, `${locale}-customers-filtered`);
    // Dialogs: record a payment and the controlled-sales confirmation.
    await o.goto(`/pharmacy/customers/${ids.customer}`);
    await o.getByTestId('payment-open').click();
    await o.getByTestId('payment-amount').fill('99999999');
    await check(o, `${locale}-payment-dialog`, [375, 1280]);
    await o.keyboard.press('Escape');
    await o.goto('/pharmacy/settings');
    await o.getByTestId('settings-controlled-on').uncheck();
    await o.getByTestId('settings-controlled-save').click();
    await expect(o.getByTestId('settings-controlled-message')).toBeVisible();
    await o.getByTestId('settings-controlled-on').check();
    await o.getByTestId('settings-controlled-save').click();
    await expect(o.getByTestId('settings-confirm-body')).toBeVisible();
    await check(o, `${locale}-settings-confirm`, [375, 1280]);
    await o.getByTestId('settings-confirm-ok').click();
    await expect(o.getByTestId('settings-controlled-message')).toBeVisible();
    await o.context().close();

    // A cashier: the blocked states, with no data fetched.
    const c = await session(browser, cashier, shop, branch, small);
    for (const [name, path] of [['rx-forbidden', '/pharmacy/prescriptions'], ['customers-forbidden', '/pharmacy/customers'], ['settings-forbidden', '/pharmacy/settings']] as const) {
      await c.goto(path);
      await expect(c.locator('main')).toBeVisible();
      await check(c, `${locale}-${name}`);
    }
    await c.context().close();

    // The sale screen: a controlled item in the cart, the drawer (empty and with problems), the credit payment panel.
    const p = await session(browser, pharmacist, shop, branch, small);
    await openShift(p);
    await addTablets(p, names.restricted, 1);
    await expect(p.getByTestId('rx-panel')).toBeVisible();
    await check(p, `${locale}-sell-controlled`);
    await p.getByTestId('rx-open').click();
    await expect(p.getByTestId('rx-drawer')).toBeVisible();
    await check(p, `${locale}-rx-drawer`, [375, 1280]);
    await p.getByTestId('rx-save').click();
    await expect(p.getByTestId('rx-invalid')).toBeVisible();
    await check(p, `${locale}-rx-drawer-problems`, [375, 1280]);
    await p.getByTestId('rx-number').fill(`RX-${locale}`);
    await p.getByTestId('rx-prescriber').fill('Dr Strange');
    await p.getByTestId('rx-patient').fill('Layla Hassan');
    await p.getByTestId('rx-date').fill(baghdadToday());
    await p.getByTestId('rx-save').click();
    await expect(p.getByTestId('rx-attached')).toBeVisible();
    await p.getByTestId('pay-open').click();
    await p.getByTestId('pay-credit-toggle').check();
    await p.getByTestId('customer-search').fill('Credit');
    await p.getByTestId('customer-option').first().click();
    await p.getByTestId('pay-credit-amount').fill('500');
    await expect(p.getByTestId('credit-numbers')).toBeVisible();
    await check(p, `${locale}-pay-credit`, [375, 1280]);
    await p.getByTestId('pay-credit-amount').fill('999999');
    await check(p, `${locale}-pay-credit-over`, [375, 1280]);
    await p.context().close();

    // A lapsed subscription: the read-only notices on the new screens.
    const client = db();
    let was: Date | null = null;
    try {
      was = (await client.subscription.findFirstOrThrow({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, select: { currentPeriodEnd: true } })).currentPeriodEnd;
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
      const m = await session(browser, manager, shop, branch, small);
      for (const [name, path] of [['ro-customers', '/pharmacy/customers'], ['ro-customer', `/pharmacy/customers/${ids.customer}`], ['ro-customer-new', '/pharmacy/customers/new'], ['ro-settings', '/pharmacy/settings']] as const) {
        await m.goto(path);
        await expect(m.locator('main')).toBeVisible();
        await check(m, `${locale}-${name}`, [375, 1280]);
      }
      await m.context().close();
    } finally {
      if (was) await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: was } });
      await client.$disconnect();
    }
  }

  test('English: no sideways scroll and axe clean on every new screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'en');
  });
  test('Arabic: no sideways scroll and axe clean on every new screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'ar');
  });
  test('Sorani: no sideways scroll and axe clean on every new screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'ckb');
    await setUserLocale(owner.userId, 'en');
  });
});
