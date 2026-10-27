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
  expectMotionEnds,
  expectOpensProduct,
  expectPlatePainted,
  expectQuickAdd,
  expectReadable,
  expectStripStays,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Jajim and Nowruz body (spec 2026-10-26-menu-styles-in-templates-design.md): Kurdish woven rugs on a bright ivory
 * page. Every section is a rug: a woven frame (a repeating geometric border in CSS gradients), its title woven into the
 * top border as a cartouche, and a field of lozenge medallions that interlock like a jajim's own pattern: a row of two
 * with their names and prices above their lozenges, then a row of three, half a medallion out, lifted by half a lozenge
 * so its lozenges nest between the ones above, with their words below (three and four on a wide screen). A sticky strip
 * of rug swatches jumps to a rug; the rug in view carries a tiny static flame.
 */

const menus = bodyMenus();
const slug = menus.slug('rug');
const promoSlug = menus.slug('rugoffer');
const arabSlug = menus.slug('rugar');
const manySlug = menus.slug('rugmany');
const offSlug = menus.slug('rugoff');
const bareSlug = menus.slug('rugbare');
const bareAt = (id: string) => menus.slug(`rugbare-${id}`);
const alternatives = paletteIdsOf('the-jajim-and-nowruz').slice(1);
const paletteSlug = (id: string) => menus.slug(`rug-${id}`);
const TEMPLATE = 'the-jajim-and-nowruz';

test.beforeAll(async () => {
  await menus.create(slug, 'rug', { templateId: TEMPLATE });
  await menus.create(promoSlug, 'rug', {
    templateId: TEMPLATE,
    discount: ['croissant', 'eclair'],
  });
  await menus.create(arabSlug, 'rug', {
    templateId: TEMPLATE,
    numeralSystem: 'ARAB',
    discount: ['croissant'],
  });
  await menus.create(manySlug, 'rug', {
    templateId: TEMPLATE,
    extraSections: 20,
  });
  await menus.create(offSlug, 'rug', {
    templateId: TEMPLATE,
    ordering: 'none',
  });
  await menus.create(bareSlug, 'rug', { templateId: TEMPLATE, noPhotos: true });
  for (const id of alternatives)
    await menus.create(bareAt(id), 'rug', {
      templateId: TEMPLATE,
      paletteId: id,
      noPhotos: true,
    });
  for (const id of alternatives)
    await menus.create(paletteSlug(id), 'rug', {
      templateId: TEMPLATE,
      paletteId: id,
      discount: ['croissant', 'eclair'],
    });
});
test.afterAll(() => menus.remove());

const body = (page: Page) => page.locator('[data-body="rugs"]');
const strip = (page: Page) => body(page).locator('[data-swatches]');
const cards = (page: Page) => body(page).locator('[data-row]');
const cardOf = (page: Page, productSlug: string) =>
  cards(page).filter({ hasText: dishName(productSlug) });
const swatchOf = (page: Page, categorySlug: string) =>
  strip(page).getByRole('button', {
    name: new RegExp(
      BODY_CATEGORIES.find((c) => c.slug === categorySlug)!.name.en!,
    ),
  });
const addOf = (page: Page, productSlug: string) =>
  page.getByRole('button', {
    name: `Add ${dishName(productSlug)} to your order`,
    exact: true,
  });
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** The strip's jump offset (`--nav-room`) in px: a jumped-to rug lands below the strip only if the strip is no taller. */
const navRoom = (page: Page) =>
  body(page).evaluate(
    (node) =>
      parseFloat(getComputedStyle(node).getPropertyValue('--nav-room')) *
      parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
/** The lozenge of every cell in a section, in order. */
const lozenges = (page: Page, sectionSlug: string) =>
  page
    .locator(`#cat-${sectionSlug} .rg-lozenge`)
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect),
    );
const centre = (box: DOMRect) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** A section holds three dishes at most in the demo menu: copies of its cells (markup only) make the grid's later rows. */
const fillGrid = async (page: Page, sectionSlug: string, total: number) => {
  // Copies made before React hydrates are thrown away by it: wait for the page to settle first.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page
    .locator(`#cat-${sectionSlug} .rg-grid`)
    .evaluate((grid, wanted) => {
      const cells = [...grid.children];
      while (grid.children.length < wanted)
        grid.appendChild(
          cells[grid.children.length % cells.length]!.cloneNode(true),
        );
    }, total);
};

test('on a phone the strip is no taller than its jump offset and the first screen shows at least four dishes with photos and prices', async ({
  page,
}) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(
    await navRoom(page),
  );
  await expectFirstScreen(page, cards(page), { min: 4 });
  await expectEverySectionReachable(strip(page));
});

test('with the offers banner above the menu (it and the hero take about 630px of the phone before any shape) the first screen still shows at least two dishes with photos and prices', async ({
  page,
}) => {
  await openMenu(page, promoSlug);
  await expect(page.getByText('A fifth off').first()).toBeVisible();
  await expectFirstScreen(page, cards(page), { min: 2 });
});

test('the strip is a row of rug swatches: each its own woven frame pattern around the section name, 44px to tap', async ({
  page,
}) => {
  await openMenu(page, slug);
  const swatches = strip(page).locator('button');
  await expect(swatches).toHaveCount(BODY_CATEGORIES.length);
  expect((await swatches.first().boundingBox())!.height).toBeGreaterThanOrEqual(
    44,
  );
  await expect(swatches.first()).toContainText(BODY_CATEGORIES[0]!.name.en!);
  const frames = await swatches.evaluateAll((nodes) =>
    nodes.slice(0, 4).map((node) => getComputedStyle(node).backgroundImage),
  );
  for (const frame of frames) expect(frame).toContain('gradient');
  expect(new Set(frames).size).toBe(4);
});

test('a swatch takes you to its rug and focuses the heading, and the swatch lights', async ({
  page,
}) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, swatchOf(page, 'celebration'), 'celebration');
  await expect(swatchOf(page, 'celebration')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
});

test('the strip stays at the top: scrolled to the end, the first rug is still one tap away', async ({
  page,
}) => {
  await openMenu(page, slug);
  await expectStripStays(
    page,
    strip(page),
    swatchOf(page, 'viennoiserie'),
    'viennoiserie',
  );
});

test('a section is a rug: a woven frame of repeating gradients, a title cartouche woven into its top border, a fringe line after it', async ({
  page,
}) => {
  await openMenu(page, slug);
  const rug = page.locator('#cat-viennoiserie');
  const frame = await rug
    .locator('.rg-rug')
    .evaluate((node) => ({
      image: getComputedStyle(node).backgroundImage,
      padding: parseFloat(getComputedStyle(node).paddingTop),
    }));
  expect(frame.image).toContain('linear-gradient');
  expect(frame.padding).toBeGreaterThanOrEqual(6);
  // Different sections wear different frames.
  const next = await page
    .locator('#cat-patisserie .rg-rug')
    .evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(next).not.toBe(frame.image);
  // The cartouche straddles the frame's top edge: half above it, half over the frame and the field.
  const box = (await rug.locator('.rg-rug').boundingBox())!;
  const title = (await rug.locator('.rg-front').boundingBox())!;
  expect(title.y).toBeLessThan(box.y);
  expect(title.y + title.height).toBeGreaterThan(box.y + 6);
  expect(
    Math.abs(title.x + title.width / 2 - (box.x + box.width / 2)),
  ).toBeLessThanOrEqual(2);
  const clip = await rug
    .locator('.rg-title')
    .evaluate((node) => getComputedStyle(node).clipPath);
  expect(clip).toContain('polygon');
  await expect(rug.locator('h2 small')).toHaveText('1');
  await expect(rug.locator('h2 [data-count]')).toHaveText('3');
  const fringe = await rug
    .locator('.rg-fringe')
    .evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(fringe).toContain('repeating-linear-gradient');
  // The first dish starts below the cartouche.
  const first = (await rug.locator('[data-row]').first().boundingBox())!;
  expect(first.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
});

test('only the rug in view carries the little Nowruz flame by its title, drawn in CSS and still', async ({
  page,
}) => {
  await openMenu(page, slug);
  const lit = page.locator('.rg-section[data-lit]');
  await expect(lit).toHaveCount(1);
  await expect(lit).toHaveAttribute('id', 'cat-viennoiserie');
  const flames = await page
    .locator('.rg-section')
    .evaluateAll((nodes) =>
      nodes.map((node) => [
        node.id,
        getComputedStyle(node.querySelector('.rg-title')!, '::before').content,
      ]),
    );
  for (const [id, content] of flames)
    expect(content === 'none' || content === 'normal', id).toBe(
      id !== 'cat-viennoiserie',
    );
  const flame = await lit
    .locator('.rg-title')
    .evaluate((node) => ({
      image: getComputedStyle(node, '::before').backgroundImage,
      animation: getComputedStyle(node, '::before').animationName,
    }));
  expect(flame.image).toContain('radial-gradient');
  expect(flame.animation).toBe('none');
  await swatchOf(page, 'bread').click();
  await expect(page.locator('.rg-section[data-lit]')).toHaveAttribute(
    'id',
    'cat-bread',
  );
});

test('dishes are lozenge medallions that interlock from the first row: two with their words above, then three half a medallion out, lifted so their lozenges nest between, with their words below', async ({
  page,
}) => {
  await openMenu(page, slug);
  await fillGrid(page, 'viennoiserie', 8);
  const cells = page.locator('#cat-viennoiserie [data-row]');
  const [a, b, c, d, e, f] = (await lozenges(page, 'viennoiserie')) as [
    DOMRect,
    DOMRect,
    DOMRect,
    DOMRect,
    DOMRect,
    DOMRect,
  ];
  // A row of two, level, then a row of three, level.
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(c.y - d.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(d.y - e.y)).toBeLessThanOrEqual(1);
  // The row of three is half a medallion out: each of its lozenges centred where two above meet (or at a rug's edge).
  expect(Math.abs(centre(d).x - (a.x + a.width))).toBeLessThanOrEqual(3);
  expect(Math.abs(centre(c).x - (centre(a).x - a.width / 2))).toBeLessThanOrEqual(3);
  expect(Math.abs(centre(e).x - (centre(b).x + b.width / 2))).toBeLessThanOrEqual(3);
  // Lifted: its lozenges start about where the ones above are widest, so the two rows nest instead of stacking.
  expect(d.y).toBeGreaterThan(a.y + a.height * 0.3);
  expect(d.y).toBeLessThan(a.y + a.height * 0.7);
  // The next band starts below the row of three, again a row of two.
  expect(f.y).toBeGreaterThan(d.y + d.height);
  expect(Math.abs(centre(f).x - centre(a).x)).toBeLessThanOrEqual(3);
  // The upper row's name and price are above its lozenge (name, price, lozenge); the lower row's below it.
  for (const [at, above] of [
    [0, true],
    [1, true],
    [2, false],
    [3, false],
    [4, false],
  ] as const) {
    const cell = cells.nth(at);
    const photo = (await cell.locator('.rg-lozenge').boundingBox())!;
    const name = (await cell.locator('.rg-name').boundingBox())!;
    const price = (await cell.locator('.rg-price').boundingBox())!;
    if (above) {
      expect(price.y + price.height, `cell ${at}`).toBeLessThanOrEqual(photo.y + 2);
      expect(name.y + name.height, `cell ${at}`).toBeLessThanOrEqual(price.y + 2);
    } else {
      expect(price.y, `cell ${at}`).toBeGreaterThanOrEqual(photo.y + photo.height - 2);
      expect(name.y, `cell ${at}`).toBeGreaterThanOrEqual(price.y + price.height - 2);
    }
  }
  const card = cells.first();
  expect((await card.locator('[data-photo]').boundingBox())!.width).toBeGreaterThanOrEqual(66);
  // The photo and its rim are diamond-clipped.
  const clips = await card.evaluate((node) => [
    getComputedStyle(node.querySelector('.rg-lozenge')!).clipPath,
    getComputedStyle(node.querySelector('[data-photo]')!).clipPath,
  ]);
  for (const clip of clips) expect(clip).toContain('polygon');
  const rim = await card
    .locator('.rg-lozenge')
    .evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(rim).toContain('repeating-linear-gradient');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a short lower row is centred under the row above and still nests, never pushed to one side: one alone under the meeting of the two above, two at the two edges of the rug', async ({
  page,
}) => {
  await openMenu(page, slug);
  // The usual section of three: the third lies under the point where the first two meet.
  const [a, b, c] = await lozenges(page, 'viennoiserie');
  expect(Math.abs(centre(c!).x - (a!.x + a!.width))).toBeLessThanOrEqual(3);
  expect(Math.abs(centre(c!).x - (centre(a!).x + centre(b!).x) / 2)).toBeLessThanOrEqual(3);
  // A section of four: the lower two nest at the rug's two edges, half a medallion out from the two above, symmetric.
  await fillGrid(page, 'patisserie', 4);
  const [p, q, r, t] = await lozenges(page, 'patisserie');
  expect(Math.abs(centre(r!).x - p!.x)).toBeLessThanOrEqual(3);
  expect(Math.abs(centre(t!).x - (q!.x + q!.width))).toBeLessThanOrEqual(3);
  expect(Math.abs((centre(r!).x + centre(t!).x) / 2 - (centre(p!).x + centre(q!).x) / 2)).toBeLessThanOrEqual(3);
});

test('on a wide screen a short lower band nests next to the centre: one beside the middle lozenge, two either side of it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMenu(page, slug, { phone: false });
  await fillGrid(page, 'viennoiserie', 4);
  const boxes = await lozenges(page, 'viennoiserie');
  expect(Math.abs(centre(boxes[3]!).x - (boxes[0]!.x + boxes[0]!.width))).toBeLessThanOrEqual(3);
  await fillGrid(page, 'patisserie', 5);
  const more = await lozenges(page, 'patisserie');
  expect(Math.abs((centre(more[3]!).x + centre(more[4]!).x) / 2 - centre(more[1]!).x)).toBeLessThanOrEqual(3);
});

test('a tap on a lozenge opens its own dish where the rows nest: the foot of an upper lozenge and the lower lozenge between them', async ({
  page,
}) => {
  await openMenu(page, slug);
  const [a, , c] = (await lozenges(page, 'viennoiserie')) as [DOMRect, DOMRect, DOMRect];
  const names = await page
    .locator('#cat-viennoiserie .rg-name')
    .allTextContents();
  // Low in the upper lozenge, on the side its lower neighbour reaches under: still the upper dish.
  const lowOnUpper = { x: centre(a).x - a.width * 0.15, y: centre(a).y + a.height * 0.25 };
  // The lower lozenge's top, between the two above it: the lower dish.
  const topOfLower = { x: centre(c).x + c.width * 0.05, y: c.y + c.height * 0.3 };
  for (const [point, name] of [
    [lowOnUpper, names[0]!],
    [topOfLower, names[2]!],
  ] as const) {
    await page.mouse.click(point.x, point.y);
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: name.trim() }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await expect(page.getByTestId('cart-bar')).toBeHidden();
});

test('the add button is at least 40px square, inside its cell, in both rows', async ({
  page,
}) => {
  await openMenu(page, slug);
  for (const at of [0, 2]) {
    const cell = page.locator('#cat-viennoiserie [data-row]').nth(at);
    const [add, box] = [
      (await cell.locator('.rg-add').boundingBox())!,
      (await cell.boundingBox())!,
    ];
    expect(add.width).toBeGreaterThanOrEqual(40);
    expect(add.height).toBeGreaterThanOrEqual(40);
    expect(add.x).toBeGreaterThanOrEqual(box.x - 2);
    expect(add.x + add.width).toBeLessThanOrEqual(box.x + box.width + 2);
  }
});

test('a dish adds from its medallion and opens from its name, and tapping the photo or the cell opens it too, without adding', async ({
  page,
}) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  const photo = (await cardOf(page, 'croissant')
    .locator('[data-photo]')
    .boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 3);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: dishName('croissant') }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  const cell = (await cardOf(page, 'croissant').boundingBox())!;
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height - 4);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: dishName('croissant') }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await expectQuickAdd(page, first, 'croissant');
});

test('ordering off: plain tap-to-open medallions, no + button, no cart, and the layout still shows many dishes', async ({
  page,
}) => {
  await openMenu(page, offSlug);
  await expect(body(page)).toBeVisible();
  await expect(body(page).locator('.rg-add')).toHaveCount(0);
  await expectFirstScreen(page, cards(page), { min: 4 });
  const photo = (await cards(page)
    .first()
    .locator('[data-photo]')
    .boundingBox())!;
  await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('heading', { name: dishName('croissant') }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cart-bar')).toHaveCount(0);
});

test('a menu whose dishes have no media still shows names, prices, plates and a working add', async ({
  page,
}) => {
  await openMenu(page, bareSlug);
  const row = page.locator('#cat-viennoiserie [data-row]');
  await expect(row).toHaveCount(3);
  expect(await body(page).locator('[data-photo] img').count()).toBe(0);
  for (const index of [0, 1, 2]) {
    await expect(row.nth(index).locator('.rg-name')).toBeVisible();
    await expect(row.nth(index).locator('.rg-price')).toContainText('$');
  }
  await addOf(page, 'croissant').click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a dish with no media shows a plate painted in its frame (rings, a ground of its own), in every palette', async ({
  page,
}) => {
  for (const menuSlug of [bareSlug, ...alternatives.map(bareAt)]) {
    await openMenu(page, menuSlug);
    const row = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(row).toBeVisible();
    await expectPlatePainted(row.locator('[data-photo]'), row);
  }
});

test('a menu of twenty-five sections keeps every swatch one tap away on a scrolling strip that keeps the lit swatch in view', async ({
  page,
}) => {
  await openMenu(page, manySlug);
  const list = strip(page).locator('ul');
  await expect(strip(page).locator('button')).toHaveCount(
    BODY_CATEGORIES.length + 20,
  );
  expect(
    await list.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const last = strip(page).getByRole('button', { name: 'Section 25' });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeInViewport();
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(last).toBeInViewport({ ratio: 1 });
  expect((await strip(page).boundingBox())!.height).toBeLessThanOrEqual(
    await navRoom(page),
  );
});

test('a search that narrows and clears keeps the strip, never moves the focus or the scroll', async ({
  page,
}) => {
  await openMenu(page, slug);
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.fill('croissant');
  await expect(cards(page).first()).toBeVisible();
  expect(await cards(page).count()).toBeLessThan(4);
  await expect(search).toBeFocused();
  await search.fill('');
  await expect(cards(page).nth(3)).toBeVisible();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test('a long dish name and a long price stay inside the medallion without sideways scrolling', async ({
  page,
}) => {
  await openMenu(page, slug);
  const card = cards(page).first();
  await card.locator('.rg-name').evaluate((node) => {
    node.textContent =
      'A very long dish name that keeps going and going so that it wraps onto many many lines';
  });
  await card.locator('.rg-price').evaluate((node) => {
    node.textContent = 'From 123,456,789 IQD per portion';
  });
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
  const lines = await card
    .locator('.rg-name')
    .evaluate((node) =>
      Math.round(
        node.getBoundingClientRect().height /
          parseFloat(getComputedStyle(node).lineHeight),
      ),
    );
  expect(lines).toBeLessThanOrEqual(2);
  const box = (await card.boundingBox())!;
  for (const part of ['.rg-price', '.rg-name', '.rg-add']) {
    const at = (await card.locator(part).boundingBox())!;
    expect(at.x, part).toBeGreaterThanOrEqual(box.x - 1);
    expect(at.x + at.width, part).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  // The price wraps inside the cell and never runs under the dish below or the rug's frame.
  const price = (await card.locator('.rg-price').boundingBox())!;
  const field = (await page
    .locator('#cat-viennoiserie .rg-field')
    .boundingBox())!;
  expect(price.x).toBeGreaterThanOrEqual(field.x);
  expect(price.x + price.width).toBeLessThanOrEqual(field.x + field.width);
  expect(await contrastOf(card.locator('.rg-price'))).toBeGreaterThanOrEqual(
    4.5,
  );
});

test('on a wide screen the bands are three and four, still interlocking, in a centred column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openMenu(page, slug, { phone: false });
  await fillGrid(page, 'viennoiserie', 8);
  const boxes = await lozenges(page, 'viennoiserie');
  for (const at of [1, 2]) expect(Math.abs(boxes[at]!.y - boxes[0]!.y)).toBeLessThanOrEqual(1);
  for (const at of [4, 5, 6]) expect(Math.abs(boxes[at]!.y - boxes[3]!.y)).toBeLessThanOrEqual(1);
  expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height * 0.3);
  expect(boxes[3]!.y).toBeLessThan(boxes[0]!.y + boxes[0]!.height * 0.7);
  expect(Math.abs(centre(boxes[4]!).x - (boxes[0]!.x + boxes[0]!.width))).toBeLessThanOrEqual(3);
  expect(boxes[7]!.y).toBeGreaterThan(boxes[3]!.y + boxes[3]!.height);
  expect(boxes[0]!.x).toBeGreaterThan(100);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('numbers and counts use the tenant numerals, on the rug titles too', async ({
  page,
}) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(page.locator('#cat-viennoiserie [data-count]')).toHaveText('٣');
  await expect(page.locator('#cat-viennoiserie h2 small')).toHaveText('١');
});

test('in Arabic the page is right to left, the strip starts at the right, the grid runs from the right, and nothing scrolls sideways', async ({
  page,
}) => {
  await expectArabicRtl(page, slug, (p) => strip(p));
  const first = (await strip(page).locator('button').first().boundingBox())!;
  const last = (await strip(page).locator('button').last().boundingBox())!;
  expect(first.x).toBeGreaterThan(last.x);
  const one = (await cards(page).first().boundingBox())!;
  const two = (await cards(page).nth(1).boundingBox())!;
  expect(one.x).toBeGreaterThan(two.x);
  // Every cell stays inside the rug's field.
  const field = (await page
    .locator('#cat-viennoiserie .rg-field')
    .boundingBox())!;
  for (const box of await page
    .locator('#cat-viennoiserie [data-row]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect),
    )) {
    expect(box.x).toBeGreaterThanOrEqual(field.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(field.x + field.width + 1);
  }
});

test('in Arabic a long dish name and a long section name stay inside their medallion and cartouche', async ({
  page,
}) => {
  await openMenu(page, slug, { locale: 'ar' });
  const card = cards(page).first();
  await card.locator('.rg-name').evaluate((node) => {
    node.textContent =
      'مشروب الشوكولاتة الساخنة بالحليب والقرفة والزنجبيل مع الكريمة المخفوقة والمكسرات';
  });
  const box = (await card.boundingBox())!;
  const name = (await card.locator('.rg-name').boundingBox())!;
  expect(name.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(name.x + name.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const title = page.locator('#cat-viennoiserie .rg-title span');
  await title.evaluate((node) => {
    node.textContent =
      'المعجنات الفرنسية الطازجة المخبوزة يوميا بالزبدة الأصلية والحشوات المتنوعة الفاخرة';
  });
  const front = (await page
    .locator('#cat-viennoiserie .rg-front')
    .boundingBox())!;
  const rug = (await page.locator('#cat-viennoiserie .rg-rug').boundingBox())!;
  expect(front.x).toBeGreaterThanOrEqual(rug.x - 1);
  expect(front.x + front.width).toBeLessThanOrEqual(rug.x + rug.width + 1);
  expect(front.height).toBeLessThanOrEqual(80);
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('text reads on every fill it sits on, in every palette of the shape', async ({
  page,
}) => {
  const menusToCheck: [string, string][] = [
    ['signature', slug],
    ...alternatives.map((id): [string, string] => [id, paletteSlug(id)]),
  ];
  for (const [menu, menuSlug] of menusToCheck) {
    await openMenu(page, menuSlug);
    await page.evaluate(() => window.scrollBy(0, 40));
    await expect(strip(page).locator('[aria-current="true"]')).toHaveCount(1);
    const first = page.locator('#cat-viennoiserie');
    const card = cardOf(page, 'croissant');
    await expectReadable(menu, {
      'lit swatch label': strip(page).locator(
        'button[aria-current="true"] .rg-swatch-label',
      ),
      'resting swatch label': strip(page)
        .locator('button:not([aria-current="true"]) .rg-swatch-label')
        .first(),
      'rug title': first.locator('h2 > span'),
      'rug count': first.locator('h2 b'),
      'rug number': first.locator('h2 small'),
      'medallion name': card.locator('.rg-name'),
      'medallion price': card.locator('.rg-price'),
      'medallion add button': card.locator('.rg-add'),
      ...(menu === 'signature'
        ? {}
        : {
            'sale chip': card.locator('.tpl-photo-off'),
            'second sale chip': cardOf(page, 'eclair').locator(
              '.tpl-photo-off',
            ),
          }),
    });
    // Each pattern's field (four rugs in turn) reads too.
    for (const id of ['viennoiserie', 'patisserie', 'bread', 'celebration']) {
      const name = page.locator(`#cat-${id} .rg-name`).first();
      await expect(name, `${menu}: ${id}`).toBeVisible();
      expect(
        await contrastOf(name),
        `${menu}: ${id} name`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await contrastOf(page.locator(`#cat-${id} .rg-price`).first()),
        `${menu}: ${id} price`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('keyboard focus rings show in full and stand out, in every palette: a whole medallion, its add button and a swatch', async ({
  page,
}) => {
  for (const menuSlug of [slug, ...alternatives.map(paletteSlug)]) {
    await openMenu(page, menuSlug);
    const card = cards(page).first();
    const name = card.locator('.rg-name');
    await name.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectFocusRingShows(page, card, { outset: -3, pseudo: '::after' });
    const add = card.locator('.rg-add');
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    await expectFocusRingShows(page, add, { outset: 3 });
    const swatch = swatchOf(page, 'patisserie');
    await swatch.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(swatch).toBeFocused();
    await expectFocusRingShows(page, swatch, { outset: 4 });
  }
});

test('a dish on sale shows its -NN% chip in the menu numerals on its medallion, inside the cell, and keeps the regular price for screen readers', async ({
  page,
}) => {
  await openMenu(page, arabSlug);
  const card = cards(page).first();
  const chip = card.locator('.tpl-photo-off');
  await expect(chip).toHaveText(/٢٠%/);
  await expect(body(page).locator('.tpl-photo-off')).toHaveCount(1);
  const box = (await card.boundingBox())!;
  const at = (await chip.boundingBox())!;
  expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
  await expect(card.locator('.rg-price .sr-only')).toContainText(/\d|[٠-٩]/);
  // The chip and the add button sit in the cell's two free corners, never over each other.
  const add = (await card.locator('.rg-add').boundingBox())!;
  expect(at.x + at.width <= add.x + 1 || add.x + add.width <= at.x + 1).toBe(
    true,
  );
  expect(await noSideScroll(page)).toBeLessThanOrEqual(0);
});

test('nothing moves on its own (the scene is static, so there is no pause control)', async ({
  page,
}) => {
  await openMenu(page, slug);
  await expect(body(page)).toBeVisible();
  await expectMotionEnds(body(page), 0);
});

test('a search keeps each rug its own number and pattern (by its place in the full menu)', async ({
  page,
}) => {
  await openMenu(page, slug);
  const frame = () =>
    page
      .locator('#cat-bread .rg-rug')
      .evaluate((node) => getComputedStyle(node).backgroundImage);
  const before = await frame();
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  await page
    .getByRole('searchbox', { name: 'Search the menu' })
    .fill('sourdough');
  await expect(page.locator('#cat-viennoiserie')).toHaveCount(0);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(page.locator('#cat-bread h2 small')).toHaveText('5');
  expect(await frame()).toBe(before);
});

// ---------------------------------------------------------------------------------------------------------------------
// Customize colours reach the shape (the colours picked in Customize replace the palette's, not the artwork's own).
// ---------------------------------------------------------------------------------------------------------------------
const CUSTOM = { bg: '#0B2A1A', surface: '#12361F', card: '#12361F', raised: '#1C4A2E', line: '#2D6A45', text: '#F2FFF6', muted: '#BFE3CB', accent: '#E86A92', onAccent: '#111111', button: '#E86A92', onButton: '#111111' };
const customSlug = menus.slug('rgcol');
test.beforeAll(async () => {
  await menus.create(customSlug, 'rg', { templateId: 'the-jajim-and-nowruz', colors: CUSTOM });
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
const mixHex = (a: string, b: string, amount: number) => {
  const from = rgbOfHex(a);
  const to = rgbOfHex(b);
  return '#' + from.map((channel, at) => Math.round(channel + (to[at]! - channel) * amount).toString(16).padStart(2, '0')).join('');
};
const expectNear = (actual: number[], hex: string, message: string, tolerance = 3) => {
  const want = rgbOfHex(hex);
  actual.forEach((channel, at) => expect(Math.abs(channel - want[at]!), `${message}: channel ${at} is ${channel}, want ~${want[at]}`).toBeLessThanOrEqual(tolerance));
};
const first = (page: Page, selector: string) => page.locator('[data-body="rugs"] ' + selector).first();

test('Customize colours reach the shape: ink, plate, the red rim and the field follow the palette', async ({ page }) => {
  await openMenu(page, customSlug);
  expectNear(await rgbOf(first(page, '.rg-title'), 'background-color'), CUSTOM.raised, 'cartouche plate');
  expectNear(await rgbOf(first(page, '.rg-title'), 'color'), CUSTOM.text, 'cartouche ink');
  expectNear(await rgbOf(first(page, '.rg-front'), 'background-color'), CUSTOM.accent, 'cartouche rim');
  expectNear(await rgbOf(first(page, '.rg-field'), 'background-color'), mixHex(CUSTOM.raised, CUSTOM.bg, 0.4), 'field');
  expectNear(await rgbOf(first(page, '.rg-name'), 'color'), CUSTOM.text, 'dish name');
});
