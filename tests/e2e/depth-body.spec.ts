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
 * The Scroll Depth body (spec 2026-10-26-menu-styles-in-templates-design.md): big framed photos, three across on a phone and
 * one wide on a desktop, each photo larger than its frame and shifting inside it as the page scrolls; a caption bar (name
 * and price) under every frame; sections titled by oversized outlined numerals; a sticky strip of section chips.
 */

const menus = bodyMenus();
const slug = menus.slug('dep');
const arabSlug = menus.slug('depar');
const alternatives = paletteIdsOf('the-scroll-depth').slice(1);
const paletteSlug = (id: string) => menus.slug(`dep-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'depth', { templateId: 'the-scroll-depth' });
  await menus.create(arabSlug, 'depth', { templateId: 'the-scroll-depth', numeralSystem: 'ARAB', discount: ['croissant'] });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'depth', { templateId: 'the-scroll-depth', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const depth = (page: Page) => page.locator('[data-body="depth"]');
const chips = (page: Page) => depth(page).locator('[data-chips]');
const cards = (page: Page) => depth(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
/** The picture inside a frame: the node that shifts. */
const picture = (card: ReturnType<typeof cards>) => card.locator('[data-photo] > :first-child');
const shiftOf = (node: ReturnType<typeof picture>) => node.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);

test('on a phone the first screen shows at least four framed dishes with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(depth(page)).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(chips(page));
});

test('the frames sit three across on a phone, the photo larger than its frame; the caption bar is under the frame', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  const frame = (await cells.first().locator('[data-photo]').boundingBox())!;
  expect(frame.height).toBeGreaterThan(frame.width * 0.6);
  const image = (await picture(cells.first()).boundingBox())!;
  expect(image.height).toBeGreaterThan(frame.height * 1.3);
  const overflow = await cells.first().locator('[data-photo]').evaluate((node) => getComputedStyle(node).overflow);
  expect(overflow).not.toBe('visible');
  const name = (await cells.first().locator('.dp-name').boundingBox())!;
  const price = (await cells.first().locator('.dp-price').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
  await expect(cells.first().locator('.dp-price')).toContainText('$');
});

test('every section is titled by an oversized outlined numeral, name and dish count, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const sections = depth(page).locator('section[data-depth]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(depth(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = sections.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  const numeral = heading.locator('small');
  await expect(numeral).toHaveText('1');
  const style = await numeral.evaluate((node) => {
    const own = getComputedStyle(node);
    return { size: parseFloat(own.fontSize), stroke: parseFloat(own.webkitTextStrokeWidth), fill: own.webkitTextFillColor };
  });
  expect(style.size).toBeGreaterThanOrEqual(64);
  expect(style.stroke).toBeGreaterThan(0);
  expect(style.fill).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

test('a chip takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the chip strip lights the section in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chips(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the chip strip stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, chips(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('the photo shifts inside its frame as the page scrolls (it is the picture that moves, not the frame)', async ({ page }) => {
  await openMenu(page, slug);
  const card = page.locator('#cat-patisserie [data-row]').first();
  await card.scrollIntoViewIfNeeded();
  const frameTop = async () => (await card.locator('[data-photo]').boundingBox())!.y;
  const before = { shift: await shiftOf(picture(card)), top: await frameTop() };
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(250);
  const after = { shift: await shiftOf(picture(card)), top: await frameTop() };
  expect(Math.round(before.top - after.top)).toBeGreaterThan(100);
  expect(after.shift - before.shift).toBeGreaterThan(1);
  // The picture still covers its frame at both offsets.
  const frame = (await card.locator('[data-photo]').boundingBox())!;
  const image = (await picture(card).boundingBox())!;
  expect(image.y).toBeLessThanOrEqual(frame.y + 0.5);
  expect(image.y + image.height).toBeGreaterThanOrEqual(frame.y + frame.height - 0.5);
});

test('without scroll-driven animations the scroll fallback shifts the picture, only for frames in view, and survives a search', async ({ page }) => {
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((a: string, b?: string) => (/animation-timeline/.test(a) ? false : b === undefined ? supports(a) : supports(a, b))) as typeof CSS.supports;
  });
  await openMenu(page, slug);
  const card = page.locator('#cat-viennoiserie [data-row]').first();
  const at = () => card.locator('[data-photo]').evaluate((node) => (node as HTMLElement).style.getPropertyValue('--dp'));
  await expect.poll(at).not.toBe('');
  const first = parseFloat(await at());
  await page.evaluate(() => window.scrollBy(0, 160));
  await expect.poll(async () => parseFloat(await at())).toBeGreaterThan(first);
  // A frame far below the screen has not been touched.
  const far = await page.locator('#cat-bread [data-row] [data-photo]').first().evaluate((node) => (node as HTMLElement).style.getPropertyValue('--dp'));
  expect(far).toBe('');
  // Filtering the menu keeps the fallback alive for the frames that remain.
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('croissant');
  await page.evaluate(() => window.scrollTo(0, 0));
  const kept = depth(page).locator('[data-row]').first().locator('[data-photo]');
  const keptAt = () => kept.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--dp'));
  await expect.poll(keptAt).not.toBe('');
  const started = parseFloat(await keptAt());
  await page.evaluate(() => window.scrollBy(0, 60));
  await expect.poll(async () => parseFloat(await keptAt())).not.toBe(started);
});

test('a dish opens and adds, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const frame = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the caption without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = cards(page).first();
  await cell.locator('.dp-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.dp-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.dp-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const price = (await cell.locator('.dp-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen the frames are one wide card per row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  expect(a.width).toBeGreaterThan(400);
  const frame = (await cells.first().locator('[data-photo]').boundingBox())!;
  expect(frame.width).toBeGreaterThan(frame.height);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = depth(page).locator('section[data-depth]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first.locator('h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the grid mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('reduced motion: the picture stays centred and the entrance is off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const card = page.locator('#cat-patisserie [data-row]').first();
  await expect(cards(page).first()).toHaveCSS('animation-name', 'none');
  await expect(picture(card)).toHaveCSS('animation-name', 'none');
  await card.scrollIntoViewIfNeeded();
  const before = await shiftOf(picture(card));
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(250);
  expect(await shiftOf(picture(card))).toBe(before);
  expect(before).toBe(0);
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
    await expect(chips(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit chip': chips(page).locator('.dp-chip:not([aria-current="true"])').first(),
      'lit chip': chips(page).locator('[aria-current="true"]'),
      'section name': first.locator('h2 > span'),
      'dish count': first.locator('h2 b'),
      'caption name': first.locator('.dp-name').first(),
      'caption price': first.locator('.dp-price').first(),
      'add button': first.locator('.dp-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': depth(page).locator('.tpl-off').first() }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = cards(page).first();
    const name = cell.locator('.dp-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, cell, { outset: -2, pseudo: '::after' });
    const chip = entry(page, 'patisserie');
    await chip.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip).toBeFocused();
    await expectFocusRingShows(page, chip, { outset: -4 });
  }
});

test('a dish on sale shows a −NN% chip in the menu numerals on its frame, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = cards(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(depth(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
