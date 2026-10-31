import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test as setup, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  atelierRestaurant,
  createStudioUser,
  devSeedPassword,
  OWNER_FILE,
  OWNER_KEPT_FILE,
  SEEDED_OWNER_EMAIL,
  seededUser,
  setUserLocale,
  SUPER_ADMIN_FILE,
  superAdminFile,
  totp,
  uniqueClientAddress,
  type StudioUser,
} from './helpers/studio';

/**
 * The people the Studio suites act as, each signed in once per run (sign-ins are rate limited per address) and saved as
 * a Playwright storage state:
 * - a new Super Admin who enrols in two-factor on first sign-in, checked step by step (SUPER_ADMIN_FILE);
 * - a Super Admin for Arabic and one for Sorani, enrolled the same way, whom the accessibility suite reads the Studio as;
 * - the seeded owner of ATELIER, with the development password (OWNER_FILE); their session is kept between runs
 *   (OWNER_KEPT_FILE) and reused while it lasts, since the suite runs more often than their sign-ins allow.
 * The teardown project removes the Super Admins.
 */

/** Saves a Super Admin's file before anything else, so the teardown removes the account even when a step below fails. */
async function reserve(file: string, admin: StudioUser) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ cookies: [], origins: [], superAdmin: { ...admin, secret: '' } }));
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/studio/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
}

setup('a new Super Admin enrols in two-factor on first sign-in and reaches the Studio', async ({ browser }) => {
  const admin = await createStudioUser({ label: 'super-admin', name: 'Avin Studio', superAdmin: true });
  await reserve(SUPER_ADMIN_FILE, admin);

  const context = await freshContext(browser);
  const page = await context.newPage();

  await page.goto('/studio');
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  await signIn(page, admin.email, admin.password);

  // A Super Admin without two-factor gets nowhere else.
  await expect(page).toHaveURL(/\/studio\/setup-two-factor$/);
  await page.goto('/studio/account');
  await expect(page).toHaveURL(/\/studio\/setup-two-factor$/);

  await page.getByLabel('Password', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  const secret = (await page.getByLabel('Setup key').inputValue()).replace(/\s+/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();

  await page.getByLabel('6-digit code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();

  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const codes = await page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  expect(codes).toHaveLength(10);
  for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as text' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('buzzify-studio-recovery-codes.txt');
  const text = await readFile(await file.path(), 'utf8');
  expect(text).toContain(admin.email);
  for (const code of codes) expect(text).toContain(code);

  // The way on opens only once the person says the codes are saved.
  const finish = page.getByRole('button', { name: 'Continue to the Studio' });
  await expect(finish).toBeDisabled();
  await page.getByLabel('I have saved my recovery codes').check();
  await finish.click();

  // A Super Admin lands on the project hub; Menu and Cashier opens the Studio's sidebar.
  await expect(page).toHaveURL(/\/studio$/);
  await page.locator('[data-project="large"]').first().click();
  await expect(page).toHaveURL(/\/studio\/overview$/);
  const nav = page.getByRole('navigation', { name: 'Studio' });
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();

  const state = await context.storageState();
  await writeFile(SUPER_ADMIN_FILE, JSON.stringify({ ...state, superAdmin: { ...admin, secret } }, null, 2));
  await context.close();
});

for (const [locale, name] of [
  ['ar', 'سارا أحمد'],
  ['ckb', 'ئاڤین کەریم'],
] as const) {
  setup(`a Super Admin who reads the Studio in ${locale} enrols in two-factor`, async ({ browser }) => {
    // Enrolled in English, the flow the first setup checks, then given their language: the Studio speaks a signed-in
    // person's own.
    const admin = await createStudioUser({ label: `super-admin-${locale}`, name, superAdmin: true });
    const file = superAdminFile(locale);
    await reserve(file, admin);

    const context = await freshContext(browser);
    const page = await context.newPage();
    await signIn(page, admin.email, admin.password);
    await expect(page).toHaveURL(/\/studio\/setup-two-factor$/);
    await page.getByLabel('Password', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: 'Continue' }).click();
    const secret = (await page.getByLabel('Setup key').inputValue()).replace(/\s+/g, '');
    await page.getByLabel('6-digit code from the app').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on two-factor' }).click();
    await page.getByLabel('I have saved my recovery codes').check();
    await page.getByRole('button', { name: 'Continue to the Studio' }).click();
    await expect(page).toHaveURL(/\/studio$/);

    await setUserLocale(admin.userId, locale);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const state = await context.storageState();
    await writeFile(file, JSON.stringify({ ...state, superAdmin: { ...admin, secret } }, null, 2));
    await context.close();
  });
}

setup('the seeded owner of ATELIER is signed in and lands on its menu', async ({ browser }) => {
  // The development users exist only after `npm run db:seed` with DEV_SEED_PASSWORD; say so rather than fail at sign-in.
  const owner = await seededUser(SEEDED_OWNER_EMAIL);
  const atelier = await atelierRestaurant();
  expect(owner.memberships, `${SEEDED_OWNER_EMAIL} should own ATELIER only`).toEqual([{ restaurantId: atelier.id, role: 'OWNER' }]);
  // No two-factor for an owner; one restaurant with one menu opens on that menu.
  const landing = /^\/studio\/menus\/\w+$/;

  // The session kept from an earlier run, while the Studio still accepts it: their sign-ins are limited.
  let context: BrowserContext | undefined;
  if (existsSync(OWNER_KEPT_FILE)) {
    context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: OWNER_KEPT_FILE });
    const page = await context.newPage();
    await page.goto('/studio');
    // The Studio sends a signed-in owner to their menu and anyone else to sign in; the redirect can come after the page
    // has started to stream (then the browser follows it), so wait for one of the two.
    await page.waitForURL((url) => landing.test(url.pathname) || url.pathname === '/studio/sign-in');
    if (!landing.test(new URL(page.url()).pathname)) {
      await context.close();
      context = undefined;
    }
  }
  if (!context) {
    context = await freshContext(browser);
    const page = await context.newPage();
    await signIn(page, SEEDED_OWNER_EMAIL, devSeedPassword());
    await expect(page).toHaveURL(/\/studio\/menus\/\w+$/);
  }
  const page = context.pages()[0]!;
  await expect(page.getByRole('heading', { level: 1, name: 'ATELIER' })).toBeVisible();

  for (const file of [OWNER_FILE, OWNER_KEPT_FILE]) {
    await mkdir(path.dirname(file), { recursive: true });
    await context.storageState({ path: file });
  }
  await context.close();
});
