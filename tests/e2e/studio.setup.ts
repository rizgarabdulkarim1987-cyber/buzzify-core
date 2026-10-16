import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { createStudioUser, SUPER_ADMIN_FILE, totp, uniqueClientAddress } from './helpers/studio';

/**
 * A new Super Admin, as the first one is made (`createPasswordUser`, no two-factor yet), signs in, is sent to set up
 * two-factor, enrols with the key shown on the page, keeps the recovery codes, and reaches the Studio. The signed-in
 * browser state and the key are saved for the Studio suites (SUPER_ADMIN_FILE); the teardown project removes the account.
 */
setup('a new Super Admin enrols in two-factor on first sign-in and reaches the Studio', async ({ browser }) => {
  const admin = await createStudioUser({ label: 'super-admin', name: 'Avin Studio', superAdmin: true });
  // Written first, so the teardown removes the account even when a step below fails.
  await mkdir(path.dirname(SUPER_ADMIN_FILE), { recursive: true });
  await writeFile(SUPER_ADMIN_FILE, JSON.stringify({ cookies: [], origins: [], superAdmin: { ...admin, secret: '' } }));

  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
  const page = await context.newPage();

  await page.goto('/studio');
  await expect(page).toHaveURL(/\/studio\/sign-in$/);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

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

  await expect(page).toHaveURL(/\/studio$/);
  const nav = page.getByRole('navigation', { name: 'Studio' });
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();

  const state = await context.storageState();
  await writeFile(SUPER_ADMIN_FILE, JSON.stringify({ ...state, superAdmin: { ...admin, secret } }, null, 2));
  await context.close();
});
