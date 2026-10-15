import { expect, test } from '@playwright/test';

async function openBurger(page: import('@playwright/test').Page) {
  await page.goto('/atelier/en');
  await page
    .getByTestId('product-row')
    .filter({ hasText: 'Atelier Burger' })
    .getByRole('button', { name: /Atelier Burger/ })
    .first()
    .click();
  return page.getByRole('dialog');
}

test.describe('Product detail', () => {
  test('opens a sheet with live totals, upgrades and a pairing', async ({ page }) => {
    const dialog = await openBurger(page);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/atelier\/en\/p\/atelier-burger$/);
    await expect(dialog.getByRole('heading', { name: 'Atelier Burger' })).toBeVisible();

    const add = dialog.getByRole('button', { name: /Add to order/ });
    await expect(add).toContainText('$9.00');

    await dialog.getByRole('checkbox', { name: /Premium cheese/ }).check();
    await expect(add).toContainText('$10.00');

    await expect(dialog.getByRole('heading', { name: 'Upgrades' })).toBeVisible();
    await expect(dialog.getByText('Total becomes $13.00').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Add Double patty' }).click();
    await expect(add).toContainText('$13.00');

    await expect(dialog.getByRole('heading', { name: 'Perfect pairing' })).toBeVisible();
    await expect(dialog.getByText('Truffle Fries')).toBeVisible();
  });

  test('adds the configured burger to the order and closes', async ({ page }) => {
    const dialog = await openBurger(page);
    await dialog.getByRole('checkbox', { name: /Premium cheese/ }).check();
    await dialog.getByRole('button', { name: /Add to order/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    const bar = page.getByTestId('cart-bar');
    await expect(bar).toContainText('1 item');
    await expect(bar).toContainText('$10.00');
  });

  test('adds a pairing straight from the sheet', async ({ page }) => {
    const dialog = await openBurger(page);
    await dialog.getByRole('button', { name: 'Add Truffle Fries' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await expect(page.getByTestId('cart-bar')).toContainText('$5.50');
  });

  test('can dismiss a pairing for the session', async ({ page }) => {
    const dialog = await openBurger(page);
    const fries = dialog.getByRole('listitem').filter({ hasText: 'Truffle Fries' });
    await expect(fries).toHaveCount(1);
    await fries.getByRole('button', { name: 'Not now' }).click();
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Truffle Fries' })).toHaveCount(0);
  });

  test('closes with Escape and returns to the menu URL', async ({ page }) => {
    const dialog = await openBurger(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en$/);
  });

  test('closes with the browser back button', async ({ page }) => {
    const dialog = await openBurger(page);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en$/);
  });

  test('blocks adding until a required choice is made', async ({ page }) => {
    await page.goto('/atelier/en');
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Ribeye' })
      .getByRole('button', { name: /Ribeye/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    const add = dialog.getByRole('button', { name: /Add to order/ });
    await expect(add).toBeDisabled();
    await expect(dialog.getByText('Make your choices to continue')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Medium rare' }).check();
    await expect(add).toBeEnabled();
    await expect(add).toContainText('$28.00');
  });

  test('offers a larger size as an upgrade and applies it', async ({ page }) => {
    await page.goto('/atelier/en');
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Cold Brew' })
      .getByRole('button', { name: /Cold Brew/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: /Regular 350 ml/ })).toBeChecked();
    await dialog.getByRole('button', { name: /Add Large 500 ml/ }).click();
    await expect(dialog.getByRole('radio', { name: /Large 500 ml/ })).toBeChecked();
    await expect(dialog.getByRole('button', { name: /Add to order/ })).toContainText('$6.50');
  });

  test('works as a full page on direct load', async ({ page }) => {
    await page.goto('/atelier/en/p/atelier-burger');
    await expect(page.getByRole('heading', { name: 'Atelier Burger', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the menu' })).toBeVisible();
    await page.getByRole('button', { name: /Add to order/ }).click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
  });

  test('returns 404 for an unknown product', async ({ request }) => {
    expect((await request.get('/atelier/en/p/does-not-exist')).status()).toBe(404);
  });

  test('shows the product in Sorani with direction flipped', async ({ page }) => {
    await page.goto('/atelier/ckb/p/atelier-burger');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'بەرگەری ئاتەلیە' })).toBeVisible();
  });
});
