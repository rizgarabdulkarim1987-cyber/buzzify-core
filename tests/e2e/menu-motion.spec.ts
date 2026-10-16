import { expect, test } from '@playwright/test';

// The menu's first paint must not wait for an animation library, so the hero entrance and the quick-add
// press feedback are plain CSS. The rail indicator and the sheet still use the animation library, which
// loads after the page is interactive (see AppProviders).

test.describe('menu motion', () => {
  test('the signature feature rises into place with a CSS animation', async ({ page }) => {
    await page.goto('/atelier/en');
    const feature = page.locator('section[aria-labelledby="signature-title"]');
    await expect(feature).toBeVisible();
    const { name, duration } = await feature.evaluate((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, duration: parseFloat(style.animationDuration) };
    });
    expect(name).not.toBe('none');
    expect(duration).toBeGreaterThan(0.1);
  });

  test('a quick-add button gives press feedback while it is held down', async ({ page }) => {
    await page.goto('/atelier/en');
    const button = page.getByRole('button', { name: /^Add .* to your order$/ }).first();
    await button.scrollIntoViewIfNeeded();
    const rest = (await button.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => ((await button.boundingBox()) as { width: number }).width)
      .toBeLessThan(rest.width - 1);
    // Release away from the button so the press is not a click.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });

  test('the category rail indicator follows the active category', async ({ page }) => {
    await page.goto('/atelier/en');
    const indicator = page.locator('[data-rail-indicator]');
    await expect(indicator).toHaveCount(1);
    const links = page.getByRole('navigation', { name: /categories/i }).getByRole('link');
    await links.nth(1).click();
    await expect(links.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(links.nth(1).locator('[data-rail-indicator]')).toHaveCount(1);
  });

  test('the rail indicator slides to the new category instead of jumping', async ({ page }) => {
    await page.goto('/atelier/en');
    const links = page.getByRole('navigation', { name: /categories/i }).getByRole('link');
    await expect(page.locator('[data-rail-indicator]')).toHaveCount(1);
    // Sample the indicator's position on every frame for a moment after the tap.
    await page.evaluate(() => {
      const samples: number[] = [];
      (window as unknown as { __rail: number[] }).__rail = samples;
      const until = performance.now() + 900;
      const tick = () => {
        const element = document.querySelector('[data-rail-indicator]');
        if (element) samples.push(element.getBoundingClientRect().left);
        if (performance.now() < until) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await links.nth(2).click();
    await expect(links.nth(2)).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(1000);
    const samples = await page.evaluate(() => (window as unknown as { __rail: number[] }).__rail);
    const start = samples[0] as number;
    const end = samples[samples.length - 1] as number;
    expect(Math.abs(end - start)).toBeGreaterThan(20);
    const between = samples.filter((x) => x > Math.min(start, end) + 2 && x < Math.max(start, end) - 2);
    expect(between.length).toBeGreaterThan(0);
  });
});

test.describe('menu motion with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the signature feature does not animate', async ({ page }) => {
    await page.goto('/atelier/en');
    const feature = page.locator('section[aria-labelledby="signature-title"]');
    await expect(feature).toBeVisible();
    const duration = await feature.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration));
    expect(duration).toBeLessThan(0.01);
  });
});
