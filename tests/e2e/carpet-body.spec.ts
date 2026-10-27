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
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The One Thousand and One Nights body (spec 2026-10-26-menu-styles-in-templates-design.md): a purple night sky of static
 * stars (a slow twinkle), where every section is a magic carpet: a woven band with a tassel fringe at both ends, its
 * title embroidered on the front fringe, and the dishes as round medallions (a gold ring, the name under, the price in a
 * gold-edged tag) three across. A sticky strip of rolled-carpet chips jumps to a carpet; the carpet in view floats.
 */

const menus = bodyMenus();
const slug = menus.slug('lyl');
const promoSlug = menus.slug('lyloffer');
const arabSlug = menus.slug('lylar');
const manySlug = menus.slug('lylmany');
const offSlug = menus.slug('lyloff');
const bareSlug = menus.slug('lylbare');
const alternatives = paletteIdsOf('the-thousand-and-one-nights').slice(1);
const paletteSlug = (id: string) => menus.slug(`lyl-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'lyl', { templateId: 'the-thousand-and-one-nights' });
  await menus.create(promoSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'lyl', { templateId: 'the-thousand-and-one-nights', extraSections: 20 });
  await menus.create(offSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', ordering: 'none' });
  await menus.create(bareSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'lyl', { templateId: 'the-thousand-and-one-nights', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="carpet"]');
const strip = (page: Page) => body(page).locator('[data-rolls]');
const cards = (page: Page) => body(page).locator('[data-row]');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const rollOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// The carpet in view floats for ever, and Playwright clicks only a still target: the click tests below run with reduced
// motion (which stops the float, and is a mode guests really use); the float itself is tested with motion on.
test('on a phone the strip is at most 64px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the first screen still shows at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 2 });
});

test('the strip is a row of rolled carpets: a rolled-carpet icon and the section name on each chip, 44px to tap', async ({ page }) => {
  await openMenu(page, slug);
  const rolls = strip(page).locator('button');
  await expect(rolls).toHaveCount(BODY_CATEGORIES.length);
  await expect(strip(page).locator('.cp-roll-icon')).toHaveCount(BODY_CATEGORIES.length);
  const icon = (await rolls.first().locator('.cp-roll-icon').boundingBox())!;
  expect(icon.width).toBeGreaterThan(14);
  // The roll is drawn, not an emoji or an image: a body of stripes and a spiral end.
  const drawn = await rolls.first().locator('.cp-roll-icon').evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, end: getComputedStyle(node, '::after').content }));
  expect(drawn.image).toContain('gradient');
  expect(drawn.end).not.toBe('none');
  expect((await rolls.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(rolls.first()).toContainText(BODY_CATEGORIES[0]!.name.en!);
});

test('a roll takes you to its carpet and focuses the heading, and the roll lights', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, rollOf(page, 'celebration'), 'celebration');
  await expect(rollOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('the strip stays at the top: scrolled to the end, the first carpet is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), rollOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a carpet: a woven band with rounded corners, a tassel fringe at both inline ends, and its title embroidered on the front edge above the dishes', async ({ page }) => {
  await openMenu(page, slug);
  const carpet = page.locator('#cat-viennoiserie');
  const rug = carpet.locator('.cp-rug');
  const woven = await rug.evaluate((node) => ({ weave: getComputedStyle(node, '::before').backgroundImage, radius: getComputedStyle(node).borderBottomLeftRadius }));
  expect(woven.weave).toContain('repeating-linear-gradient');
  expect(parseFloat(woven.radius)).toBeGreaterThan(8);
  const tassels = await rug.locator('.cp-tassel').evaluateAll((nodes) => nodes.map((node) => ({ box: node.getBoundingClientRect(), image: getComputedStyle(node).backgroundImage })));
  expect(tassels).toHaveLength(2);
  for (const tassel of tassels) expect(tassel.image).toContain('repeating-linear-gradient');
  const band = (await rug.boundingBox())!;
  const [one, two] = [...tassels].sort((a, b) => a.box.x - b.box.x);
  expect(one!.box.x + one!.box.width).toBeLessThanOrEqual(band.x + 2);
  expect(two!.box.x).toBeGreaterThanOrEqual(band.x + band.width - 2);
  expect(one!.box.x).toBeGreaterThanOrEqual(0);
  expect(two!.box.x + two!.box.width).toBeLessThanOrEqual(390);
  // The title sits on the fringe before the dishes, with the carpet's number and its dish count.
  const title = (await carpet.locator('h2').boundingBox())!;
  const first = (await carpet.locator('[data-row]').first().boundingBox())!;
  expect(title.y + title.height).toBeLessThanOrEqual(first.y + 1);
  expect(title.width).toBeGreaterThan(band.width * 0.5);
  await expect(carpet.locator('h2 small')).toHaveText('1');
  await expect(carpet.locator('h2 [data-count]')).toHaveText('3');
});

test('the sky is static stars (radial gradients) with a twinkle layer that fades slowly, and no twinkle with reduced motion', async ({ page }) => {
  await openMenu(page, slug);
  const sky = await body(page).evaluate((node) => ({ image: getComputedStyle(node).backgroundImage, twinkle: getComputedStyle(node, '::before').animationName, content: getComputedStyle(node, '::before').content }));
  expect(sky.image).toContain('radial-gradient');
  expect(sky.content).not.toBe('none');
  expect(sky.twinkle).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await body(page).evaluate((node) => getComputedStyle(node, '::before').animationName);
  expect(still).toBe('none');
});

test('only the carpet in view floats a few pixels; the others lie still, and with reduced motion none floats', async ({ page }) => {
  await openMenu(page, slug);
  const lit = page.locator('.cp-carpet[data-lit]');
  await expect(lit).toHaveCount(1);
  await expect(lit).toHaveAttribute('id', 'cat-viennoiserie');
  const names = await page.locator('.cp-carpet').evaluateAll((nodes) => nodes.map((node) => [node.id, getComputedStyle(node).animationName]));
  for (const [id, name] of names) expect(name === 'none', id).toBe(id !== 'cat-viennoiserie');
  await rollOf(page, 'bread').click();
  await expect(page.locator('.cp-carpet[data-lit]')).toHaveAttribute('id', 'cat-bread');
  expect(await page.locator('#cat-viennoiserie').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  // The float stays within a few pixels.
  const travel = await page.locator('#cat-bread').evaluate((node) => {
    const frames = (node.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
    return frames.map((frame) => String(frame.transform ?? 'none'));
  });
  expect(travel.length).toBeGreaterThan(1);
  for (const transform of travel) {
    const shift = Math.abs(parseFloat(/translateY\((-?[\d.]+)px\)/.exec(transform)?.[1] ?? '0'));
    expect(shift).toBeLessThanOrEqual(3);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#cat-bread').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('dishes are round medallions in three columns: a gold-ringed round photo, the price in a gold-edged tag across its foot, the name under it', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  const [a, b, c] = [await row.nth(0).boundingBox(), await row.nth(1).boundingBox(), await row.nth(2).boundingBox()] as [DOMRect, DOMRect, DOMRect];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.y - c.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  const card = row.first();
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.cp-name').boundingBox())!;
  const price = (await card.locator('.cp-price').boundingBox())!;
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  expect(photo.width).toBeGreaterThanOrEqual(84);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 2);
  // The tag straddles the photo's foot, centred on it, and the name starts below the tag.
  expect(price.y).toBeGreaterThan(photo.y + photo.height * 0.8);
  expect(price.y + price.height).toBeGreaterThan(photo.y + photo.height);
  expect(Math.abs(price.x + price.width / 2 - (photo.x + photo.width / 2))).toBeLessThanOrEqual(2);
  expect(name.y).toBeGreaterThanOrEqual(price.y + price.height - 2);
  const ring = await card.locator('[data-photo]').evaluate((node) => ({ radius: getComputedStyle(node).borderTopLeftRadius, width: parseFloat(getComputedStyle(node).borderTopWidth) }));
  expect(parseFloat(ring.radius)).toBeGreaterThanOrEqual(photo.width / 2 - 1);
  expect(ring.width).toBeGreaterThanOrEqual(2);
  const tag = await card.locator('.cp-price').evaluate((node) => parseFloat(getComputedStyle(node).borderTopWidth));
  expect(tag).toBeGreaterThanOrEqual(1);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its medallion and opens from its name, and tapping the photo or the cell opens it too, without adding', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cardOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const cell = (await cardOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open medallions, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.cp-add')).toHaveCount(0);
  await expectFirstScreen(page, cards(page), { min: 4 });
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
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(60);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.cp-name')).toBeVisible();
    await expect(row.nth(index).locator('.cp-price')).toContainText('$');
  }
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a menu of twenty-five sections keeps every roll one tap away on a scrolling strip that keeps the lit roll in view', async ({ page }) => {
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
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(64);
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

test('a long dish name and a long price stay inside the medallion without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const card = cards(page).first();
  await card.locator('.cp-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.cp-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await card.locator('.cp-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await card.boundingBox())!;
  for (const part of ['.cp-price', '.cp-name', '.cp-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.cp-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.cp-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the medallions run in a centred column, side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the carpet titles too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, the dishes run from the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const one = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  const two = (await cards(page).nth(1).locator('[data-photo]').boundingBox())!;
  expect(one.x).toBeGreaterThan(two.x);
  // The fringe still frames the band on both sides, and nothing is clipped past the screen.
  const tassels = await page.locator('#cat-viennoiserie .cp-tassel').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
  for (const box of tassels) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test('in Arabic a long dish name stays inside its medallion', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  const card = cards(page).first();
  await card.locator('.cp-name').evaluate((node) => {
    node.textContent = 'مشروب الشوكولاتة الساخنة بالحليب والقرفة والزنجبيل مع الكريمة المخفوقة والمكسرات';
  });
  const box = (await card.boundingBox())!;
  const name = (await card.locator('.cp-name').boundingBox())!;
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
    const first = page.locator('#cat-viennoiserie');
    const card = cardOf(page, 'croissant');
    await expectReadable(menu, {
      'lit roll': strip(page).locator('button[aria-current="true"]'),
      'resting roll': strip(page).locator('button:not([aria-current="true"])').first(),
      'carpet title': first.locator('h2 > span'),
      'carpet count': first.locator('h2 b'),
      'carpet number': first.locator('h2 small'),
      'medallion name': card.locator('.cp-name'),
      'medallion price': card.locator('.cp-price'),
      'medallion add button': card.locator('.cp-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole medallion, its add button and a roll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.cp-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.cp-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -3 });
    const roll = rollOf(page, 'patisserie');
    await roll.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(roll).toBeFocused();
    await expectFocusRingShows(page, roll, { outset: -3 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its medallion, inside the cell, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.cp-price .sr-only')).toContainText(/\d|[٠-٩]/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});
