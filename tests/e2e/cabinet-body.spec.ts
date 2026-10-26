import { expect, test, type Page } from '@playwright/test';
import { BODY_CATEGORIES, bodyMenus, expectArabicRtl, expectEverySectionReachable, expectFirstScreen, expectOpensProduct, expectQuickAdd, openMenu } from './helpers/body-menu';

/**
 * The Drawer Cabinet body (spec 2026-10-26-menu-styles-in-templates-design.md): every section is a drawer front with a
 * handle, drawers are independent accordions (the first open), and a closed drawer renders no dishes and no photos.
 * Throwaway copies of the Maison Lumiere demo.
 */

const menus = bodyMenus();
const slug = menus.slug('cab');
const arabSlug = menus.slug('cabar');

test.beforeAll(async () => {
  await menus.create(slug, 'cabinet', { templateId: 'the-drawer-cabinet', layout: { body: 'cabinet', hero: 'editorial', nav: 'index' } });
  await menus.create(arabSlug, 'cabinet', { templateId: 'the-drawer-cabinet', numeralSystem: 'ARAB' });
});
test.afterAll(() => menus.remove());

const cab = (page: Page) => page.locator('[data-body="cabinet"]');
const fronts = (page: Page) => cab(page).locator('[data-front]');
const dishes = (page: Page) => cab(page).locator('[data-row]');
const front = (page: Page, categorySlug: string) => page.locator(`#cat-${categorySlug} [data-front] button`);
const slugAt = (index: number) => BODY_CATEGORIES[index]!.slug;
const last = slugAt(BODY_CATEGORIES.length - 1);

test('on a phone the first drawers are open with four dishes, photos and prices, and every drawer front is tappable', async ({ page }) => {
  await openMenu(page, slug);
  await expect(cab(page)).toBeVisible();
  await expectFirstScreen(page, dishes(page), { min: 4 });
  await expectEverySectionReachable(fronts(page));
  await expect(front(page, slugAt(0))).toHaveAttribute('aria-expanded', 'true');
  await expect(front(page, last)).toHaveAttribute('aria-expanded', 'false');
});

test('a closed drawer renders no dishes and loads no photos', async ({ page }) => {
  await openMenu(page, slug);
  const closed = page.locator(`#cat-${last}`);
  await expect(closed.locator('[data-row]')).toHaveCount(0);
  await expect(closed.locator('img, svg')).toHaveCount(0);
  await expect(front(page, last)).not.toHaveAttribute('aria-controls', /./);
  await expect(front(page, slugAt(0))).toHaveAttribute('aria-controls', `tray-${slugAt(0)}`);
  expect(await page.locator(`#cat-${slugAt(0)} [data-row]`).count()).toBeGreaterThan(0);
});

test('drawers are independent: opening one leaves the others as they were, and a front toggles it shut', async ({ page }) => {
  await openMenu(page, slug);
  await front(page, last).click();
  await expect(page.locator(`#cat-${last} [data-row]`)).toHaveCount(1);
  await expect(page.locator(`#cat-${slugAt(0)} [data-row]`).first()).toBeVisible();
  await front(page, slugAt(0)).click();
  await expect(page.locator(`#cat-${slugAt(0)} [data-row]`)).toHaveCount(0);
  await expect(page.locator(`#cat-${last} [data-row]`)).toHaveCount(1);
});

test('an address to a closed section opens its drawer and brings it into view', async ({ page }) => {
  await openMenu(page, slug, { hash: '#cat-bread' });
  await expect(page.locator('#cat-bread [data-row]')).toHaveCount(1);
  await expect(page.locator('#cat-bread')).toBeInViewport();
  await expect(front(page, 'bread')).toHaveAttribute('aria-expanded', 'true');
});

test('a dish opens its sheet and adds one', async ({ page }) => {
  await openMenu(page, slug);
  const first = page.locator('#cat-viennoiserie');
  await expectOpensProduct(page, first, 'croissant');
  await expectQuickAdd(page, first, 'croissant');
});

test('a long dish name stays inside its tile without sideways scrolling', async ({ page }) => {
  await openMenu(page, slug);
  await dishes(page).first().locator('.cb-name').evaluate((node) => {
    node.textContent = 'A very long dish name that keeps going and going so that it wraps onto several lines on a phone screen';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const tile = (await dishes(page).first().boundingBox())!;
  const name = (await dishes(page).first().locator('.cb-name').boundingBox())!;
  expect(name.x + name.width).toBeLessThanOrEqual(tile.x + tile.width + 1);
  expect(name.y + name.height).toBeLessThanOrEqual(tile.y + tile.height + 1);
});

test('counts use the tenant numerals', async ({ page }) => {
  await page.goto(`/${arabSlug}/en?stage=off`);
  await expect(fronts(page).first().locator('[data-count]')).toHaveText('٣');
  await expect(fronts(page).first().getByRole('button')).toHaveAccessibleName(/٣ dishes/);
});

test('in Arabic the fronts and trays mirror and nothing scrolls sideways', async ({ page }) => {
  await expectArabicRtl(page, slug, (p) => fronts(p).first());
});

test('reduced motion removes the tray entrance', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMenu(page, slug);
  await expect(cab(page).locator('.cb-tray').first()).toHaveCSS('animation-name', 'none');
});

test('a search for a dish in a closed drawer opens that drawer, and the search box keeps the focus', async ({ page }) => {
  await openMenu(page, slug);
  await expect(front(page, last)).toHaveAttribute('aria-expanded', 'false');
  const box = page.getByRole('searchbox', { name: 'Search the menu' });
  await box.click();
  await page.keyboard.type('sourdough', { delay: 30 });
  await expect(page.locator(`#cat-${last} [data-row]`)).toHaveCount(1);
  await expect(page.locator(`#cat-${last} [data-row]`)).toBeVisible();
  await expect(front(page, last)).toHaveAttribute('aria-expanded', 'true');
  await expect(box).toBeFocused();
});

test('a search keeps main#menu and never steals focus', async ({ page }) => {
  await openMenu(page, slug);
  const box = page.getByRole('searchbox', { name: 'Search the menu' });
  await box.fill('cro');
  await expect(box).toBeFocused();
  await box.fill('zzzzqq');
  await expect(box).toBeFocused();
  await expect(page.locator('main#menu')).toHaveCount(1);
});
