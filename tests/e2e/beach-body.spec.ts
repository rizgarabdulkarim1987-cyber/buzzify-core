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
 * The Summer Beach body (the themed-sum mockup, spec 2026-10-26-menu-styles-in-templates-design.md): a day at the sea. A
 * sky that runs blue to sand, a header of a sun with turning rays over two drifting waves, a sticky strip of white pills,
 * then each section a title over white cards two across (the top rounded, the foot scalloped, the photo, the name, the
 * price and the orange add) that bounce up into place when first seen.
 */

const TEMPLATE = 'the-summer-beach';
const menus = bodyMenus();
const slug = menus.slug('sum');
const promoSlug = menus.slug('sumoffer');
const arabSlug = menus.slug('sumar');
const manySlug = menus.slug('summany');
const offSlug = menus.slug('sumoff');
const crowdSlug = menus.slug('sumcrowd');
const bareSlug = menus.slug('sumbare');
const bareAt = (id: string) => menus.slug(`rugbare-${id}`);
const alternatives = paletteIdsOf(TEMPLATE).slice(1);
const paletteSlug = (id: string) => menus.slug(`rug-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'sum', { templateId: TEMPLATE });
  await menus.create(promoSlug, 'sum', { templateId: TEMPLATE, discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'sum', { templateId: TEMPLATE, numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'sum', { templateId: TEMPLATE, extraSections: 20 });
  await menus.create(offSlug, 'sum', { templateId: TEMPLATE, ordering: 'none' });
  await menus.create(crowdSlug, 'sum', { templateId: TEMPLATE, crowd: 6 });
  await menus.create(bareSlug, 'sum', { templateId: TEMPLATE, noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'sum', { templateId: TEMPLATE, paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'sum', { templateId: TEMPLATE, paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="beach"]');
const strip = (page: Page) => body(page).locator('[data-pills]');
const cards = (page: Page) => body(page).locator('.bc-card');
const everyDish = (page: Page) => body(page).locator('[data-row]');
const scene = (page: Page) => body(page).locator('.bc-sky');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const pillOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.locator('.bc-card').getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const navRoom = (page: Page) => body(page).evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) * parseFloat(getComputedStyle(document.documentElement).fontSize));

test('on a phone the first screen shows the sky, the pills and cards with photos and prices, and every section is one tap away', async ({ page }) => {
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
  // The sky is 108px of it and the strip 54px more: a section of many dishes still shows four, the search too.
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

test('the header is a sun with rays over two waves; the sky steps aside for a search and comes back without moving again', async ({ page }) => {
  await openMenu(page, slug);
  const sky = body(page).locator('.bc-sky');
  await expect(sky).toBeVisible();
  expect(await body(page).evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  expect(await sky.locator('.bc-sun').evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('repeating-conic-gradient');
  await expect(sky.locator('.bc-waves svg')).toHaveCount(2);
  expect((await sky.boundingBox())!.width).toBeGreaterThanOrEqual(389);
  await expect(body(page)).toHaveAttribute('data-still', '', { timeout: 9000 });
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(sky).toBeHidden();
  await search.fill('');
  await expect(sky).toBeVisible();
  expect(await sky.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('a card waits below its place until it is first seen and then bounces up once; the first screen comes up on arrival; reduced motion shows every card at once', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await expect(body(page)).toHaveAttribute('data-armed', '');
  const first = cards(page).first();
  await expect(first).toHaveAttribute('data-in', '');
  await expect(first).toHaveCSS('opacity', '1');
  const last = cards(page).last();
  await expect(last).not.toHaveAttribute('data-in', '');
  await expect(last).toHaveCSS('opacity', '0');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute('data-in', '');
  await expect(last).toHaveCSS('opacity', '1', { timeout: 3000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(cards(page).last()).toHaveCSS('opacity', '1');
});

test('the strip is a row of white pills: the section name on each, 44px to tap, the lit one orange', async ({ page }) => {
  await openMenu(page, slug);
  const pills = strip(page).locator('button');
  await expect(pills).toHaveCount(BODY_CATEGORIES.length);
  expect((await pills.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(pills.first()).toContainText(BODY_CATEGORIES[0]!.name.en!);
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('a tab takes you to its section and focuses the heading, and the tab lights', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, pillOf(page, 'celebration'), 'celebration');
  await expect(pillOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('the strip stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), pillOf(page, 'viennoiserie'), 'viennoiserie');
});

test('dishes are white cards two across: the photo, the name under it, then the price and the add; the top is rounded and the foot scalloped', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie .bc-card');
  await expect(row).toHaveCount(3);
  const [a, b, c] = [await row.nth(0).boundingBox(), await row.nth(1).boundingBox(), await row.nth(2).boundingBox()] as [DOMRect, DOMRect, DOMRect];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(a.y + a.height);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  const card = row.first();
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.bc-name').boundingBox())!;
  const price = (await card.locator('.bc-price').boundingBox())!;
  const add = (await card.locator('.bc-add').boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(130);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 2);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 2);
  expect(Math.abs(add.y + add.height / 2 - (price.y + price.height / 2))).toBeLessThanOrEqual(24);
  const look = await card.evaluate((node) => ({ top: parseFloat(getComputedStyle(node).borderStartStartRadius), foot: parseFloat(getComputedStyle(node).borderEndStartRadius), mask: getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage, photo: parseFloat(getComputedStyle(node.querySelector('[data-photo]')!).borderTopLeftRadius) }));
  expect(look.top).toBeGreaterThanOrEqual(20);
  expect(look.foot).toBe(0);
  expect(look.mask).toContain('radial-gradient');
  expect(look.photo).toBeGreaterThanOrEqual(14);
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
  await expect(body(page).locator('.bc-add')).toHaveCount(0);
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
  await card.locator('.bc-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.bc-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await card.boundingBox())!;
  for (const part of ['.bc-price', '.bc-name', '.bc-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.bc-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.bc-price'))).toBeGreaterThanOrEqual(4.5);
});

test('the add button is at least 40px square and inside its card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  for (const at of [0, 1]) {
    const cell = page.locator('#cat-viennoiserie [data-row]').nth(at);
    const [add, box] = [(await cell.locator('.bc-add').boundingBox())!, (await cell.boundingBox())!];
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
  await card.locator('.bc-name').evaluate((node) => {
    node.textContent = 'مشروب الشوكولاتة الساخنة بالحليب والقرفة والزنجبيل مع الكريمة المخفوقة والمكسرات';
  });
  const box = (await card.boundingBox())!;
  const name = (await card.locator('.bc-name').boundingBox())!;
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
      'card name': card.locator('.bc-name'),
      'card price': card.locator('.bc-price'),
      'card add button': card.locator('.bc-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.bc-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.bc-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: 3 });
    const tab = pillOf(page, 'patisserie');
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
  await expect(body(page).locator('.bc-card .tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.bc-price .sr-only')).toContainText(/\d|[٠-٩]/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the sun and the waves move for a few seconds, never past five, and never with reduced motion', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.bc-sun')).toHaveCSS('animation-name', 'bc-spin');
  await expectMotionEnds(body(page));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(body(page).locator('.bc-sun')).toHaveCSS('animation-name', 'none');
  await expect(body(page).locator('.bc-waves svg').first()).toHaveCSS('animation-name', 'none');
});

// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the scene's own dyes).
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('rgcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'sum', { templateId: TEMPLATE, colors: CUSTOM });
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
const first = (page: Page, selector: string) => page.locator('[data-body="beach"] ' + selector).first();

test('Customize colours reach the shape: the card, the ink, the orange add and the lit pill', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, customSlug);
  expectNear(await rgbOf(first(page, '.bc-card'), 'background-color'), CUSTOM.card, 'card');
  expectNear(await rgbOf(first(page, '.bc-name'), 'color'), CUSTOM.text, 'dish name');
  expectNear(await rgbOf(first(page, '.bc-add'), 'background-color'), CUSTOM.accent, 'add');
  expectNear(await rgbOf(first(page, '.bc-pill[aria-current="true"]'), 'background-color'), CUSTOM.accent, 'lit pill');
  expectNear(await rgbOf(first(page, '.bc-pill[aria-current="true"]'), 'color'), CUSTOM.onAccent, 'lit pill ink');
  expectNear(await rgbOf(first(page, '.bc-pill:not([aria-current="true"])'), 'background-color'), CUSTOM.card, 'resting pill');
});
