import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  BODY_PRODUCTS,
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
  shapeChecks,
} from './helpers/body-menu';

/**
 * The Stacked Sheets body (the motion-stk mockup): a dark page with a strip of pills, every section a sheet of coloured
 * paper (rounded top corners) holding its name, its dish count and its dishes as cards two across; the sheets are
 * sticky, the next slides over the one in view, which shrinks and darkens as it is covered. Throwaway copies of the
 * Maison Lumière demo (five sections).
 */

const menus = bodyMenus();
const slug = menus.slug('stk');
const arabSlug = menus.slug('stkar');
const manySlug = menus.slug('stkmany');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-stacked-sheets').slice(1);
const paletteSlug = (id: string) => menus.slug(`stk-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'stacked', { templateId: 'the-stacked-sheets' });
  // Arabic-Indic numerals, and the croissant 20% off.
  await menus.create(arabSlug, 'stacked', { templateId: 'the-stacked-sheets', numeralSystem: 'ARAB', discount: ['croissant'] });
  // Five sections and eighteen more.
  await menus.create(manySlug, 'stacked', { templateId: 'the-stacked-sheets', extraSections: 18 });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'stacked', { templateId: 'the-stacked-sheets', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const stacked = (page: Page) => page.locator('[data-body="stacked"]');
const strip = (page: Page) => stacked(page).locator('[data-chips]');
const sheets = (page: Page) => stacked(page).locator('section[data-sheet]');
const cards = (page: Page) => stacked(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => strip(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
/** A sheet's covered amount (`--p`, 0 to 1). */
const covered = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`).evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue('--p') || '0'));
/** How much a sheet is shrunk (its scale) and how dark the layer over it is (that layer's opacity). */
const look = (page: Page, categorySlug: string) =>
  page.locator(`#cat-${categorySlug}`).evaluate((node) => ({ scale: new DOMMatrixReadOnly(getComputedStyle(node).transform).a, dark: parseFloat(getComputedStyle(node, '::after').opacity) }));
const scrollToSheet = (page: Page, categorySlug: string) => page.evaluate((id) => document.getElementById(`cat-${id}`)!.scrollIntoView({ block: 'start' }), categorySlug);
/** Takes the Maison demo card, the offers and the filter chips off the first screen (they take most of it by themselves). */
const clearTop = (page: Page) =>
  page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
    (content.querySelector('.tpl-tools > :nth-child(2)') as HTMLElement | null)?.style.setProperty('display', 'none');
  });

test('on a phone the first screen shows dishes with photos and prices, and every sheet is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(stacked(page)).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 2 });
  await clearTop(page);
  // Maison's first section holds three dishes (two rows of two cards): the next sheet is below the first screen.
  await expectFirstScreen(page, cards(page), { min: 3 });
  await expectEverySectionReachable(strip(page));
});

test('every section is a sheet of paper of its own hue with rounded top corners, its name set large and its dish count', async ({ page }) => {
  await openMenu(page, slug);
  expect(await sheets(page).count()).toBe(BODY_CATEGORIES.length);
  const papers = await sheets(page).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(papers).size).toBe(papers.length);
  const first = sheets(page).first();
  expect(await first.evaluate((node) => parseFloat(getComputedStyle(node).borderStartStartRadius))).toBeGreaterThanOrEqual(24);
  await expect(first.locator('[data-count]')).toContainText('3');
  const title = first.getByRole('heading', { name: 'Viennoiserie' });
  await expect(title).toBeVisible();
  expect(await title.locator('span').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(28);
  // The name and the count sit on one line, apart.
  const name = (await title.locator('span').boundingBox())!;
  const count = (await first.locator('[data-count]').boundingBox())!;
  expect(Math.abs(name.y + name.height - (count.y + count.height))).toBeLessThanOrEqual(12);
  expect(Math.abs(count.x - name.x)).toBeGreaterThan(60);
});

test('the dishes are cards two across on a sheet, all the same size: a 4:3 photo, the name, then the price with a round add', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [a, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(a.width).toBeGreaterThan(150);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(Math.abs(photo.width * 0.75 - photo.height)).toBeLessThanOrEqual(1.5);
  const name = (await row.first().locator('.sk-name').boundingBox())!;
  const price = (await row.first().locator('.sk-price').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await expect(row.first().locator('.sk-price')).toContainText('$');
  const add = (await row.first().locator('.sk-add').boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(30);
  expect(Math.abs(add.width - add.height)).toBeLessThanOrEqual(1);
  expect(add.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(add.x + add.width).toBeLessThanOrEqual(a.x + a.width + 1);
  expect(add.x + add.width / 2).toBeGreaterThan(price.x + price.width / 2);
});

test('the sheets are sticky under the strip: the next slides over the one in view, which stays put, shrinks and darkens; scrolling back restores it', async ({ page }) => {
  await openMenu(page, slug);
  await scrollToSheet(page, 'viennoiserie');
  await page.evaluate(() => window.scrollBy(0, -10));
  const bar = (await strip(page).boundingBox())!;
  // Nothing covers the first sheet yet.
  await expect.poll(() => covered(page, 'viennoiserie')).toBe(0);
  expect(await look(page, 'viennoiserie')).toEqual({ scale: 1, dark: 0 });
  // Scroll until the second sheet is half way up the first: the first is still stuck under the strip.
  await scrollToSheet(page, 'patisserie');
  await page.evaluate(() => window.scrollBy(0, 160));
  await expect.poll(() => covered(page, 'viennoiserie')).toBeGreaterThan(0.05);
  const top = (await page.locator('#cat-viennoiserie').boundingBox())!;
  expect(top.y).toBeLessThanOrEqual(bar.y + bar.height + 2);
  const seen = await look(page, 'viennoiserie');
  expect(seen.scale).toBeLessThan(1);
  expect(seen.scale).toBeGreaterThanOrEqual(0.93);
  expect(seen.dark).toBeGreaterThan(0);
  expect(seen.dark).toBeLessThanOrEqual(0.35);
  // The sheet that does the covering is on top of it (its top is the first thing at that height).
  const over = (await page.locator('#cat-patisserie').boundingBox())!;
  const hit = await page.evaluate((y) => document.elementFromPoint(40, y + 4)?.closest('[data-sheet]')?.id, over.y);
  expect(hit).toBe('cat-patisserie');
  // Back to the top: nothing is left shrunk or dark.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => covered(page, 'viennoiserie')).toBe(0);
  expect(await look(page, 'viennoiserie')).toEqual({ scale: 1, dark: 0 });
});

test('only transform and opacity change as a sheet is covered, and nothing runs by itself', async ({ page }) => {
  await openMenu(page, slug);
  const properties = await page.locator('#cat-viennoiserie').evaluate((node) => getComputedStyle(node).transitionProperty);
  expect(properties).toBe('all');
  await scrollToSheet(page, 'patisserie');
  expect(await stacked(page).evaluate((node) => [node, ...node.querySelectorAll('*')].flatMap((el) => el.getAnimations()).filter((a) => a instanceof CSSAnimation).length)).toBe(0);
});

test('a pill takes you to its sheet, under the strip, and focuses its heading: down the page and back up past the sheets stuck above', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
  const bar = (await strip(page).boundingBox())!;
  await expect.poll(async () => Math.abs((await page.locator('#cat-celebration').boundingBox())!.y - (bar.y + bar.height)), { message: 'the sheet lands under the strip' }).toBeLessThanOrEqual(3);
  // Back up to the first sheet, which has been stuck at the top: a plain scroll-into-view could not take the page there.
  await expectJumpsTo(page, entry(page, 'viennoiserie'), 'viennoiserie');
  await expect.poll(async () => Math.abs((await page.locator('#cat-viennoiserie').boundingBox())!.y - (bar.y + bar.height)), { message: 'the first sheet lands under the strip' }).toBeLessThanOrEqual(3);
  await expectJumpsTo(page, entry(page, 'patisserie'), 'patisserie');
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the strip lights the sheet in view, scrolling down and back up', async ({ page }) => {
  await openMenu(page, slug);
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expectJumpsTo(page, entry(page, 'patisserie'), 'patisserie');
  await expect(entry(page, 'patisserie')).toHaveAttribute('aria-current', 'true');
  // Back up by scrolling: the sheets above are stuck at the top, and the one lit is still the one being read.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(entry(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('the strip stays at the top: scrolled to the end, the first sheet is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, strip(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a menu with many sections keeps every sheet one tap away on a scrolling strip, and no two neighbours share a paper', async ({ page }) => {
  await openMenu(page, manySlug);
  await expect(strip(page).getByRole('button')).toHaveCount(BODY_CATEGORIES.length + 18);
  await expectFirstScreen(page, cards(page), { min: 2 });
  const bar = (await strip(page).boundingBox())!;
  expect(bar.height).toBeLessThanOrEqual(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const last = strip(page).getByRole('button', { name: 'Section 23' });
  await last.click();
  await expect(page.locator('#cat-more-18')).toBeInViewport();
  await expect(page.locator('#cat-more-18 [data-heading]')).toBeFocused();
  await expect(last).toBeInViewport();
  const papers = await sheets(page).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  for (let at = 1; at < papers.length; at++) expect(papers[at], `sheet ${at + 1}`).not.toBe(papers[at - 1]);
});

test('a sheet taller than the screen scrolls until its end shows before the next slides over it', async ({ page }) => {
  await openMenu(page, manySlug);
  // Make the first sheet three screens tall.
  await page.locator('#cat-viennoiserie').evaluate((node) => {
    (node as HTMLElement).style.minBlockSize = `${window.innerHeight * 3}px`;
  });
  await expect.poll(() => page.locator('#cat-viennoiserie').evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue('--sk-top')))).toBeLessThan(0);
  await scrollToSheet(page, 'viennoiserie');
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
  // Its foot is on the screen, the next sheet has not yet come over it.
  const box = (await page.locator('#cat-viennoiserie').boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(300);
  expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
});

test('a dish opens from its name and adds from its round button, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a section with one dish is a sheet of one card, as tall as the others are at least', async ({ page }) => {
  await openMenu(page, slug);
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
  expect((await page.locator('#cat-bread').boundingBox())!.height).toBeGreaterThanOrEqual(290);
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = cards(page).nth(1);
  await cell.locator('.sk-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.sk-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.sk-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const price = (await cell.locator('.sk-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
});

test('a long section name takes the line and wraps, the count stays whole', async ({ page }) => {
  await openMenu(page, slug);
  const head = sheets(page).first().locator('h2');
  await head.locator('span').evaluate((node) => {
    node.textContent = 'A very long section name that keeps going and going on a small phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await sheets(page).first().boundingBox())!;
  const count = (await sheets(page).first().locator('[data-count]').boundingBox())!;
  expect(count.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(count.x + count.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen the sheets stay a centred column, three cards across', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const sheet = (await page.locator('#cat-viennoiserie').boundingBox())!;
  expect(sheet.width).toBeLessThanOrEqual(720);
  expect(Math.abs(sheet.x + sheet.width / 2 - 640)).toBeLessThanOrEqual(2);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const c = (await row.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
});

test('counts and numbers use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(sheets(page).first().locator('[data-count]')).toContainText('٣ dishes');
});

test('in Arabic the page is right to left, the count and the grid mirror and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const sheet = sheets(page).first();
  const name = (await sheet.locator('h2 > span').boundingBox())!;
  const count = (await sheet.locator('[data-count]').boundingBox())!;
  expect(name.x).toBeGreaterThan(count.x);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  const price = (await row.first().locator('.sk-price').boundingBox())!;
  const add = (await row.first().locator('.sk-add').boundingBox())!;
  expect(add.x + add.width / 2).toBeLessThan(price.x + price.width / 2);
});

test('in Arabic with long names the sheet and the cards hold', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  await sheets(page).first().locator('h2 > span').evaluate((node) => {
    node.textContent = 'قسم طويل جدا جدا جدا جدا يستمر في الطول حتى نهاية الشاشة الصغيرة بلا توقف';
  });
  await cards(page).first().locator('.sk-name').evaluate((node) => {
    node.textContent = 'طبق طويل الاسم جدا جدا يستمر في الطول حتى يلتف على عدة أسطر في شاشة الهاتف الصغيرة';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a search that finds nothing keeps main#menu, and a search keeps the sheets, the focus and the scroll where they are', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await expect(sheets(page)).toHaveCount(1);
  await expect(search).toBeFocused();
  await search.fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
  await search.fill('');
  await expect(sheets(page)).toHaveCount(BODY_CATEGORIES.length);
  // Scrolled into the menu, a search that keeps the page tall enough does not move it: nothing in the shape scrolls
  // (the browser's own scroll anchoring is turned off to see that).
  await page.addStyleTag({ content: 'html, body { overflow-anchor: none; }' });
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300);
  // Typed in place (a real keystroke would also scroll the browser to the caret, which is off the screen up here).
  await search.evaluate((node) => {
    const input = node as HTMLInputElement;
    input.focus({ preventScroll: true });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'cake');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(cards(page)).not.toHaveCount(BODY_PRODUCTS.length);
  await page.waitForTimeout(400);
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(await page.evaluate(() => Math.min(300, Math.round(document.documentElement.scrollHeight - window.innerHeight))));
});

test('the sheets do not change paper when a search hides some of them', async ({ page }) => {
  await openMenu(page, slug);
  const paper = () => page.locator('#cat-celebration').evaluate((node) => getComputedStyle(node).backgroundColor);
  const before = await paper();
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('cake');
  await expect(page.locator('#cat-celebration')).toBeVisible();
  expect(await paper()).toBe(before);
});

test('reduced motion: the sheets still stack but are never shrunk or darkened', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await scrollToSheet(page, 'patisserie');
  await page.evaluate(() => window.scrollBy(0, 160));
  await page.waitForTimeout(300);
  expect(await covered(page, 'viennoiserie')).toBe(0);
  expect(await look(page, 'viennoiserie')).toEqual({ scale: 1, dark: 0 });
  const bar = (await strip(page).boundingBox())!;
  expect((await page.locator('#cat-viennoiserie').boundingBox())!.y).toBeLessThanOrEqual(bar.y + bar.height + 2);
});

test('text reads on every fill it sits on, in every palette of the shape', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', slug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)])];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
    const sheet = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'lit pill': strip(page).locator('[aria-current="true"]'),
      'unlit pill': strip(page).locator('.sk-chip:not([aria-current="true"])').first(),
      'sheet name': sheet.locator('h2 > span'),
      'sheet count': sheet.locator('[data-count]'),
      'card name': sheet.locator('.sk-name').first(),
      'card price': sheet.locator('.sk-price').first(),
      'add button': sheet.locator('.sk-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': stacked(page).locator('.tpl-off').first() }),
    });
  }
  // The papers of a long menu, too: each hue with the ink it carries.
  await openMenu(page, manySlug);
  await page.evaluate(() => window.scrollBy(0, 40));
  for (let at = 0; at < 6; at++) {
    await expect.poll(() => contrastOf(sheets(page).nth(at).locator('h2 > span')), { message: `sheet ${at + 1} name` }).toBeGreaterThanOrEqual(4.5);
    await expect.poll(() => contrastOf(sheets(page).nth(at).locator('[data-count]')), { message: `sheet ${at + 1} count` }).toBeGreaterThanOrEqual(4.5);
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a pill', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.sk-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.sk-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -4 });
    const pill = entry(page, 'patisserie');
    await pill.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(pill).toBeFocused();
    await expectFocusRingShows(page, pill, { outset: -4 });
  }
});

test('a dish on sale shows a −NN% chip in the menu numerals on its photo and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).filter({ hasText: dishName('croissant') });
  const chip = card.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(stacked(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});

shapeChecks(menus, { kind: 'stacked', templateId: 'the-stacked-sheets', checks: ['contrast'] });

/** Colours picked in Customize (a green menu with a pink accent): every surface of the shape must follow them. */
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('stkcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'stacked', { templateId: 'the-stacked-sheets', colors: CUSTOM });
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

test('Customize colours reach the sheets: the page and the lit pill follow them, the ink is the background colour and the paper is drawn toward the text colour', async ({ page }) => {
  await openMenu(page, slug);
  const defaultPaper = await rgbOf(stacked(page).locator('.sk-sheet').first(), 'background-color');
  await openMenu(page, customSlug);
  const sheet = stacked(page).locator('.sk-sheet').first();
  const ink = await rgbOf(sheet, 'color');
  rgbOfHex(CUSTOM.bg).forEach((channel, at) => expect(Math.abs(ink[at]! - channel), 'sheet ink is the background colour').toBeLessThanOrEqual(3));
  const paper = await rgbOf(sheet, 'background-color');
  expect(paper, 'the paper is not the default one').not.toEqual(defaultPaper);
  // The paper is the hue's colour drawn toward the text colour, so it stays well away from the ink.
  const light = (rgb: number[]) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  expect(light(paper), 'the paper is much lighter than the ink').toBeGreaterThan(light(ink) + 120);
  // The unlit pills are the picked card colour, the lit one the picked text colour.
  const unlit = await rgbOf(strip(page).locator('.sk-chip:not([aria-current="true"])').first(), 'background-color');
  rgbOfHex(CUSTOM.raised).forEach((channel, at) => expect(Math.abs(unlit[at]! - channel), 'unlit pill').toBeLessThanOrEqual(3));
  const lit = await rgbOf(strip(page).locator('[aria-current="true"]'), 'background-color');
  rgbOfHex(CUSTOM.text).forEach((channel, at) => expect(Math.abs(lit[at]! - channel), 'lit pill').toBeLessThanOrEqual(3));
});
