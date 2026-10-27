import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, contrastOf, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectFocusRingShows, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu, shapeChecks } from './helpers/body-menu';

/**
 * The Table from Above body (spec 2026-10-26-menu-styles-in-templates-design.md): a wood table seen from above, every
 * section a placemat with its dishes as round plates three across, and a sticky strip of placemat chips that jumps.
 * Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('top');
const arabSlug = menus.slug('topar');
const oakSlug = menus.slug('ttoak');

test.beforeAll(async () => {
  await menus.create(slug, 'tabletop', { templateId: 'the-table-from-above', layout: { body: 'tabletop', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'tabletop', { templateId: 'the-table-from-above', numeralSystem: 'ARAB' });
  // The shape's own palette with a dark accent (a rust on pale oak).
  await menus.create(oakSlug, 'tabletop', { templateId: 'the-table-from-above', paletteId: 'oak' });
});
test.afterAll(() => menus.remove());

const table = (page: Page) => page.locator('[data-body="tabletop"]');
const mats = (page: Page) => table(page).locator('[data-placemats]');
const plates = (page: Page) => table(page).locator('[data-row]');
/** Plates the phone's first screen holds whole: the first placemat's row of three (the next row sits below the fold). */
const FIRST_SCREEN = 3;
const entry = (page: Page, categorySlug: string) => mats(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows several plates with photos and prices, and every placemat is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(table(page)).toBeVisible();
  await expectFirstScreen(page, plates(page), { min: FIRST_SCREEN });
  await expectEverySectionReachable(mats(page));
});

test('plates are round, three across on a phone, with the price chip on the rim and the name under', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie [data-row]');
  expect(await first.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await first.nth(i).locator('[data-photo]').boundingBox())!));
  expect(Math.abs(boxes[0]!.y - boxes[2]!.y), 'three plates share a row').toBeLessThanOrEqual(2);
  expect(Math.abs(boxes[0]!.width - boxes[0]!.height)).toBeLessThanOrEqual(1);
  await expect(first.first().locator('[data-photo]')).toHaveCSS('border-radius', '50%');
  const photo = boxes[0]!;
  const price = (await first.first().locator('.tt-price').boundingBox())!;
  const name = (await first.first().locator('.tt-name').boundingBox())!;
  expect(price.y + price.height / 2, 'the price sits on the lower rim').toBeGreaterThan(photo.y + photo.height * 0.7);
  expect(price.y, 'the price starts inside the plate').toBeLessThan(photo.y + photo.height);
  expect(name.y, 'the name is under the plate').toBeGreaterThanOrEqual(photo.y + photo.height - 1);
});

test('every section is a placemat with its number and dish count', async ({ page }) => {
  await openMenu(page, slug);
  const sections = table(page).locator('section[data-mat]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first()).toHaveAttribute('data-mat', '1');
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(table(page).locator('#cat-bread [data-count]')).toHaveText('1');
});

test('a chip on the strip takes you to its placemat and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the strip lights the placemat in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(mats(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first placemat is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, mats(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a plate opens its dish and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await plates(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the lit napkin reads on every palette of the shape, the dark accent included', async ({ page }) => {
  for (const menu of [slug, oakSlug]) {
    await openMenu(page, menu);
    const lit = mats(page).locator('[aria-current="true"]');
    await expect(lit).toHaveCount(1);
    expect(await contrastOf(lit), menu).toBeGreaterThanOrEqual(4.5);
  }
});

test('keyboard focus rings show in full: a napkin chip and a whole plate', async ({ page }) => {
  await openMenu(page, slug);
  const napkin = entry(page, 'patisserie');
  await napkin.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(napkin).toBeFocused();
  await expectFocusRingShows(page, napkin, { outset: -4 });
  const plate = plates(page).first();
  await plate.locator('.tt-name').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(plate.locator('.tt-name')).toBeFocused();
  await expectFocusRingShows(page, plate, { outset: 6, pseudo: '::after' });
});

test('a placemat with one plate is a placemat with one plate', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
});

test('a long dish name stays under its plate without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await plates(page).first().locator('.tt-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const plate = (await plates(page).first().boundingBox())!;
  const name = (await plates(page).first().locator('.tt-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(plate.x + plate.width + 1);
  expect(name.y + name.height).toBeLessThanOrEqual(plate.y + plate.height + 1);
});

test('on a wide screen the plates run more across', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const first = page.locator('#cat-viennoiserie [data-row]');
  const a = (await first.nth(0).boundingBox())!;
  const c = (await first.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(2);
  expect(a.width).toBeLessThan(260);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = table(page).locator('section[data-mat]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-mat', '١');
});

test('in Arabic the page is right to left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => mats(p));
});

test('reduced motion removes the plate entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(plates(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

shapeChecks(menus, { kind: 'tabletop', templateId: 'the-table-from-above', checks: ['sale'] });
