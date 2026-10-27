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
 * The One Thousand and One Nights body (the kurd-arab-lyl mockup, spec 2026-10-26-menu-styles-in-templates-design.md):
 * a purple night sky of static stars (a slow twinkle); the featured dish on a flying carpet at the top (a red frame with
 * a dashed gold line, a gold fringe at both ends, a caption with its name, price and add) that floats twice and lies
 * still; a sticky strip of gold pills; each section a gold display title over rounded dish cards, three across on a phone.
 */

const menus = bodyMenus();
const slug = menus.slug('lyl');
const promoSlug = menus.slug('lyloffer');
const arabSlug = menus.slug('lylar');
const manySlug = menus.slug('lylmany');
const offSlug = menus.slug('lyloff');
const bareSlug = menus.slug('lylbare');
const bareAt = (id: string) => menus.slug(`lylbare-${id}`);
const alternatives = paletteIdsOf('the-thousand-and-one-nights').slice(1);
const paletteSlug = (id: string) => menus.slug(`lyl-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'lyl', { templateId: 'the-thousand-and-one-nights' });
  await menus.create(promoSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'lyl', { templateId: 'the-thousand-and-one-nights', extraSections: 20 });
  await menus.create(offSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', ordering: 'none' });
  await menus.create(bareSlug, 'lyl', { templateId: 'the-thousand-and-one-nights', noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'lyl', { templateId: 'the-thousand-and-one-nights', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'lyl', { templateId: 'the-thousand-and-one-nights', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="carpet"]');
const strip = (page: Page) => body(page).locator('[data-rolls]');
const cards = (page: Page) => body(page).locator('.cp-card');
const everyDish = (page: Page) => body(page).locator('[data-row]');
const flight = (page: Page) => body(page).locator('.cp-flight');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const rollOf = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.locator('.cp-card').getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** The strip's jump offset (`--nav-room`) in px: a jumped-to carpet lands below the strip only if the strip is no taller. */
const navRoom = (page: Page) => body(page).evaluate((node) => parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) * parseFloat(getComputedStyle(document.documentElement).fontSize));

// The carpet in view floats for a few seconds after it lights, and Playwright clicks only a still target: the click tests below run with reduced
// motion (which stops the float, and is a mode guests really use); the float itself is tested with motion on.
test('on a phone the strip is at most 64px tall, the first screen has the featured hero dish and cards with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(await navRoom(page));
  await page.waitForTimeout(1500);
  // The Maison demo card, the offers and the filter chips above the menu take most of the first screen by themselves.
  await expectFirstScreen(page, everyDish(page), { min: 1 });
  await page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
    (content.querySelector('.tpl-tools > :nth-child(2)') as HTMLElement | null)?.style.setProperty('display', 'none');
  });
  // The hero is a dish with photo and price (Maison's featured dish is also in its first section, counted once) and the
  // first section's three dishes follow it.
  await expectFirstScreen(page, everyDish(page), { min: 3 });
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the page still draws its hero carpet and cards', async ({ page }) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expect(flight(page)).toBeVisible();
  expect(await cards(page).count()).toBeGreaterThan(4);
});

test('the hero is the featured dish on a flying carpet: a red frame with a dashed gold line, a fringe at both ends, a caption with its name, price and add; the whole carpet opens the dish', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(flight(page)).toBeVisible();
  const photo = (await flight(page).locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(240);
  expect(photo.height).toBeGreaterThanOrEqual(150);
  const frame = await flight(page).locator('[data-photo]').evaluate((node) => ({ width: parseFloat(getComputedStyle(node).borderTopWidth), color: getComputedStyle(node).borderTopColor }));
  expect(frame.width).toBeGreaterThanOrEqual(4);
  const dashed = await flight(page).locator('.cp-ride').evaluate((node) => getComputedStyle(node, '::after').borderTopStyle);
  expect(dashed).toBe('dashed');
  await expect(flight(page).locator('.cp-tassel')).toHaveCount(2);
  await expect(flight(page).locator('.cp-cap-price')).toContainText('$');
  await expect(flight(page).locator('.cp-cap-add')).toBeVisible();
  const box = (await flight(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the hero steps aside for a search and comes back without floating again', async ({ page }) => {
  await openMenu(page, slug);
  await expect(flight(page)).toBeVisible();
  await expect.poll(() => flight(page).locator('.cp-ride').evaluate((node) => node.getAnimations().length), { timeout: 6000 }).toBe(0);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(flight(page)).toBeHidden();
  await search.fill('');
  await expect(flight(page)).toBeVisible();
  expect(await flight(page).locator('.cp-ride').evaluate((node) => node.getAnimations().length)).toBe(0);
});

test('the strip is a row of gold pills: the section name on each, 44px to tap, the lit one filled', async ({ page }) => {
  await openMenu(page, slug);
  const pills = strip(page).locator('button');
  await expect(pills).toHaveCount(BODY_CATEGORIES.length);
  expect((await pills.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(pills.first()).toContainText(BODY_CATEGORIES[0]!.name.en!);
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
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

test('the hero carpet floats a few pixels, twice, and then lies still; with reduced motion it never floats', async ({ page }) => {
  await openMenu(page, slug);
  const ride = flight(page).locator('.cp-ride');
  await expect(ride).toHaveCSS('animation-name', 'cp-float');
  const travel = await ride.evaluate((node) => {
    const name = getComputedStyle(node).animationName;
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRule[] = [];
      try {
        rules = [...sheet.cssRules];
      } catch {
        continue;
      }
      const rule = rules.find((r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && r.name === name);
      if (rule) return [...rule.cssRules].map((frame) => (frame as CSSKeyframeRule).style.transform || 'none');
    }
    return [];
  });
  expect(travel.length).toBeGreaterThan(1);
  for (const transform of travel) {
    const shift = Math.abs(parseFloat(/translateY\((-?[\d.]+)px\)/.exec(transform)?.[1] ?? '0'));
    expect(shift).toBeLessThanOrEqual(3);
  }
  // It ends on its own and is marked, so it does not float again.
  await expect(flight(page)).toHaveAttribute('data-floated', '', { timeout: 6000 });
  await expect(ride).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(flight(page).locator('.cp-ride')).toHaveCSS('animation-name', 'none');
});

test('dishes are rounded cards in three columns: the photo, the name under it, then the price and the gold add', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie .cp-card');
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
  expect(photo.width).toBeGreaterThanOrEqual(95);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 2);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 2);
  const look = await card.evaluate((node) => ({ radius: parseFloat(getComputedStyle(node).borderTopLeftRadius), border: parseFloat(getComputedStyle(node).borderTopWidth) }));
  expect(look.radius).toBeGreaterThanOrEqual(12);
  expect(look.border).toBeGreaterThanOrEqual(1);
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
  const cell = (await cardOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows dishes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.cp-add, .cp-cap-add')).toHaveCount(0);
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

test('a dish with no media shows a plate painted in its frame (rings, a ground of its own), in every palette', async ({ page }) => {
  for (const menuSlug of [bareSlug, ...alternatives.map(bareAt)]) {
    await openMenu(page, menuSlug);
    const row = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(row).toBeVisible();
    await expectPlatePainted(row.locator('[data-photo]'), row);
  }
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

// The price's TEXT (not only its tag's box, which a nowrap line can overflow) stays inside the tag and the cell, on the
// medallion at the row's end, for a realistic "From" price and very long ones that must wrap, in English and Arabic.
for (const locale of ['en', 'ar'] as const)
test(`the price text stays inside its card at the row's end, in ${locale}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug, { locale });
  // Text set before React hydrates is thrown away by it (and logs a hydration mismatch): let the page settle first.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const card = page.locator('#cat-viennoiserie [data-row]').nth(2);
  for (const text of ['From 12,500 IQD', '123,456,789 IQD', 'From 123,456,789 IQD']) {
    await card.locator('.cp-price').evaluate((node, value) => {
      node.textContent = value;
    }, text);
    await expect(card.locator('.cp-price')).toHaveText(text);
    const boxes = await card.evaluate((cell) => {
      const tag = cell.querySelector('.cp-price')!;
      const range = document.createRange();
      range.selectNodeContents(tag);
      const words = range.getBoundingClientRect();
      return { words: words.toJSON() as DOMRect, tag: tag.getBoundingClientRect().toJSON() as DOMRect, cell: cell.getBoundingClientRect().toJSON() as DOMRect };
    });
    for (const [outer, name] of [[boxes.tag, 'price'], [boxes.cell, 'cell']] as const) {
      expect(boxes.words.left, `${text}: inside the ${name}`).toBeGreaterThanOrEqual(outer.left - 3);
      expect(boxes.words.right, `${text}: inside the ${name}`).toBeLessThanOrEqual(outer.right + 3);
      expect(boxes.words.top, `${text}: inside the ${name}`).toBeGreaterThanOrEqual(outer.top - 3);
      expect(boxes.words.bottom, `${text}: inside the ${name}`).toBeLessThanOrEqual(outer.bottom + 3);
    }
  }
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the add button is at least 40px square and inside its card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  for (const at of [0, 2]) {
    const cell = page.locator('#cat-viennoiserie [data-row]').nth(at);
    const [add, box] = [(await cell.locator('.cp-add').boundingBox())!, (await cell.boundingBox())!];
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    expect(add.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('on a wide screen the cards run in a centred column, side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the strip starts at the right, the cards run from the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const one = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  const two = (await cards(page).nth(1).locator('[data-photo]').boundingBox())!;
  expect(one.x).toBeGreaterThan(two.x);
  // The fringe still frames the hero carpet on both sides, and nothing is clipped past the screen.
  const tassels = await page.locator('.cp-flight .cp-tassel').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()));
  for (const box of tassels) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test('in Arabic a long dish name stays inside its card', async ({ page }) => {
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

// The section title and the hero's name and price sit on the sky's gradient, which the contrast helper cannot read: the
// unit test (tests/ui/carpet-shape.test.ts) checks the palette's gold and text against the sky's lightest stop instead.
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
      'section count': first.locator('h2 b'),
      'card name': card.locator('.cp-name'),
      'card price': card.locator('.cp-price'),
      'card add button': card.locator('.cp-add'),
      'hero add button': flight(page).locator('.cp-cap-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': card.locator('.tpl-photo-off'), 'second sale chip': cardOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a pill', async ({ page }) => {
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
    await expectFocusRingShows(page, add, { outset: 3 });
    const roll = rollOf(page, 'patisserie');
    await roll.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(roll).toBeFocused();
    await expectFocusRingShows(page, roll, { outset: -3 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its card, inside the cell, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.cp-card .tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.cp-price .sr-only')).toContainText(/\d|[٠-٩]/);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('nothing moves on its own for more than five seconds (WCAG 2.2.2: the scene is static, so there is no pause control)', async ({ page }) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expect(flight(page).locator('.cp-ride')).toHaveCSS('animation-name', 'cp-float');
  await expectMotionEnds(body(page));
});

// ---------------------------------------------------------------------------------------------------------------------
// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the artwork's own).
// ---------------------------------------------------------------------------------------------------------------------
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('cpcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'cp', { templateId: 'the-thousand-and-one-nights', colors: CUSTOM });
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
const first = (page: Page, selector: string) => page.locator('[data-body="carpet"] ' + selector).first();

test('Customize colours reach the shape: the strip, the lit pill, the gold add and title, the cards', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, customSlug);
  expectNear(await rgbOf(first(page, '.cp-strip'), 'background-color'), mixHex(CUSTOM.bg, '#000000', 0.18), 'strip backing');
  expectNear(await rgbOf(first(page, '.cp-roll[aria-current="true"]'), 'background-color'), CUSTOM.accent, 'lit pill');
  expectNear(await rgbOf(first(page, '.cp-roll:not([aria-current="true"])'), 'color'), CUSTOM.accent, 'resting pill text');
  expectNear(await rgbOf(first(page, '.cp-add'), 'background-color'), CUSTOM.accent, 'card add');
  expectNear(await rgbOf(first(page, '.cp-cap-add'), 'background-color'), CUSTOM.accent, 'hero add');
  expectNear(await rgbOf(first(page, '.cp-title'), 'color'), CUSTOM.accent, 'section title');
  expectNear(await rgbOf(first(page, '.cp-card'), 'background-color'), mixHex(CUSTOM.bg, CUSTOM.text, 0.08), 'card fill');
});
