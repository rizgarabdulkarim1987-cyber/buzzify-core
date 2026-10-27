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
 * The 3D Printer body (spec 2026-10-26-menu-styles-in-templates-design.md): the menu is a print job's spec sheet. A sticky
 * strip of nozzle chips (the part's number on a nozzle tip, and its name) jumps to a part; every section is a part with a
 * layer gauge down its start edge (a rail, and a layer code such as L012 on it), its dishes are full-width slabs stacked
 * one per layer, and its heading carries an "n of N layers" meter. A printhead sweeps across a slab once, the first time it
 * comes into view; the layers themselves are always readable.
 */

type Box = { x: number; y: number; width: number; height: number };
const menus = bodyMenus();
const slug = menus.slug('pr');
const promoSlug = menus.slug('proffer');
const arabSlug = menus.slug('prar');
const manySlug = menus.slug('prmany');
const offSlug = menus.slug('proff');
const bareSlug = menus.slug('prbare');
const crowdSlug = menus.slug('prcrowd');
const customSlug = menus.slug('prcustom');
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`prbare-${id}`);
const alternatives = paletteIdsOf('the-3d-printer').slice(1);
const paletteSlug = (id: string) => menus.slug(`pr-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'pr', { templateId: 'the-3d-printer' });
  await menus.create(promoSlug, 'pr', { templateId: 'the-3d-printer', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'pr', { templateId: 'the-3d-printer', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'pr', { templateId: 'the-3d-printer', extraSections: 20 });
  await menus.create(offSlug, 'pr', { templateId: 'the-3d-printer', ordering: 'none' });
  await menus.create(bareSlug, 'pr', { templateId: 'the-3d-printer', noPhotos: true });
  await menus.create(crowdSlug, 'pr', { templateId: 'the-3d-printer', crowd: 4 });
  await menus.create(customSlug, 'pr', { templateId: 'the-3d-printer', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'pr', { templateId: 'the-3d-printer', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'pr', { templateId: 'the-3d-printer', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="printer"]');
const strip = (page: Page) => body(page).locator('[data-nozzles]');
const slabs = (page: Page) => body(page).locator('[data-row]');
const slabOf = (page: Page, productSlug: string) => slabs(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const partOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const headOf = (slab: Locator) => slab.locator('.pr-lane i');
const boxes = async (list: Locator) => (await Promise.all((await list.all()).map((node) => node.boundingBox()))) as DOMRect[];
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('on a phone the strip is at most 64px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expectFirstScreen(page, slabs(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

test('with the offers banner above the menu the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, slabs(page), { min: 2 });
});

test('the strip is a row of nozzle chips: 44px tall, a nozzle tip with the number AND the part name visible', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  await expect(chips.first().locator('.pr-chip-no')).toHaveText('1');
  await expect(chips.nth(2).locator('.pr-chip-no')).toHaveText('3');
  for (const category of BODY_CATEGORIES) {
    const label = chipOf(page, category.slug).locator('.pr-chip-name');
    await expect(label).toBeVisible();
    await expect(label).toHaveText(category.name.en!);
    expect(parseFloat(await label.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  // The nozzle: a tip cut to a point.
  expect(await chips.nth(1).locator('.pr-chip-no').evaluate((node) => getComputedStyle(node).clipPath)).toContain('polygon');
  expect(await chips.nth(1).evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(29, 32, 36)');
});

test('the chip of the part in view is lit (hot orange) and the others are not', async ({ page }) => {
  await openMenu(page, slug);
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => chipOf(page, 'bread').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 122, 26)');
  expect(await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(29, 32, 36)');
});

test('a chip takes you to its part and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first part is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('the heading shows the part label, the name and the layer count in the menu numerals', async ({ page }) => {
  await openMenu(page, slug);
  const title = partOf(page, 'viennoiserie').locator('h2');
  await expect(title.locator('small')).toHaveText('Part 1');
  await expect(title.locator('b')).toHaveText('3');
  await expect(title.locator('span')).toHaveText('Viennoiserie');
});

test('dishes are slabs stacked one per layer, full width: a code on the gauge rail at the start, then a ruled slab with the photo first, the name over the price, the add at the end', async ({ page }) => {
  await openMenu(page, slug);
  const row = partOf(page, 'viennoiserie').locator('[data-row]');
  expect(await row.count()).toBe(3);
  const [a, b, c] = await boxes(row);
  const stack = (await partOf(page, 'viennoiserie').locator('.pr-stack').boundingBox())!;
  // One slab per row, each the whole width of the stack, one under the other with a small gap.
  for (const slab of [a!, b!, c!]) expect(slab.width).toBeGreaterThanOrEqual(stack.width - 1);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  expect(c!.y).toBeGreaterThan(b!.y + b!.height - 1);
  expect(b!.y - (a!.y + a!.height)).toBeLessThan(12);
  // A slab: the code, then the photo, then the text, then the add, in a line.
  const first = row.first();
  const [code, photo, text, add] = (await Promise.all(['.pr-code', '[data-photo]', '.pr-text', '.pr-add'].map((part) => first.locator(part).boundingBox()))) as DOMRect[];
  expect(code!.x + code!.width).toBeLessThanOrEqual(photo!.x + 1);
  expect(photo!.x + photo!.width).toBeLessThanOrEqual(text!.x + 1);
  expect(text!.x + text!.width).toBeLessThanOrEqual(add!.x + 1);
  // The name sits over the price.
  const [name, price] = (await Promise.all(['.pr-name', '.pr-price'].map((part) => first.locator(part).boundingBox()))) as DOMRect[];
  expect(price!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
  // The slab is a solid ruled panel; the codes count the layers 001, 002, 003 in a monospace face.
  expect(await first.locator('.pr-body').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(26, 29, 33)');
  await expect(row.nth(0).locator('.pr-code')).toHaveText('L001');
  await expect(row.nth(1).locator('.pr-code')).toHaveText('L002');
  await expect(row.nth(2).locator('.pr-code')).toHaveText('L003');
  expect(await first.locator('.pr-code').evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/mono/i);
  // The gauge: a rail with ticks down the start edge (a pseudo-element of the stack), and its fill.
  const rail = await partOf(page, 'viennoiserie').locator('.pr-stack').evaluate((node) => ({ ticks: getComputedStyle(node, '::before').backgroundImage, fill: getComputedStyle(node, '::after').backgroundColor, width: getComputedStyle(node, '::after').width }));
  expect(rail.ticks).toContain('repeating-linear-gradient');
  expect(rail.width).toBe('2px');
  expect(rail.fill).not.toBe('rgba(0, 0, 0, 0)');
  const railBox = (await partOf(page, 'viennoiserie').locator('.pr-code').first().boundingBox())!;
  expect(railBox.x).toBeLessThan(photo!.x);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the fourth and later layers keep the pattern: stacked, numbered in turn, each with its price and add; the gauge fill is the printed share', async ({ page }) => {
  await openMenu(page, crowdSlug);
  const row = partOf(page, 'viennoiserie').locator('[data-row]');
  expect(await row.count()).toBe(7);
  const all = await boxes(row);
  for (let at = 1; at < all.length; at++) expect(all[at]!.y).toBeGreaterThan(all[at - 1]!.y + all[at - 1]!.height - 1);
  for (let at = 0; at < 7; at++) {
    await row.nth(at).scrollIntoViewIfNeeded();
    await expect(row.nth(at).locator('.pr-code')).toHaveText(`L00${at + 1}`);
    await expect(row.nth(at).locator('.pr-price')).toContainText('$');
    await expect(row.nth(at).locator('.pr-add')).toBeVisible();
  }
  await expect(partOf(page, 'viennoiserie').locator('.pr-meter-text')).toHaveText('7 of 7 layers');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the name and the price sit on the slab, each in its own ink', async ({ page }) => {
  await openMenu(page, slug);
  const slab = slabOf(page, 'croissant');
  expect(await slab.locator('.pr-price').evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  expect(await slab.locator('.pr-name').evaluate((node) => getComputedStyle(node).color)).toBe('rgb(233, 236, 239)');
  expect(await slab.locator('.pr-price').evaluate((node) => getComputedStyle(node).color)).toBe('rgb(255, 122, 26)');
});

test('the meter says "n of N layers" in its part: layers not yet seen are not counted, and it reads N of N once the printhead has been over them', async ({ page }) => {
  await openMenu(page, slug);
  const first = partOf(page, 'viennoiserie');
  await expect(first.locator('.pr-meter-text')).toHaveText('3 of 3 layers');
  const far = partOf(page, 'celebration');
  const total = await far.locator('[data-row]').count();
  await expect(far.locator('.pr-meter-text')).toHaveText(`0 of ${total} layers`);
  await expect(far.locator('.pr-name').first()).toBeVisible();
  expect(await far.locator('.pr-name').first().evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  await far.scrollIntoViewIfNeeded();
  await expect(far.locator('.pr-meter-text')).toHaveText(`${total} of ${total} layers`);
  // The track's fill follows: the whole way once every layer is printed, by transform alone.
  await expect.poll(() => far.locator('.pr-meter-track i').evaluate((node) => getComputedStyle(node).transform)).toMatch(/^(matrix\(1, 0, 0, 1|none)/);
});

test('a single layer reads "1 of 1 layer" (the singular)', async ({ page }) => {
  await openMenu(page, manySlug);
  const one = partOf(page, 'more-1');
  await one.scrollIntoViewIfNeeded();
  await expect(one.locator('.pr-meter-text')).toHaveText('1 of 1 layer');
});

test('the printhead sweeps a slab once when it first comes into view and then rests: it ends, nothing loops, and it never plays twice', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toHaveAttribute('data-armed', '');
  const far = slabOf(page, 'sourdough');
  await expect(far).not.toHaveAttribute('data-print', '');
  expect(await headOf(far).evaluate((node) => node.getAnimations().length)).toBe(0);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-print', '');
  expect(await headOf(far).evaluate((node) => getComputedStyle(node).animationName)).toBe('pr-sweep');
  await expect.poll(() => headOf(far).evaluate((node) => node.getAnimations().length), { timeout: 6000 }).toBe(0);
  expect(await headOf(far).evaluate((node) => getComputedStyle(node).opacity)).toBe('0');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await headOf(far).evaluate((node) => node.getAnimations().length)).toBe(0);
  const looping = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(looping).toBe(0);
});

test('the sweep moves by transform and opacity only, lies over the slab without taking a tap, and a layer is never hidden while it waits: with an observer that never reports it still opens', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  const first = slabs(page).first();
  await expect(first).toHaveAttribute('data-print', '');
  const frames = await headOf(first).evaluate((node) => {
    const keys = (node.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
    return [...new Set(keys.flatMap((key) => Object.keys(key)))].filter((name) => !['offset', 'easing', 'composite', 'computedOffset'].includes(name)).sort();
  });
  expect(frames).toEqual(['opacity', 'transform']);
  expect(await first.locator('.pr-lane').evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  await expect(first.locator('.pr-lane')).toHaveAttribute('aria-hidden', 'true');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(slabOf(page, 'sourdough')).toHaveAttribute('data-print', '');
  await expect(slabOf(page, 'sourdough').locator('.pr-name')).toBeVisible();
});

test('less motion: the layers are simply there, nothing armed, no animation, every layer counted', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  expect(await body(page).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  const far = partOf(page, 'celebration');
  const total = await far.locator('[data-row]').count();
  await expect(far.locator('.pr-meter-text')).toHaveText(`${total} of ${total} layers`);
  await expect(slabOf(page, 'sourdough').locator('.pr-name')).toBeAttached();
  expect(await headOf(slabOf(page, 'sourdough')).evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('every motion in the shape ends within five seconds, and nothing loops', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectMotionEnds(body(page));
});

test('a dish adds from its slab and opens from its name, and tapping the photo, the code or the slab opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .pr-stack');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await slabOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const code = (await slabOf(page, 'croissant').locator('.pr-code').boundingBox())!;
  await page.mouse.click(code.x + code.width / 2, code.y + code.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await slabOf(page, 'pain-au-chocolat').scrollIntoViewIfNeeded();
  const at = (await slabOf(page, 'pain-au-chocolat').boundingBox())!;
  await page.mouse.click(at.x + at.width / 2, at.y + at.height - 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('pain-au-chocolat') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open slabs, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.pr-add')).toHaveCount(0);
  await expectFirstScreen(page, slabs(page), { min: 4 });
  const photo = (await slabs(page).first().locator('[data-photo]').boundingBox())!;
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
    await expect(row.nth(index).locator('.pr-name')).toBeVisible();
    await expect(row.nth(index).locator('.pr-price')).toContainText('$');
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

test('a menu of twenty-five sections keeps every part one tap away on a scrolling strip that keeps the lit chip in view', async ({ page }) => {
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
  await expect(last.locator('.pr-chip-no')).toHaveText('25');
});

test('a search that narrows and clears keeps the strip, never moves the focus or the scroll', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(slabs(page).first()).toBeVisible();
  expect(await slabs(page).count()).toBeLessThan(4);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(slabs(page).nth(3)).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('a long dish name and a long price stay inside the slab without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const slab = slabs(page).nth(1);
  await slab.locator('.pr-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await slab.locator('.pr-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await slab.locator('.pr-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(3);
  const box = (await slab.boundingBox())!;
  for (const part of ['.pr-price', '.pr-name', '.pr-add', '[data-photo]', '.pr-code']) {
    const at = (await slab.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(at.y + at.height, part).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  expect(await contrastOf(slab.locator('.pr-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the slabs stay one per row in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const [a, b] = await boxes(page.locator('#cat-viennoiserie [data-row]'));
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  expect(a!.x).toBeGreaterThan(100);
  expect(a!.width).toBeLessThanOrEqual(44 * 16);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers, counts, layer codes and the meter use the tenant numerals, on the chips too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.pr-chip-no')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('Part ١');
  await expect(page.locator('#cat-viennoiserie .pr-code').first()).toHaveText('L٠٠١');
  await expect(page.locator('#cat-viennoiserie .pr-meter-text')).toHaveText('٣ of ٣ layers');
});

test('in Arabic the page is right to left, the strip starts at the right, the code and photo are at the start (the right), the add at the end (the left), and the head sweeps from the right', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  await expectNoPageWiden(page);
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const slab = slabs(page).first();
  const [code, photo, add] = (await Promise.all(['.pr-code', '[data-photo]', '.pr-add'].map((part) => slab.locator(part).boundingBox()))) as DOMRect[];
  expect(code!.x).toBeGreaterThan(photo!.x);
  expect(photo!.x).toBeGreaterThan(add!.x);
  expect(await slab.locator('.pr-lane').evaluate((node) => getComputedStyle(node).getPropertyValue('--pr-from').trim())).toBe('100%');
  // The meter's text is Arabic with the plural form of its count.
  await expect(partOf(page, 'viennoiserie').locator('.pr-meter-text')).toHaveText('3 من 3 طبقات');
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
    const slab = slabOf(page, 'croissant');
    await expectReadable(menu, {
      'number of a chip': strip(page).locator('[data-pane="rest"]').first(),
      'number of a lit chip': strip(page).locator('[data-pane="active"]'),
      'name of a lit chip': strip(page).locator('[aria-current="true"] .pr-chip-name'),
      'name of a resting chip': strip(page).locator('button:not([aria-current]) .pr-chip-name').first(),
      'part heading name': first.locator('h2 > span'),
      'part heading count': first.locator('h2 b'),
      'part heading label': first.locator('h2 small'),
      'second part heading name': second.locator('h2 > span'),
      'meter text': first.locator('.pr-meter-text'),
      'layer code': slab.locator('.pr-code'),
      'slab name': slab.locator('.pr-name'),
      'slab price': slab.locator('.pr-price'),
      'second slab name': slabOf(page, 'pain-au-chocolat').locator('.pr-name'),
      'second slab price': slabOf(page, 'pain-au-chocolat').locator('.pr-price'),
      'add button': slab.locator('.pr-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': slab.locator('.tpl-off'), 'second sale chip': slabOf(page, 'eclair').locator('.tpl-off') }),
    });
  }
});

test('contrast holds mid-sweep too: with the printhead over a slab its name and price still read', async ({ page }) => {
  await openMenu(page, slug);
  const slab = slabs(page).first();
  await page.addStyleTag({ content: '[data-body="printer"] .pr-lane i { animation-play-state: paused !important; animation-delay: -0.6s !important; }' });
  await slab.scrollIntoViewIfNeeded();
  // Pixels under the head's trail: the name's colour on the slab with the tint composited stays above 4.5:1.
  const ratio = await slab.evaluate((node) => {
    const head = getComputedStyle(node.querySelector('.pr-lane i')!);
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => ((c / 255) <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const panel = parse(getComputedStyle(node.querySelector('.pr-body')!).backgroundColor);
    const gradient = head.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g)?.pop() ?? '';
    const tint = parse(gradient);
    const alpha = tint[3] ?? 1;
    const tintRgb = gradient.startsWith('color(') ? tint.slice(0, 3).map((c) => c * 255) : tint.slice(0, 3);
    const under = [0, 1, 2].map((i) => tintRgb[i]! * alpha + panel[i]! * (1 - alpha));
    const ink = parse(getComputedStyle(node.querySelector('.pr-name')!).color);
    const [light, dark] = [lum(ink), lum(under)].sort((p, q) => q - p);
    return (light! + 0.05) / (dark! + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('keyboard focus rings show in full and stand out, in every palette: a whole slab, its add button and a strip chip', async ({ page }) => {
  for (const menuSlug of [slug, customSlug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const slab = slabs(page).first();
    const name = slab.locator('.pr-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, slab, { outset: -3, pseudo: '::after' });
    const add = slab.locator('.pr-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -4 });
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

test('a dish on sale shows its -NN% chip in the menu numerals on its slab, inside the slab, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const slab = slabs(page).first();
  const chip = slab.locator('.tpl-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await slab.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await slab.locator('.pr-add').boundingBox())!;
  const price = (await slab.locator('.pr-price').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(overlap(at, add), 'the chip and the add do not overlap').toBe(false);
  expect(overlap(at, price), 'the chip and the price do not overlap').toBe(false);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await slab.locator('.pr-price .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish on sale with a long price keeps its chip and price inside the slab', async ({ page }) => {
  await openMenu(page, arabSlug);
  const slab = slabs(page).first();
  await slab.locator('.pr-price').evaluate((node) => {
    node.firstChild!.textContent = 'From 123,456,789 IQD per portion';
  });
  const box = (await slab.boundingBox())!;
  for (const part of ['.tpl-off', '.pr-price', '.pr-add']) {
    const at = (await slab.locator(part).boundingBox())!;
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
  }
  expect(overlap((await slab.locator('.tpl-off').boundingBox())!, (await slab.locator('.pr-price').boundingBox())!)).toBe(false);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the add button is at least 40px square, inside its slab, clear of the chip', async ({ page }) => {
  await openMenu(page, arabSlug);
  for (const slab of [slabs(page).first(), slabs(page).nth(1)]) {
    const add = (await slab.locator('.pr-add').boundingBox())!;
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    const box = (await slab.boundingBox())!;
    expect(add.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(add.y + add.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
});

test('a search keeps each part its own number and chip (by its place in the full menu) and the meter counts what is shown', async ({ page }) => {
  await openMenu(page, slug);
  const chip = chipOf(page, 'bread');
  await expect(page.locator('#cat-bread h2 small')).toHaveText('Part 5');
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('sourdough');
  await expect(page.locator('#cat-viennoiserie')).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(page.locator('#cat-bread h2 small')).toHaveText('Part 5');
  await expect(chip.locator('.pr-chip-no')).toHaveText('5');
  await expect(page.locator('#cat-bread .pr-meter-text')).toHaveText('1 of 1 layer');
  await expect(page.locator('#cat-bread .pr-code')).toHaveText('L001');
});

test('no page widens on a phone with the offers banner and long names', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expectNoPageWiden(page);
});
