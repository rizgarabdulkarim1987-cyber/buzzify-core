import { expect, test, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  contrastOf,
  dishName,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectFocusRingShows,
  expectJumpsTo,
  expectOpensProduct,
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Phone Home Screen body (spec 2026-10-26-menu-styles-in-templates-design.md): every dish an app icon (rounded
 * photo, name below, price as a notification badge), four across, every section a folder band holding its icons, and a
 * sticky dock of app tiles that jumps. Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('hom');
const arabSlug = menus.slug('homar');
/** The shape's own alternative palettes, and a white accent on a light background picked in Customize. */
const alternatives = paletteIdsOf('the-phone-home-screen').slice(1);
const paletteSlug = (id: string) => menus.slug(`hom-${id}`);
const lightSlug = menus.slug('homlight');
const LIGHT_WHITE_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFFFFF', onAccent: '#111111' };

test.beforeAll(async () => {
  // The preset's own layout (its compact hero, its chips): what a restaurant that picks the template gets.
  await menus.create(slug, 'homescreen', { templateId: 'the-phone-home-screen' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'homescreen', { templateId: 'the-phone-home-screen', numeralSystem: 'ARAB', discount: ['croissant'] });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'homescreen', { templateId: 'the-phone-home-screen', paletteId: id });
  await menus.create(lightSlug, 'homescreen', { templateId: 'the-phone-home-screen', colors: LIGHT_WHITE_ACCENT });
});
test.afterAll(() => menus.remove());

const home = (page: Page) => page.locator('[data-body="homescreen"]');
const dock = (page: Page) => home(page).locator('[data-dock]');
const apps = (page: Page) => home(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => dock(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least eight app icons with photos, prices and names, and every folder is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(home(page)).toBeVisible();
  await expectFirstScreen(page, apps(page), { min: 8 });
  const named = await apps(page).evaluateAll((nodes) =>
    nodes.filter((node) => {
      const name = node.querySelector('.hs-name')!.getBoundingClientRect();
      return name.height > 0 && name.top >= 0 && name.bottom <= window.innerHeight;
    }).length,
  );
  expect(named, 'icons whose name is on the first screen too').toBeGreaterThanOrEqual(8);
  await expectEverySectionReachable(dock(page));
});

test('the dock is one slim line, and each folder opens with its label tile in the first cell', async ({ page }) => {
  await openMenu(page, slug);
  const bar = (await dock(page).boundingBox())!;
  expect(bar.height, 'a slim dock').toBeLessThanOrEqual(56);
  const folder = page.locator('#cat-viennoiserie');
  const label = (await folder.locator('[data-heading]').boundingBox())!;
  const first = (await folder.locator('[data-row]').first().boundingBox())!;
  expect(Math.abs(label.y - first.y), 'the label tile shares the first row').toBeLessThanOrEqual(2);
  expect(label.x + label.width, 'the label tile comes first').toBeLessThanOrEqual(first.x + 1);
  await expect(folder.getByRole('heading', { name: /Viennoiserie/ })).toBeVisible();
  // The label tile is not one of the list's items: the list holds the three dishes and nothing else, no heading.
  await expect(folder.getByRole('list').getByRole('listitem')).toHaveCount(3);
  await expect(folder.getByRole('list').getByRole('heading')).toHaveCount(0);
});

test('the icons sit four across, square, with the name below and the price badge on the corner', async ({ page }) => {
  await openMenu(page, slug);
  const folder = page.locator('#cat-viennoiserie [data-row]');
  expect(await folder.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await folder.nth(i).boundingBox())!));
  for (const box of boxes) expect(Math.abs(box.y - boxes[0]!.y), 'they share a row').toBeLessThanOrEqual(2);
  const grid = (await page.locator('#cat-viennoiserie').boundingBox())!;
  // Three dishes and the label tile: one row of four.
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

test('white text reads on every surface it sits on: every palette of the shape, and a white accent on a light background', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', slug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)]), ['white accent, light background', lightSlug]];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    const folder = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'label tile': folder.locator('.hs-title'),
      'dish count': folder.locator('.hs-title b'),
      'dish name': folder.locator('.hs-name').first(),
      'price badge': folder.locator('.hs-badge').first(),
      'dock tile': dock(page).locator('.hs-tile:not([aria-current="true"])').first(),
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectReadable(menu, { 'lit dock tile': dock(page).locator('.hs-tile[aria-current="true"]') });
  }
});

test('keyboard focus rings show in full: a whole app icon (in white, on the band) and a dock tile', async ({ page }) => {
  await openMenu(page, slug);
  const app = apps(page).first();
  const name = app.locator('.hs-name');
  await name.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(name).toBeFocused();
  await expectFocusRingShows(page, app, { outset: 4, pseudo: '::after' });
  expect(await name.evaluate((node) => getComputedStyle(node, '::after').outlineColor)).toBe('rgb(255, 255, 255)');
  const tile = entry(page, 'patisserie');
  await tile.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tile).toBeFocused();
  await expectFocusRingShows(page, tile, { outset: -4 });
});

test('a dish on sale shows a −NN% chip in the menu numerals on its icon, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = apps(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(home(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/\d|[٠-٩]/);
});

test('a long price wraps inside its badge: the badge stays in the cell, clear of the add button, and nothing scrolls sideways', async ({ page }) => {
  await openMenu(page, slug);
  const cell = apps(page).first();
  const badge = cell.locator('.hs-badge');
  await badge.evaluate((node) => {
    node.textContent = 'From 12,500 IQD';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await cell.boundingBox())!;
  const tag = (await badge.boundingBox())!;
  expect(tag.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(tag.x + tag.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const add = (await cell.locator('.hs-add').boundingBox())!;
  const overlaps = tag.x < add.x + add.width && add.x < tag.x + tag.width && tag.y < add.y + add.height && add.y < tag.y + tag.height;
  expect(overlaps, 'the badge covers the add button').toBe(false);
});
