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
  expectOpensProduct,
  expectPlatePainted,
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Baghdad Shanashil body (the themed-shn mockup, spec 2026-10-26-menu-styles-in-templates-design.md): old Baghdad's
 * oriel windows at dusk. A header of a Tigris sky with three swinging brass lamps and a flowing river, a dark wooden strip
 * of tabs, then each section a title over arched cards two across (a dark carved plank, a brass-framed arched window
 * with the photo behind two lattice shutters that open once, the name, then the price and the add).
 */

const TEMPLATE = 'the-baghdad-shanashil';
const menus = bodyMenus();
const slug = menus.slug('shn');
const promoSlug = menus.slug('shnoffer');
const arabSlug = menus.slug('shnar');
const manySlug = menus.slug('shnmany');
const offSlug = menus.slug('shnoff');
const crowdSlug = menus.slug('shncrowd');
const bareSlug = menus.slug('shnbare');
const bareAt = (id: string) => menus.slug(`rugbare-${id}`);
const alternatives = paletteIdsOf(TEMPLATE).slice(1);
const paletteSlug = (id: string) => menus.slug(`rug-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'shn', { templateId: TEMPLATE });
  await menus.create(promoSlug, 'shn', { templateId: TEMPLATE, discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'shn', { templateId: TEMPLATE, numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'shn', { templateId: TEMPLATE, extraSections: 20 });
  await menus.create(offSlug, 'shn', { templateId: TEMPLATE, ordering: 'none' });
  await menus.create(crowdSlug, 'shn', { templateId: TEMPLATE, crowd: 6 });
  await menus.create(bareSlug, 'shn', { templateId: TEMPLATE, noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'shn', { templateId: TEMPLATE, paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'shn', { templateId: TEMPLATE, paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="lattice"]');
const strip = (page: Page) => body(page).locator('[data-oriels]');
const cards = (page: Page) => body(page).locator('.sh-card');
const everyDish = (page: Page) => body(page).locator('[data-row]');
const scene = (page: Page) => body(page).locator('.sh-sky');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const tabOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.locator('.sh-card').getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const navRoom = (page: Page) => body(page).evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) * parseFloat(getComputedStyle(document.documentElement).fontSize));

test('on a phone the first screen shows the sky, the tabs and cards with photos and prices, and every section is one tap away', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, crowdSlug);
  await expect(scene(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(await navRoom(page));
  // The Maison demo card, the offers and the filter chips above the menu take most of the first screen by themselves: they are hidden for the count.
  await page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
  });
  // The sky is 104px of it and the strip 52px more: a section of many dishes still shows four, the search too.
  await expectFirstScreen(page, everyDish(page), { min: 4 });
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu the page still draws its sky and cards, two dishes on the first screen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expect(scene(page)).toBeVisible();
  // The offers banner stays; the Maison demo card and the filter chips are hidden.
  await page.evaluate(() => {
    document.querySelector('.tpl-promo')?.setAttribute('style', 'display:none');
    document.querySelector('.tpl-tools > :nth-child(2)')?.setAttribute('style', 'display:none');
  });
  await expectFirstScreen(page, everyDish(page), { min: 2 });
});

test('the header is a dusk sky with three brass lamps and a river of two waves; the sky steps aside for a search and comes back without moving again', async ({ page }) => {
  await openMenu(page, slug);
  const sky = body(page).locator('.sh-sky');
  await expect(sky).toBeVisible();
  expect(await sky.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  await expect(sky.locator('.sh-lamp')).toHaveCount(3);
  await expect(sky.locator('.sh-river path')).toHaveCount(2);
  expect((await sky.boundingBox())!.width).toBeGreaterThanOrEqual(389);
  await expect(body(page)).toHaveAttribute('data-still', '', { timeout: 9000 });
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(sky).toBeHidden();
  await search.fill('');
  await expect(sky).toBeVisible();
  expect(await sky.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('each card has two lattice shutters over its window: closed until the card is first seen, then they swing open once; none are drawn with reduced motion', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await expect(body(page)).toHaveAttribute('data-armed', '');
  const card = cards(page).first();
  await expect(card).toHaveAttribute('data-open', '');
  await expect(card.locator('.sh-shutter')).toHaveCount(2);
  await expect(card.locator('.sh-shutter').first()).toHaveCSS('transition-property', 'transform');
  const leaf = (c: Locator) => c.locator('.sh-shutter').evaluateAll((nodes) => Math.max(...nodes.map((node) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).m11))));
  // Opened: the leaves stand edge-on, so the photo shows through the window.
  await expect.poll(() => leaf(card), { timeout: 4000 }).toBeLessThan(0.4);
  // A card further down is still closed (the leaves face the viewer) until it comes into view.
  const last = cards(page).last();
  await expect(last).not.toHaveAttribute('data-open', '');
  expect(await leaf(last)).toBeGreaterThan(0.99);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute('data-open', '');
  await expect.poll(() => leaf(last), { timeout: 4000 }).toBeLessThan(0.4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(card.locator('.sh-shutter').first()).toBeHidden();
});

test('the strip is a row of wooden tabs: the section name on each, 44px to tap, the lit one turquoise', async ({ page }) => {
  await openMenu(page, slug);
  const tabs = strip(page).locator('button');
  await expect(tabs).toHaveCount(BODY_CATEGORIES.length);
  expect((await tabs.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(tabs.first()).toContainText(BODY_CATEGORIES[0]!.name.en!);
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('a tab takes you to its section and focuses the heading, and the tab lights', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, tabOf(page, 'celebration'), 'celebration');
  await expect(tabOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('the strip stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), tabOf(page, 'viennoiserie'), 'viennoiserie');
});

test('dishes are arched cards two across: the brass-framed window with the photo, the name under it, then the price and the add', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie .sh-card');
  await expect(row).toHaveCount(3);
  const [a, b, c] = [await row.nth(0).boundingBox(), await row.nth(1).boundingBox(), await row.nth(2).boundingBox()] as [DOMRect, DOMRect, DOMRect];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(a.y + a.height);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  const card = row.first();
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.sh-name').boundingBox())!;
  const price = (await card.locator('.sh-price').boundingBox())!;
  const add = (await card.locator('.sh-add').boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(130);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 2);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 2);
  expect(Math.abs(add.y + add.height / 2 - (price.y + price.height / 2))).toBeLessThanOrEqual(24);
  const look = await card.evaluate((node) => ({ arch: parseFloat(getComputedStyle(node).borderStartStartRadius), tail: parseFloat(getComputedStyle(node).borderEndStartRadius), frame: parseFloat(getComputedStyle(node.querySelector('.sh-window')!).borderTopWidth) }));
  expect(look.arch).toBeGreaterThanOrEqual(60);
  expect(look.tail).toBeLessThanOrEqual(10);
  expect(look.frame).toBeGreaterThanOrEqual(3);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its card and opens from its name, and tapping the photo or the cell opens it too, without adding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cardOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows dishes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.sh-add')).toHaveCount(0);
  await expectFirstScreen(page, everyDish(page), { min: 1 });
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates and a working add', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  expect(await body(page).locator('[data-photo] img').count()).toBe(0);
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

test('a menu of twenty-five sections keeps every tab one tap away on a scrolling strip that keeps the lit tab in view', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(await navRoom(page));
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
  await card.locator('.sh-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.sh-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await card.boundingBox())!;
  for (const part of ['.sh-price', '.sh-name', '.sh-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.sh-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.sh-price'))).toBeGreaterThanOrEqual(4.5);
});

test('the add button is at least 40px square and inside its card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  for (const at of [0, 1]) {
    const cell = page.locator('#cat-viennoiserie [data-row]').nth(at);
    const [add, box] = [(await cell.locator('.sh-add').boundingBox())!, (await cell.boundingBox())!];
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    expect(add.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('on a wide screen the cards run three across, nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  const c = (await row.nth(2).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.y - c.y)).toBeLessThanOrEqual(1);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('in Arabic the page is right to left, the strip starts at the right, the cards run from the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const one = (await cards(page).first().boundingBox())!;
  const two = (await cards(page).nth(1).boundingBox())!;
  expect(one.x).toBeGreaterThan(two.x);
});

test('in Arabic a long dish name stays inside its card', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  const card = cards(page).first();
  await card.locator('.sh-name').evaluate((node) => {
    node.textContent = 'مشروب الشوكولاتة الساخنة بالحليب والقرفة والزنجبيل مع الكريمة المخفوقة والمكسرات';
  });
  const box = (await card.boundingBox())!;
  const name = (await card.locator('.sh-name').boundingBox())!;
  expect(name.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(name.x + name.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
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
    const card = cardOf(page, 'croissant');
    await expectReadable(menu, {
      'lit tab': strip(page).locator('button[aria-current="true"]'),
      'resting tab': strip(page).locator('button:not([aria-current="true"])').first(),
      'section title': page.locator('#cat-viennoiserie h2'),
      'card name': card.locator('.sh-name'),
      'card price': card.locator('.sh-price'),
      'card add button': card.locator('.sh-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.sh-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.sh-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: 3 });
    const tab = tabOf(page, 'patisserie');
    await tab.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(tab).toBeFocused();
    await expectFocusRingShows(page, tab, { outset: -4 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its card, inside the cell, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.sh-card .tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.sh-price .sr-only')).toContainText(/\d|[٠-٩]/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the lamps, the river and the shutters move for a few seconds, never past five, and never with reduced motion', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.sh-lamp').first()).toHaveCSS('animation-name', 'sh-sway');
  await expectMotionEnds(body(page));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(body(page).locator('.sh-lamp').first()).toHaveCSS('animation-name', 'none');
  await expect(body(page).locator('.sh-river')).toHaveCSS('animation-name', 'none');
});

// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the scene's own dyes).
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('rgcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'shn', { templateId: TEMPLATE, colors: CUSTOM });
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
const expectNear = (actual: number[], hex: string, message: string, tolerance = 3) => {
  const want = rgbOfHex(hex);
  actual.forEach((channel, at) => expect(Math.abs(channel - want[at]!), `${message}: channel ${at} is ${channel}, want ~${want[at]}`).toBeLessThanOrEqual(tolerance));
};
const first = (page: Page, selector: string) => page.locator('[data-body="lattice"] ' + selector).first();

test('Customize colours reach the shape: the page, the wood, the carved cream, the glass add and the lit tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, customSlug);
  expectNear(await rgbOf(body(page), 'background-color'), CUSTOM.bg, 'page');
  expectNear(await rgbOf(first(page, '.sh-card'), 'background-color'), CUSTOM.text, 'wood card');
  expectNear(await rgbOf(first(page, '.sh-name'), 'color'), CUSTOM.raised, 'dish name');
  expectNear(await rgbOf(first(page, '.sh-add'), 'background-color'), CUSTOM.accent, 'add');
  expectNear(await rgbOf(first(page, '.sh-tab[aria-current="true"]'), 'background-color'), CUSTOM.accent, 'lit tab');
  expectNear(await rgbOf(first(page, '.sh-tab[aria-current="true"]'), 'color'), CUSTOM.onAccent, 'lit tab ink');
});
