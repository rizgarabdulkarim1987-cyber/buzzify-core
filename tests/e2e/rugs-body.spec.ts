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
 * The Jajim and Nowruz body (the themed-kurd mockup, spec 2026-10-26-menu-styles-in-templates-design.md): a Kurdish
 * evening. A header scene (dusk sky, mountains, the Nowruz fire), a saffron kilim band, a sticky strip of red-bordered
 * tabs, a line of dancers holding hands, then each section a red title over dish cards two across: a jajim-striped
 * border, the photo, the name, the green add and the price, a red fringe under the card.
 */

const TEMPLATE = 'the-jajim-and-nowruz';
const menus = bodyMenus();
const slug = menus.slug('rug');
const promoSlug = menus.slug('rugoffer');
const arabSlug = menus.slug('rugar');
const manySlug = menus.slug('rugmany');
const offSlug = menus.slug('rugoff');
const crowdSlug = menus.slug('rugcrowd');
const bareSlug = menus.slug('rugbare');
const bareAt = (id: string) => menus.slug(`rugbare-${id}`);
const alternatives = paletteIdsOf(TEMPLATE).slice(1);
const paletteSlug = (id: string) => menus.slug(`rug-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'rug', { templateId: TEMPLATE });
  await menus.create(promoSlug, 'rug', { templateId: TEMPLATE, discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'rug', { templateId: TEMPLATE, numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'rug', { templateId: TEMPLATE, extraSections: 20 });
  await menus.create(offSlug, 'rug', { templateId: TEMPLATE, ordering: 'none' });
  await menus.create(crowdSlug, 'rug', { templateId: TEMPLATE, crowd: 6 });
  await menus.create(bareSlug, 'rug', { templateId: TEMPLATE, noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'rug', { templateId: TEMPLATE, paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'rug', { templateId: TEMPLATE, paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="rugs"]');
const strip = (page: Page) => body(page).locator('[data-tabs]');
const cards = (page: Page) => body(page).locator('.rg-card');
const everyDish = (page: Page) => body(page).locator('[data-row]');
const scene = (page: Page) => body(page).locator('.rg-scene');
const dance = (page: Page) => body(page).locator('.rg-dance');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const tabOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.locator('.rg-card').getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const navRoom = (page: Page) => body(page).evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) * parseFloat(getComputedStyle(document.documentElement).fontSize));

test('on a phone the first screen shows the scene, the tabs and cards with photos and prices, and every section is one tap away', async ({ page }) => {
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
  // The scene is about 104px of it, the strip and the dancers 100px more: a section of many dishes still shows four, the search too.
  await expectFirstScreen(page, everyDish(page), { min: 4 });
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu the page still draws its scene and cards, two dishes on the first screen', async ({ page }) => {
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

test('the scene is a dusk sky with two ranges of mountains and the fire, over a kilim band; the dancers stand on a line of eleven', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const sky = body(page).locator('.rg-sky');
  expect(await sky.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  await expect(sky.locator('svg path')).toHaveCount(2);
  await expect(sky.locator('.rg-fire i:not(.rg-spark)')).toHaveCount(3);
  expect((await sky.boundingBox())!.width).toBeGreaterThanOrEqual(389);
  expect(await body(page).locator('.rg-kilim').first().evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  await expect(dance(page).locator('svg')).toHaveCount(11);
  const first = (await dance(page).locator('svg').first().boundingBox())!;
  const last = (await dance(page).locator('svg').last().boundingBox())!;
  expect(first.x).toBeGreaterThanOrEqual(0);
  expect(last.x + last.width).toBeLessThanOrEqual(390);
  expect(Math.abs(first.y - last.y)).toBeLessThanOrEqual(1);
});

test('the scene and the dancers step aside for a search and come back, and do not move again', async ({ page }) => {
  await openMenu(page, slug);
  await expect(scene(page)).toBeVisible();
  await expect(body(page)).toHaveAttribute('data-still', '', { timeout: 8000 });
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(scene(page)).toBeHidden();
  await expect(dance(page)).toBeHidden();
  await search.fill('');
  await expect(scene(page)).toBeVisible();
  expect(await body(page).evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('the strip is a row of red-bordered tabs: the section name on each, 44px to tap, the lit one filled red', async ({ page }) => {
  await openMenu(page, slug);
  const tabs = strip(page).locator('button');
  await expect(tabs).toHaveCount(BODY_CATEGORIES.length);
  expect((await tabs.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(tabs.first()).toContainText(BODY_CATEGORIES[0]!.name.en!);
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  expect(await tabs.first().evaluate((node) => parseFloat(getComputedStyle(node).borderTopWidth))).toBeGreaterThanOrEqual(2);
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

test('dishes are framed cards two across: a jajim stripe border, the photo, the name under it, then the add and the price', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie .rg-card');
  await expect(row).toHaveCount(3);
  const [a, b, c] = [await row.nth(0).boundingBox(), await row.nth(1).boundingBox(), await row.nth(2).boundingBox()] as [DOMRect, DOMRect, DOMRect];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(a.y + a.height);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  const card = row.first();
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.rg-name').boundingBox())!;
  const price = (await card.locator('.rg-price').boundingBox())!;
  const add = (await card.locator('.rg-add').boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(130);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 2);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 2);
  expect(Math.abs(add.y + add.height / 2 - (price.y + price.height / 2))).toBeLessThanOrEqual(8);
  const look = await card.evaluate((node) => ({ border: parseFloat(getComputedStyle(node).borderTopWidth), image: getComputedStyle(node).borderImageSource }));
  expect(look.border).toBeGreaterThanOrEqual(3);
  expect(look.image).toContain('repeating-linear-gradient');
  expect(await card.evaluate((node) => getComputedStyle(node, '::after').backgroundImage)).toContain('repeating-linear-gradient');
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
  await expect(body(page).locator('.rg-add')).toHaveCount(0);
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
    await expect(row.nth(index).locator('.rg-name')).toBeVisible();
    await expect(row.nth(index).locator('.rg-price')).toContainText('$');
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
  await card.locator('.rg-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.rg-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await card.boundingBox())!;
  for (const part of ['.rg-price', '.rg-name', '.rg-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.rg-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.rg-price'))).toBeGreaterThanOrEqual(4.5);
});

test('the add button is at least 40px square and inside its card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  for (const at of [0, 1]) {
    const cell = page.locator('#cat-viennoiserie [data-row]').nth(at);
    const [add, box] = [(await cell.locator('.rg-add').boundingBox())!, (await cell.boundingBox())!];
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
  await card.locator('.rg-name').evaluate((node) => {
    node.textContent = 'مشروب الشوكولاتة الساخنة بالحليب والقرفة والزنجبيل مع الكريمة المخفوقة والمكسرات';
  });
  const box = (await card.boundingBox())!;
  const name = (await card.locator('.rg-name').boundingBox())!;
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
      'card name': card.locator('.rg-name'),
      'card price': card.locator('.rg-price'),
      'card add button': card.locator('.rg-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.rg-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.rg-add');
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
  await expect(body(page).locator('.rg-card .tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.rg-price .sr-only')).toContainText(/\d|[٠-٩]/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the fire and the dancers move for a few seconds, never past five, and never with reduced motion', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.rg-dancer').first()).toHaveCSS('animation-name', 'rg-dabke');
  await expectMotionEnds(body(page));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(body(page).locator('.rg-dancer').first()).toHaveCSS('animation-name', 'none');
  await expect(body(page).locator('.rg-fire i').first()).toHaveCSS('animation-name', 'none');
});

// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the scene's own dyes).
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('rgcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'rg', { templateId: TEMPLATE, colors: CUSTOM });
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
const first = (page: Page, selector: string) => page.locator('[data-body="rugs"] ' + selector).first();

test('Customize colours reach the shape: the page, the card, the ink and the lit tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, customSlug);
  expectNear(await rgbOf(body(page), 'background-color'), CUSTOM.bg, 'page');
  expectNear(await rgbOf(first(page, '.rg-card'), 'background-color'), CUSTOM.raised, 'card');
  expectNear(await rgbOf(first(page, '.rg-name'), 'color'), CUSTOM.text, 'dish name');
  expectNear(await rgbOf(first(page, '.rg-tab[aria-current="true"]'), 'background-color'), CUSTOM.accent, 'lit tab');
  expectNear(await rgbOf(first(page, '.rg-tab[aria-current="true"]'), 'color'), CUSTOM.onAccent, 'lit tab ink');
});
