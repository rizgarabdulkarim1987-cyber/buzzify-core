import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
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
 * The Photo to Details body (poster motion-mor; spec 2026-10-26-menu-styles-in-templates-design.md): a calm, photo-first
 * menu: a sticky strip of pill chips, and every section a plain heading over a two-column grid of big rounded square photos
 * (the name under each, the price and the add on a row); a tapped photo grows into the dish's details.
 */

const menus = bodyMenus();
const slug = menus.slug('mor');
const arabSlug = menus.slug('morar');
const manySlug = menus.slug('mormany');
const bareSlug = menus.slug('morbare');
const cardSlug = menus.slug('morcard');
const crowdSlug = menus.slug('morcrowd');
const alternatives = paletteIdsOf('the-photo-to-details').slice(1);
const paletteSlug = (id: string) => menus.slug(`mor-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'morph', { templateId: 'the-photo-to-details' });
  await menus.create(arabSlug, 'morph', { templateId: 'the-photo-to-details', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'morph', { templateId: 'the-photo-to-details', extraSections: 20 });
  await menus.create(crowdSlug, 'morph', { templateId: 'the-photo-to-details', crowd: 3 });
  await menus.create(bareSlug, 'morph', { templateId: 'the-photo-to-details', noPhotos: true });
  // The details as a card (Customize): its entrance scales the panel from 0.97.
  await menus.create(cardSlug, 'morph', { templateId: 'the-photo-to-details', layout: { detail: 'card' } });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'morph', { templateId: 'the-photo-to-details', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

/** Takes the fixture's demo card (above the search) and its dietary chips off the page: a real menu has neither. */
const dropDemoCard = (page: Page) =>
  page.evaluate(() => {
    const search = document.querySelector('input[type="search"], [role="searchbox"]')!;
    const demo = [...document.querySelectorAll('h1,h2,p,div')].find((node) => node.children.length === 0 && node.textContent === 'Demonstration menu');
    let at: Element | null = demo ?? null;
    while (at && !at.parentElement?.contains(search)) at = at.parentElement;
    at?.remove();
    const chip = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Vegetarian');
    if (chip && !chip.parentElement?.contains(search)) chip.parentElement?.remove();
  });
const morph = (page: Page) => page.locator('[data-body="morph"]');
const chips = (page: Page) => morph(page).locator('[data-chips]');
const tiles = (page: Page) => morph(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

interface Seen {
  start: DOMRect | null;
  /** The picture inside the clone at the start: its width over its height (the details photo's when unsquashed). */
  ratio: number;
  /** The clone's box on its last frame before it was removed (where it landed). */
  last: DOMRect | null;
  attached: number;
  removed: number;
  top: boolean;
}

/** Records every grown-photo clone the page draws (its first and last box, whether it is in the top layer), keyed by node. */
async function watchClones(page: Page) {
  await page.addInitScript(() => {
    const seen: Seen[] = [];
    const entries = new WeakMap<Node, Seen>();
    (window as unknown as { __clones: Seen[] }).__clones = seen;
    const sample = (node: HTMLElement, entry: Seen) => {
      if (!node.isConnected) return;
      entry.last = node.getBoundingClientRect();
      requestAnimationFrame(() => sample(node, entry));
    };
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.hasAttribute('data-morph-clone')) return;
          const entry: Seen = { start: null, ratio: 0, last: null, attached: performance.now(), removed: 0, top: false };
          seen.push(entry);
          entries.set(node, entry);
          requestAnimationFrame(() => {
            entry.start = node.getBoundingClientRect();
            const picture = node.querySelector('img, svg')?.getBoundingClientRect();
            entry.ratio = picture ? picture.width / picture.height : 0;
            entry.top = node.matches(':popover-open');
            sample(node, entry);
          });
        });
        record.removedNodes.forEach((node) => {
          const entry = entries.get(node);
          if (entry) entry.removed = performance.now();
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const clones = (page: Page) => page.evaluate(() => (window as unknown as { __clones: Seen[] }).__clones);

/**
 * Opens and closes a dish once, so the details' code is loaded (a first open on a busy dev server can take longer than
 * the clone waits, and then the dish opens plain), and forgets the clones that open drew.
 */
async function warmDetails(page: Page) {
  const menuUrl = page.url();
  await tiles(page).nth(2).locator('.mo-name').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // Closing goes back in history: wait until the menu's own address is back, so the next open is not undone by it.
  await expect(page).toHaveURL(menuUrl);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await expect(page.locator('[data-morph-clone]')).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { __clones: Seen[] }).__clones.length = 0;
  });
}

test('on a phone the strip, the search and the photo tiles with prices show on the first screen, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(morph(page)).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expect(chips(page)).toBeInViewport();
  // The fixture menu carries a demo card and dietary chips above the search (about 450px); with them two tiles show.
  await expectFirstScreen(page, tiles(page), { min: 2 });
  await expectEverySectionReachable(chips(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

test('in a section of six dishes, with no demo card above the search (a real menu), at least four photo tiles with prices fill the first screen', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await dropDemoCard(page);
  await expectFirstScreen(page, tiles(page), { min: 4 });
});

test('the tiles sit two across on a phone: a big rounded square photo, the name under it, then the price and the add on a row', async ({ page }) => {
  await openMenu(page, slug);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  const c = (await cells.nth(2).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(a.width).toBeGreaterThan(150);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  const tile = cells.first();
  const [photo, name, price, add] = [(await tile.locator('[data-photo]').boundingBox())!, (await tile.locator('.mo-name').boundingBox())!, (await tile.locator('.mo-price').boundingBox())!, (await tile.locator('.mo-add').boundingBox())!];
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(2);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(Math.abs(price.y + price.height / 2 - (add.y + add.height / 2))).toBeLessThan(16);
  expect(add.width).toBeGreaterThanOrEqual(40);
  const look = await tile.locator('[data-photo]').evaluate((node) => ({ radius: parseFloat(getComputedStyle(node).borderTopLeftRadius), shadow: getComputedStyle(node).boxShadow }));
  expect(look.radius).toBeGreaterThanOrEqual(16);
  expect(look.shadow).not.toBe('none');
  await expect(tile.locator('.mo-price')).toContainText('$');
});

test('every section is a block with a plain heading, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const sections = morph(page).locator('section[data-morph]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(sections.first().getByRole('heading', { name: /Viennoiserie/ })).toBeVisible();
  // The heading is plain (poster): not pinned under the strip.
  expect(await page.locator('#cat-patisserie [data-heading]').evaluate((node) => getComputedStyle(node).position)).not.toBe('sticky');
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

test('a menu with twenty-five sections keeps every section one tap away on a scrolling strip', async ({ page }) => {
  await openMenu(page, manySlug);
  await expect(chips(page).getByRole('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  await expectFirstScreen(page, tiles(page), { min: 2 });
  const last = chips(page).getByRole('button', { name: 'Section 25' });
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(page.locator('#cat-more-20 [data-heading]')).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('tapping a photo opens the dish and its photo grows from the tile into the details (a clone that is gone afterwards)', async ({ page }) => {
  await watchClones(page);
  await openMenu(page, slug);
  await warmDetails(page);
  const tile = tiles(page).first();
  const frame = (await tile.locator('[data-photo]').boundingBox())!;
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await clones(page)).length, { message: 'a clone was drawn' }).toBe(1);
  await expect.poll(async () => (await clones(page))[0]!.removed, { message: 'the clone is removed when it has landed' }).toBeGreaterThan(0);
  const [clone] = await clones(page);
  // It starts over the tile's photo, in the top layer (above the open dialog), and lives for well under two seconds.
  expect(Math.abs(clone!.start!.x - frame.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(clone!.start!.width - frame.width)).toBeLessThanOrEqual(2);
  expect(clone!.top).toBe(true);
  expect(clone!.removed - clone!.attached).toBeLessThan(2000);
  await expect(page.locator('[data-morph-clone]')).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: dishName('croissant') })).toBeVisible();
});

test('reduced motion: the dish simply opens, no clone is drawn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watchClones(page);
  await openMenu(page, slug);
  const shown = (await tiles(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(shown.x + shown.width / 2, shown.y + shown.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await clones(page)).toHaveLength(0);
  await expect(tiles(page).first()).toHaveCSS('animation-name', 'none');
});

test('a dish opens and adds from its tile', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
});

test('a long dish name and a long price stay inside the tile, and its photo keeps at least 45% of the tile', async ({ page }) => {
  await openMenu(page, slug);
  const cell = tiles(page).nth(0);
  await cell.locator('.mo-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.mo-price').evaluate((node) => {
    node.textContent = 'From 12,500 IQD';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.mo-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const price = (await cell.locator('.mo-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  // The photo still shows above the bar: not a sliver.
  expect((await cell.locator('[data-photo]').boundingBox())!.height).toBeGreaterThanOrEqual(box.height * 0.45);
  // A very long price wraps inside the second tile.
  const tall = tiles(page).nth(1);
  await tall.locator('.mo-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  const tallBox = (await tall.boundingBox())!;
  const tallPrice = (await tall.locator('.mo-price').boundingBox())!;
  expect(tallPrice.x + tallPrice.width).toBeLessThanOrEqual(tallBox.x + tallBox.width + 1);
  expect(tallPrice.y + tallPrice.height).toBeLessThanOrEqual(tallBox.y + tallBox.height + 1);
});

test('on a wide screen the grid is three or more columns in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  const c = (await cells.nth(2).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  expect(b.x).toBeLessThan(c.x);
  // Four columns on a desktop: a tile is narrower than a third of the column.
  expect(a.width).toBeLessThan(330);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(morph(page).locator('section[data-morph]').first().locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the grid mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
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
      'unlit chip': chips(page).locator('.mo-chip:not([aria-current="true"])').first(),
      'lit chip': chips(page).locator('[aria-current="true"]'),
      'section name': first.locator('h2 > span'),
      'caption name': first.locator('.mo-name').first(),
      'caption price': first.locator('.mo-price').first(),
      'add button': first.locator('.mo-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': morph(page).locator('.tpl-off').first() }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole tile and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = tiles(page).first();
    const name = cell.locator('.mo-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, cell, { outset: 4, pseudo: '::after' });
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
  const cell = tiles(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(morph(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});

/** The details' photo: the open dialog's first picture big enough to be the dish's photo. */
const detailsPhoto = (page: Page) =>
  page.evaluate(() => {
    for (const picture of document.querySelectorAll('dialog[open] img, dialog[open] svg')) {
      const box = picture.getBoundingClientRect();
      if (box.width >= 120 && box.height >= 80) return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return null;
  });

for (const [label, menu] of [
  ['a sheet', () => slug],
  ['a card (its entrance scales the panel)', () => cardSlug],
] as const) {
  test(`the grown photo lands on the details photo, unsquashed, and focus is in the details: ${label}`, async ({ page }) => {
    await watchClones(page);
    await openMenu(page, menu());
    await warmDetails(page);
    // A tall tile: its photo is about square, unlike the wide details photo.
    const frame = (await tiles(page).nth(1).locator('[data-photo]').boundingBox())!;
    await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await clones(page))[0]?.removed ?? 0, { message: 'the clone landed and was removed' }).toBeGreaterThan(0);
    const [clone] = await clones(page);
    await page.waitForTimeout(400);
    const target = (await detailsPhoto(page))!;
    expect(Math.abs(clone!.last!.x - target.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(clone!.last!.y - target.y)).toBeLessThanOrEqual(3);
    expect(Math.abs(clone!.last!.width - target.width)).toBeLessThanOrEqual(3);
    // At the start the picture keeps the details photo's proportions (scaled the same across and down), though the
    // tile's own proportions differ.
    expect(Math.abs(frame.width / frame.height - target.width / target.height)).toBeGreaterThan(0.3);
    expect(Math.abs(clone!.ratio - target.width / target.height)).toBeLessThanOrEqual(0.05);
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  });
}

test('a double tap on a photo draws one clone, not two on top of each other', async ({ page }) => {
  await watchClones(page);
  await openMenu(page, slug);
  await warmDetails(page);
  const frame = (await tiles(page).nth(1).locator('[data-photo]').boundingBox())!;
  await page.mouse.dblclick(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await clones(page)).toHaveLength(1);
  await expect(page.locator('[data-morph-clone]')).toHaveCount(0);
});

test('going Back while the photo grows removes the clone at once', async ({ page }) => {
  await watchClones(page);
  await openMenu(page, slug);
  await warmDetails(page);
  const frame = (await tiles(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expect.poll(async () => (await clones(page)).length, { intervals: [10] }).toBe(1);
  await page.goBack();
  await expect(page.locator('[data-morph-clone]')).toHaveCount(0, { timeout: 150 });
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a dish with no media shows a plate on its photo, and opens with no clone', async ({ page }) => {
  await watchClones(page);
  await openMenu(page, bareSlug);
  const cell = tiles(page).first();
  const media = cell.locator('[data-photo] > :first-child');
  expect(await media.evaluate((node) => node.childElementCount)).toBe(0);
  // The plate is painted on the media itself (the photo's top layer), so it shows: more than one colour there.
  expect(await media.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('radial-gradient');
  const shot = await sharp(await media.screenshot()).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set<string>();
  for (let at = 0; at < shot.data.length; at += shot.info.channels * 7) colours.add(`${shot.data[at]},${shot.data[at + 1]},${shot.data[at + 2]}`);
  expect(colours.size, 'the plate draws rings, not a flat fill').toBeGreaterThan(3);
  // The photo area is told apart from the caption bar.
  const photoFill = await media.evaluate((node) => getComputedStyle(node).backgroundColor);
  const barFill = await cell.locator('.mo-bar').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(photoFill).not.toBe(barFill);
  const frame = (await cell.locator('[data-photo]').boundingBox())!;
  await page.mouse.click(frame.x + frame.width / 3, frame.y + frame.height / 3);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await clones(page)).toHaveLength(0);
});
