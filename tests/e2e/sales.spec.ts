import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { seedMenu } from '../../prisma/seed/apply';
import { MAISON } from '../../prisma/seed/maison';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { createMenuFixture, deleteBillingRows, publishFixture } from '../helpers/db';

/**
 * The sales tools as a guest meets them (docs/superpowers/specs/2026-10-18-sales-tools-design.md, 6.3), on a menu made
 * for this run: an espresso 20% off all day, and drinks that complete a meal. A fresh slug, because the server caches
 * what a slug serves and a seeded menu changed here could not be read back.
 */

let prisma: PrismaClient;
let slug = '';
let ids: { menu: string; restaurant: string } = { menu: '', restaurant: '' };

test.beforeAll(async () => {
  prisma = createPrisma(databaseUrl(DEV_DB));
  slug = `e2e-sales-${randomUUID().slice(0, 8)}`;
  const { restaurant, menu, product } = await createMenuFixture(prisma, slug, { publish: false });
  ids = { menu: menu.id, restaurant: restaurant.id };
  const drinks = await prisma.category.create({
    data: { menuId: menu.id, slug: 'drinks', sortOrder: 1, completesMeal: true, translations: { en: { name: 'Drinks' } } },
  });
  await prisma.product.create({
    data: { menuId: menu.id, categoryId: drinks.id, slug: 'lemonade', basePrice: 500, translations: { en: { name: 'Lemonade', description: 'Fresh' } } },
  });
  await prisma.promotion.create({
    data: { menuId: menu.id, kind: 'DISCOUNT', percentOff: 20, productIds: [product.id], translations: { en: { title: 'Espresso hour', text: 'A fifth off every espresso' } } },
  });
  await publishFixture(prisma, menu.id);
});

test.afterAll(async () => {
  await prisma.menuSlug.deleteMany({ where: { OR: [{ menuId: ids.menu }, { slug }] } });
  await prisma.menu.deleteMany({ where: { id: ids.menu } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ menuId: ids.menu }, { restaurantId: ids.restaurant }] } });
  await deleteBillingRows(prisma, [ids.restaurant]);
  await prisma.restaurant.deleteMany({ where: { id: ids.restaurant } });
  await prisma.$disconnect();
});

test.describe('Sales tools', () => {
  test('a live discount shows the regular price crossed out, and the cart completes the meal at the server’s price', async ({ page }) => {
    await page.goto(`/${slug}/en`);

    const offers = page.getByRole('region', { name: 'Offers' });
    await expect(offers).toContainText('Espresso hour');
    await expect(offers).toContainText('A fifth off every espresso');

    const espresso = page.getByTestId('product-row').filter({ hasText: 'Espresso' });
    await expect(espresso).toContainText('−20%');
    await expect(espresso).toContainText('$2.40');
    await expect(espresso.locator('s')).toContainText('$3.00');

    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await page.goto(`/${slug}/en/cart`);
    await expect(page.getByTestId('cart-subtotal')).toContainText('$2.40');

    const meal = page.getByRole('region', { name: 'Complete your meal' });
    await expect(meal).toContainText('Lemonade');
    await meal.getByRole('button', { name: 'Add Lemonade' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$7.40');
    await expect(page.getByTestId('cart-line')).toHaveCount(2);
    // Once the meal is complete the suggestion goes.
    await expect(page.getByRole('region', { name: 'Complete your meal' })).toHaveCount(0);
  });
});

/**
 * The same tools on a menu drawn with a template (Maison Lumière's Paris Maison, its cake cards and sheet), a copy of the
 * demo at a new address under a throwaway restaurant: the croissant and the Opéra cake 20% off all day, a chef's special,
 * two éclairs left, a tart for two, and prices written without the currency symbol.
 */
test.describe('Sales tools on a template menu', () => {
  let templateSlug = '';
  const made: { menu: string; restaurant: string } = { menu: '', restaurant: '' };

  test.beforeAll(async () => {
    const run = randomUUID().slice(0, 8);
    templateSlug = `e2e-sales-tpl-${run}`;
    const restaurant = await prisma.restaurant.create({ data: { name: `${MAISON.profile.name} sales e2e-${run}`, type: MAISON.profile.type } });
    made.restaurant = restaurant.id;
    const { menuId } = await seedMenu(
      prisma,
      {
        ...MAISON,
        restaurant: { ...MAISON.restaurant, slug: templateSlug, domains: [] },
        products: MAISON.products.map((p) =>
          p.slug === 'eclair' ? { ...p, stock: 2, lowStock: 3 } : p.slug === 'tarte-au-citron' ? { ...p, serves: 2 } : p,
        ),
        promotions: [
          {
            kind: 'DISCOUNT',
            percentOff: 20,
            products: ['croissant', 'opera-cake'],
            title: { en: 'Morning pastries', ar: 'معجنات الصباح', ckb: 'هەویری بەیانیان' },
            text: { en: 'A fifth off croissants and the Opéra', ar: 'خصم الخُمس على الكرواسون والأوبرا', ckb: 'پێنج یەک داشکاندن لە کرواسان و ئۆپێرا' },
          },
          { kind: 'SPECIAL', products: ['mille-feuille'], title: { en: 'Chef’s choice', ar: 'اختيار الشيف', ckb: 'هەڵبژاردەی سەرئاشپەز' } },
        ],
      },
      restaurant.id,
    );
    made.menu = menuId;
    await prisma.menuSlug.create({ data: { slug: templateSlug, menuId } });
    await prisma.menu.update({ where: { id: menuId }, data: { engineConfig: { sales: { priceStyle: 'plain', showMostOrdered: true, showLowStock: true } } } });
    await publishFixture(prisma, menuId);
  });

  test.afterAll(async () => {
    await prisma.menuSlug.deleteMany({ where: { OR: [{ menuId: made.menu }, { slug: templateSlug }] } });
    await prisma.menu.deleteMany({ where: { id: made.menu } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ menuId: made.menu }, { restaurantId: made.restaurant }] } });
    await deleteBillingRows(prisma, [made.restaurant]);
    await prisma.restaurant.deleteMany({ where: { id: made.restaurant } });
  });

  test('cards and the sheet show the sale, the labels and the offer, in the menu’s price style', async ({ page }) => {
    await page.goto(`/${templateSlug}/en`);
    await expect(page.locator('[data-template="paris-maison"]')).toBeVisible();

    const offers = page.getByRole('region', { name: 'Offers' });
    await expect(offers).toContainText('Morning pastries');
    await expect(offers).toContainText('A fifth off croissants and the Opéra');
    await expect(offers).toContainText('−20%');

    const menu = page.locator('#menu');
    const card = (name: string) => menu.locator('[data-card] > li').filter({ has: page.getByRole('button', { name, exact: true }) });
    const croissant = card('Butter croissant');
    await expect(croissant).toContainText('2.80');
    await expect(croissant.locator('s')).toContainText('3.50');
    await expect(croissant).toContainText('−20%');
    await expect(card('Opéra cake').locator('s')).toContainText('48.00');
    await expect(card('Opéra cake')).toContainText('38.40');
    await expect(card('Vanilla mille-feuille')).toContainText('Chef’s choice');
    await expect(card('Éclair')).toContainText('Only 2 left');
    await expect(card('Lemon tart')).toContainText('For 2');
    // The plain price style: no currency symbol anywhere on the menu's cards.
    await expect(menu).not.toContainText('$');

    await croissant.getByRole('button', { name: 'Butter croissant', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Butter croissant' });
    await expect(sheet.locator('s')).toContainText('3.50');
    await expect(sheet).toContainText('2.80');
    await expect(sheet).toContainText('−20%');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // A bigger size adds its discounted difference: 20 cm is 22.00 more, 17.60 during the sale.
    await card('Opéra cake').getByRole('button', { name: 'Opéra cake', exact: true }).click();
    const cake = page.getByRole('dialog', { name: 'Opéra cake' });
    await expect(cake).toContainText('+17.60');
    await expect(cake).not.toContainText('+22.00');
  });
});
