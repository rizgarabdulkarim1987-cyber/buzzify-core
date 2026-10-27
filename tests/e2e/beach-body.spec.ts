import { expectColourNear, isNear } from './helpers/colour-near';
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
  openMenu,
  paletteIdsOf,
  silenceObserver,
} from './helpers/body-menu';

/**
 * The Summer Beach body (spec 2026-10-26-menu-styles-in-templates-design.md): the menu is a stretch of beach. A sticky
 * strip of buoy chips (a lifebuoy ring with the number, and the section's name) jumps to a section; every section is a
 * full-width band of sand or sea (in turns) whose top edge is a wave that drifts once when the band first comes into
 * view; the dishes are striped landscape beach towels in two columns, the photo at the start in one row and at the end in
 * the next, a last towel left alone lying across the row.
 */

const menus = bodyMenus();
const slug = menus.slug('bc');
const promoSlug = menus.slug('bcoffer');
const arabSlug = menus.slug('bcar');
const manySlug = menus.slug('bcmany');
const offSlug = menus.slug('bcoff');
const bareSlug = menus.slug('bcbare');
const crowdSlug = menus.slug('bccrowd');
const customSlug = menus.slug('bccustom');
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`bcbare-${id}`);
const alternatives = paletteIdsOf('the-summer-beach').slice(1);
const paletteSlug = (id: string) => menus.slug(`bc-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'bc', { templateId: 'the-summer-beach' });
  await menus.create(promoSlug, 'bc', { templateId: 'the-summer-beach', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'bc', { templateId: 'the-summer-beach', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'bc', { templateId: 'the-summer-beach', extraSections: 20 });
  await menus.create(offSlug, 'bc', { templateId: 'the-summer-beach', ordering: 'none' });
  await menus.create(bareSlug, 'bc', { templateId: 'the-summer-beach', noPhotos: true });
  await menus.create(crowdSlug, 'bc', { templateId: 'the-summer-beach', crowd: 4 });
  await menus.create(customSlug, 'bc', { templateId: 'the-summer-beach', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'bc', { templateId: 'the-summer-beach', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'bc', { templateId: 'the-summer-beach', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="beach"]');
const strip = (page: Page) => body(page).locator('[data-buoys]');
const tiles = (page: Page) => body(page).locator('[data-row]');
const tileOf = (page: Page, productSlug: string) => tiles(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const bandOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const waveOf = (band: Locator) => band.locator('.bc-wave');
const boxes = async (list: Locator) => (await Promise.all((await list.all()).map((node) => node.boundingBox()))) as DOMRect[];

test('on a phone the strip is at most 64px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expectFirstScreen(page, tiles(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

test('with the offers banner above the menu the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 2 });
});

test('the strip is a row of buoy chips: a cream pill, 44px tall, a lifebuoy ring with the number AND the section name visible', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(chips.first().locator('.bc-chip-no')).toHaveText('1');
  await expect(chips.nth(2).locator('.bc-chip-no')).toHaveText('3');
  for (const category of BODY_CATEGORIES) {
    const label = chipOf(page, category.slug).locator('.bc-chip-name');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(category.name.en!);
    expect(parseFloat(await label.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  // The buoy: a conic ring of stripes around the number.
  expect(await chips.nth(1).locator('.bc-chip-no').evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('conic-gradient');
  expectColourNear(await chips.nth(1).evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(255, 253, 247)');
});

test('the chip of the section in view is lit (dark, ringed) and the others are not', async ({ page }) => {
  await openMenu(page, slug);
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect.poll(async () => isNear(await (() => chipOf(page, 'bread').evaluate((node) => getComputedStyle(node).backgroundColor))(), 'rgb(13, 59, 82)')).toBe(true);
  expectColourNear(await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(255, 253, 247)');
});

test('a chip takes you to its band and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first band is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('sections are full-width bands that alternate sand and sea, each with a wave along its top edge', async ({ page }) => {
  await openMenu(page, slug);
  const colours: string[] = [];
  for (const category of BODY_CATEGORIES) colours.push(await bandOf(page, category.slug).evaluate((node) => getComputedStyle(node).backgroundColor));
  expect(colours.slice(0, 4)).toEqual(['rgb(255, 233, 184)', 'rgb(191, 238, 252)', 'rgb(255, 233, 184)', 'rgb(191, 238, 252)']);
  const band = (await bandOf(page, 'viennoiserie').boundingBox())!;
  const main = (await page.locator('main#menu').boundingBox())!;
  expect(band.width).toBeGreaterThanOrEqual(main.width - 1);
  expect(band.x).toBeLessThanOrEqual(main.x + 1);
  // The bands touch: one runs straight into the next, with the wave between them.
  const next = (await bandOf(page, 'patisserie').boundingBox())!;
  expect(Math.abs(next.y - (band.y + band.height))).toBeLessThanOrEqual(1);
  const wave = waveOf(bandOf(page, 'patisserie'));
  await expect(wave).toHaveAttribute('aria-hidden', 'true');
  const style = await wave.evaluate((node) => ({ mask: getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage, colour: getComputedStyle(node).backgroundColor, events: getComputedStyle(node).pointerEvents }));
  expect(style.mask).toContain('svg');
  expectColourNear(style.colour, 'rgb(191, 238, 252)');
  expect(style.events).toBe('none');
  const at = (await wave.boundingBox())!;
  expect(at.y + at.height).toBeLessThanOrEqual(next.y + 2);
  expect(at.y).toBeLessThan(next.y);
});

test('the heading shows the number, the name and the count in the menu numerals', async ({ page }) => {
  await openMenu(page, slug);
  const title = bandOf(page, 'viennoiserie').locator('h2');
  await expect(title.locator('small')).toHaveText('1');
  await expect(title.locator('b')).toHaveText('3');
  await expect(title.locator('span')).toHaveText('Viennoiserie');
});

test('dishes are striped beach towels in two columns: landscape pairs, the photo at the start, a lone last towel across the row, a striped frame and a fringe', async ({ page }) => {
  await openMenu(page, slug);
  const row = bandOf(page, 'viennoiserie').locator('[data-row]');
  expect(await row.count()).toBe(3);
  const [a, b, c] = await boxes(row);
  const grid = (await bandOf(page, 'viennoiserie').locator('.bc-grid').boundingBox())!;
  // The first pair shares one row, each half the grid; the third lies alone across the next row.
  expect(a!.width).toBeLessThan(grid.width / 2 + 1);
  expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(1);
  expect(b!.x).toBeGreaterThan(a!.x + 40);
  expect(c!.y).toBeGreaterThan(a!.y + a!.height);
  expect(c!.width).toBeGreaterThanOrEqual(grid.width - 1);
  // A towel is landscape: the photo at the start of its row, the label beside it, the photo narrower than the tile.
  const [photo, bar] = [(await row.first().locator('[data-photo]').boundingBox())!, (await row.first().locator('.bc-bar').boundingBox())!];
  expect(photo.x).toBeLessThan(bar.x);
  expect(photo.width).toBeLessThan(a!.width / 2);
  expect(Math.abs(photo.y - bar.y)).toBeLessThan(photo.height);
  // The towel: stripes of a hue of its own, a fringe hanging under it, a solid cream label for the text.
  const style = await row.first().evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, fringe: getComputedStyle(node, '::before').backgroundImage, below: getComputedStyle(node, '::before').insetBlockEnd }));
  expect(style.image).toContain('repeating-linear-gradient');
  expect(style.fringe).toContain('repeating-linear-gradient');
  expect(parseFloat(style.below)).toBeLessThan(0);
  const bg = async (index: number) => row.nth(index).evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(await bg(0)).not.toBe(await bg(1));
  expectColourNear(await row.first().locator('.bc-bar').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgb(255, 253, 247)');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the fourth and later towels keep the pattern: the photo side alternates by rows, a lone last towel lies across the row', async ({ page }) => {
  await openMenu(page, crowdSlug);
  const row = bandOf(page, 'viennoiserie').locator('[data-row]');
  expect(await row.count()).toBe(7);
  const grid = (await bandOf(page, 'viennoiserie').locator('.bc-grid').boundingBox())!;
  const all = await boxes(row);
  // Rows: (0, 1) (2, 3) (4, 5), then 6 alone and wide.
  for (const [x, y] of [[0, 1], [2, 3], [4, 5]] as const) expect(Math.abs(all[x]!.y - all[y]!.y)).toBeLessThanOrEqual(1);
  expect(all[2]!.y).toBeGreaterThan(all[0]!.y + all[0]!.height);
  expect(all[4]!.y).toBeGreaterThan(all[2]!.y + all[2]!.height);
  expect(all[6]!.width).toBeGreaterThanOrEqual(grid.width - 1);
  expect(all[6]!.y).toBeGreaterThan(all[4]!.y + all[4]!.height);
  // The photo is at the start in rows 0 and 2 and at the end in rows 1 and 3 (the lone wide one).
  const side = async (index: number) => {
    const [photo, bar] = [(await row.nth(index).locator('[data-photo]').boundingBox())!, (await row.nth(index).locator('.bc-bar').boundingBox())!];
    return photo.x < bar.x ? 'start' : 'end';
  };
  expect(await Promise.all([0, 1, 2, 3, 4, 5, 6].map(side))).toEqual(['start', 'start', 'end', 'end', 'start', 'start', 'end']);
  // Every towel of the fourth and later still carries its price and its add button.
  for (const index of [3, 4, 5, 6]) {
    await row.nth(index).scrollIntoViewIfNeeded();
    await expect(row.nth(index).locator('.bc-price')).toContainText('$');
    await expect(row.nth(index).locator('.bc-add')).toBeVisible();
  }
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a towel keeps its hue and the photo side is in the page order: an end towel has its photo after its label in the DOM, not moved by CSS', async ({ page }) => {
  await openMenu(page, crowdSlug);
  const row = bandOf(page, 'viennoiserie').locator('[data-row]');
  const first = (index: number) => row.nth(index).evaluate((node) => [...node.children].map((child) => (child.hasAttribute('data-photo') ? 'photo' : 'label')));
  expect(await first(0)).toEqual(['photo', 'label']);
  expect(await first(2)).toEqual(['label', 'photo']);
  expect(await row.nth(2).locator('[data-photo]').evaluate((node) => getComputedStyle(node).order)).toBe('0');
});

test('a search never recolours a towel: its hue goes by its place in the full section', async ({ page }) => {
  await openMenu(page, slug);
  const hue = () => tileOf(page, 'pain-au-chocolat').evaluate((node) => getComputedStyle(node).getPropertyValue('--towel').trim());
  const before = await hue();
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('Pain au');
  // Pain au chocolat is now the first towel of its section (the morning box lists it as an ingredient, in another one).
  await expect(bandOf(page, 'viennoiserie').locator('[data-row]')).toHaveCount(1);
  expect(await hue()).toBe(before);
});

test('the add sits on the label beside the price, never over the photo', async ({ page }) => {
  await openMenu(page, slug);
  for (const productSlug of ['croissant', 'pain-au-chocolat', 'kouign-amann']) {
    const tile = tileOf(page, productSlug);
    const [add, photo, price] = [(await tile.locator('.bc-add').boundingBox())!, (await tile.locator('[data-photo]').boundingBox())!, (await tile.locator('.bc-price').boundingBox())!];
    const overlaps = add.x < photo.x + photo.width && photo.x < add.x + add.width && add.y < photo.y + photo.height && photo.y < add.y + add.height;
    expect(overlaps, productSlug).toBe(false);
    expect(Math.abs(add.y + add.height / 2 - (price.y + price.height / 2)), productSlug).toBeLessThanOrEqual(12);
    await expect(tile.locator('.bc-bar .bc-add')).toHaveCount(1);
  }
});

test('the name and the price sit on the cream label, each in its own ink', async ({ page }) => {
  await openMenu(page, slug);
  const tile = tileOf(page, 'croissant');
  expect(await tile.locator('.bc-price').evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  expectColourNear(await tile.locator('.bc-name').evaluate((node) => getComputedStyle(node).color), 'rgb(13, 59, 82)');
  expectColourNear(await tile.locator('.bc-price').evaluate((node) => getComputedStyle(node).color), 'rgb(154, 52, 18)');
});

test('the wave drifts once when a band first comes into view and then rests: it ends, nothing loops, and it never plays twice', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toHaveAttribute('data-armed', '');
  const far = bandOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  expect(await waveOf(far).evaluate((node) => node.getAnimations().length)).toBe(0);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  expect(await waveOf(far).evaluate((node) => getComputedStyle(node).animationName)).toBe('bc-drift');
  await expect.poll(() => waveOf(far).evaluate((node) => node.getAnimations().length), { timeout: 6000 }).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await waveOf(far).evaluate((node) => node.getAnimations().length)).toBe(0);
  const looping = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(looping).toBe(0);
});

test('the wave moves by transform only, and a band is never hidden while it waits: with an observer that never reports it still opens', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(bandOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  const frames = await waveOf(bandOf(page, 'viennoiserie')).evaluate((node) => {
    const keys = (node.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
    return [...new Set(keys.flatMap((key) => Object.keys(key)))].filter((name) => !['offset', 'easing', 'composite', 'computedOffset'].includes(name));
  });
  expect(frames).toEqual(['transform']);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(bandOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect(tileOf(page, 'sourdough').locator('.bc-name')).toBeVisible();
});

test('less motion: the waves rest, nothing armed, no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  expect(await body(page).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(waveOf(bandOf(page, 'patisserie'))).toBeAttached();
});

test('every motion in the shape ends within five seconds, and nothing loops', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectMotionEnds(body(page));
});

test('a dish adds from its towel and opens from its name, and tapping the photo or the towel opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .bc-grid');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await tileOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await tileOf(page, 'pain-au-chocolat').scrollIntoViewIfNeeded();
  const at = (await tileOf(page, 'pain-au-chocolat').boundingBox())!;
  await page.mouse.click(at.x + at.width / 2, at.y + at.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('pain-au-chocolat') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open towels, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.bc-add')).toHaveCount(0);
  await expectFirstScreen(page, tiles(page), { min: 4 });
  const photo = (await tiles(page).first().locator('[data-photo]').boundingBox())!;
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
    await expect(row.nth(index).locator('.bc-name')).toBeVisible();
    await expect(row.nth(index).locator('.bc-price')).toContainText('$');
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

test('a menu of twenty-five sections keeps every band one tap away on a scrolling strip that keeps the lit chip in view', async ({ page }) => {
  await openMenu(page, manySlug);
  const list = strip(page).locator('ul');
  await expect(strip(page).locator('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const last = strip(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(last.locator('.bc-chip-no')).toHaveText('25');
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

test('a long dish name and a long price stay inside the towel without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const tile = tiles(page).nth(1);
  await tile.locator('.bc-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await tile.locator('.bc-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await tile.locator('.bc-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(3);
  const box = (await tile.boundingBox())!;
  for (const part of ['.bc-price', '.bc-name', '.bc-add', '[data-photo]']) {
    const at = (await tile.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await tile.locator('.bc-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(tile.locator('.bc-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the towels stay in two columns in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [a, b] = await boxes(row);
  expect(b!.x).toBeGreaterThan(a!.x + 40);
  expect(a!.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the chips too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.bc-chip-no')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, the photo is at the start (the right), the pair mirrors, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  await expectNoPageWiden(page);
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const photo = (await tiles(page).first().locator('[data-photo]').boundingBox())!;
  const bar = (await tiles(page).first().locator('.bc-bar').boundingBox())!;
  expect(photo.x).toBeGreaterThan(bar.x);
  const [a, b] = await boxes(tiles(page));
  expect(a!.x).toBeGreaterThan(b!.x);
  const tile = tiles(page).nth(1);
  const add = (await tile.locator('.bc-add').boundingBox())!;
  const frame = (await tile.locator('[data-photo]').boundingBox())!;
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
    const second = page.locator('#cat-patisserie');
    const tile = tileOf(page, 'croissant');
    await expectReadable(menu, {
      'number of a chip': strip(page).locator('[data-pane="rest"]').first(),
      'name of a lit chip': strip(page).locator('[aria-current="true"] .bc-chip-name'),
      'name of a resting chip': strip(page).locator('button:not([aria-current]) .bc-chip-name').first(),
      'sand heading name': first.locator('h2 > span'),
      'sand heading count': first.locator('h2 b'),
      'sand heading number': first.locator('h2 small'),
      'sea heading name': second.locator('h2 > span'),
      'towel name': tile.locator('.bc-name'),
      'towel price': tile.locator('.bc-price'),
      'lone wide towel name': tileOf(page, 'kouign-amann').locator('.bc-name'),
      'lone wide towel price': tileOf(page, 'kouign-amann').locator('.bc-price'),
      'pair towel name': tileOf(page, 'pain-au-chocolat').locator('.bc-name'),
      'pair towel price': tileOf(page, 'pain-au-chocolat').locator('.bc-price'),
      'add button': tile.locator('.bc-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': tile.locator('.tpl-photo-off'), 'second sale chip': tileOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole towel, its add button and a strip chip', async ({ page }) => {
  for (const menuSlug of [slug, customSlug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const tile = tiles(page).first();
    const name = tile.locator('.bc-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, tile, { outset: -3, pseudo: '::after' });
    const add = tile.locator('.bc-add');
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

test('a dish on sale shows its -NN% chip in the menu numerals on its towel, inside the towel, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const tile = tiles(page).first();
  const chip = tile.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await tile.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await tile.locator('.bc-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.x < add.x + add.width && add.x < at.x + at.width && at.y < add.y + add.height && add.y < at.y + at.height, 'the chip and the add do not overlap').toBe(false);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await tile.locator('.bc-price .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the add button is at least 40px square, inside its towel, with the sale chip clear of it', async ({ page }) => {
  await openMenu(page, arabSlug);
  for (const tile of [tiles(page).first(), tiles(page).nth(1)]) {
    const add = (await tile.locator('.bc-add').boundingBox())!;
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    const box = (await tile.boundingBox())!;
    expect(add.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(add.y + add.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  const tile = tiles(page).first();
  const add = (await tile.locator('.bc-add').boundingBox())!;
  const chip = (await tile.locator('.tpl-photo-off').boundingBox())!;
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
  await expect(chip.locator('.bc-chip-no')).toHaveText('5');
});

test('colours picked in Customize reach the beach: the sand band, the towel label and the text follow the palette', async ({ page }) => {
  const paint = async (menuSlug: string) => {
    await openMenu(page, menuSlug);
    const style = (selector: string, property: 'backgroundColor' | 'borderTopColor' | 'color') =>
      (selector ? body(page).locator(selector).first() : body(page)).evaluate((node, p) => getComputedStyle(node)[p as 'color'], property);
    return {
      sand: await style('.bc-band', 'backgroundColor'),
      towel: await style('.bc-tile', 'backgroundColor'),
      ink: await style('', 'color'),
    };
  };
  const signature = await paint(slug);
  const custom = await paint(customSlug);
  expect(signature).toMatchObject({ sand: 'rgb(255, 233, 184)', towel: 'rgb(255, 253, 247)', ink: 'rgb(13, 59, 82)' });
  expect(custom).toEqual({ sand: 'rgb(255, 255, 255)', towel: 'rgb(255, 255, 255)', ink: 'rgb(27, 16, 48)' });
});
