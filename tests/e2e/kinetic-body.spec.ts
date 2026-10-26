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
 * The Dancing Letters body (spec 2026-10-26-menu-styles-in-templates-design.md): a typographic menu. Each dish is a
 * poster-type row (the name large, split into words that rise in when the row enters view; the price in oversized
 * numerals that flip once; a small round photo at the row's end); sections are giant outlined words; a sticky strip of
 * boxed chips jumps.
 */

const menus = bodyMenus();
const slug = menus.slug('kin');
const arabSlug = menus.slug('kinar');
const alternatives = paletteIdsOf('the-dancing-letters').slice(1);
const paletteSlug = (id: string) => menus.slug(`kin-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'kinetic', { templateId: 'the-dancing-letters' });
  await menus.create(arabSlug, 'kinetic', { templateId: 'the-dancing-letters', numeralSystem: 'ARAB', discount: ['croissant'] });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'kinetic', { templateId: 'the-dancing-letters', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const kinetic = (page: Page) => page.locator('[data-body="kinetic"]');
const chips = (page: Page) => kinetic(page).locator('[data-chips]');
const rows = (page: Page) => kinetic(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const wordOf = (row: ReturnType<typeof rows>) => row.locator('.kn-word > span').first();
const riseOf = (row: ReturnType<typeof rows>) => wordOf(row).evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);

test('on a phone the first screen shows at least four poster rows with a photo and a price, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(kinetic(page)).toBeVisible();
  await page.waitForTimeout(1200);
  await expectFirstScreen(page, rows(page), { min: 4 });
  await expectEverySectionReachable(chips(page));
});

test('a row is a poster: a large name, oversized price numerals under it and a small round photo at the end', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).first();
  const name = (await row.locator('.kn-name').boundingBox())!;
  const price = (await row.locator('.kn-price').boundingBox())!;
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  const size = (sel: string) => row.locator(sel).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(await size('.kn-name')).toBeGreaterThanOrEqual(20);
  expect(await size('.kn-price')).toBeGreaterThanOrEqual(24);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 2);
  expect(photo.x).toBeGreaterThanOrEqual(name.x + name.width - 1);
  expect(photo.width).toBeLessThanOrEqual(80);
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  expect(await row.locator('[data-photo]').evaluate((node) => getComputedStyle(node).borderRadius)).toBe('50%');
  await expect(row.locator('.kn-price')).toContainText('$');
});

test('the name is split into words, never letters, and still reads as one name', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).filter({ hasText: dishName('croissant') }).first();
  expect(await row.locator('.kn-word').count()).toBe(dishName('croissant').trim().split(/\s+/).length);
  await expect(row.getByRole('button', { name: dishName('croissant'), exact: true })).toBeVisible();
});

test('every section is titled by a giant outlined word with its dish count, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const sections = kinetic(page).locator('section.kn-section');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  const word = sections.first().getByRole('heading', { name: /Viennoiserie/ }).locator('span');
  const style = await word.evaluate((node) => {
    const own = getComputedStyle(node);
    return { size: parseFloat(own.fontSize), stroke: parseFloat(own.webkitTextStrokeWidth), fill: own.webkitTextFillColor };
  });
  expect(style.size).toBeGreaterThanOrEqual(36);
  expect(style.stroke).toBeGreaterThan(0);
  expect(style.fill).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});

test('a chip takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the chip strip lights the section in view and stays at the top', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(chips(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expectStripStays(page, chips(page), entry(page, 'viennoiserie'), 'viennoiserie');
});

test('a row below the screen holds its words and price until it enters view; then they rise and flip, once', async ({ page }) => {
  await openMenu(page, slug);
  await expect(kinetic(page)).toHaveAttribute('data-armed', '');
  const far = page.locator('#cat-bread [data-row]').first();
  expect(await riseOf(far)).toBeGreaterThan(5);
  await expect(far.locator('.kn-price')).toHaveCSS('opacity', '0');
  await far.scrollIntoViewIfNeeded();
  await expect(far).toHaveAttribute('data-in', '');
  await expect.poll(() => riseOf(far)).toBe(0);
  await expect(far.locator('.kn-price')).toHaveCSS('opacity', '1');
  await expect(far.locator('.kn-price')).toHaveCSS('transform', 'none');
  // Scrolled away and back, it stays shown and does not play again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  expect(await riseOf(far)).toBe(0);
  await far.scrollIntoViewIfNeeded();
  expect(await riseOf(far)).toBe(0);
});

test('the words rise one after another: a later word starts later', async ({ page }) => {
  await openMenu(page, slug);
  const delays = await page.locator('#cat-celebration [data-row]').first().locator('.kn-word > span').evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).transitionDelay)));
  expect(delays.length).toBeGreaterThan(1);
  for (let at = 1; at < Math.min(delays.length, 6); at++) expect(delays[at]).toBeGreaterThan(delays[at - 1]!);
});

test('a long name has its last word up within the cap: the word delay stops growing at 350ms', async ({ page }) => {
  await openMenu(page, slug);
  const name = page.locator('#cat-celebration [data-row]').first().locator('.kn-name');
  await name.evaluate((button) => {
    const word = button.querySelector('.kn-word')!;
    for (let at = 1; at < 12; at++) {
      const copy = word.cloneNode(true) as HTMLElement;
      copy.style.setProperty('--w', String(at));
      button.append(copy);
    }
  });
  const delays = await name.locator('.kn-word > span').evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).transitionDelay)));
  expect(Math.max(...delays)).toBeLessThanOrEqual(0.35);
});

test('a search keeps the rows already shown shown: the entrance does not play again', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).first();
  await expect(row).toHaveAttribute('data-in', '');
  await expect.poll(() => riseOf(row)).toBe(0);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('croissant');
  const kept = rows(page).filter({ hasText: dishName('croissant') }).first();
  await expect(kept).toBeVisible();
  expect(await riseOf(kept)).toBe(0);
  await expect(kept.locator('.kn-price')).toHaveCSS('opacity', '1');
});

test('clearing a search that hid the first rows brings them back shown: the entrance does not play again', async ({ page }) => {
  await openMenu(page, slug);
  const first = rows(page).filter({ hasText: dishName('croissant') }).first();
  await expect(first).toHaveAttribute('data-in', '');
  await expect.poll(() => riseOf(first)).toBe(0);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('eclair');
  await expect(rows(page).filter({ hasText: dishName('croissant') })).toHaveCount(0);
  await search.fill('');
  const back = rows(page).filter({ hasText: dishName('croissant') }).first();
  await expect(back).toBeVisible();
  // Right away, not after a rise: the restored row is a new node, but its dish was already shown.
  expect(await back.evaluate((row) => row.hasAttribute('data-in'))).toBe(true);
  expect(await riseOf(back)).toBe(0);
  await expect(back.locator('.kn-price')).toHaveCSS('opacity', '1');
});

test('a dish opens and adds, and its photo and the whole row are tap targets', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const photo = (await rows(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a long dish name and a long price stay inside the row without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).first();
  await row.locator('.kn-name').evaluate((node) => {
    node.innerHTML = 'Averyveryverylongdishnamewithoutanyspaceatall and a name that keeps going and going and going and going on';
  });
  await row.locator('.kn-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await row.boundingBox())!;
  const price = (await row.locator('.kn-price').boundingBox())!;
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(photo.x + 1);
  const lines = await row.locator('.kn-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(3);
});

test('on a wide screen the rows are a centred column of bigger poster rows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = rows(page).first();
  const box = (await row.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(780);
  expect(await row.locator('.kn-name').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(36);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(kinetic(page).locator('section.kn-section').first().locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the photo is at the row start side mirrored and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const row = rows(page).first();
  const name = (await row.locator('.kn-name').boundingBox())!;
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  expect(photo.x + photo.width).toBeLessThanOrEqual(name.x + 1);
});

test('reduced motion: nothing is hidden and nothing moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(kinetic(page)).not.toHaveAttribute('data-armed', '');
  const far = page.locator('#cat-bread [data-row]').first();
  expect(await riseOf(far)).toBe(0);
  await expect(far.locator('.kn-price')).toHaveCSS('opacity', '1');
  await expect(far.locator('.kn-price')).toHaveCSS('transform', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('text reads on every fill it sits on, in every palette of the shape', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', arabSlug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)])];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(chips(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit chip': chips(page).locator('.kn-chip:not([aria-current="true"])').first(),
      'lit chip': chips(page).locator('[aria-current="true"]'),
      'section name': first.locator('h2 > span'),
      'dish count': first.locator('h2 b'),
      'dish name': first.locator('.kn-name').first(),
      'dish price': first.locator('.kn-price').first(),
      'add button': first.locator('.kn-add').first(),
      'sale chip': kinetic(page).locator('.tpl-off').first(),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole row and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const row = rows(page).first();
    const name = row.locator('.kn-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, row, { outset: -3, pseudo: '::after' });
    const chip = entry(page, 'patisserie');
    await chip.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip).toBeFocused();
    await expectFocusRingShows(page, chip, { outset: -4 });
  }
});

test('a dish on sale shows a −NN% chip in the menu numerals beside its price, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = rows(page).filter({ hasText: dishName('croissant') });
  const chip = row.locator('.tpl-off');
  await expect(chip).toHaveText('−٢٠%');
  await expect(kinetic(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await row.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(row.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
