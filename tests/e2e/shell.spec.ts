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

  test('attaches only the fonts a locale needs', async ({ page }) => {
    // Class names are hashed in a production build, so read the font variables that the classes define.
    const defined = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return ['--font-bodoni', '--font-hanken', '--font-naskh'].filter((name) => style.getPropertyValue(name).trim() !== '');
      });
    await page.goto('/atelier/en');
    expect(await defined()).toEqual(['--font-bodoni', '--font-hanken']);
    await page.goto('/atelier/ar');
    expect(await defined()).toEqual(['--font-naskh']);
  });

  test('returns 404 for an unknown restaurant or locale', async ({ request }) => {
    expect((await request.get('/nope/en')).status()).toBe(404);
    expect((await request.get('/atelier/xx')).status()).toBe(404);
  });
});

test.describe('page icon', () => {
  // Without an icon link every browser requests /favicon.ico, a 404 that takes a connection slot during
  // the load, so the page declares one and none is requested.
  test('declares an icon so no /favicon.ico request is made', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/favicon.ico') asked.push(request.url());
    });
    await page.goto('/atelier/en', { waitUntil: 'networkidle' });
    await expect(page.locator('head link[rel~="icon"]')).toHaveCount(1);
    expect(asked).toEqual([]);
  });
});
