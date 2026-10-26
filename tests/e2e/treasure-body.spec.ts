import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu } from './helpers/body-menu';

/**
 * The Treasure Map body (spec 2026-10-26-menu-styles-in-templates-design.md): old parchment, every section an island with
 * its name on a banner and its dish count, every dish a pin with a photo and its price on a flag, a dotted route joining
 * the islands, and a sticky strip of compass points that jumps. Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('map');
const arabSlug = menus.slug('mapar');

test.beforeAll(async () => {
  // The preset's own layout (its compact hero, its chips): what a restaurant that picks the template gets.
  await menus.create(slug, 'treasure', { templateId: 'the-treasure-map' });
  await menus.create(arabSlug, 'treasure', { templateId: 'the-treasure-map', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const map = (page: Page) => page.locator('[data-body="treasure"]');
const compass = (page: Page) => map(page).locator('[data-compass]');
const pins = (page: Page) => map(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => compass(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least six pins with photos, prices and names, and every island is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(map(page)).toBeVisible();
  await expectFirstScreen(page, pins(page), { min: 6 });
  await expectEverySectionReachable(compass(page));
});

test('every section is an island with its name on a banner and its dish count, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const islands = map(page).locator('section[data-island]');
  expect(await islands.count()).toBe(BODY_CATEGORIES.length);
  await expect(islands.first()).toHaveAttribute('data-island', '1');
  await expect(islands.first().locator('[data-count]')).toHaveText('3');
  await expect(map(page).locator('#cat-bread [data-count]')).toHaveText('1');
  await expect(islands.first().getByRole('heading', { name: /Viennoiserie/ })).toBeVisible();
});

test('the pins sit three across on the island, round photo, price flag under it', async ({ page }) => {
  await openMenu(page, slug);
  const island = page.locator('#cat-viennoiserie [data-row]');
  expect(await island.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await island.nth(i).boundingBox())!));
  // They share a row, give or take the small stagger.
  for (const box of boxes) expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThanOrEqual(12);
  const photo = (await island.first().locator('[data-photo]').boundingBox())!;
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  await expect(island.first().locator('[data-photo]')).toHaveCSS('border-radius', '50%');
  const tag = (await island.first().locator('.tm-tag').boundingBox())!;
  expect(tag.y + tag.height, 'the flag hangs from the photo').toBeGreaterThan(photo.y + photo.height);
});

test('the route is a dotted line down the page beside the islands', async ({ page }) => {
  await openMenu(page, slug);
  const route = await map(page)
    .locator('main')
    .evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return { border: style.borderInlineStartStyle, content: style.content };
    });
  expect(route.border).toBe('dotted');
  expect(route.content).not.toBe('none');
});

test('a point on the compass strip takes you to its island and focuses the banner', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the strip lights the island in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(compass(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first island is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, compass(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a pin opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await pins(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the pin without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = pins(page).first();
  await cell.locator('.tm-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.tm-tag').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.tm-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const tag = (await cell.locator('.tm-tag').boundingBox())!;
  expect(tag.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(tag.x + tag.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen the pins run more across', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const first = page.locator('#cat-viennoiserie [data-row]');
  const a = (await first.nth(0).boundingBox())!;
  const c = (await first.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(14);
  expect(a.width).toBeLessThan(200);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = map(page).locator('section[data-island]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-island', '١');
});

test('in Arabic the page is right to left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => compass(p));
});

test('reduced motion removes the pin entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(pins(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});
