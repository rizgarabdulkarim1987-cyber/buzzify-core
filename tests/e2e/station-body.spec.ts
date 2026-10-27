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
  expectPlatePainted,
  expectQuickAdd,
  expectMotionEnds,
  expectReadable,
  silenceObserver,
  expectStripStays,
  expectWordsWhole,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Space Station body (spec 2026-10-26-menu-styles-in-templates-design.md): the menu is a modular station. A sticky
 * command strip of docking-port chips (a round port with the number, the section's name beside it) jumps to a section;
 * every section is a module, a capsule hull with rivets and a label plate, holding a CORRIDOR: a ribbed spine down the
 * middle with the dishes as capsule pods docked to it, alternately on its start and end side, each half a pod lower than
 * the one before. A pod holds the round steel porthole, the LED price and the add beside it, and the name across its
 * foot. The featured dish's own pod is the planet (a dashed orbit ring round its porthole). The glass of a module opens
 * once, the first time it comes into view.
 */

const menus = bodyMenus();
const slug = menus.slug('st');
const promoSlug = menus.slug('stoffer');
const arabSlug = menus.slug('star');
const manySlug = menus.slug('stmany');
const offSlug = menus.slug('stoff');
const bareSlug = menus.slug('stbare');
const customSlug = menus.slug('stcustom');
// A light menu with a pale yellow accent (Customize): the shape's own dark fills stay, the LED follows the accent.
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const bareAt = (id: string) => menus.slug(`stbare-${id}`);
const alternatives = paletteIdsOf('the-space-station').slice(1);
const paletteSlug = (id: string) => menus.slug(`st-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'st', { templateId: 'the-space-station' });
  await menus.create(promoSlug, 'st', { templateId: 'the-space-station', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'st', { templateId: 'the-space-station', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'st', { templateId: 'the-space-station', extraSections: 20 });
  await menus.create(offSlug, 'st', { templateId: 'the-space-station', ordering: 'none' });
  await menus.create(bareSlug, 'st', { templateId: 'the-space-station', noPhotos: true });
  await menus.create(customSlug, 'st', { templateId: 'the-space-station', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'st', { templateId: 'the-space-station', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'st', { templateId: 'the-space-station', paletteId: id, discount: ['croissant', 'eclair'] });
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
// What a guest sees as a dish with a picture and a price: the pods (the planet is the featured dish's own pod).
const dishes = (page: Page) => body(page).locator('[data-row]');
const planet = (page: Page) => body(page).locator('[data-planet]');

test('on a phone the strip is at most 64px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expectFirstScreen(page, dishes(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
  // The strip does not widen the phone's layout viewport.
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, dishes(page), { min: 2 });
});

test('the strip is a row of docking-port chips: a round steel port with the number and the section NAME visible beside it, 44px to tap', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(chips.first().locator('.st-port-no')).toHaveText('1');
  await expect(chips.nth(2).locator('.st-port-no')).toHaveText('3');
  expect(await chips.first().locator('.st-port-no').evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe('50%');
  expect(await chips.nth(1).locator('.st-port-no').evaluate((node) => getComputedStyle(node).borderTopColor)).toBe('rgb(207, 216, 240)');
  for (const category of BODY_CATEGORIES) {
    const chip = chipOf(page, category.slug);
    // A sighted guest reads the name: it is visible text in the chip, not a screen-reader-only label.
    expect(await chip.evaluate((node) => (node as HTMLElement).innerText)).toContain(category.name.en!);
    await expect(chip.locator('.sr-only')).toHaveCount(0);
    const label = chip.locator('.st-chip-name');
    await expect(label).toBeVisible();
    const [inner, outer] = [(await label.boundingBox())!, (await chip.boundingBox())!];
    expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
    expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
    expect(parseFloat(await label.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
});

test('the port of the section in view is lit and the others are not', async ({ page }) => {
  await openMenu(page, slug);
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(chipOf(page, 'viennoiserie').locator('[data-pane]')).toHaveAttribute('data-pane', 'active');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  const lit = await chipOf(page, 'bread').evaluate((node) => getComputedStyle(node).backgroundColor);
  const rest = await chipOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(lit).not.toBe(rest);
});

test('a chip takes you to its module and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first module is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a module: a capsule with rounded ends, seams and rivets, a label plate with the number, the name and the count, and the portholes below it', async ({ page }) => {
  await openMenu(page, slug);
  const deck = moduleOf(page, 'viennoiserie');
  const title = deck.locator('h2');
  await expect(title.locator('small')).toHaveText('1');
  await expect(title.locator('b')).toHaveText('3');
  const capsule = await deck.evaluate((node) => {
    const style = getComputedStyle(node);
    return { corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].map(parseFloat), image: style.backgroundImage, edge: style.borderTopColor, rivets: getComputedStyle(node, '::before').backgroundImage };
  });
  // Rounded at both ends, drawn with gradients (panel seams and rivets), edged in hull steel.
  for (const radius of capsule.corners) expect(radius).toBeGreaterThanOrEqual(30);
  expect(capsule.image).toContain('linear-gradient');
  expect(capsule.rivets).toContain('radial-gradient');
  expect(capsule.edge).toBe('rgb(91, 106, 146)');
  // The plate is a solid pill above the first row of portholes, as wide as the module's inside.
  expect(await title.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  expect(parseFloat(await title.evaluate((node) => getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(20);
  const [plate, grid, whole] = [(await title.boundingBox())!, (await deck.locator('.st-corridor').boundingBox())!, (await deck.boundingBox())!];
  expect(grid.y).toBeGreaterThanOrEqual(plate.y + plate.height - 1);
  expect(grid.x).toBeGreaterThanOrEqual(whole.x + 6);
  expect(grid.x + grid.width).toBeLessThanOrEqual(whole.x + whole.width - 6);
});

test('the featured dish is the planet: its OWN pod (no other cell shows it), with a dashed orbit ring and a moon round its porthole, its price, its add and its sale chip; the whole pod opens the dish', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(planet(page)).toHaveCount(1);
  // No dish is shown twice: the croissant is one cell only, and that cell is the planet.
  await expect(body(page).locator('[data-row]').filter({ hasText: dishName('croissant') })).toHaveCount(1);
  await expect(planet(page)).toHaveAttribute('data-row');
  await expect(planet(page).locator('.st-name')).toContainText(dishName('croissant'));
  await expect(planet(page).locator('.st-name .sr-only')).toHaveText('Featured: ');
  await expect(planet(page).locator('.st-price')).toContainText('$');
  await expect(planet(page).locator('.st-add')).toBeVisible();
  await expect(planet(page).locator('.tpl-photo-off')).toBeVisible();
  const orbit = planet(page).locator('.st-orbit');
  expect(await orbit.evaluate((node) => getComputedStyle(node).borderTopStyle)).toBe('dashed');
  expect(await orbit.evaluate((node) => getComputedStyle(node, '::after').backgroundImage)).toContain('radial-gradient');
  const orb = (await orbit.boundingBox())!;
  expect(Math.abs(orb.width - orb.height)).toBeLessThanOrEqual(1);
  await page.mouse.click(orb.x + orb.width / 2, orb.y + orb.height / 2);
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

test('a section is a corridor, not a grid: a spine down the middle and the pods docked to it alternately on its start and end side, each half a pod lower than the one before', async ({ page }) => {
  await openMenu(page, slug);
  for (const categorySlug of ['viennoiserie', 'patisserie']) {
    const corridor = page.locator(`#cat-${categorySlug} [data-corridor]`);
    const pods = corridor.locator('[data-row]');
    await expect(pods).toHaveCount(3);
    const boxes = (await Promise.all([0, 1, 2].map((i) => pods.nth(i).boundingBox()))) as DOMRect[];
    const lane = (await corridor.boundingBox())!;
    const middle = lane.x + lane.width / 2;
    // Never side by side in one row: one pod per side, the next one on the other side, half a pod lower.
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(middle);
    expect(boxes[1]!.x).toBeGreaterThan(middle);
    expect(boxes[2]!.x + boxes[2]!.width).toBeLessThan(middle);
    for (const [one, two] of [[boxes[0]!, boxes[1]!], [boxes[1]!, boxes[2]!]] as const) {
      const step = two.y - one.y;
      expect(step).toBeGreaterThan(one.height * 0.35);
      expect(step).toBeLessThan(one.height * 0.75);
    }
    // The spine runs down the middle between the two sides.
    const spine = await corridor.evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return { image: style.backgroundImage, width: parseFloat(style.width), height: parseFloat(style.height) };
    });
    expect(spine.image).toContain('gradient');
    expect(spine.width).toBeGreaterThanOrEqual(8);
    expect(spine.height).toBeGreaterThan(boxes[0]!.height);
    // Each pod is a capsule: rounded, the porthole round, the price and the add beside it, the name across its foot.
    const pod = pods.nth(1);
    expect(parseFloat(await pod.evaluate((node) => getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThanOrEqual(20);
    const [bezel, price, add, name] = [(await pod.locator('.st-bezel').boundingBox())!, (await pod.locator('.st-price').boundingBox())!, (await pod.locator('.st-add').boundingBox())!, (await pod.locator('.st-name').boundingBox())!];
    expect(Math.abs(bezel.width - bezel.height)).toBeLessThanOrEqual(1);
    expect(bezel.width).toBeGreaterThanOrEqual(56);
    expect(price.x).toBeGreaterThanOrEqual(bezel.x + bezel.width - 1);
    expect(add.x).toBeGreaterThanOrEqual(bezel.x + bezel.width - 1);
    expect(name.y).toBeGreaterThanOrEqual(bezel.y + bezel.height - 1);
    expect(name.width).toBeGreaterThan(bezel.width + 40);
  }
  const shape = await tileOf(page, 'pain-au-chocolat').evaluate((node) => {
    const photoNode = node.querySelector('[data-photo]')!;
    const bezelStyle = getComputedStyle(node.querySelector('.st-bezel')!);
    return { bezel: bezelStyle.backgroundImage, bezelRadius: bezelStyle.borderTopLeftRadius, glassRadius: getComputedStyle(photoNode).borderTopLeftRadius, photoImage: getComputedStyle(photoNode).backgroundImage };
  });
  expect(shape.bezel).toContain('conic-gradient');
  expect(shape.bezelRadius).toBe('50%');
  expect(shape.glassRadius).toBe('50%');
  expect(shape.photoImage).toBe('none');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('names never break inside a word on the first screen, in English and in Arabic', async ({ page }) => {
  for (const locale of ['en', 'ar']) {
    await openMenu(page, slug, { locale });
    await expect(tiles(page).first()).toBeVisible();
    await expectWordsWhole(body(page).locator('#cat-viennoiserie .st-name, #cat-patisserie .st-name'));
    await expectWordsWhole(strip(page).locator('.st-chip-name'));
  }
});

test('the name is on a dark status bar with an LED stripe and the price on an LED chip, each on a solid fill of its own', async ({ page }) => {
  await openMenu(page, slug);
  const port = tileOf(page, 'croissant');
  const led = await port.locator('.st-price').evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, mono: getComputedStyle(node).fontFamily }));
  expect(led.image).toBe('none');
  expect(led.bg).toBe('rgb(4, 7, 15)');
  expect(led.mono).toMatch(/mono/i);
  const bar = await port.locator('.st-name').evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, stripe: getComputedStyle(node).borderInlineStartWidth }));
  expect(bar.image).toBe('none');
  expect(bar.bg).toBe('rgb(14, 21, 48)');
  expect(parseFloat(bar.stripe)).toBeGreaterThanOrEqual(3);
});

test('the page behind the modules is a starfield drawn with gradients on a dark ground, whatever the palette', async ({ page }) => {
  await openMenu(page, slug);
  const sky = await body(page).evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, colour: getComputedStyle(node).backgroundColor }));
  expect(sky.image).toContain('radial-gradient');
  expect(sky.colour).toBe('rgb(7, 11, 26)');
});

const glassOf = (deck: Locator) => deck.locator('.st-glass').first();
const shutter = (glass: Locator) => glass.evaluate((node) => getComputedStyle(node).clipPath);

test('the glass of a module opens once, when it first comes into view, and never plays again', async ({ page }) => {
  await openMenu(page, slug);
  const deck = moduleOf(page, 'viennoiserie');
  await expect(deck).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(deck)), { timeout: 5000 }).toMatch(/circle\(72%/);
  await expect.poll(() => glassOf(deck).evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  // A search and its clearing re-render the sections; the glass does not shut and open again.
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await search.fill('');
  await expect(deck).toHaveAttribute('data-open', '');
  expect(await glassOf(deck).evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await shutter(glassOf(deck))).toMatch(/circle\(72%/);
});

test('a module below the first screen has its glass shuttered until it comes into view, then it opens in about half a second', async ({ page }) => {
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

test('the shutters never keep the dishes hidden: with an observer that never reports, a module still opens when it is scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(moduleOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(moduleOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(moduleOf(page, 'bread'))), { timeout: 5000 }).toMatch(/circle\(72%/);
  await expect(tileOf(page, 'sourdough').locator('.st-name')).toBeVisible();
});

test('keyboard focus inside a module with its glass shuttered opens it at once', async ({ page }) => {
  await openMenu(page, slug);
  const far = moduleOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.locator('.st-name').first().focus();
  await expect(far).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(far)), { timeout: 5000 }).toMatch(/circle\(72%/);
});

test('less motion: the glass is simply open, nothing is armed and no transition runs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  const far = moduleOf(page, 'bread');
  await far.scrollIntoViewIfNeeded();
  expect(await shutter(glassOf(far))).toMatch(/circle\(72%/);
  const times = await body(page).locator('.st-glass').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transitionDuration));
  expect(times.every((time) => time === '0s')).toBe(true);
});

test('every motion in the shape ends within five seconds', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectMotionEnds(body(page));
});

test('in Arabic the glass opens the same and the module stays inside the screen', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  const deck = moduleOf(page, 'viennoiserie');
  await expect(deck).toHaveAttribute('data-open', '');
  await expect.poll(() => shutter(glassOf(deck)), { timeout: 5000 }).toMatch(/circle\(72%/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('nothing in the shape loops: no animation that repeats forever', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  const running = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(running).toBe(0);
});

test('a dish adds from its pane and opens from its name, and tapping the photo or the pane opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie .st-corridor');
  // The planet's name carries "Featured: " for screen readers; a plain pod opens from its bare name.
  await expectOpensProduct(page, first, 'pain-au-chocolat');
  const photo = (await tileOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const pane = (await tileOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(pane.x + pane.width / 2, pane.y + pane.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open panes, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.st-add')).toHaveCount(0);
  await expectFirstScreen(page, dishes(page), { min: 4 });
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
    const row = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(row).toBeVisible();
    await expectPlatePainted(row.locator('[data-photo]'), row);
  }
});

test('a menu of twenty-five sections keeps every window one tap away on a scrolling strip that keeps the lit window in view', async ({ page }) => {
  await openMenu(page, manySlug);
  const list = strip(page).locator('ul');
  await expect(strip(page).locator('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  // The phone keeps its 390px layout viewport (an overflowing strip would widen it and hide the overflow from the check above).
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  const last = strip(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(last.locator('.st-port-no')).toHaveText('25');
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

test('a long dish name and a long price stay inside the pane without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const pane = tiles(page).first();
  await pane.locator('.st-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await pane.locator('.st-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await pane.locator('.st-name').evaluate((node) => {
    const style = getComputedStyle(node);
    const inner = node.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    return Math.round(inner / parseFloat(style.lineHeight));
  });
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await pane.boundingBox())!;
  for (const part of ['.st-price', '.st-name', '.st-add', '.st-bezel']) {
    const at = (await pane.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await pane.locator('.st-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(pane.locator('.st-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the corridor keeps its zigzag, with bigger portholes, in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(b.x).toBeGreaterThan(a.x + a.width);
  expect(b.y).toBeGreaterThan(a.y + a.height * 0.35);
  expect(a.x).toBeGreaterThan(100);
  expect((await row.nth(1).locator('.st-bezel').boundingBox())!.width).toBeGreaterThanOrEqual(90);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the chips too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.st-port-no')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const photo = (await tiles(page).first().locator('[data-photo]').boundingBox())!;
  const second = (await tiles(page).nth(1).locator('[data-photo]').boundingBox())!;
  expect(photo.x).toBeGreaterThan(second.x);
  // The porthole is at the pod's start (the right), the add beside it towards the end (the left).
  const pane = tiles(page).first();
  const add = (await pane.locator('.st-add').boundingBox())!;
  const frame = (await pane.locator('.st-bezel').boundingBox())!;
  expect(add.x + add.width).toBeLessThanOrEqual(frame.x + 1);
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
    const pane = tileOf(page, 'croissant');
    await expectReadable(menu, {
      'number of a port': strip(page).locator('[data-pane="rest"]').first(),
      'lit number of a port': strip(page).locator('[data-pane="active"]'),
      'lit docking port': strip(page).locator('[aria-current="true"]'),
      'resting docking port': strip(page).locator('button:not([aria-current])').first(),
      'plate name': first.locator('h2 > span'),
      'plate count': first.locator('h2 b'),
      'plate number': first.locator('h2 small'),
      'status bar name': pane.locator('.st-name'),
      'LED price chip': pane.locator('.st-price'),
      'planet name': planet(page).locator('.st-name'),
      'planet price': planet(page).locator('.st-price'),
      'name of a lit chip': strip(page).locator('[aria-current="true"] .st-chip-name'),
      'name of a resting chip': strip(page).locator('button:not([aria-current]) .st-chip-name').first(),
      'add button': pane.locator('.st-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': pane.locator('.tpl-photo-off'), 'second sale chip': tileOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole tile, its add button and a strip chip', async ({ page }) => {
  for (const menuSlug of [slug, customSlug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const orbName = planet(page).locator('.st-name');
    await orbName.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(orbName).toBeFocused();
    await expectFocusRingShows(page, planet(page), { outset: -3, pseudo: '::after' });
    const pane = tileOf(page, 'pain-au-chocolat');
    const name = pane.locator('.st-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, pane, { outset: -3, pseudo: '::after' });
    const add = pane.locator('.st-add');
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

test('a dish on sale shows its -NN% chip in the menu numerals on its pane, inside the pane, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const pane = tiles(page).first();
  const chip = pane.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await pane.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await pane.locator('.st-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await pane.locator('.st-price .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the add button is at least 40px square, inside its pane, with the sale chip clear of it', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = body(page).locator('[data-row]').first();
  const add = (await row.locator('.st-add').boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(40);
  expect(add.height).toBeGreaterThanOrEqual(40);
  const pane = (await row.boundingBox())!;
  expect(add.x).toBeGreaterThanOrEqual(pane.x - 1);
  expect(add.x + add.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
  expect(add.y + add.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
  const chip = (await row.locator('.tpl-photo-off').boundingBox())!;
  const overlaps = chip.x < add.x + add.width && add.x < chip.x + chip.width && chip.y < add.y + add.height && add.y < chip.y + chip.height;
  expect(overlaps).toBe(false);
});

test('a search keeps each section its own number and window (by its place in the full menu)', async ({ page }) => {
  await openMenu(page, slug);
  const chip = chipOf(page, 'bread');
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('sourdough');
  await expect(page.locator('#cat-viennoiserie')).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  await expect(chip.locator('.st-port-no')).toHaveText('5');
});
