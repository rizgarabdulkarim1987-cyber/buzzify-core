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

test.describe('motion language', () => {
  test('the hero stage drifts and fades as the page scrolls', async ({ page }) => {
    await page.goto('/atelier/en');
    const hero = page.locator('[data-hero-stage]');
    await expect(hero).toBeVisible();
    const before = await hero.evaluate((element) => getComputedStyle(element).transform);
    await page.evaluate(() => window.scrollTo(0, 320));
    await expect
      .poll(() => hero.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe(before);
    const opacity = await hero.evaluate((element) => parseFloat(getComputedStyle(element).opacity));
    expect(opacity).toBeLessThan(1);
  });

  test('the add button total rolls and ends exactly on the new total', async ({ page }) => {
    await page.goto('/atelier/en/p/atelier-burger');
    const add = page.getByRole('button', { name: /Add to order/ });
    await expect(add).toContainText('$9.00');
    await page.getByRole('checkbox', { name: /Premium cheese/ }).check();
    // A screen reader gets the final number at once; the rolling digits are decoration.
    await expect(add.locator('.sr-only')).toHaveText('$10.00');
    await expect(add.locator('[aria-hidden="true"]')).toHaveText('$10.00');
  });

  test('the 3D stage turns by itself while idle', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/atelier/en/p/atelier-burger?stage=on');
    const stage = page.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', { timeout: 30_000 });
    await expect(stage).toHaveAttribute('data-stage-turning', 'true');
  });
});

test.describe('reduced motion and the stage', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the hero stage does not drift', async ({ page }) => {
    await page.goto('/atelier/en');
    const hero = page.locator('[data-hero-stage]');
    await expect(hero).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 320));
    await page.waitForTimeout(300);
    const state = await hero.evaluate((element) => {
      const style = getComputedStyle(element);
      return { transform: style.transform, opacity: style.opacity };
    });
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(state.transform);
    expect(parseFloat(state.opacity)).toBe(1);
  });

  test('the 3D stage stays still until the visitor turns it', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/atelier/en/p/atelier-burger?stage=on');
    const stage = page.getByTestId('sheet-stage');
    await expect(stage).toHaveAttribute('data-stage-state', 'ready', { timeout: 30_000 });
    await expect(stage).toHaveAttribute('data-stage-turning', 'false');
  });
});
