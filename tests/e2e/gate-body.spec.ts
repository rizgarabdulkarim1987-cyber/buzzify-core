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
 * The Ishtar Gate body (poster themed-bab): the featured dish stands in the GATE at the top, its photo in a tall arched
 * frame edged in gold with two door leaves that part once, its name, price and add beside it. A band of gold rosettes,
 * then a sticky strip of square gold-edged tabs that jumps to a section; every section is a centred heading over a
 * three-column grid of arched relief cards (lapis, gold edge, round-arched photo, name, gold price and add). The cards of
 * a section drop in once, the first time it comes into view. Colours come from the palette (Customize), the sale shows a
 * struck old price and a -NN% chip.
 */

const menus = bodyMenus();
const slug = menus.slug('gt');
const promoSlug = menus.slug('gtoffer');
const arabSlug = menus.slug('gtar');
const manySlug = menus.slug('gtmany');
const offSlug = menus.slug('gtoff');
const bareSlug = menus.slug('gtbare');
const customSlug = menus.slug('gtcustom');
const crowdSlug = menus.slug('gtcrowd');
// A light menu with a pale yellow accent (Customize): the brick and the gold follow the palette, text stays readable.
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`gtbare-${id}`);
const alternatives = paletteIdsOf('the-ishtar-gate').slice(1);

test.beforeAll(async () => {
  await menus.create(slug, 'gt', { templateId: 'the-ishtar-gate' });
  await menus.create(promoSlug, 'gt', { templateId: 'the-ishtar-gate', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'gt', { templateId: 'the-ishtar-gate', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'gt', { templateId: 'the-ishtar-gate', extraSections: 20 });
  await menus.create(offSlug, 'gt', { templateId: 'the-ishtar-gate', ordering: 'none' });
  await menus.create(crowdSlug, 'gt', { templateId: 'the-ishtar-gate', crowd: 3 });
  await menus.create(bareSlug, 'gt', { templateId: 'the-ishtar-gate', noPhotos: true });
  await menus.create(customSlug, 'gt', { templateId: 'the-ishtar-gate', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'st', { templateId: 'the-ishtar-gate', paletteId: id, noPhotos: true });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="gate"]');
const strip = (page: Page) => body(page).locator('[data-gates]');
const tiles = (page: Page) => body(page).locator('[data-row]');
const tileOf = (page: Page, productSlug: string) => tiles(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const moduleOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const hero = (page: Page) => body(page).locator('[data-hero]');

test('on a phone the gate dish and at least three more dishes show with photos and prices, with the strip and the search on the first screen', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 3 });
  await expect(hero(page).locator('img, svg').first()).toBeVisible();
  await expect(hero(page).locator('.gt-price')).toContainText('$');
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expect(strip(page)).toBeInViewport();
  await expectEverySectionReachable(strip(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('in a section of six dishes the gate dish and three more fill the first screen with photos and prices', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await expectFirstScreen(page, tiles(page), { min: 4 });
});

test('with the offers banner above the menu the first screen still shows the gate dish', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 1 });
});

test('the gate holds the featured dish: a tall arched photo (bigger than a card photo) edged in gold with two door leaves, its price, its add and its sale cue; the whole cell opens the dish; no dish is shown twice', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(hero(page)).toHaveCount(1);
  await expect(body(page).locator('[data-row]').filter({ hasText: dishName('croissant') })).toHaveCount(1);
  await expect(hero(page).locator('.gt-hero-name .sr-only')).toHaveText('Featured: ');
  await expect(hero(page).locator('.gt-price')).toContainText('$');
  await expect(hero(page).locator('.gt-add')).toBeVisible();
  await expect(hero(page).locator('.tpl-photo-off')).toHaveText(/20/);
  await expect(hero(page).locator('.tpl-was > [aria-hidden]')).toBeVisible();
  await expect(hero(page).locator('.gt-leaf')).toHaveCount(2);
  const arch = hero(page).locator('.gt-arch');
  const frame = await arch.evaluate((node) => ({ top: getComputedStyle(node).borderTopLeftRadius, foot: getComputedStyle(node).borderBottomLeftRadius, edge: getComputedStyle(node).borderTopColor }));
  expect(parseFloat(frame.top)).toBeGreaterThan(30);
  expect(parseFloat(frame.foot)).toBe(0);
  expectColourNear(frame.edge, 'rgb(225, 182, 74)');
  const [photo, card] = [(await hero(page).locator('[data-photo]').boundingBox())!, (await tileOf(page, 'pain-au-chocolat').locator('[data-photo]').boundingBox())!];
  expect(photo.width).toBeGreaterThan(card.width + 8);
  const cell = (await hero(page).boundingBox())!;
  await page.mouse.click(cell.x + cell.width - 30, cell.y + 10);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
});

test('a search that drops the featured dish takes the gate away and brings it back when cleared', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await expect(hero(page)).toHaveCount(0);
  await search.fill('');
  await expect(hero(page)).toHaveCount(1);
});

test('the strip is a row of square gold-edged tabs with the section NAME, 44px to tap, the one in view filled with gold', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expectColourNear(await chips.nth(1).evaluate((node) => getComputedStyle(node).borderTopColor), 'rgb(225, 182, 74)');
  for (const category of BODY_CATEGORIES) {
    const chip = chipOf(page, category.slug);
    expect(await chip.evaluate((node) => (node as HTMLElement).innerText)).toContain(category.name.en!);
    expect(parseFloat(await chip.locator('.gt-chip-name').evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  expectColourNear(await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(225, 182, 74)');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('a chip takes you to its gate and focuses the heading; the strip stays at the top', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a centred heading with its number and a three-column grid of arched relief cards: lapis, gold edge, round-arched photo, name under it, price and add on a row below', async ({ page }) => {
  await openMenu(page, slug);
  const gate = moduleOf(page, 'patisserie');
  await expect(gate.locator('h2 small')).toHaveText('2');
  const cells = gate.locator('.gt-grid [data-row]');
  await expect(cells).toHaveCount(3);
  const boxes = (await Promise.all([0, 1, 2].map((i) => cells.nth(i).boundingBox()))) as DOMRect[];
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThanOrEqual(1);
  const cell = cells.nth(1);
  const [relief, name, price, add] = [(await cell.locator('.gt-relief').boundingBox())!, (await cell.locator('.gt-name').boundingBox())!, (await cell.locator('.gt-price').boundingBox())!, (await cell.locator('.gt-add').boundingBox())!];
  expect(Math.abs(relief.width - relief.height)).toBeLessThanOrEqual(1);
  expect(relief.width).toBeGreaterThanOrEqual(96);
  expect(name.y).toBeGreaterThanOrEqual(relief.y + relief.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(add.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  const shape = await cell.evaluate((node) => {
    const photo = getComputedStyle(node.querySelector('[data-photo]')!);
    const card = getComputedStyle(node);
    return { cardTop: card.borderTopLeftRadius, cardFoot: card.borderBottomLeftRadius, cardEdge: card.borderTopColor, cardBg: card.backgroundColor, photoTop: photo.borderTopLeftRadius, photoFoot: photo.borderBottomLeftRadius };
  });
  expect(parseFloat(shape.cardTop)).toBeGreaterThan(40);
  expect(parseFloat(shape.cardFoot)).toBe(0);
  expect(parseFloat(shape.photoTop)).toBeGreaterThan(40);
  expect(parseFloat(shape.photoFoot)).toBe(0);
  expectColourNear(shape.cardEdge, 'rgb(225, 182, 74)');
  expectColourNear(shape.cardBg, 'rgb(29, 75, 155)');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('names never break inside a word on the first screen, in English and in Arabic', async ({ page }) => {
  for (const locale of ['en', 'ar']) {
    await openMenu(page, slug, { locale });
    await expect(tiles(page).first()).toBeVisible();
    await expectWordsWhole(body(page).locator('#cat-viennoiserie .gt-name, .gt-hero-name'));
    await expectWordsWhole(strip(page).locator('.gt-chip-name'));
  }
});

test('the page behind the gates is glazed brick drawn with gradients, from the palette: the poster lapis ground by default', async ({ page }) => {
  await openMenu(page, slug);
  const wall = await body(page).evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, colour: getComputedStyle(node).backgroundColor }));
  expect(wall.image).toContain('linear-gradient');
  expectColourNear(wall.colour, 'rgb(22, 58, 122)');
  const band = await page.locator('.gt-band').evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, edge: getComputedStyle(node).borderTopColor }));
  expect(band.image).toContain('conic-gradient');
  expectColourNear(band.edge, 'rgb(225, 182, 74)');
});

const cardOf = (gate: Locator) => gate.locator('.gt-tile').first();
const lift = (card: Locator) => card.evaluate((node) => ({ opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform }));

test('the door leaves of the gate dish part once and rest open; they never replay', async ({ page }) => {
  await openMenu(page, slug);
  const leaf = hero(page).locator('.gt-leaf').first();
  await expect.poll(() => leaf.evaluate((node) => node.getAnimations().filter((a) => a.playState === 'running').length), { timeout: 5000 }).toBe(0);
  const arch = (await hero(page).locator('.gt-arch').boundingBox())!;
  const at = (await leaf.boundingBox())!;
  // Parted: the leaf lies outside its half of the arch.
  expect(at.x + at.width <= arch.x + 6 || at.x >= arch.x + arch.width - 6).toBe(true);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await search.fill('');
  await expect(hero(page)).toHaveCount(1);
  await expect(hero(page)).toHaveAttribute('data-opened', '');
  expect(await hero(page).locator('.gt-leaf').first().evaluate((node) => node.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
});

test('the cards of a section below the first screen wait above their place until it comes into view, then drop in about half a second, once', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(body(page)).toHaveAttribute('data-armed', '');
  await expect(far).not.toHaveAttribute('data-open', '');
  expect((await lift(cardOf(far))).opacity).toBe('0');
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  expect(await cardOf(far).evaluate((node) => getComputedStyle(node).transitionDuration)).toContain('0.5s');
  await expect.poll(() => lift(cardOf(far)), { timeout: 5000 }).toEqual({ opacity: '1', transform: 'none' });
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await search.fill('');
  await expect(far).toHaveAttribute('data-open', '');
  expect(await lift(cardOf(far))).toEqual({ opacity: '1', transform: 'none' });
});

test('the first screen is never shown waiting: the cards of the first section are in place at once', async ({ page }) => {
  await openMenu(page, slug);
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  expect((await lift(cardOf(moduleOf(page, 'viennoiserie')))).opacity).toBe('1');
});

test('the cards never stay hidden: with an observer that never reports, a section still shows when it is scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(moduleOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect.poll(() => lift(cardOf(moduleOf(page, 'bread'))), { timeout: 5000 }).toEqual({ opacity: '1', transform: 'none' });
  await expect(tileOf(page, 'sourdough').locator('.gt-name')).toBeVisible();
});

test('keyboard focus inside a section whose cards are waiting shows them at once', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.locator('.gt-name').first().focus();
  await expect.poll(() => lift(cardOf(far)), { timeout: 5000 }).toEqual({ opacity: '1', transform: 'none' });
});

test('less motion: nothing is armed, the cards are simply there and the doors are simply open', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  const far = moduleOf(page, 'bread');
  await far.scrollIntoViewIfNeeded();
  expect(await lift(cardOf(far))).toEqual({ opacity: '1', transform: 'none' });
  expect(await cardOf(far).evaluate((node) => getComputedStyle(node).transitionDuration)).toBe('0s');
  expect(await hero(page).locator('.gt-leaf').first().evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('every motion in the shape ends within five seconds; nothing loops', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  const running = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(running).toBe(0);
  await expectMotionEnds(body(page));
});

test('in Arabic the leaves part towards their own sides (mirrored) and the gate stays inside the screen', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  await expect.poll(() => hero(page).locator('.gt-leaf').first().evaluate((node) => node.getAnimations().filter((a) => a.playState === 'running').length), { timeout: 5000 }).toBe(0);
  const [arch, start, end] = [(await hero(page).locator('.gt-arch').boundingBox())!, (await hero(page).locator('.gt-leaf-s').boundingBox())!, (await hero(page).locator('.gt-leaf-e').boundingBox())!];
  // In RTL the start leaf is on the right and leaves to the right; the end leaf leaves to the left.
  expect(start.x).toBeGreaterThanOrEqual(arch.x + arch.width - 6);
  expect(end.x + end.width).toBeLessThanOrEqual(arch.x + 6);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its cell and opens from its name, and tapping the photo opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .gt-grid');
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
  await expect(body(page).locator('.gt-add')).toHaveCount(0);
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
    await expect(row.nth(index).locator('.gt-name')).toBeVisible();
    await expect(row.nth(index).locator('.gt-price')).toContainText('$');
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

test('a menu of twenty-five sections keeps every gate one tap away on a scrolling strip that keeps the lit tab in view', async ({ page }) => {
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
  await pane.locator('.gt-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await pane.locator('.gt-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await pane.boundingBox())!;
  for (const part of ['.gt-price', '.gt-name', '.gt-add', '.gt-relief']) {
    const at = (await pane.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('on a wide screen the grid is three portholes to a row, bigger, in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-patisserie [data-row]');
  await row.first().scrollIntoViewIfNeeded();
  // The cards drop in one after the other: measure once they rest.
  await expect.poll(async () => Math.abs((await row.nth(0).boundingBox())!.y - (await row.nth(1).boundingBox())!.y), { timeout: 5000 }).toBeLessThanOrEqual(1);
  const a = (await row.nth(0).boundingBox())!;
  expect(a.x).toBeGreaterThan(100);
  expect((await row.nth(1).locator('.gt-relief').boundingBox())!.width).toBeGreaterThanOrEqual(150);
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

test('colours picked in Customize reach the gate: the brick ground, the gold rim and the text follow the palette', async ({ page }) => {
  const paint = async (menuSlug: string) => {
    await openMenu(page, menuSlug);
    const style = (selector: string, property: 'backgroundColor' | 'color') => (selector ? body(page).locator(selector).first() : body(page)).evaluate((node, p) => getComputedStyle(node)[p as 'color'], property);
    const rim = (selector: string) => body(page).locator(selector).first().evaluate((node) => getComputedStyle(node).borderTopColor);
    return { ground: await style('', 'backgroundColor'), band: await rim('.gt-band'), card: await rim('.gt-tile'), ink: await style('.gt-title', 'color') };
  };
  const signature = await paint(slug);
  const custom = await paint(customSlug);
  expect(signature).toMatchObject({ ground: 'rgb(22, 58, 122)', band: 'rgb(225, 182, 74)', card: 'rgb(225, 182, 74)', ink: 'rgb(255, 243, 196)' });
  expect(custom).toEqual({ ground: 'rgb(244, 244, 244)', band: 'rgb(255, 224, 102)', card: 'rgb(255, 224, 102)', ink: 'rgb(27, 16, 48)' });
});

test('a dish on sale shows a -NN% chip in the menu numerals on its porthole rim and the old price struck, inside the cell and clear of the add', async ({ page }) => {
  await openMenu(page, arabSlug);
  const pane = hero(page);
  const chip = pane.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(pane.locator('.tpl-was > [aria-hidden]')).toBeVisible();
  const box = (await pane.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await pane.locator('.gt-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.y + at.height <= add.y + 1 || at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await pane.locator('.gt-price .sr-only').count()).toBeGreaterThan(0);
});

test('the add button is at least 40px square and inside its cell, in the grid and on the gate dish', async ({ page }) => {
  await openMenu(page, arabSlug);
  for (const row of [hero(page), tiles(page).nth(1)]) {
    const add = (await row.locator('.gt-add').boundingBox())!;
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    const pane = (await row.boundingBox())!;
    expect(add.x).toBeGreaterThanOrEqual(pane.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
    expect(add.y + add.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
  }
});

shapeChecks(menus, {
  kind: 'gate',
  templateId: 'the-ishtar-gate',
  checks: ['focus', 'contrast', 'sale'],
  entry: (page, categorySlug) => chipOf(page, categorySlug),
  card: (page, productSlug) => tileOf(page, productSlug).first(),
});
