import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const READY = { timeout: 40_000 };

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

const stage = (page: Page) => page.getByTestId('explore-stage');
const activeHeading = (page: Page) => page.locator('section[aria-labelledby]:not([inert]) h2');

test.describe('Explore', () => {
  test.describe.configure({ timeout: 90_000 });

  test('stages one scene per category, led by its signature dish', async ({ page }) => {
    await page.goto('/atelier/en/explore');
    await expect(stage(page)).toBeVisible();
    const rail = page.getByRole('navigation', { name: 'Chapters' });
    await expect(rail.getByRole('button')).toHaveCount(5);
    for (const name of ['Coffee & Tea', 'Breakfast', 'Plates', 'Pâtisserie', 'Cold & Sparkling']) {
      await expect(rail.getByRole('button', { name })).toBeVisible();
    }
    await expect(page.locator('section[aria-labelledby]')).toHaveCount(5);
    await expect(page).toHaveTitle(/Explore the menu/);
  });

  test('the chapter rail jumps to a scene and shows its dish', async ({ page }) => {
    await page.goto('/atelier/en/explore');
    const rail = page.getByRole('navigation', { name: 'Chapters' });
    await rail.getByRole('button', { name: 'Plates' }).click();
    await expect(activeHeading(page)).toHaveText('Atelier Burger');
    const scrolled = await page.evaluate(() => Math.round(window.scrollY / window.innerHeight));
    expect(scrolled).toBe(2);
    await expect(rail.getByRole('button', { name: 'Plates' })).toHaveAttribute('aria-current', 'true');
  });

  test('only the scene in view can be reached by keyboard or screen reader', async ({ page }) => {
    await page.goto('/atelier/en/explore');
    await expect(page.locator('section[aria-labelledby][inert]')).toHaveCount(4);
    await expect(page.locator('section[aria-labelledby]:not([inert])')).toHaveCount(1);
  });

  test('adds a dish to the cart the menu shares, and keeps it when switching mode', async ({ page }) => {
    await page.goto('/atelier/en/explore');
    await page.locator('section:not([inert])').getByRole('button', { name: 'Add to order' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await page.getByRole('link', { name: 'Full menu' }).first().click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
  });

  test('ingredient chips change the model and the price', async ({ page }) => {
    await page.goto('/atelier/en/explore?stage=on');
    await page.getByRole('navigation', { name: 'Chapters' }).getByRole('button', { name: 'Plates' }).click();
    const panel = page.locator('section[aria-labelledby]:not([inert])');
    await expect(panel).toHaveAttribute('data-stage-layers', 'bun-bottom,lettuce,tomato,patty,pickles,bun-top');
    await panel.getByRole('button', { name: /Premium cheese/ }).click();
    await expect(panel.getByRole('button', { name: /Premium cheese/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toHaveAttribute('data-stage-layers', 'bun-bottom,lettuce,tomato,patty,cheese,pickles,bun-top');
    await expect(panel.locator('.sr-only')).toHaveText('$10.00');
    await panel.getByRole('button', { name: /Premium cheese/ }).click();
    await expect(panel.locator('.sr-only')).toHaveText('$9.00');
  });

  test('"What is inside" pulls the layers apart and names them', async ({ page }) => {
    await page.goto('/atelier/en/explore?stage=on');
    await expect(stage(page)).toHaveAttribute('data-explore-mode', 'ready', READY);
    await page.getByRole('navigation', { name: 'Chapters' }).getByRole('button', { name: 'Plates' }).click();
    // Wait for the scene to arrive: until then the previous scene's controls are still the ones in the tree.
    await expect(activeHeading(page)).toHaveText('Atelier Burger');
    await page.getByRole('button', { name: 'What is inside' }).click();
    await expect(page.getByRole('button', { name: 'Put it back together' })).toHaveAttribute('aria-pressed', 'true');
    const label = page.getByText('Brioche bun', { exact: true });
    await expect
      .poll(() => label.evaluate((element) => parseFloat(getComputedStyle(element.closest('span.absolute') ?? element).opacity)), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0.5);
  });

  test('keeps the illustrations gliding where 3D is switched off', async ({ page }) => {
    await page.goto('/atelier/en/explore?stage=off');
    await expect(stage(page)).toHaveAttribute('data-explore-mode', 'unavailable');
    await expect(stage(page).locator('canvas')).toHaveCount(0);
    await expect(stage(page).locator('svg').first()).toBeVisible();
    await page.locator('section:not([inert])').getByRole('button', { name: 'Add to order' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
  });

  test('Customise opens the product sheet and closing returns to Explore', async ({ page }) => {
    await page.goto('/atelier/en/explore');
    await page.locator('section:not([inert])').getByRole('button', { name: 'Customise' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/p\/flat-white$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en\/explore$/);
  });

  test('is reachable from the full menu', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Explore' }).click();
    await expect(page).toHaveURL(/\/atelier\/en\/explore$/);
  });

  test('mirrors for Arabic and has no serious accessibility violations', async ({ page }) => {
    await page.goto('/atelier/ar/explore?stage=off');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(stage(page)).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test('has no serious accessibility violations with the live 3D set', async ({ page }) => {
    await page.goto('/atelier/en/explore?stage=on');
    await expect(stage(page)).toHaveAttribute('data-explore-mode', 'ready', READY);
    expect(await audit(page)).toEqual([]);
  });
});

test.describe('Explore with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('still works and keeps one scene reachable at a time', async ({ page }) => {
    await page.goto('/atelier/en/explore');
    await expect(stage(page)).toBeVisible();
    await expect(page.locator('section[aria-labelledby]:not([inert])')).toHaveCount(1);
    await page.getByRole('navigation', { name: 'Chapters' }).getByRole('button', { name: 'Cold & Sparkling' }).click();
    await expect(activeHeading(page)).toHaveText('Yuzu Lemonade');
  });
});
