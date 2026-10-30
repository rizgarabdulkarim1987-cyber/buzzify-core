import { expect, test, type Locator, type Page } from '@playwright/test';
import { mix } from '@/lib/templates/palette';
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
 * The Mailbox Wall body (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-box): every section a
 * wall of big brass boxes under a sign (its name and dish count), every dish a numbered box (the photo behind a barred
 * glass window, a name plate, a dark price bar with the add key), two boxes a row, and a sticky strip of brass key tags
 * (box number, name) that jumps to a wall.
 */

const menus = bodyMenus();
const slug = menus.slug('mbx');
const arabSlug = menus.slug('mbxar');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-mailbox-wall').slice(1);
const paletteSlug = (id: string) => menus.slug(`mbx-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'mailboxes', { templateId: 'the-mailbox-wall' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'mailboxes', { templateId: 'the-mailbox-wall', numeralSystem: 'ARAB', discount: ['croissant'] });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'mailboxes', { templateId: 'the-mailbox-wall', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const wall = (page: Page) => page.locator('[data-body="mailboxes"]');
const tags = (page: Page) => wall(page).locator('[data-tags]');
const boxes = (page: Page) => wall(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => tags(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows big boxes with photos, prices and names (at least one row under the demo banner), and every wall is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(wall(page)).toBeVisible();
  await expectFirstScreen(page, boxes(page), { min: 2 });
  await expectEverySectionReachable(tags(page));
});

test('every section is a wall under a sign (name and dish count), all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const shelves = wall(page).locator('section[data-wall]');
  expect(await shelves.count()).toBe(BODY_CATEGORIES.length);
  await expect(shelves.first().locator('[data-count]')).toHaveText('3');
  await expect(wall(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = shelves.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('Wall 1');
});

test('the boxes are big and sit two across: number on top, photo in a barred window, name plate, then the price bar with the add key', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  expect(await cells.count()).toBe(3);
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).boundingBox())!));
  expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(1);
  expect(a!.x).toBeLessThan(b!.x);
  expect(c!.y, 'the third box starts the next row').toBeGreaterThan(a!.y + a!.height - 1);
  expect(a!.width, 'a big box').toBeGreaterThanOrEqual(150);
  const number = (await cells.first().locator('.bx-no').boundingBox())!;
  const photo = (await cells.first().locator('[data-photo]').boundingBox())!;
  const name = (await cells.first().locator('.bx-name').boundingBox())!;
  const stamp = (await cells.first().locator('.bx-stamp').boundingBox())!;
  const add = (await cells.first().locator('.bx-add').boundingBox())!;
  expect(number.y + number.height).toBeLessThanOrEqual(photo.y + 1);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(stamp.y, 'the price bar is under the name plate').toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(add.y).toBeGreaterThanOrEqual(stamp.y - 1);
  expect(add.y + add.height).toBeLessThanOrEqual(stamp.y + stamp.height + 1);
  expect(add.x + add.width).toBeLessThanOrEqual(stamp.x + stamp.width + 1);
  await expect(cells.first().locator('.bx-stamp')).toContainText('$');
  const glass = await cells.first().locator('[data-photo]').evaluate((node) => getComputedStyle(node, '::after').content);
  expect(glass).not.toBe('none');
});

test('each key tag carries its first box number, in the menu numerals', async ({ page }) => {
  await openMenu(page, slug);
  await expect(tags(page).locator('.bx-tag-no').first()).toHaveText('101');
  await expect(tags(page).locator('.bx-tag-no').nth(1)).toHaveText('104');
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(tags(page).locator('.bx-tag-no').first()).toHaveText('١٠١');
});

test('the boxes are numbered from 101 along the whole menu, in the menu numerals', async ({ page }) => {
  await openMenu(page, slug);
  const numbers = await boxes(page).locator('.bx-no').allTextContents();
  expect(numbers.slice(0, 4)).toEqual(['101', '102', '103', '104']);
  expect(new Set(numbers).size).toBe(numbers.length);
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(boxes(page).first().locator('.bx-no')).toHaveText('١٠١');
});

test('a key tag takes you to its wall and focuses the label', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the tag strip lights the wall in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(tags(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the tag strip stays at the top: scrolled to the end, the first wall is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, tags(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a box opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await boxes(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the box without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = boxes(page).first();
  await cell.locator('.bx-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.bx-stamp').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.bx-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const stamp = (await cell.locator('.bx-stamp').boundingBox())!;
  expect(stamp.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(stamp.x + stamp.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen a wall stays a tidy row of three boxes', async ({ page }) => {
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
  const first = wall(page).locator('section[data-wall]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-wall', '١');
});

test('in Arabic the page is right to left, the wall mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => tags(p));
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('reduced motion removes the box entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(boxes(page).first()).toHaveCSS('animation-name', 'none');
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
    await expect(tags(page).locator('[aria-current="true"]')).toHaveCount(1);
    const island = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit tag': tags(page).locator('.bx-tag:not([aria-current="true"])').first(),
      'lit tag': tags(page).locator('[aria-current="true"]'),
      sign: island.locator('.bx-rail'),
      'wall number': island.locator('.bx-rail small'),
      'dish count': island.locator('.bx-rail b'),
      'price stamp': island.locator('.bx-stamp').first(),
      'name plate': island.locator('.bx-name').first(),
      'box number': island.locator('.bx-no').first(),
      'add button': island.locator('.bx-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': wall(page).locator('.tpl-off').first() }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole box and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = boxes(page).first();
    const name = cell.locator('.bx-name');
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

test('a dish on sale shows a −NN% chip in the menu numerals on its box, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = boxes(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(wall(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});

/** Colours picked in Customize (a green menu with a pink accent): every surface of the shape must follow them. */
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('maicol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'mailboxes', { templateId: 'the-mailbox-wall', colors: CUSTOM });
});
/** A computed colour as [r, g, b] (0 to 255), whatever colour space the browser reports it in. */
const rgbOf = (node: Locator, property: string) =>
  node.evaluate((element, name) => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    context.fillStyle = getComputedStyle(element).getPropertyValue(name);
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!];
  }, property);
const rgbOfHex = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const expectNear = (actual: number[], hex: string, message: string) => {
  const want = rgbOfHex(hex);
  actual.forEach((channel, at) => expect(Math.abs(channel - want[at]!), `${message}: channel ${at} is ${channel}, want ~${want[at]}`).toBeLessThanOrEqual(3));
};

test('Customize colours reach the wall: the brass is the accent, its ink --on-accent', async ({ page }) => {
  await openMenu(page, customSlug);
  const wall = page.locator('[data-body="mailboxes"] .bx-wall').first();
  expectNear(await rgbOf(wall.locator('.bx-box').first(), 'background-color'), CUSTOM.accent, 'door');
  expectNear(await rgbOf(wall.locator('.bx-box').first(), 'color'), CUSTOM.onAccent, 'door ink');
  expectNear(await rgbOf(wall.locator('.bx-name').first(), 'background-color'), mix(CUSTOM.text, CUSTOM.accent, 0.4), 'name plate');
  expectNear(await rgbOf(wall.locator('.bx-stamp').first(), 'background-color'), CUSTOM.onAccent, 'price stamp');
  expectNear(await rgbOf(wall.locator('.bx-stamp').first(), 'color'), mix(CUSTOM.text, CUSTOM.accent, 0.4), 'stamp face');
});
