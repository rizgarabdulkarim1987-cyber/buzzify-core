import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu, shapeChecks } from './helpers/body-menu';

/**
 * The Metro Line body (spec 2026-10-26-menu-styles-in-templates-design.md): a route strip of stations that jump, one
 * line down the page with a station per section in its own colour, and the dishes as stops along it. Throwaway copies
 * of the Maison Lumière demo.
 */

const menus = bodyMenus();
const slug = menus.slug('met');
const arabSlug = menus.slug('metar');

test.beforeAll(async () => {
  await menus.create(slug, 'metro', { templateId: 'the-metro-line', layout: { body: 'metro', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'metro', { templateId: 'the-metro-line', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const line = (page: Page) => page.locator('[data-body="metro"]');
const route = (page: Page) => line(page).locator('[data-route]');
const stops = (page: Page) => line(page).locator('[data-row]');
const station = (page: Page, categorySlug: string) => route(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows three stops with photos (four or more on the live menu, whose hero is smaller) and prices, and the whole route', async ({ page }) => {
  await openMenu(page, slug);
  await expect(line(page)).toBeVisible();
  // The demo card is demo data a real menu does not have: measured without it.
  await page.addStyleTag({ content: '.tpl-promo{display:none!important}' });
  await expectFirstScreen(page, stops(page), { min: 3 });
  await expectEverySectionReachable(route(page));
});

test('every section is a station with its own colour, a number and a dish count', async ({ page }) => {
  await openMenu(page, slug);
  const sections = line(page).locator('section[data-station]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  const colours = await sections.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).getPropertyValue('--g').trim()));
  expect(new Set(colours).size).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(line(page).locator('#cat-bread [data-count]')).toHaveText('1');
});

test('a station on the route takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, station(page, 'celebration'), 'celebration');
});

test('the route lights the station in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(route(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(station(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the route stays at the top: scrolled to the end, the first station is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, route(page), station(page, 'viennoiserie'), 'viennoiserie');
});

test('a stop opens its dish and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await stops(page).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 6);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a section with one dish is a station with one stop', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
});

test('a long dish name stays inside its stop without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await stops(page).first().locator('.mt-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines on a phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const stop = (await stops(page).first().boundingBox())!;
  const name = (await stops(page).first().locator('.mt-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(stop.x + stop.width + 1);
  expect(name.y + name.height).toBeLessThanOrEqual(stop.y + stop.height + 1);
});

test('counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(line(page).locator('section[data-station]').first().locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the line runs down the right edge and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => route(p));
  // The line's room (3rem) is on the right in RTL (the poster's line), the page gutter on the left.
  const stop = (await stops(page).first().boundingBox())!;
  const section = (await line(page).locator('section[data-station]').first().boundingBox())!;
  expect(section.x + section.width - (stop.x + stop.width), 'the line room on the right').toBeGreaterThanOrEqual(40);
  expect(stop.x - section.x, 'the gutter on the left').toBeLessThanOrEqual(32);
});

test('reduced motion removes the stop entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(stops(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

shapeChecks(menus, { kind: 'metro', templateId: 'the-metro-line', checks: ['focus', 'contrast', 'sale'], entry: station });
