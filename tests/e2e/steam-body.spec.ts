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
 * The Living Steam body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a rack of wide row cards, each
 * dish's photo in a frame by its temperature (read from the names: hot dishes get three wisps of steam, cold ones frost,
 * dew and drips, others a plain frame), a "Hot" or "Cold" chip on the row, and a sticky strip of section chips.
 * In the Maison Lumière demo: the viennoiserie and the bread are hot, the pâtisserie, the cakes and the macarons cold,
 * the morning box neither.
 */

const menus = bodyMenus();
const slug = menus.slug('stm');
const arabSlug = menus.slug('stmar');
const manySlug = menus.slug('stmmany');
const offSlug = menus.slug('stmoff');
const bareSlug = menus.slug('stmbare');
const alternatives = paletteIdsOf('the-living-steam').slice(1);
const paletteSlug = (id: string) => menus.slug(`stm-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'stm', { templateId: 'the-living-steam' });
  await menus.create(arabSlug, 'stm', { templateId: 'the-living-steam', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'stm', { templateId: 'the-living-steam', extraSections: 20 });
  await menus.create(offSlug, 'stm', { templateId: 'the-living-steam', ordering: 'none' });
  await menus.create(bareSlug, 'stm', { templateId: 'the-living-steam', noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'stm', { templateId: 'the-living-steam', paletteId: id, discount: ['croissant', 'eclair'] });
});
test.afterAll(() => menus.remove());

const steam = (page: Page) => page.locator('[data-body="steam"]');
const chips = (page: Page) => steam(page).locator('[data-chips]');
const rows = (page: Page) => steam(page).locator('[data-row]');
const rowOf = (page: Page, productSlug: string) => rows(page).filter({ hasText: dishName(productSlug) });
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('on a phone the first screen shows at least four dishes with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(steam(page)).toBeVisible();
  await expectFirstScreen(page, rows(page), { min: 4 });
  await expectEverySectionReachable(chips(page));
});

test('a row is a wide card: the photo, then the name over the price and the chip, then the add, all in one lane on a phone', async ({ page }) => {
  await openMenu(page, slug);
  const row = rowOf(page, 'croissant');
  const box = (await row.boundingBox())!;
  expect(box.width).toBeGreaterThan(330);
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  const name = (await row.locator('.stm-name').boundingBox())!;
  const price = (await row.locator('.stm-price').boundingBox())!;
  const add = (await row.locator('.stm-add').boundingBox())!;
  expect(photo.x).toBeLessThan(name.x);
  expect(name.x + name.width).toBeLessThanOrEqual(add.x + 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(photo.width).toBeGreaterThanOrEqual(48);
  expect(photo.height).toBeCloseTo(photo.width, 0);
  // One lane: every row of a section is as wide as the next and they stack.
  const next = (await rows(page).nth(1).boundingBox())!;
  expect(Math.abs(next.width - box.width)).toBeLessThanOrEqual(1);
  expect(next.y).toBeGreaterThan(box.y + box.height - 1);
});

test('hot dishes get a warm frame, three wisps of steam and a Hot chip; cold ones a frosted frame, dew, two drips and a Cold chip; the rest a plain frame', async ({ page }) => {
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
  // The lanes differ: the stripe on the start edge and the ring round the photo.
  const look = (row: typeof hot) =>
    row.evaluate((node) => ({ stripe: getComputedStyle(node).borderInlineStartColor, ring: getComputedStyle(node.querySelector('[data-photo]')!).boxShadow }));
  const [a, b, c] = [await look(hot), await look(cold), await look(plain)];
  expect(new Set([a.stripe, b.stripe, c.stripe]).size).toBe(3);
  expect(new Set([a.ring, b.ring, c.ring]).size).toBe(3);
});

test('the effects are CSS transform and opacity animations on the wisps and drips, covering the photo without catching a tap', async ({ page }) => {
  await openMenu(page, slug);
  const wisp = rowOf(page, 'croissant').locator('.stm-steam > i').first();
  await expect(wisp).toHaveCSS('animation-name', 'stm-rise');
  await expect(wisp).toHaveCSS('animation-iteration-count', 'infinite');
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

test('a dish adds from its row and opens from its name, and tapping the photo or the row opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await rowOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const row = (await rowOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(row.x + row.width - 70, row.y + row.height - 4);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open rows, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(steam(page)).toBeVisible();
  await expect(steam(page).locator('.stm-add')).toHaveCount(0);
  await expectFirstScreen(page, rows(page), { min: 4 });
  const photo = (await rows(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates, the effects and a working add', async ({ page }) => {
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  expect(await steam(page).locator('[data-photo] img').count()).toBe(0);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(50);
  await expect(row.first().locator('.stm-steam > i')).toHaveCount(3);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.stm-name')).toBeVisible();
    await expect(row.nth(index).locator('.stm-price')).toContainText('$');
  }
  await expectFirstScreen(page, rows(page), { min: 0 });
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
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
  expect(await contrastOf(row.locator('.stm-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the rows run in two lanes in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  const c = (await row.nth(2).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(a.width).toBeLessThan(520);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the row mirrors, the Arabic temperature words show and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const row = rows(page).first();
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  const add = (await row.locator('.stm-add').boundingBox())!;
  expect(photo.x).toBeGreaterThan(add.x);
  expect(await row.evaluate((node) => getComputedStyle(node).borderInlineStartWidth)).toBe('4px');
  expect((await row.boundingBox())!.x + (await row.boundingBox())!.width - (photo.x + photo.width)).toBeLessThan(20);
  // The Arabic names put the viennoiserie (hot) and the pâtisserie (cold) in their lanes.
  await expect(row).toHaveAttribute('data-temp', 'hot');
  await expect(row.locator('.stm-temp')).toHaveText('ساخن');
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
      ...(menu === 'signature' ? {} : { 'sale badge': hot.locator('.tpl-badge-sale'), 'cold sale badge': rowOf(page, 'eclair').locator('.tpl-badge-sale') }),
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
    await expectFocusRingShows(page, row, { outset: -3, pseudo: '::after' });
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

test('a dish on sale shows its -NN% chip in the menu numerals on its row, inside the row, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = rows(page).first();
  const chip = row.locator('.tpl-badge-sale');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(steam(page).locator('.tpl-badge-sale')).toHaveCount(1);
  const box = (await row.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});
