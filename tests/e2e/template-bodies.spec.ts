import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { Prisma } from '@/generated/prisma/client';
import type { DesignOverrides } from '@/lib/templates/types';
import { createPrisma } from '@/server/data/prisma';
import { seedMenu } from '../../prisma/seed/apply';
import { MAISON } from '../../prisma/seed/maison';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { deleteBillingRows, publishFixture } from '../helpers/db';

/**
 * The browse bodies of a template menu (spec 2026-10-26-menu-styles-in-templates-design.md): the same template and the
 * same data, drawn as a book. The menu is a throwaway copy of the Maison Lumière demo with `layout.body: 'book'` in its
 * overrides, in a restaurant of its own at a new address, so the seeded demos other suites read never change. Its
 * last category has one dish.
 */

const run = randomUUID().slice(0, 8);
const slug = `e2e-${run}-book`;
const magSlug = `e2e-${run}-mag`;
const boardSlug = `e2e-${run}-board`;
const boardArabSlug = `e2e-${run}-boardar`;
const bookArabSlug = `e2e-${run}-bookar`;
const boardIndexSlug = `e2e-${run}-boardidx`;
const prisma = createPrisma(databaseUrl(DEV_DB));
const made: { restaurantId: string; menuId: string; slug: string }[] = [];

const products = MAISON.products.filter((product) => product.slug !== 'baguette');
const categories = MAISON.categories;
const named = (productSlug: string) => MAISON.products.find((product) => product.slug === productSlug)!.name.en;

async function createMenu(menuSlug: string, label: string, layout: NonNullable<DesignOverrides['layout']>, numeralSystem: 'LATN' | 'ARAB' = 'LATN') {
  const restaurant = await prisma.restaurant.create({ data: { name: `${MAISON.profile.name} ${label} e2e-${run}`, type: MAISON.profile.type } });
  const seeded = await seedMenu(prisma, { ...MAISON, products, restaurant: { ...MAISON.restaurant, slug: menuSlug, domains: [], numeralSystem } }, restaurant.id);
  made.push({ restaurantId: restaurant.id, menuId: seeded.menuId, slug: menuSlug });
  await prisma.menuSlug.create({ data: { slug: menuSlug, menuId: seeded.menuId } });
  const design: DesignOverrides = { ...MAISON.brand.design, layout };
  await prisma.brandConfig.update({ where: { menuId: seeded.menuId }, data: { design: design as Prisma.InputJsonValue } });
  await publishFixture(prisma, seeded.menuId, `${label} body`);
}

test.beforeAll(async () => {
  await createMenu(slug, 'book', { body: 'book', hero: 'chapters' });
  await createMenu(magSlug, 'magazine', { body: 'magazine', hero: 'compact', nav: 'chips', card: 'row' });
  await createMenu(boardSlug, 'board', { body: 'board', hero: 'compact' });
  await createMenu(boardArabSlug, 'board', { body: 'board', hero: 'compact' }, 'ARAB');
  await createMenu(bookArabSlug, 'book', { body: 'book' }, 'ARAB');
  // A scroll template's big hero and side index left in the overrides: the Board sets both itself.
  await createMenu(boardIndexSlug, 'board', { body: 'board', hero: 'editorial', nav: 'index' });
});

test.afterAll(async () => {
  try {
    for (const { restaurantId, menuId, slug: menuSlug } of made) {
      await prisma.menuSlug.deleteMany({ where: { OR: [{ menuId }, { slug: menuSlug }] } });
      await prisma.menu.deleteMany({ where: { id: menuId } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ menuId }, { restaurantId }] } });
      await deleteBillingRows(prisma, [restaurantId]);
      await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

const book = (page: Page) => page.locator('[data-body="book"]');
const index = (page: Page) => page.locator('[data-page="index"]');

test('the index page lists every chapter with a count and a price', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expect(book(page)).toBeVisible();
  await expect(index(page)).toBeVisible();
  for (const category of categories) await expect(index(page).getByRole('button', { name: new RegExp(category.name.en) })).toBeVisible();
  await expect(index(page).getByText(/\$\d/).first()).toBeVisible();
  await expect(index(page).getByRole('button', { name: /Pâtisserie/ })).toContainText('dishes');
});

test('turns to a chapter, opens a dish, adds one, and returns to the index with the ribbon', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await index(page).getByRole('button', { name: /Pâtisserie/ }).click();
  const spread = page.locator('#cat-patisserie');
  await expect(spread).toBeVisible();
  await expect(index(page)).toBeHidden();
  await expect(spread.getByRole('button', { name: named('mille-feuille'), exact: true })).toBeVisible();

  await spread.getByRole('button', { name: named('mille-feuille'), exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: named('mille-feuille') })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await spread.getByRole('button', { name: `Add ${named('mille-feuille')} to your order` }).click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');

  await page.getByRole('button', { name: 'Back to contents' }).click();
  await expect(index(page)).toBeVisible();
  await expect(spread).toBeHidden();
});

test('a category with one dish has its own spread', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await index(page).getByRole('button', { name: /Bread/ }).click();
  const spread = page.locator('#cat-bread');
  await expect(spread.getByRole('button', { name: named('sourdough'), exact: true })).toBeVisible();
  await expect(spread.getByRole('listitem')).toHaveCount(1);
});

test('reduced motion turns the page at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/${slug}/en?stage=off`);
  await expect(page.locator('#cat-patisserie')).toHaveCSS('transition-duration', /^(0|1e-06)s$/);
  await index(page).getByRole('button', { name: /Pâtisserie/ }).click();
  await expect(page.locator('#cat-patisserie')).toBeVisible({ timeout: 100 });
});

test('an address with #cat-<slug> opens that chapter', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off#cat-patisserie`);
  await expect(page.locator('#cat-patisserie')).toBeVisible();
  await expect(index(page)).toBeHidden();
});

test('a chapter turned to after an address stays open when the menu is searched', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off#cat-bread`);
  await expect(page.locator('#cat-bread')).toBeVisible();
  await page.getByRole('button', { name: 'Back to contents' }).click();
  await index(page).getByRole('button', { name: /Pâtisserie/ }).click();
  await expect(page.locator('#cat-patisserie')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('mille');
  await expect(page.locator('#cat-patisserie')).toBeVisible();
  await expect(page.locator('#cat-bread')).toBeHidden();
});

test('a deep link to a dish opens the detail sheet on the book', async ({ page }) => {
  await page.goto(`/${slug}/en/p/mille-feuille?stage=off`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: named('mille-feuille') })).toBeVisible();
  await expect(book(page)).toBeAttached();
});

test('the index replaces the hero: a hero left in the overrides is not drawn', async ({ page }) => {
  // The fixture's overrides still say `hero: 'chapters'`, whose buttons read "Go to <category>".
  await page.goto(`/${slug}/en?stage=off`);
  await expect(index(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to Pâtisserie' })).toHaveCount(0);
});

test('a chapter of the index opens its page with focus on the heading', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await index(page).getByRole('button', { name: /Pâtisserie/ }).click();
  await expect(page.locator('#cat-patisserie')).toBeVisible();
  await expect(index(page)).toBeHidden();
  await expect(page.locator('#cat-patisserie [data-heading]')).toBeFocused();
});

test('on a phone the first screen shows the index with photos and prices', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${slug}/en?stage=off`);
  await expect(index(page)).toBeVisible();
  const first = index(page).locator('.bk-taste li').first();
  await expect(first.locator('img, svg').first()).toBeInViewport({ ratio: 1 });
  await expect(first.getByText(/\$\d/)).toBeInViewport({ ratio: 1 });
});

test('typing in the search box on a chapter keeps the focus in the search box', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await index(page).getByRole('button', { name: /Pâtisserie/ }).click();
  await expect(page.locator('#cat-patisserie [data-heading]')).toBeFocused();
  const search = page.getByRole('searchbox', { name: 'Search the menu' });
  await search.click();
  // "sourdough" hides the Pâtisserie chapter, deleting it brings the chapter back.
  await page.keyboard.type('sourdough', { delay: 30 });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('sourdough');
  for (let i = 0; i < 'sourdough'.length; i += 1) await page.keyboard.press('Backspace', { delay: 30 });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page.locator('#cat-patisserie')).toBeVisible();
});

test('closed pages take no room and the open page is the only one laid out', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await expect(index(page)).toBeVisible();
  for (const category of categories) expect(await page.locator(`#cat-${category.slug}`).boundingBox(), category.slug).toBeNull();
  await index(page).getByRole('button', { name: /Bread/ }).click();
  await expect(page.locator('#cat-bread')).toBeVisible();
  // After the turn (under 300 ms) the index and the other chapters leave the layout.
  await expect.poll(async () => page.locator('[data-page="index"]').boundingBox()).toBeNull();
  expect(await page.locator('#cat-patisserie').boundingBox()).toBeNull();
});

test('a search that finds nothing keeps the skip link target', async ({ page }) => {
  await page.goto(`/${slug}/en?stage=off`);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.getByText(/zzzzqq/)).toBeVisible();
  await expect(page.locator('main#menu')).toHaveCount(1);
});

test('counts and page numbers use the tenant numerals', async ({ page }) => {
  await page.goto(`/${bookArabSlug}/en?stage=off`);
  const chapter = index(page).getByRole('button', { name: /Pâtisserie/ });
  await expect(chapter.locator('.bk-count')).toHaveText('٣ dishes');
  await expect(chapter.locator('.bk-folio')).toHaveText('٢');
});

test('in Arabic the book is right to left and its index renders', async ({ page }) => {
  await page.goto(`/${slug}/ar?stage=off`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(index(page)).toBeVisible();
  await expect(index(page).getByRole('button', { name: new RegExp(categories[1]!.name.ar) })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

const magazine = (page: Page) => page.locator('[data-body="magazine"]');

test.describe('the Magazine body', () => {
  test('the first screen shows a lead photo with its name and price, and a strip of sections', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    await expect(magazine(page)).toBeVisible();
    await expect(magazine(page).getByRole('heading', { level: 2 }).first()).toBeVisible();
    const lead = magazine(page).locator('[data-lead]').first();
    await expect(lead).toBeVisible();
    // The fixture's dishes are drawings (art); a real menu's are library photos, which render as <img>.
    await expect(lead.locator('img, svg').first()).toBeVisible();
    await expect(lead.getByText(/\$\d/).first()).toBeVisible();
    await expect(magazine(page).getByText(/sections/).first()).toBeVisible();
  });

  test('the strip jumps to a section', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    await page.getByRole('button', { name: /Pâtisserie/ }).first().click();
    await expect(page.locator('#cat-patisserie')).toBeInViewport();
    await expect(page.locator('#cat-patisserie [data-heading]')).toBeFocused();
  });

  test('an address with #cat-<slug> reaches that section', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off#cat-bread`);
    await expect(page.locator('#cat-bread')).toBeInViewport();
  });

  test('the overrides choose the strip and the cards', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    await expect(page.locator('.tpl[data-nav="chips"][data-card="row"]')).toBeVisible();
    await expect(magazine(page).locator('[data-card="row"]').first()).toBeAttached();
  });

  test('a lead and a card open the detail sheet', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    const lead = magazine(page).locator('[data-lead]').first();
    await lead.getByRole('button').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await magazine(page).locator('#cat-patisserie').getByRole('button', { name: named('mille-feuille'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('on a phone the first screen shows the lead and the next dish with its price', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${magSlug}/en?stage=off`);
    const spread = magazine(page).locator('section').first();
    await expect(spread.locator('[data-lead]')).toBeInViewport();
    const card = spread.locator('[data-card] li').first();
    await expect(card.getByText(/\$\d/).first()).toBeInViewport({ ratio: 1 });
  });

  test('a long dish name keeps the caption on the photo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${magSlug}/en?stage=off`);
    const lead = magazine(page).locator('[data-lead]').first();
    await expect(lead).toBeVisible();
    await lead.locator('.mg-lead-name').evaluate((node) => {
      node.textContent = 'A very long dish name that keeps going and going so that it wraps onto three or four lines on a phone screen';
    });
    const photo = (await lead.locator('[data-zoom]').boundingBox())!;
    const caption = (await lead.locator('.mg-cap').boundingBox())!;
    expect(caption.y).toBeGreaterThanOrEqual(photo.y - 1);
    expect(caption.y + caption.height).toBeLessThanOrEqual(photo.y + photo.height + 1);
    expect(caption.x).toBeGreaterThanOrEqual(photo.x - 1);
    expect(caption.x + caption.width).toBeLessThanOrEqual(photo.x + photo.width + 1);
  });

  test('tapping the lead photo opens the detail sheet', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    // A real pointer tap on the photo itself (the name's stretched target sits over it).
    const photo = magazine(page).locator('[data-lead] [data-zoom]').first();
    await photo.scrollIntoViewIfNeeded();
    const box = (await photo.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('a section with one dish is a lead alone', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    const spread = page.locator('#cat-bread');
    await expect(spread.locator('[data-lead]')).toHaveCount(1);
    await expect(spread.getByRole('button', { name: named('sourdough'), exact: true })).toBeVisible();
    await expect(spread.locator('[data-card]')).toHaveCount(0);
  });

  test('in Arabic it is right to left without sideways scrolling', async ({ page }) => {
    await page.goto(`/${magSlug}/ar?stage=off`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(magazine(page).locator('[data-lead]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('the lead price is white on the caption scrim', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    await expect(magazine(page).locator('.mg-lead-price').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('the masthead name clears the sticky section strip', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${magSlug}/en?stage=off`);
    const strip = (await page.getByRole('navigation', { name: 'Categories' }).boundingBox())!;
    const name = (await magazine(page).locator('.mg-name').boundingBox())!;
    expect(name.y - (strip.y + strip.height)).toBeGreaterThanOrEqual(8);
  });

  test('reduced motion removes the lead photo transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${magSlug}/en?stage=off`);
    await expect(magazine(page).locator('[data-lead] [data-zoom]').first()).toHaveCSS('transition-duration', /^(0|1e-06)s$/);
  });
});

test.describe('the departures Board', () => {
  const board = (page: Page) => page.locator('[data-body="board"]');
  const rows = (page: Page) => board(page).locator('[data-row]');
  const gate = (page: Page, letter: string) => page.getByRole('button', { name: new RegExp(`^Gate ${letter}:`) });

  test('on a phone the first screen shows at least five dishes with prices', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${boardSlug}/en?stage=off`);
    await expect(board(page)).toBeVisible();
    const viewport = page.viewportSize()!;
    const boxes = await rows(page).evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, price: /\$\d/.test(node.textContent ?? '') };
      }),
    );
    const whole = boxes.filter((box) => box.top >= 0 && box.bottom <= viewport.height && box.price);
    expect(whole.length).toBeGreaterThanOrEqual(5);
  });

  test('gate tabs carry letters and gate C jumps to the third section', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    for (const letter of ['A', 'B', 'C', 'D', 'E']) await expect(gate(page, letter)).toBeVisible();
    await gate(page, 'C').click();
    await expect(page.locator('#cat-celebration')).toBeInViewport();
    await expect(page.locator('#cat-celebration [data-heading]')).toBeFocused();
    await expect(gate(page, 'C')).toHaveAttribute('aria-current', 'true');
  });

  test('the gate tabs stay at the top while the board scrolls', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    await gate(page, 'D').click();
    await expect(page.locator('#cat-boxes')).toBeInViewport();
    const tabs = (await page.getByRole('navigation', { name: 'Categories' }).boundingBox())!;
    expect(tabs.y).toBeLessThanOrEqual(1);
    expect(tabs.y + tabs.height).toBeGreaterThan(0);
  });

  test('each row has a photo, a name, a gate code and a price', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    const first = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(first.locator('img, svg').first()).toBeVisible();
    await expect(first.locator('[data-code]')).toHaveText('A1');
    await expect(first.getByText(/\$\d/).first()).toBeVisible();
    await expect(page.locator('#cat-patisserie [data-row]').nth(1).locator('[data-code]')).toHaveText('B2');
    await expect(first.getByRole('button', { name: named('croissant'), exact: true })).toBeVisible();
  });

  test('add updates the cart and does not open the sheet', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    await expect(page.getByTestId('cart-bar')).toBeHidden();
    await page.locator('#cat-patisserie').getByRole('button', { name: `Add ${named('mille-feuille')} to your order` }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the whole row opens the detail sheet', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    const row = page.locator('#cat-patisserie [data-row]').first();
    await row.scrollIntoViewIfNeeded();
    const photo = (await row.locator('[data-photo]').boundingBox())!;
    await page.mouse.click(photo.x + photo.width / 2, photo.y + photo.height / 2);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await row.getByRole('button', { name: named('mille-feuille'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('an address with #cat-<slug> reaches that section', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off#cat-bread`);
    await expect(page.locator('#cat-bread')).toBeInViewport();
  });

  test('gate codes use the tenant numerals', async ({ page }) => {
    await page.goto(`/${boardArabSlug}/en?stage=off`);
    await expect(page.locator('#cat-patisserie [data-row]').nth(1).locator('[data-code]')).toHaveText('B٢');
  });

  test('a long dish name wraps inside its row on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${boardSlug}/en?stage=off`);
    const row = page.locator('#cat-viennoiserie [data-row]').first();
    await expect(row).toBeVisible();
    await row.locator('.bd-name').evaluate((node) => {
      node.textContent = 'AVeryLongUnbrokenDishNameThatKeepsGoingAndGoingAndGoing and then a very long dish name that wraps onto many lines on a phone';
    });
    const box = (await row.boundingBox())!;
    for (const part of ['.bd-name', '[data-code]', '.bd-price']) {
      const inner = (await row.locator(part).first().boundingBox())!;
      expect(inner.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('rows flap in with a short stagger when motion is allowed', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    await expect(rows(page).first()).toHaveCSS('animation-name', 'bd-flap');
    const delays = await rows(page).evaluateAll((nodes) => nodes.slice(0, 6).map((node) => parseFloat(getComputedStyle(node).animationDelay) * 1000));
    for (let i = 1; i < delays.length; i += 1) expect(delays[i] - delays[i - 1]).toBeLessThanOrEqual(30.5);
  });

  test('reduced motion removes the flap', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/${boardSlug}/en?stage=off`);
    await expect(rows(page).first()).toBeVisible();
    await expect(rows(page).first()).toHaveCSS('animation-name', 'none');
    await expect(rows(page).first()).toHaveCSS('animation-duration', /^(0|1e-06)s$/);
  });

  test('a scroll hero and side index left in the overrides do not reach the board', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${boardIndexSlug}/en?stage=off`);
    await expect(board(page)).toBeVisible();
    await expect(page.locator('.tpl')).not.toHaveAttribute('data-nav', /.*/);
    await expect(page.locator('.tpl-hero-editorial')).toHaveCount(0);
    const tabs = (await page.getByRole('navigation', { name: 'Categories' }).boundingBox())!;
    expect(tabs.width).toBeGreaterThan(600);
  });

  test('in Arabic it is right to left without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${boardSlug}/ar?stage=off`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(rows(page).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
