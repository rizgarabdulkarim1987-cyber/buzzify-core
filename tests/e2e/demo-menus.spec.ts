import { expect, test } from '@playwright/test';

/** The two demo menus beside ATELIER (spec 17): each opens in its own language and theme, with its own currency. */

test.describe('Riverlight Coffee', () => {
  test('opens in English, light', async ({ page }) => {
    await page.goto('/riverlight');
    await expect(page).toHaveURL(/\/riverlight\/en$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('product-row').first()).toContainText('$');
  });
});

test.describe('Hot Brick Burgers', () => {
  test.describe('for a Sorani browser', () => {
    test.use({ locale: 'ckb-IQ', extraHTTPHeaders: { 'accept-language': 'ckb' } });

    test('opens in Sorani, dark, priced in dinars', async ({ page }) => {
      await page.goto('/hot-brick');
      await expect(page).toHaveURL(/\/hot-brick\/ckb$/);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      // Dinars, written as the Arabic-script abbreviation, in whole thousands.
      await expect(page.getByTestId('product-row').first()).toContainText(/\d,\d{3}\s*د\.ع/);
    });
  });

  test.describe('for a French browser', () => {
    test.use({ locale: 'fr-FR', extraHTTPHeaders: { 'accept-language': 'fr' } });

    test('opens in its default language, Sorani', async ({ page }) => {
      await page.goto('/hot-brick');
      await expect(page).toHaveURL(/\/hot-brick\/ckb$/);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });
  });
});
