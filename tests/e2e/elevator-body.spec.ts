import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectFirstScreen, expectJumpsTo, expectOpensProduct, expectQuickAdd, openMenu } from './helpers/body-menu';

/**
 * The Elevator body (spec 2026-10-26-menu-styles-in-templates-design.md): a floor-button rail pinned at the inline
 * edge, every section a floor, the lit button the floor in view. Throwaway copies of the Maison Lumière demo.
 */

const menus = bodyMenus();
const slug = menus.slug('elv');
const arabSlug = menus.slug('elvar');

test.beforeAll(async () => {
  await menus.create(slug, 'elevator', { templateId: 'the-elevator', layout: { body: 'elevator', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'elevator', { templateId: 'the-elevator', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const elevator = (page: Page) => page.locator('[data-body="elevator"]');
const rail = (page: Page) => elevator(page).locator('[data-rail]');
const floor = (page: Page, n: number) => rail(page).getByRole('button', { name: new RegExp(`^Floor ${n}:`) });
const rows = (page: Page) => elevator(page).locator('[data-row]');

test('on a phone the first screen shows five dishes with photos and prices, and the rail', async ({ page }) => {
  await openMenu(page, slug);
  await expect(elevator(page)).toBeVisible();
  await expectFirstScreen(page, rows(page), { min: 5 });
  await expect(floor(page, 1)).toBeInViewport({ ratio: 1 });
  await expect(floor(page, 2)).toBeInViewport({ ratio: 1 });
  for (const category of BODY_CATEGORIES) await expect(rail(page).getByRole('button', { name: new RegExp(category.name.en!) }), category.slug).toBeVisible();
});

test('the rail sits at the inline end and every floor button is a 44px target', async ({ page }) => {
  await openMenu(page, slug);
  const box = (await rail(page).boundingBox())!;
  expect(box.x + box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  for (let n = 1; n <= BODY_CATEGORIES.length; n += 1) {
    const button = (await floor(page, n).boundingBox())!;
    expect(button.width, `floor ${n}`).toBeGreaterThanOrEqual(44);
    expect(button.height, `floor ${n}`).toBeGreaterThanOrEqual(44);
  }
});

test('a floor button rides to its floor, focuses the heading and lights up', async ({ page }) => {
  await openMenu(page, slug);
  await expectJumpsTo(page, floor(page, 3), 'celebration');
  await expect(floor(page, 3)).toHaveAttribute('aria-current', 'true');
  await expect(rail(page).locator('[data-display]')).toHaveText('3');
});

test('the lit floor number reads at 4.5:1 or more on its button', async ({ page }) => {
  await openMenu(page, slug);
  const lit = rail(page).locator('[aria-current="true"] [data-floor-no]');
  await expect(lit).toHaveCount(1);
  const ratio = await lit.evaluate((node) => {
    const style = getComputedStyle(node);
    // A gradient behind the digit has no single colour to measure against: the lit state must be a solid fill.
    if (style.backgroundImage !== 'none') return 0;
    const luminance = (value: string) => {
      const [r, g, b] = value.match(/[\d.]+/g)!.slice(0, 3).map((part) => {
        const c = Number(part) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [light, dark] = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('the rail stays pinned while the floors scroll', async ({ page }) => {
  await openMenu(page, slug);
  await floor(page, 4).click();
  await expect(page.locator('#cat-boxes')).toBeInViewport();
  const box = (await rail(page).boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(1);
  await expect(floor(page, 4)).toBeInViewport();
});

test('scrolling lights the floor in view and the display follows', async ({ page }) => {
  await openMenu(page, slug);
  await page.locator('#cat-bread').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(rail(page).locator('[aria-current="true"]')).toHaveCount(1);
  await expect(floor(page, BODY_CATEGORIES.length)).toHaveAttribute('aria-current', 'true');
});

test('a floor opens a dish and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
});

test('a section with one dish is a floor of one row', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread')).toBeInViewport();
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
});

test('a long dish name wraps inside its row without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await rows(page).first().locator('.el-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto three or four lines on a phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const row = (await rows(page).first().boundingBox())!;
  const price = (await rows(page).first().locator('.el-price').boundingBox())!;
  expect(price.x + price.width).toBeLessThanOrEqual(row.x + row.width + 1);
});

test('floor numbers use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(rail(page).locator('[data-floor-no]').nth(2)).toHaveText('٣');
  await expect(rail(page).locator('[data-display]')).toHaveText('١');
});

test('in Arabic the rail is at the left and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => rail(p));
  const box = (await rail(page).boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(1);
});

test('reduced motion removes the display roll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(rail(page).locator('[data-display] span').first()).toHaveCSS('animation-name', 'none');
});

test('a search that finds nothing keeps main#menu', async ({ page }) => {
  await openMenu(page, slug);
  await page.getByRole('searchbox', { name: 'Search the menu' }).fill('zzzzqq');
  await expect(page.locator('main#menu')).toHaveCount(1);
});
