import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { textScriptKey } from '@/server/ai/provider/scripted';
import { doctorUserText } from '@/server/pharmacy/doctor/prompt';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { ASSISTANT_SCRIPT_PATH } from './helpers/phase7b-env';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The AI Doctor, end to end (plan Task 8): a complaint answered by the SCRIPTED provider (never a real model) with options matched
 * to the branch's own stock, Add to cart into the Sell cart (the side panel on a desktop, the bottom sheet on a phone, the link
 * from the full page), a red-flag complaint that refers with no options and no model call, the history on the full page, and a
 * person without access who sees no Doctor anywhere and gets a 404. At 375 and 1280 px, in English and Arabic: no document scroll,
 * controls of at least 44 px, axe clean, and the app's "consult a doctor" line last under every answer. Run:
 * `npx playwright test -c playwright.doctor.config.ts --workers=1 tests/e2e/pharmacy-doctor.spec.ts`.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const COMPLAINT = 'Headache since this morning, no other medicines';
const AGE = 34;

/** The scripted model's answer for the complaint above: one option in this shop's stock, one that is not. */
const ANSWER = {
  redFlags: [],
  likelyCauses: ['Tension headache'],
  askNext: ['Any allergies to pain relievers?'],
  options: [
    { ingredient: 'paracetamol', tradeNames: ['Panadol'], note: 'Take with water' },
    { ingredient: 'ibuprofen', tradeNames: ['Brufen'], note: 'After food' },
  ],
  tellCustomer: ['Rest and drink water'],
  referIf: ['The headache is sudden and severe'],
  cautions: ['Do not take with other paracetamol products'],
  unsure: false,
};

function script(): void {
  const key = textScriptKey(doctorUserText({ mode: 'COMPLAINT', text: COMPLAINT, ageYears: AGE }));
  writeFileSync(ASSISTANT_SCRIPT_PATH, JSON.stringify({ [key]: { text: JSON.stringify(ANSWER), inputTokens: 900, outputTokens: 300 } }));
}

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
    const branches: Shop['branches'] = [];
    const bn = `Main ${randomUUID().slice(0, 4)}`;
    const created = await client.branch.create({ data: { restaurantId: row.id, name: bn, sortOrder: 0 }, select: { id: true } });
    branches.push({ id: created.id, name: bn });
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    await client.phSettings.upsert({ where: { restaurantId: row.id }, create: { restaurantId: row.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' }, update: {} });
    return { id: row.id, name, branches };
  } finally {
    await client.$disconnect();
  }
}

/** Panadol (paracetamol, OTC, 250 IQD a tablet, 2,000 a strip of 10) with 140 tablets at Main. No ibuprofen at all. */
async function seedCatalog(shop: Shop, tag: string): Promise<{ name: string }> {
  const client = db();
  try {
    const tradeName = `Panadol ${tag}`;
    const product = await client.phProduct.create({
      data: {
        restaurantId: shop.id,
        tradeName,
        genericName: 'paracetamol',
        activeIngredient: 'paracetamol',
        strength: '500 mg',
        form: 'tablet',
        rxLevel: 'OTC',
        identityKey: `${tradeName}|${shop.id}`,
        searchText: searchTextOf({ tradeName, genericName: 'paracetamol', activeIngredient: 'paracetamol', strength: '500 mg', form: 'tablet', manufacturer: '' }),
      },
      select: { id: true },
    });
    const tablet = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
    const strip = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
    for (const [unitId, amountMinor] of [[tablet.id, 250n], [strip.id, 2000n]] as const) {
      await client.phPrice.create({ data: { restaurantId: shop.id, productId: product.id, unitId, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
    }
    const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
    const batch = await client.phBatch.create({ data: { restaurantId: shop.id, productId: product.id, lot: 'LOT-1', expiryDate: new Date(Date.now() + 300 * DAY) }, select: { id: true } });
    await scoped.$transaction(async (tx) => {
      await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branches[0]!.id, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: 140 }, reason: '' });
    });
    return { name: tradeName };
  } finally {
    await client.$disconnect();
  }
}

async function openShiftInDb(shop: Shop, userId: string): Promise<void> {
  const client = db();
  try {
    await client.phShift.create({ data: { restaurantId: shop.id, branchId: shop.branches[0]!.id, userId, currency: 'IQD', openingFloatMinor: 0n } });
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
  await page.getByRole('group', { name: shop.name }).getByRole('button', { name: new RegExp(shop.branches[0]!.name) }).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/, { timeout: 60_000 });
  return page;
}

/** Whether the document scrolls (it never should) and whether `<main>` does. */
const frameScrolls = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    return { page: doc.scrollHeight > doc.clientHeight + 1, sideways: doc.scrollWidth > doc.clientWidth + 1 };
  });

/** Every visible control inside `scope` that is smaller than 44 px on a side, by its text or test id. */
async function smallControls(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ['(scope missing)'];
    const out: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>('button, a[href], input:not([type="file"]):not([type="checkbox"]), select, textarea, label:has(> input[type="file"]), label:has(> input[type="checkbox"])')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (Math.min(r.width, r.height) < 44 - 0.5) out.push(`${el.getAttribute('data-testid') ?? el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}

/**
 * Waits until React has hydrated the element at `selector`: text typed before then is thrown away by hydration and a click
 * does nothing, which a dev server still compiling the route makes likely.
 */
async function hydrated(page: Page, selector: string): Promise<void> {
  await expect
    .poll(() => page.evaluate((sel) => Object.keys(document.querySelector(sel) ?? {}).some((key) => key.startsWith('__reactFiber')), selector), {
      message: `${selector} hydrates`,
      timeout: 30_000,
    })
    .toBe(true);
}

/** The answer's last element is the app's disclaimer. */
async function disclaimerIsLast(page: Page, scope: string): Promise<void> {
  const last = await page.locator(`${scope} [data-testid="doctor-answer"]`).evaluate((el) => el.lastElementChild?.getAttribute('data-testid'));
  expect(last).toBe('doctor-disclaimer');
}

test.describe.configure({ mode: 'serial' });

test.describe('Pharmacy AI Doctor @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let planWas: { limits: unknown } | null = null;
  let planMade = false;
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let shop: Shop;
  let catalog: { name: string };
  let owner: StudioUser;
  let pharmacistOff: StudioUser;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    script();
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
    shop = await makeShop('Doctor');
    restaurants.push(shop.id);
    catalog = await seedCatalog(shop, randomUUID().slice(0, 5));
    owner = await createStudioUser({ label: 'ph-doc-owner', name: 'Doc Owner' });
    pharmacistOff = await createStudioUser({ label: 'ph-doc-off', name: 'Doc Off' });
    people.push(owner.email, pharmacistOff.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    const c = db();
    try {
      const row = await c.phStaff.create({ data: { userId: pharmacistOff.userId, restaurantId: shop.id, role: 'PHARMACIST' }, select: { id: true } });
      await c.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: shop.branches[0]!.id } });
    } finally {
      await c.$disconnect();
    }
    await openShiftInDb(shop, owner.userId);
  });

  test.afterAll(async () => {
    const client = db();
    try {
      if (applicationWas) await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      if (planMade) await client.appPlan.delete({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } } });
      else if (planWas) await client.appPlan.update({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, data: { limits: planWas.limits as never } });
      await client.phDoctorLog.deleteMany({ where: { restaurantId: { in: restaurants } } });
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  for (const locale of ['en', 'ar'] as const) {
    test(`desktop Sell (${locale}): a complaint is answered from the shop's stock and Add to cart puts it in the cart`, async ({ browser }) => {
      test.setTimeout(180_000);
      await setUserLocale(owner.userId, locale);
      const page = await session(browser, owner, shop, { width: 1280, height: 800 });
      await page.goto('/pharmacy/sell');
      if (locale === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const panel = page.getByTestId('sell-doctor-slot').getByTestId('doctor-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('doctor-fab')).toBeHidden();
      await hydrated(page, '[data-testid="sell-doctor-slot"] [data-testid="doctor-ask"]');
      await panel.getByTestId('doctor-complaint').fill(COMPLAINT);
      await panel.getByTestId('doctor-age').fill(String(AGE));
      await panel.getByTestId('doctor-ask').click();
      const answer = panel.getByTestId('doctor-answer');
      await expect(answer).toBeVisible();
      await disclaimerIsLast(page, '[data-testid="sell-doctor-slot"]');
      // In stock: the catalog's own price and quantity; not in stock: the name and "not in your stock", nothing to press.
      const inStock = answer.getByTestId('doctor-option-IN_STOCK');
      await expect(inStock).toContainText(catalog.name);
      await expect(inStock.getByTestId('doctor-item-price')).toContainText('250');
      await expect(inStock.getByTestId('doctor-item-qty')).toContainText('140');
      const missing = answer.getByTestId('doctor-option-NOT_IN_STOCK');
      await expect(missing).toContainText('ibuprofen');
      await expect(missing.locator('button, a')).toHaveCount(0);
      expect(await page.getByTestId('doctor-live').first().getAttribute('aria-live')).toBe('polite');

      await expect(page.getByTestId('cart-line')).toHaveCount(0);
      await inStock.getByTestId('doctor-add').click();
      await expect(page.getByTestId('cart-line')).toHaveCount(1);
      await expect(page.getByTestId('cart-line').first()).toContainText(catalog.name);

      expect(await frameScrolls(page)).toEqual({ page: false, sideways: false });
      expect(await smallControls(page, '[data-testid="sell-doctor-slot"]')).toEqual([]);
      expect(await seriousViolations(page)).toEqual([]);
      await page.context().close();
    });

    test(`phone Sell (${locale}): a red-flag complaint refers with no options, in a bottom sheet that Escape closes`, async ({ browser }) => {
      test.setTimeout(180_000);
      await setUserLocale(owner.userId, locale);
      const page = await session(browser, owner, shop, { width: 375, height: 740 });
      await page.goto('/pharmacy/sell');
      const fab = page.getByTestId('doctor-fab');
      await expect(fab).toBeVisible();
      expect(Math.min(...Object.values((await fab.boundingBox())!).slice(2))).toBeGreaterThanOrEqual(44);
      await hydrated(page, '[data-testid="doctor-fab"]');
      await fab.click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await sheet.getByTestId('doctor-complaint').fill('Crushing chest pain and trouble breathing for an hour');
      await sheet.getByTestId('doctor-ask').click();
      await expect(sheet.getByTestId('doctor-section-refer')).toBeVisible();
      await expect(sheet.getByTestId('doctor-section-options')).toHaveCount(0);
      await expect(sheet.getByTestId('doctor-add')).toHaveCount(0);
      await disclaimerIsLast(page, 'dialog');
      expect(await smallControls(page, 'dialog')).toEqual([]);
      expect(await frameScrolls(page)).toEqual({ page: false, sideways: false });
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(fab).toBeFocused();
      expect(await frameScrolls(page)).toEqual({ page: false, sideways: false });
      await page.context().close();
    });

    for (const width of [375, 1280]) {
      test(`Home card and full page (${locale}, ${width}px): the history shows earlier questions, and Add opens Sell with the item`, async ({ browser }) => {
        test.setTimeout(180_000);
        await setUserLocale(owner.userId, locale);
        const page = await session(browser, owner, shop, { width, height: width === 375 ? 740 : 800 });
        const card = page.getByTestId('home-doctor');
        await expect(card).toBeVisible();
        expect(await frameScrolls(page)).toMatchObject({ sideways: false });
        expect(await smallControls(page, '[data-testid="home-doctor"]')).toEqual([]);
        await card.getByRole('link').click();
        await expect(page).toHaveURL(/\/pharmacy\/doctor$/, { timeout: 60_000 });
        const history = page.getByTestId('doctor-history');
        await expect(history).toContainText(COMPLAINT);
        await expect(history).toContainText('chest pain');
        const panel = page.getByTestId('doctor-panel');
        await hydrated(page, '[data-testid="doctor-panel"] [data-testid="doctor-ask"]');
        await panel.getByTestId('doctor-complaint').fill(COMPLAINT);
        await panel.getByTestId('doctor-age').fill(String(AGE));
        await panel.getByTestId('doctor-ask').click();
        await expect(panel.getByTestId('doctor-answer')).toBeVisible();
        await disclaimerIsLast(page, '[data-testid="doctor-panel"]');
        expect(await frameScrolls(page)).toEqual({ page: false, sideways: false });
        expect(await smallControls(page, '#main')).toEqual([]);
        expect(await seriousViolations(page)).toEqual([]);
        const add = panel.getByTestId('doctor-option-IN_STOCK').getByTestId('doctor-add').first();
        await expect(add).toHaveAttribute('href', /\/pharmacy\/sell\?add=.+:1$/);
        await add.click();
        await expect(page).toHaveURL(/\/pharmacy\/sell/, { timeout: 60_000 });
        await expect(page.getByTestId('cart-line')).toHaveCount(1);
        await expect(page.getByTestId('cart-line').first()).toContainText(catalog.name);
        // The cart is a saved draft per till: empty it so the next test starts clean.
        await page.evaluate(() => localStorage.clear());
        await page.context().close();
      });
    }
  }

  test('a person without access (the switch is off) sees no Doctor anywhere and gets a 404 on its page', async ({ browser }) => {
    test.setTimeout(120_000);
    await setUserLocale(pharmacistOff.userId, 'en');
    const page = await session(browser, pharmacistOff, shop, { width: 1280, height: 800 });
    await expect(page.getByTestId('home-doctor')).toHaveCount(0);
    await expect(page.locator('a[href="/pharmacy/doctor"]')).toHaveCount(0);
    const response = await page.goto('/pharmacy/doctor');
    expect(response?.status()).toBe(404);
    await page.goto('/pharmacy/sell');
    await expect(page.getByTestId('doctor-panel')).toHaveCount(0);
    await expect(page.getByTestId('doctor-fab')).toHaveCount(0);
    await page.context().close();
  });
});
