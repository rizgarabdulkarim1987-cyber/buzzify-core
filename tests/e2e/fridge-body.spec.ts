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
 * The Fridge body (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-frg): every section a glass
 * shelf with a label (its name and dish count), every dish a container (a coloured lid, a big square photo with the
 * price on a yellow sticker, the name and the add button below), two a row, and a sticky strip of coloured magnets that
 * jumps to a shelf.
 */

const menus = bodyMenus();
const slug = menus.slug('frg');
const arabSlug = menus.slug('frgar');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-fridge').slice(1);
const paletteSlug = (id: string) => menus.slug(`frg-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'fridge', { templateId: 'the-fridge' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'fridge', { templateId: 'the-fridge', numeralSystem: 'ARAB', discount: ['croissant'] });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'fridge', { templateId: 'the-fridge', paletteId: id });
});
test.afterAll(() => menus.remove());

const fridge = (page: Page) => page.locator('[data-body="fridge"]');
const doors = (page: Page) => fridge(page).locator('[data-doors]');
const jars = (page: Page) => fridge(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => doors(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows big containers with photos, prices and names (at least one row under the demo banner), and every shelf is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(fridge(page)).toBeVisible();
  await expectFirstScreen(page, jars(page), { min: 2 });
  await expectEverySectionReachable(doors(page));
});

test('every section is a shelf with a frost label (name and dish count), all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const shelves = fridge(page).locator('section[data-shelf]');
  expect(await shelves.count()).toBe(BODY_CATEGORIES.length);
  await expect(shelves.first().locator('[data-count]')).toHaveText('3');
  await expect(fridge(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = shelves.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('Shelf 1');
});

test('the containers sit two across, big: a coloured lid on top, the square photo with the price sticker on it, the name below', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  expect(await cells.count()).toBe(3);
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).boundingBox())!));
  expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(1);
  expect(a!.x).toBeLessThan(b!.x);
  expect(c!.y, 'the third container starts the next row').toBeGreaterThan(a!.y + a!.height - 1);
  expect(a!.width, 'a big container').toBeGreaterThanOrEqual(150);
  const lid = (await cells.first().locator('.fr-lid').boundingBox())!;
  const photo = (await cells.first().locator('[data-photo]').boundingBox())!;
  const name = (await cells.first().locator('.fr-name').boundingBox())!;
  expect(Math.abs(photo.width - photo.height), 'a square photo').toBeLessThanOrEqual(1.5);
  expect(lid.y, 'the price sticker sits on the photo').toBeGreaterThanOrEqual(photo.y - 4);
  expect(lid.y).toBeLessThan(photo.y + photo.height / 2);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  await expect(cells.first().locator('.fr-lid')).toContainText('$');
  await expect(cells.first().locator('.fr-lid')).toHaveCSS('background-color', 'rgb(255, 210, 63)');
  const lidStripe = await cells.first().evaluate((node) => getComputedStyle(node, '::before').content);
  expect(lidStripe).not.toBe('none');
  const add = (await cells.first().locator('.fr-add').boundingBox())!;
  expect(add.y, 'the add button is beside the name, under the photo').toBeGreaterThanOrEqual(photo.y + photo.height - 1);
});

test('a door panel takes you to its shelf and focuses the label', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the door strip lights the shelf in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(doors(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the door strip stays at the top: scrolled to the end, the first shelf is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, doors(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a jar opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await jars(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the jar without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = jars(page).first();
  await cell.locator('.fr-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.fr-lid').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.fr-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const lid = (await cell.locator('.fr-lid').boundingBox())!;
  expect(lid.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(lid.x + lid.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen a shelf stays a tidy row of three containers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const c = (await cells.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(c.x + c.width - a.x).toBeLessThanOrEqual(640);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = fridge(page).locator('section[data-shelf]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-shelf', '١');
});

test('in Arabic the page is right to left, the shelf mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => doors(p));
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('reduced motion removes the jar entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(jars(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('text reads on every fill it sits on, in every palette of the shape', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', slug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)])];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    // Scrolled a little, so a strip entry is lit; the first section is still on the screen.
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(doors(page).locator('[aria-current="true"]')).toHaveCount(1);
    const island = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit door': doors(page).locator('.fr-door:not([aria-current="true"])').first(),
      'lit door': doors(page).locator('[aria-current="true"]'),
      'frost label': island.locator('.fr-frost'),
      'shelf number': island.locator('.fr-frost small'),
      'dish count': island.locator('.fr-frost b'),
      'price lid': island.locator('.fr-lid').first(),
      'name sticker': island.locator('.fr-name').first(),
      'add button': island.locator('.fr-add').first(),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole jar and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = jars(page).first();
    const name = cell.locator('.fr-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, cell, { outset: -2, pseudo: '::after' });
    const chip = entry(page, 'patisserie');
    await chip.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip).toBeFocused();
    await expectFocusRingShows(page, chip, { outset: -4 });
  }
});

test('a dish on sale shows a −NN% chip in the menu numerals on its jar, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = jars(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(fridge(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
