import { expect, test, type Browser, type Page } from '@playwright/test';
import { menuBySlug, SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * The menu workspace (spec 10.3, 10.4): its frame and bar, and the draft preview in frames. Read-only on the seeded
 * ATELIER menu.
 */

async function freshPage(browser: Browser, signedIn = true): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
    ...(signedIn ? { storageState: SUPER_ADMIN_FILE } : {}),
  });
  return context.newPage();
}

test.describe('the menu workspace @desktop', () => {
  let menuId: string;

  test.beforeAll(async () => {
    menuId = (await menuBySlug('atelier')).id;
  });

  test('shows the menu, its tabs and the bar with Preview and Publish', async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto(`/studio/menus/${menuId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'ATELIER' })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Menu workspace' });
    await expect(tabs.getByRole('link', { name: 'Content' })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: 'Preview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Preview' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  });

  test('previews the draft in a phone frame whose document is not indexed and not cached', async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto(`/studio/menus/${menuId}/preview`);
    const phone = page.frameLocator('iframe[title*="Phone"]');
    await expect(phone.getByRole('button', { name: /Atelier Burger/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(phone.getByRole('note')).toContainText('Preview of unpublished changes');

    const response = await page.request.get(`/studio/preview/${menuId}/en`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.text()).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  test('switches the frames to Arabic, right to left', async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto(`/studio/menus/${menuId}/preview`);
    const languages = page.getByRole('group', { name: 'Language of the preview' });
    await languages.getByRole('button', { name: 'العربية' }).click();
    await expect(languages.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
    const phone = page.frameLocator('iframe[title*="Phone"]');
    await expect(phone.locator('html')).toHaveAttribute('dir', 'rtl', { timeout: 15_000 });
    await expect(phone.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('sends a signed-out visitor of a preview to sign in', async ({ browser }) => {
    const page = await freshPage(browser, false);
    await page.goto(`/studio/preview/${menuId}/en`);
    await expect(page).toHaveURL(/\/studio\/sign-in$/);
  });
});
