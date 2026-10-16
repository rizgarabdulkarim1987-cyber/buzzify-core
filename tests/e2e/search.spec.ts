import { expect, test } from '@playwright/test';

// A visitor can search in any language, but the menu page ships only the text of its own language.
// The other languages arrive with the search index, fetched the first time the search box is used.

test.describe('search index', () => {
  test('the English menu document does not carry Arabic or Sorani search text', async ({ request }) => {
    const html = await (await request.get('/atelier/en')).text();
    expect(html).not.toContain('برغر');
    expect(html).not.toContain('کرواسان');
  });

  test('the index is not requested while the page loads', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/search-index')) requested.push(request.url());
    });
    await page.goto('/atelier/en', { waitUntil: 'networkidle' });
    expect(requested).toEqual([]);
  });

  test('focusing the search box fetches the index once', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/search-index')) requested.push(request.url());
    });
    await page.goto('/atelier/en', { waitUntil: 'networkidle' });
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    await search.focus();
    await expect.poll(() => requested.length).toBe(1);
    await search.fill('x');
    await search.fill('');
    await search.blur();
    await search.focus();
    await page.waitForTimeout(300);
    expect(requested.length).toBe(1);
  });

  test('an Arabic query finds a dish from the English page', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('برغر');
    await expect(page.getByTestId('product-row').filter({ hasText: 'Atelier Burger' })).toBeVisible();
  });

  test('typing before the index arrives still finds dishes by the page language', async ({ page }) => {
    await page.route('**/search-index', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto('/atelier/en');
    await page.getByRole('searchbox', { name: 'Search the menu' }).fill('burger');
    await expect(page.getByTestId('product-row').filter({ hasText: 'Atelier Burger' })).toBeVisible();
    await expect(page.getByTestId('product-row').filter({ hasText: 'Espresso' })).toHaveCount(0);
  });
});
