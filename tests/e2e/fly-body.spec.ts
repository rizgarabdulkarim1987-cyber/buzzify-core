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
 * The Fly to Cart body (spec 2026-10-26-menu-styles-in-templates-design.md): an ordering-first dense menu, every section
 * a labelled shelf of compact square dish cards three across on a phone, each with a big round + on its photo; adding
 * flies a copy of the photo to the cart bar (a transform-only arc) and the bar pulses once. Ordering off: plain cards.
 */

const menus = bodyMenus();
const slug = menus.slug('fly');
const arabSlug = menus.slug('flyar');
const manySlug = menus.slug('flymany');
const offSlug = menus.slug('flyoff');
const bareSlug = menus.slug('flybare');
const alternatives = paletteIdsOf('the-fly-to-cart').slice(1);
const paletteSlug = (id: string) => menus.slug(`fly-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'fly', { templateId: 'the-fly-to-cart' });
  await menus.create(arabSlug, 'fly', { templateId: 'the-fly-to-cart', numeralSystem: 'ARAB', discount: ['croissant'] });
  await menus.create(manySlug, 'fly', { templateId: 'the-fly-to-cart', extraSections: 20 });
  await menus.create(offSlug, 'fly', { templateId: 'the-fly-to-cart', ordering: 'none' });
  await menus.create(bareSlug, 'fly', { templateId: 'the-fly-to-cart', noPhotos: true });
  // The eclair 20% off on the alternatives: the sale chip read on every palette.
  for (const id of alternatives) await menus.create(paletteSlug(id), 'fly', { templateId: 'the-fly-to-cart', paletteId: id, discount: ['eclair'] });
});
test.afterAll(() => menus.remove());

const fly = (page: Page) => page.locator('[data-body="fly"]');
const tabs = (page: Page) => fly(page).locator('[data-tabs]');
const cards = (page: Page) => fly(page).locator('[data-row]');
const entry = (page: Page, categorySlug: string) => tabs(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!) });
const addOf = (page: Page, productSlug: string) => page.getByRole('button', { name: `Add ${dishName(productSlug)} to your order`, exact: true });

interface Seen {
  first: { x: number; y: number; width: number; height: number } | null;
  last: { x: number; y: number; width: number; height: number } | null;
  attached: number;
  removed: number;
  properties: string[];
  duration: number;
  hasPicture: boolean;
}

/** Records every flying photo the page draws (its first and last box, the properties it animates, its life), and each pulse the cart bar gets. */
async function watchFlights(page: Page) {
  await page.addInitScript(() => {
    const seen: Seen[] = [];
    const w = window as unknown as { __flights: Seen[]; __pulses: number };
    const entries = new WeakMap<Node, Seen>();
    w.__flights = seen;
    w.__pulses = 0;
    const sample = (node: HTMLElement, entry: Seen) => {
      if (!node.isConnected) return;
      const box = node.getBoundingClientRect();
      const mine = { x: box.x, y: box.y, width: box.width, height: box.height };
      entry.first ??= mine;
      entry.last = mine;
      const animation = node.getAnimations()[0];
      if (animation) {
        entry.duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
        const names = new Set<string>();
        for (const frame of (animation.effect as KeyframeEffect).getKeyframes()) for (const key of Object.keys(frame)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) names.add(key);
        entry.properties = [...names].sort();
      }
      requestAnimationFrame(() => sample(node, entry));
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const target = record.target as HTMLElement;
          if (target.matches('[data-testid="cart-bar"].fly-pulse')) w.__pulses += 1;
          continue;
        }
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement) || !node.hasAttribute('data-fly-clone')) return;
          const entry: Seen = { first: null, last: null, attached: performance.now(), removed: 0, properties: [], duration: 0, hasPicture: !!node.querySelector('img, svg') };
          seen.push(entry);
          entries.set(node, entry);
          sample(node, entry);
        });
        record.removedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.hasAttribute('data-fly-clone')) entries.get(node)!.removed = performance.now();
        });
      }
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}
const flights = (page: Page) => page.evaluate(() => (window as unknown as { __flights: Seen[] }).__flights);
const pulses = (page: Page) => page.evaluate(() => (window as unknown as { __pulses: number }).__pulses);

test('on a phone the first screen shows at least six dish cards with photos and prices, and every section is one tap away', async ({ page }) => {
  await openMenu(page, slug);
  await expect(fly(page)).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 6 });
  await expectEverySectionReachable(tabs(page));
});

test('the cards sit three across on a phone, all the same size, a square photo with the name and price under it and a big round add button on it', async ({ page }) => {
  await openMenu(page, slug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const [a, b, c] = [(await row.nth(0).boundingBox())!, (await row.nth(1).boundingBox())!, (await row.nth(2).boundingBox())!];
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(a.x).toBeLessThan(b.x);
  expect(b.x).toBeLessThan(c.x);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  expect(photo.width).toBeGreaterThanOrEqual(a.width - 14);
  const name = (await row.first().locator('.fl-name').boundingBox())!;
  const price = (await row.first().locator('.fl-price').boundingBox())!;
  expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);
  expect(price.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
  await expect(row.first().locator('.fl-price')).toContainText('$');
  // The add button is big and round, on the photo's end corner.
  const add = (await addOf(page, 'croissant').boundingBox())!;
  expect(add.width).toBeGreaterThanOrEqual(40);
  expect(Math.abs(add.width - add.height)).toBeLessThanOrEqual(1);
  expect(add.x).toBeGreaterThanOrEqual(photo.x);
  expect(add.x + add.width).toBeLessThanOrEqual(photo.x + photo.width + 1);
  expect(add.y + add.height).toBeLessThanOrEqual(photo.y + photo.height + 1);
  expect(add.x + add.width / 2).toBeGreaterThan(photo.x + photo.width / 2);
});

test('every section is a labelled shelf with its dish count, all on the page at once', async ({ page }) => {
  await openMenu(page, slug);
  const sections = fly(page).locator('section[data-shelf]');
  expect(await sections.count()).toBe(BODY_CATEGORIES.length);
  await expect(sections.first().locator('[data-count]')).toHaveText('3');
  await expect(sections.first().getByRole('heading', { name: /Viennoiserie/ })).toBeVisible();
  // The ledge line after the label runs to the end of the shelf.
  const line = await sections.first().locator('h2').evaluate((node) => {
    const after = getComputedStyle(node, '::after');
    return { content: after.content, height: parseFloat(after.height) };
  });
  expect(line.content).toBe('""');
  expect(line.height).toBeGreaterThanOrEqual(3);
});

test('a tab takes you to its section and focuses the heading', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, entry(page, 'celebration'), 'celebration');
});

test('the tab strip lights the section in view', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(tabs(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(entry(page, 'bread')).toHaveAttribute('aria-current', 'true');
});

test('the tab strip stays at the top: scrolled to the end, the first section is still one tap away, clear of the cart bar', async ({ page }) => {
  await openMenu(page, slug);
  await expectStripStays(page, tabs(page), entry(page, 'viennoiserie'), 'viennoiserie');
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toBeVisible();
  const strip = (await tabs(page).boundingBox())!;
  const bar = (await page.getByTestId('cart-bar').boundingBox())!;
  expect(strip.y + strip.height).toBeLessThan(bar.y);
});

test('a menu with twenty-five sections keeps every section one tap away on a scrolling strip', async ({ page }) => {
  await openMenu(page, manySlug);
  await expect(tabs(page).getByRole('button')).toHaveCount(BODY_CATEGORIES.length + 20);
  await expectFirstScreen(page, cards(page), { min: 6 });
  const last = tabs(page).getByRole('button', { name: 'Section 25' });
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(page.locator('#cat-more-20 [data-heading]')).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('tapping + adds the dish and a copy of its photo flies in an arc, with transform only, to the cart bar, which pulses once; the copy is gone afterwards', async ({ page }) => {
  await watchFlights(page);
  await openMenu(page, slug);
  const card = cards(page).first();
  const frame = (await card.locator('[data-photo]').boundingBox())!;
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(async () => (await flights(page)).length, { message: 'a photo flew' }).toBe(1);
  await expect.poll(async () => (await flights(page))[0]!.removed, { message: 'the copy is removed when it has landed' }).toBeGreaterThan(0);
  const [flight] = await flights(page);
  // It started over the card's photo (the first sample is within a frame of the start) and landed on the cart bar.
  const bar = (await page.getByTestId('cart-bar').boundingBox())!;
  const middle = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(Math.abs(middle(flight!.first!).x - (frame.x + frame.width / 2))).toBeLessThanOrEqual(frame.width);
  expect(Math.abs(middle(flight!.last!).x - (bar.x + bar.width / 2))).toBeLessThanOrEqual(bar.width / 2);
  expect(Math.abs(middle(flight!.last!).y - (bar.y + bar.height / 2))).toBeLessThanOrEqual(bar.height);
  expect(flight!.properties).toEqual(['opacity', 'transform']);
  expect(flight!.duration).toBeGreaterThanOrEqual(350);
  expect(flight!.duration).toBeLessThanOrEqual(550);
  expect(flight!.removed - flight!.attached).toBeLessThan(1500);
  expect(flight!.hasPicture).toBe(true);
  await expect(page.locator('[data-fly-clone]')).toHaveCount(0);
  await expect.poll(() => pulses(page), { message: 'the bar pulsed once' }).toBe(1);
  await expect(page.getByTestId('cart-bar')).not.toHaveClass(/fly-pulse/);
});

test('the flight is a fixed copy over the page: it never moves anything and takes no taps', async ({ page }) => {
  await openMenu(page, slug);
  await page.evaluate(() => {
    const w = window as unknown as { __look: string[] };
    w.__look = [];
    new MutationObserver((records) => {
      for (const record of records)
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.hasAttribute('data-fly-clone')) {
            const style = getComputedStyle(node);
            w.__look.push(`${style.position} ${style.pointerEvents} ${node.getAttribute('aria-hidden')}`);
          }
        });
    }).observe(document.body, { childList: true });
  });
  const before = (await cards(page).nth(1).boundingBox())!;
  await addOf(page, 'croissant').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __look: string[] }).__look.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __look: string[] }).__look[0])).toBe('fixed none true');
  expect((await cards(page).nth(1).boundingBox())!.y).toBe(before.y);
});

test('reduced motion: the dish is added, no photo flies and the bar does not pulse', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watchFlights(page);
  await openMenu(page, slug);
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  await page.waitForTimeout(800);
  expect(await flights(page)).toHaveLength(0);
  expect(await pulses(page)).toBe(0);
});

test('adding the same dish again, quickly, flies once per tap and leaves no copy behind', async ({ page }) => {
  await watchFlights(page);
  await openMenu(page, slug);
  const add = addOf(page, 'croissant');
  await add.click();
  await add.click();
  await add.click();
  await expect(page.getByTestId('cart-bar')).toContainText('3');
  await expect.poll(async () => (await flights(page)).filter((flight) => flight.removed > 0).length).toBe(3);
  await expect(page.locator('[data-fly-clone]')).toHaveCount(0);
});

test('a dish adds from its card and opens from its name, and tapping the photo opens it too, without adding', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cards(page).first().locator('[data-photo]').boundingBox())!;
  // The photo's top start corner, away from the add button.
  await page.mouse.click(photo.x + 12, photo.y + 12);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open cards, no + button, no cart, and the layout still shows many dishes', async ({ page }) => {
  await openMenu(page, offSlug);
  await expect(fly(page)).toBeVisible();
  await expect(fly(page).locator('.fl-add')).toHaveCount(0);
  await expectFirstScreen(page, cards(page), { min: 6 });
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(page.getByRole('dialog').getByRole('heading', { name: dishName('croissant') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates and a working add with a flight', async ({ page }) => {
  await watchFlights(page);
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  expect(await fly(page).locator('[data-photo] img, [data-photo] svg:not(.fl-add svg)').count()).toBe(0);
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  expect(photo.width).toBeGreaterThan(80);
  expect(Math.abs(photo.width - photo.height)).toBeLessThanOrEqual(1);
  // The plate is painted on the media itself (the photo's top layer, an empty span), so it shows: rings, not a flat fill.
  const media = row.first().locator('[data-photo] > :first-child');
  expect(await media.evaluate((node) => node.childElementCount)).toBe(0);
  expect(await media.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('radial-gradient');
  const shot = await sharp(await media.screenshot()).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set<string>();
  for (let at = 0; at < shot.data.length; at += shot.info.channels * 7) colours.add(`${shot.data[at]},${shot.data[at + 1]},${shot.data[at + 2]}`);
  expect(colours.size, 'the plate draws rings').toBeGreaterThan(3);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.fl-name')).toBeVisible();
    await expect(row.nth(index).locator('.fl-price')).toContainText('$');
  }
  const first = (await row.first().boundingBox())!;
  expect(first.y + first.height).toBeLessThanOrEqual(844);
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  await expect.poll(async () => (await flights(page)).length).toBe(1);
  await expect.poll(async () => (await flights(page))[0]!.removed).toBeGreaterThan(0);
  // A plain disc flies: never a copy of the + icon that sits on the photo.
  expect((await flights(page))[0]!.hasPicture).toBe(false);
  await expect.poll(() => pulses(page)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('with no cart bar to fly to, the dish is added, nothing flies and nothing is left behind', async ({ page }) => {
  await watchFlights(page);
  // The bar loses its hook as it mounts (as if it were missing), so the flight has no target.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const bar = document.querySelector('[data-testid="cart-bar"]');
      if (!bar) return;
      bar.removeAttribute('data-testid');
      bar.setAttribute('data-hookless-bar', '');
    }).observe(document, { childList: true, subtree: true });
  });
  await openMenu(page, slug);
  await addOf(page, 'croissant').click();
  await expect(page.locator('[data-hookless-bar]')).toContainText('1');
  await page.waitForTimeout(1200);
  expect(await flights(page)).toHaveLength(0);
  await expect(page.locator('[data-fly-clone]')).toHaveCount(0);
  expect(await pulses(page)).toBe(0);
});

test('a long dish name and a long price stay inside the card without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  const cell = cards(page).nth(1);
  await cell.locator('.fl-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await cell.locator('.fl-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const lines = await cell.locator('.fl-name').evaluate((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await cell.boundingBox())!;
  const price = (await cell.locator('.fl-price').boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(price.x + price.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(price.y + price.height).toBeLessThanOrEqual(box.y + box.height + 1);
  expect((await cell.locator('[data-photo]').boundingBox())!.height).toBeGreaterThan(80);
});

test('on a wide screen the shelf is four or more columns in a centred column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/${slug}/en?stage=off`);
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  const c = (await row.nth(2).boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - c.y)).toBeLessThanOrEqual(1);
  expect(a.width).toBeLessThan(260);
  expect(a.width).toBeGreaterThan(150);
});

test('numbers and counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(fly(page).locator('section[data-shelf]').first().locator('[data-count]')).toHaveText('٣');
});

test('in Arabic the page is right to left, the shelf mirrors and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => tabs(p));
  const row = page.locator('#cat-viennoiserie [data-row]');
  const a = (await row.nth(0).boundingBox())!;
  const b = (await row.nth(1).boundingBox())!;
  expect(a.x).toBeGreaterThan(b.x);
  // The add button sits on the photo's end corner, which is its left in Arabic.
  const photo = (await row.first().locator('[data-photo]').boundingBox())!;
  const add = (await row.first().locator('.fl-add').boundingBox())!;
  expect(add.x + add.width / 2).toBeLessThan(photo.x + photo.width / 2);
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
    await expect(tabs(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    await expectReadable(menu, {
      'unlit tab': tabs(page).locator('.fl-chip:not([aria-current="true"])').first(),
      'lit tab': tabs(page).locator('[aria-current="true"]'),
      'section name': first.locator('h2 > span'),
      'dish count': first.locator('h2 b'),
      'card name': first.locator('.fl-name').first(),
      'card price': first.locator('.fl-price').first(),
      'add button': first.locator('.fl-add').first(),
      ...(menu === 'signature' ? {} : { 'sale chip': fly(page).locator('.tpl-off').first() }),
    });
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole card, its add button and a strip entry', async ({ page }) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const cell = cards(page).first();
    const name = cell.locator('.fl-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, cell, { outset: -2, pseudo: '::after' });
    const add = cell.locator('.fl-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: -5 });
    const tab = entry(page, 'patisserie');
    await tab.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(tab).toBeFocused();
    await expectFocusRingShows(page, tab, { outset: -4 });
  }
});

test('a dish on sale shows a -NN% chip in the menu numerals on its photo, and keeps the regular price for screen readers', async ({ page }) => {
  await openMenu(page, arabSlug);
  const cell = cards(page).filter({ hasText: dishName('croissant') });
  const chip = cell.locator('.tpl-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(fly(page).locator('.tpl-off')).toHaveCount(1);
  const box = (await cell.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(cell.locator('.tpl-was .sr-only')).toHaveText(/[\d٠-٩]/);
});
