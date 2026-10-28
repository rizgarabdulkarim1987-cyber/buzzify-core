import { expect, test, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  contrastOf,
  dishName,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectJumpsTo,
  expectMotionEnds,
  expectOpensProduct,
  expectPlatePainted,
  expectQuickAdd,
  expectStripStays,
  openMenu,
  shapeChecks,
} from './helpers/body-menu';

/**
 * The Erbil Citadel body (poster kurd-arab-cit; spec 2026-10-26-menu-styles-in-templates-design.md): the page opens on a
 * sunset scene (the citadel mound, its wall and houses, windows that light one after another, birds that cross once), then
 * a sticky strip of flat tabs, then each section a centred heading over a two-column grid of arched brick cards (the photo
 * in an arch, the name centred under it, the price and the add on a row). Colours come from the palette (Customize).
 */

const menus = bodyMenus();
const slug = menus.slug('cit');
const promoSlug = menus.slug('citoffer');
const arabSlug = menus.slug('citar');
const manySlug = menus.slug('citmany');
const offSlug = menus.slug('citoff');
const bareSlug = menus.slug('citbare');
const customSlug = menus.slug('citcustom');
const crowdSlug = menus.slug('citcrowd');
// A light menu with a pale yellow accent (Customize): the cards and tabs follow the palette, text stays readable.
const CUSTOM = { bg: '#F4F4F4', surface: '#FFFFFF', card: '#FFFFFF', raised: '#EEEEEE', text: '#1B1030', muted: '#4A4060', accent: '#FFE066', onAccent: '#111111' };

test.beforeAll(async () => {
  await menus.create(slug, 'cit', { templateId: 'the-erbil-citadel' });
  await menus.create(promoSlug, 'cit', { templateId: 'the-erbil-citadel', discount: ['croissant', 'eclair'] });
  await menus.create(arabSlug, 'cit', { templateId: 'the-erbil-citadel', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'cit', { templateId: 'the-erbil-citadel', extraSections: 20 });
  await menus.create(offSlug, 'cit', { templateId: 'the-erbil-citadel', ordering: 'none' });
  await menus.create(bareSlug, 'cit', { templateId: 'the-erbil-citadel', noPhotos: true });
  await menus.create(crowdSlug, 'cit', { templateId: 'the-erbil-citadel', crowd: 3 });
  await menus.create(customSlug, 'cit', { templateId: 'the-erbil-citadel', colors: CUSTOM, discount: ['croissant'] });
});
test.afterAll(() => menus.remove());

const citadel = (page: Page) => page.locator('[data-body="citadel"]');
const tabs = (page: Page) => citadel(page).locator('[data-tabs]');
const cards = (page: Page) => citadel(page).locator('[data-row]');
const cardOf = (page: Page, productSlug: string) => cards(page).filter({ hasText: dishName(productSlug) });
const tabOf = (page: Page, categorySlug: string) => tabs(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Takes the fixture's demo card (above the search) off the page: a real menu has none. */
const dropDemoCard = (page: Page) =>
  page.evaluate(() => {
    const search = document.querySelector('input[type="search"], [role="searchbox"]')!;
    const demo = [...document.querySelectorAll('h1,h2,p,div')].find((node) => node.children.length === 0 && node.textContent === 'Demonstration menu');
    let at: Element | null = demo ?? null;
    while (at && !at.parentElement?.contains(search)) at = at.parentElement;
    at?.remove();
  });
const hero = (page: Page) => citadel(page).locator('.ct-hero');

shapeChecks(menus, { kind: 'citadel', templateId: 'the-erbil-citadel', checks: ['contrast', 'focus', 'sale'], entry: (page, categorySlug) => tabOf(page, categorySlug) });

test('on a phone the scene, the tabs, the search and dishes with photos and prices show on the first screen', async ({ page }) => {
  await openMenu(page, slug);
  await expect(citadel(page)).toBeVisible();
  await expect(hero(page)).toBeInViewport();
  expect((await hero(page).boundingBox())!.height).toBeLessThanOrEqual(150);
  await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeInViewport();
  await expect(tabs(page)).toBeInViewport();
  // The fixture menu carries a demo card and dietary chips above the search (about 450px); with them two dishes show.
  await expectFirstScreen(page, cards(page), { min: 2 });
  await expectEverySectionReachable(tabs(page));
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('in a section of six dishes, with no demo card above the search (a real menu), four dishes with photos and prices fill the first screen', async ({ page }) => {
  await openMenu(page, crowdSlug);
  await dropDemoCard(page);
  await expectFirstScreen(page, cards(page), { min: 4 });
});

test('with the offers banner above the menu the first screen still shows two dishes with photos and prices', async ({ page }) => {
  await openMenu(page, promoSlug);
  await dropDemoCard(page);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 2 });
});

test('the scene is a dusk sky over the citadel: a mound and wall with lit windows, a flight of birds; it is decoration only', async ({ page }) => {
  await openMenu(page, slug);
  await expect(hero(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(hero(page).locator('svg .ct-mound')).toHaveCount(1);
  expect(await hero(page).locator('.ct-win').count()).toBeGreaterThanOrEqual(20);
  await expect(hero(page).locator('.ct-bird')).toHaveCount(3);
  const sky = await hero(page).evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(sky).toContain('linear-gradient');
  // The windows light one after another, then every one is lit and still.
  await expect.poll(() => hero(page).locator('.ct-win').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '1')), { timeout: 8000 }).toBe(true);
  await expectMotionEnds(citadel(page));
  const delays = await hero(page).locator('.ct-win').evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).animationDelay) * 1000));
  expect(new Set(delays).size).toBeGreaterThan(10);
});

test('with less motion the windows are simply lit and the birds are not drawn', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  const lit = await hero(page).locator('.ct-win').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '1' && getComputedStyle(node).animationName === 'none'));
  expect(lit).toBe(true);
  const birds = await hero(page).locator('.ct-bird').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity));
  expect(birds).toEqual(['0', '0', '0']);
});

test('the strip is a row of flat tabs with the section NAME, 44px to tap, the one in view dark', async ({ page }) => {
  await openMenu(page, slug);
  const chips = tabs(page).locator('button');
  await expect(chips).toHaveCount(BODY_CATEGORIES.length);
  const box = (await chips.first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  for (const category of BODY_CATEGORIES) {
    const tab = tabOf(page, category.slug);
    expect(await tab.evaluate((node) => (node as HTMLElement).innerText)).toContain(category.name.en!);
    expect(parseFloat(await tab.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
  }
  await expect(tabOf(page, 'viennoiserie')).toHaveAttribute('aria-current', 'true');
  const [dark, plain] = await Promise.all([tabOf(page, 'viennoiserie').evaluate((node) => getComputedStyle(node).backgroundColor), tabOf(page, 'bread').evaluate((node) => getComputedStyle(node).backgroundColor)]);
  expect(dark).not.toBe(plain);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(tabOf(page, 'bread')).toHaveAttribute('aria-current', 'true');
  await expect(tabs(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('a tab takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, tabOf(page, 'celebration'), 'celebration');
  await expect(tabOf(page, 'celebration')).toHaveAttribute('aria-current', 'true');
});

test('the strip stays at the top: scrolled to the end, the first section is still one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, tabs(page), tabOf(page, 'viennoiserie'), 'viennoiserie');
});

test('a section is a centred heading over two columns of arched cards: the photo in an arch, the name centred, the price and the add on a row', async ({ page }) => {
  await openMenu(page, slug);
  const terrace = page.locator('#cat-viennoiserie');
  const row = terrace.locator('[data-row]');
  await expect(row).toHaveCount(3);
  const heading = (await terrace.locator('h2').boundingBox())!;
  const [a, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(c.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(a.width).toBeGreaterThan(150);
  expect(Math.abs(heading.x + heading.width / 2 - 195)).toBeLessThan(20);
  const card = row.first();
  const [photo, name, price, add] = [(await card.locator('[data-photo]').boundingBox())!, (await card.locator('.ct-name').boundingBox())!, (await card.locator('.ct-price').boundingBox())!, (await card.locator('.ct-add').boundingBox())!];
  expect(photo.height).toBeGreaterThan(110);
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  expect(Math.abs(price.y + price.height / 2 - (add.y + add.height / 2))).toBeLessThan(14);
  expect(add.width).toBeGreaterThanOrEqual(40);
  const card0 = () => row.first().evaluate((node) => getComputedStyle(node, '::before').backgroundImage);
  const shape = await card.evaluate((node) => ({ card: getComputedStyle(node).borderTopLeftRadius, foot: getComputedStyle(node).borderBottomLeftRadius, photo: getComputedStyle(node.querySelector('[data-photo]')!).borderTopLeftRadius }));
  expect(parseFloat(shape.card)).toBeGreaterThan(30);
  expect(parseFloat(shape.foot)).toBeLessThanOrEqual(12);
  expect(parseFloat(shape.photo)).toBeGreaterThan(30);
  expect(await card0()).toContain('repeating-linear-gradient');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish adds from its card and opens from its name, and tapping the photo or the card opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cardOf(page, 'croissant').locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows its dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(citadel(page)).toBeVisible();
  await expect(citadel(page).locator('.ct-add')).toHaveCount(0);
  await dropDemoCard(page);
  await expectFirstScreen(page, cards(page), { min: 3 });
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
  expect(await citadel(page).locator('[data-photo] img').count()).toBe(0);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.ct-name')).toBeVisible();
    await expect(row.nth(index).locator('.ct-price')).toContainText('$');
  }
  await expectPlatePainted(row.first().locator('[data-photo]'), row.first());
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a menu of twenty-five sections keeps every tab one tap away on a scrolling strip that keeps the lit tab in view', async ({ page }) => {
  await openMenu(page, manySlug);
  const list = tabs(page).locator('ul');
  await expect(tabs(page).locator('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  expect(await list.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const last = tabs(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
});

test('a search that narrows and clears keeps the scene and the tabs, never moves the focus or the scroll', async ({ page }) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).count()).toBeLessThan(4);
  await expect(hero(page)).toHaveCount(1);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(cards(page).nth(3)).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('the windows do not light again when a search or a jump changes the sections', async ({ page }) => {
  await openMenu(page, slug);
  await expect.poll(() => hero(page).locator('.ct-win').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '1')), { timeout: 8000 }).toBe(true);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('sourdough');
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('');
  await tabOf(page, 'celebration').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const running = await hero(page).evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running' && animation instanceof CSSAnimation && (animation as CSSAnimation).animationName === 'ct-light').length);
  expect(running).toBe(0);
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const card = cards(page).first();
  await card.locator('.ct-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.ct-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await card.locator('.ct-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await card.boundingBox())!;
  for (const part of ['.ct-price', '.ct-name', '.ct-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  const price = (await card.locator('.ct-price').boundingBox())!;
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(await contrastOf(card.locator('.ct-price'))).toBeGreaterThanOrEqual(4.5);
});

test('on a wide screen the cards run four across in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('the dish count and numbers use the tenant numerals, though the heading shows only the name', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
  await expect(page.locator('#cat-viennoiserie h2 > span')).toBeVisible();
});

test('in Arabic the page is right to left, the tabs start at the right, the cards run from the right, and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => tabs(p));
  const first = (await tabs(page).locator('button').first().boundingBox())!;
  const last = (await tabs(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  const second = (await cards(page).nth(1).locator('[data-photo]').boundingBox())!;
  expect(photo.x).toBeGreaterThan(second.x);
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('the brick, the tabs and the lettering follow the palette picked in Customize; the scene stays the same', async ({ page }) => {
  await openMenu(page, slug);
  const read = () =>
    page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('[data-body="citadel"] .ct-card')!;
      const tab = document.querySelector<HTMLElement>('[data-body="citadel"] [aria-current="true"]')!;
      const hero = document.querySelector<HTMLElement>('[data-body="citadel"] .ct-hero')!;
      return { ground: getComputedStyle(card).backgroundColor, tab: getComputedStyle(tab).backgroundColor, sky: getComputedStyle(hero).backgroundImage };
    });
  const signature = await read();
  await openMenu(page, customSlug);
  const custom = await read();
  expect(custom.ground).not.toBe(signature.ground);
  expect(custom.tab).not.toBe(signature.tab);
  expect(custom.sky).toBe(signature.sky);
  expect(custom.tab).toBe('rgb(27, 16, 48)');
  expect(await contrastOf(tabOf(page, 'viennoiserie'))).toBeGreaterThanOrEqual(4.5);
  expect(await contrastOf(cardOf(page, 'croissant').locator('.ct-price'))).toBeGreaterThanOrEqual(4.5);
});

test('a dish on sale shows its -NN% chip in the menu numerals on its card, inside the card and clear of the add, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(citadel(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  const add = (await card.locator('.ct-add').boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(at.y + at.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect(at.y + at.height <= add.y + 1 || add.y + add.height <= at.y + 1 || at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(true);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  expect(await card.locator('.tpl-was .sr-only').count()).toBeGreaterThan(0);
});
