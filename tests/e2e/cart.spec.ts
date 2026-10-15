import { expect, test, type Page } from '@playwright/test';

async function quickAdd(page: Page, name: string) {
  await page.getByRole('button', { name: `Add ${name} to your order` }).click();
}

test.describe('Cart', () => {
  test('shows the server-priced order and a read-only review with no submit control', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await quickAdd(page, 'Truffle Fries');
    await page.getByTestId('cart-bar').click();

    await expect(page).toHaveURL(/\/atelier\/en\/cart$/);
    await expect(page.getByRole('heading', { name: 'Your order' })).toBeVisible();
    const lines = page.getByTestId('cart-line');
    await expect(lines).toHaveCount(2);
    await expect(page.getByTestId('cart-subtotal')).toContainText('$8.50');
    await expect(page.getByRole('heading', { name: 'Order review' })).toBeVisible();
    await expect(page.getByText(/read-only summary/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /submit|place order|confirm|checkout|pay/i }),
    ).toHaveCount(0);
  });

  test('changes quantity and removes lines', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await page.goto('/atelier/en/cart');
    const line = page.getByTestId('cart-line').first();
    await line.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$6.00');
    await line.getByRole('button', { name: 'Decrease quantity' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$3.00');
    await line.getByRole('button', { name: /Remove Espresso/ }).click();
    await expect(page.getByText('Your order is empty')).toBeVisible();
  });

  test('suggests turning a complete meal into a set with the real saving', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Atelier Burger');
    await quickAdd(page, 'Truffle Fries');
    await quickAdd(page, 'Sparkling Water 500 ml');
    await page.goto('/atelier/en/cart');

    await expect(page.getByTestId('cart-subtotal')).toContainText('$17.50');
    const offer = page.getByTestId('bundle-suggestion');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('Burger set');
    await expect(offer).toContainText('You save $2.00');
    await expect(offer).toContainText('Separately $17.50, as a set $15.50');

    await offer.getByRole('button', { name: 'Switch to the set' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$15.50');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-line')).toContainText('Burger set');
  });

  test('flags a stale line and keeps it out of the total', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'buzzify:cart:atelier',
        JSON.stringify({
          state: {
            cart: {
              lines: [{ productId: 'product-that-was-deleted', variantId: null, optionIds: [], quantity: 2 }],
              bundles: [],
            },
          },
          version: 1,
        }),
      );
    });
    await page.goto('/atelier/en/cart');
    const line = page.getByTestId('cart-line');
    await expect(line).toContainText('No longer on the menu');
    await expect(page.getByTestId('cart-subtotal')).toContainText('$0.00');
    await expect(page.getByText('Remove the unavailable items to continue.')).toBeVisible();
    await line.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByText('Your order is empty')).toBeVisible();
  });

  test('survives corrupted storage', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('buzzify:cart:atelier', '{definitely not json');
    });
    await page.goto('/atelier/en');
    await expect(page.getByTestId('brand')).toBeVisible();
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
  });

  test('keeps the order when the language changes', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await page.getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(/\/atelier\/ar$/);
    await expect(page.getByTestId('cart-bar')).toContainText('عنصر واحد');
    await page.getByTestId('cart-bar').click();
    await expect(page.getByTestId('cart-line')).toContainText('إسبريسو');
  });

  test('is usable without horizontal scroll at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await page.goto('/atelier/en/cart');
    await expect(page.getByTestId('cart-line')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
