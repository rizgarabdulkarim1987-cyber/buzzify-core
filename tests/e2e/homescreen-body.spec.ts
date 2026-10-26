import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu } from './helpers/body-menu';

/**
 * The Phone Home Screen body (spec 2026-10-26-menu-styles-in-templates-design.md): every dish an app icon (rounded
 * photo, name below, price as a notification badge), four across, every section a folder band holding its icons, and a
 * sticky dock of app tiles that jumps. Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('hom');
const arabSlug = menus.slug('homar');

test.beforeAll(async () => {
  await menus.create(slug, 'homescreen', { templateId: 'the-phone-home-screen', layout: { body: 'homescreen', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'homescreen', { templateId: 'the-phone-home-screen', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const home = (page: Page) => page.locator('[data-body="homescreen"]');
const dock = (page: Page) => home(page).locator('[data-dock]');
const apps = (page: Page) => home(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => dock(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows many app icons with photos and prices, and every folder is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(home(page)).toBeVisible();
  await expectFirstScreen(page, apps(page), { min: 6 });
  await expectEverySectionReachable(dock(page));
});

test('the icons sit four across, square, with the name below and the price badge on the corner', async ({ page }) => {
  await openMenu(page, slug);
  const folder = page.locator('#cat-viennoiserie [data-row]');
  expect(await folder.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await folder.nth(i).boundingBox())!));
  for (const box of boxes) expect(Math.abs(box.y - boxes[0]!.y), 'they share a row').toBeLessThanOrEqual(2);
  const grid = (await page.locator('#cat-viennoiserie .hs-apps').boundingBox())!;
  expect(boxes[0]!.width, 'each cell is a quarter of the grid').toBeLessThanOrEqual(grid.width / 4 + 1);
  const icon = (await folder.first().locator('[data-photo]').boundingBox())!;
  expect(Math.abs(icon.width - icon.height)).toBeLessThanOrEqual(1);
  const name = (await folder.first().locator('.hs-name').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(icon.y + icon.height - 1);
  const badge = (await folder.first().locator('.hs-badge').boundingBox())!;
  expect(badge.y).toBeLessThanOrEqual(icon.y + icon.height / 2);
  await expect(folder.first().locator('.hs-badge')).toHaveCSS('background-color', 'rgb(196, 0, 26)');
});

test('every section is a folder with its name and dish count, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const folders = home(page).locator('section[data-folder]');
  expect(await folders.count()).toBe(BODY_CATEGORIES.length);
  await expect(folders.first()).toHaveAttribute('data-folder', '1');
  await expect(folders.first().locator('[data-count]')).toHaveText('3');
  await expect(home(page).locator('#cat-bread [data-count]')).toHaveText('1');
});

test('a tile on the dock takes you to its folder and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the dock lights the folder in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(dock(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the dock stays at the top: scrolled to the end, the first folder is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, dock(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('an icon opens its dish and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await apps(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name clamps to two lines inside its cell without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = apps(page).first();
  await cell.locator('.hs-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.hs-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const name = (await cell.locator('.hs-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen the icons run more across', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const first = page.locator('#cat-viennoiserie [data-row]');
  const a = (await first.nth(0).boundingBox())!;
  const c = (await first.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(2);
  expect(a.width).toBeLessThan(200);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = home(page).locator('section[data-folder]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-folder', '١');
});

test('in Arabic the page is right to left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => dock(p));
});

test('reduced motion removes the icon entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(apps(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});
