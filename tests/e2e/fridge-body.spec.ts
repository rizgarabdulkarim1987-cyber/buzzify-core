import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu } from './helpers/body-menu';

/**
 * The Fridge body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a glass shelf with a frost label
 * (its name and dish count), every dish a jar (a lid band with the price, the photo, a name sticker), three jars a row
 * on the shelf rail so many show at once, and a sticky strip of fridge-door panels that jumps to a shelf.
 */

const menus = bodyMenus();
const slug = menus.slug('frg');
const arabSlug = menus.slug('frgar');

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'fridge', { templateId: 'the-fridge' });
  await menus.create(arabSlug, 'fridge', { templateId: 'the-fridge', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const fridge = (page: Page) => page.locator('[data-body="fridge"]');
const doors = (page: Page) => fridge(page).locator('[data-doors]');
const jars = (page: Page) => fridge(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => doors(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least six jars with photos, prices and names, and every shelf is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(fridge(page)).toBeVisible();
  await expectFirstScreen(page, jars(page), { min: 6 });
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

test('the jars sit three across on a rail: lid with the price on top, photo, name sticker below', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  expect(await cells.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).boundingBox())!));
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  const lid = (await cells.first().locator('.fr-lid').boundingBox())!;
  const photo = (await cells.first().locator('[data-photo]').boundingBox())!;
  const name = (await cells.first().locator('.fr-name').boundingBox())!;
  expect(lid.y + lid.height).toBeLessThanOrEqual(photo.y + 1);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  await expect(cells.first().locator('.fr-lid')).toContainText('$');
  const rail = await cells.first().evaluate((node) => getComputedStyle(node, '::before').content);
  expect(rail).not.toBe('none');
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

test('on a wide screen a shelf stays a tidy row of three jars', async ({ page }) => {
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
