import { expect, test, type Page } from '@playwright/test';
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
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Erbil Citadel body (spec 2026-10-26-menu-styles-in-templates-design.md): a sticky skyline whose house windows are
 * the sections (numbered, lit as the sections come into view, a caption in the sky naming the one in view), and below it
 * each section a terrace: an arched banner, a step, a wider panel of arched-window cards three across.
 */

const menus = bodyMenus();
const slug = menus.slug('cit');
const arabSlug = menus.slug('citar');
const manySlug = menus.slug('citmany');
const offSlug = menus.slug('citoff');
const bareSlug = menus.slug('citbare');
const bareAt = (id: string) => menus.slug(`citbare-${id}`);
const alternatives = paletteIdsOf('the-erbil-citadel').slice(1);
const paletteSlug = (id: string) => menus.slug(`cit-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'cit', { templateId: 'the-erbil-citadel' });
  await menus.create(arabSlug, 'cit', { templateId: 'the-erbil-citadel', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'cit', { templateId: 'the-erbil-citadel', extraSections: 20 });
  await menus.create(offSlug, 'cit', { templateId: 'the-erbil-citadel', ordering: 'none' });
  await menus.create(bareSlug, 'cit', { templateId: 'the-erbil-citadel', noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'cit', { templateId: 'the-erbil-citadel', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'cit', { templateId: 'the-erbil-citadel', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const citadel = (page: Page) => page.locator('[data-body="citadel"]');
const skyline = (page: Page) => citadel(page).locator('[data-skyline]');
const cards = (page: Page) => citadel(page).locator('[data-row]');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const windowOf = (page: Page, categorySlug: string) => skyline(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const paneOf = (button: ReturnType<typeof windowOf>) => button.locator('[data-pane]');

test('on a phone the skyline is at most 110px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(citadel(page)).toBeVisible();
  const box = (await skyline(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(110);
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(skyline(page));
});

test('the skyline is a row of houses, each with a numbered window and a roof of its own, whose windows are the sections', async ({ page }) => {
  await openMenu(page, slug);
  const houses = skyline(page).locator('button');
  await expect(houses).toHaveCount(BODY_CATEGORIES.length);
  const roofs = await skyline(page).locator('.ct-roof').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.roof));
  expect(new Set(roofs).size).toBe(roofs.length);
  await expect(houses.first().locator('.ct-pane')).toHaveText('1');
  await expect(houses.nth(2).locator('.ct-pane')).toHaveText('3');
  const pane = (await houses.first().locator('.ct-pane').boundingBox())!;
  const house = (await houses.first().boundingBox())!;
  expect(house.width).toBeGreaterThanOrEqual(44);
  expect(house.height).toBeGreaterThanOrEqual(44);
  expect(pane.x).toBeGreaterThanOrEqual(house.x);
  // The window is an arch: round at the top, nearly square at the foot.
  const radius = await houses.first().locator('.ct-pane').evaluate((node) => ({ top: getComputedStyle(node).borderTopLeftRadius, foot: getComputedStyle(node).borderBottomLeftRadius }));
  expect(parseFloat(radius.top)).toBeGreaterThan(parseFloat(radius.foot) * 4);
  // The caption in the sky names the section in view.
  await expect(skyline(page).locator('[data-caption]')).toHaveText(BODY_CATEGORIES[0]!.name.en!);
});

test('the windows light as the sections come into view: passed ones lit, the one in view brightest, the rest dark', async ({ page }) => {
  await openMenu(page, slug);
  await expect(paneOf(windowOf(page, 'viennoiserie'))).toHaveAttribute('data-pane', 'active');
  await expect(paneOf(windowOf(page, 'bread'))).toHaveAttribute('data-pane', 'dark');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(paneOf(windowOf(page, 'bread'))).toHaveAttribute('data-pane', 'active');
  await expect(windowOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect(paneOf(windowOf(page, 'viennoiserie'))).toHaveAttribute('data-pane', 'lit');
  await expect(skyline(page).locator('[data-pane="active"]')).toHaveCount(1);
  await expect(skyline(page).locator('[data-caption]')).toHaveText(BODY_CATEGORIES.find((c) => c.slug === 'bread')!.name.en!);
  const lit = await paneOf(windowOf(page, 'viennoiserie')).evaluate((node) => getComputedStyle(node).backgroundColor);
  const dark = await paneOf(windowOf(page, 'bread')).evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(lit).not.toBe(dark);
});

test('a window takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, windowOf(page, 'celebration'), 'celebration');
  await expect(windowOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expect(skyline(page).locator('[data-caption]')).toHaveText(BODY_CATEGORIES.find((c) => c.slug === 'celebration')!.name.en!);
});

test('the skyline stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, skyline(page), windowOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a terrace: an arched banner, a narrower step and a full-width panel, wider as it goes down', async ({ page }) => {
  await openMenu(page, slug);
  const terrace = page.locator('#cat-viennoiserie');
  const banner = (await terrace.locator('h2').boundingBox())!;
  const panel = (await terrace.locator('.ct-grid').boundingBox())!;
  const step = await terrace.locator('[data-heading]').evaluate((node) => {
    const style = getComputedStyle(node, '::after');
    return { margin: parseFloat(style.marginInlineStart), width: node.getBoundingClientRect().width };
  });
  expect(banner.width).toBeLessThan(panel.width - 40);
  expect(step.margin).toBeGreaterThan(0);
  expect(step.width - 2 * step.margin).toBeGreaterThan(banner.width);
  expect(step.width - 2 * step.margin).toBeLessThan(panel.width);
  const radius = await terrace.locator('h2').evaluate((node) => ({ top: getComputedStyle(node).borderTopLeftRadius, foot: getComputedStyle(node).borderBottomLeftRadius }));
  expect(parseFloat(radius.top)).toBeGreaterThan(16);
  expect(parseFloat(radius.foot)).toBe(0);
  await expect(terrace.locator('h2 small')).toHaveText('1');
});

test('dishes are arched-window cards in three columns: the photo in an arch, the name and the price under it', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  const [a, b, c] = [await row.nth(0).boundingBox(), await row.nth(1).boundingBox(), await row.nth(2).boundingBox()] as [DOMRect, DOMRect, DOMRect];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.y - c.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  const card = row.first();
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.ct-name').boundingBox())!;
  const price = (await card.locator('.ct-price').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  const shape = await card.evaluate((node) => ({ card: getComputedStyle(node).borderTopLeftRadius, photo: getComputedStyle(node.querySelector('[data-photo]')!).borderTopLeftRadius, foot: getComputedStyle(node.querySelector('[data-photo]')!).borderBottomLeftRadius }));
  expect(parseFloat(shape.card)).toBeGreaterThan(30);
  expect(parseFloat(shape.photo)).toBeGreaterThan(30);
  expect(parseFloat(shape.foot)).toBeLessThan(10);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its card and opens from its name, and tapping the photo or the card opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cardOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const card = (await cardOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(card.x + card.width / 2, card.y + card.height - 6);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(citadel(page)).toBeVisible();
  await expect(citadel(page).locator('.ct-add')).toHaveCount(0);
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
  expect(await citadel(page).locator('[data-photo] img').count()).toBe(0);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(60);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.ct-name')).toBeVisible();
    await expect(row.nth(index).locator('.ct-price')).toContainText('$');
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

test('a menu of twenty-five sections keeps every window one tap away on a scrolling skyline that keeps the lit window in view', async ({ page }) => {
  await openMenu(page, manySlug);
  const list = skyline(page).locator('ul');
  await expect(skyline(page).locator('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const last = skyline(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
  expect((await skyline(page).boundingBox())!.height).toBeLessThanOrEqual(110);
  await expect(paneOf(last)).toHaveText('25');
});

test('a search that narrows and clears keeps the skyline, never moves the focus or the scroll', async ({ page }) => {
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
  await card.locator('.ct-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.ct-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await card.locator('.ct-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await card.boundingBox())!;
  for (const part of ['.ct-price', '.ct-name', '.ct-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.ct-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.ct-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the cards run four across in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the windows too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(skyline(page).locator('button').nth(1).locator('.ct-pane')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the skyline starts at the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => skyline(p));
  const first = (await skyline(page).locator('button').first().boundingBox())!;
  const last = (await skyline(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  const second = (await cards(page).nth(1).locator('[data-photo]').boundingBox())!;
  expect(photo.x).toBeGreaterThan(second.x);
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
    await expect(skyline(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    const card = cardOf(page, 'croissant');
    await expectReadable(menu, {
      'dark window': skyline(page).locator('[data-pane="dark"]').first(),
      'lit window': skyline(page).locator('[data-pane="lit"], [data-pane="active"]').first(),
      'caption in the sky': skyline(page).locator('[data-caption]'),
      'banner name': first.locator('h2 > span'),
      'banner count': first.locator('h2 b'),
      'banner number': first.locator('h2 small'),
      'card name': card.locator('.ct-name'),
      'card price': card.locator('.ct-price'),
      'card add button': card.locator('.ct-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a window', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.ct-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.ct-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -5 });
    const house = windowOf(page, 'patisserie');
    await house.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(house).toBeFocused();
    await expectFocusRingShows(page, house, { outset: -3 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its card, inside the card, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(citadel(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await card.locator('.ct-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  // The chip and the add button share the foot of the photo without covering each other.
  expect(at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});
