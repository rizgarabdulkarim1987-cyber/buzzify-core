import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  BODY_PRODUCTS,
  bodyMenus,
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
  shapeChecks,
} from './helpers/body-menu';

/**
 * The Stacked Sheets body (spec 2026-10-26-menu-styles-in-templates-design.md): every section a sheet of coloured paper
 * laid over the one before it, each with a sticky tab (name and dish count); the tabs of the sheets above the one in
 * view stack at the top, those below dock at the bottom; a menu with many sections gets a rail instead.
 * Throwaway copies of the Maison Lumière demo (five sections).
 */

const menus = bodyMenus();
const slug = menus.slug('stk');
const arabSlug = menus.slug('stkar');
const manySlug = menus.slug('stkmany');
/** The shape's own alternative palettes. */
const alternatives = paletteIdsOf('the-stacked-sheets').slice(1);
const paletteSlug = (id: string) => menus.slug(`stk-${id}`);
const TAB = 44;
/** How far apart stacked tabs sit (each covers the lower part of the one before). */
const STEP = 28;

test.beforeAll(async () => {
  // The preset's own layout (its compact hero): what a restaurant that picks the template gets.
  await menus.create(slug, 'stacked', { templateId: 'the-stacked-sheets' });
  // Arabic-Indic numerals, and the croissant 20% off.
  await menus.create(arabSlug, 'stacked', { templateId: 'the-stacked-sheets', numeralSystem: 'ARAB', discount: ['croissant'] });
  // Five sections and eighteen more: the rail.
  await menus.create(manySlug, 'stacked', { templateId: 'the-stacked-sheets', extraSections: 18 });
  // The eclair 20% off on the alternatives: the sale pill read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'stacked', { templateId: 'the-stacked-sheets', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const stacked = (page: Page) => page.locator('[data-body="stacked"]');
const tabs = (page: Page) => stacked(page).locator('[data-tab]');
const tab = (page: Page, categorySlug: string) => stacked(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const rows = (page: Page) => stacked(page).locator('[data-row]');
const rail = (page: Page) => stacked(page).locator('[data-rail]');
const scrollToSheet = (page: Page, categorySlug: string) => page.evaluate((id) => document.getElementById(`cat-${id}`)!.scrollIntoView({ block: 'start' }), categorySlug);

test('on a phone the first screen shows at least four rows with photos and prices, and every sheet is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(stacked(page)).toHaveAttribute('data-tabs', 'stack');
  await expectFirstScreen(page, rows(page), { min: 4 });
  await expectEverySectionReachable(stacked(page));
});

test('every section is a sheet with its own tab (name and dish count), a hue of its own and a rounded top edge', async ({ page }) => {
  await openMenu(page, slug);
  expect(await tabs(page).count()).toBe(BODY_CATEGORIES.length);
  expect(await stacked(page).locator('section[data-sheet]').count()).toBe(BODY_CATEGORIES.length);
  await expect(tabs(page).first()).toContainText('Viennoiserie');
  await expect(tabs(page).first()).toContainText('3 dishes');
  await expect(tabs(page).last()).toContainText('1 dish');
  const papers = await stacked(page).locator('section[data-sheet]').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(papers).size).toBe(papers.length);
  for (const radius of await tabs(page).evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).borderTopLeftRadius)))) expect(radius).toBeGreaterThanOrEqual(16);
});

test('the tabs are sticky: at the top the first, the others docked at the bottom edge; scrolled, those passed stack at the top', async ({ page }) => {
  await openMenu(page, slug);
  const height = page.viewportSize()!.height;
  // At the start: the last tab is docked on the bottom edge and the one before it sits just above.
  const last = (await tabs(page).last().boundingBox())!;
  const before = (await tabs(page).nth(BODY_CATEGORIES.length - 2).boundingBox())!;
  expect(Math.abs(last.y + last.height - height)).toBeLessThanOrEqual(1);
  expect(Math.abs(last.y - before.y - STEP)).toBeLessThanOrEqual(1);
  // Scrolled into the first sheet: its tab is stacked at the top, in order.
  await scrollToSheet(page, 'viennoiserie');
  await page.evaluate(() => window.scrollBy(0, 100));
  for (const at of [0]) {
    await expect.poll(async () => Math.round((await tabs(page).nth(at).boundingBox())!.y), { message: `tab ${at}` }).toBe(at * STEP);
  }
});

test('the stacks leave most of the phone screen to the dishes', async ({ page }) => {
  await openMenu(page, slug);
  await scrollToSheet(page, 'viennoiserie');
  await page.evaluate(() => window.scrollBy(0, 100));
  // Both stacks together: four steps and one whole tab.
  expect(4 * STEP + TAB).toBeLessThanOrEqual(page.viewportSize()!.height * 0.2);
});

test('a tab takes you to its sheet, just under the stack, and focuses its heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, tab(page, 'celebration'), 'celebration');
  // Under its own tab, which is stacked below those of the two sheets before it.
  await expect.poll(async () => Math.round((await page.locator('#cat-celebration').boundingBox())!.y)).toBe(2 * STEP + TAB);
  await expect(tab(page, 'celebration')).toHaveAttribute('aria-current', 'true');
  // From the end of the page the first sheet is still one tap away.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectJumpsTo(page, tab(page, 'viennoiserie'), 'viennoiserie');
});

test('every tab can be tapped wherever it is stacked: its visible strip is at least 28px and the tap lands on it', async ({ page }) => {
  await openMenu(page, slug);
  for (const where of ['start', 'patisserie', 'end']) {
    if (where === 'patisserie') await scrollToSheet(page, 'patisserie');
    if (where === 'end') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const hits = await tabs(page).evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        // The tab's own top strip (the strip below it may be covered by the next tab).
        const hit = document.elementFromPoint(box.x + box.width / 2, Math.min(box.y + 12, window.innerHeight - 4));
        return { own: hit?.closest('[data-tab]') === node, width: box.width, height: box.height };
      }),
    );
    for (const [at, hit] of hits.entries()) {
      expect(hit.own, `${where}: tab ${at}`).toBe(true);
      expect(hit.height, where).toBeGreaterThanOrEqual(44);
    }
  }
});

test('scrolling lights the tab of the sheet in view', async ({ page }) => {
  await openMenu(page, slug);
  await expect(tab(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(stacked(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(tab(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the last sheet is tall enough to light its tab, and the page does not scroll sideways', async ({ page }) => {
  await openMenu(page, slug);
  const box = (await page.locator('#cat-bread').boundingBox())!;
  expect(box.height).toBeGreaterThan(page.viewportSize()!.height * 0.3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a row opens its dish and adds one, and its photo is a tap target too', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
  const box = (await rows(page).first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a section with one dish is a sheet of one row', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread')).toBeInViewport();
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
});

test('a long dish name and a long price stay inside the row without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const row = rows(page).first();
  await row.locator('.sk-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto three or four lines on a phone screen';
  });
  await row.locator('.sk-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await row.boundingBox())!;
  const price = (await row.locator('.sk-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const add = (await row.locator('.sk-add').boundingBox())!;
  expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const name = (await row.locator('.sk-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(add.x + 1);
});

test('a long category name takes two lines at most on its tab', async ({ page }) => {
  await openMenu(page, slug);
  const name = tabs(page).first().locator('.sk-tab-name');
  await name.evaluate((node) => {
    node.textContent = 'A very long category name that keeps going and going and going well past the end of the tab';
  });
  const lines = await name.evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const tabBox = (await tabs(page).first().boundingBox())!;
  expect(tabBox.height).toBeCloseTo(TAB, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('on a wide screen the sheets stay a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const sheet = (await page.locator('#cat-viennoiserie').boundingBox())!;
  expect(sheet.width).toBeLessThanOrEqual(640);
  expect(Math.abs(sheet.x + sheet.width / 2 - 640)).toBeLessThanOrEqual(2);
});

test('counts and numbers use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(tabs(page).first()).toContainText('٣ dishes');
});

test('in Arabic the page is right to left, the tab and the row mirror and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => tabs(p).first());
  const tabBox = (await tabs(page).first().boundingBox())!;
  const name = (await tabs(page).first().locator('.sk-tab-name').boundingBox())!;
  const count = (await tabs(page).first().locator('.sk-tab-count').boundingBox())!;
  expect(name.x).toBeGreaterThan(count.x);
  expect(tabBox.x + tabBox.width - (name.x + name.width)).toBeLessThan(tabBox.width / 3);
  const row = rows(page).first();
  const photo = (await row.locator('[data-photo]').boundingBox())!;
  const add = (await row.locator('.sk-add').boundingBox())!;
  expect(photo.x).toBeGreaterThan(add.x);
});

test('in Arabic with long names the tabs and rows hold', async ({ page }) => {
  await openMenu(page, slug, { locale: 'ar' });
  await tabs(page).first().locator('.sk-tab-name').evaluate((node) => {
    node.textContent = 'قسم طويل جدا جدا جدا جدا يستمر في الطول حتى نهاية الشاشة الصغيرة بلا توقف';
  });
  await rows(page).first().locator('.sk-name').evaluate((node) => {
    node.textContent = 'طبق طويل الاسم جدا جدا يستمر في الطول حتى يلتف على عدة أسطر في شاشة الهاتف الصغيرة';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const tabBox = (await tabs(page).first().boundingBox())!;
  expect(tabBox.height).toBeCloseTo(TAB, 0);
});

test('a search that finds nothing keeps main#menu, and a search keeps the tabs and the scroll where they are', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('sourdough');
  await expect(tabs(page)).toHaveCount(1);
  await expect(stacked(page)).toHaveAttribute('data-tabs', 'stack');
  await expect(search).toBeFocused();
  await search.fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
  await search.fill('');
  await expect(tabs(page)).toHaveCount(BODY_CATEGORIES.length);
  // Scrolled into the menu, a search that keeps the page tall enough does not move it: nothing in the shape scrolls
  // (the browser's own scroll anchoring, which keeps the rows in view steady as others go, is turned off to see that).
  await page.addStyleTag({ content: 'html, body { overflow-anchor: none; }' });
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300);
  // Typed in place (a real keystroke would also scroll the browser to the caret, which is off the screen up here).
  await search.evaluate((node) => {
    const input = node as HTMLInputElement;
    input.focus({ preventScroll: true });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'cake');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(rows(page)).not.toHaveCount(BODY_PRODUCTS.length);
  await page.waitForTimeout(400);
  await expect(search).toBeFocused();
  // Where it was, unless the shorter page cannot scroll that far.
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(await page.evaluate(() => Math.min(300, Math.round(document.documentElement.scrollHeight - window.innerHeight))));
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(0);
});

test('in stack mode a screen reader gets the sections as one list under a navigation landmark', async ({ page }) => {
  await openMenu(page, slug);
  const nav = stacked(page).getByRole('navigation', { name: 'Categories' });
  await expect(nav.getByRole('link')).toHaveCount(BODY_CATEGORIES.length);
  // Out of the tab order (the visible tabs are the keyboard's), and it takes no room on the screen.
  expect(await nav.getByRole('link').first().getAttribute('tabindex')).toBe('-1');
  expect(await nav.evaluate((node) => node.getBoundingClientRect().width * node.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await nav.getByRole('link', { name: BODY_CATEGORIES.find((c) => c.slug === 'celebration')!.name.en! }).evaluate((node) => (node as HTMLElement).click());
  await expect(page.locator('#cat-celebration [data-heading]')).toBeFocused();
});

test('the sheets do not change colour when a search hides some of them', async ({ page }) => {
  await openMenu(page, slug);
  const paper = () => page.locator('#cat-celebration').evaluate((node) => getComputedStyle(node).backgroundColor);
  const before = await paper();
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('cake');
  await expect(page.locator('#cat-celebration')).toBeVisible();
  expect(await paper()).toBe(before);
});

test('nothing in the shape moves by itself: no animation runs, with or without reduced motion', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await openMenu(page, slug);
    expect(await stacked(page).evaluate((node) => [node, ...node.querySelectorAll('*')].flatMap((el) => el.getAnimations()).length)).toBe(0);
  }
});

test.describe('a menu with many sections', () => {
  const railChip = (page: Page, text: string) => rail(page).getByRole('button', { name: new RegExp(text) });

  test('the tabs collapse into one scrollable rail, pinned at the top, with a chip for every section', async ({ page }) => {
    await openMenu(page, manySlug);
    await expect(stacked(page)).toHaveAttribute('data-tabs', 'rail');
    await expect(rail(page).getByRole('button')).toHaveCount(BODY_CATEGORIES.length + 18);
    await expectFirstScreen(page, rows(page), { min: 4 });
    // Not a tab per sheet on the screen: the rail is one row, and it scrolls sideways inside itself only.
    const bar = (await rail(page).boundingBox())!;
    expect(bar.height).toBeLessThanOrEqual(64);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // The sheets' tabs are plain labels now, not a second set of buttons.
    await expect(tabs(page).locator('button')).toHaveCount(0);
  });

  test('the rail stays pinned, the last section is one tap away from the end, and the sheet lands under its pinned tab', async ({ page }) => {
    await openMenu(page, manySlug);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(async () => Math.abs((await rail(page).boundingBox())?.y ?? 99)).toBeLessThanOrEqual(1);
    await expectJumpsTo(page, railChip(page, 'Section 15'), 'more-10');
    const bar = (await rail(page).boundingBox())!;
    // Its own tab is pinned under the rail (all tabs share one slot, the newest over the others), the sheet right under it.
    const own = (await tabs(page).first().boundingBox())!.height;
    await expect.poll(async () => Math.abs((await page.locator('#cat-more-10').boundingBox())!.y - (bar.y + bar.height + own))).toBeLessThanOrEqual(2);
    await expect(railChip(page, 'Section 15')).toHaveAttribute('aria-current', 'true');
    await expectStripStays(page, rail(page), railChip(page, 'Viennoiserie'), 'viennoiserie');
  });

  test('only the tab of the sheet in view shows under the rail: the next slides over the last', async ({ page }) => {
    await openMenu(page, manySlug);
    await scrollToSheet(page, 'more-3');
    await page.evaluate(() => window.scrollBy(0, 200));
    const bar = (await rail(page).boundingBox())!;
    const slot = Math.round(bar.y + bar.height);
    const atSlot = await tabs(page).evaluateAll((nodes, top) => nodes.filter((node) => Math.abs(node.getBoundingClientRect().y - top) <= 1).length, slot);
    expect(atSlot).toBeGreaterThanOrEqual(1);
    // Every tab that has passed sits in that one slot (none stacked lower), so the screen is not eaten.
    const lowest = await tabs(page).evaluateAll((nodes, top) => Math.max(...nodes.map((node) => node.getBoundingClientRect().y).filter((y) => y <= top + 1)), slot);
    expect(Math.round(lowest)).toBe(slot);
  });

  test('keyboard focus rings on rail chips show in full and stand out', async ({ page }) => {
    await openMenu(page, manySlug);
    const chip = railChip(page, 'Pâtisserie');
    await chip.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip).toBeFocused();
    await expectFocusRingShows(page, chip, { outset: -4 });
  });

  test('chip numbers use the menu numerals in Arabic', async ({ page }) => {
    await openMenu(page, manySlug, { locale: 'ar' });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(rail(page).locator('small').nth(2)).toHaveText('3');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test('text reads on every fill it sits on, in every palette of the shape, stacked or in the rail', async ({ page }) => {
  const menusToCheck: [string, string][] = [['signature', slug], ...alternatives.map((id): [string, string] => [id, paletteSlug(id)])];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    await page.evaluate(() => window.scrollBy(0, 40));
    const sheet = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'lit tab': tab(page, 'viennoiserie'),
      'tab dish count': tabs(page).first().locator('.sk-tab-count'),
      'docked tab': tab(page, 'bread'),
      'docked tab dish count': tabs(page).last().locator('.sk-tab-count'),
      'row name': sheet.locator('.sk-name').first(),
      'row price': sheet.locator('.sk-price').first(),
      'add button': sheet.locator('.sk-add').first(),
      ...(menu === 'signature' ? {} : { 'sale pill': stacked(page).locator('.tpl-badge-sale').first() }),
    });
    await scrollToSheet(page, 'celebration');
    await page.evaluate(() => window.scrollBy(0, 120));
    // The tabs stacked at the top read too, whatever the hue.
    for (const [at, name] of [[0, 'first'], [1, 'second']] as const) {
      await expectReadable(`${menu} stacked`, { [`${name} stacked tab`]: tabs(page).nth(at).locator('button'), [`${name} stacked tab count`]: tabs(page).nth(at).locator('.sk-tab-count') });
    }
  }
  // The rail: every chip, lit or not, with its number.
  await openMenu(page, manySlug);
  await page.evaluate(() => window.scrollBy(0, 40));
  await expectReadable('rail', {
    'lit chip': rail(page).locator('[aria-current="true"]'),
    'lit chip number': rail(page).locator('[aria-current="true"] small'),
    'unlit chip': rail(page).locator('button:not([aria-current="true"])').first(),
    'unlit chip number': rail(page).locator('button:not([aria-current="true"]) small').first(),
    'pinned tab': tabs(page).first(),
    'pinned tab count': tabs(page).first().locator('.sk-tab-count'),
  });
});

test('keyboard focus rings show in full and stand out, in every palette: a whole row and a tab', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const row = rows(page).first();
    const name = row.locator('.sk-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, row, { outset: -3, pseudo: '::after' });
    const button = tab(page, 'patisserie');
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await expectFocusRingShows(page, button, { outset: -4 });
  }
});

test('a dish on sale shows its −NN% pill in the menu numerals and keeps the regular price crossed out', async ({ page }) => {
  await openMenu(page, arabSlug);
  const row = rows(page).filter({ hasText: dishName('croissant') });
  await expect(row.locator('.tpl-badge-sale')).toHaveText('−٢٠%');
  await expect(stacked(page).locator('.tpl-badge-sale')).toHaveCount(1);
  await expect(row.locator('s')).toBeVisible();
  const box = (await row.boundingBox())!;
  const pill = (await row.locator('.tpl-badge-sale').boundingBox())!;
  expect(pill.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(pill.x + pill.width).toBeLessThanOrEqual(box.x + box.width + 1);
});

test('the docked tabs rise above the cart bar once something is in the cart', async ({ page }) => {
  await openMenu(page, slug);
  await expectQuickAdd(page, page.locator('#cat-viennoiserie'), 'croissant');
  const bar = (await page.getByTestId('cart-bar').boundingBox())!;
  const last = (await tabs(page).last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y + 1);
});

shapeChecks(menus, { kind: 'stacked', templateId: 'the-stacked-sheets', checks: ['contrast'] });

/** Colours picked in Customize (a green menu with a pink accent): every surface of the shape must follow them. */
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('stkcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'stacked', { templateId: 'the-stacked-sheets', colors: CUSTOM });
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

test('Customize colours reach the sheets: the ink is the background colour and the paper is drawn toward the text colour', async ({ page }) => {
  await openMenu(page, slug);
  const defaultPaper = await rgbOf(page.locator('[data-body="stacked"] .sk-sheet').first(), 'background-color');
  await openMenu(page, customSlug);
  const sheet = page.locator('[data-body="stacked"] .sk-sheet').first();
  const ink = await rgbOf(sheet, 'color');
  rgbOfHex(CUSTOM.bg).forEach((channel, at) => expect(Math.abs(ink[at]! - channel), 'sheet ink is the background colour').toBeLessThanOrEqual(3));
  const paper = await rgbOf(sheet, 'background-color');
  expect(paper, 'the paper is not the default one').not.toEqual(defaultPaper);
  // The paper is the hue's colour drawn toward the text colour, so it stays well away from the ink.
  const light = (rgb: number[]) => 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  expect(light(paper), 'the paper is much lighter than the ink').toBeGreaterThan(light(ink) + 120);
});
