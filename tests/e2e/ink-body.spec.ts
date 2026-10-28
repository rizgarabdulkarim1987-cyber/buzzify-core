import { expect, test, type Locator, type Page } from '@playwright/test';
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
 * The Section Ink body (the motion-ink mockup): a dark menu, every section with an ink colour of its own: pills outlined in
 * it (the lit one filled), the section's name set large in it (rising into place once, when first seen), and cards on the
 * menu's card colour with a top edge in the ink, two across on a phone (a 4:3 photo, the name, the price in the ink and
 * a round add). Tapping a pill pours the section's colour over the screen from the finger, the page jumps under it.
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
const titles = (page: Page) => ink(page).locator('.ik-title');
const entry = (page: Page, categorySlug: string) => chips(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const flooded = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug}`).evaluate((node) => node.hasAttribute('data-in'));
/** How far a section's name still sits below its line (its translateY, px): 0 once it has risen into place. */
const lowered = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug} .ik-title span`).evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42);
/** The splash layer the tap on a pill pours over the screen, if one is out. */
const splash = (page: Page) => page.locator('[data-ink-splash]');

test('on a phone the first screen shows dishes with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(ink(page)).toBeVisible();
  // The Maison demo card, the offers and the filter chips above the menu take most of the first screen by themselves.
  await expectFirstScreen(page, cards(page), { min: 2 });
  await page.evaluate(() => {
    const content = document.querySelector('.tpl-content')!;
    const kids = [...content.children];
    const tools = kids.findIndex((kid) => kid.classList.contains('tpl-tools'));
    kids.slice(1, tools).forEach((kid) => ((kid as HTMLElement).style.display = 'none'));
    (content.querySelector('.tpl-tools > :nth-child(2)') as HTMLElement | null)?.style.setProperty('display', 'none');
  });
  // Maison's first section holds three dishes (two rows of two cards): the next heading is below the first screen.
  await expectFirstScreen(page, cards(page), { min: 3 });
  await expectEverySectionReachable(chips(page));
});

test('every section has an ink of its own: its name set large in it, the pill outlined in it, and the dish count', async ({ page }) => {
  await openMenu(page, slug);
  expect(await bands(page).count()).toBe(BODY_CATEGORIES.length);
  const inks = await titles(page).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  expect(new Set(inks).size).toBe(inks.length);
  const first = bands(page).first();
  await expect(first.locator('[data-count]')).toHaveText('3');
  const title = first.getByRole('heading', { name: /Viennoiserie/ });
  await expect(title).toBeVisible();
  expect(await title.locator('span').evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(32);
  // The first section's pill is outlined in the colour its name is set in.
  expect(await entry(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).borderTopColor)).toBe(inks[0]);
});

test('the dishes are cards two across on a phone, all the same size, on the menu card colour with a top edge in the ink: the photo, the name, then the price with a round add', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [a, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(a.width).toBeGreaterThan(150);
  const card = await row.first().evaluate((node) => {
    const own = getComputedStyle(node);
    return { background: own.backgroundColor, edge: own.borderTopColor, width: parseFloat(own.borderTopWidth) };
  });
  expect(card.background).toBe('rgb(32, 32, 35)');
  expect(card.width).toBeGreaterThanOrEqual(3);
  expect(card.edge).toBe(await titles(page).first().evaluate((node) => getComputedStyle(node).color));
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(Math.abs(photo.width * 0.75 - photo.height)).toBeLessThanOrEqual(1.5);
  const name = (await row.first().locator('.ik-name').boundingBox())!;
  const price = (await row.first().locator('.ik-price').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await expect(row.first().locator('.ik-price')).toContainText('$');
  // The price is in the section's ink, and the add is round, in the price's row at its end.
  expect(await row.first().locator('.ik-price').evaluate((node) => getComputedStyle(node).color)).toBe(card.edge);
  const add = (await addOf(page, 'croissant').boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(30);
  expect(Math.abs(add.width - add.height)).toBeLessThanOrEqual(1);
  expect(add.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(add.x + add.width).toBeLessThanOrEqual(a.x + a.width + 1);
  expect(add.x + add.width / 2).toBeGreaterThan(price.x + price.width / 2);
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
  await expectFirstScreen(page, cards(page), { min: 2 });
  const last = chips(page).getByRole('button', { name: 'Section 25' });
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(page.locator('#cat-more-20 [data-heading]')).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // Neighbouring sections never share an ink, even where the set of colours starts again.
  const colours = await titles(page).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  for (let at = 1; at < colours.length; at++) expect(colours[at], `band ${at + 1}`).not.toBe(colours[at - 1]);
});

test('a section name rises into place when it is first seen, and never again', async ({ page }) => {
  await openMenu(page, slug);
  // The first screen's names are there at once; a name further down waits below its line until its section comes in.
  await expect.poll(() => flooded(page, 'viennoiserie')).toBe(true);
  expect(await flooded(page, 'bread')).toBe(false);
  expect(await lowered(page, 'bread')).toBeGreaterThan(10);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await expect.poll(() => lowered(page, 'bread')).toBe(0);
  // Only transform moves, and it is the only transition.
  expect(await page.locator('#cat-bread .ik-title span').evaluate((node) => getComputedStyle(node).transitionProperty)).toBe('transform');
  // Back up and down again: the name stays in place, nothing replays (sampled every frame for 400ms).
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const seen = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    const name = document.querySelector('#cat-bread .ik-title span')!;
    const out: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 400) {
      out.push(new DOMMatrixReadOnly(getComputedStyle(name).transform).m42);
      await new Promise((done) => requestAnimationFrame(done));
    }
    return out;
  });
  expect(seen.length).toBeGreaterThan(3);
  for (const shift of seen) expect(shift).toBe(0);
});

test('with an observer that never reports, no name stays hidden: the first screen is seen, and a section is seen when scrolled to', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(ink(page)).toHaveAttribute('data-armed', '');
  await expect.poll(() => flooded(page, 'viennoiserie')).toBe(true);
  await page.locator('#cat-bread').scrollIntoViewIfNeeded();
  await expect.poll(() => flooded(page, 'bread'), { timeout: 2000 }).toBe(true);
  await expect.poll(() => lowered(page, 'bread')).toBe(0);
});

test('keyboard focus in a section that has not been seen shows its name, without any scroll', async ({ page }) => {
  await silenceObserver(page);
  await openMenu(page, slug);
  await expect(ink(page)).toHaveAttribute('data-armed', '');
  // Past the one late pass after arming, so only the focus can show it.
  await page.waitForTimeout(1500);
  expect(await flooded(page, 'bread')).toBe(false);
  await page.locator('#cat-bread .ik-name').first().evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
});

test('tapping a pill pours its colour over the screen from the pill, the page jumps while it is covered, and the colour fades away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(splash(page)).toHaveCount(0);
  const pill = entry(page, 'bread');
  const colour = await pill.evaluate((node) => getComputedStyle(node).borderTopColor);
  const at = (await pill.boundingBox())!;
  await pill.click();
  // The layer is out at once, in the section's ink, a circle that starts at the pill (clip-path alone moves it).
  await expect(splash(page)).toHaveCount(1);
  const start = await splash(page).evaluate((node) => ({ ground: getComputedStyle(node).backgroundColor, clip: (node as HTMLElement).style.clipPath, events: getComputedStyle(node).pointerEvents, hidden: node.getAttribute('aria-hidden') }));
  expect(start.ground).toBe(colour);
  expect(start.clip).toMatch(/circle\(0px at \d+px \d+px\)/);
  expect(start.events).toBe('none');
  expect(start.hidden).toBe('true');
  const y = Number(start.clip.match(/at \d+px (\d+)px/)![1]);
  expect(Math.abs(y - (at.y + at.height / 2))).toBeLessThan(30);
  // The page lands on the section (the heading takes focus) and the layer is gone within a second.
  await expect(page.locator('#cat-bread')).toBeInViewport();
  await expect(page.locator('#cat-bread [data-heading]')).toBeFocused();
  await expect(splash(page)).toHaveCount(0, { timeout: 2000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a second tap while the colour is out finishes the first at once and leaves no layer behind', async ({ page }) => {
  await openMenu(page, slug);
  await entry(page, 'bread').click();
  await expect(splash(page)).toHaveCount(1);
  await entry(page, 'celebration').click();
  await expect(page.locator('#cat-celebration')).toBeInViewport();
  await expect(splash(page)).toHaveCount(0, { timeout: 2500 });
});

test('a search that clears does not replay any name, and never moves the scroll or the focus', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => flooded(page, 'bread')).toBe(true);
  await expect.poll(() => lowered(page, 'bread')).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = page.getByRole('searchbox', { name: 'Search the menu' });
  await box.fill('lemon tart');
  await expect(bands(page)).toHaveCount(1);
  await box.fill('');
  await expect(bands(page)).toHaveCount(BODY_CATEGORIES.length);
  await expect(box).toBeFocused();
  // Every section that was seen is in place at once when it comes back.
  expect(await flooded(page, 'bread')).toBe(true);
  expect(await lowered(page, 'bread')).toBe(0);
});

test('reduced motion: every name is there at once, a tap on a pill pours no colour and the page still jumps', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(ink(page)).not.toHaveAttribute('data-armed', /.*/);
  expect(await lowered(page, 'bread')).toBe(0);
  await entry(page, 'bread').click();
  await expect(splash(page)).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeInViewport();
  await expect(page.locator('#cat-bread [data-heading]')).toBeFocused();
});

test('a dish adds from its card and opens from its name, and tapping the photo opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
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
  await expectFirstScreen(page, cards(page), { min: 2 });
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

test('in Arabic the page is right to left, the grid mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => chips(p));
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  const price = (await row.first().locator('.ik-price').boundingBox())!;
  const add = (await row.first().locator('.ik-add').boundingBox())!;
  expect(add.x + add.width / 2).toBeLessThan(price.x + price.width / 2);
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
    await expectFocusRingShows(page, add, { outset: -4 });
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

test('a search keeps each section its own ink (by its place in the full menu), and a dish card reads its name before its price', async ({ page }) => {
  await openMenu(page, slug);
  const colour = () => page.locator('#cat-bread .ik-title').evaluate((node) => getComputedStyle(node).color);
  const chipColour = () => entry(page, 'bread').evaluate((node) => getComputedStyle(node).borderTopColor);
  const [band, chip] = [await colour(), await chipColour()];
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('sourdough');
  await expect(page.locator('#cat-viennoiserie')).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeVisible();
  expect(await colour()).toBe(band);
  expect(await chipColour()).toBe(chip);
  // The name comes first in the markup (a screen reader reads it before the price), and the price shows under it.
  const cell = cards(page).first();
  expect(await cell.evaluate((node) => Boolean(node.querySelector('.ik-name')!.compareDocumentPosition(node.querySelector('.ik-price')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const name = (await cell.locator('.ik-name').boundingBox())!;
  const price = (await cell.locator('.ik-price').boundingBox())!;
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the artwork's own).
// ---------------------------------------------------------------------------------------------------------------------
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('inkcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'ink', { templateId: 'the-section-ink', colors: CUSTOM });
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
const expectNear = (actual: number[], hex: string, message: string, tolerance = 3) => {
  const want = rgbOfHex(hex);
  actual.forEach((channel, at) => expect(Math.abs(channel - want[at]!), `${message}: channel ${at} is ${channel}, want ~${want[at]}`).toBeLessThanOrEqual(tolerance));
};
const first = (page: Page, selector: string) => page.locator('[data-body="ink"] ' + selector).first();

test('Customize colours reach the shape: the card is the picked card colour, its name the picked text colour, the ink readable on it', async ({ page }) => {
  await openMenu(page, customSlug);
  expectNear(await rgbOf(first(page, '.ik-card'), 'background-color'), CUSTOM.raised, 'card');
  expectNear(await rgbOf(first(page, '.ik-name'), 'color'), CUSTOM.text, 'dish name on the card');
  await expect.poll(() => contrastOf(first(page, '.ik-price'))).toBeGreaterThanOrEqual(4.5);
  await expect.poll(() => contrastOf(first(page, '.ik-title span'))).toBeGreaterThanOrEqual(4.5);
});
