import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu, shapeChecks } from './helpers/body-menu';

/**
 * The Periodic Table body (spec 2026-10-26-menu-styles-in-templates-design.md): every dish an element tile (photo,
 * symbol, number, price) in a grid, sections as coloured groups, a group legend that jumps. Throwaway copies of the
 * Maison Lumière demo.
 */

const menus = bodyMenus();
const slug = menus.slug('per');
const arabSlug = menus.slug('perar');

test.beforeAll(async () => {
  await menus.create(slug, 'periodic', { templateId: 'the-periodic-table', layout: { body: 'periodic', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'periodic', { templateId: 'the-periodic-table', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const table = (page: Page) => page.locator('[data-body="periodic"]');
const legend = (page: Page) => table(page).locator('[data-legend]');
const tiles = (page: Page) => table(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => legend(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows ten element tiles with photos and prices (as in the poster), and the whole legend', async ({ page }) => {
  await openMenu(page, slug);
  await expect(table(page)).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 10 });
  await expectEverySectionReachable(legend(page));
});

test('the tiles sit four to a row', async ({ page }) => {
  await openMenu(page, slug);
  const box = (await tiles(page).first().boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width / 4);
  expect(box.width).toBeGreaterThanOrEqual(70);
});

test('the table is one continuous grid: the groups flow on with no empty cells between them', async ({ page }) => {
  await openMenu(page, slug);
  const count = await tiles(page).count();
  const tops = await tiles(page).evaluateAll((nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top + window.scrollY))).size);
  expect(tops).toBe(Math.ceil(count / 4));
});

test('the name and the price sit on the photo itself, not under it', async ({ page }) => {
  await openMenu(page, slug);
  const tile = (await tiles(page).first().boundingBox())!;
  const name = (await tiles(page).first().locator('.pt-name').boundingBox())!;
  const price = (await tiles(page).first().locator('.pt-price').boundingBox())!;
  expect(tile.height).toBeLessThanOrEqual(tile.width * 1.4);
  expect(name.y + name.height).toBeLessThanOrEqual(price.y + 1);
  expect(price.y + price.height).toBeLessThanOrEqual(tile.y + tile.height);
});

test('every tile carries a symbol and a number in the menu numerals, counting through the whole menu', async ({ page }) => {
  await openMenu(page, slug);
  await expect(tiles(page).first().locator('[data-symbol]')).toHaveText('Bu');
  await expect(tiles(page).first().locator('[data-number]')).toHaveText('1');
  const count = await tiles(page).count();
  await expect(tiles(page).nth(count - 1).locator('[data-number]')).toHaveText(String(count));
});

test('a legend entry takes you to its group and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the legend lights the group whose first row is in view', async ({ page }) => {
  await openMenu(page, slug);
  // Scroll the group's first tile into the band the template watches (30% to 40% down the screen). Groups flow on in one
  // table, so a group's first tile can share a row with the one before it: that earlier group lights first.
  await page.evaluate(() => window.scrollBy(0, document.querySelector('#cat-celebration')!.getBoundingClientRect().top - window.innerHeight * 0.35));
  await expect(legend(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the legend stays at the top, at most two rows high: scrolled to the end, the first group is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  const chip = (await entry(page, 'viennoiserie').boundingBox())!;
  expect((await legend(page).boundingBox())!.height).toBeLessThanOrEqual(chip.height * 2 + 6 + 16);
  await expectStripStays(page, legend(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a tile opens its dish from anywhere on it and adds one', async ({ page }) => {
  await openMenu(page, slug);
  await expectOpensProduct(page, table(page), 'croissant');
  await expectQuickAdd(page, table(page), 'croissant');
  const box = (await tiles(page).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a group with one dish is one tile: it carries the group anchor and the table ends on it', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread')).toHaveCount(1);
  await expect(tiles(page).last().locator('#cat-bread')).toHaveCount(1);
});

test('a long dish name stays inside its tile without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await tiles(page).first().locator('.pt-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines on a phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const tile = (await tiles(page).first().boundingBox())!;
  const name = (await tiles(page).first().locator('.pt-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(tile.x + tile.width + 1);
  expect(name.y + name.height).toBeLessThanOrEqual(tile.y + tile.height + 1);
});

test('numbers use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(tiles(page).first().locator('[data-number]')).toHaveText('١');
});

test('in Arabic the table is right to left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => legend(p));
  const first = (await tiles(page).nth(0).boundingBox())!;
  const second = (await tiles(page).nth(1).boundingBox())!;
  expect(first.x).toBeGreaterThan(second.x);
});

test('reduced motion removes the tile entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(tiles(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

shapeChecks(menus, { kind: 'periodic', templateId: 'the-periodic-table', checks: ['focus', 'contrast', 'sale'], entry });
