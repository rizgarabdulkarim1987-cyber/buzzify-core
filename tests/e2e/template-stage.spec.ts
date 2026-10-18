import { expect, test } from '@playwright/test';
import { ONDA } from '../../prisma/seed/onda';

/**
 * A template menu's 3D scene (spec 2026-10-18-template-studio-design.md): one canvas at most, loaded only when asked
 * for, and a scene that fails hands the menu back to the motion layer. Runs in the `webgl` project (software WebGL).
 */

const MENU = `/${ONDA.restaurant.slug}/en`;
const READY = { timeout: 25_000 };

test('draws the preset’s scene in a single canvas once the device qualifies', async ({ page }) => {
  await page.goto(`${MENU}?stage=on`);
  const layer = page.locator('.scene-layer');
  await expect(layer).toHaveAttribute('data-mode', '3d', READY);
  await expect(layer).toHaveClass(/scene-ready/, READY);
  expect(await page.locator('canvas').count()).toBe(1);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('keeps the scene still and loads no 3D', async ({ page }) => {
    await page.goto(`${MENU}?stage=on`);
    await expect(page.locator('.scene-layer')).toHaveAttribute('data-mode', 'static');
    // The 3D chunk would load once the page is idle; give it that long.
    await page.waitForTimeout(3_000);
    expect(await page.locator('canvas').count()).toBe(0);
  });
});

test('falls back to the motion layer when the scene fails', async ({ page }) => {
  await page.goto(`${MENU}?stage=on&scene=fail`);
  const layer = page.locator('.scene-layer');
  await expect(layer).toHaveAttribute('data-mode', 'motion', READY);
  await expect(page.locator('canvas')).toHaveCount(0, READY);
});
