import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu } from './helpers/body-menu';

/**
 * The Supermarket Shelves body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a shelf plank under
 * an aisle sign, the dishes standing on it as product boxes with a hanging price tag, wrapping to rows, and a strip of
 * aisle signs that jumps. Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('shf');
const arabSlug = menus.slug('shfar');

test.beforeAll(async () => {
  await menus.create(slug, 'shelves', { templateId: 'the-supermarket-shelves', layout: { body: 'shelves', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'shelves', { templateId: 'the-supermarket-shelves', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const bay = (page: Page) => page.locator('[data-body="shelves"]');
const signs = (page: Page) => bay(page).locator('[data-signs]');
const boxes = (page: Page) => bay(page).locator('[data-row]');
const sign = (page: Page, categorySlug: string) => signs(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least four boxes on a shelf with photos and prices, and every aisle sign', async ({ page }) => {
  await openMenu(page, slug);
  await expect(bay(page)).toBeVisible();
  await expectFirstScreen(page, boxes(page), { min: 4 });
  await expectEverySectionReachable(signs(page));
});

test('the aisle signs stay at the top: scrolled to the end, the first aisle is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, signs(page), sign(page, 'viennoiserie'), 'viennoiserie');
});

test('boxes wrap to rows of four on a phone, each with a hanging price tag', async ({ page }) => {
  await openMenu(page, slug);
  const first = bay(page).locator('section').first();
  const xs = await first.locator('[data-row]').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBeGreaterThanOrEqual(2);
  await expect(first.locator('[data-row] .sf-tag').first()).toBeVisible();
  await expect(first.locator('[data-plank]')).toHaveCount(1);
});

test('every section has an aisle sign with a number and a dish count', async ({ page }) => {
  await openMenu(page, slug);
  const sections = bay(page).locator('section[data-aisle]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(bay(page).locator('#cat-bread [data-count]')).toHaveText('1');
});

test('an aisle sign jumps to its shelf', async ({ page }) => {
  await openMenu(page, slug);
  const last = BODY_CATEGORIES[BODY_CATEGORIES.length - 1]!.slug;
  await expectJumpsTo(page, sign(page, last), last);
});

test('a dish opens its sheet and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
});

test('a long dish name stays inside its box without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await boxes(page).first().locator('.sf-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines on a phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await boxes(page).first().boundingBox())!;
  const name = (await boxes(page).first().locator('.sf-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(name.y + name.height).toBeLessThanOrEqual(box.y + box.height + 1);
});

test('counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(bay(page).locator('section[data-aisle] [data-count]').first()).toHaveText('٣');
});

test('in Arabic the signs and shelves mirror and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => signs(p));
});

test('reduced motion stops the swaying tags', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  expect(await bay(page).locator('.sf-tag').first().evaluate((node) => getComputedStyle(node, '::before').animationName)).toBe('none');
});

test('a search keeps main#menu and never steals focus', async ({ page }) => {
  await openMenu(page, slug);
  const box = page.getByRole('searchbox', { name: 'Search the menu' });
  await box.fill('cro');
  await expect(box).toBeFocused();
  await box.fill('zzzzqq');
  await expect(box).toBeFocused();
  await expect(page.locator('main#menu')).toHaveCount(1);
});
