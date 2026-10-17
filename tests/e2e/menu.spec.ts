import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';

test.describe('Quick Menu', () => {
  test('shows the menu immediately without any interaction', async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.getByTestId('brand')).toHaveText('ATELIER');
    await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu categories' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Atelier Burger/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coffee & Tea' })).toBeVisible();
  });

  test('lists all five categories and twenty-four products', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail.getByRole('link')).toHaveCount(5);
    await expect(page.getByTestId('product-row')).toHaveCount(24);
  });

  test('filters by search in English, Arabic and Sorani', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    const rows = page.getByTestId('product-row');

    await search.fill('burger');
    await expect(rows.filter({ hasText: 'Atelier Burger' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Espresso' })).toHaveCount(0);

    await search.fill('برغر');
    await expect(rows.filter({ hasText: 'Atelier Burger' })).toHaveCount(1);

    await search.fill('کرواسان');
    await expect(rows.filter({ hasText: 'Croissant' })).toHaveCount(1);

    await search.fill('٢٥٠');
    await expect(rows.filter({ hasText: 'Ribeye' })).toHaveCount(1);
  });

  test('handles empty and hostile search input without breaking', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    for (const hostile of ['(', '[', '.*', '\\', '   ']) {
      await search.fill(hostile);
      await expect(page.getByTestId('brand')).toBeVisible();
    }
    await search.fill('zzzzqqqq');
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('product-row')).toHaveCount(24);
  });

  test('quick add puts a simple item into the order bar', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    const bar = page.getByTestId('cart-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 item');
    await expect(bar).toContainText('$3.00');
  });

  test('items that need choices have no quick add', async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.getByRole('button', { name: /Add Ribeye/ })).toHaveCount(0);
  });

  test('never scrolls horizontally on a 320 px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/atelier/en');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto('/atelier/ar');
    const overflowRtl = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowRtl).toBeLessThanOrEqual(0);
  });

  test('hydrates Arabic and Sorani pages without console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    for (const path of ['/atelier/ar', '/atelier/ckb', '/atelier/ckb/p/atelier-burger']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(problems).toEqual([]);
  });

  test('renders right to left in Arabic with translated content', async ({ page }) => {
    await page.goto('/atelier/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('searchbox', { name: 'ابحث في القائمة' })).toBeVisible();
    await expect(page.getByRole('button', { name: /برغر أتيليه/ }).first()).toBeVisible();
  });
});

test.describe('Product details from the Studio', () => {
  let menu: TemporaryMenu;

  test.beforeAll(async () => {
    const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#B4532A' } }).jpeg().toBuffer();
    menu = await createTemporaryMenu({
      product: { badges: ['NEW'], dietary: ['VEGAN'], calories: 320, photo: new Uint8Array(photo), alt: { en: 'A red espresso cup', ar: 'فنجان إسبريسو أحمر' } },
    });
  });

  test.afterAll(async () => {
    await menu?.remove();
  });

  test('shows the badge on the row, in the page language', async ({ page }) => {
    await page.goto(`/${menu.slug}/en`);
    await expect(page.getByTestId('product-row').getByText('New', { exact: true })).toBeVisible();
    await page.goto(`/${menu.slug}/ar`);
    await expect(page.getByTestId('product-row').getByText('جديد', { exact: true })).toBeVisible();
  });

  test('lists dietary tags and calories on the product page', async ({ page }) => {
    await page.goto(`/${menu.slug}/en/p/${menu.productSlug}`);
    await expect(page.getByText('Vegan', { exact: true })).toBeVisible();
    await expect(page.getByText('320 kcal')).toBeVisible();
  });

  test('loads the library photo as AVIF or WebP at the width it needs, with its alt text', async ({ page }) => {
    await page.goto(`/${menu.slug}/en`);
    const picture = page.getByTestId('product-row').locator('picture').first();
    await expect(picture.locator('source[type="image/avif"]')).toHaveAttribute('srcset', /avif-320\.avif 320w/);
    const image = picture.locator('img');
    await expect(image).toHaveAttribute('srcset', /webp-640\.webp 640w/);
    await expect(image).toHaveAttribute('loading', 'lazy');
    // The file really loads from the media route: a broken URL would leave it at zero width.
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await page.goto(`/${menu.slug}/ar/p/${menu.productSlug}`);
    await expect(page.locator('picture img').first()).toHaveAttribute('alt', 'فنجان إسبريسو أحمر');
  });
});
