import { expect, test } from '@playwright/test';

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the product sheet opens and closes without relying on animation', async ({ page }) => {
    await page.goto('/atelier/en');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Atelier Burger' })
      .getByRole('button', { name: /Atelier Burger/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('global CSS collapses transition and animation durations', async ({ page }) => {
    await page.goto('/atelier/en');
    const duration = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transition = 'opacity 2s';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });
    expect(parseFloat(duration)).toBeLessThan(0.01);
  });
});
