import { expect, test, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  dishName,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectMotionEnds,
  expectNoPageWiden,
  expectOpensProduct,
  expectQuickAdd,
  expectSaleShown,
  expectTextReadable,
  openMenu,
  paletteIdsOf,
} from './helpers/body-menu';

/**
 * The Book body (the "themed-book" mockup, spec 2026-10-26-menu-styles-in-templates-design.md): a dark-red leather cover
 * with a gold frame that a tap opens; the index; then pages of aged paper that turn in 3D about the spine, one at a time,
 * each a section with its dishes (a photo, the name over a leader to the price, the description, the add), four to a page;
 * round arrows at the bottom corners, a top bar with the contents, enlarge and close. No search box: the index is it.
 * The menu is a throwaway copy of the Maison Lumière demo on the Book template; its last category (Bread) has one dish.
 */

const menus = bodyMenus();
const slug = menus.slug('book');
const saleSlug = menus.slug('booksale');
const arabSlug = menus.slug('bookar');
const crowdSlug = menus.slug('bookcrowd');
const manySlug = menus.slug('bookmany');
const offSlug = menus.slug('bookoff');
const bareSlug = menus.slug('bookbare');
const dyedSlug = menus.slug('bookdyed');
const alternatives = paletteIdsOf('the-book').slice(1);
const paletteSlug = (id: string) => menus.slug(`book-${id}`);

test.beforeAll(async () => {
  await menus.create(slug, 'book', { templateId: 'the-book' });
  await menus.create(saleSlug, 'book', { templateId: 'the-book', discount: ['mille-feuille', 'croissant'] });
  await menus.create(arabSlug, 'book', { templateId: 'the-book', numeralSystem: 'ARAB', discount: ['mille-feuille'] });
  await menus.create(crowdSlug, 'book', { templateId: 'the-book', crowd: 6 });
  await menus.create(manySlug, 'book', { templateId: 'the-book', extraSections: 20 });
  await menus.create(offSlug, 'book', { templateId: 'the-book', ordering: 'none' });
  await menus.create(bareSlug, 'book', { templateId: 'the-book', noPhotos: true });
  await menus.create(dyedSlug, 'book', { templateId: 'the-book', colors: { card: '#2C4A63', accent: '#F2C14E', muted: '#E5E5E5' } });
  for (const id of alternatives) await menus.create(paletteSlug(id), 'book', { templateId: 'the-book', paletteId: id, discount: ['mille-feuille'] });
});
test.afterAll(() => menus.remove());

const book = (page: Page) => page.locator('[data-body="book"]');
const open = (page: Page) => book(page).locator('[data-pos="open"]');
const cover = (page: Page) => book(page).locator('[data-page="cover"]');
const index = (page: Page) => book(page).locator('[data-page="index"]');
const next = (page: Page) => book(page).getByRole('button', { name: 'Next', exact: true });
const back = (page: Page) => book(page).getByRole('button', { name: 'Back', exact: true });
const chapter = (page: Page, categorySlug: string) => index(page).getByRole('button', { name: new RegExp(BODY_CATEGORIES.find((category) => category.slug === categorySlug)!.name.en!) });
/** Opens the book onto the index (a tap on the cover). */
const openBook = async (page: Page) => {
  await cover(page).getByRole('button').click();
  await expect(index(page)).toBeVisible();
};

test('the first page is the leather cover with the restaurant name, the menu word and the hint; no search box', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expect(book(page)).toBeVisible();
  await expect(cover(page)).toBeVisible();
  await expect(cover(page).locator('.bk-cover-name')).not.toBeEmpty();
  await expect(cover(page)).toContainText('Menu');
  await expect(cover(page)).toContainText('Tap to open the book');
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('main#menu')).toHaveCount(1);
  await expect(book(page).getByRole('button', { name: 'Contents' })).toBeVisible();
  await expect(book(page).getByRole('button', { name: 'Enlarge the book' })).toBeVisible();
  await expect(book(page).getByRole('button', { name: 'Close the book' })).toBeVisible();
});

test('a tap on the cover opens the book onto the index: every section one tap away, with its page number', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await openBook(page);
  await expectEverySectionReachable(index(page));
  await expect(chapter(page, 'patisserie')).toContainText('dishes');
  // The cover leaves once its turn ends.
  await expect(cover(page)).toBeHidden();
  // The dish of the house is on the index with a photo and a price.
  await expect(index(page).locator('.bk-house').getByText(/\$\d/).first()).toBeVisible();
});

test('on a phone the cover fits, the page keeps its width, and the contents button opens the index', async ({ page }) => {
  await openMenu(page, slug);
  await expectNoPageWiden(page);
  await expect(cover(page)).toBeInViewport();
  await book(page).getByRole('button', { name: 'Contents' }).click();
  await expect(index(page)).toBeVisible();
  await expectNoPageWiden(page);
  await expectEverySectionReachable(index(page));
});

test('the index jumps to a section: its page opens with the heading focused, and Back returns', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  const spread = page.locator('#cat-patisserie');
  await expect(spread).toBeVisible();
  await expect(spread.locator('[data-heading]')).toBeFocused();
  await expect(spread.getByRole('button', { name: dishName('mille-feuille'), exact: true })).toBeVisible();
  await expect(index(page)).toBeHidden();
  // Back turns to the page before: Viennoiserie, the first section; and again to the index.
  await back(page).click();
  await expect(page.locator('#cat-viennoiserie')).toBeVisible();
  await back(page).click();
  await expect(index(page)).toBeVisible();
});

test('a page shows its dishes, each with a photo and a price; opens a dish and adds one', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  const spread = page.locator('#cat-patisserie');
  await expect(spread.locator('.bk-dish')).toHaveCount(3);
  for (const dish of await spread.locator('.bk-dish').all()) {
    await expect(dish.locator('img, svg').first()).toBeVisible();
    await expect(dish.getByText(/\$\d/).first()).toBeVisible();
  }
  await expectOpensProduct(page, spread, 'mille-feuille');
  await expectQuickAdd(page, spread, 'mille-feuille');
});

test('the whole row of a dish is its tap target', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  const row = page.locator('#cat-patisserie .bk-dish').first();
  await expect(row).toBeVisible();
  // A tap on the photo, not on the name, opens the dish.
  const photo = (await row.locator('.bk-photo').boundingBox())!;
  const box = (await row.boundingBox())!;
  await row.click({ position: { x: photo.x - box.x + 8, y: photo.y - box.y + 8 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a section of many dishes carries on over the next pages, four to a page, and the first page shows four on a phone', async ({ page }) => {
  await openMenu(page, crowdSlug);
  // The fixture's demo card ('this is a demo menu') is demo data, not the menu: measured without it.
  await page.addStyleTag({ content: '.tpl-promo{display:none!important}' });
  await book(page).getByRole('button', { name: 'Contents' }).click();
  await chapter(page, 'viennoiserie').click();
  const first = page.locator('#cat-viennoiserie');
  await expect(first).toBeVisible();
  await expect(first.locator('.bk-dish')).toHaveCount(4);
  await expectFirstScreen(page, first.locator('.bk-dish'), { min: 4 });
  await next(page).click();
  await expect(open(page).locator('.bk-dish')).toHaveCount(5);
  await expect(open(page).locator('.bk-dish').first()).toBeVisible();
  // The carried-on page keeps the section's name, and is not the section's address.
  await expect(open(page).locator('.bk-title-more')).toContainText(/Viennoiserie/);
});

test('the round arrows turn the page and stop at the ends; swiping and the arrow keys turn it too', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expect(book(page)).toHaveAttribute('data-at', '0');
  await expect(back(page)).toHaveAttribute('aria-disabled', 'true');
  await next(page).click();
  await expect(book(page)).toHaveAttribute('data-at', '1');
  await expect(index(page)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(book(page)).toHaveAttribute('data-at', '2');
  await page.keyboard.press('ArrowLeft');
  await expect(book(page)).toHaveAttribute('data-at', '1');
  await back(page).click();
  await expect(book(page)).toHaveAttribute('data-at', '0');
  // To the last page: it is the end, the next arrow is off.
  await next(page).click();
  await chapter(page, 'bread').click();
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true');
  await next(page).click({ force: true });
  await expect(page.locator('#cat-bread')).toBeVisible();
});

test('Escape shuts the book to its cover, and leaves a dish sheet to close itself', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  const spread = page.locator('#cat-patisserie');
  await expect(spread).toBeVisible();
  await spread.getByRole('button', { name: dishName('mille-feuille'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  // The sheet took the key: the book stayed on its page.
  await expect(spread).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cover(page)).toBeVisible();
  await expect(book(page)).toHaveAttribute('data-at', '0');
  // The close button does the same.
  await next(page).click();
  await book(page).getByRole('button', { name: 'Close the book' }).click();
  await expect(book(page)).toHaveAttribute('data-at', '0');
});

test('the page turns in 3D about the spine, in under 0.6 s, with transform and opacity only', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  const style = await cover(page).evaluate((node) => {
    const css = getComputedStyle(node);
    return { origin: css.transformOrigin, props: css.transitionProperty, duration: css.transitionDuration, perspective: getComputedStyle(node.parentElement!).perspective, backface: css.backfaceVisibility };
  });
  expect(style.perspective).not.toBe('none');
  expect(style.backface).toBe('hidden');
  expect(style.origin.startsWith('0px'), 'the spine is on the left in English').toBe(true);
  const props = style.props.split(',').map((value) => value.trim());
  expect(props.every((prop) => ['transform', 'opacity', 'visibility'].includes(prop)), props.join(',')).toBe(true);
  expect(Math.max(...style.duration.split(',').map((value) => parseFloat(value)))).toBeLessThanOrEqual(0.6);
  // While it turns the cover is rotated in 3D; once it ends it is hidden.
  const seen = await page.evaluate(async () => {
    const node = document.querySelector<HTMLElement>('[data-page="cover"]')!;
    document.querySelector<HTMLButtonElement>('[data-page="cover"] button')!.click();
    const transforms = new Set<string>();
    const until = performance.now() + 800;
    while (performance.now() < until) {
      transforms.add(getComputedStyle(node).transform);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { transforms: [...transforms], visibility: getComputedStyle(node).visibility };
  });
  expect(seen.transforms.some((value) => value.startsWith('matrix3d')), 'a 3D rotation was drawn mid-turn').toBe(true);
  expect(seen.visibility).toBe('hidden');
});

test('reduced motion: the page changes at once, nothing turns or blinks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/${slug}/en?stage=off`);
  await expect(cover(page)).toHaveCSS('transition-duration', /^(0|1e-06)s(, (0|1e-06)s)*$/);
  await expect(cover(page).locator('.bk-tap')).toHaveCSS('animation-name', 'none');
  await cover(page).getByRole('button').click();
  await expect(index(page)).toBeVisible({ timeout: 100 });
  await expect(cover(page)).toBeHidden({ timeout: 100 });
});

test('the cover hint blinks only a few times: no endless motion', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expectMotionEnds(book(page));
});

test('turning pages never refires effects or moves the page: the cover hint does not restart and the scroll stays', async ({ page }) => {
  await openMenu(page, slug);
  await next(page).click();
  await expect(book(page)).toHaveAttribute('data-at', '1');
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(book(page)).toHaveAttribute('data-at', '1');
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.scrollY), 'turning pages does not scroll the page').toBe(before);
  // The cover is rendered again, not replayed by the turn: its hint is on its own clock (3 runs, ends).
  await expectMotionEnds(book(page), 6000);
});

test('an address with #cat-<slug> opens that section', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off#cat-bread`);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await expect(page.locator('#cat-bread').getByRole('button', { name: dishName('sourdough'), exact: true })).toBeVisible();
});

test('a deep link to a dish opens the detail sheet on the book', async ({ page }) => {
  await page.goto(`/${slug}/en/p/mille-feuille?stage=off`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: dishName('mille-feuille') })).toBeVisible();
  await expect(book(page)).toBeAttached();
});

test('only the open page and its neighbours are in the document; the rest load no photos', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expect(book(page).locator('[data-index]')).toHaveCount(2);
  await openBook(page);
  await chapter(page, 'bread').click();
  await expect.poll(() => book(page).locator('[data-index]').count()).toBeLessThanOrEqual(3);
  expect(await book(page).locator('[data-pos="open"]').count()).toBe(1);
  await expect(book(page).locator('[data-pos="next"], [data-pos="past"]').first()).toHaveAttribute('inert', '');
});

test('a section with one dish has its own page', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'bread').click();
  await expect(page.locator('#cat-bread .bk-dish')).toHaveCount(1);
});

test('a sale shows the struck regular price and a -20% chip on the dish', async ({ page }) => {
  await page.goto(`/${saleSlug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  const dish = page.locator('#cat-patisserie .bk-dish').filter({ hasText: dishName('mille-feuille') });
  await expect(dish).toBeVisible();
  await expectSaleShown(dish, { clear: [dish.getByRole('button', { name: /^Add / })] });
  await expect(dish.locator('s.tpl-was')).toBeVisible();
});

test('numbers use the tenant numerals: page numbers and the -20% chip', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await openBook(page);
  await expect(chapter(page, 'patisserie').locator('.bk-count > [aria-hidden]')).toHaveText('٣');
  await chapter(page, 'patisserie').click();
  await expect(page.locator('#cat-patisserie .bk-folio')).toHaveText('٣');
  await expect(page.locator('#cat-patisserie .tpl-off').first()).toContainText('٢٠');
});

test('ordering off: the pages carry no add buttons', async ({ page }) => {
  await page.goto(`/${offSlug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  await expect(page.locator('#cat-patisserie .bk-dish').first()).toBeVisible();
  await expect(page.locator('#cat-patisserie').getByRole('button', { name: /^Add / })).toHaveCount(0);
});

test('dishes with no photo still show a plate, a name and a price', async ({ page }) => {
  await page.goto(`/${bareSlug}/en?stage=off`);
  await openBook(page);
  await chapter(page, 'patisserie').click();
  const dish = page.locator('#cat-patisserie .bk-dish').first();
  await expect(dish.locator('.bk-photo')).toBeVisible();
  await expect(dish.getByText(/\$\d/).first()).toBeVisible();
});

test('many sections: every one is on the index, and the index scrolls inside its page', async ({ page }) => {
  await openMenu(page, manySlug);
  await book(page).getByRole('button', { name: 'Contents' }).click();
  await expect(index(page).locator('[data-chapter]')).toHaveCount(BODY_CATEGORIES.length + 20);
  await expectNoPageWiden(page);
  const last = index(page).getByRole('button', { name: /Section 25/ });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(page.locator('#cat-more-20')).toBeVisible();
});

test('text reads on the paper and on the cover', async ({ page }) => {
  await page.goto(`/${saleSlug}/en?stage=off`);
  await expectTextReadable(cover(page), 'cover');
  await openBook(page);
  await expectTextReadable(index(page), 'index');
  await chapter(page, 'patisserie').click();
  await expectTextReadable(page.locator('#cat-patisserie'), 'dish page');
});

test('the colours come from Customize: the cover leather is the card colour and the gold the accent', async ({ page }) => {
  await page.goto(`/${dyedSlug}/en?stage=off`);
  await expect(cover(page)).toHaveCSS('background-color', 'rgb(44, 74, 99)');
  await expect(cover(page).locator('.bk-cover-name')).toHaveCSS('color', 'rgb(242, 193, 78)');
});

test('the default look is the mockup: dark-red leather, gold, aged paper, red prices', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expect(cover(page)).toHaveCSS('background-color', 'rgb(90, 30, 20)');
  await expect(cover(page).locator('.bk-cover-name')).toHaveCSS('color', 'rgb(231, 200, 115)');
  await openBook(page);
  await expect(index(page)).toHaveCSS('background-color', 'rgb(247, 239, 220)');
  await expect(index(page).locator('.bk-title')).toHaveCSS('color', 'rgb(107, 29, 18)');
});

for (const id of alternatives) {
  test(`the ${id} palette keeps the book readable`, async ({ page }) => {
    await page.goto(`/${paletteSlug(id)}/en?stage=off`);
    await expectTextReadable(cover(page), `${id} cover`);
    await openBook(page);
    await expectTextReadable(index(page), `${id} index`);
    await chapter(page, 'patisserie').click();
    await expectTextReadable(page.locator('#cat-patisserie'), `${id} page`);
  });
}

test('in Arabic the book is right to left: the spine is on the right and the pages turn from right to left', async ({ page }) => {
  await expectArabicRtl(page, slug, cover);
  await expectNoPageWiden(page);
  const origin = await cover(page).evaluate((node) => ({ x: parseFloat(getComputedStyle(node).transformOrigin), width: node.getBoundingClientRect().width }));
  expect(Math.round(origin.x), 'the spine is the right edge').toBe(Math.round(origin.width));
  // The arrow keys mirror: Left is forward.
  await page.keyboard.press('ArrowLeft');
  await expect(book(page)).toHaveAttribute('data-at', '1');
  await page.keyboard.press('ArrowRight');
  await expect(book(page)).toHaveAttribute('data-at', '0');
  await page.goto(`/${slug}/ar?stage=off`);
  await book(page).getByRole('button', { name: 'الفهرس' }).click();
  await expectEverySectionReachable(index(page), 'ar');
});

test('the enlarge button makes the book taller and is a toggle', async ({ page }) => {
  await openMenu(page, slug);
  const height = () => page.locator('.bk-book').evaluate((node) => node.getBoundingClientRect().height);
  const before = await height();
  const toggle = book(page).getByRole('button', { name: 'Enlarge the book' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await height()).toBeGreaterThan(before);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
