import { expect, test } from '@playwright/test';

test.describe('application shell', () => {
  test('applies the brand tokens on the server', async ({ page }) => {
    await page.goto('/atelier/en');
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    expect(bg.toLowerCase()).toBe('#0e0e0f');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('switches language by changing the path and flips direction', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(/\/atelier\/ar$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.getByRole('link', { name: 'کوردی' }).click();
    await expect(page).toHaveURL(/\/atelier\/ckb$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ckb');
  });

  test('returns 404 for an unknown restaurant or locale', async ({ request }) => {
    expect((await request.get('/nope/en')).status()).toBe(404);
    expect((await request.get('/atelier/xx')).status()).toBe(404);
  });
});
