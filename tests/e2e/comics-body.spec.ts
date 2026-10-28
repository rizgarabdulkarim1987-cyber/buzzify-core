import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectFocusRingShows, expectJumpsTo, expectOpensProduct, expectQuickAdd, expectStripStays, openMenu, shapeChecks } from './helpers/body-menu';

/**
 * The Kitchen Comics body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a comic page, a dense
 * panel grid with a wide splash first, the photo as the panel art, the name in a speech bubble, the price in a burst,
 * and a sticky strip of page chips that jumps. Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('cmc');
const arabSlug = menus.slug('cmcar');

test.beforeAll(async () => {
  await menus.create(slug, 'comics', { templateId: 'the-kitchen-comics', layout: { body: 'comics', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'comics', { templateId: 'the-kitchen-comics', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const comic = (page: Page) => page.locator('[data-body="comics"]');
const chips = (page: Page) => comic(page).locator('[data-pages]');
const panels = (page: Page) => comic(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows several panels with photos and prices, and every page is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(comic(page)).toBeVisible();
  // The demo card is demo data (the thumbnail script hides it too); the first screen is measured without it.
  await page.addStyleTag({ content: '.tpl-promo { display: none !important; }' });
  await expectFirstScreen(page, panels(page), { min: 4 });
  await expectEverySectionReachable(chips(page));
});

test('a page opens with a wide splash panel, the others are smaller and sit side by side', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie [data-row]');
  expect(await first.count()).toBe(3);
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await first.nth(i).boundingBox())!));
  expect(a!.width, 'the splash spans the page').toBeGreaterThan(b!.width * 1.8);
  expect(Math.abs(b!.y - c!.y), 'the next two share a row').toBeLessThanOrEqual(2);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
});

test('the name is in a speech bubble and the price in a yellow box, both on the panel and solid', async ({ page }) => {
  await openMenu(page, slug);
  const panel = page.locator('#cat-viennoiserie [data-row]').nth(1);
  const box = (await panel.boundingBox())!;
  const bubble = panel.locator('.cm-bubble');
  const burst = panel.locator('.cm-burst');
  const bb = (await bubble.boundingBox())!;
  const pb = (await burst.boundingBox())!;
  expect(bb.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(bb.x + bb.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(pb.x + pb.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(pb.y + pb.height).toBeLessThanOrEqual(box.y + box.height + 1);
  await expect(bubble).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(burst).toHaveCSS('background-color', 'rgb(255, 222, 33)');
});

test('every section is a comic page with its number and panel count', async ({ page }) => {
  await openMenu(page, slug);
  const sections = comic(page).locator('section[data-page]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first()).toHaveAttribute('data-page', '1');
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(comic(page).locator('#cat-bread [data-count]')).toHaveText('1');
});

test('keyboard focus rings show in full: a whole panel and its add star', async ({ page }) => {
  await openMenu(page, slug);
  const panel = panels(page).first();
  const name = panel.locator('.cm-name');
  await name.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(name).toBeFocused();
  await expectFocusRingShows(page, panel, { outset: 6, pseudo: '::after' });
  await page.keyboard.press('Tab');
  const add = panel.locator('.cm-add');
  await expect(add).toBeFocused();
  await expectFocusRingShows(page, add, { outset: 2 });
});

test('the price in the burst is at least 12px', async ({ page }) => {
  await openMenu(page, slug);
  expect(parseFloat(await panels(page).nth(1).locator('.cm-burst').evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
});

test('a chip on the strip takes you to its page and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the strip lights the page in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chips(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first page is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, chips(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a panel opens its dish and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await panels(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a page with one panel is a splash panel alone', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  const only = page.locator('#cat-bread [data-row]');
  await expect(only).toHaveCount(1);
  const grid = (await page.locator('#cat-bread .cm-page').boundingBox())!;
  expect((await only.boundingBox())!.width).toBeGreaterThanOrEqual(grid.width - 1);
});

test('a long dish name stays inside its bubble and panel without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await panels(page).nth(1).locator('.cm-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const panel = (await panels(page).nth(1).boundingBox())!;
  const bubble = (await panels(page).nth(1).locator('.cm-bubble').boundingBox())!;
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  expect(bubble.y + bubble.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
});

test('on a wide screen the panels run more across', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const first = page.locator('#cat-viennoiserie [data-row]');
  const b = (await first.nth(1).boundingBox())!;
  const c = (await first.nth(2).boundingBox())!;
  expect(Math.abs(b.y - c.y)).toBeLessThanOrEqual(2);
  expect(b.width).toBeLessThan(260);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = comic(page).locator('section[data-page]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-page', '١');
});

test('in Arabic the page is right to left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
});

test('reduced motion removes the panel entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(panels(page).first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

shapeChecks(menus, { kind: 'comics', templateId: 'the-kitchen-comics', checks: ['contrast', 'sale'] });

/** Colours picked in Customize (a green menu with a pink accent): the comic must follow them. */
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#F5C542', onButton: '#111111' };
const customSlug = menus.slug('cmccol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'comics', { templateId: 'the-kitchen-comics', colors: CUSTOM });
});
const rgbOf = (node: ReturnType<Page['locator']>, property: string) =>
  node.evaluate((element, name) => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    context.fillStyle = getComputedStyle(element).getPropertyValue(name);
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r!, g!, b!];
  }, property);
const near = (actual: number[], hex: string, message: string) =>
  [1, 3, 5].forEach((at, i) => expect(Math.abs(actual[i]! - parseInt(hex.slice(at, at + 2), 16)), `${message}: channel ${i}`).toBeLessThanOrEqual(3));

test('Customize colours reach the comic: caption and price box (button), balloon (raised), border (text)', async ({ page }) => {
  await openMenu(page, customSlug);
  const sheet = page.locator('#cat-viennoiserie');
  near(await rgbOf(sheet.locator('.cm-caption'), 'background-color'), CUSTOM.button, 'caption');
  near(await rgbOf(sheet.locator('.cm-burst').first(), 'background-color'), CUSTOM.button, 'price box');
  near(await rgbOf(sheet.locator('.cm-bubble').first(), 'background-color'), CUSTOM.raised, 'balloon');
  near(await rgbOf(sheet.locator('.cm-panel').first(), 'border-top-color'), CUSTOM.text, 'panel border');
});

test('the price is a small box that leaves the art free: it covers under a fifth of a panel', async ({ page }) => {
  await openMenu(page, slug);
  const panel = (await panels(page).nth(1).boundingBox())!;
  const price = (await panels(page).nth(1).locator('.cm-burst').boundingBox())!;
  expect((price.width * price.height) / (panel.width * panel.height)).toBeLessThan(0.2);
});
