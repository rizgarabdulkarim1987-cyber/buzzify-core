import { expect, test } from '@playwright/test';

test.describe('QR table entry', () => {
  test('shows the table label immediately and remembers it on other pages', async ({ page }) => {
    await page.goto('/atelier/en/t/04');
    await expect(page.getByText('Table 04')).toBeVisible();
    await expect(page.getByRole('button', { name: /Atelier Burger/ }).first()).toBeVisible();
    await page.getByTestId('brand').click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByText('Table 04')).toBeVisible();
  });

  test('keeps the order when the same table is scanned again', async ({ page }) => {
    await page.goto('/atelier/en/t/04');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await page.goto('/atelier/en/t/04');
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
  });

  test('starts a fresh order when a different table is scanned', async ({ page }) => {
    await page.goto('/atelier/en/t/04');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await page.goto('/atelier/en/t/05');
    await expect(page.getByText('Table 05')).toBeVisible();
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
  });

  test('translates the table label', async ({ page }) => {
    await page.goto('/atelier/ar/t/04');
    await expect(page.getByText('الطاولة 04')).toBeVisible();
    await page.goto('/atelier/ckb/t/04');
    await expect(page.getByText('مێزی 04')).toBeVisible();
  });

  test('sends analytics with the table number', async ({ page }) => {
    const request = page.waitForRequest((r) => r.url().includes('/api/atelier/events') && r.method() === 'POST', {
      timeout: 10_000,
    });
    await page.goto('/atelier/en/t/04');
    const body = JSON.parse((await request).postData() ?? '{}');
    expect(body.tableNumber).toBe(4);
    expect(body.events.map((e: { type: string }) => e.type)).toContain('MENU_VIEW');
    expect(body.anonymousSessionId.length).toBeGreaterThanOrEqual(8);
  });
});

test.describe('hostile and unknown URLs get a clean 4xx, never a 5xx', () => {
  const paths = [
    '/atelier/en/t/abc',
    '/atelier/en/t/0',
    '/atelier/en/t/999',
    '/atelier/en/t/-1',
    '/atelier/en/t/4.5',
    '/atelier/en/t/1e3',
    '/atelier/en/t/%20',
    '/nope/en/t/04',
    '/atelier/xx/t/04',
    '/atelier/en/p/%2e%2e%2fsecret',
    '/atelier/en/cart/extra',
    "/atelier/en/p/'; DROP TABLE products;--",
  ];
  for (const path of paths) {
    test(`GET ${path}`, async ({ request }) => {
      const response = await request.get(path);
      expect([400, 404]).toContain(response.status());
    });
  }

  test('the unknown tenant API answers with JSON 404', async ({ request }) => {
    const response = await request.post('/api/nope/quote', { data: { locale: 'en', cart: { lines: [], bundles: [] } } });
    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBe('TENANT_NOT_FOUND');
  });
});
