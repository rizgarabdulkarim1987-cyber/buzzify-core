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
const prisma = createPrisma(databaseUrl(DEV_DB));
let restaurantId = '';
let menuId = '';

const products = MAISON.products.filter((product) => product.slug !== 'baguette');
const categories = MAISON.categories;
const named = (productSlug: string) => MAISON.products.find((product) => product.slug === productSlug)!.name.en;

test.beforeAll(async () => {
  const restaurant = await prisma.restaurant.create({ data: { name: `${MAISON.profile.name} book e2e-${run}`, type: MAISON.profile.type } });
  restaurantId = restaurant.id;
  const seeded = await seedMenu(prisma, { ...MAISON, products, restaurant: { ...MAISON.restaurant, slug, domains: [] } }, restaurantId);
  menuId = seeded.menuId;
  await prisma.menuSlug.create({ data: { slug, menuId } });
  const design: DesignOverrides = { ...MAISON.brand.design, layout: { body: 'book' } };
  await prisma.brandConfig.update({ where: { menuId }, data: { design: design as Prisma.InputJsonValue } });
  await publishFixture(prisma, menuId, 'Book body');
});

test.afterAll(async () => {
  try {
    await prisma.menuSlug.deleteMany({ where: { OR: [{ menuId }, { slug }] } });
    await prisma.menu.deleteMany({ where: { id: menuId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ menuId }, { restaurantId }] } });
    await deleteBillingRows(prisma, [restaurantId]);
    await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
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
  await index(page).getByRole('button', { name: /Pâtisserie/ }).click();
  await expect(page.locator('#cat-patisserie')).toBeVisible({ timeout: 100 });
});

test('in Arabic the book is right to left and its index renders', async ({ page }) => {
  await page.goto(`/${slug}/ar?stage=off`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(index(page)).toBeVisible();
  await expect(index(page).getByRole('button', { name: new RegExp(categories[1]!.name.ar) })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
