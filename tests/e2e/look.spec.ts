import { expect, test } from '@playwright/test';

test.describe('visual identity', () => {
  test('the hero name is set large in the display face', async ({ page }) => {
    await page.goto('/atelier/en');
    const name = page.locator('#signature-title');
    await expect(name).toBeVisible();
    const size = await name.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(size).toBeGreaterThanOrEqual(44);
    const family = await name.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(family.toLowerCase()).toContain('bodoni');
  });

  test('the hero stage runs edge to edge', async ({ page }) => {
    await page.goto('/atelier/en');
    const viewport = page.viewportSize()!;
    const stage = page.locator('[data-hero-stage]');
    await expect(stage).toBeVisible();
    const box = (await stage.boundingBox())!;
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.x)).toBe(0);
  });

  test('marks the active category with one sliding indicator', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail.locator('[data-rail-indicator]')).toHaveCount(1);
    await rail.getByRole('link', { name: 'Pâtisserie' }).click();
    await expect(rail.getByRole('link', { name: 'Pâtisserie' })).toHaveAttribute('aria-current', 'true');
    await expect(rail.locator('[data-rail-indicator]')).toHaveCount(1);
  });

  test('shows dishes on round plates with a visible ring', async ({ page }) => {
    await page.goto('/atelier/en');
    const plate = page.getByTestId('product-row').first().locator('.plate');
    await expect(plate).toBeVisible();
    const box = (await plate.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    const radius = await plate.evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius));
    expect(radius).toBeGreaterThanOrEqual(box.width / 2 - 1);
    const shadow = await plate.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(shadow).not.toBe('none');
  });

  test('keeps the search field findable and usable', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    await search.fill('flat');
    await expect(page.getByTestId('product-row')).toHaveCount(1);
  });

  for (const locale of ['en', 'ar', 'ckb']) {
    test(`does not scroll sideways in ${locale}`, async ({ page }) => {
      await page.goto(`/atelier/${locale}`);
      await expect(page.locator('#signature-title')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
