import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { STUDIO_MESSAGES } from '@/studio/messages';
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
 * The pharmacy expiry list and stock counts: the owner sees the batch that expires soon and the expired one, follows them
 * up (an assignee and a note; disposing writes the rest off), opens a blind count, counts from the keyboard, submits,
 * reviews the differences and approves with a reason, and the stock changes; a branch manager's own count is refused for
 * approval while the owner can approve it; a cashier only looks at expiry; the screens read right to left in Arabic with
 * no sideways scroll at 375, 768 and 1280px and pass axe. Everything is written straight to the development database and
 * removed afterwards.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const ar = (key: string) => STUDIO_MESSAGES.ar[key] as string;

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

/** One product with three batches in the first branch: expired (12), expiring in 20 days (40), a year away (100). */
async function seedStock(shop: TestPharmacy, tag: string): Promise<{ productName: string }> {
  const client = db();
  try {
    const productName = `Counted ${tag}`;
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

async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER' | 'BRANCH_MANAGER'): Promise<void> {
  const client = db();
  try {
    const branches = await client.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
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

test.describe('Pharmacy counts and expiry @desktop', () => {
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
    const owner = await createStudioUser({ label: 'ph-count-owner', name: 'Count Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('expiry: the owner sees what expires, follows it up, and disposing writes the rest off', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Expiry');
    await seedStock(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.getByRole('navigation').getByRole('link', { name: 'Expiry', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Expiry' })).toBeVisible();

    // Default horizon 90 days: the expired and the 20-day batch, not the one a year away.
    await expect(page.getByTestId('expiry-lot')).toHaveText(['OLD-1', 'SOON-2']);
    await expect(page.getByTestId('expiry-left').first()).toContainText('Expired 30 days ago');
    await expect(page.getByTestId('expiry-left').nth(1)).toContainText(/(19|20|21) days left/);
    await expect(page.locator('span[data-band="expired"]')).toContainText('Expired');
    await expect(page.locator('span[data-band="d30"]')).toContainText('Within 30 days');
    await expect(page.locator('[data-total="expired"]')).toContainText('1');
    await page.getByRole('link', { name: '30 days' }).click();
    await expect(page).toHaveURL(/days=30/);
    await expect(page.getByTestId('expiry-lot')).toHaveText(['OLD-1', 'SOON-2']);

    // Follow-up: status, assignee and note are kept and shown.
    const soon = page.getByTestId('expiry-row').filter({ hasText: 'SOON-2' });
    await soon.getByTestId('expiry-followup').locator('> summary').click();
    await soon.getByLabel('Status').selectOption('IN_PROGRESS');
    await soon.getByLabel('Assigned to').selectOption('me');
    await soon.getByLabel('Note').fill('Ask the supplier to take it back');
    await soon.getByRole('button', { name: 'Save follow-up' }).click();
    await expect(soon.getByTestId('expiry-saved')).toContainText('Follow-up saved.');
    await expect(soon.locator('[data-follow="IN_PROGRESS"]')).toContainText('In progress');
    await expect(soon).toContainText('Assigned toYou');
    await expect(soon).toContainText('Ask the supplier to take it back');

    // Moved is only a label for now, and says so.
    await soon.getByLabel('Status').selectOption('MOVED');
    await expect(soon.getByTestId('expiry-label-only')).toContainText('labels only for now');

    // Disposing the expired batch needs the exact quantity; a wrong one is refused in words, the right one writes it off.
    const old = page.getByTestId('expiry-row').filter({ hasText: 'OLD-1' });
    await old.getByTestId('expiry-followup').locator('> summary').click();
    await old.getByLabel('Status').selectOption('DISPOSED');
    await expect(old).toContainText('enter 12 (available plus quarantine)');
    await old.getByLabel('Quantity to write off (base units)').fill('5');
    await old.getByRole('button', { name: 'Save follow-up' }).click();
    await expect(old.getByTestId('expiry-error')).toContainText('enter exactly that quantity');
    await old.getByLabel('Quantity to write off (base units)').fill('12');
    await old.getByRole('button', { name: 'Save follow-up' }).click();
    await expect(old.getByTestId('expiry-saved')).toContainText('12 units were written off as damaged');
    // Nothing is left to sell or hold, so the batch leaves the list.
    await expect(page.getByTestId('expiry-lot')).toHaveText(['SOON-2']);
    await page.context().close();
  });

  test('expiry: with nothing close to expiry the list says so', async ({ browser }) => {
    const { shop, owner } = await owned('Empty');
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/stock/expiry');
    await expect(page.getByTestId('expiry-empty')).toContainText('Nothing expires in 90 days');
    await expect(page.getByTestId('expiry-empty').locator('svg')).toBeVisible();
    await page.context().close();
  });

  test('counts: a blind count is counted from the keyboard, submitted, reviewed and approved, and the stock changes', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Count');
    const { productName } = await seedStock(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser);
    // All branches: counting is refused until a branch is chosen.
    await signInAndChoose(page, owner, shop, 0);
    await page.goto('/pharmacy/stock/counts');
    await expect(page.getByTestId('counts-pick-branch')).toBeVisible();
    await expect(page.getByTestId('count-start')).toHaveCount(0);
    await page.goto('/pharmacy/select');
    await page.getByRole('group', { name: shop.name }).getByRole('button').nth(1).click();

    await page.getByRole('navigation').getByRole('link', { name: 'Stock counts' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Stock counts' })).toBeVisible();
    await expect(page.getByTestId('counts-empty')).toContainText('No counts yet');
    await page.getByLabel('Blind count').check();
    await page.getByRole('button', { name: 'Start counting' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/stock\/counts\/[\w-]+$/);

    // Blind: no expected quantity anywhere on the sheet.
    await expect(page.getByTestId('count-blind-notice')).toContainText('expected quantities are hidden');
    await expect(page.getByTestId('count-line')).toHaveCount(3);
    await expect(page.getByTestId('count-expected')).toHaveCount(0);
    await expect(page.getByTestId('count-lot')).toHaveCount(3);

    // Fast entry: type, Enter moves to the next line.
    // The lines come in batch order, not lot order: find each by its lot.
    const lineOf = (lot: string) => page.getByTestId('count-line').filter({ has: page.getByTestId('count-lot').filter({ hasText: lot }) });
    const first = page.locator('[data-count-input]').first();
    await first.fill('7');
    await first.press('Enter');
    await expect(page.locator('[data-count-input]').nth(1)).toBeFocused();
    await page.keyboard.type('8');
    await expect(page.getByTestId('count-progress')).toContainText('2 of 3 lines counted');
    await lineOf('LATER-3').locator('[data-count-input]').fill('98');
    await lineOf('OLD-1').locator('[data-count-input]').fill('12');
    await lineOf('SOON-2').locator('[data-count-input]').fill('40');
    await page.getByRole('button', { name: 'Save counts' }).click();
    await expect(page.getByTestId('count-done')).toHaveText('3 counts saved.');
    await expect(page.getByTestId('count-progress')).toContainText('3 of 3 lines counted');

    await page.getByRole('button', { name: 'Submit count' }).click();
    await expect(page.getByTestId('count-submit-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Submit for approval' }).click();

    // Review: expected is now shown, and the difference has a sign, an icon and a word.
    await expect(page.getByTestId('count-summary')).toContainText('3 lines counted, 1 differ, net −2');
    await expect(lineOf('LATER-3').getByTestId('count-expected')).toHaveText('100');
    await expect(lineOf('SOON-2').getByTestId('count-expected')).toHaveText('40');
    await expect(page.locator('[data-diff="shortage"]')).toContainText('Shortage −2');
    await expect(page.locator('[data-diff="shortage"] svg')).toBeVisible();
    await expect(page.locator('[data-diff="match"]')).toHaveCount(2);

    // A difference needs a reason; the owner is the only approver in the branch, so approving their own count is allowed.
    await expect(page.getByLabel('Reason for the corrections')).toHaveAttribute('required', '');
    await page.getByLabel('Reason for the corrections').fill('Two strips broken on the shelf');
    await page.getByRole('button', { name: 'Approve and update stock' }).click();
    await expect(page.getByTestId('count-done')).toContainText('Count approved. 1 corrections were made to stock, net −2.');
    await expect(page.locator('[data-status="APPROVED"]')).toBeVisible();

    // The stock followed.
    await page.goto('/pharmacy/stock');
    const row = page.getByTestId('stock-row').filter({ hasText: productName });
    await row.getByTestId('stock-batches').locator('> summary').click();
    const later = row.getByTestId('batch-row').filter({ hasText: 'LATER-3' });
    await expect(later.locator('dl').first()).toContainText('98');
    // The list shows the count as approved.
    await page.goto('/pharmacy/stock/counts');
    await expect(page.getByTestId('count-row').first()).toContainText('Approved');
    await page.context().close();
  });

  test('counts: a second person must approve a count when there is one, and the refusal says what to do', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Second');
    await seedStock(shop, randomUUID().slice(0, 6));
    const manager = await createStudioUser({ label: 'ph-count-manager', name: 'Count Manager' });
    people.push(manager.email);
    await makeStaff(manager.userId, shop.id, 'BRANCH_MANAGER');

    const counter = await freshPage(browser);
    // Staff have no "All branches" button: the first button is the first branch.
    await signInAndChoose(counter, manager, shop, 0);
    await counter.goto('/pharmacy/stock/counts');
    await counter.getByRole('button', { name: 'Start counting' }).click();
    await expect(counter).toHaveURL(/\/pharmacy\/stock\/counts\/[\w-]+$/);
    const url = counter.url();
    const lineOf = (lot: string) => counter.getByTestId('count-line').filter({ has: counter.getByTestId('count-lot').filter({ hasText: lot }) });
    await lineOf('LATER-3').locator('[data-count-input]').fill('90');
    await lineOf('OLD-1').locator('[data-count-input]').fill('12');
    await lineOf('SOON-2').locator('[data-count-input]').fill('40');
    await counter.getByRole('button', { name: 'Submit count' }).click();
    await counter.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(counter.getByTestId('count-summary')).toContainText('1 differ');
    await counter.getByLabel('Reason for the corrections').fill('Recount of the shelf');
    await counter.getByRole('button', { name: 'Approve and update stock' }).click();
    await expect(counter.getByTestId('count-error')).toContainText('You made this count, and another person in this branch may approve stock changes. Ask them to approve it.');
    await expect(counter.getByTestId('count-error').locator('svg')).toBeVisible();
    await counter.context().close();

    const approver = await freshPage(browser);
    await signInAndChoose(approver, owner, shop, 1);
    await approver.goto(url);
    await approver.getByLabel('Reason for the corrections').fill('Recount of the shelf');
    await approver.getByRole('button', { name: 'Approve and update stock' }).click();
    await expect(approver.getByTestId('count-done')).toContainText('Count approved.');
    await approver.context().close();
  });

  test('a cashier sees expiry but no follow-up form, and counts are not theirs', async ({ browser }) => {
    const { shop } = await owned('Cashier');
    await seedStock(shop, randomUUID().slice(0, 6));
    const cashier = await createStudioUser({ label: 'ph-count-cashier', name: 'Count Cashier' });
    people.push(cashier.email);
    await makeStaff(cashier.userId, shop.id, 'CASHIER');
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop, 0);
    await till.goto('/pharmacy/stock/expiry');
    await expect(till.getByTestId('expiry-row').first()).toBeVisible();
    await expect(till.getByTestId('stock-write-blocked')).toContainText('Your role can look at stock');
    await expect(till.getByTestId('expiry-followup')).toHaveCount(0);
    await expect(till.getByRole('navigation').getByRole('link', { name: 'Stock counts' })).toHaveCount(0);
    await till.goto('/pharmacy/stock/counts');
    await expect(till.getByTestId('counts-forbidden')).toContainText('You cannot see this page');
    await till.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    await seedStock(shop, randomUUID().slice(0, 6));
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const check = async (label: string) => {
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await scrollsSideways(page), `${label} at ${width}px`).toBe(false);
        expect(await seriousViolations(page), `${label} at ${width}px`).toEqual([]);
      }
      await page.setViewportSize({ width: 375, height: 800 });
    };

    await page.goto('/pharmacy/stock/expiry');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('expiry-row').first()).toBeVisible();
    await page.getByTestId('expiry-followup').first().locator('> summary').click();
    await page.getByLabel(ar('pharmacy.expiry.status.label')).first().selectOption('DISPOSED');
    await check('expiry');

    await page.goto('/pharmacy/stock/counts');
    await expect(page.getByTestId('count-start')).toBeVisible();
    await check('counts list and start form');
    await page.getByRole('button', { name: ar('pharmacy.counts.start.submit') }).click();
    await expect(page).toHaveURL(/\/pharmacy\/stock\/counts\/[\w-]+$/);
    await expect(page.getByTestId('count-line')).toHaveCount(3);
    await check('counting sheet');

    const inputs = page.locator('[data-count-input]');
    await inputs.nth(0).fill('97');
    await inputs.nth(1).fill('12');
    await inputs.nth(2).fill('40');
    await page.getByRole('button', { name: ar('pharmacy.counts.submit.open') }).click();
    await check('submit panel');
    await page.getByRole('button', { name: ar('pharmacy.counts.submit.yes') }).click();
    await expect(page.getByTestId('count-summary')).toBeVisible();
    await check('count review');
    await page.context().close();
  });
});
