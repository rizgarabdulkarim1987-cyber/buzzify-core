import { expectColourNear } from './helpers/colour-near';
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
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Ishtar Gate body (spec 2026-10-26-menu-styles-in-templates-design.md): every section is a gate, a tall arched
 * frame of glazed lapis brick with rows of gold rosettes along the arch and the jambs, a lintel with the section's
 * number, name and dish count, and in the opening the gate's first dish as one big hero tile across it (a large arched
 * photo beside the name cartouche, a line of description and the gold rosette price badge) followed by the rest as
 * compact relief tiles in two columns (a small framed photo beside the name and the price). The doors of a gate part
 * once, the first time it comes into view. A sticky strip of gate-arch chips, each a numbered arch with the name beside it.
 */

const menus = bodyMenus();
const slug = menus.slug('gt');
const promoSlug = menus.slug('gtoffer');
const arabSlug = menus.slug('gtar');
const manySlug = menus.slug('gtmany');
const offSlug = menus.slug('gtoff');
const bareSlug = menus.slug('gtbare');
const bareAt = (id: string) => menus.slug(`gtbare-${id}`);
const customSlug = menus.slug('gtcustom');
const LIGHT_YELLOW_ACCENT = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };
const alternatives = paletteIdsOf('the-ishtar-gate').slice(1);
const paletteSlug = (id: string) => menus.slug(`gt-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'gt', { templateId: 'the-ishtar-gate' });
  await menus.create(promoSlug, 'gt', { templateId: 'the-ishtar-gate', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'gt', { templateId: 'the-ishtar-gate', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'gt', { templateId: 'the-ishtar-gate', extraSections: 20 });
  await menus.create(offSlug, 'gt', { templateId: 'the-ishtar-gate', ordering: 'none' });
  await menus.create(bareSlug, 'gt', { templateId: 'the-ishtar-gate', noPhotos: true });
  await menus.create(customSlug, 'gt', { templateId: 'the-ishtar-gate', colors: LIGHT_YELLOW_ACCENT, discount: ['croissant', 'eclair'] });
  for (const id of alternatives) await menus.create(bareAt(id), 'gt', { templateId: 'the-ishtar-gate', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'gt', { templateId: 'the-ishtar-gate', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="gate"]');
const strip = (page: Page) => body(page).locator('[data-gates]');
const tiles = (page: Page) => body(page).locator('[data-row]');
const tileOf = (page: Page, productSlug: string) => tiles(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** The strip's jump offset (`--nav-room`) in px: a jumped-to gate lands below the strip only if the strip is no taller. */
const navRoom = (page: Page) => body(page).evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) * parseFloat(getComputedStyle(document.documentElement).fontSize));

test('on a phone the strip is no taller than its jump offset and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(await navRoom(page));
  await expectFirstScreen(page, tiles(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
  // The strip does not widen the phone's layout viewport.
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, tiles(page), { min: 2 });
});

test('the strip is a row of gate chips: a gold-edged lapis arch round a numbered window with the section name beside it, 44px to tap', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(chips.first().locator('.gt-glass')).toHaveText('1');
  await expect(chips.nth(2).locator('.gt-glass')).toHaveText('3');
  // Frame and window are both arches: round at the top, nearly square at the foot.
  for (const part of [chips.first(), chips.first().locator('.gt-glass')]) {
    const radius = await part.evaluate((node) => ({ top: getComputedStyle(node).borderTopLeftRadius, foot: getComputedStyle(node).borderBottomLeftRadius }));
    expect(parseFloat(radius.top)).toBeGreaterThan(parseFloat(radius.foot) * 4);
  }
  // Every chip shows its section's name to sighted guests (not only to screen readers): a visible label inside the chip.
  for (const [at, category] of BODY_CATEGORIES.entries()) {
    const label = chips.nth(at).locator('.tpl-arch-label');
    await expect(label).toBeVisible();
    expect(await chips.nth(at).evaluate((node) => (node as HTMLElement).innerText)).toContain(category.name.en!);
    const [box, inside] = [(await label.boundingBox())!, (await chips.nth(at).boundingBox())!];
    expect(box.width).toBeGreaterThan(24);
    expect(box.x).toBeGreaterThanOrEqual(inside.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(inside.x + inside.width + 1);
  }
  await expect(strip(page).locator('.sr-only')).toHaveCount(0);
  // A gold edge round the arch, and a row of gold rosettes along the foot of the strip.
  expectColourNear(await chips.first().evaluate((node) => getComputedStyle(node).borderTopColor), 'rgb(225, 182, 74)');
  const rosettes = await strip(page).evaluate((node) => getComputedStyle(node, '::after').backgroundImage);
  expect(rosettes).toContain('conic-gradient');
});

test('the window of the section in view is lit and the others are not', async ({ page }) => {
  await openMenu(page, slug);
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(chipOf(page, 'viennoiserie').locator('[data-pane]')).toHaveAttribute('data-pane', 'active');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  const lit = await chipOf(page, 'bread').locator('.gt-glass').evaluate((node) => getComputedStyle(node).backgroundColor);
  const rest = await chipOf(page, 'viennoiserie').locator('.gt-glass').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(lit).not.toBe(rest);
});

test('a chip takes you to its gate and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first gate is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a gate: an arched frame of lapis brick with a crown of gold rosettes, a lintel with the number, the name and the count, and the opening below it', async ({ page }) => {
  await openMenu(page, slug);
  const gate = page.locator('#cat-viennoiserie');
  const title = gate.locator('h2');
  await expect(title.locator('small')).toHaveText('1');
  await expect(title.locator('b')).toHaveText('3');
  // The frame is an arch (round top, square foot) of brick drawn with gradients, with a gold edge.
  const frame = await gate.evaluate((node) => {
    const style = getComputedStyle(node);
    return { top: style.borderTopLeftRadius, foot: style.borderBottomLeftRadius, image: style.backgroundImage, edge: style.borderTopColor };
  });
  expect(parseFloat(frame.top)).toBeGreaterThan(20);
  expect(parseFloat(frame.foot)).toBeLessThan(10);
  expect(frame.image).toContain('linear-gradient');
  expectColourNear(frame.edge, 'rgb(225, 182, 74)');
  // Rosettes along the arch (the crown), and a column of them down each jamb.
  const crown = await gate.locator('.gt-crown').evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, height: parseFloat(getComputedStyle(node).height) }));
  expect(crown.image).toContain('conic-gradient');
  expect(crown.height).toBeGreaterThanOrEqual(10);
  const jambs = await gate.evaluate((node) => getComputedStyle(node, '::before').backgroundImage);
  expect(jambs).toContain('conic-gradient');
  // The lintel is a solid fill (the text sits on it) between the crown and the opening, as wide as the opening.
  expect(await title.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  const [crownBox, lintel, opening] = [(await gate.locator('.gt-crown').boundingBox())!, (await title.boundingBox())!, (await gate.locator('.gt-opening').boundingBox())!];
  expect(lintel.y).toBeGreaterThanOrEqual(crownBox.y + crownBox.height - 1);
  expect(opening.y).toBeGreaterThanOrEqual(lintel.y + lintel.height - 1);
  expect(Math.abs(lintel.width - opening.width)).toBeLessThanOrEqual(1);
  // The jambs frame the opening: it is narrower than the gate.
  const whole = (await gate.boundingBox())!;
  expect(opening.width).toBeLessThan(whole.width - 24);
});

test('in each opening the first dish is one big hero tile across it and the rest follow as compact tiles two across', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  await expect(row.nth(0)).toHaveAttribute('data-tile', 'hero');
  await expect(row.nth(1)).toHaveAttribute('data-tile', 'compact');
  await expect(row.nth(2)).toHaveAttribute('data-tile', 'compact');
  const opening = (await page.locator('#cat-viennoiserie .gt-opening').boundingBox())!;
  const [hero, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  // The hero spans the opening; the compact tiles share the row under it, half as wide each, every dish on the page
  // (nothing hidden in a sideways row).
  expect(hero.width).toBeGreaterThan(opening.width - 16);
  expect(b.y).toBeGreaterThanOrEqual(hero.y + hero.height - 1);
  expect(Math.abs(b.y - c.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.width - c.width)).toBeLessThanOrEqual(1);
  expect(b.width).toBeLessThan(hero.width * 0.55);
  expect(c.x + c.width).toBeLessThanOrEqual(opening.x + opening.width + 1);
  expect(await page.locator('#cat-viennoiserie .gt-grid').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  // The hero's photo is large (several times a compact one) and arched; its name, description and price stand beside it.
  const heroTile = row.nth(0);
  const heroPhoto = (await heroTile.locator('[data-photo]').boundingBox())!;
  const smallPhoto = (await row.nth(1).locator('[data-photo]').boundingBox())!;
  expect(heroPhoto.width * heroPhoto.height).toBeGreaterThan(smallPhoto.width * smallPhoto.height * 3);
  expect(parseFloat(await heroTile.locator('.gt-relief').evaluate((node) => getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(20);
  const words = (await heroTile.locator('.gt-words').boundingBox())!;
  expect(words.x).toBeGreaterThanOrEqual(heroPhoto.x + heroPhoto.width - 1);
  await expect(heroTile.locator('.gt-desc')).toContainText('Laminated');
  const [name, price] = [(await heroTile.locator('.gt-name').boundingBox())!, (await heroTile.locator('.gt-price').boundingBox())!];
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  // A compact tile: the name's cartouche across the top (one line for a one-word name, never broken inside the word),
  // under it the framed photo at the start with the price beside it.
  const compact = row.nth(1);
  const [relief, cname, cprice] = [(await compact.locator('.gt-relief').boundingBox())!, (await compact.locator('.gt-name').boundingBox())!, (await compact.locator('.gt-price').boundingBox())!];
  expect(relief.y).toBeGreaterThanOrEqual(cname.y + cname.height - 1);
  expect(cprice.x).toBeGreaterThanOrEqual(relief.x + relief.width - 1);
  expect(cprice.y).toBeGreaterThanOrEqual(cname.y + cname.height - 1);
  for (const at of [1, 2]) {
    const name = row.nth(at).locator('.gt-name');
    if (!(await name.innerText()).trim().includes(' ')) expect(await name.evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)))).toBe(1);
  }
  // Every tile has a sandy ground of its own (never the photo); the photo sits inside the relief frame, clear of every ornament layer.
  for (const tile of [heroTile, compact]) {
    const shape = await tile.evaluate((node) => {
      const photoNode = node.querySelector('[data-photo]')!;
      const photoStyle = getComputedStyle(photoNode);
      return {
        ground: getComputedStyle(node).backgroundColor,
        groundImage: getComputedStyle(node).backgroundImage,
        photoImage: photoStyle.backgroundImage,
        photoBefore: getComputedStyle(photoNode, '::before').content,
        photoAfter: getComputedStyle(photoNode, '::after').content,
      };
    });
    // The sand is a tint of the palette's gold and cream, within a few steps of the glazed sand (230, 201, 140).
    const sand = (await tile.evaluate((node) => { const probe = document.createElement('canvas').getContext('2d')!; probe.fillStyle = getComputedStyle(node).backgroundColor; probe.fillRect(0, 0, 1, 1); return [...probe.getImageData(0, 0, 1, 1).data]; })) as number[];
    [230, 201, 140].forEach((channel, at) => expect(Math.abs(sand[at]! - channel)).toBeLessThanOrEqual(10));
    expect(shape.groundImage).toBe('none');
    expect(shape.photoImage).toBe('none');
    expect([shape.photoBefore, shape.photoAfter].every((content) => content === 'none' || content === 'normal')).toBe(true);
    const [photo, frame] = [(await tile.locator('[data-photo]').boundingBox())!, (await tile.locator('.gt-relief').boundingBox())!];
    expect(photo.x).toBeGreaterThan(frame.x + 2);
    expect(photo.y).toBeGreaterThan(frame.y + 2);
    expect(photo.x + photo.width).toBeLessThan(frame.x + frame.width - 2);
  }
  // A gate with one dish has only its hero.
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
  await expect(page.locator('#cat-bread [data-row]')).toHaveAttribute('data-tile', 'hero');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the price is on a gold rosette badge and the name on a lapis cartouche, each on a solid fill of its own', async ({ page }) => {
  await openMenu(page, slug);
  const pane = tileOf(page, 'croissant');
  const tag = await pane.locator('.gt-price').evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, hole: getComputedStyle(node, '::before').content }));
  expect(tag.image).toBe('none');
  expectColourNear(tag.bg, 'rgb(225, 182, 74)');
  expect(tag.hole).not.toBe('none');
  const plaque = await pane.locator('.gt-name').evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage }));
  expect(plaque.image).toBe('none');
  expectColourNear(plaque.bg, 'rgb(29, 75, 155)');
});

const gateOf = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`);
const leafSpan = async (gate: Locator) => {
  const opening = (await gate.locator('.gt-opening').boundingBox())!;
  const leaves = await Promise.all([gate.locator('.gt-leaf-s').boundingBox(), gate.locator('.gt-leaf-e').boundingBox()]);
  // How much of the opening the two door leaves still cover (0 when they have slid out of it).
  return leaves.reduce((sum, box) => sum + Math.max(0, Math.min(box!.x + box!.width, opening.x + opening.width) - Math.max(box!.x, opening.x)), 0) / opening.width;
};

test('a gate opens its two door leaves once, when it first comes into view, and never plays again', async ({ page }) => {
  await openMenu(page, slug);
  const gate = gateOf(page, 'viennoiserie');
  await expect(gate).toHaveAttribute('data-open', '');
  await expect(gate.locator('.gt-leaf')).toHaveCount(2);
  // Open: the leaves have slid out of the opening, and nothing is still moving.
  await expect.poll(() => leafSpan(gate), { timeout: 5000 }).toBeLessThan(0.02);
  await expect.poll(() => gate.locator('.gt-leaf-s').evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  // A search and its clearing re-render the sections; the doors do not shut and open again.
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await search.fill('');
  await expect(gate).toHaveAttribute('data-open', '');
  expect(await gate.locator('.gt-leaf-s').evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await leafSpan(gate)).toBeLessThan(0.02);
});

test('a gate below the first screen has its doors shut until it comes into view, then they part in about half a second', async ({ page }) => {
  await openMenu(page, slug);
  const far = gateOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  expect(await leafSpan(far)).toBeGreaterThan(0.9);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-open', '');
  const time = await far.locator('.gt-leaf-s').evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(time).toBe('0.5s');
  await expect.poll(() => leafSpan(far), { timeout: 5000 }).toBeLessThan(0.02);
});

test('the doors never keep the dishes hidden: with an observer that never reports, a gate still opens when it is scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  // The first screen is opened when the script arms; the rest by the scroll check.
  await expect(gateOf(page, 'viennoiserie')).toHaveAttribute('data-open', '');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(gateOf(page, 'bread')).toHaveAttribute('data-open', '');
  await expect.poll(() => leafSpan(gateOf(page, 'bread')), { timeout: 5000 }).toBeLessThan(0.02);
  await expect(tileOf(page, 'sourdough').locator('.gt-name')).toBeVisible();
});

test('keyboard focus inside a gate with its doors shut opens it at once', async ({ page }) => {
  await openMenu(page, slug);
  const far = gateOf(page, 'bread');
  await expect(far).not.toHaveAttribute('data-open', '');
  await far.locator('.gt-name').first().focus();
  await expect(far).toHaveAttribute('data-open', '');
});

test('less motion: the doors are simply open, nothing is armed and no transition runs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page)).not.toHaveAttribute('data-armed', '');
  const far = gateOf(page, 'bread');
  await far.scrollIntoViewIfNeeded();
  expect(await leafSpan(far)).toBeLessThan(0.02);
  const times = await body(page).locator('.gt-leaf').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transitionDuration));
  expect(times.every((time) => time === '0s')).toBe(true);
});

test('every motion in the shape ends within five seconds', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectMotionEnds(body(page));
});

test('in Arabic the leaves part towards their own sides (mirrored) and the gate stays inside the screen', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  const gate = gateOf(page, 'viennoiserie');
  await expect(gate).toHaveAttribute('data-open', '');
  await expect.poll(() => leafSpan(gate), { timeout: 5000 }).toBeLessThan(0.02);
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
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
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
  await expect(body(page).locator('.gt-add')).toHaveCount(0);
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
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(60);
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
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(await navRoom(page));
  await expect(last.locator('.gt-glass')).toHaveText('25');
  await expect(last.locator('.tpl-arch-label')).toHaveText('Section 25');
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

for (const which of ['hero', 'compact'] as const)
test(`a long dish name and a long price stay inside the ${which} tile without sideways scrolling`, async ({ page }) => {
  await openMenu(page, slug);
  const pane = tiles(page).nth(which === 'hero' ? 0 : 2);
  await pane.locator('.gt-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await pane.locator('.gt-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await pane.locator('.gt-name').evaluate((node) => {
    const style = getComputedStyle(node);
    const inner = node.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    return Math.round(inner / parseFloat(style.lineHeight));
  });
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await pane.boundingBox())!;
  for (const part of ['.gt-price', '.gt-name', '.gt-add', '.gt-relief']) {
    const at = (await pane.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await pane.locator('.gt-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(pane.locator('.gt-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the hero takes two columns and two rows of a four-column opening, in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [hero, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(hero.y - b.y)).toBeLessThanOrEqual(1);
  expect(b.x).toBeGreaterThan(hero.x + hero.width - 1);
  expect(hero.width).toBeGreaterThan(b.width * 1.8);
  // Two rows tall (a gate of three dishes leaves the second row to the hero alone, so its height is the hero's own).
  expect(await row.nth(0).evaluate((node) => getComputedStyle(node).gridRowStart)).toBe('span 2');
  expect(hero.height).toBeGreaterThanOrEqual(b.height);
  expect(Math.abs(c.x - b.x)).toBeGreaterThan(10);
  expect(hero.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the chips too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.gt-glass')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  // The hero's photo is at its right (the start), its words to the left and the add at the left end; the compact tiles
  // run from the right; the badge's rosette at the right (the start).
  const pane = tiles(page).first();
  const add = (await pane.locator('.gt-add').boundingBox())!;
  const frame = (await pane.locator('.gt-relief').boundingBox())!;
  const words = (await pane.locator('.gt-words').boundingBox())!;
  expect(frame.x).toBeGreaterThan(words.x);
  expect(add.x).toBeLessThan(words.x + 1);
  const [second, third] = [(await tiles(page).nth(1).boundingBox())!, (await tiles(page).nth(2).boundingBox())!];
  expect(second.x).toBeGreaterThan(third.x);
  const hole = await pane.locator('.gt-price').evaluate((node) => getComputedStyle(node, '::before').right);
  expect(hole).not.toBe('auto');
  expect(parseFloat(hole)).toBeLessThan(10);
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
      'window of a chip': strip(page).locator('[data-pane="rest"]').first(),
      'lit window of a chip': strip(page).locator('[data-pane="active"]'),
      'lit chip arch': strip(page).locator('[aria-current="true"]'),
      'resting chip arch': strip(page).locator('button:not([aria-current])').first(),
      'lintel name': first.locator('h2 > span'),
      'lintel count': first.locator('h2 b'),
      'lintel number': first.locator('h2 small'),
      'cartouche name': pane.locator('.gt-name'),
      'gold price badge': pane.locator('.gt-price'),
      'hero description': pane.locator('.gt-desc'),
      'compact cartouche name': tileOf(page, 'pain-au-chocolat').locator('.gt-name'),
      'compact price badge': tileOf(page, 'pain-au-chocolat').locator('.gt-price'),
      'compact add button': tileOf(page, 'pain-au-chocolat').locator('.gt-add'),
      'section name on a resting chip': strip(page).locator('button:not([aria-current]) .tpl-arch-label').first(),
      'section name on the lit chip': strip(page).locator('[aria-current="true"] .tpl-arch-label'),
      'add button': pane.locator('.gt-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': pane.locator('.tpl-photo-off'), 'second sale chip': tileOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole tile, its add button and a strip chip', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const pane = tiles(page).first();
    const name = pane.locator('.gt-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, pane, { outset: -3, pseudo: '::after' });
    const add = pane.locator('.gt-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -5 });
    const small = tiles(page).nth(1);
    await small.locator('.gt-name').focus();
    await expectFocusRingShows(page, small, { outset: -3, pseudo: '::after' });
    await small.locator('.gt-add').focus();
    await expectFocusRingShows(page, small.locator('.gt-add'), { outset: -5 });
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
  const add = (await pane.locator('.gt-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await pane.locator('.gt-price .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a compact tile keeps a 36px add inside it, at its end, clear of the name and the price', async ({ page }) => {
  await openMenu(page, slug);
  const tile = tileOf(page, 'pain-au-chocolat');
  const [add, box, name, price] = [(await tile.locator('.gt-add').boundingBox())!, (await tile.boundingBox())!, (await tile.locator('.gt-name').boundingBox())!, (await tile.locator('.gt-price').boundingBox())!];
  expect(add.width).toBeGreaterThanOrEqual(36);
  expect(add.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(add.y).toBeGreaterThanOrEqual(box.y - 1);
  for (const part of [name, price]) {
    const overlaps = part.x < add.x + add.width && add.x < part.x + part.width && part.y < add.y + add.height && add.y < part.y + part.height;
    expect(overlaps).toBe(false);
  }
});

test('the hero add button is at least 40px square, inside its tile, with the sale chip clear of it', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = body(page).locator('[data-row]').first();
  const add = (await row.locator('.gt-add').boundingBox())!;
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
  await expect(chip.locator('.gt-glass')).toHaveText('5');
});

test('colours picked in Customize reach the gate: the strip, the lintel, the gold rim and the cartouche follow the palette', async ({ page }) => {
  const paint = async (menuSlug: string) => {
    await openMenu(page, menuSlug);
    const style = (selector: string, property: 'backgroundColor' | 'borderTopColor' | 'color') => body(page).locator(selector).first().evaluate((node, p) => getComputedStyle(node)[p as 'color'], property);
    return {
      strip: await style('.gt-strip', 'backgroundColor'),
      rim: await style('.gt-gate', 'borderTopColor'),
      cartouche: await style('.gt-name', 'backgroundColor'),
      cartoucheInk: await style('.gt-name', 'color'),
    };
  };
  const signature = await paint(slug);
  const custom = await paint(customSlug);
  expectColourNear(signature.strip, 'rgb(16, 40, 90)');
  expect(custom).toEqual({ strip: 'rgb(244, 244, 244)', rim: 'rgb(255, 224, 102)', cartouche: 'rgb(255, 255, 255)', cartoucheInk: 'rgb(27, 16, 48)' });
});
