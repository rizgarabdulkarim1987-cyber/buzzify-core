import { expect, test, type Page } from '@playwright/test';
import { createSceneMenus, type SceneMenus } from './helpers/scene-menus';

/**
 * A template menu with the business's own scene file as its background (spec
 * 2026-10-18-template-studio-stage-2-scene-files-design.md, 5): a GLB model in the one canvas, an MP4 video playing
 * muted, a Lottie animation drawn as SVG, and their fallbacks. Reduced motion gets a still, a model without the 3D stage
 * gets the template's motion, and so does a file that fails (`?scene=fail`). `data-plan` is the layer's `scenePlan`.
 * Runs in the `webgl` project (software WebGL).
 */

const READY = { timeout: 25_000 };
// The scene file loads once the page is idle (at most 2.5 s); a check that nothing loaded gives it that long.
const IDLE = 3_000;

let menus: SceneMenus;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000);
  menus = await createSceneMenus(browser);
});

test.afterAll(async () => {
  await menus?.remove();
});

const menu = (kind: keyof SceneMenus['slugs'], query = '') => `/${menus.slugs[kind]}/en${query}`;
const layer = (page: Page) => page.locator('.scene-layer');

test.describe('a model', () => {
  test('is drawn in the single canvas once the device qualifies', async ({ page }) => {
    await page.goto(menu('model', '?stage=on'));
    await expect(layer(page)).toHaveAttribute('data-plan', 'model', READY);
    await expect(layer(page)).toHaveClass(/scene-ready/, READY);
    expect(await page.locator('canvas').count()).toBe(1);
  });

  test('gives way to the template’s motion with the 3D stage turned off', async ({ page }) => {
    await page.goto(menu('model', '?stage=off'));
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion');
    await page.waitForTimeout(IDLE);
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion');
    expect(await page.locator('canvas').count()).toBe(0);
  });

  test('falls back to the template’s motion when it fails', async ({ page }) => {
    // The model is fetched before the canvas throws, so the failure is the 3D path's, not a device that never tried.
    const loaded = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('.glb') && response.ok(), READY);
    await page.goto(menu('model', '?stage=on&scene=fail'));
    await loaded;
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion', READY);
    await expect(page.locator('canvas')).toHaveCount(0, READY);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('shows the template’s poster and loads no 3D', async ({ page }) => {
      await page.goto(menu('model', '?stage=on'));
      await expect(layer(page)).toHaveAttribute('data-plan', 'poster');
      await page.waitForTimeout(IDLE);
      expect(await page.locator('canvas').count()).toBe(0);
    });
  });
});

test.describe('a video', () => {
  test('plays muted, looped and inline', async ({ page }) => {
    await page.goto(menu('video'));
    await expect(layer(page)).toHaveAttribute('data-plan', 'video', READY);
    const video = layer(page).locator('video');
    await expect(video).toHaveCount(1, READY);
    await expect(video).toHaveJSProperty('muted', true);
    await expect(video).toHaveJSProperty('loop', true);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused && element.currentTime > 0), READY).toBe(true);
    await expect(layer(page)).toHaveClass(/scene-ready/, READY);
    expect(await page.locator('canvas').count()).toBe(0);
  });

  test('gives guests the template’s own scene on a plan without background video', async ({ page }) => {
    // The same file under a restaurant on Pro (spec 2026-10-18-scene-files-plans-design.md, 4.1).
    await page.goto(menu('lockedVideo'));
    await expect(layer(page)).toHaveAttribute('data-plan', /^(motion|3d|poster)$/);
    await page.waitForTimeout(IDLE);
    await expect(layer(page)).not.toHaveAttribute('data-plan', /^video/);
    expect(await page.locator('video').count()).toBe(0);
    expect(await layer(page).locator('[data-file="video"]').count()).toBe(0);
  });

  test('falls back to the template’s motion when it fails', async ({ page }) => {
    await page.goto(menu('video', '?scene=fail'));
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion');
    await page.waitForTimeout(IDLE);
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion');
    expect(await page.locator('video').count()).toBe(0);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('shows the video’s own poster and never loads the video', async ({ page }) => {
      await page.goto(menu('video'));
      await expect(layer(page)).toHaveAttribute('data-plan', 'videoStill');
      await expect(layer(page).locator('[data-file="video"] img')).toBeVisible();
      await page.waitForTimeout(IDLE);
      expect(await page.locator('video').count()).toBe(0);
      expect(await page.locator('canvas').count()).toBe(0);
    });
  });
});

test.describe('a Lottie animation', () => {
  test('is drawn as SVG over the template’s poster', async ({ page }) => {
    await page.goto(menu('lottie'));
    await expect(layer(page)).toHaveAttribute('data-plan', 'lottie', READY);
    await expect(layer(page).locator('[data-file="lottie"] svg')).toHaveCount(1, READY);
    await expect(layer(page)).toHaveClass(/scene-ready/, READY);
    expect(await page.locator('canvas').count()).toBe(0);
  });

  test('falls back to the template’s motion when it fails', async ({ page }) => {
    await page.goto(menu('lottie', '?scene=fail'));
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion');
    await page.waitForTimeout(IDLE);
    await expect(layer(page)).toHaveAttribute('data-plan', 'motion');
    expect(await layer(page).locator('[data-file="lottie"]').count()).toBe(0);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('shows the template’s poster and never loads the animation', async ({ page }) => {
      await page.goto(menu('lottie'));
      await expect(layer(page)).toHaveAttribute('data-plan', 'poster');
      await page.waitForTimeout(IDLE);
      expect(await layer(page).locator('[data-file="lottie"]').count()).toBe(0);
      expect(await page.locator('canvas, video').count()).toBe(0);
    });
  });
});
