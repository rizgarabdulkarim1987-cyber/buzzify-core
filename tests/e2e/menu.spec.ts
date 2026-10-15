import { expect, test } from '@playwright/test';

test.describe('Quick Menu', () => {
  test('shows the menu immediately without any interaction', async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.getByTestId('brand')).toHaveText('ATELIER');
    await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu categories' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Atelier Burger/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coffee & Tea' })).toBeVisible();
  });

  test('lists all five categories and twenty-four products', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail.getByRole('link')).toHaveCount(5);
    await expect(page.getByTestId('product-row')).toHaveCount(24);
  });

  test('filters by search in English, Arabic and Sorani', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    const rows = page.getByTestId('product-row');

    await search.fill('burger');
    await expect(rows.filter({ hasText: 'Atelier Burger' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Espresso' })).toHaveCount(0);

    await search.fill('برغر');
    await expect(rows.filter({ hasText: 'Atelier Burger' })).toHaveCount(1);

    await search.fill('کرواسان');
    await expect(rows.filter({ hasText: 'Croissant' })).toHaveCount(1);

    await search.fill('٢٥٠');
    await expect(rows.filter({ hasText: 'Ribeye' })).toHaveCount(1);
  });

  test('handles empty and hostile search input without breaking', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    for (const hostile of ['(', '[', '.*', '\\', '   ']) {
      await search.fill(hostile);
      await expect(page.getByTestId('brand')).toBeVisible();
    }
    await search.fill('zzzzqqqq');
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('product-row')).toHaveCount(24);
  });

  test('quick add puts a simple item into the order bar', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    const bar = page.getByTestId('cart-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 item');
    await expect(bar).toContainText('$3.00');
  });

  test('items that need choices have no quick add', async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.getByRole('button', { name: /Add Ribeye/ })).toHaveCount(0);
  });

  test('never scrolls horizontally on a 320 px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/atelier/en');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto('/atelier/ar');
    const overflowRtl = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowRtl).toBeLessThanOrEqual(0);
  });

  test('renders right to left in Arabic with translated content', async ({ page }) => {
    await page.goto('/atelier/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('searchbox', { name: 'ابحث في القائمة' })).toBeVisible();
    await expect(page.getByRole('button', { name: /برغر أتيليه/ }).first()).toBeVisible();
  });
});
