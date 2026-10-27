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
  expectMotionEnds,
  expectNoPageWiden,
  expectOpensProduct,
  expectPlatePainted,
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  expectWordsWhole,
  openMenu,
  paletteIdsOf,
  silenceObserver,
} from './helpers/body-menu';

/**
 * The Frosted Window body (spec 2026-10-26-menu-styles-in-templates-design.md): the menu is a wall of winter windows. A
 * sticky strip of icicle chips (a pale pill with the number and the section's name, an icicle under it) jumps to a
 * section; every section is its own window pane (frame, rime, night-blue glass crossed by a mullion and glazing bars, a
 * label plate with a fringe of icicles), and the panes stand side by side in a MASONRY of two columns: each drops into
 * the column that frees up first. In a pane the dishes are frost cards one under the other, tall or short. Condensation
 * lies faintly over a pane still below the screen and is wiped away once, when the pane first comes into view.
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
// A light menu with a pale yellow accent (Customize): the shape's own dark fills stay, the lit ring follows the accent.
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`frbare-${id}`);
const alternatives = paletteIdsOf('the-frosted-window').slice(1);
const paletteSlug = (id: string) => menus.slug(`fr-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'fr', { templateId: 'the-frosted-window' });
  await menus.create(promoSlug, 'fr', { templateId: 'the-frosted-window', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'fr', { templateId: 'the-frosted-window', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'fr', { templateId: 'the-frosted-window', extraSections: 20 });
  await menus.create(offSlug, 'fr', { templateId: 'the-frosted-window', ordering: 'none' });
  await menus.create(bareSlug, 'fr', { templateId: 'the-frosted-window', noPhotos: true });
  await menus.create(crowdSlug, 'fr', { templateId: 'the-frosted-window', crowd: 3 });
  await menus.create(customSlug, 'fr', { templateId: 'the-frosted-window', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'fr', { templateId: 'the-frosted-window', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'fr', { templateId: 'the-frosted-window', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="frost"]');
const strip = (page: Page) => body(page).locator('[data-icicles]');
const cards = (page: Page) => body(page).locator('[data-row]');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const paneOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const fogOf = (pane: Locator) => pane.locator('.fr-fog');
const fogState = (pane: Locator) =>
  fogOf(pane).evaluate((node) => ({ visibility: getComputedStyle(node).visibility, opacity: parseFloat(getComputedStyle(node).opacity), shift: new DOMMatrix(getComputedStyle(node).transform).m41 }));

test('on a phone the strip is at most 64px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

test('with the offers banner above the menu the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 2 });
});

test('the strip is a row of icicle chips: a pale pill, 44px tall, with the number AND the section name visible, and an icicle hanging under it', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(chips.first().locator('.fr-chip-no')).toHaveText('1');
  await expect(chips.nth(2).locator('.fr-chip-no')).toHaveText('3');
  for (const category of BODY_CATEGORIES) {
    const label = chipOf(page, category.slug).locator('.fr-chip-name');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(category.name.en!);
    expect(parseFloat(await label.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  const icicle = await chips.nth(1).evaluate((node) => ({ content: getComputedStyle(node, '::after').content, clip: getComputedStyle(node, '::after').clipPath, below: getComputedStyle(node, '::after').insetBlockEnd }));
  expect(icicle.content).not.toBe('none');
  expect(icicle.clip).toContain('polygon');
  expect(parseFloat(icicle.below)).toBeLessThan(0);
  expect(await chips.nth(1).evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(220, 235, 248)');
});

test('the chip of the section in view is lit (dark, ringed) and the others are not', async ({ page }) => {
  await openMenu(page, slug);
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(chipOf(page, 'viennoiserie').locator('[data-pane]')).toHaveAttribute('data-pane', 'active');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => chipOf(page, 'bread').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(10, 26, 51)');
  expect(await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(220, 235, 248)');
});

test('a chip takes you to its pane and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first pane is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a window pane: a pale frame, night-blue glass crossed by a mullion, and a label plate with the number, the name, the count and a fringe of icicles', async ({ page }) => {
  await openMenu(page, slug);
  const pane = paneOf(page, 'viennoiserie');
  const title = pane.locator('h2');
  await expect(title.locator('small')).toHaveText('1');
  await expect(title.locator('b')).toHaveText('3');
  const frame = await pane.evaluate((node) => {
    const style = getComputedStyle(node);
    return { width: parseFloat(style.borderTopWidth), edge: style.borderTopColor, glass: style.backgroundColor, image: style.backgroundImage };
  });
  expect(frame.width).toBeGreaterThanOrEqual(4);
  expect(frame.edge).toBe('rgb(220, 235, 248)');
  expect(frame.glass).toBe('rgb(22, 41, 77)');
  expect(frame.image).toContain('gradient');
  // The plate is a solid pale pill; its icicle fringe is drawn on a pseudo-element (never behind the text).
  expect(await title.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  expect(await title.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(220, 235, 248)');
  expect(await title.evaluate((node) => getComputedStyle(node, '::after').backgroundImage)).toContain('conic-gradient');
  // A glazing bar of the frame crosses the glass in the gap above every card after the first.
  const bar = await pane.locator('[data-row]').nth(1).evaluate((node) => ({ content: getComputedStyle(node, '::after').content, colour: getComputedStyle(node, '::after').backgroundColor }));
  expect(bar.content).not.toBe('none');
  expect(bar.colour).toBe('rgb(220, 235, 248)');
  await expect(pane.locator('[data-row]')).toHaveCount(3);
});

test('the panes stand side by side in a masonry of two columns: the first two at the top, and the next drops into the column that frees up first, not into a row', async ({ page }) => {
  await openMenu(page, crowdSlug);
  // The wall is packed once the script has measured the panes.
  await expect(page.locator('main#menu')).toHaveAttribute('data-packed', '');
  await expect.poll(async () => Math.abs((await paneOf(page, 'celebration').boundingBox())!.x - (await paneOf(page, 'patisserie').boundingBox())!.x)).toBeLessThanOrEqual(1);
  const [one, two, three, four] = await Promise.all(['viennoiserie', 'patisserie', 'celebration', 'boxes'].map(async (categorySlug) => (await paneOf(page, categorySlug).boundingBox())!));
  // Two columns of the same width, side by side, the first two panes at the top.
  expect(Math.abs(one!.y - two!.y)).toBeLessThanOrEqual(1);
  expect(two!.x).toBeGreaterThan(one!.x + one!.width - 1);
  expect(Math.abs(one!.width - two!.width)).toBeLessThanOrEqual(1);
  expect(one!.width).toBeLessThan(200);
  // The first pane holds six dishes, so it is the taller; the third drops under the second, beside the first.
  expect(one!.height).toBeGreaterThan(two!.height + 100);
  expect(Math.abs(three!.x - two!.x)).toBeLessThanOrEqual(1);
  expect(three!.y).toBeLessThan(one!.y + one!.height);
  expect(three!.y).toBeGreaterThan(two!.y + two!.height - 1);
  expect(four).toBeTruthy();
  // The last pane lies across the whole wall.
  const last = (await paneOf(page, 'bread').boundingBox())!;
  expect(last.width).toBeGreaterThan(one!.width * 2);
  await expectNoPageWiden(page);
});

test('the ground behind the panes is night blue, whatever the palette', async ({ page }) => {
  await openMenu(page, slug);
  const sky = await body(page).evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, colour: getComputedStyle(node).backgroundColor }));
  expect(sky.image).toContain('gradient');
  expect(sky.colour).toBe('rgb(11, 23, 48)');
});

test('in a pane the dishes are frost cards one under the other, tall and short: every third (from the second) has a photo at least 40% taller; the price above the name, a solid card with rime on its top edge', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  expect(await row.count()).toBe(3);
  const boxes = (await Promise.all([0, 1, 2].map((i) => row.nth(i).boundingBox()))) as DOMRect[];
  const photos = (await Promise.all([0, 1, 2].map((i) => row.nth(i).locator('[data-photo]').boundingBox()))) as DOMRect[];
  // One column: each card under the one before, as wide as it.
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
  expect(Math.abs(boxes[0]!.x - boxes[1]!.x)).toBeLessThanOrEqual(1);
  // Short, tall, short: the tall photo is at least 40% taller.
  expect(photos[1]!.height).toBeGreaterThanOrEqual(photos[0]!.height * 1.4);
  expect(Math.abs(photos[0]!.height - photos[2]!.height)).toBeLessThanOrEqual(1);
  await expect(row.nth(1)).toHaveClass(/fr-tall/);
  // The price is above the name.
  const [price, name] = [(await row.first().locator('.fr-price').boundingBox())!, (await row.first().locator('.fr-name').boundingBox())!];
  expect(price.y).toBeLessThan(name.y);
  const style = await row.first().evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, radius: parseFloat(getComputedStyle(node).borderTopLeftRadius), rime: getComputedStyle(node, '::before').backgroundImage }));
  expect(style.bg).toBe('rgb(242, 248, 255)');
  expect(style.image).toBe('none');
  expect(style.radius).toBeGreaterThanOrEqual(10);
  expect(style.rime).toContain('radial-gradient');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a search never resizes a card: a dish keeps its tall or short photo by its place in the full section', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('Pain au');
  // Pain au chocolat is now the first card of its section (or near it), yet keeps its tall photo.
  await expect.poll(() => cards(page).count()).toBeLessThan(4);
  await expect(cardOf(page, 'pain-au-chocolat')).toHaveClass(/fr-tall/);
  await search.fill('');
  await expect(cardOf(page, 'pain-au-chocolat')).toHaveClass(/fr-tall/);
});

test('names never break inside a word on the first screen, in English and in Arabic', async ({ page }) => {
  for (const locale of ['en', 'ar']) {
    await openMenu(page, slug, { locale });
    await expect(cards(page).first()).toBeVisible();
    await expectWordsWhole(body(page).locator('#cat-viennoiserie :is(.fr-name, h2 > span), #cat-patisserie :is(.fr-name, h2 > span)'));
    await expectWordsWhole(strip(page).locator('.fr-chip-name'));
  }
});

test('the name and the price sit on the solid card, each in its own ink', async ({ page }) => {
  await openMenu(page, slug);
  const card = cardOf(page, 'croissant');
  expect(await card.locator('.fr-price').evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  expect(await card.locator('.fr-name').evaluate((node) => getComputedStyle(node).color)).toBe('rgb(12, 31, 58)');
  expect(await card.locator('.fr-price').evaluate((node) => getComputedStyle(node).color)).toBe('rgb(11, 47, 94)');
});

test('condensation lies faintly over a pane below the screen, never over 30%, and a wipe clears it once when the pane first comes into view', async ({ page }) => {
  await openMenu(page, slug);
  const far = paneOf(page, 'bread');
  await expect(body(page)).toHaveAttribute('data-armed', '');
  await expect(far).not.toHaveAttribute('data-open', '');
  const before = await fogState(far);
  expect(before.visibility).toBe('visible');
  expect(before.opacity).toBeGreaterThan(0);
  expect(before.opacity).toBeLessThanOrEqual(0.3);
  expect(before.shift).toBe(0);
  // It is a layer of its own: decoration only, taking no tap and no screen reader's attention.
  await expect(fogOf(far)).toHaveAttribute('aria-hidden', 'true');
  expect(await fogOf(far).evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  expect(await fogOf(far).evaluate((node) => getComputedStyle(node).transitionProperty)).toMatch(/transform/);
  expect(await fogOf(far).evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration.split(',')[0]!))).toBeGreaterThanOrEqual(0.5);
  await expect.poll(() => fogState(far).then((s) => s.visibility), { timeout: 5000 }).toBe('hidden');
  expect(await far.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('the wipe never plays twice: a search and its clearing do not bring the condensation back', async ({ page }) => {
  await openMenu(page, slug);
  const first = paneOf(page, 'viennoiserie');
  await expect(first).toHaveAttribute('data-open', '');
  expect((await fogState(first)).visibility).toBe('hidden');
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await search.fill('');
  await expect(first).toHaveAttribute('data-open', '');
  expect((await fogState(first)).visibility).toBe('hidden');
});

test('nothing is hidden behind the condensation: a card under it still takes the tap, and its text reads through it', async ({ page }) => {
  await openMenu(page, slug);
  const far = paneOf(page, 'bread');
  const card = cardOf(page, 'sourdough');
  await card.scrollIntoViewIfNeeded();
  // The scroll opened it (wait for that, or the late open would undo the probe); shut it again to measure the fog.
  await expect(far).toHaveAttribute('data-open', '');
  await far.evaluate((node) => node.removeAttribute('data-open'));
  await expect.poll(() => fogState(far).then((s) => s.visibility)).toBe('visible');
  await expect.poll(() => fogState(far).then((s) => s.shift)).toBe(0);
  const name = card.locator('.fr-name');
  const box = (await name.boundingBox())!;
  const hit = await page.evaluate(({ x, y }) => String(document.elementFromPoint(x, y)?.className ?? ''), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).not.toContain('fr-fog');
  // The worst case: the card's ink and fill each under the fog at its strongest.
  const fog = [220, 235, 248];
  const mixed = (c: number[]) => c.map((v, i) => Math.round(v * (1 - 0.3) + fog[i]! * 0.3));
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  for (const ink of [[12, 31, 58], [11, 47, 94]]) {
    const [a, b] = [lum(mixed(ink)), lum(mixed([242, 248, 255]))].sort((p, q) => q - p);
    expect((a! + 0.05) / (b! + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
  await name.click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('sourdough') })).toBeVisible();
});

test('the wipe never keeps the dishes hidden: with an observer that never reports, a pane still opens when it is scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(paneOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(paneOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect.poll(() => fogState(paneOf(page, 'bread')).then((s) => s.visibility), { timeout: 5000 }).toBe('hidden');
  await expect(cardOf(page, 'sourdough').locator('.fr-name')).toBeVisible();
});

test('keyboard focus inside a pane with condensation clears it at once', async ({ page }) => {
  await openMenu(page, slug);
  const far = paneOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.locator('.fr-name').first().focus();
  await expect(far).toHaveAttribute('data-open', '');
});

test('less motion: no condensation at all, nothing armed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  const fogs = await body(page).locator('.fr-fog').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).visibility));
  expect(fogs.length).toBeGreaterThan(0);
  expect(fogs.every((v) => v === 'hidden')).toBe(true);
});

test('every motion in the shape ends within five seconds, and nothing loops', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectMotionEnds(body(page));
  const looping = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(looping).toBe(0);
});

test('in Arabic the wipe runs from the other side and the pane stays inside the screen', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  const far = paneOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  await expect.poll(() => fogOf(far).evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeLessThan(0);
  await expectNoPageWiden(page);
});

test('a dish adds from its card and opens from its name, and tapping the photo or the card opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .fr-grid');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cardOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const card = (await cardOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(card.x + card.width / 2, card.y + card.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.fr-add')).toHaveCount(0);
  await expectFirstScreen(page, cards(page), { min: 4 });
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates and a working add', async ({ page }) => {
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  expect(await body(page).locator('[data-photo] img').count()).toBe(0);
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
    const row = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(row).toBeVisible();
    await expectPlatePainted(row.locator('[data-photo]'), row);
  }
});

test('a menu of twenty-five sections keeps every pane one tap away on a scrolling strip that keeps the lit chip in view', async ({ page }) => {
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
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(last.locator('.fr-chip-no')).toHaveText('25');
});

test('a search that narrows and clears keeps the strip, never moves the focus or the scroll', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).count()).toBeLessThan(4);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(cards(page).nth(3)).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const card = cards(page).first();
  await card.locator('.fr-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.fr-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await card.locator('.fr-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await card.boundingBox())!;
  for (const part of ['.fr-price', '.fr-name', '.fr-add', '[data-photo]']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.fr-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.fr-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the panes stand four across in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const boxes = await Promise.all(['viennoiserie', 'patisserie', 'celebration', 'boxes'].map(async (categorySlug) => (await paneOf(page, categorySlug).boundingBox())!));
  for (const box of boxes.slice(1)) expect(Math.abs(box!.y - boxes[0]!.y)).toBeLessThanOrEqual(1);
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + 40);
  expect(boxes[3]!.x).toBeGreaterThan(boxes[2]!.x + 40);
  expect(boxes[0]!.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the chips too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.fr-chip-no')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, the columns of panes mirror and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const one = (await paneOf(page, 'viennoiserie').boundingBox())!;
  const two = (await paneOf(page, 'patisserie').boundingBox())!;
  expect(one.x).toBeGreaterThan(two.x);
  const card = cards(page).first();
  const add = (await card.locator('.fr-add').boundingBox())!;
  const frame = (await card.locator('[data-photo]').boundingBox())!;
  expect(add.x + add.width / 2).toBeLessThan(frame.x + frame.width / 2);
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('text reads on every fill it sits on, in every palette of the shape', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', slug], ['custom colours', customSlug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)])];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    const card = cardOf(page, 'croissant');
    await expectReadable(menu, {
      'number of a chip': strip(page).locator('[data-pane="rest"]').first(),
      'lit number of a chip': strip(page).locator('[data-pane="active"]'),
      'name of a lit chip': strip(page).locator('[aria-current="true"] .fr-chip-name'),
      'name of a resting chip': strip(page).locator('button:not([aria-current]) .fr-chip-name').first(),
      'plate name': first.locator('h2 > span'),
      'plate count': first.locator('h2 b'),
      'plate number': first.locator('h2 small'),
      'card name': card.locator('.fr-name'),
      'card price': card.locator('.fr-price'),
      'add button': card.locator('.fr-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a strip chip', async ({ page }) => {
  for (const menuSlug of [slug, customSlug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.fr-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.fr-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -5 });
    for (const categorySlug of ['viennoiserie', 'patisserie']) {
      const chip = chipOf(page, categorySlug);
      await chip.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(chip).toBeFocused();
      await expectFocusRingShows(page, chip, { outset: -4 });
    }
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its card, inside the card, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await card.locator('.fr-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await card.locator('.fr-price .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the add button is at least 40px square, inside its card, with the sale chip clear of it', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = cards(page).first();
  const add = (await row.locator('.fr-add').boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(40);
  expect(add.height).toBeGreaterThanOrEqual(40);
  const card = (await row.boundingBox())!;
  expect(add.x).toBeGreaterThanOrEqual(card.x - 1);
  expect(add.x + add.width).toBeLessThanOrEqual(card.x + card.width + 1);
  expect(add.y + add.height).toBeLessThanOrEqual(card.y + card.height + 1);
  const chip = (await row.locator('.tpl-photo-off').boundingBox())!;
  expect(chip.x < add.x + add.width && add.x < chip.x + chip.width && chip.y < add.y + add.height && add.y < chip.y + chip.height).toBe(false);
});

test('a search keeps each section its own number and chip (by its place in the full menu)', async ({ page }) => {
  await openMenu(page, slug);
  const chip = chipOf(page, 'bread');
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('sourdough');
  await expect(page.locator('#cat-viennoiserie')).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  await expect(chip.locator('.fr-chip-no')).toHaveText('5');
});
