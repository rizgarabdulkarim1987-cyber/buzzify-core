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
 * The Bento Box body (spec 2026-10-26-menu-styles-in-templates-design.md, the mockup layout-2-bnt): the whole menu one
 * black lacquer box with chopsticks across its top, every section a red tray under a paper label cut into square
 * compartments three across (two across for a section of two), a paper flag on each with the add dot and the name and
 * an accent flag with the price, and a sticky strip of lid-handle tabs that jumps to a tray.
 */

const menus = bodyMenus();
const slug = menus.slug('bnt');
const arabSlug = menus.slug('bntar');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-bento-box').slice(1);
const paletteSlug = (id: string) => menus.slug(`bnt-${id}`);

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'bento', { templateId: 'the-bento-box' });
  // Arabic-Indic numerals, and the croissant 20% off: the sale chip.
  await menus.create(arabSlug, 'bento', { templateId: 'the-bento-box', numeralSystem: 'ARAB', discount: ['croissant'] });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'bento', { templateId: 'the-bento-box', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const bento = (page: Page) => page.locator('[data-body="bento"]');
const lids = (page: Page) => bento(page).locator('[data-lids]');
const cells = (page: Page) => bento(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => lids(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });

test('on a phone the first screen shows at least three dishes with photos, prices and names (the demo banner above takes most of it), and every box is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(bento(page)).toBeVisible();
  await expectFirstScreen(page, cells(page), { min: 3 });
  await expectEverySectionReachable(lids(page));
});

test('every section is a box with a paper label (number, name, dish count), all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const boxes = bento(page).locator('section[data-box]');
  expect(await boxes.count()).toBe(BODY_CATEGORIES.length);
  await expect(boxes.first().locator('[data-count]')).toHaveText('3');
  await expect(bento(page).locator('#cat-bread [data-count]')).toHaveText('1');
  const heading = boxes.first().getByRole('heading', { name: /Viennoiserie/ });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('Box 1');
});

test('the compartments are squares, three across, inside one lacquer box with chopsticks on top; two dishes are two across', async ({ page }) => {
  await openMenu(page, slug);
  await expect(bento(page).locator('.bn-sticks')).toBeVisible();
  expect(await bento(page).locator('.bn-lacquer').count()).toBe(1);
  expect(await bento(page).locator('.bn-lacquer section[data-box]').count()).toBe(BODY_CATEGORIES.length);
  const three = page.locator('#cat-viennoiserie [data-row]');
  expect(await three.count()).toBe(3);
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await three.nth(i).boundingBox())!));
  for (const box of [a!, b!, c!]) expect(Math.abs(box.width - box.height), 'a square compartment').toBeLessThanOrEqual(1.5);
  expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(b!.y - c!.y)).toBeLessThanOrEqual(1);
  expect(a!.x).toBeLessThan(b!.x);
  expect(b!.x).toBeLessThan(c!.x);
  // Celebration holds two dishes: two across, each half the tray.
  const two = page.locator('#cat-celebration [data-row]');
  expect(await two.count()).toBe(2);
  const [d, e] = await Promise.all([0, 1].map(async (i) => (await two.nth(i).boundingBox())!));
  expect(Math.abs(d!.y - e!.y)).toBeLessThanOrEqual(1);
  expect(d!.width).toBeGreaterThan(a!.width * 1.3);
});

test('a compartment carries a name flag at its foot and a price flag on its corner, over the photo', async ({ page }) => {
  await openMenu(page, slug);
  const cell = cells(page).first();
  const box = (await cell.boundingBox())!;
  const name = (await cell.locator('.bn-name').boundingBox())!;
  const price = (await cell.locator('.bn-price').boundingBox())!;
  expect(name.y + name.height).toBeGreaterThan(box.y + box.height - 12);
  expect(price.y).toBeLessThan(box.y + 12);
  await expect(cell.locator('.bn-price')).toContainText('$');
});

test('a lid tab takes you to its box and focuses the label', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the lid strip lights the box in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(lids(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the lid strip stays at the top: scrolled to the end, the first box is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, lids(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a compartment opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await cells(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the smallest compartment without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = page.locator('#cat-viennoiserie [data-row]').nth(1);
  await cell.locator('.bn-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.bn-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.bn-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const flag = (await cell.locator('.bn-price').boundingBox())!;
  expect(flag.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(flag.x + flag.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(flag.y + flag.height).toBeLessThanOrEqual(box.y + box.height + 1);
});

test('in every compartment the photo stays in sight: the price flag and the name flag never overlap, the add dot sits on the name flag, and at least 35% of the photo is uncovered', async ({ page }) => {
  await openMenu(page, slug);
  const three = page.locator('#cat-viennoiserie [data-row]');
  expect(await three.count()).toBe(3);
  // The worst ordinary case: a name of two lines and a long price, on every compartment of a tray of three.
  for (let i = 0; i < 3; i++) {
    await three.nth(i).locator('.bn-name').evaluate((node) => {
      node.textContent = 'Pain au chocolat aux amandes grillées';
    });
    await three.nth(i).locator('.bn-price').evaluate((node) => {
      node.textContent = 'From 12,500 IQD';
    });
  }
  for (let i = 0; i < 3; i++) {
    const report = await three.nth(i).evaluate((cell) => {
      const box = cell.getBoundingClientRect();
      const parts = ['.bn-price', '.bn-name'].map((selector) => cell.querySelector(selector)!.getBoundingClientRect());
      const overlaps: string[] = [];
      const width = Math.min(parts[0]!.right, parts[1]!.right) - Math.max(parts[0]!.left, parts[1]!.left);
      const height = Math.min(parts[0]!.bottom, parts[1]!.bottom) - Math.max(parts[0]!.top, parts[1]!.top);
      if (width > 0.5 && height > 0.5) overlaps.push('price over name');
      const add = cell.querySelector('.bn-add')!.getBoundingClientRect();
      const flag = parts[1]!;
      if (add.left < flag.left - 0.5 || add.right > flag.right + 0.5 || add.top < flag.top - 0.5 || add.bottom > flag.bottom + 0.5) overlaps.push('add outside the name flag');
      const photo = cell.querySelector('[data-photo] img, [data-photo] svg')!.getBoundingClientRect();
      let seen = 0;
      let all = 0;
      for (let y = box.top + 0.5; y < box.bottom; y += 2) {
        for (let x = box.left + 0.5; x < box.right; x += 2) {
          all++;
          const inPhoto = x >= photo.left && x <= photo.right && y >= photo.top && y <= photo.bottom;
          if (inPhoto && !parts.some((p) => x >= p.left && x <= p.right && y >= p.top && y <= p.bottom)) seen++;
        }
      }
      return { overlaps, share: seen / all };
    });
    expect(report.overlaps, `compartment ${i + 1}: name, price and add overlap`).toEqual([]);
    expect(report.share, `compartment ${i + 1}: share of the photo in sight`).toBeGreaterThanOrEqual(0.35);
  }
});

test('on a wide screen the boxes stay a tidy column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const box = (await page.locator('#cat-viennoiserie').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(580);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  const first = bento(page).locator('section[data-box]').first();
  await expect(first.locator('[data-count]')).toHaveText('٣');
  await expect(first).toHaveAttribute('data-box', '١');
});

test('in Arabic the page is right to left, the box mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => lids(p));
  const three = page.locator('#cat-viennoiserie [data-row]');
  const a = (await three.nth(0).boundingBox())!;
  const b = (await three.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
});

test('reduced motion removes the compartment entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(cells(page).first()).toHaveCSS('animation-name', 'none');
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
    // Scrolled a little, so a strip entry is lit; the first section is still on the screen.
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(lids(page).locator('[aria-current="true"]')).toHaveCount(1);
    const island = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit lid tab': lids(page).locator('.bn-lid:not([aria-current="true"])').first(),
      'lit lid tab': lids(page).locator('[aria-current="true"]'),
      'box label': island.locator('.bn-tag'),
      'box number': island.locator('.bn-tag small'),
      'dish count': island.locator('.bn-tag b'),
      'price flag': island.locator('.bn-price').first(),
      'name flag': island.locator('.bn-name').first(),
      'add button': island.locator('.bn-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': bento(page).locator('.tpl-off').first() }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole compartment and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = cells(page).first();
    const name = cell.locator('.bn-name');
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

test('a dish on sale shows a −NN% chip in the menu numerals on its compartment, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = cells(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(bento(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
