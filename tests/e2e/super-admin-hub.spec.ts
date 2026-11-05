import { expect, test, type Browser, type Page } from '@playwright/test';
import { seriousViolations } from './helpers/axe';
import { OWNER_FILE, removeRestaurantsNamed, SUPER_ADMIN_FILE, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * A Super Admin's Studio is a hub of closed project spaces (docs/superpowers/specs/2026-10-31-super-admin-project-hub-design.md):
 * three large icons centred on the screen (Menu and Cashier, Pharmacy, Retail) and a small Platform entry; a pharmacy made in the
 * Pharmacy space shows in no Menu and Cashier list. An owner keeps the Studio they always had, with no hub. Everything it
 * makes is removed afterwards.
 */

async function pageFor(browser: Browser, storageState: string): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState });
  return context.newPage();
}

type Box = { x: number; y: number; width: number; height: number };

test.describe('Super Admin project hub @desktop', () => {
  const names: string[] = [];

  test.afterAll(async () => {
    await removeRestaurantsNamed(names.splice(0));
  });

  // The icons sit in the middle of the screen on a laptop and on a phone, and in every Studio language and direction.
  for (const { locale, size } of [
    { locale: 'en', size: { width: 1280, height: 800 } },
    { locale: 'en', size: { width: 375, height: 812 } },
    { locale: 'ar', size: { width: 1280, height: 800 } },
    { locale: 'ar', size: { width: 375, height: 812 } },
  ] as const) {
    test(`shows three large project icons in the middle of the screen and a small Platform entry (${locale}, ${size.width}px)`, async ({ browser }) => {
      const page = await pageFor(browser, superAdminFile(locale));
      await page.setViewportSize(size);
      await page.goto('/studio');
      const large = page.locator('[data-project="large"]');
      await expect(large).toHaveCount(3);
      await expect(page.locator('[data-project="small"]')).toHaveCount(1);

      const boxes = await large.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as Box));
      const left = Math.min(...boxes.map((box) => box.x));
      const right = Math.max(...boxes.map((box) => box.x + box.width));
      const top = Math.min(...boxes.map((box) => box.y));
      const bottom = Math.max(...boxes.map((box) => box.y + box.height));
      expect(Math.abs((left + right) / 2 - size.width / 2)).toBeLessThanOrEqual(4);
      expect(Math.abs((top + bottom) / 2 - size.height / 2)).toBeLessThanOrEqual(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const small = await page.locator('[data-project="small"]').evaluate((node) => node.getBoundingClientRect().toJSON() as Box);
      expect(small.width).toBeLessThan(boxes[0]!.width);
      expect(await seriousViolations(page)).toEqual([]);
      await page.context().close();
    });
  }

  test('keeps the Pharmacy and Menu and Cashier apart', async ({ browser }) => {
    const page = await pageFor(browser, SUPER_ADMIN_FILE);
    const name = `E2E Hub Pharmacy ${Math.random().toString(36).slice(2, 8)}`;
    names.push(name);

    await page.goto('/studio');
    await page.locator('[data-project="large"]', { hasText: 'Pharmacy' }).click();
    // A soft navigation from the hub: the frame must change to the Pharmacy's own sidebar without a reload.
    await expect(page).toHaveURL(/\/studio\/pharmacy$/);
    const nav = page.getByRole('navigation', { name: 'Studio' });
    await expect(nav.getByRole('link', { name: 'Billing' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Cashier' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Menus' })).toHaveCount(0);

    await page.goto('/studio/pharmacy/new');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Branch 1: name').fill('Main branch');
    await page.getByLabel('Iraqi dinar (IQD)').check();
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page).toHaveURL(/\/studio\/pharmacy\/(?!new$)[^/]+$/);

    await page.goto('/studio/pharmacy');
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    await page.goto(`/studio/restaurants?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);

    // The old Menu and Cashier address of a pharmacy lands in the Pharmacy space.
    await page.goto('/studio/pharmacy');
    const href = await page.getByRole('link', { name }).getAttribute('href');
    await page.goto(href!.replace('/studio/pharmacy/', '/studio/restaurants/'));
    await expect(page).toHaveURL(/\/studio\/pharmacy\/[^/]+$/);
    await page.context().close();
  });

  test('leaves an owner with the Studio they always had, and no hub', async ({ browser }) => {
    const page = await pageFor(browser, OWNER_FILE);
    await page.goto('/studio');
    await expect(page.locator('[data-project]')).toHaveCount(0);
    await page.goto('/studio/pharmacy');
    await expect(page.locator('[data-project]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/studio\/pharmacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pharmacy' })).toHaveCount(0);
    await page.context().close();
  });
});
