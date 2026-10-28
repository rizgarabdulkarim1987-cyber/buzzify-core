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
 * The Curtain and Spotlight body (the motion-thr mockup, spec 2026-10-26-menu-styles-in-templates-design.md): a sticky
 * programme strip of pill chips, the featured dish as a big gold-edged arch under velvet curtains that part once, then
 * every section a stage (its name in the display face, a spotlight cone on the one in view) with its dishes as
 * arch-topped performers three across (photo, name, gold price and a gold add key).
 */

const menus = bodyMenus();
const slug = menus.slug('thr');
const arabSlug = menus.slug('thrar');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-curtain-and-spotlight').slice(1);
const paletteSlug = (id: string) => menus.slug(`thr-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'theatre', { templateId: 'the-curtain-and-spotlight' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'theatre', { templateId: 'the-curtain-and-spotlight', numeralSystem: 'ARAB', discount: ['croissant'] });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'theatre', { templateId: 'the-curtain-and-spotlight', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const theatre = (page: Page) => page.locator('[data-body="theatre"]');
const programme = (page: Page) => theatre(page).locator('[data-programme]');
const performers = (page: Page) => theatre(page).locator('.th-performer');
const hero = (page: Page) => theatre(page).locator('.th-hero');
const entry = (page: Page, categorySlug: string) => programme(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows the featured hero dish and performers with photos, prices and names, and every stage is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(theatre(page)).toBeVisible();
  await page.waitForTimeout(1500);
  // The Maison demo card, the offers and the filter chips above the menu take most of the first screen by themselves.
  await expectFirstScreen(page, theatre(page).locator('[data-row]'), { min: 1 });
  await page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
    (content.querySelector('.tpl-tools > :nth-child(2)') as HTMLElement | null)?.style.setProperty('display', 'none');
  });
  // The hero is a dish with photo and price (Maison's featured dish is also its first performer, counted once) and
  // the first stage's three dishes follow it: the hero plus the whole first row.
  await expectFirstScreen(page, theatre(page).locator('[data-row]'), { min: 3 });
  await expectEverySectionReachable(programme(page));
});

test('the hero is the featured dish: a big arch with its photo, name, price and add key, the whole card opening the dish', async ({ page }) => {
  await openMenu(page, slug);
  await expect(hero(page)).toBeVisible();
  const card = hero(page).locator('[data-row]');
  const photo = (await card.locator('[data-photo]').boundingBox())!;
  const box = (await card.boundingBox())!;
  expect(photo.width).toBeGreaterThanOrEqual(250);
  expect(await card.locator('[data-photo]').evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(60);
  await expect(card.locator('.th-hero-price')).toContainText('$');
  await expect(card.locator('.th-hero-add')).toBeVisible();
  await expect.poll(() => hero(page).locator('.th-curtain-s').evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  await page.mouse.click(box.x + box.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the hero steps aside for a search and comes back without playing its curtains again', async ({ page }) => {
  await openMenu(page, slug);
  await expect(hero(page)).toBeVisible();
  await expect.poll(() => hero(page).locator('.th-curtain-s').evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(hero(page)).toBeHidden();
  await search.fill('');
  await expect(hero(page)).toBeVisible();
  expect(await hero(page).locator('.th-curtain-s').evaluate((node) => node.getAnimations().length)).toBe(0);
});

test('every section is a stage under a centred banner (its name and dish count), all on the page at once, with a spotlight cone', async ({ page }) => {
  await openMenu(page, slug);
  const stages = theatre(page).locator('section[data-stage]');
  expect(await stages.count()).toBe(BODY_CATEGORIES.length);
  await expect(stages.first().locator('[data-count]')).toHaveText('3');
  await expect(theatre(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = stages.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((node) => getComputedStyle(node).textAlign)).toBe('center');
  expect(await heading.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(26);
  await expect(stages.first().locator('.th-cone')).toHaveCount(1);
});

test('the performers stand three across: an arch of photo, the name and the price under it, the add key on the arch', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie .th-performer');
  expect(await cells.count()).toBe(3);
  const boxes = await Promise.all([0, 1, 2].map(async (i) => (await cells.nth(i).boundingBox())!));
  expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  const photo = (await cells.first().locator('[data-photo]').boundingBox())!;
  const price = (await cells.first().locator('.th-price').boundingBox())!;
  const name = (await cells.first().locator('.th-name').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await expect(cells.first().locator('.th-price')).toContainText('$');
  expect(await cells.first().evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThan(20);
});

test('a programme chip takes you to its stage and focuses the banner', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the programme strip lights the stage in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(programme(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the programme strip stays at the top: scrolled to the end, the first stage is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, programme(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('the spotlight cone is on the stage in view, and only the cone layer fades', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  const other = page.locator('#cat-bread');
  await expect(first).toHaveAttribute('data-lit', '');
  await expect(other).not.toHaveAttribute('data-lit', '');
  await expect(first.locator('.th-cone')).toHaveCSS('opacity', '1');
  await expect(other.locator('.th-cone')).toHaveCSS('opacity', '0');
  // The text of the dishes is never dimmed: no opacity on a stage, a card, a name or a price.
  for (const node of [other, other.locator('.th-performer').first(), other.locator('.th-name').first(), other.locator('.th-price').first()]) await expect(node).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(other).toHaveAttribute('data-lit', '');
  await expect(first).not.toHaveAttribute('data-lit', '');
});

test('the hero curtains part once on arrival, settle within two seconds and stay parted', async ({ page }) => {
  await openMenu(page, slug);
  const curtain = hero(page).locator('.th-curtain-s');
  const gathered = async () => {
    const stageBox = (await hero(page).boundingBox())!;
    const box = (await curtain.boundingBox())!;
    return box.x + box.width - stageBox.x;
  };
  await expect.poll(gathered, { timeout: 5000 }).toBeLessThan(60);
  await expect.poll(() => curtain.evaluate((node) => node.getAnimations().length), { timeout: 5000 }).toBe(0);
  // The curtains take no taps.
  await expect(curtain).toHaveCSS('pointer-events', 'none');
});

test('a performer opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await performers(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = performers(page).first();
  await cell.locator('.th-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.th-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.th-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const price = (await cell.locator('.th-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('on a wide screen a stage stays a tidy row of four performers and the hero stays narrow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const cells = page.locator('#cat-viennoiserie .th-performer');
  const a = (await cells.nth(0).boundingBox())!;
  const c = (await cells.nth(2).boundingBox())!;
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(c.x + c.width - a.x).toBeLessThanOrEqual(640);
  expect((await hero(page).boundingBox())!.width).toBeLessThanOrEqual(460);
});

test('counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = theatre(page).locator('section[data-stage]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the stage mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => programme(p));
  const cells = page.locator('#cat-viennoiserie .th-performer');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  // The start curtain moves to the right-hand side.
  const stage = (await hero(page).boundingBox())!;
  const start = (await hero(page).locator('.th-curtain-s').boundingBox())!;
  expect(start.x + start.width / 2).toBeGreaterThan(stage.x + stage.width / 2);
});

test('reduced motion: the curtains are simply parted, no animation or transition runs', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const curtain = hero(page).locator('.th-curtain-s');
  await expect(curtain).toHaveCSS('animation-name', 'none');
  await expect(performers(page).first()).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#cat-viennoiserie .th-cone')).toHaveCSS('transition-duration', '0s');
  const stage = (await hero(page).boundingBox())!;
  const box = (await curtain.boundingBox())!;
  expect(box.x + box.width - stage.x).toBeLessThan(60);
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
    // Scrolled a little, so a strip entry is lit; the first stage is still on the screen.
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(programme(page).locator('[aria-current="true"]')).toHaveCount(1);
    const stage = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit chip': programme(page).locator('.th-chip:not([aria-current="true"])').first(),
      'lit chip': programme(page).locator('[aria-current="true"]'),
      'banner': stage.locator('.th-banner > span'),
      'dish count': stage.locator('.th-banner b'),
      'price': stage.locator('.th-price').first(),
      'name': stage.locator('.th-name').first(),
      'add button': stage.locator('.th-add').first(),
      'hero name': hero(page).locator('.th-hero-name'),
      'hero price': hero(page).locator('.th-hero-price'),
      'hero add': hero(page).locator('.th-hero-add'),
      ...(menu === 'signature' ? {} : { 'sale chip': theatre(page).locator('.tpl-off').first() }),
    });
    await expectReadable(`${menu} (unlit stage)`, { name: page.locator('#cat-bread .th-name').first(), price: page.locator('#cat-bread .th-price').first() });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole performer and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = performers(page).first();
    const name = cell.locator('.th-name');
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

test('a dish on sale shows a -NN% chip in the menu numerals on its card, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = performers(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});

// Customize colours reach the shape: the stage, the gold, the cards are the palette's, not the artwork's own.
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('thrcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'theatre', { templateId: 'the-curtain-and-spotlight', colors: CUSTOM });
});
test('Customize colours reach the shape: the lit chip, the add keys and the arch cards', async ({ page }) => {
  await openMenu(page, customSlug);
  const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  const css = (node: ReturnType<typeof performers>, property: string) => node.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
  expect(await css(programme(page).locator('[aria-current="true"]'), 'background-color')).toBe(toRgb(CUSTOM.accent));
  expect(await css(theatre(page).locator('.th-add').first(), 'background-color')).toBe(toRgb(CUSTOM.accent));
  expect(await css(theatre(page).locator('.th-hero-add'), 'background-color')).toBe(toRgb(CUSTOM.accent));
  expect(await css(performers(page).first(), 'background-color')).toBe(toRgb(CUSTOM.raised));
  const curtainBg = await hero(page).locator('.th-curtain-s').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(curtainBg).not.toContain('122, 13, 28');
});
