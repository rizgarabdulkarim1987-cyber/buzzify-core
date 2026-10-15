import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

test.describe('accessibility', () => {
  for (const [name, path] of [
    ['menu in English', '/atelier/en'],
    ['menu in Arabic', '/atelier/ar'],
    ['menu in Sorani', '/atelier/ckb'],
    ['product page', '/atelier/en/p/atelier-burger'],
    ['empty cart', '/atelier/en/cart'],
    ['table entry', '/atelier/en/t/04'],
  ] as const) {
    test(`${name} has no serious violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  }

  test('open product sheet has no serious violations', async ({ page }) => {
    await page.goto('/atelier/en');
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Atelier Burger' })
      .getByRole('button', { name: /Atelier Burger/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Perfect pairing' })).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test('cart with items has no serious violations', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await page.getByTestId('cart-bar').click();
    await expect(page.getByTestId('cart-line')).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test('the skip link is the first focus stop and becomes visible', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to the menu' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('every interactive control is at least 44 px tall', async ({ page }) => {
    await page.goto('/atelier/en');
    const small = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select')];
      return controls
        .filter((el) => el.offsetParent !== null && !el.matches('.sr-only, .sr-only *'))
        .map((el) => ({ label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '', h: el.getBoundingClientRect().height }))
        .filter((c) => c.h > 0 && c.h < 40);
    });
    expect(small).toEqual([]);
  });
});
