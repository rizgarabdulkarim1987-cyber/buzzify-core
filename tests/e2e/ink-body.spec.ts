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
  silenceObserver,
} from './helpers/body-menu';

/**
 * The Section Ink body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a full-width colour band with
 * an ink-bleed top edge, its name set large and its dish count, the dishes on it as paper-white cards three across on a phone; a
 * band floods in with its colour (a clip-path circle, once per band) when it scrolls into view or its chip is tapped.
 */

const menus = bodyMenus();
const slug = menus.slug('ink');
const arabSlug = menus.slug('inkar');
const manySlug = menus.slug('inkmany');
const offSlug = menus.slug('inkoff');
const bareSlug = menus.slug('inkbare');
const bareAt = (id: string) => menus.slug(`inkbare-${id}`);
const alternatives = paletteIdsOf('the-section-ink').slice(1);
const paletteSlug = (id: string) => menus.slug(`ink-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'ink', { templateId: 'the-section-ink' });
  await menus.create(arabSlug, 'ink', { templateId: 'the-section-ink', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'ink', { templateId: 'the-section-ink', extraSections: 20 });
  await menus.create(offSlug, 'ink', { templateId: 'the-section-ink', ordering: 'none' });
  await menus.create(bareSlug, 'ink', { templateId: 'the-section-ink', noPhotos: true });
  for (const id of alternatives) await menus.create(bareAt(id), 'ink', { templateId: 'the-section-ink', paletteId: id, noPhotos: true });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'ink', { templateId: 'the-section-ink', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const ink = (page: Page) => page.locator('[data-body="ink"]');
const chips = (page: Page) => ink(page).locator('[data-chips]');
const cards = (page: Page) => ink(page).locator('[data-row]');
const bands = (page: Page) => ink(page).locator('section[data-band]');
const floods = (page: Page) => ink(page).locator('.ik-flood');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const flooded = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`).evaluate((node) => node.hasAttribute('data-in'));
/** The band's clip-path once its transition has finished. */
const settled = (page: Page, categorySlug: string) =>
  expect.poll(() => page.locator(`#cat-${categorySlug} .ik-flood`).evaluate((node) => getComputedStyle(node).clipPath), { message: `the ${categorySlug} flood has finished` }).toMatch(/circle\(150%/);

test('on a phone the first screen shows at least four dishes with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(ink(page)).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(chips(page));
});

test('every section is a full-width colour band of its own, with its name set large and its dish count', async ({ page }) => {
  await openMenu(page, slug);
  expect(await bands(page).count()).toBe(BODY_CATEGORIES.length);
  const colours = await floods(page).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(colours).size).toBe(colours.length);
  const first = bands(page).first();
  const box = (await first.boundingBox())!;
  expect(box.width).toBe(390);
  await expect(first.locator('[data-count]')).toHaveText('3');
  const title = first.getByRole('heading', { name: /Viennoiserie/ });
  await expect(title).toBeVisible();
  expect(await title.locator('span').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(32);
  // The top edge is an ink bleed: a mask, not a straight line.
  const mask = await first.locator('.ik-flood').evaluate((node) => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage);
  expect(mask).toContain('svg');
  // The next band overlaps the one before it, so the edge shows its colour through.
  const second = (await floods(page).nth(1).boundingBox())!;
  expect(second.y).toBeLessThan(box.y + box.height);
});

test('the dishes are paper-white cards three across on a phone, all the same size, the photo then the name then the price, and a round add on the photo', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [a, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(b.x).toBeLessThan(c.x);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(await row.first().evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)');
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  const name = (await row.first().locator('.ik-name').boundingBox())!;
  const price = (await row.first().locator('.ik-price').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await expect(row.first().locator('.ik-price')).toContainText('$');
  const add = (await addOf(page, 'croissant').boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(40);
  expect(Math.abs(add.width - add.height)).toBeLessThanOrEqual(1);
  expect(add.x + add.width).toBeLessThanOrEqual(photo.x + photo.width + 1);
  expect(add.y + add.height).toBeLessThanOrEqual(photo.y + photo.height + 1);
});

test('a chip takes you to its band and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the strip lights the band in view', async ({ page }) => {
  await openMenu(page, slug);
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
  await expect(chips(page).getByRole('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  await expectFirstScreen(page, cards(page), { min: 4 });
  const last = chips(page).getByRole('button', { name: 'Section 25' });
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(page.locator('#cat-more-20 [data-heading]')).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // Neighbouring bands never share a colour, even where the set of colours starts again.
  const colours = await floods(page).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  for (let at = 1; at < colours.length; at++) expect(colours[at], `band ${at + 1}`).not.toBe(colours[at - 1]);
});

test('a band floods in with its colour when it first scrolls into view: a clip-path circle that grows from its top corner, and never again', async ({ page }) => {
  await openMenu(page, slug);
  // The first screen's bands are there at once; a band further down is a closed circle until it comes in.
  await expect.poll(() => flooded(page, 'viennoiserie')).toBe(true);
  expect(await flooded(page, 'bread')).toBe(false);
  expect(await page.locator('#cat-bread .ik-flood').evaluate((node) => getComputedStyle(node).clipPath)).toMatch(/circle\(0(%|px)? at 0%/);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await settled(page, 'bread');
  // Only clip-path moves (no layout property), and it is the only transition.
  expect(await page.locator('#cat-bread .ik-flood').evaluate((node) => getComputedStyle(node).transitionProperty)).toBe('clip-path');
  // Back up and down again: the band stays flooded, nothing replays. Sampled every frame for 400ms after the band
  // comes back in (an observer re-entry that replayed would show a smaller circle).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const clips = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    const flood = document.querySelector('#cat-bread .ik-flood')!;
    const seen: string[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      seen.push(getComputedStyle(flood).clipPath);
      await new Promise((done) => requestAnimationFrame(done));
    }
    return seen;
  });
  expect(clips.length).toBeGreaterThan(3);
  for (const clip of clips) expect(clip).toMatch(/circle\(150%/);
  expect(await flooded(page, 'bread')).toBe(true);
});

test('with an observer that never reports, no band stays hidden: the first screen is flooded, and a band floods when scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(ink(page)).toHaveAttribute('data-armed', '');
  await expect.poll(() => flooded(page, 'viennoiserie')).toBe(true);
  await page.locator('#cat-bread').scrollIntoViewIfNeeded();
  await expect.poll(() => flooded(page, 'bread'), { timeout: 2000 }).toBe(true);
  await settled(page, 'bread');
});

test('keyboard focus in a band that has not flooded floods it, without any scroll', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(ink(page)).toHaveAttribute('data-armed', '');
  // Past the one late pass after arming, so only the focus can flood it.
  await page.waitForTimeout(1500);
  expect(await flooded(page, 'bread')).toBe(false);
  await page.locator('#cat-bread .ik-name').first().evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await settled(page, 'bread');
});

test('tapping a chip floods that band from the chip as the page scrolls to it', async ({ page }) => {
  await openMenu(page, slug);
  expect(await flooded(page, 'bread')).toBe(false);
  // The chip's middle at the moment of the tap (the strip may have moved it into view just before).
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      (event) => {
        const chip = (event.target as Element).closest('[data-chips] button');
        if (chip) {
          const box = chip.getBoundingClientRect();
          (window as unknown as { __chipX: number }).__chipX = box.left + box.width / 2;
        }
      },
      true,
    );
  });
  await entry(page, 'bread').click();
  const chipX = await page.evaluate(() => (window as unknown as { __chipX: number }).__chipX);
  // The flood starts at the chip's x on the band's top edge.
  const origin = await page.locator('#cat-bread').evaluate((node) => node.style.getPropertyValue('--fx'));
  expect(Math.abs(parseFloat(origin) - (chipX / 390) * 100)).toBeLessThan(2);
  expect(parseFloat(origin)).toBeGreaterThan(0);
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await expect(page.locator('#cat-bread')).toBeInViewport();
  await settled(page, 'bread');
});

test('a flooded band floods again from the chip when its chip is tapped from afar, and a band in view is left alone', async ({ page }) => {
  await openMenu(page, slug);
  await entry(page, 'bread').click();
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await settled(page, 'bread');
  await page.evaluate(() => window.scrollTo(0, 0));
  await entry(page, 'bread').click();
  await expect(page.locator('#cat-bread [data-heading]')).toBeFocused();
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await settled(page, 'bread');
});

test('a search that clears does not flood the bands again, and never moves the scroll or the focus', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await settled(page, 'bread');
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = page.getByRole('searchbox', { name: 'Search the menu' });
  await box.fill('lemon tart');
  await expect(bands(page)).toHaveCount(1);
  await box.fill('');
  await expect(bands(page)).toHaveCount(BODY_CATEGORIES.length);
  await expect(box).toBeFocused();
  // Every band that was flooded is flooded at once (no closed circle, no transition from one) when it comes back.
  expect(await page.locator('#cat-bread').evaluate((node) => ({ in: node.hasAttribute('data-in'), clip: getComputedStyle(node.querySelector('.ik-flood')!).clipPath }))).toEqual(
    expect.objectContaining({ in: true, clip: expect.stringMatching(/circle\(150%/) }),
  );
});

test('reduced motion: every band is there at once, with no clip and no transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(ink(page)).not.toHaveAttribute('data-armed', /.*/);
  const states = await floods(page).evaluateAll((nodes) => nodes.map((node) => ({ clip: getComputedStyle(node).clipPath, transition: getComputedStyle(node).transitionDuration })));
  for (const state of states) {
    expect(state.clip).toMatch(/circle\(150%/);
    expect(parseFloat(state.transition)).toBeLessThan(0.001);
  }
});

test('a dish adds from its card and opens from its name, and tapping the photo opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + 12, photo.y + 12);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(ink(page)).toBeVisible();
  await expect(ink(page).locator('.ik-add')).toHaveCount(0);
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
  expect(await ink(page).locator('[data-photo] img, [data-photo] svg:not(.ik-add svg)').count()).toBe(0);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(80);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.ik-name')).toBeVisible();
    await expect(row.nth(index).locator('.ik-price')).toContainText('$');
  }
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a dish with no media shows a plate painted in its frame (rings, a ground of its own), in every palette', async ({ page }) => {
  for (const menuSlug of [bareSlug, ...alternatives.map(bareAt)]) {
    await openMenu(page, menuSlug);
    const row = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(row).toBeVisible();
    await expectPlatePainted(row.locator('[data-photo]'), row, { maxContrast: 1.6 });
  }
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = cards(page).nth(1);
  await cell.locator('.ik-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.ik-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.ik-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const price = (await cell.locator('.ik-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(cell.locator('.ik-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the dishes are three or more across in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  const c = (await row.nth(2).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(a.width).toBeLessThan(340);
  expect(a.width).toBeGreaterThan(150);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(bands(page).first().locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the grid mirrors, the flood starts on the other side and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  const add = (await row.first().locator('.ik-add').boundingBox())!;
  expect(add.x + add.width / 2).toBeLessThan(photo.x + photo.width / 2);
  expect(await ink(page).evaluate((node) => getComputedStyle(node).getPropertyValue('--fx-start'))).toBe('100%');
  expect(await page.locator('#cat-bread .ik-flood').evaluate((node) => getComputedStyle(node).clipPath)).toMatch(/ at 100% /);
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
      'unlit chip': chips(page).locator('.ik-chip:not([aria-current="true"])').first(),
      'lit chip': chips(page).locator('[aria-current="true"]'),
      'band name': first.locator('h2 > span'),
      'band count': first.locator('h2 b'),
      'card name': first.locator('.ik-name').first(),
      'card price': first.locator('.ik-price').first(),
      'add button': first.locator('.ik-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': ink(page).locator('.tpl-off').first() }),
    });
  }
  // Every band of a long menu, too: each hue with the text colour picked for it.
  await openMenu(page, manySlug);
  await page.evaluate(() => window.scrollBy(0, 40));
  const count = await bands(page).count();
  for (let at = 0; at < 9; at++) {
    const band = bands(page).nth(at);
    await expect.poll(() => contrastOf(band.locator('h2 > span')), { message: `band ${at + 1} name` }).toBeGreaterThanOrEqual(4.5);
    await expect.poll(() => contrastOf(chips(page).locator('.ik-chip').nth(at)), { message: `chip ${at + 1}` }).toBeGreaterThanOrEqual(4.5);
  }
  expect(count).toBe(BODY_CATEGORIES.length + 20);
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = cards(page).first();
    const name = cell.locator('.ik-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, cell, { outset: -2, pseudo: '::after' });
    const add = cell.locator('.ik-add');
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

test('a dish on sale shows a -NN% chip in the menu numerals on its photo, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = cards(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(ink(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
