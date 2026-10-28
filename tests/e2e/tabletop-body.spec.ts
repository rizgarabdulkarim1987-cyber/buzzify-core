import { expect, test, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  contrastOf,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectFocusRingShows,
  expectJumpsTo,
  expectOpensProduct,
  expectQuickAdd,
  expectStripStays,
  openMenu,
  shapeChecks,
} from './helpers/body-menu';

/**
 * The Table from Above body (spec 2026-10-26-menu-styles-in-templates-design.md): a wood table seen from above, every
 * section a placemat with its dishes as big round plates two across, and a sticky strip of placemat chips that jumps.
 * Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('top');
const arabSlug = menus.slug('topar');
const oakSlug = menus.slug('ttoak');
const compactSlug = menus.slug('ttcp');

test.beforeAll(async () => {
  await menus.create(slug, 'tabletop', {
    templateId: 'the-table-from-above',
    layout: { body: 'tabletop', hero: 'editorial', nav: 'index' },
  });
  await menus.create(arabSlug, 'tabletop', {
    templateId: 'the-table-from-above',
    numeralSystem: 'ARAB',
  });
  await menus.create(compactSlug, 'tabletop', {
    templateId: 'the-table-from-above',
  });
  // The shape's own palette with a dark accent (a rust on pale oak).
  await menus.create(oakSlug, 'tabletop', {
    templateId: 'the-table-from-above',
    paletteId: 'oak',
  });
});
test.afterAll(() => menus.remove());

const table = (page: Page) => page.locator('[data-body="tabletop"]');
const mats = (page: Page) => table(page).locator('[data-placemats]');
const plates = (page: Page) => table(page).locator('[data-row]');
/** Plates the phone's first screen holds whole (picture and price both in view): the first row of two (the demo menu has three dishes in its first placemat; the real 390x844 menus show four, measured by hand). */
const FIRST_SCREEN = 2;
const entry = (page: Page, categorySlug: string) =>
  mats(page).getByRole('button', {
    name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!),
  });

test('on a phone the first screen shows several plates with photos and prices, and every placemat is one tap away', async ({ page }) => {
  // The shape's own hero; the taller editorial hero of the main test menu leaves room for two plates only.
  await openMenu(page, compactSlug);
  await expect(table(page)).toBeVisible();
  await expectFirstScreen(page, plates(page), { min: FIRST_SCREEN });
  await expectEverySectionReachable(mats(page));
});

test('plates are big and round, two across on a phone, with a fork and a knife beside each and a card (add, name, price) under it', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie [data-row]');
  expect(await first.count()).toBe(3);
  const boxes = await Promise.all([0, 1].map(async (i) => (await first.nth(i).locator('[data-photo]').boundingBox())!));
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y), 'two plates share a row (the second row is set lower)').toBeLessThanOrEqual(14);
  expect(Math.abs(boxes[0]!.x - boxes[1]!.x), 'two columns').toBeGreaterThan(100);
  expect(Math.abs(boxes[0]!.width - boxes[0]!.height)).toBeLessThanOrEqual(1);
  expect(boxes[0]!.width, 'a big plate').toBeGreaterThanOrEqual(120);
  await expect(first.first().locator('[data-photo]')).toHaveCSS('border-radius', '50%');
  const photo = boxes[0]!;
  const disc = (await first.first().locator('.tt-disc').boundingBox())!;
  for (const part of ['.tt-fork', '.tt-knife']) {
    const box = (await first.first().locator(part).boundingBox())!;
    expect(box.x + box.width <= disc.x + 1 || box.x >= disc.x + disc.width - 1, part + ' lies beside the plate').toBe(true);
    expect(box.height, part).toBeGreaterThan(photo.height * 0.5);
  }
  const card = (await first.first().locator('.tt-card').boundingBox())!;
  expect(card.y, 'the card is under the plate').toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  for (const part of ['.tt-name', '.tt-price', '.tt-add']) {
    const box = (await first.first().locator(part).boundingBox())!;
    expect(box.y, part + ' is on the card').toBeGreaterThanOrEqual(card.y - 1);
    expect(box.y + box.height, part).toBeLessThanOrEqual(card.y + card.height + 1);
  }
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
  await plates(page)
    .first()
    .locator('.tt-name')
    .evaluate((node) => {
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
  expect(Math.abs(a.y - c.y), 'three plates run along one row').toBeLessThanOrEqual(12);
  expect(a.width).toBeLessThan(260);
});

test('the plate stays inside its column with a long dish name on the card', async ({ page }) => {
  await openMenu(page, slug);
  await plates(page)
    .first()
    .locator('.tt-name')
    .evaluate((node) => {
      node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines';
    });
  const card = (await plates(page).first().locator('.tt-card').boundingBox())!;
  expect(card.x + card.width).toBeLessThanOrEqual(390 + 1);
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

shapeChecks(menus, {
  kind: 'tabletop',
  templateId: 'the-table-from-above',
  checks: ['sale'],
});
