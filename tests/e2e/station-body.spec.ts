import { expectColourNear } from './helpers/colour-near';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  dishName,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectJumpsTo,
  expectOpensProduct,
  expectPlatePainted,
  expectQuickAdd,
  expectMotionEnds,
  shapeChecks,
  silenceObserver,
  expectStripStays,
  expectWordsWhole,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Space Station body (poster themed-spc): the featured dish is the PLANET, one big round photo with a dashed orbit
 * ring and a moon, its name, price and add under it. A sticky strip of pill chips (docking tabs) jumps to a section; every
 * section is a deck, a bold heading and a three-column grid of round portholes (steel bezel, the sale chip on its rim),
 * the name under each, the price and the add on a row below. The glass of a deck opens once, the first time it comes into
 * view. Colours come from the palette (Customize), the sale shows a struck old price and a -NN% chip.
 */

const menus = bodyMenus();
const slug = menus.slug('st');
const promoSlug = menus.slug('stoffer');
const arabSlug = menus.slug('star');
const manySlug = menus.slug('stmany');
const offSlug = menus.slug('stoff');
const bareSlug = menus.slug('stbare');
const customSlug = menus.slug('stcustom');
const crowdSlug = menus.slug('stcrowd');
// A light menu with a pale yellow accent (Customize): the starfield and bezels follow the palette, text stays readable.
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`stbare-${id}`);
const alternatives = paletteIdsOf('the-space-station').slice(1);

test.beforeAll(async () => {
  await menus.create(slug, 'st', { templateId: 'the-space-station' });
  await menus.create(promoSlug, 'st', { templateId: 'the-space-station', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'st', { templateId: 'the-space-station', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'st', { templateId: 'the-space-station', extraSections: 20 });
  await menus.create(offSlug, 'st', { templateId: 'the-space-station', ordering: 'none' });
  await menus.create(crowdSlug, 'st', { templateId: 'the-space-station', crowd: 3 });
  await menus.create(bareSlug, 'st', { templateId: 'the-space-station', noPhotos: true });
  await menus.create(customSlug, 'st', { templateId: 'the-space-station', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'st', { templateId: 'the-space-station', paletteId: id, noPhotos: true });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="station"]');
const strip = (page: Page) => body(page).locator('[data-ports]');
const tiles = (page: Page) => body(page).locator('[data-row]');
const tileOf = (page: Page, productSlug: string) => tiles(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const moduleOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const planet = (page: Page) => body(page).locator('[data-planet]');

test('on a phone the planet and at least three more dishes show with photos and prices, with the strip and the search on the first screen', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 3 });
  await expect(planet(page).locator('img, svg').first()).toBeVisible();
  await expect(planet(page).locator('.st-price')).toContainText('$');
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expect(strip(page)).toBeInViewport();
  await expectEverySectionReachable(strip(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('in a section of six dishes the planet and three more fill the first screen with photos and prices', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await expectFirstScreen(page, tiles(page), { min: 4 });
});

test('with the offers banner above the menu the first screen still shows the planet', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 1 });
});

test('the planet is the featured dish: one big round photo (bigger than a porthole) inside a dashed orbit with a moon, its price, its add and its sale cue; the whole cell opens the dish; no dish is shown twice', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(planet(page)).toHaveCount(1);
  await expect(body(page).locator('[data-row]').filter({ hasText: dishName('croissant') })).toHaveCount(1);
  await expect(planet(page).locator('.st-planet-name .sr-only')).toHaveText('Featured: ');
  await expect(planet(page).locator('.st-price')).toContainText('$');
  await expect(planet(page).locator('.st-add')).toBeVisible();
  await expect(planet(page).locator('.tpl-photo-off')).toHaveText(/20/);
  await expect(planet(page).locator('.tpl-was > [aria-hidden]')).toBeVisible();
  const orbit = planet(page).locator('.st-orbit');
  expect(await orbit.evaluate((node) => getComputedStyle(node).borderTopStyle)).toBe('dashed');
  expect(await orbit.evaluate((node) => getComputedStyle(node, '::after').backgroundImage)).toContain('radial-gradient');
  const [photo, port] = [(await planet(page).locator('[data-photo]').boundingBox())!, (await tileOf(page, 'pain-au-chocolat').locator('[data-photo]').boundingBox())!];
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  expect(photo.width).toBeGreaterThan(port.width + 8);
  const cell = (await planet(page).boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + 20);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
});

test('a search that drops the featured dish takes the planet away and brings it back when cleared', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await expect(planet(page)).toHaveCount(0);
  await search.fill('');
  await expect(planet(page)).toHaveCount(1);
});

test('the strip is a row of pill tabs with the section NAME, 44px to tap, the one in view filled with the accent', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await chips.first().evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(20);
  for (const category of BODY_CATEGORIES) {
    const chip = chipOf(page, category.slug);
    expect(await chip.evaluate((node) => (node as HTMLElement).innerText)).toContain(category.name.en!);
    expect(parseFloat(await chip.locator('.st-chip-name').evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  expectColourNear(await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(155, 140, 255)');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('a chip takes you to its deck and focuses the heading; the strip stays at the top', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a deck is a bold heading with its number and a three-column grid of round portholes: steel bezel, round photo, name under it, price and add on a row below', async ({ page }) => {
  await openMenu(page, slug);
  const deck = moduleOf(page, 'patisserie');
  await expect(deck.locator('h2 small')).toHaveText('2');
  const cells = deck.locator('.st-grid [data-row]');
  await expect(cells).toHaveCount(3);
  const boxes = (await Promise.all([0, 1, 2].map((i) => cells.nth(i).boundingBox()))) as DOMRect[];
  // Three to a row, all in one row.
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThanOrEqual(1);
  const cell = cells.nth(1);
  const [bezel, name, price, add] = [(await cell.locator('.st-bezel').boundingBox())!, (await cell.locator('.st-name').boundingBox())!, (await cell.locator('.st-price').boundingBox())!, (await cell.locator('.st-add').boundingBox())!];
  expect(Math.abs(bezel.width - bezel.height)).toBeLessThanOrEqual(1);
  expect(bezel.width).toBeGreaterThanOrEqual(96);
  expect(name.y).toBeGreaterThanOrEqual(bezel.y + bezel.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(add.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  const shape = await cell.evaluate((node) => {
    const photo = node.querySelector('[data-photo]')!;
    const ring = getComputedStyle(node.querySelector('.st-bezel')!);
    return { bezel: ring.backgroundImage, bezelRadius: ring.borderTopLeftRadius, glass: getComputedStyle(photo).borderTopLeftRadius };
  });
  expect(shape.bezel).toContain('conic-gradient');
  expect(shape.bezelRadius).toBe('50%');
  expect(shape.glass).toBe('50%');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('names never break inside a word on the first screen, in English and in Arabic', async ({ page }) => {
  for (const locale of ['en', 'ar']) {
    await openMenu(page, slug, { locale });
    await expect(tiles(page).first()).toBeVisible();
    await expectWordsWhole(body(page).locator('#cat-viennoiserie .st-name, #cat-patisserie .st-name, .st-planet-name'));
    await expectWordsWhole(strip(page).locator('.st-chip-name'));
  }
});

test('the page behind the decks is a starfield drawn with gradients, from the palette: the poster ground by default', async ({ page }) => {
  await openMenu(page, slug);
  const sky = await body(page).evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, colour: getComputedStyle(node).backgroundColor }));
  expect(sky.image).toContain('radial-gradient');
  expectColourNear(sky.colour, 'rgb(7, 5, 26)');
});

const glassOf = (deck: Locator) => deck.locator('.st-glass').first();
const shutter = (glass: Locator) => glass.evaluate((node) => getComputedStyle(node).clipPath);

test('the glass of a deck opens once, when it first comes into view, and never plays again', async ({ page }) => {
  await openMenu(page, slug);
  const deck = moduleOf(page, 'viennoiserie');
  await expect(deck).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(deck)), { timeout: 5000 }).toMatch(/circle\(72%/);
  await expect.poll(() => glassOf(deck).evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await search.fill('');
  await expect(deck).toHaveAttribute('data-open', '');
  expect(await glassOf(deck).evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await shutter(glassOf(deck))).toMatch(/circle\(72%/);
});

test('a deck below the first screen has its glass shuttered until it comes into view, then it opens in about half a second', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(body(page)).toHaveAttribute('data-armed', '');
  await expect(far).not.toHaveAttribute('data-open', '');
  expect(await shutter(glassOf(far))).toMatch(/circle\(0%/);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  expect(await glassOf(far).evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0.45s');
  await expect.poll(() => shutter(glassOf(far)), { timeout: 5000 }).toMatch(/circle\(72%/);
});

test('the shutters never keep the dishes hidden: with an observer that never reports, a deck still opens when it is scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(moduleOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(moduleOf(page, 'bread'))), { timeout: 5000 }).toMatch(/circle\(72%/);
  await expect(tileOf(page, 'sourdough').locator('.st-name')).toBeVisible();
});

test('keyboard focus inside a deck with its glass shuttered opens it at once', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.locator('.st-name').first().focus();
  await expect(far).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(far)), { timeout: 5000 }).toMatch(/circle\(72%/);
});

test('less motion: the glass is simply open, nothing is armed, no transition and no orbit animation run', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  const far = moduleOf(page, 'bread');
  await far.scrollIntoViewIfNeeded();
  expect(await shutter(glassOf(far))).toMatch(/circle\(72%/);
  const times = await body(page).locator('.st-glass').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transitionDuration));
  expect(times.every((time) => time === '0s')).toBe(true);
  expect(await planet(page).locator('.st-orbit').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('the orbit turns once and rests, and every motion in the shape ends within five seconds; nothing loops', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  const running = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(running).toBe(0);
  await expectMotionEnds(body(page));
});

test('in Arabic the glass opens the same and the deck stays inside the screen', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  const deck = moduleOf(page, 'viennoiserie');
  await expect(deck).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(deck)), { timeout: 5000 }).toMatch(/circle\(72%/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its cell and opens from its name, and tapping the photo opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .st-grid');
  await expectOpensProduct(page, first, 'pain-au-chocolat');
  const photo = (await tileOf(page, 'pain-au-chocolat').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('pain-au-chocolat') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'pain-au-chocolat');
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('2');
});

test('ordering off: plain tap-to-open cells, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.st-add')).toHaveCount(0);
  await expectFirstScreen(page, tiles(page), { min: 3 });
  const photo = (await tiles(page).nth(1).locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates and a working add', async ({ page }) => {
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-patisserie [data-row]');
  await expect(row).toHaveCount(3);
  expect(await body(page).locator('[data-photo] img').count()).toBe(0);
  const photo = (await row.nth(1).locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(48);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.st-name')).toBeVisible();
    await expect(row.nth(index).locator('.st-price')).toContainText('$');
  }
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish with no media shows a plate painted in its frame (rings, a ground of its own), in every palette', async ({ page }) => {
  for (const menuSlug of [bareSlug, ...alternatives.map(bareAt)]) {
    await openMenu(page, menuSlug);
    const row = page.locator('#cat-patisserie [data-row]').first();
    await expect(row).toBeVisible();
    await expectPlatePainted(row.locator('[data-photo]'), row);
  }
});

test('a menu of twenty-five sections keeps every deck one tap away on a scrolling strip that keeps the lit tab in view', async ({ page }) => {
  await openMenu(page, manySlug);
  const list = strip(page).locator('ul');
  await expect(strip(page).locator('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  const last = strip(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
});

test('a search that narrows and clears keeps the strip, never moves the focus or the scroll', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(tiles(page).first()).toBeVisible();
  expect(await tiles(page).count()).toBeLessThan(4);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(tiles(page).nth(3)).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('a long dish name and a long price stay inside the cell without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const pane = tiles(page).nth(1);
  await pane.locator('.st-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await pane.locator('.st-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await pane.boundingBox())!;
  for (const part of ['.st-price', '.st-name', '.st-add', '.st-bezel']) {
    const at = (await pane.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('on a wide screen the grid is three portholes to a row, bigger, in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-patisserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeGreaterThan(100);
  expect((await row.nth(1).locator('.st-bezel').boundingBox())!.width).toBeGreaterThanOrEqual(150);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
  await expect(page.locator('#cat-patisserie h2 small')).toHaveText('٢');
});

test('in Arabic the page is right to left, the strip starts at the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const a = (await moduleOf(page, 'patisserie').locator('[data-row]').nth(0).locator('[data-photo]').boundingBox())!;
  const b = (await moduleOf(page, 'patisserie').locator('[data-row]').nth(1).locator('[data-photo]').boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('a search keeps each section its own number (by its place in the full menu)', async ({ page }) => {
  await openMenu(page, slug);
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('sourdough');
  await expect(page.locator('#cat-viennoiserie')).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
});

test('colours picked in Customize reach the station: the starfield ground, the strip tab, the add button and the text follow the palette', async ({ page }) => {
  const paint = async (menuSlug: string) => {
    await openMenu(page, menuSlug);
    const style = (selector: string, property: 'backgroundColor' | 'color') => (selector ? body(page).locator(selector).first() : body(page)).evaluate((node, p) => getComputedStyle(node)[p as 'color'], property);
    return { ground: await style('', 'backgroundColor'), tab: await style('.st-chip[aria-current="true"]', 'backgroundColor'), add: await style('.st-port .st-add', 'backgroundColor'), ink: await style('.st-title', 'color') };
  };
  const signature = await paint(slug);
  const custom = await paint(customSlug);
  expect(signature).toMatchObject({ ground: 'rgb(7, 5, 26)', tab: 'rgb(155, 140, 255)', add: 'rgb(155, 140, 255)', ink: 'rgb(232, 230, 255)' });
  expect(custom).toEqual({ ground: 'rgb(244, 244, 244)', tab: 'rgb(255, 224, 102)', add: 'rgb(255, 224, 102)', ink: 'rgb(27, 16, 48)' });
});

test('a dish on sale shows a -NN% chip in the menu numerals on its porthole rim and the old price struck, inside the cell and clear of the add', async ({ page }) => {
  await openMenu(page, arabSlug);
  const pane = planet(page);
  const chip = pane.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(pane.locator('.tpl-was > [aria-hidden]')).toBeVisible();
  const box = (await pane.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await pane.locator('.st-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.y + at.height <= add.y + 1 || at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await pane.locator('.st-price .sr-only').count()).toBeGreaterThan(0);
});

test('the add button is at least 40px square and inside its cell, in the grid and on the planet', async ({ page }) => {
  await openMenu(page, arabSlug);
  for (const row of [planet(page), tiles(page).nth(1)]) {
    const add = (await row.locator('.st-add').boundingBox())!;
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    const pane = (await row.boundingBox())!;
    expect(add.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
    expect(add.y + add.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
  }
});

shapeChecks(menus, {
  kind: 'station',
  templateId: 'the-space-station',
  checks: ['focus', 'contrast', 'sale'],
  entry: (page, categorySlug) => chipOf(page, categorySlug),
  card: (page, productSlug) => tileOf(page, productSlug).first(),
});
