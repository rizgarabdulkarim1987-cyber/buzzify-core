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
 * The Ramadan Nights body (spec 2026-10-26-menu-styles-in-templates-design.md): a night sky whose sticky strip is a row of
 * hanging lanterns (each a section: its numeral in the lantern, its name under it; the one in view glows and sways), and
 * below it each section a niche: a pointed-arch banner with a crescent, and the dishes as a list of round-arch cards.
 */

const menus = bodyMenus();
const slug = menus.slug('ram');
const promoSlug = menus.slug('ramoffer');
const arabSlug = menus.slug('ramar');
const manySlug = menus.slug('rammany');
const offSlug = menus.slug('ramoff');
const bareSlug = menus.slug('rambare');
const alternatives = paletteIdsOf('the-ramadan-nights').slice(1);
const paletteSlug = (id: string) => menus.slug(`ram-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'ram', { templateId: 'the-ramadan-nights' });
  await menus.create(promoSlug, 'ram', { templateId: 'the-ramadan-nights', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'ram', { templateId: 'the-ramadan-nights', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'ram', { templateId: 'the-ramadan-nights', extraSections: 20 });
  await menus.create(offSlug, 'ram', { templateId: 'the-ramadan-nights', ordering: 'none' });
  await menus.create(bareSlug, 'ram', { templateId: 'the-ramadan-nights', noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'ram', { templateId: 'the-ramadan-nights', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="lanterns"]');
const strip = (page: Page) => body(page).locator('[data-lanterns]');
const cards = (page: Page) => body(page).locator('[data-row]');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const lanternOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('on a phone the strip of lanterns is at most 84px tall and the first screen shows at least four dishes with photos and prices', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  const box = (await strip(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(84);
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the first screen still shows the strip and at least two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 2 });
});

test('the strip is a row of lanterns on strings: a numeral in each lantern and the section name under it', async ({ page }) => {
  await openMenu(page, slug);
  const lanterns = strip(page).locator('button');
  await expect(lanterns).toHaveCount(BODY_CATEGORIES.length);
  await expect(strip(page).locator('.rm-string')).toHaveCount(BODY_CATEGORIES.length);
  const drops = await strip(page).locator('.rm-string').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(new Set(drops).size).toBeGreaterThanOrEqual(3);
  await expect(lanterns.first().locator('.rm-pane')).toHaveText('1');
  await expect(lanterns.nth(2).locator('.rm-pane')).toHaveText('3');
  const first = lanterns.first();
  const pane = (await first.locator('.rm-pane').boundingBox())!;
  const label = (await first.locator('.rm-label').boundingBox())!;
  const house = (await first.boundingBox())!;
  expect(label.y).toBeGreaterThanOrEqual(pane.y + pane.height - 1);
  await expect(first.locator('.rm-label')).toHaveText(BODY_CATEGORIES[0]!.name.en!);
  expect(house.width).toBeGreaterThanOrEqual(44);
  expect(house.height).toBeGreaterThanOrEqual(44);
  // The rope the strings hang from runs along the top of the row.
  const rope = await strip(page).locator('li').first().evaluate((node) => getComputedStyle(node, '::before').height);
  expect(parseFloat(rope)).toBeGreaterThan(0);
});

test('the lantern in view glows and sways; the others hang still, and with less motion none sways', async ({ page }) => {
  await openMenu(page, slug);
  const lit = lanternOf(page, 'viennoiserie');
  await expect(lit).toHaveAttribute('aria-current', 'true');
  const sway = (button: ReturnType<typeof lanternOf>) => button.locator('.rm-hang').evaluate((node) => ({ name: getComputedStyle(node).animationName, pivot: getComputedStyle(node).transformOrigin }));
  expect((await sway(lit)).name).toBe('rm-sway');
  expect((await sway(lit)).pivot.split(' ')[1]).toBe('0px');
  expect((await sway(lanternOf(page, 'bread'))).name).toBe('none');
  const glow = await lit.locator('.rm-pane').evaluate((node) => getComputedStyle(node).boxShadow);
  const dim = await lanternOf(page, 'bread').locator('.rm-pane').evaluate((node) => getComputedStyle(node).boxShadow);
  expect(glow).not.toBe('none');
  expect(glow).not.toBe(dim);
  const paneBg = (button: ReturnType<typeof lanternOf>) => button.locator('.rm-pane').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await paneBg(lit)).not.toBe(await paneBg(lanternOf(page, 'bread')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await sway(lit)).name).toBe('none');
});

test('the glow follows the page: scrolled to the end the last lantern is the one in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(lanternOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(lanternOf(page, 'viennoiserie')).not.toHaveAttribute('aria-current', 'true');
});

test('a lantern takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, lanternOf(page, 'celebration'), 'celebration');
  await expect(lanternOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), lanternOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a niche: a pointed-arch banner with a crescent and the name, over a list in one column', async ({ page }) => {
  await openMenu(page, slug);
  const niche = page.locator('#cat-viennoiserie');
  const title = niche.locator('h2');
  const banner = (await title.boundingBox())!;
  const list = (await niche.locator('.rm-list').boundingBox())!;
  expect(banner.width).toBeLessThanOrEqual(list.width + 1);
  // Pointed at the top: a clipped shape, not a rounded rectangle.
  const shape = await title.evaluate((node) => ({ clip: getComputedStyle(node).clipPath }));
  expect(shape.clip).toContain('polygon');
  const moon = (await niche.locator('.rm-moon').boundingBox())!;
  expect(moon.width).toBeGreaterThan(8);
  expect(moon.x).toBeGreaterThanOrEqual(banner.x);
  expect(moon.x + moon.width).toBeLessThanOrEqual(banner.x + banner.width);
  await expect(title.locator('small')).toHaveText('1');
  await expect(title.locator('span').first()).toHaveText(BODY_CATEGORIES[0]!.name.en!);
  const rows = niche.locator('[data-row]');
  await expect(rows).toHaveCount(3);
  const [a, b] = [(await rows.nth(0).boundingBox())!, (await rows.nth(1).boundingBox())!];
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
});

test('a dish is a round-arch card: the photo in an arch on one side, the name and the price on the other, a crescent bullet', async ({ page }) => {
  await openMenu(page, slug);
  const card = cardOf(page, 'croissant');
  const box = (await card.boundingBox())!;
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.rm-name').boundingBox())!;
  const price = (await card.locator('.rm-price').boundingBox())!;
  expect(photo.x + photo.width).toBeLessThanOrEqual(name.x + 1);
  expect(photo.x).toBeLessThan(name.x);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(price.x).toBeGreaterThanOrEqual(photo.x + photo.width - 1);
  expect(photo.x).toBeGreaterThanOrEqual(box.x);
  const radius = await card.locator('[data-photo]').evaluate((node) => ({ top: getComputedStyle(node).borderTopLeftRadius, foot: getComputedStyle(node).borderBottomLeftRadius }));
  expect(parseFloat(radius.top)).toBeGreaterThan(parseFloat(radius.foot) * 4);
  // The card's start edge is round too, an arch lying on its side.
  expect(parseFloat(await card.evaluate((node) => getComputedStyle(node).borderStartStartRadius))).toBeGreaterThan(20);
  const bullet = await card.locator('.rm-name').evaluate((node) => ({ content: getComputedStyle(node, '::before').content, shadow: getComputedStyle(node, '::before').boxShadow }));
  expect(bullet.content).not.toBe('none');
  expect(bullet.shadow).not.toBe('none');
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
  await page.mouse.click(card.x + card.width / 2, card.y + card.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.rm-add')).toHaveCount(0);
  await expectFirstScreen(page, cards(page), { min: 4 });
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, a frame and a working add', async ({ page }) => {
  await openMenu(page, bareSlug);
  const rows = page.locator('#cat-viennoiserie [data-row]');
  await expect(rows).toHaveCount(3);
  expect(await body(page).locator('[data-photo] img').count()).toBe(0);
  const photo = (await rows.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(40);
  expect(photo.height).toBeGreaterThan(40);
  for (const index of [0, 1, 2]) {
    await expect(rows.nth(index).locator('.rm-name')).toBeVisible();
    await expect(rows.nth(index).locator('.rm-price')).toContainText('$');
  }
  // The empty frame is still an arch with a ground of its own (not the card's colour).
  const ground = await rows.first().locator('[data-photo]').evaluate((node) => getComputedStyle(node).backgroundColor);
  const card = await rows.first().evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(ground).not.toBe(card);
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a menu of twenty-five sections keeps every lantern one tap away on a scrolling strip that keeps the lit lantern in view', async ({ page }) => {
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
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(84);
  await expect(last.locator('.rm-pane')).toHaveText('25');
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
  await card.locator('.rm-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.rm-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await card.locator('.rm-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await card.boundingBox())!;
  for (const part of ['.rm-price', '.rm-name', '.rm-add', '[data-photo]']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(at.y + at.height, part).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  const price = (await card.locator('.rm-price').boundingBox())!;
  const add = (await card.locator('.rm-add').boundingBox())!;
  expect(price.x + price.width).toBeLessThanOrEqual(add.x + 1);
  expect(await contrastOf(card.locator('.rm-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the dishes run in two columns in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const rows = page.locator('#cat-viennoiserie [data-row]');
  const a = (await rows.nth(0).boundingBox())!;
  const b = (await rows.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the lanterns too', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(strip(page).locator('button').nth(1).locator('.rm-pane')).toHaveText('٢');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, the photo is on the right, long names stay inside and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, arabSlug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const card = cards(page).first();
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const name = (await card.locator('.rm-name').boundingBox())!;
  expect(photo.x).toBeGreaterThan(name.x);
  // The crescent faces the other way in RTL (mirrored).
  const mirrored = await page.locator('#cat-viennoiserie .rm-moon').evaluate((node) => getComputedStyle(node).transform);
  expect(mirrored).not.toBe('none');
  await card.locator('.rm-name').evaluate((node) => {
    node.textContent = 'طبق طويل جدا جدا باسم طويل يستمر ويستمر حتى يلتف على عدة أسطر في البطاقة الضيقة على الهاتف';
  });
  await strip(page).locator('.rm-label').first().evaluate((node) => {
    node.textContent = 'قسم طويل جدا جدا باسم طويل يستمر ويستمر';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const box = (await card.boundingBox())!;
  const at = (await card.locator('.rm-name').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(84);
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
    const lit = strip(page).locator('[aria-current="true"]');
    const dim = strip(page).locator('button:not([aria-current="true"])').first();
    await expectReadable(menu, {
      'lit lantern numeral': lit.locator('.rm-pane'),
      'lit lantern name': lit.locator('.rm-label'),
      'dim lantern numeral': dim.locator('.rm-pane'),
      'dim lantern name': dim.locator('.rm-label'),
      'banner name': first.locator('h2 > span'),
      'banner count': first.locator('h2 b'),
      'banner number': first.locator('h2 small'),
      'card name': card.locator('.rm-name'),
      'card price': card.locator('.rm-price'),
      'card add button': card.locator('.rm-add'),
      ...(menu === 'signature' ? {} : { 'sale badge': card.locator('.tpl-badge-sale'), 'second sale badge': cardOf(page, 'eclair').locator('.tpl-badge-sale') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a lantern', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.rm-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.rm-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -3 });
    const lantern = lanternOf(page, 'patisserie');
    await lantern.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(lantern).toBeFocused();
    await expectFocusRingShows(page, lantern, { outset: -3 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals inside its card, with the regular price kept', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cardOf(page, 'croissant');
  const chip = card.locator('.tpl-badge-sale');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-badge-sale')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  await expect(card.locator('.rm-price s')).toHaveCount(1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});
