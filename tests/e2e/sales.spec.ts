import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { createMenuFixture, publishFixture } from '../helpers/db';

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
