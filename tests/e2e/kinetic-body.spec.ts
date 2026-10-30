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
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  openMenu,
  paletteIdsOf,
  silenceObserver,
} from './helpers/body-menu';

/**
 * The Dancing Letters body (the motion-kin mockup, spec 2026-10-26-menu-styles-in-templates-design.md): a typographic
 * poster. A black band of the section names, a sticky strip of boxed chips, giant solid section words over a two-column
 * grid of big square photos; each dish has its name (split into words that rise in when it enters view), a price in
 * oversized numerals that flip once and a red add square.
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

test('on a phone the first screen shows poster dishes with a photo and a price (all three of the first section once the demo card above is gone), and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(kinetic(page)).toBeVisible();
  await page.waitForTimeout(1200);
  // The Maison demo card, the offers and the filter chips above the menu take most of the first screen by themselves.
  await expectFirstScreen(page, rows(page), { min: 2 });
  await page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
    (content.querySelector('.tpl-tools [role="group"], .tpl-tools > :nth-child(2)') as HTMLElement | null)?.style.setProperty('display', 'none');
  });
  await expectFirstScreen(page, rows(page), { min: 3 });
  await expectEverySectionReachable(chips(page));
});

test('a dish is a poster cell: a big square photo, the bold name under it, the price numerals and the add square, two across', async ({ page }) => {
  await openMenu(page, slug);
  const cells = rows(page);
  const row = cells.first();
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  const name = (await row.locator('.kn-name').boundingBox())!;
  const price = (await row.locator('.kn-price').boundingBox())!;
  const add = (await row.locator('.kn-add').boundingBox())!;
  const size = (sel: string) => row.locator(sel).evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(photo.width).toBeGreaterThanOrEqual(150);
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 2);
  expect(Math.abs(add.y + add.height / 2 - (price.y + price.height / 2))).toBeLessThanOrEqual(12);
  expect(await size('.kn-name')).toBeGreaterThanOrEqual(15);
  expect(await size('.kn-price')).toBeGreaterThanOrEqual(22);
  expect(await row.locator('.kn-name').evaluate((node) => Number(getComputedStyle(node).fontWeight))).toBeGreaterThanOrEqual(800);
  // Two columns on a phone: the second dish sits beside the first.
  const second = (await cells.nth(1).boundingBox())!;
  const first = (await row.boundingBox())!;
  expect(Math.abs(second.y - first.y)).toBeLessThanOrEqual(2);
  expect(second.x).not.toBe(first.x);
  await expect(row.locator('.kn-price')).toContainText('$');
});

test('the black band names the sections and settles within five seconds; the search box is on the first screen', async ({ page }) => {
  await openMenu(page, slug);
  const band = kinetic(page).locator('.kn-marquee');
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute('aria-hidden', 'true');
  expect(await band.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(await kinetic(page).evaluate((node) => getComputedStyle(node).color));
  await expectMotionEnds(band);
  const search = (await page.getByRole('searchbox', { name: 'Search the menu' }).boundingBox())!;
  expect(search.y + search.height).toBeLessThanOrEqual(844);
});

test('the name is split into words, never letters, and still reads as one name', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).filter({ hasText: dishName('croissant') }).first();
  expect(await row.locator('.kn-word').count()).toBe(dishName('croissant').trim().split(/\s+/).length);
  await expect(row.getByRole('button', { name: dishName('croissant'), exact: true })).toBeVisible();
});

test('every section is titled by a giant solid display word with its dish count, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const sections = kinetic(page).locator('section.kn-section');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  const word = sections.first().getByRole('heading', { name: /Viennoiserie/ }).locator('> span');
  const style = await word.evaluate((node) => {
    const own = getComputedStyle(node);
    return { size: parseFloat(own.fontSize), fill: own.webkitTextFillColor, ink: getComputedStyle(node.closest('[data-body]')!).color };
  });
  expect(style.size).toBeGreaterThanOrEqual(36);
  expect(style.fill).toBe(style.ink);
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

test('with an observer that never reports, no row stays hidden: a far row shows when scrolled to, or when focused', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(kinetic(page)).toHaveAttribute('data-armed', '');
  await expect(rows(page).first()).toHaveAttribute('data-in', '');
  await page.waitForTimeout(1500);
  const far = page.locator('#cat-bread [data-row]').first();
  await expect(far).not.toHaveAttribute('data-in', '');
  await far.locator('.kn-name').evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  await expect(far).toHaveAttribute('data-in', '');
  const cake = page.locator('#cat-celebration [data-row]').first();
  await cake.scrollIntoViewIfNeeded();
  await expect(cake).toHaveAttribute('data-in', '', { timeout: 2000 });
  await expect.poll(() => riseOf(cake)).toBe(0);
});

test('a row below the screen holds its words and price until it enters view; then they rise and flip, once', async ({ page }) => {
  await openMenu(page, slug);
  await expect(kinetic(page)).toHaveAttribute('data-armed', '');
  const far = page.locator('#cat-bread [data-row]').first();
  expect(await riseOf(far)).toBeGreaterThan(5);
  await expect(far.locator('.kn-price')).toHaveCSS('opacity', '0');
  expect(await far.locator('[data-photo]').evaluate((node) => getComputedStyle(node).clipPath)).toContain('inset');
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

test('a long dish name and a long price stay inside the cell without sideways scrolling', async ({ page }) => {
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
  const add = (await row.locator('.kn-add').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const lines = await row.locator('.kn-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
});

test('on a wide screen the dishes are three across in a centred column with bigger names', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = rows(page).first();
  const grid = (await kinetic(page).locator('.kn-grid').first().boundingBox())!;
  expect(grid.width).toBeLessThanOrEqual(900);
  expect(await row.locator('.kn-name').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  const second = (await rows(page).nth(1).boundingBox())!;
  const third = (await rows(page).nth(2).boundingBox())!;
  expect(Math.abs(second.y - third.y)).toBeLessThanOrEqual(2);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(kinetic(page).locator('section.kn-section').first().locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the first dish is on the right and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const first = (await rows(page).first().boundingBox())!;
  const second = (await rows(page).nth(1).boundingBox())!;
  expect(first.x).toBeGreaterThan(second.x);
  const add = (await rows(page).first().locator('.kn-add').boundingBox())!;
  const price = (await rows(page).first().locator('.kn-price').boundingBox())!;
  expect(add.x).toBeLessThan(price.x);
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

// Customize colours reach the shape: paper, ink and the accent square are the palette's, not the artwork's own.
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('kincol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'kinetic', { templateId: 'the-dancing-letters', colors: CUSTOM });
});
test('Customize colours reach the shape: the black band, the lit chip, the add square', async ({ page }) => {
  await openMenu(page, customSlug);
  const rgb = (node: ReturnType<typeof rows>, property: string) => node.evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
  const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
  expect(await rgb(kinetic(page).locator('.kn-marquee'), 'background-color')).toBe(toRgb(CUSTOM.text));
  expect(await rgb(kinetic(page).locator('.kn-marquee'), 'color')).toBe(toRgb(CUSTOM.bg));
  expect(await rgb(chips(page).locator('[aria-current="true"]'), 'background-color')).toBe(toRgb(CUSTOM.text));
  expect(await rgb(kinetic(page).locator('.kn-add').first(), 'background-color')).toBe(toRgb(CUSTOM.accent));
});
