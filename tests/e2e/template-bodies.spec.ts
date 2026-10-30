import { expect, test, type Page } from '@playwright/test';
import {
  BODY_CATEGORIES,
  bodyMenus,
  dishName,
  expectArabicRtl,
  expectEverySectionReachable,
  expectFirstScreen,
  expectJumpsTo,
  expectNoPageWiden,
  expectOpensProduct,
  expectQuickAdd,
  expectStripStays,
  openMenu,
} from './helpers/body-menu';
import { BODY_KINDS, bodyOf, templateList } from '@/lib/templates';

/**
 * The browse bodies of a template menu (spec 2026-10-26-menu-styles-in-templates-design.md): the same template and the
 * same data, drawn as a magazine and a board (the Book has its own spec, book-body.spec.ts). Each menu is a throwaway copy of the Maison Lumière demo with its body in its
 * overrides, in a restaurant of its own at a new address, so the seeded demos other suites read never change. Its
 * last category has one dish.
 */

const menus = bodyMenus();
const magSlug = menus.slug('mag');
const boardSlug = menus.slug('board');
const boardArabSlug = menus.slug('boardar');
const boardIndexSlug = menus.slug('boardidx');

const named = dishName;

test.beforeAll(async () => {
  await menus.create(magSlug, 'magazine', { layout: { body: 'magazine', hero: 'compact', nav: 'chips', card: 'row' } });
  await menus.create(boardSlug, 'board', { layout: { body: 'board', hero: 'compact' } });
  await menus.create(boardArabSlug, 'board', { layout: { body: 'board', hero: 'compact' }, numeralSystem: 'ARAB' });
  // A scroll template's big hero and side index left in the overrides: the Board sets both itself.
  await menus.create(boardIndexSlug, 'board', { layout: { body: 'board', hero: 'editorial', nav: 'index' } });
});

test.afterAll(() => menus.remove());

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
    await expectEverySectionReachable(page.getByRole('navigation', { name: 'Categories' }));
    await expectJumpsTo(page, page.getByRole('button', { name: /Pâtisserie/ }).first(), 'patisserie');
  });

  test('an address with #cat-<slug> reaches that section', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off#cat-bread`);
    await expect(page.locator('#cat-bread')).toBeInViewport();
  });

  test('the overrides choose the strip and the cards', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    await expect(page.locator('.tpl[data-nav="chips"]')).toBeVisible();
    // The cards are the magazine's own photo tiles, whatever card kind was chosen.
    await expect(magazine(page).locator('.mg-tile').first()).toBeAttached();
    await expect(magazine(page).locator('[data-card]')).toHaveCount(0);
  });

  test('a lead and a card open the detail sheet', async ({ page }) => {
    await page.goto(`/${magSlug}/en?stage=off`);
    const lead = magazine(page).locator('[data-lead]').first();
    await lead.getByRole('button').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectOpensProduct(page, magazine(page).locator('#cat-patisserie'), 'mille-feuille');
  });

  test('on a phone the first screen shows the lead and the next dish as photo tiles with their prices, in a bento', async ({ page }) => {
    await openMenu(page, magSlug);
    const spread = magazine(page).locator('section').first();
    await expect(spread.locator('[data-lead]')).toBeInViewport();
    const tile = spread.locator('.mg-tile:not([data-lead])').first();
    await expect(tile.getByText(/\$\d/).first()).toBeInViewport({ ratio: 1 });
    const lead = (await spread.locator('[data-lead]').boundingBox())!;
    const next = (await tile.boundingBox())!;
    expect(lead.width, 'the lead is two columns wide').toBeGreaterThan(next.width * 1.8);
    expect(lead.height, 'and two rows tall').toBeGreaterThan(next.height * 1.8);
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
    await expect(spread.locator('.mg-tile')).toHaveCount(1);
  });

  test('in Arabic it is right to left without sideways scrolling', async ({ page }) => {
    await expectArabicRtl(page, magSlug, (p) => magazine(p).locator('[data-lead]').first(), { phone: false });
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
    await openMenu(page, boardSlug);
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
    await expectFirstScreen(page, rows(page), { min: 5 });
    await expectEverySectionReachable(page.getByRole('navigation', { name: 'Categories' }));
  });

  test('gate tabs carry letters and gate C jumps to the third section', async ({ page }) => {
    await page.goto(`/${boardSlug}/en?stage=off`);
    for (const letter of ['A', 'B', 'C', 'D', 'E']) await expect(gate(page, letter)).toBeVisible();
    await expectJumpsTo(page, gate(page, 'C'), 'celebration');
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

  test('scrolled to the end, the gate tabs are still at the top and gate A jumps', async ({ page }) => {
    await openMenu(page, boardSlug);
    await expectStripStays(page, page.getByRole('navigation', { name: 'Categories' }), gate(page, 'A'), BODY_CATEGORIES[0]!.slug);
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
    await expectQuickAdd(page, page.locator('#cat-patisserie'), 'mille-feuille');
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
    await expectOpensProduct(page, row, 'mille-feuille');
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
    await expectArabicRtl(page, boardSlug, (p) => rows(p).first());
  });
});

test.describe('every body keeps the phone page its own width', () => {
  const wide = bodyMenus();
  // Every shape, drawn from its own preset (or, for the batch-1 bodies, as an override on Maison's), with twenty-five
  // sections, so a strip that scrolls sideways is at its fullest.
  const kinds = BODY_KINDS.filter((kind) => kind !== 'scroll').map((kind) => ({ kind, templateId: templateList().find((preset) => bodyOf(preset.layout) === kind)?.id }));
  const slugOf = (kind: string) => wide.slug(`wide-${kind}`);
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    for (const { kind, templateId } of kinds) await wide.create(slugOf(kind), kind, { ...(templateId ? { templateId } : { layout: { body: kind } }), extraSections: 20 });
  });
  test.afterAll(() => wide.remove());

  test('with twenty-five sections no body widens the layout viewport or scrolls sideways at 390px', async ({ page }) => {
    test.setTimeout(240_000);
    for (const { kind } of kinds) {
      await openMenu(page, slugOf(kind));
      await expect(page.locator(`[data-body="${kind}"]`), kind).toBeVisible();
      await expectNoPageWiden(page);
    }
  });
});
