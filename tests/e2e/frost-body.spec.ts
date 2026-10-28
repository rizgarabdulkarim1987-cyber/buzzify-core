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
 * The Frosted Window body (poster themed-win): the featured dish is in the WINDOW at the top, its photo behind a pane of
 * frost (a canvas) that a first wipe opens and a finger rubs clear, its name, price and add beside it. A sticky strip of
 * translucent pills jumps to a section; every section is a heading over a three-column grid of snow-capped cards (a pale
 * card, a snow cap that drops in once, the photo, the name, the price and the add). Snow drifts down once and stops.
 * Colours come from the palette (Customize), the sale shows a struck old price and a -NN% chip.
 */

const menus = bodyMenus();
const slug = menus.slug('fr');
const promoSlug = menus.slug('froffer');
const arabSlug = menus.slug('frar');
const manySlug = menus.slug('frmany');
const offSlug = menus.slug('froff');
const bareSlug = menus.slug('frbare');
const customSlug = menus.slug('frcustom');
const crowdSlug = menus.slug('frcrowd');
// A light menu with a pale yellow accent (Customize): the page and the cards follow the palette, text stays readable.
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`frbare-${id}`);
const alternatives = paletteIdsOf('the-frosted-window').slice(1);

test.beforeAll(async () => {
  await menus.create(slug, 'fr', { templateId: 'the-frosted-window' });
  await menus.create(promoSlug, 'fr', { templateId: 'the-frosted-window', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'fr', { templateId: 'the-frosted-window', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'fr', { templateId: 'the-frosted-window', extraSections: 20 });
  await menus.create(offSlug, 'fr', { templateId: 'the-frosted-window', ordering: 'none' });
  await menus.create(crowdSlug, 'fr', { templateId: 'the-frosted-window', crowd: 3 });
  await menus.create(bareSlug, 'fr', { templateId: 'the-frosted-window', noPhotos: true });
  await menus.create(customSlug, 'fr', { templateId: 'the-frosted-window', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'st', { templateId: 'the-frosted-window', paletteId: id, noPhotos: true });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="frost"]');
const strip = (page: Page) => body(page).locator('[data-icicles]');
const tiles = (page: Page) => body(page).locator('[data-row]');
const tileOf = (page: Page, productSlug: string) => tiles(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const moduleOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const hero = (page: Page) => body(page).locator('[data-hero]');

test('on a phone the window dish and at least three more dishes show with photos and prices, with the strip and the search on the first screen', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 3 });
  await expect(hero(page).locator('img, svg').first()).toBeVisible();
  await expect(hero(page).locator('.fr-price')).toContainText('$');
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expect(strip(page)).toBeInViewport();
  await expectEverySectionReachable(strip(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('in a section of six dishes the window dish and three more fill the first screen with photos and prices', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await expectFirstScreen(page, tiles(page), { min: 4 });
});

test('with the offers banner above the menu the first screen still shows the window dish', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 1 });
});

test('the window holds the featured dish: its photo behind the frost, its price, its add and its sale cue; the whole cell opens the dish; no dish is shown twice', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(hero(page)).toHaveCount(1);
  await expect(body(page).locator('[data-row]').filter({ hasText: dishName('croissant') })).toHaveCount(1);
  await expect(hero(page).locator('.fr-hero-name .sr-only')).toHaveText('Featured: ');
  await expect(hero(page).locator('.fr-price')).toContainText('$');
  await expect(hero(page).locator('.fr-add')).toBeVisible();
  await expect(hero(page).locator('.tpl-photo-off')).toHaveText(/20/);
  await expect(hero(page).locator('.tpl-was > [aria-hidden]')).toBeVisible();
  await expect(hero(page).locator('.fr-glass img, .fr-glass svg').first()).toBeVisible();
  const [photo, card] = [(await hero(page).locator('[data-photo]').boundingBox())!, (await tileOf(page, 'pain-au-chocolat').locator('[data-photo]').boundingBox())!];
  expect(photo.width).toBeGreaterThan(card.width + 8);
  const cell = (await hero(page).boundingBox())!;
  await page.mouse.click(cell.x + cell.width - 30, cell.y + 10);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
});

test('a search that drops the featured dish takes the window away and brings it back when cleared', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await expect(hero(page)).toHaveCount(0);
  await search.fill('');
  await expect(hero(page)).toHaveCount(1);
});

test('the strip is a row of translucent pills with the section NAME, 44px to tap, the one in view white', async ({ page }) => {
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
    expect(parseFloat(await chip.locator('.fr-chip-name').evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  expectColourNear(await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('a chip takes you to its section and focuses the heading; the strip stays at the top', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a heading with its number and a three-column grid of snow-capped cards: pale card, rounded photo, name under it, price and add on a row below', async ({ page }) => {
  await openMenu(page, slug);
  const section = moduleOf(page, 'patisserie');
  await expect(section.locator('h2 small')).toHaveText('2');
  const cells = section.locator('.fr-grid [data-row]');
  await expect(cells).toHaveCount(3);
  const boxes = (await Promise.all([0, 1, 2].map((i) => cells.nth(i).boundingBox()))) as DOMRect[];
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThanOrEqual(1);
  const cell = cells.nth(1);
  const [shot, name, price, add] = [(await cell.locator('.fr-shot').boundingBox())!, (await cell.locator('.fr-name').boundingBox())!, (await cell.locator('.fr-price').boundingBox())!, (await cell.locator('.fr-add').boundingBox())!];
  expect(shot.width).toBeGreaterThanOrEqual(96);
  expect(name.y).toBeGreaterThanOrEqual(shot.y + shot.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(add.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  const shape = await cell.evaluate((node) => ({ radius: getComputedStyle(node).borderTopLeftRadius, cap: getComputedStyle(node, '::before').backgroundImage, photo: getComputedStyle(node.querySelector('[data-photo]')!).borderTopLeftRadius }));
  expect(parseFloat(shape.radius)).toBeGreaterThanOrEqual(16);
  expect(parseFloat(shape.photo)).toBeGreaterThanOrEqual(10);
  expect(shape.cap).toContain('radial-gradient');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('names never break inside a word on the first screen, in English and in Arabic', async ({ page }) => {
  for (const locale of ['en', 'ar']) {
    await openMenu(page, slug, { locale });
    await expect(tiles(page).first()).toBeVisible();
    await expectWordsWhole(body(page).locator('#cat-viennoiserie .fr-name, .fr-hero-name'));
    await expectWordsWhole(strip(page).locator('.fr-chip-name'));
  }
});

test('the page behind the sections is a gradient from the ground to a lighter blue, from the palette: the poster night blue by default', async ({ page }) => {
  await openMenu(page, slug);
  const sky = await body(page).evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, colour: getComputedStyle(node).color }));
  expect(sky.image).toContain('linear-gradient');
  expect(await body(page).evaluate((node) => getComputedStyle(node, '::before').backgroundImage)).toContain('radial-gradient');
  expectColourNear(sky.colour, 'rgb(255, 255, 255)');
});

const capOf = (section: Locator) => section.locator('.fr-card').first().evaluate((node) => ({ transform: getComputedStyle(node, '::before').transform }));
const folded = /matrix\(1, 0, 0, 0,/;

test('the frost on the window is a canvas over the photo; a first wipe opens it on its own and a drag clears more', async ({ page }) => {
  await openMenu(page, slug);
  const ice = hero(page).locator('canvas.fr-ice');
  await expect(ice).toHaveCount(1);
  expect(await ice.getAttribute('aria-hidden')).toBe('true');
  const alphaAt = (fx: number, fy: number) => ice.evaluate((node, [x, y]) => (node as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round((node as HTMLCanvasElement).width * x!), Math.round((node as HTMLCanvasElement).height * y!), 1, 1).data[3]!, [fx, fy]);
  // The first wipe clears the middle of the pane; a corner stays frosted.
  await expect.poll(() => alphaAt(0.5, 0.5), { timeout: 5000 }).toBeLessThan(60);
  expect(await alphaAt(0.03, 0.03)).toBeGreaterThan(120);
  const box = (await ice.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 14, box.y + 14, { steps: 4 });
  await page.mouse.move(box.x + 30, box.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => alphaAt(0.03, 0.03), { timeout: 3000 }).toBeLessThan(120);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a tap on the frost opens the dish; a drag across it does not', async ({ page }) => {
  await openMenu(page, slug);
  const box = (await hero(page).locator('canvas.fr-ice').boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 12, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the snow cap of each card in a section below the first screen waits folded up until it comes into view, then drops in once', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(body(page)).toHaveAttribute('data-armed', '');
  await expect(far).not.toHaveAttribute('data-open', '');
  expect((await capOf(far)).transform).toMatch(folded);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  await expect.poll(() => capOf(far), { timeout: 5000 }).toEqual({ transform: 'none' });
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await search.fill('');
  await expect(far).toHaveAttribute('data-open', '');
  expect(await capOf(far)).toEqual({ transform: 'none' });
});

test('the first screen is never shown waiting: the caps of the first section are on at once', async ({ page }) => {
  await openMenu(page, slug);
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await expect.poll(() => capOf(moduleOf(page, 'viennoiserie')), { timeout: 5000 }).toEqual({ transform: 'none' });
});

test('the caps never stay folded: with an observer that never reports, a section still shows when it is scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(moduleOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect.poll(() => capOf(moduleOf(page, 'bread')), { timeout: 5000 }).toEqual({ transform: 'none' });
  await expect(tileOf(page, 'sourdough').locator('.fr-name')).toBeVisible();
});

test('keyboard focus inside a section whose caps are folded drops them at once', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.locator('.fr-name').first().focus();
  await expect.poll(() => capOf(far), { timeout: 5000 }).toEqual({ transform: 'none' });
});

test('less motion: nothing is armed, the caps are simply on, the snow rests and the frost is already wiped open', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  const far = moduleOf(page, 'bread');
  await far.scrollIntoViewIfNeeded();
  expect(await capOf(far)).toEqual({ transform: 'none' });
  expect(await body(page).evaluate((node) => getComputedStyle(node, '::before').animationName)).toBe('none');
  const ice = hero(page).locator('canvas.fr-ice');
  expect(await ice.evaluate((node) => (node as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round((node as HTMLCanvasElement).width / 2), Math.round((node as HTMLCanvasElement).height / 2), 1, 1).data[3])).toBeLessThan(60);
});

test('the snow drifts down once and every motion in the shape ends within five seconds; nothing loops', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect(await body(page).evaluate((node) => getComputedStyle(node, '::before').animationIterationCount)).toBe('1');
  const running = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(running).toBe(0);
  await expectMotionEnds(body(page));
});

test('in Arabic the caps drop the same and the section stays inside the screen', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its cell and opens from its name, and tapping the photo opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .fr-grid');
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
  await expect(body(page).locator('.fr-add')).toHaveCount(0);
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
    await expect(row.nth(index).locator('.fr-name')).toBeVisible();
    await expect(row.nth(index).locator('.fr-price')).toContainText('$');
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

test('a menu of twenty-five sections keeps every section one tap away on a scrolling strip that keeps the lit tab in view', async ({ page }) => {
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
  await pane.locator('.fr-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await pane.locator('.fr-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await pane.boundingBox())!;
  for (const part of ['.fr-price', '.fr-name', '.fr-add', '.fr-shot']) {
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
  expect((await row.nth(1).locator('.fr-shot').boundingBox())!.width).toBeGreaterThanOrEqual(150);
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

test('colours picked in Customize reach the window: the card, the strip pill, the add button and the text follow the palette', async ({ page }) => {
  const paint = async (menuSlug: string) => {
    await openMenu(page, menuSlug);
    const style = (selector: string, property: 'backgroundColor' | 'color') => (selector ? body(page).locator(selector).first() : body(page)).evaluate((node, p) => getComputedStyle(node)[p as 'color'], property);
    return { card: await style('.fr-card', 'backgroundColor'), tab: await style('.fr-chip[aria-current="true"]', 'backgroundColor'), add: await style('.fr-card .fr-add', 'backgroundColor'), ink: await style('.fr-title', 'color') };
  };
  const signature = await paint(slug);
  const custom = await paint(customSlug);
  expect(signature).toMatchObject({ tab: 'rgb(255, 255, 255)', add: 'rgb(46, 108, 200)', ink: 'rgb(255, 255, 255)' });
  expect(custom).toMatchObject({ tab: 'rgb(27, 16, 48)', add: 'rgb(255, 224, 102)', ink: 'rgb(27, 16, 48)' });
});

test('a dish on sale shows a -NN% chip in the menu numerals on its porthole rim and the old price struck, inside the cell and clear of the add', async ({ page }) => {
  await openMenu(page, arabSlug);
  const pane = hero(page);
  const chip = pane.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(pane.locator('.tpl-was > [aria-hidden]')).toBeVisible();
  const box = (await pane.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await pane.locator('.fr-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.y + at.height <= add.y + 1 || at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await pane.locator('.fr-price .sr-only').count()).toBeGreaterThan(0);
});

test('the add button is at least 40px square and inside its cell, in the grid and on the window dish', async ({ page }) => {
  await openMenu(page, arabSlug);
  for (const row of [hero(page), tiles(page).nth(1)]) {
    const add = (await row.locator('.fr-add').boundingBox())!;
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    const pane = (await row.boundingBox())!;
    expect(add.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
    expect(add.y + add.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
  }
});

shapeChecks(menus, {
  kind: 'frost',
  templateId: 'the-frosted-window',
  checks: ['focus', 'contrast', 'sale'],
  entry: (page, categorySlug) => chipOf(page, categorySlug),
  card: (page, productSlug) => tileOf(page, productSlug).first(),
});
