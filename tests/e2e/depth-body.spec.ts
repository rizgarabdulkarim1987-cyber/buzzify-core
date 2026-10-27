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
 * The Scroll Depth body (the motion-dep mockup): a black gallery. The featured dish is a huge framed hero; every section is
 * titled by its name in giant outlined letters that slide as the page scrolls; framed photos, three across on a phone
 * and one wide on a desktop, each photo larger than its frame and shifting inside it as the page scrolls; the name and the
 * price under every frame (no card behind it); a sticky strip of plain-word chips.
 */

const menus = bodyMenus();
const slug = menus.slug('dep');
const arabSlug = menus.slug('depar');
const alternatives = paletteIdsOf('the-scroll-depth').slice(1);
const paletteSlug = (id: string) => menus.slug(`dep-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'depth', { templateId: 'the-scroll-depth' });
  await menus.create(arabSlug, 'depth', { templateId: 'the-scroll-depth', numeralSystem: 'ARAB', discount: ['croissant', 'pain-au-chocolat'] });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'depth', { templateId: 'the-scroll-depth', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const depth = (page: Page) => page.locator('[data-body="depth"]');
const chips = (page: Page) => depth(page).locator('[data-chips]');
const cards = (page: Page) => depth(page).locator('[data-row]');
const grid = (page: Page) => depth(page).locator('.dp-grid [data-row]:visible');
const hero = (page: Page) => depth(page).locator('.dp-hero');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
/** The picture inside a frame: the node that shifts. */
const picture = (card: ReturnType<typeof cards>) => card.locator('[data-photo] > :first-child');
const shiftOf = (node: ReturnType<typeof picture>) => node.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);

test('on a phone the first screen shows the hero dish and framed dishes with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(depth(page)).toBeVisible();
  await page.waitForTimeout(1500);
  // The Maison demo card, the offers and the filter chips above the menu take most of the first screen by themselves.
  await expectFirstScreen(page, cards(page), { min: 1 });
  await page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
    (content.querySelector('.tpl-tools > :nth-child(2)') as HTMLElement | null)?.style.setProperty('display', 'none');
  });
  // The hero is a dish with photo and price (Maison's featured dish is also its first frame, counted once) and the first
  // section's three dishes follow it: the hero plus the whole first row.
  await expectFirstScreen(page, cards(page), { min: 3 });
  await expectEverySectionReachable(chips(page));
});

test('the hero is the featured dish: a huge frame with its photo, name, price and add, the whole card opening the dish', async ({ page }) => {
  await openMenu(page, slug);
  await expect(hero(page)).toBeVisible();
  const card = hero(page).locator('[data-row]');
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const box = (await card.boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(300);
  expect(photo.height).toBeGreaterThan(photo.width * 0.4);
  await expect(card.locator('.dp-hero-name')).toHaveText('Butter croissant');
  await expect(card.locator('.dp-hero-price')).toContainText('$');
  await expect(card.locator('.dp-hero-add')).toBeVisible();
  // Its picture is larger than its frame, like every frame's.
  const image = (await picture(card).boundingBox())!;
  expect(image.height).toBeGreaterThan(photo.height * 1.3);
  await page.mouse.click(box.x + box.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the frames sit three across on a phone, the photo larger than its frame; the name and price are under the frame', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]:visible');
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

test('every section is titled by its name in giant outlined letters (its echo is decoration), all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const sections = depth(page).locator('section[data-depth]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(depth(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = sections.first().getByRole('heading', { name: 'Viennoiserie' });
  await expect(heading).toBeVisible();
  const style = await heading.evaluate((node) => {
    const own = getComputedStyle(node);
    return { size: parseFloat(own.fontSize), stroke: parseFloat(own.webkitTextStrokeWidth), fill: own.webkitTextFillColor };
  });
  expect(style.size).toBeGreaterThanOrEqual(56);
  expect(style.stroke).toBeGreaterThan(0);
  expect(style.fill).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await expect(heading.locator('[aria-hidden]').first()).toContainText('Viennoiserie');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the band slides sideways as the page scrolls, the other way in the next section', async ({ page }) => {
  await openMenu(page, slug);
  const shiftOf = (id: string) => depth(page).locator('#cat-' + id + ' .dp-title').evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m41);
  await depth(page).locator('#cat-patisserie .dp-head').scrollIntoViewIfNeeded();
  const before = await shiftOf('patisserie');
  await page.evaluate(() => window.scrollBy(0, 160));
  await page.waitForTimeout(250);
  const after = await shiftOf('patisserie');
  expect(Math.abs(after - before)).toBeGreaterThan(2);
  // The sections alternate: patisserie (the third) slides one way, the second section the other way.
  await depth(page).locator('#cat-celebration .dp-head').scrollIntoViewIfNeeded();
  const a = await shiftOf('celebration');
  await page.evaluate(() => window.scrollBy(0, 100));
  await page.waitForTimeout(250);
  const b = await shiftOf('celebration');
  expect(Math.sign(b - a)).not.toBe(Math.sign(after - before));
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
  const card = page.locator('#cat-viennoiserie [data-row]:visible').first();
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
  const kept = grid(page).first().locator('[data-photo]');
  const keptAt = () => kept.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--dp'));
  await expect.poll(keptAt).not.toBe('');
  const started = parseFloat(await keptAt());
  await page.evaluate(() => window.scrollBy(0, 60));
  await expect.poll(async () => parseFloat(await keptAt())).not.toBe(started);
});

test('the hero steps aside for a search and comes back', async ({ page }) => {
  await openMenu(page, slug);
  await expect(hero(page)).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(hero(page)).toBeHidden();
  await search.fill('');
  await expect(hero(page)).toBeVisible();
});

test('a dish opens and adds, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'pain-au-chocolat');
  await expectQuickAdd(page, first, 'pain-au-chocolat');
  const frame = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the caption without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = grid(page).first();
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
  const cells = page.locator('#cat-viennoiserie [data-row]:visible');
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
  await expect(first.locator('h2 [aria-hidden]').first()).toContainText('Viennoiserie');
});

test('in Arabic the page is right to left, the grid mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const cells = page.locator('#cat-viennoiserie [data-row]:visible');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('reduced motion: the picture stays centred, the band is still and the entrance is off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const card = page.locator('#cat-patisserie [data-row]').first();
  await expect(grid(page).first()).toHaveCSS('animation-name', 'none');
  await expect(picture(card)).toHaveCSS('animation-name', 'none');
  await card.scrollIntoViewIfNeeded();
  const before = await shiftOf(picture(card));
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(250);
  expect(await shiftOf(picture(card))).toBe(before);
  expect(before).toBe(0);
  await expect(depth(page).locator('.dp-title').first()).toHaveCSS('animation-name', 'none');
  await expect(depth(page).locator('.dp-title').first()).toHaveCSS('transform', 'none');
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
      'section name': first.locator('h2 > span').first(),
      'hero name': hero(page).locator('.dp-hero-name'),
      'hero price': hero(page).locator('.dp-hero-price'),
      'caption name': first.locator('.dp-card:visible .dp-name').first(),
      'caption price': first.locator('.dp-card:visible .dp-price').first(),
      'add button': first.locator('.dp-card:visible .dp-add').first(),
      'hero add': hero(page).locator('.dp-hero-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': depth(page).locator('.tpl-off').first() }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = grid(page).first();
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
  // The croissant (the featured dish) shows its sale on the hero, where the grid leaves it out; the pain au chocolat shows it on its frame.
  const cell = depth(page).locator('.dp-grid [data-row]').filter({ hasText: dishName('pain-au-chocolat') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(depth(page).locator('.tpl-off:visible')).toHaveCount(2);
  await expect(hero(page).locator('.tpl-off')).toHaveText('−٢٠%');
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
