import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu } from './helpers/body-menu';

/**
 * The Kitchen Ticket Rail body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a paper ticket hung
 * from a steel rail, its dishes the lines of the ticket, and a sticky index of ticket numbers that jumps. Throwaway
 * copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('tkt');
const arabSlug = menus.slug('tktar');

test.beforeAll(async () => {
  await menus.create(slug, 'tickets', { templateId: 'the-kitchen-ticket-rail', layout: { body: 'tickets', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'tickets', { templateId: 'the-kitchen-ticket-rail', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const rail = (page: Page) => page.locator('[data-body="tickets"]');
const index = (page: Page) => rail(page).locator('[data-index]');
const lines = (page: Page) => rail(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => index(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows four dishes with photos and prices, and every ticket is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(rail(page)).toBeVisible();
  await expectFirstScreen(page, lines(page), { min: 4 });
  await expectEverySectionReachable(index(page));
});

test('every section is a ticket with its number and dish count, stacked full width on a phone', async ({ page }) => {
  await openMenu(page, slug);
  const tickets = rail(page).locator('section[data-ticket]');
  expect(await tickets.count()).toBe(BODY_CATEGORIES.length);
  await expect(tickets.first()).toHaveAttribute('data-ticket', '1');
  await expect(tickets.first().locator('[data-count]')).toHaveText('3');
  await expect(rail(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const first = (await tickets.nth(0).boundingBox())!;
  const second = (await tickets.nth(1).boundingBox())!;
  expect(second.y, 'the second ticket is below the first').toBeGreaterThan(first.y + first.height - 1);
  expect(first.width).toBeGreaterThan(340);
});

test('a number on the index takes you to its ticket and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the index lights the ticket in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(index(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the index stays at the top: scrolled to the end, the first ticket is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, index(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a line opens its dish and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await lines(page).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 6);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a ticket with one dish is a ticket with one line', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
});

test('a long dish name stays inside its line without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await lines(page).first().locator('.tk-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines on a phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const line = (await lines(page).first().boundingBox())!;
  const name = (await lines(page).first().locator('.tk-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(line.x + line.width + 1);
  expect(name.y + name.height).toBeLessThanOrEqual(line.y + line.height + 1);
});

test('on a wide screen the tickets hang side by side from the rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const tickets = rail(page).locator('section[data-ticket]');
  const a = (await tickets.nth(0).boundingBox())!;
  const b = (await tickets.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y), 'two tickets share a row').toBeLessThanOrEqual(2);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = rail(page).locator('section[data-ticket]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-ticket', '١');
});

test('in Arabic the page is right to left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => index(p));
});

test('reduced motion removes the ticket entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(lines(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});
