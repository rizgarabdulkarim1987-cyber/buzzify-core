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
 * The Living Steam body (poster motion-stm; spec 2026-10-26-menu-styles-in-templates-design.md): a sticky strip of round
 * chips, the featured dish as a big photo with its name large under it, then every section a heading over a two-column
 * grid of rounded photos (the name under each, the price and the add on a row). A dish's photo shows how it is served by
 * its temperature (read from the names: hot dishes get three wisps of steam, cold ones frost, dew and drips, others
 * nothing) and a "Hot" or "Cold" badge on the photo. Only explicit temperature words count, so the fixture names two of
 * Maison's sections with one: the viennoiserie is "Warm" (hot), the pâtisserie "Chilled" (cold), and every other section
 * (the morning box among them) says nothing and is neutral.
 */

const menus = bodyMenus();
/** Maison's first two sections, named with an explicit temperature word in each language. */
const sectionNames = {
  viennoiserie: { en: 'Warm Viennoiserie', ar: 'المعجنات الفرنسية الدافئة', ckb: 'هەویری فەڕەنسی گەرم' },
  patisserie: { en: 'Chilled Pâtisserie', ar: 'الحلويات الفرنسية المبردة', ckb: 'شیرینی فەڕەنسی سارد' },
};
const slug = menus.slug('stm');
const arabSlug = menus.slug('stmar');
const manySlug = menus.slug('stmmany');
const offSlug = menus.slug('stmoff');
const bareSlug = menus.slug('stmbare');
const crowdSlug = menus.slug('stmcrowd');
const bareAt = (id: string) => menus.slug(`stmbare-${id}`);
const alternatives = paletteIdsOf('the-living-steam').slice(1);
const paletteSlug = (id: string) => menus.slug(`stm-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'stm', { templateId: 'the-living-steam', sectionNames });
  await menus.create(arabSlug, 'stm', { templateId: 'the-living-steam', sectionNames, numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'stm', { templateId: 'the-living-steam', sectionNames: { ...sectionNames, bread: { en: 'Warm Bread', ar: 'الخبز الساخن', ckb: 'نانی گەرم' } }, extraSections: 20 });
  await menus.create(offSlug, 'stm', { templateId: 'the-living-steam', sectionNames, ordering: 'none' });
  await menus.create(crowdSlug, 'stm', { templateId: 'the-living-steam', sectionNames, crowd: 3 });
  await menus.create(bareSlug, 'stm', { templateId: 'the-living-steam', sectionNames, noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'stm', { templateId: 'the-living-steam', sectionNames, paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'stm', { templateId: 'the-living-steam', sectionNames, paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const steam = (page: Page) => page.locator('[data-body="steam"]');
const chips = (page: Page) => steam(page).locator('[data-chips]');
/** Takes the fixture's demo card (above the search) off the page: a real menu has none. */
const dropDemoCard = (page: Page) =>
  page.evaluate(() => {
    const search = document.querySelector('input[type="search"], [role="searchbox"]')!;
    const demo = [...document.querySelectorAll('h1,h2,p,div')].find((node) => node.children.length === 0 && node.textContent === 'Demonstration menu');
    let at: Element | null = demo ?? null;
    while (at && !at.parentElement?.contains(search)) at = at.parentElement;
    at?.remove();
    // The dietary filter chips of the fixture sit there too: a real menu without dietary tags has none.
    const chip = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Vegetarian');
    if (chip && !chip.parentElement?.contains(search)) chip.parentElement?.remove();
  });
const rows = (page: Page) => steam(page).locator('[data-row]');
const rowOf = (page: Page, productSlug: string) => rows(page).filter({ hasText: dishName(productSlug) });
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('on a phone the strip, the search and the featured dish with its photo and price show on the first screen, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(steam(page)).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expect(chips(page)).toBeInViewport();
  // The fixture menu carries a demo card and dietary chips above the search (about 450px): the hero dish still shows.
  await expectFirstScreen(page, rows(page), { min: 1 });
  await expectEverySectionReachable(chips(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('in a section of six dishes, with no demo card above the search (a real menu), the hero and at least three more dishes show photos and prices on the first screen', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await dropDemoCard(page);
  await expectFirstScreen(page, rows(page), { min: 4 });
});

test('the hero is the featured dish: a big photo (wider than a grid photo), its name large under it, its price, its add and its sale cue; the whole cell opens the dish; no dish is shown twice', async ({ page }) => {
  await openMenu(page, arabSlug);
  const hero = steam(page).locator('[data-hero]');
  await expect(hero).toHaveCount(1);
  await expect(steam(page).locator('[data-row]').filter({ hasText: dishName('croissant') })).toHaveCount(1);
  await expect(hero.locator('.stm-name .sr-only')).toHaveText('Featured: ');
  await expect(hero.locator('.stm-price')).toContainText('$');
  await expect(hero.locator('.stm-add')).toBeVisible();
  await expect(hero.locator('.tpl-photo-off')).toHaveText(/٢٠/);
  await expect(hero.locator('.tpl-was > [aria-hidden]')).toBeVisible();
  const photo = (await hero.locator('[data-photo]').boundingBox())!;
  const tile = (await rows(page).nth(1).locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(tile.width * 1.7);
  const radius = await hero.locator('[data-photo]').evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius));
  expect(radius).toBeGreaterThanOrEqual(12);
  const cell = (await hero.boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height - 6);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
});

test('a search that drops the featured dish takes the hero away and brings it back when cleared', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await expect(steam(page).locator('[data-hero]')).toHaveCount(0);
  await search.fill('');
  await expect(steam(page).locator('[data-hero]')).toHaveCount(1);
});

test('a grid dish is a rounded photo with the name under it, then the price and the add on a row, two across on a phone', async ({ page }) => {
  await openMenu(page, slug);
  const tiles = page.locator('#cat-viennoiserie [data-row]');
  await expect(tiles).toHaveCount(2);
  const [a, b] = [(await tiles.nth(0).boundingBox())!, (await tiles.nth(1).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(a.width).toBeGreaterThan(150);
  const tile = tiles.first();
  const [photo, name, price, add] = [(await tile.locator('[data-photo]').boundingBox())!, (await tile.locator('.stm-name').boundingBox())!, (await tile.locator('.stm-price').boundingBox())!, (await tile.locator('.stm-add').boundingBox())!];
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(Math.abs(price.y + price.height / 2 - (add.y + add.height / 2))).toBeLessThan(16);
  expect(add.width).toBeGreaterThanOrEqual(40);
  expect(photo.width).toBeGreaterThan(100);
  expect(await tile.locator('[data-photo]').evaluate((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius))).toBeGreaterThanOrEqual(12);
});

test('hot dishes get three wisps of steam and a Hot badge; cold ones a frosted rim, dew, two drips and a Cold badge; the rest nothing', async ({ page }) => {
  await openMenu(page, slug);
  const hot = rowOf(page, 'croissant');
  await expect(hot).toHaveAttribute('data-temp', 'hot');
  await expect(hot.locator('.stm-steam > i')).toHaveCount(3);
  await expect(hot.locator('.stm-frost')).toHaveCount(0);
  await expect(hot.locator('.stm-temp')).toHaveText('Hot');
  const cold = rowOf(page, 'mille-feuille');
  await expect(cold).toHaveAttribute('data-temp', 'cold');
  await expect(cold.locator('.stm-frost > i')).toHaveCount(2);
  await expect(cold.locator('.stm-steam')).toHaveCount(0);
  await expect(cold.locator('.stm-temp')).toHaveText('Cold');
  expect(await cold.locator('.stm-frost').evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('radial-gradient');
  const plain = rowOf(page, 'morning-box');
  await expect(plain).toHaveAttribute('data-temp', 'neutral');
  await expect(plain.locator('.stm-fx')).toHaveCount(0);
  await expect(plain.locator('.stm-temp')).toHaveCount(0);
  // The badges differ: a warm fill for hot, a cool one for cold, in the corner at the photo's end.
  const fill = (row: typeof hot) => row.locator('.stm-temp').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await fill(hot)).not.toBe(await fill(cold));
  const [photo, badge] = [(await hot.locator('[data-photo]').boundingBox())!, (await hot.locator('.stm-temp').boundingBox())!];
  expect(badge.x + badge.width).toBeLessThanOrEqual(photo.x + photo.width + 1);
  expect(badge.y).toBeGreaterThanOrEqual(photo.y);
});

test('the effects are CSS transform and opacity animations on the wisps and drips, covering the photo without catching a tap', async ({ page }) => {
  await openMenu(page, slug);
  const wisp = rowOf(page, 'croissant').locator('.stm-steam > i').first();
  await expect(wisp).toHaveCSS('animation-name', 'stm-rise');
  await expect(wisp).toHaveCSS('animation-iteration-count', '1');
  const drip = rowOf(page, 'mille-feuille').locator('.stm-frost > i').first();
  await expect(drip).toHaveCSS('animation-name', 'stm-drip');
  await expect(rowOf(page, 'croissant').locator('.stm-fx')).toHaveCSS('pointer-events', 'none');
  const moved = await page.evaluate(() => {
    const names = new Set<string>();
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSKeyframesRule && (rule.name === 'stm-rise' || rule.name === 'stm-drip'))
          for (const frame of rule.cssRules) for (const property of (frame as CSSKeyframeRule).style) names.add(property);
      }
    }
    return [...names].sort();
  });
  expect(moved).toEqual(['opacity', 'transform']);
});

test('only the rows on screen animate: far rows are paused, and run once scrolled to', async ({ page }) => {
  await openMenu(page, manySlug);
  const first = rowOf(page, 'croissant');
  const last = page.locator('#cat-bread [data-row]');
  const state = (row: typeof first) => row.locator('.stm-fx > i').first().evaluate((node) => getComputedStyle(node).animationPlayState);
  await expect(steam(page)).toHaveAttribute('data-armed', '');
  await expect.poll(() => state(first)).toBe('running');
  await expect.poll(() => state(last)).toBe('paused');
  await expect(first).toHaveAttribute('data-live', '');
  await expect(last).not.toHaveAttribute('data-live', '');
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => state(last)).toBe('running');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => state(first)).toBe('paused');
  await expect.poll(() => state(last)).toBe('paused');
});

test('a search that narrows and clears keeps the effects running on the rows shown, and never moves the focus or the scroll', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(rows(page).first()).toBeVisible();
  expect(await rows(page).count()).toBeLessThan(4);
  await expect(rows(page).first()).toHaveAttribute('data-live', '');
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(rows(page).first()).toHaveAttribute('data-live', '');
  await expect(rowOf(page, 'mille-feuille').locator('.stm-fx > i').first()).toHaveCSS('animation-play-state', 'running');
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('reduced motion: the wisps stand still, nothing drips, nothing is paused or armed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(rowOf(page, 'croissant').locator('.stm-steam > i').first()).toHaveCSS('animation-name', 'none');
  await expect(rowOf(page, 'mille-feuille').locator('.stm-frost > i').first()).toBeHidden();
  await expect(steam(page)).not.toHaveAttribute('data-armed', '');
  await expect(rowOf(page, 'croissant')).not.toHaveAttribute('data-live', '');
  await expect(rowOf(page, 'croissant').locator('.stm-temp')).toHaveText('Hot');
});

test('a chip takes you to its section and focuses the heading, and the strip lights the section in view', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
  await expect(entry(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chips(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, chips(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a menu with twenty-five sections keeps every section one tap away on a scrolling strip', async ({ page }) => {
  await openMenu(page, manySlug);
  const list = chips(page).locator('ul');
  await expect(chips(page).locator('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const last = chips(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
});

test('a dish adds from its cell and opens from its name, and tapping the photo or the cell opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'pain-au-chocolat');
  const photo = (await rowOf(page, 'pain-au-chocolat').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('pain-au-chocolat') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await rowOf(page, 'pain-au-chocolat').scrollIntoViewIfNeeded();
  const row = (await rowOf(page, 'pain-au-chocolat').boundingBox())!;
  await page.mouse.click(row.x + row.width - 70, row.y + row.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('pain-au-chocolat') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'pain-au-chocolat');
});

test('ordering off: plain tap-to-open cells, no + button, no cart, and the layout still shows its dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(steam(page)).toBeVisible();
  await expect(steam(page).locator('.stm-add')).toHaveCount(0);
  await dropDemoCard(page);
  await expectFirstScreen(page, rows(page), { min: 3 });
  const photo = (await rows(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates, the effects and a working add', async ({ page }) => {
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(2);
  expect(await steam(page).locator('[data-photo] img').count()).toBe(0);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(50);
  await expect(row.first().locator('.stm-steam > i')).toHaveCount(3);
  for (const index of [0, 1]) {
    await expect(row.nth(index).locator('.stm-name')).toBeVisible();
    await expect(row.nth(index).locator('.stm-price')).toContainText('$');
  }
  await expectFirstScreen(page, rows(page), { min: 0 });
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

test('a long dish name and a long price stay inside the row without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).first();
  await row.locator('.stm-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await row.locator('.stm-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await row.locator('.stm-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await row.boundingBox())!;
  for (const part of ['.stm-price', '.stm-temp', '.stm-add']) {
    const at = (await row.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(at.y + at.height, part).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  // The price wraps in the text column: it ends before the add button starts.
  const price = (await row.locator('.stm-price').boundingBox())!;
  const add = (await row.locator('.stm-add').boundingBox())!;
  expect(price.x + price.width).toBeLessThanOrEqual(add.x + 1);
  expect(await contrastOf(row.locator('.stm-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the grid runs three across in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  // The hero dish is not counted in its section: two dishes are left in the grid.
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٢');
});

test('in Arabic the page is right to left, the cells mirror, the Arabic temperature words show and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const tiles = page.locator('#cat-viennoiserie [data-row]');
  const [a, b] = [(await tiles.nth(0).boundingBox())!, (await tiles.nth(1).boundingBox())!];
  expect(a.x).toBeGreaterThan(b.x);
  const price = (await tiles.first().locator('.stm-price').boundingBox())!;
  const add = (await tiles.first().locator('.stm-add').boundingBox())!;
  expect(price.x).toBeGreaterThan(add.x);
  // The Arabic names put the viennoiserie (hot) and the pâtisserie (cold) in their lanes.
  await expect(tiles.first()).toHaveAttribute('data-temp', 'hot');
  await expect(tiles.first().locator('.stm-temp')).toHaveText('ساخن');
  const cold = page.locator('#cat-patisserie [data-row]').first();
  await expect(cold).toHaveAttribute('data-temp', 'cold');
  await expect(cold.locator('.stm-temp')).toHaveText('بارد');
});

test('in Sorani the lanes read too', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ckb' });
  await expect(page.locator('#cat-viennoiserie [data-row]').first().locator('.stm-temp')).toHaveText('گەرم');
  await expect(page.locator('#cat-patisserie [data-row]').first().locator('.stm-temp')).toHaveText('سارد');
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
    const hot = rowOf(page, 'croissant');
    const cold = rowOf(page, 'mille-feuille');
    const plain = rowOf(page, 'morning-box');
    await expectReadable(menu, {
      'unlit chip': chips(page).locator('.stm-chip:not([aria-current="true"])').first(),
      'lit chip': chips(page).locator('[aria-current="true"]'),
      'section name': first.locator('h2 > span'),
      'section count': first.locator('h2 b'),
      'hot row name': hot.locator('.stm-name'),
      'hot row price': hot.locator('.stm-price'),
      'hot chip': hot.locator('.stm-temp'),
      'hot add button': hot.locator('.stm-add'),
      'cold row name': cold.locator('.stm-name'),
      'cold row price': cold.locator('.stm-price'),
      'cold chip': cold.locator('.stm-temp'),
      'plain row name': plain.locator('.stm-name'),
      'plain row price': plain.locator('.stm-price'),
      ...(menu === 'signature' ? {} : { 'sale chip': hot.locator('.tpl-photo-off'), 'cold sale chip': rowOf(page, 'eclair').locator('.tpl-photo-off') }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole row, its add button and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const row = rows(page).first();
    const name = row.locator('.stm-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, row, { outset: 4, pseudo: '::after' });
    const add = row.locator('.stm-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -5 });
    const chip = entry(page, 'patisserie');
    await chip.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip).toBeFocused();
    await expectFocusRingShows(page, chip, { outset: -4 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its photo, inside its cell, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = rows(page).first();
  const chip = row.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(steam(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await row.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await row.locator('.tpl-was .sr-only').count()).toBeGreaterThan(0);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('nothing moves on its own for more than five seconds (WCAG 2.2.2: the scene is static, so there is no pause control)', async ({ page }) => {
  await openMenu(page, slug);
  await expect(steam(page)).toBeVisible();
  await expect(steam(page).locator('.stm-steam > i').first()).toHaveCSS('animation-name', 'stm-rise');
  await expectMotionEnds(steam(page));
});
