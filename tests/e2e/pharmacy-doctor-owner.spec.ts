import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The owner's control of the AI Doctor, end to end (plan Task 9): from Settings the owner opens "Who may use the AI Doctor", turns
 * it on for a pharmacist, and the pharmacist then has the Doctor (nav item, page); turned off again, the pharmacist has none and
 * the page is a 404 at the next request. The prescription-only review lists an OTC amoxicillin (not paracetamol) and links it
 * to its product form. A branch manager sees the switches read-only. At 375 and 1280 px, in English, Arabic and Sorani: no
 * document scroll, controls of at least 44 px, axe clean. Run:
 * `npx playwright test -c playwright.doctor.config.ts --workers=1 tests/e2e/pharmacy-doctor-owner.spec.ts`.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));

interface Shop {
  id: string;
  name: string;
  branch: { id: string; name: string };
}

async function makeShop(label: string): Promise<Shop> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const bn = `Main ${randomUUID().slice(0, 4)}`;
    const branch = await client.branch.create({ data: { restaurantId: row.id, name: bn, sortOrder: 0 }, select: { id: true } });
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    await client.phSettings.upsert({ where: { restaurantId: row.id }, create: { restaurantId: row.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' }, update: {} });
    return { id: row.id, name, branch: { id: branch.id, name: bn } };
  } finally {
    await client.$disconnect();
  }
}

async function product(shop: Shop, tradeName: string, genericName: string): Promise<string> {
  const client = db();
  try {
    const made = await client.phProduct.create({
      data: { restaurantId: shop.id, tradeName, genericName, activeIngredient: genericName, rxLevel: 'OTC', identityKey: `${tradeName}|${shop.id}`, searchText: searchTextOf({ tradeName, genericName, activeIngredient: genericName, strength: '', form: '', manufacturer: '' }) },
      select: { id: true },
    });
    return made.id;
  } finally {
    await client.$disconnect();
  }
}

async function staff(shop: Shop, user: StudioUser, role: 'PHARMACIST' | 'BRANCH_MANAGER'): Promise<string> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId: user.userId, restaurantId: shop.id, role }, select: { id: true } });
    await client.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: shop.branch.id } });
    return row.id;
  } finally {
    await client.$disconnect();
  }
}

async function switchOf(staffId: string): Promise<boolean> {
  const client = db();
  try {
    return (await client.phStaff.findUniqueOrThrow({ where: { id: staffId }, select: { aiDoctor: true } })).aiDoctor;
  } finally {
    await client.$disconnect();
  }
}

const logins = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function session(browser: Browser, user: StudioUser, shop: Shop, viewport: { width: number; height: number }): Promise<Page> {
  const saved = logins.get(user.email);
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport, ...(saved ? { storageState: saved } : {}) });
  await hideDevTools(context);
  const page = await context.newPage();
  if (saved) await page.goto('/pharmacy/select');
  else {
    await page.goto('/pharmacy');
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/pharmacy\/select$/, { timeout: 60_000 });
    logins.set(user.email, await context.storageState());
  }
  await page.getByRole('group', { name: shop.name }).getByRole('button', { name: new RegExp(shop.branch.name) }).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/, { timeout: 60_000 });
  return page;
}

const frameScrolls = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    return { page: doc.scrollHeight > doc.clientHeight + 1, sideways: doc.scrollWidth > doc.clientWidth + 1 };
  });

/** Every visible control inside `scope` smaller than 44 px on a side; a checkbox counts by its label row (the target). */
async function smallControls(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ['(scope missing)'];
    const out: string[] = [];
    const targets = [...root.querySelectorAll<HTMLElement>('button, a[href], input:not([type="checkbox"]), select, textarea')];
    for (const box of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) targets.push(box.closest('label') ?? box);
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (Math.min(r.width, r.height) < 44 - 0.5) out.push(`${el.getAttribute('data-testid') ?? el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((sel) => Object.keys(document.querySelector(sel) ?? {}).some((key) => key.startsWith('__reactFiber')), selector), { message: `${selector} hydrates`, timeout: 30_000 })
    .toBe(true);
}

test.describe.configure({ mode: 'serial' });

test.describe('Pharmacy AI Doctor: the owner decides who uses it @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let planWas: { limits: unknown } | null = null;
  let planMade = false;
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let shop: Shop;
  let owner: StudioUser;
  let pharmacist: StudioUser;
  let manager: StudioUser;
  let pharmacistStaffId: string;
  let amoxId: string;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
      planWas = await client.appPlan.findUnique({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, select: { limits: true } });
      const limits = { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 1000 };
      if (planWas) await client.appPlan.update({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, data: { limits } });
      else {
        await client.appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits } });
        planMade = true;
      }
    } finally {
      await client.$disconnect();
    }
    shop = await makeShop('DoctorOwner');
    restaurants.push(shop.id);
    const tag = randomUUID().slice(0, 5);
    amoxId = await product(shop, `Amoxil ${tag}`, 'amoxicillin');
    await product(shop, `Panadol ${tag}`, 'paracetamol');
    owner = await createStudioUser({ label: 'ph-dro-owner', name: 'Owner Dro' });
    pharmacist = await createStudioUser({ label: 'ph-dro-pharm', name: 'Pharmacist Dro' });
    manager = await createStudioUser({ label: 'ph-dro-mgr', name: 'Manager Dro' });
    people.push(owner.email, pharmacist.email, manager.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    pharmacistStaffId = await staff(shop, pharmacist, 'PHARMACIST');
    await staff(shop, manager, 'BRANCH_MANAGER');
  });

  test.afterAll(async () => {
    const client = db();
    try {
      if (applicationWas) await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      if (planMade) await client.appPlan.delete({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } } });
      else if (planWas) await client.appPlan.update({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, data: { limits: planWas.limits as never } });
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  /** The pharmacist's view: the Doctor's nav link and page, or none and a 404. */
  async function pharmacistSees(browser: Browser, doctor: boolean): Promise<void> {
    const page = await session(browser, pharmacist, shop, { width: 1280, height: 800 });
    if (doctor) {
      await expect(page.locator('a[href="/pharmacy/doctor"]').first()).toBeVisible();
      const response = await page.goto('/pharmacy/doctor');
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId('doctor-panel')).toBeVisible();
    } else {
      await expect(page.locator('a[href="/pharmacy/doctor"]')).toHaveCount(0);
      const response = await page.goto('/pharmacy/doctor');
      expect(response?.status()).toBe(404);
    }
    await page.context().close();
  }

  test('switch on for a pharmacist: the pharmacist sees the Doctor; off: not, at the next request', async ({ browser }) => {
    test.setTimeout(240_000);
    for (const who of [owner, pharmacist]) await setUserLocale(who.userId, 'en');
    await pharmacistSees(browser, false);

    const page = await session(browser, owner, shop, { width: 1280, height: 800 });
    await page.goto('/pharmacy/settings');
    await page.getByTestId('settings-link-staff').click();
    await expect(page).toHaveURL(/\/pharmacy\/settings\/staff$/, { timeout: 60_000 });
    const row = page.locator(`[data-testid="staff-row"][data-staff-id="${pharmacistStaffId}"]`);
    await expect(row).toContainText('Pharmacist Dro');
    const ownerRow = page.locator('[data-testid="staff-row"][data-kind="OWNER"]');
    await expect(ownerRow.getByTestId('staff-doctor-switch')).toBeChecked();
    await expect(ownerRow.getByTestId('staff-doctor-switch')).toBeDisabled();
    const toggle = row.getByRole('switch', { name: 'AI Doctor' });
    await expect(toggle).not.toBeChecked();
    await hydrated(page, `[data-staff-id="${pharmacistStaffId}"] [data-testid="staff-doctor-switch"]`);
    expect(await frameScrolls(page)).toEqual({ page: false, sideways: false });
    expect(await smallControls(page, '#main')).toEqual([]);
    expect(await seriousViolations(page)).toEqual([]);

    await row.getByText('AI Doctor').click();
    await expect(page.getByTestId('staff-doctor-message')).toContainText('AI Doctor turned on for Pharmacist Dro');
    await expect(toggle).toBeChecked();
    await expect.poll(() => switchOf(pharmacistStaffId)).toBe(true);
    await pharmacistSees(browser, true);

    await row.getByText('AI Doctor').click();
    await expect(page.getByTestId('staff-doctor-message')).toContainText('AI Doctor turned off for Pharmacist Dro');
    await expect.poll(() => switchOf(pharmacistStaffId)).toBe(false);
    await page.context().close();
    await pharmacistSees(browser, false);
  });

  test('a branch manager sees the list with every switch read-only, and why', async ({ browser }) => {
    test.setTimeout(120_000);
    await setUserLocale(manager.userId, 'en');
    const page = await session(browser, manager, shop, { width: 1280, height: 800 });
    await page.goto('/pharmacy/settings/staff');
    await expect(page.getByTestId('staff-owner-only')).toBeVisible();
    const switches = page.getByTestId('staff-doctor-switch');
    expect(await switches.count()).toBeGreaterThan(0);
    for (const box of await switches.all()) await expect(box).toBeDisabled();
    await page.context().close();
  });

  test('a pharmacist gets a 404 on both owner screens', async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await session(browser, pharmacist, shop, { width: 1280, height: 800 });
    for (const path of ['/pharmacy/settings/staff', '/pharmacy/settings/doctor-review']) expect((await page.goto(path))?.status(), path).toBe(404);
    await page.context().close();
  });

  for (const locale of ['en', 'ar', 'ckb'] as const) {
    for (const width of [375, 1280]) {
      test(`the screens fit (${locale}, ${width}px): the staff list, and the review lists OTC amoxicillin with a link to its form`, async ({ browser }) => {
        test.setTimeout(180_000);
        await setUserLocale(owner.userId, locale);
        const page = await session(browser, owner, shop, { width, height: width === 375 ? 740 : 800 });
        if (locale !== 'en') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await page.goto('/pharmacy/settings/staff');
        await expect(page.getByTestId('staff-row').first()).toBeVisible();
        expect(await frameScrolls(page), 'staff').toEqual({ page: false, sideways: false });
        expect(await smallControls(page, '#main'), 'staff').toEqual([]);
        expect(await seriousViolations(page), 'staff').toEqual([]);

        await page.goto('/pharmacy/settings');
        await page.getByTestId('settings-link-review').click();
        await expect(page).toHaveURL(/\/pharmacy\/settings\/doctor-review$/, { timeout: 60_000 });
        await expect(page.getByTestId('review-kurdish-note')).toBeVisible();
        const items = page.getByTestId('review-item');
        await expect(items).toHaveCount(1);
        await expect(items.first()).toHaveAttribute('data-product-id', amoxId);
        await expect(items.first()).toContainText('amoxicillin');
        expect(await frameScrolls(page), 'review').toEqual({ page: false, sideways: false });
        expect(await smallControls(page, '#main'), 'review').toEqual([]);
        expect(await seriousViolations(page), 'review').toEqual([]);
        await items.first().getByRole('link').click();
        await expect(page).toHaveURL(new RegExp(`/pharmacy/catalog/${amoxId}$`), { timeout: 60_000 });
        await page.context().close();
      });
    }
  }
});
