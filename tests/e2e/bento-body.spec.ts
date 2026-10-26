import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu } from './helpers/body-menu';

/**
 * The Bento Box body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a lacquered box cut into
 * compartments of unequal size (a big one for the lead dish, the pattern by dish count), a paper flag on each with the
 * name and a small flag with the price, and a sticky strip of lid-handle tabs that jumps to a box.
 */

const menus = bodyMenus();
const slug = menus.slug('bnt');
const arabSlug = menus.slug('bntar');

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'bento', { templateId: 'the-bento-box' });
  await menus.create(arabSlug, 'bento', { templateId: 'the-bento-box', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const bento = (page: Page) => page.locator('[data-body="bento"]');
const lids = (page: Page) => bento(page).locator('[data-lids]');
const cells = (page: Page) => bento(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => lids(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least six dishes with photos, prices and names, and every box is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(bento(page)).toBeVisible();
  await expectFirstScreen(page, cells(page), { min: 6 });
  await expectEverySectionReachable(lids(page));
});

test('every section is a box with a paper label (number, name, dish count), all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const boxes = bento(page).locator('section[data-box]');
  expect(await boxes.count()).toBe(BODY_CATEGORIES.length);
  await expect(boxes.first().locator('[data-count]')).toHaveText('3');
  await expect(bento(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = boxes.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('Box 1');
});

test('compartments are of unequal size: the lead dish is the biggest, and the pattern follows the dish count', async ({ page }) => {
  await openMenu(page, slug);
  const three = page.locator('#cat-viennoiserie [data-row]');
  expect(await three.count()).toBe(3);
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await three.nth(i).boundingBox())!));
  expect(a!.width * a!.height).toBeGreaterThan(b!.width * b!.height * 1.8);
  expect(a!.width * a!.height).toBeGreaterThan(c!.width * c!.height * 1.8);
  expect(a!.x).toBeLessThan(b!.x);
  expect(Math.abs(b!.x - c!.x)).toBeLessThanOrEqual(1);
  expect(c!.y).toBeGreaterThan(b!.y);
  // A lone dish fills the whole tray's width.
  const one = (await page.locator('#cat-bread [data-row]').first().boundingBox())!;
  const tray = (await page.locator('#cat-bread .bn-tray').boundingBox())!;
  expect(one.width).toBeGreaterThanOrEqual(tray.width - 1);
});

test('a compartment carries a name flag at its foot and a price flag on its corner, over the photo', async ({ page }) => {
  await openMenu(page, slug);
  const cell = cells(page).first();
  const box = (await cell.boundingBox())!;
  const name = (await cell.locator('.bn-name').boundingBox())!;
  const price = (await cell.locator('.bn-price').boundingBox())!;
  expect(name.y + name.height).toBeGreaterThan(box.y + box.height - 12);
  expect(price.y).toBeLessThan(box.y + 12);
  await expect(cell.locator('.bn-price')).toContainText('$');
});

test('a lid tab takes you to its box and focuses the label', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the lid strip lights the box in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(lids(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the lid strip stays at the top: scrolled to the end, the first box is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, lids(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a compartment opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await cells(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the smallest compartment without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = page.locator('#cat-viennoiserie [data-row]').nth(1);
  await cell.locator('.bn-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.bn-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.bn-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const flag = (await cell.locator('.bn-price-flag').boundingBox())!;
  expect(flag.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(flag.x + flag.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(flag.y + flag.height).toBeLessThanOrEqual(box.y + box.height + 1);
});

test('on a wide screen the boxes stay a tidy column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const box = (await page.locator('#cat-viennoiserie').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(580);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = bento(page).locator('section[data-box]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-box', '١');
});

test('in Arabic the page is right to left, the box mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => lids(p));
  const three = page.locator('#cat-viennoiserie [data-row]');
  const a = (await three.nth(0).boundingBox())!;
  const b = (await three.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('reduced motion removes the compartment entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(cells(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});
