import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { OWNER_FILE, SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * The Menu Styles gallery (docs/superpowers/plans: the Menu Styles library): a Super Admin sees the 35 styles in their
 * four groups, searches and filters them, and clears the filters. An owner is sent back to their own work.
 */

const en = getStudioTranslator('en');

/** A Super Admin's page, from the session the setup project saved (their sign-ins are rate limited). */
async function superAdminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: SUPER_ADMIN_FILE, extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
  return context.newPage();
}

const showing = (count: number) => en('styles.library.showing', { count, total: 35 });

test.describe('the Menu Styles gallery @desktop', () => {
  test('shows the 35 styles in four groups', async ({ browser }) => {
    const page = await superAdminPage(browser);
    await page.goto('/studio/styles');
    await expect(page.getByRole('heading', { level: 1, name: en('styles.library.title') })).toBeVisible();
    await expect(page.getByText(showing(35))).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(4);
    const first = page.getByRole('link', { name: new RegExp(en('styles.themed-kurd.name')) });
    await expect(first).toHaveAttribute('href', '/studio/styles/themed-kurd');
    const poster = first.locator('img');
    await expect(poster).toHaveAttribute('src', '/studio/style-files/poster/themed-kurd');
    // The poster has loaded at its own size, so the signed-in route served it.
    await expect.poll(() => poster.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(344);
  });

  test('searches the styles and clears the filters', async ({ browser }) => {
    const page = await superAdminPage(browser);
    await page.goto('/studio/styles');
    await page.getByRole('searchbox', { name: en('styles.library.search') }).fill('Airport');
    await expect(page.getByText(showing(1))).toBeVisible();
    await expect(page.locator('a[href^="/studio/styles/"]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: new RegExp(en('styles.layout-2-dep.name')) })).toBeVisible();

    await page.getByRole('searchbox', { name: en('styles.library.search') }).fill('zzzz');
    await expect(page.getByText(showing(0))).toBeVisible();
    await page.getByRole('button', { name: en('common.clearFilters') }).click();
    await expect(page.getByText(showing(35))).toBeVisible();
  });

  test('filters by group', async ({ browser }) => {
    const page = await superAdminPage(browser);
    await page.goto('/studio/styles');
    await page
      .getByRole('navigation', { name: en('styles.library.groups') })
      .getByRole('button', { name: new RegExp(en('styles.group.heritage')) })
      .click();
    await expect(page).toHaveURL(/group=heritage/);
    await expect(page.getByText(showing(3))).toBeVisible();
    await expect(page.getByRole('list', { name: en('styles.group.heritage') }).getByRole('link')).toHaveCount(3);
  });

  test('sends an owner to their own work', async ({ browser }) => {
    const context = await browser.newContext({ storageState: OWNER_FILE, extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
    const page = await context.newPage();
    await page.goto('/studio/styles');
    await expect(page).toHaveURL(/\/studio/);
    await expect(page).not.toHaveURL(/\/studio\/styles/);
  });
});

test.describe('a Menu Style in its phone frame @desktop', () => {
  const airport = en('styles.layout-2-dep.name');

  test('opens a style from its card and runs it in the frame', async ({ browser }) => {
    const page = await superAdminPage(browser);
    await page.goto('/studio/styles');
    await page.getByRole('link', { name: new RegExp(airport) }).click();
    await expect(page).toHaveURL(/\/studio\/styles\/layout-2-dep$/);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(airport) })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`^${airport} · `));

    const frame = page.frameLocator(`iframe[title="${airport}"]`);
    // Solo mode: the style is open full size, its own gallery hidden.
    await expect(frame.locator('.app.on')).toBeVisible();
    const sum = frame.locator('#screen .cart .sum');
    await expect(sum).toHaveText(/^٠ /);
    await frame.locator('#screen .add').first().click();
    await expect(sum).not.toHaveText(/^٠ /);
  });

  test('links to the neighbours and to the full-screen page', async ({ browser }) => {
    const page = await superAdminPage(browser);
    await page.goto('/studio/styles/layout-2-dep');
    await expect(page.getByRole('link', { name: en('styles.detail.previous') })).toHaveAttribute('href', '/studio/styles/layout-top');
    await expect(page.getByRole('link', { name: en('styles.detail.next') })).toHaveAttribute('href', '/studio/styles/layout-2-cmc');
    const open = page.getByRole('link', { name: en('styles.detail.open') });
    await expect(open).toHaveAttribute('href', '/studio/style-files/page/layout-2?style=dep');
    await expect(open).toHaveAttribute('target', '_blank');
    // The first style's previous is the last one: the list wraps.
    await page.goto('/studio/styles/themed-kurd');
    await expect(page.getByRole('link', { name: en('styles.detail.previous') })).toHaveAttribute('href', '/studio/styles/layout-2-box');
  });

  test('fits the whole phone on a short screen', async ({ browser }) => {
    const page = await superAdminPage(browser);
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto('/studio/styles/layout-2-dep');
    const phone = page.locator('[data-phone]');
    await expect(phone).toBeVisible();
    const box = (await phone.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    expect(box.height).toBeGreaterThan(400);
  });

  for (const id of ['themed-par', 'nope']) {
    test(`shows "not found" for ${id}`, async ({ browser }) => {
      const page = await superAdminPage(browser);
      await page.goto(`/studio/styles/${id}`);
      await expect(page.getByRole('heading', { level: 1, name: en('common.notFoundTitle') })).toBeVisible();
    });
  }
});
