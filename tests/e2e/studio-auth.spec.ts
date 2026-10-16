import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  atelierRestaurant,
  createStudioUser,
  inviteOwner,
  linkInMail,
  removeStudioUsers,
  SUPER_ADMIN_FILE,
  superAdmin,
  totp,
  uniqueClientAddress,
  uniquePassword,
} from './helpers/studio';

/**
 * Signing in to the Studio, two-factor, resetting a password and accepting an invitation, through the pages a person
 * uses. Each test has a browser of its own with an address of its own (`x-forwarded-for`), so the Studio's per-address
 * limits count each test apart from the others and from earlier runs.
 */

async function freshPage(browser: Browser, options: { signedIn?: boolean; locale?: string } = {}): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
    ...(options.signedIn ? { storageState: SUPER_ADMIN_FILE } : {}),
  });
  if (options.locale) {
    await context.addCookies([{ name: 'studio-locale', value: options.locale, url: 'http://127.0.0.1:3100/studio' }]);
  }
  return context.newPage();
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

test.describe('Studio sign-in @desktop', () => {
  const created: string[] = [];
  test.afterAll(async () => {
    await removeStudioUsers(created);
  });

  test('the signed-in state from setup opens the Studio, with two-factor on', async ({ browser }) => {
    const page = await freshPage(browser, { signedIn: true });
    await page.goto('/studio/account');
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    const twoFactor = page.getByRole('region', { name: 'Two-factor authentication' });
    await expect(twoFactor.getByText('On', { exact: true })).toBeVisible();
    // A Super Admin may make new recovery codes but never turn two-factor off.
    await expect(twoFactor.getByRole('button', { name: 'New recovery codes' })).toBeVisible();
    await expect(twoFactor.getByRole('button', { name: 'Turn off' })).toHaveCount(0);
    await page.context().close();
  });

  test('the Super Admin signs in again with a code from the app, and signs out', async ({ browser }) => {
    const admin = superAdmin();
    const page = await freshPage(browser);

    await page.goto('/studio/sign-in');
    await page.getByLabel('Email').fill(`  ${admin.email.toUpperCase()} `);
    await page.getByLabel('Password', { exact: true }).fill('not the password at all');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Wrong email or password' })).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/studio\/two-factor$/);

    await page.getByLabel('Authentication code').fill(totp(admin.secret) === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('That code is not correct')).toBeVisible();

    await page.getByLabel('Authentication code').fill(totp(admin.secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Welcome, ${admin.name}`);

    // The menu opens once the page has hydrated, which a loaded machine may still be doing after the full page load.
    const signOut = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(async () => {
      if (!(await signOut.isVisible())) await page.getByRole('button', { name: 'Account menu' }).click();
      await expect(signOut).toBeVisible({ timeout: 1000 });
    }).toPass();
    await signOut.click();
    await expect(page).toHaveURL(/\/studio\/sign-in$/);
    await page.goto('/studio/account');
    await expect(page).toHaveURL(/\/studio\/sign-in$/);
    await page.context().close();
  });

  test('a forgotten password is reset through the link in the email', async ({ browser }) => {
    const person = await createStudioUser({ label: 'reset', name: 'Shilan Reset' });
    created.push(person.email);
    const page = await freshPage(browser);

    await page.goto('/studio/sign-in');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/studio\/forgot$/);
    await page.getByLabel('Email').fill(person.email);
    await page.getByRole('button', { name: 'Send the link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    const link = await linkInMail(person.email);
    expect(link).toMatch(/\/studio\/reset\?token=/);
    await page.goto(link);
    const next = uniquePassword();
    await page.getByLabel('New password', { exact: true }).fill(next);
    await page.getByLabel('Repeat the new password').fill(`${next}x`);
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page.getByText('The two passwords are not the same')).toBeVisible();

    await page.getByLabel('Repeat the new password').fill(next);
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page).toHaveURL(/\/studio\/sign-in\?notice=reset$/);
    await expect(page.getByText('Your password was changed. Sign in with the new one.')).toBeVisible();

    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password', { exact: true }).fill(next);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/studio$/);

    // The link worked once.
    await page.goto(link);
    await page.getByLabel('New password', { exact: true }).fill(uniquePassword());
    await page.getByLabel('Repeat the new password').fill(await page.getByLabel('New password', { exact: true }).inputValue());
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This link has expired or was already used' })).toBeVisible();
    await page.context().close();
  });

  test('an invitation accepted as a new owner lands in their restaurant', async ({ browser }) => {
    const restaurant = await atelierRestaurant();
    const { email, url } = await inviteOwner(superAdmin().userId, restaurant.id);
    created.push(email);
    const page = await freshPage(browser);

    await page.goto(new URL(url).pathname);
    await expect(page.getByRole('heading', { level: 1, name: 'Join Buzzify Studio' })).toBeVisible();
    await expect(page.getByText(`You are invited as Owner of ${restaurant.name}.`)).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    await page.getByLabel('Your name').fill('Hawre Owner');
    await page.getByLabel('Password', { exact: true }).fill('password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 12 characters')).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(uniquePassword());
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/studio$/);

    // An owner's Studio is their restaurant: one item in the navigation, and the restaurant on the first page.
    const nav = page.getByRole('navigation', { name: 'Studio' });
    await expect(nav.getByRole('link')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: 'My restaurant' })).toHaveAttribute('href', /^\/studio\/(menus|restaurants)\/\w+$/);
    await expect(page.getByRole('region', { name: 'Your restaurants' }).getByRole('link', { name: new RegExp(restaurant.name) })).toBeVisible();

    // The link is spent.
    await page.goto(new URL(url).pathname);
    await expect(page.getByRole('heading', { level: 1, name: 'This invitation was already used' })).toBeVisible();
    await page.context().close();
  });

  for (const [locale, heading, signIn] of [
    ['ar', 'تسجيل الدخول', 'تسجيل الدخول'],
    ['ckb', 'چوونەژوورەوە', 'چوونەژوورەوە'],
  ] as const) {
    test(`the sign-in page in ${locale} is right to left and has no serious accessibility problems`, async ({ browser }) => {
      const page = await freshPage(browser, { locale });
      await page.goto('/studio/sign-in');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('button', { name: signIn, exact: true })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await page.context().close();
    });
  }

  test('the language switch turns the signed-out pages to Arabic and back, and English passes axe', async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto('/studio/sign-in');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    await page.getByRole('group', { name: 'اللغة' }).getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
    await page.context().close();
  });
});
