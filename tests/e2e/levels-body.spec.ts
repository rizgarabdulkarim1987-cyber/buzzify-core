import { expect, test, type Locator, type Page } from '@playwright/test';
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
 * The Game Levels body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a world with a banner (its
 * number, name and dish count) in its own hue, every dish a big round level medallion on a dotted road that winds from edge
 * to edge, a name-and-price card beside it, and a sticky strip of worlds that jumps.
 */

const menus = bodyMenus();
const slug = menus.slug('lvl');
const arabSlug = menus.slug('lvlar');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-game-levels').slice(1);
const paletteSlug = (id: string) => menus.slug(`lvl-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'levels', { templateId: 'the-game-levels' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'levels', { templateId: 'the-game-levels', numeralSystem: 'ARAB', discount: ['croissant'] });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'levels', { templateId: 'the-game-levels', paletteId: id });
});
test.afterAll(() => menus.remove());

const game = (page: Page) => page.locator('[data-body="levels"]');
const strip = (page: Page) => game(page).locator('[data-worlds]');
const nodes = (page: Page) => game(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least four level medallions with photos, prices and names, and every world is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(game(page)).toBeVisible();
  await expectFirstScreen(page, nodes(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
});

test('every section is a world with its number, name and dish count in a banner, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const worlds = game(page).locator('section[data-world]');
  expect(await worlds.count()).toBe(BODY_CATEGORIES.length);
  await expect(worlds.first()).toHaveAttribute('data-world', '1');
  await expect(worlds.first().locator('[data-count]')).toHaveText('3');
  await expect(game(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = worlds.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('World 1');
});

test('the road winds: one level a row, the medallion round with the price and name on a card beside it, the road drawn behind', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  expect(await cells.count()).toBe(3);
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).locator('[data-photo]').boundingBox())!));
  expect(b.y, 'a row each').toBeGreaterThan(a.y + a.height - 1);
  expect(c.y).toBeGreaterThan(b.y + b.height - 1);
  // The road winds: the middle level is nearer the page centre than the first (RTL starts at the right edge).
  const mid = page.viewportSize()!.width / 2;
  expect(Math.abs(b.x + b.width / 2 - mid)).toBeLessThan(Math.abs(a.x + a.width / 2 - mid));
  expect(a.width, 'a big medallion').toBeGreaterThanOrEqual(60);
  expect(Math.abs(a.width - a.height)).toBeLessThanOrEqual(1);
  await expect(cells.first().locator('[data-photo]')).toHaveCSS('border-radius', '50%');
  const card = (await cells.first().locator('.lv-card').boundingBox())!;
  const pill = (await cells.first().locator('.lv-pill').boundingBox())!;
  expect(pill.x).toBeGreaterThanOrEqual(card.x - 1);
  expect(pill.x + pill.width).toBeLessThanOrEqual(card.x + card.width + 1);
  const first = (await cells.first().boundingBox())!;
  expect(card.x + card.width <= first.x + first.width + 1 && Math.abs(card.x - a.x) > 20, 'the card sits beside the photo').toBe(true);
});

test('the road is drawn: a dotted line and a band behind the medallions, in palette colours', async ({ page }) => {
  await openMenu(page, slug);
  const road = page.locator('#cat-viennoiserie .lv-road');
  for (const pseudo of ['::before', '::after']) {
    const mask = await road.evaluate((node, which) => getComputedStyle(node, which).maskImage || getComputedStyle(node, which).webkitMaskImage, pseudo);
    expect(mask, pseudo).not.toBe('none');
  }
  const dots = await road.evaluate((node) => getComputedStyle(node, '::after').backgroundColor);
  const text = await road.evaluate((node) => getComputedStyle(node).color);
  expect(dots).toBe(text);
});

test('every world has its hue band and stars sit over the medallions', async ({ page }) => {
  await openMenu(page, slug);
  const bg = await page.locator('#cat-viennoiserie').evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(bg).toContain('gradient');
  const stars = await nodes(page).first().locator('.lv-disc').evaluate((node) => getComputedStyle(node, '::after').content);
  expect(stars).toContain('★');
});

test('a world on the strip takes you to it and focuses the banner', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the strip lights the world in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first world is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a level opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await nodes(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the node without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = nodes(page).first();
  await cell.locator('.lv-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.lv-pill').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.lv-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const pill = (await cell.locator('.lv-pill').boundingBox())!;
  expect(pill.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(pill.x + pill.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('the level badge counts the dishes of the world', async ({ page }) => {
  await openMenu(page, slug);
  await expect(nodes(page).first().locator('.lv-level')).toHaveText('1');
  await expect(nodes(page).nth(2).locator('.lv-level')).toHaveText('3');
});

test('on a wide screen the road stays a tidy column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const road = (await page.locator('#cat-viennoiserie .lv-road').boundingBox())!;
  expect(road.width).toBeLessThanOrEqual(24 * 16 + 1);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = game(page).locator('section[data-world]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-world', '١');
  await expect(first.locator('.lv-level').first()).toHaveText('١');
});

test('in Arabic the page is right to left, the road mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const c = (await cells.nth(2).boundingBox())!;
  // The road starts at the right edge and ends at the left one.
  expect(a.x).toBeGreaterThan(c.x);
});

test('reduced motion removes the node entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(nodes(page).first()).toHaveCSS('animation-name', 'none');
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
    await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
    const island = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'world number 1': strip(page).locator('.lv-number').nth(0),
      'world number 2': strip(page).locator('.lv-number').nth(1),
      'world number 3': strip(page).locator('.lv-number').nth(2),
      'world number 4': strip(page).locator('.lv-number').nth(3),
      'world number 5': strip(page).locator('.lv-number').nth(4),
      'unlit world chip': strip(page).locator('.lv-world-chip:not([aria-current="true"])').first(),
      'lit world chip': strip(page).locator('[aria-current="true"]'),
      'banner': island.locator('.lv-banner'),
      'name card': island.locator('.lv-card').first(),
      'world label': island.locator('.lv-banner small'),
      'dish count': island.locator('.lv-banner b'),
      'level badge': island.locator('.lv-level').first(),
      'price on its card': island.locator('.lv-card').first(),
      'add button': island.locator('.lv-add').first(),
    });
    const green = page.locator('#cat-celebration');
    await expectReadable(menu, { 'world label on green': green.locator('.lv-banner small'), 'level badge on green': green.locator('.lv-level').first() });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole node and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = nodes(page).first();
    const name = cell.locator('.lv-name');
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

test('a dish on sale shows a −NN% chip in the menu numerals on its node, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = nodes(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(game(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});

/** Colours picked in Customize (a green menu with a pink accent): every surface of the shape must follow them. */
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('levcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'levels', { templateId: 'the-game-levels', colors: CUSTOM });
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

test('Customize colours reach the levels: banner, card and rings follow the palette', async ({ page }) => {
  await openMenu(page, customSlug);
  const world = page.locator('[data-body="levels"] .lv-world').first();
  expectNear(await rgbOf(world.locator('.lv-banner'), 'background-color'), CUSTOM.accent, 'banner');
  expectNear(await rgbOf(world.locator('.lv-card').first(), 'background-color'), CUSTOM.text, 'name card');
  expectNear(await rgbOf(world.locator('.lv-photo').first(), 'border-top-color'), CUSTOM.text, 'photo ring');
  expectNear(await rgbOf(world.locator('.lv-level').first(), 'border-top-color'), CUSTOM.text, 'level ring');
});
