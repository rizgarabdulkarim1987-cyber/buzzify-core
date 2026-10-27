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
  expectReadable,
  expectStripStays,
  expectWordsWhole,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Baghdad Shanashil body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a MASHRABIYA FACADE: a
 * carved header board over a band of lattice with a static wave line, then the dishes as full-width carved bands on a
 * lattice ground, one a row on a phone (two, mirrored, on a wide screen): an arched window beside a plaque with the name
 * and a ledge holding the brass price tag and the add, the window side changing band by band, a stepped corbel under
 * each window; a corbelled bracket closes the facade. A sticky strip of oriel-window chips, each a numbered window with the section's name beside it.
 */

const menus = bodyMenus();
const slug = menus.slug('shn');
const promoSlug = menus.slug('shnoffer');
const arabSlug = menus.slug('shnar');
const manySlug = menus.slug('shnmany');
const offSlug = menus.slug('shnoff');
const bareSlug = menus.slug('shnbare');
const bareAt = (id: string) => menus.slug(`shnbare-${id}`);
const alternatives = paletteIdsOf('the-baghdad-shanashil').slice(1);
const paletteSlug = (id: string) => menus.slug(`shn-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'shn', { templateId: 'the-baghdad-shanashil' });
  await menus.create(promoSlug, 'shn', { templateId: 'the-baghdad-shanashil', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'shn', { templateId: 'the-baghdad-shanashil', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'shn', { templateId: 'the-baghdad-shanashil', extraSections: 20 });
  await menus.create(offSlug, 'shn', { templateId: 'the-baghdad-shanashil', ordering: 'none' });
  await menus.create(bareSlug, 'shn', { templateId: 'the-baghdad-shanashil', noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'shn', { templateId: 'the-baghdad-shanashil', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'shn', { templateId: 'the-baghdad-shanashil', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="lattice"]');
const strip = (page: Page) => body(page).locator('[data-oriels]');
const panes = (page: Page) => body(page).locator('[data-row]');
const paneOf = (page: Page, productSlug: string) => panes(page).filter({ hasText: dishName(productSlug) });
const chipOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** The strip's jump offset (`--nav-room`) in px: a jumped-to bay lands below the strip only if the strip is no taller. */
const navRoom = (page: Page) => body(page).evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) * parseFloat(getComputedStyle(document.documentElement).fontSize));

test('on a phone the strip is no taller than its jump offset and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(await navRoom(page));
  await expectFirstScreen(page, panes(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, panes(page), { min: 2 });
});

test('the strip is a row of oriel chips: a wooden arched frame round a numbered turquoise window with the section name beside it, 44px to tap', async ({ page }) => {
  await openMenu(page, slug);
  const chips = strip(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(chips.first().locator('.sh-glass')).toHaveText('1');
  await expect(chips.nth(2).locator('.sh-glass')).toHaveText('3');
  // Frame and window are both arches: round at the top, nearly square at the foot.
  for (const part of [chips.first(), chips.first().locator('.sh-glass')]) {
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
  // The Tigris wave runs along the foot of the strip as a drawn border, and it stays still.
  const wave = await strip(page).evaluate((node) => getComputedStyle(node, '::after').backgroundImage);
  expect(wave).toContain('radial-gradient');
});

test('the window of the section in view is lit and the others are not', async ({ page }) => {
  await openMenu(page, slug);
  await expect(chipOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(chipOf(page, 'viennoiserie').locator('[data-pane]')).toHaveAttribute('data-pane', 'active');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chipOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  const lit = await chipOf(page, 'bread').locator('.sh-glass').evaluate((node) => getComputedStyle(node).backgroundColor);
  const rest = await chipOf(page, 'viennoiserie').locator('.sh-glass').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(lit).not.toBe(rest);
});

test('a chip takes you to its bay and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, chipOf(page, 'celebration'), 'celebration');
  await expect(chipOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first bay is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), chipOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a screen: a carved wooden board with the number, the name and the count, a lattice band with a wave under it, the screen of bars, and a corbelled bracket', async ({ page }) => {
  await openMenu(page, slug);
  const bay = page.locator('#cat-viennoiserie');
  const title = bay.locator('h2');
  await expect(title.locator('small')).toHaveText('1');
  await expect(title.locator('b')).toHaveText('3');
  // The board is a solid fill (the text sits on it); the lattice is a band of its own under it.
  expect(await title.evaluate((node) => getComputedStyle(node).backgroundImage)).toBe('none');
  const band = await bay.locator('[data-heading]').evaluate((node) => {
    const style = getComputedStyle(node, '::after');
    return { image: style.backgroundImage, height: parseFloat(style.height) };
  });
  expect(band.image.match(/repeating-linear-gradient/g)?.length).toBe(2);
  expect(band.image).toContain('radial-gradient');
  expect(band.height).toBeGreaterThanOrEqual(10);
  const board = (await title.boundingBox())!;
  const panel = (await bay.locator('[data-screen]').boundingBox())!;
  const under = (await bay.locator('[data-heading]').boundingBox())!;
  expect(under.y + under.height).toBeLessThanOrEqual(panel.y + 1);
  expect(Math.abs(board.width - panel.width)).toBeLessThanOrEqual(1);
  // The bracket after the panel is drawn wood: a shelf and stepped corbels.
  const bracket = await bay.evaluate((node) => {
    const style = getComputedStyle(node, '::after');
    return { image: style.backgroundImage, height: parseFloat(style.height) };
  });
  expect(bracket.image.match(/linear-gradient/g)!.length).toBeGreaterThanOrEqual(10);
  expect(bracket.height).toBeGreaterThanOrEqual(16);
});

test('dishes are carved bands, one a row on a phone, not a grid of cells: an arched window beside a plaque, the window side changing band by band, a corbel under each window', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  const screen = (await page.locator('#cat-viennoiserie [data-screen]').boundingBox())!;
  const boxes = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  // One band a row, each the whole facade wide (the Erbil Citadel's three windows a row would fail here), stacked.
  for (const box of boxes) expect(box.width).toBeGreaterThan(screen.width * 0.9);
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1);
  // Window and plaque side by side; the window at the start of the first band, at the end of the second, then back.
  const side = async (at: number) => {
    const [window, plaque] = (await Promise.all(['.sh-window', '.sh-plaque'].map((part) => row.nth(at).locator(part).boundingBox()))) as DOMRect[];
    expect(Math.abs(window!.y - plaque!.y)).toBeLessThan(window!.height);
    expect(window!.width).toBeLessThan(boxes[at]!.width * 0.4);
    return window!.x < plaque!.x ? 'start' : 'end';
  };
  expect([await side(0), await side(1), await side(2)]).toEqual(['start', 'end', 'start']);
  // On the plaque: the name, the brass tag under it, the add at the end beside both; the band no taller than it needs.
  const cell = row.first();
  const [name, price, add] = (await Promise.all(['.sh-name', '.sh-price', '.sh-add'].map((part) => cell.locator(part).boundingBox()))) as DOMRect[];
  expect(price!.y).toBeGreaterThanOrEqual(name!.y + name!.height - 1);
  expect(price!.x + price!.width).toBeLessThanOrEqual(add!.x + 1);
  expect(name!.x + name!.width).toBeLessThanOrEqual(add!.x + 1);
  expect(add!.y).toBeLessThan(price!.y + price!.height);
  expect(add!.y + add!.height).toBeGreaterThan(name!.y);
  // The photo is an arch (round at the top, square at the foot) on the turquoise lattice ground, nothing drawn over it;
  // a stepped corbel hangs under the window of every band but the last.
  const shape = await row.evaluateAll((nodes) =>
    nodes.map((node) => {
      const photo = getComputedStyle(node.querySelector('[data-photo]')!);
      return {
        top: parseFloat(photo.borderStartStartRadius),
        foot: parseFloat(photo.borderEndStartRadius),
        ground: getComputedStyle(node.querySelector('.sh-window')!).backgroundImage,
        photoImage: photo.backgroundImage,
        corbel: getComputedStyle(node, '::after').backgroundImage,
        cellImage: getComputedStyle(node).backgroundImage,
      };
    }),
  );
  expect(shape[0]!.top).toBeGreaterThan(shape[0]!.foot * 4);
  expect(shape[0]!.ground.match(/repeating-linear-gradient/g)?.length).toBe(2);
  expect(shape[0]!.photoImage).toBe('none');
  expect(shape[0]!.cellImage).toBe('none');
  expect(shape[0]!.corbel.match(/linear-gradient/g)?.length).toBe(3);
  expect(shape[2]!.corbel).toBe('none');
  // The gaps between the bands show the lattice ground.
  expect(await page.locator('#cat-viennoiserie [data-screen]').evaluate((node) => getComputedStyle(node).backgroundImage.match(/repeating-linear-gradient/g)?.length)).toBe(2);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('names never break inside a word on the first screen, in English and in Arabic', async ({ page }) => {
  for (const locale of ['en', 'ar']) {
    await openMenu(page, slug, { locale });
    await expect(panes(page).first()).toBeVisible();
    await expectWordsWhole(body(page).locator('#cat-viennoiserie :is(.sh-name, h2 > span), #cat-patisserie :is(.sh-name, h2 > span)'));
    await expectWordsWhole(strip(page).locator('.tpl-arch-label'));
  }
});

test('the price is on a brass tag and the name on the carved cell, each on a solid fill of its own', async ({ page }) => {
  await openMenu(page, slug);
  const pane = paneOf(page, 'croissant');
  const tag = await pane.locator('.sh-price').evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, hole: getComputedStyle(node, '::before').content }));
  expect(tag.image).toBe('none');
  expect(tag.bg).toBe('rgb(226, 176, 74)');
  expect(tag.hole).not.toBe('none');
  const plaque = await pane.evaluate((node) => ({ bg: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage }));
  expect(plaque.image).toBe('none');
  // The wood is the palette's text colour, a step lighter (an oklch value now), still a solid fill.
  expect(plaque.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(await contrastOf(pane.locator('.sh-name'))).toBeGreaterThanOrEqual(4.5);
});

test('nothing in the shape loops: no animation that repeats forever', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  const running = await body(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length);
  expect(running).toBe(0);
});

test('a dish adds from its cell and opens from its name, and tapping the photo or the cell opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await paneOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const pane = (await paneOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(pane.x + pane.width / 2, pane.y + pane.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open panes, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.sh-add')).toHaveCount(0);
  await expectFirstScreen(page, panes(page), { min: 4 });
  const photo = (await panes(page).first().locator('[data-photo]').boundingBox())!;
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
    await expect(row.nth(index).locator('.sh-name')).toBeVisible();
    await expect(row.nth(index).locator('.sh-price')).toContainText('$');
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
  await expect(last.locator('.sh-glass')).toHaveText('25');
  await expect(last.locator('.tpl-arch-label')).toHaveText('Section 25');
});

test('a search that narrows and clears keeps the strip, never moves the focus or the scroll', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(panes(page).first()).toBeVisible();
  expect(await panes(page).count()).toBeLessThan(4);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(panes(page).nth(3)).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('a long dish name and a long price stay inside the cell without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const pane = panes(page).first();
  await pane.locator('.sh-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await pane.locator('.sh-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await pane.locator('.sh-name').evaluate((node) => {
    const style = getComputedStyle(node);
    const inner = node.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    return Math.round(inner / parseFloat(style.lineHeight));
  });
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await pane.boundingBox())!;
  for (const part of ['.sh-price', '.sh-name', '.sh-add', '.sh-window']) {
    const at = (await pane.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await pane.locator('.sh-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(pane.locator('.sh-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the bands run two across in a centred column, mirrored like a pair of oriels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [a, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  const screen = (await page.locator('#cat-viennoiserie [data-screen]').boundingBox())!;
  expect(a.width).toBeLessThan(screen.width / 2);
  expect(a.x).toBeGreaterThan(100);
  // The windows sit at the outer edges of the pair.
  const windowA = (await row.nth(0).locator('.sh-window').boundingBox())!;
  const windowB = (await row.nth(1).locator('.sh-window').boundingBox())!;
  expect(windowA.x).toBeLessThan(a.x + a.width / 2);
  expect(windowB.x).toBeGreaterThan(b.x + b.width / 2);
  await expectFirstScreen(page, page.locator('[data-body="lattice"] [data-row]'), { min: 4 });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the chips too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.sh-glass')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  // The first band's window is at the right (the start), the second band's at the left; on the ledge the tag is at the
  // right and the add at the left; the tag's hole at its right (the start).
  const pane = panes(page).first();
  const add = (await pane.locator('.sh-add').boundingBox())!;
  const tag = (await pane.locator('.sh-price').boundingBox())!;
  expect(tag.x).toBeGreaterThan(add.x);
  expect((await panes(page).first().locator('.sh-window').boundingBox())!.x).toBeGreaterThan((await panes(page).nth(1).locator('.sh-window').boundingBox())!.x);
  const hole = await pane.locator('.sh-price').evaluate((node) => getComputedStyle(node, '::before').right);
  expect(hole).not.toBe('auto');
  expect(parseFloat(hole)).toBeLessThan(10);
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
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    const pane = paneOf(page, 'croissant');
    await expectReadable(menu, {
      'window on the strip': strip(page).locator('[data-pane="rest"]').first(),
      'lit window on the strip': strip(page).locator('[data-pane="active"]'),
      'lit chip frame': strip(page).locator('[aria-current="true"]'),
      'resting chip frame': strip(page).locator('button:not([aria-current])').first(),
      'board name': first.locator('h2 > span'),
      'board count': first.locator('h2 b'),
      'board number': first.locator('h2 small'),
      'cell name': pane.locator('.sh-name'),
      'second cell name': paneOf(page, 'pain-au-chocolat').locator('.sh-name'),
      'section name on a resting chip': strip(page).locator('button:not([aria-current]) .tpl-arch-label').first(),
      'section name on the lit chip': strip(page).locator('[aria-current="true"] .tpl-arch-label'),
      'brass price tag': pane.locator('.sh-price'),
      'add button': pane.locator('.sh-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': pane.locator('.tpl-photo-off'), 'second sale chip': paneOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole pane, its add button and a strip chip', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const pane = panes(page).first();
    const name = pane.locator('.sh-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, pane, { outset: -3, pseudo: '::after' });
    const add = pane.locator('.sh-add');
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
  const pane = panes(page).first();
  const chip = pane.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await pane.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await pane.locator('.sh-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await pane.locator('.sh-price .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the add button is at least 40px square, inside its pane, with the sale chip clear of it', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = body(page).locator('[data-row]').first();
  const add = (await row.locator('.sh-add').boundingBox())!;
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
  await expect(chip.locator('.sh-glass')).toHaveText('5');
});

// ---------------------------------------------------------------------------------------------------------------------
// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the artwork's own).
// ---------------------------------------------------------------------------------------------------------------------
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('shcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'sh', { templateId: 'the-baghdad-shanashil', colors: CUSTOM });
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
const mixHex = (a: string, b: string, amount: number) => {
  const from = rgbOfHex(a);
  const to = rgbOfHex(b);
  return '#' + from.map((channel, at) => Math.round(channel + (to[at]! - channel) * amount).toString(16).padStart(2, '0')).join('');
};
const expectNear = (actual: number[], hex: string, message: string, tolerance = 3) => {
  const want = rgbOfHex(hex);
  actual.forEach((channel, at) => expect(Math.abs(channel - want[at]!), `${message}: channel ${at} is ${channel}, want ~${want[at]}`).toBeLessThanOrEqual(tolerance));
};
const first = (page: Page, selector: string) => page.locator('[data-body="lattice"] ' + selector).first();

test('Customize colours reach the shape: the wood is the text colour, the glass the accent, the carved cream the raised colour', async ({ page }) => {
  await openMenu(page, customSlug);
  expectNear(await rgbOf(first(page, '.sh-title'), 'background-color'), CUSTOM.text, 'header board');
  expectNear(await rgbOf(first(page, '.sh-title'), 'color'), CUSTOM.raised, 'header text');
  expectNear(await rgbOf(first(page, '.sh-title small'), 'background-color'), CUSTOM.accent, 'section number glass');
  expectNear(await rgbOf(first(page, '.sh-name'), 'color'), CUSTOM.raised, 'dish name');
});
