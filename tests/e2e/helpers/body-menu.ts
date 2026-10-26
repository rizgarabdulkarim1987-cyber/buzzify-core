import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import type { Prisma } from '@/generated/prisma/client';
import type { DesignOverrides, TemplateId } from '@/lib/templates/types';
import { createPrisma } from '@/server/data/prisma';
import { seedMenu } from '../../../prisma/seed/apply';
import { MAISON } from '../../../prisma/seed/maison';
import { DEV_DB, databaseUrl } from '../../../scripts/db-config';
import { deleteBillingRows, publishFixture } from '../../helpers/db';

/**
 * Shared steps for the browse-body e2e tests (spec 2026-10-26-menu-styles-in-templates-design.md). A body menu is a
 * throwaway copy of the Maison Lumière demo in a restaurant of its own at a new address, so the seeded demos other
 * suites read never change and no cached revision is reused. The copy drops the baguette, so its last category (Bread)
 * has one dish. Its dishes are drawings (art, an `<svg>`); a real menu's are library photos (`<img>`).
 */

export const BODY_PRODUCTS = MAISON.products.filter((product) => product.slug !== 'baguette');
export const BODY_CATEGORIES = MAISON.categories;
/** The English name of a Maison dish. */
export const dishName = (productSlug: string) => MAISON.products.find((product) => product.slug === productSlug)!.name.en;

/** The phone every first-screen rule is checked on. */
export const PHONE = { width: 390, height: 844 };

export interface BodyMenuOptions {
  /** The template the menu is drawn with; Maison's own (Paris Maison) when absent. */
  templateId?: TemplateId;
  /** Layout overrides, `body` among them. */
  layout?: NonNullable<DesignOverrides['layout']>;
  numeralSystem?: 'LATN' | 'ARAB';
}

export interface BodyMenus {
  /** A fresh address for this run: `e2e-<run>-<label>`. */
  slug(label: string): string;
  create(slug: string, label: string, options?: BodyMenuOptions): Promise<void>;
  /** Deletes every menu made, with its restaurant, slugs, audit and billing rows. Call from `afterAll`. */
  remove(): Promise<void>;
}

export function bodyMenus(): BodyMenus {
  const run = randomUUID().slice(0, 8);
  const prisma = createPrisma(databaseUrl(DEV_DB));
  const made: { restaurantId: string; menuId: string; slug: string }[] = [];
  return {
    slug: (label) => `e2e-${run}-${label}`,
    async create(menuSlug, label, { templateId, layout, numeralSystem = 'LATN' } = {}) {
      const restaurant = await prisma.restaurant.create({ data: { name: `${MAISON.profile.name} ${label} e2e-${run}`, type: MAISON.profile.type } });
      const seeded = await seedMenu(
        prisma,
        {
          ...MAISON,
          products: BODY_PRODUCTS,
          brand: templateId ? { ...MAISON.brand, templateId } : MAISON.brand,
          restaurant: { ...MAISON.restaurant, slug: menuSlug, domains: [], numeralSystem },
        },
        restaurant.id,
      );
      made.push({ restaurantId: restaurant.id, menuId: seeded.menuId, slug: menuSlug });
      await prisma.menuSlug.create({ data: { slug: menuSlug, menuId: seeded.menuId } });
      if (layout) {
        const design: DesignOverrides = { ...MAISON.brand.design, layout };
        await prisma.brandConfig.update({ where: { menuId: seeded.menuId }, data: { design: design as Prisma.InputJsonValue } });
      }
      await publishFixture(prisma, seeded.menuId, `${label} body`);
    },
    async remove() {
      try {
        for (const { restaurantId, menuId, slug: menuSlug } of made.splice(0)) {
          await prisma.menuSlug.deleteMany({ where: { OR: [{ menuId }, { slug: menuSlug }] } });
          await prisma.menu.deleteMany({ where: { id: menuId } });
          await prisma.auditLog.deleteMany({ where: { OR: [{ menuId }, { restaurantId }] } });
          await deleteBillingRows(prisma, [restaurantId]);
          await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
        }
      } finally {
        await prisma.$disconnect();
      }
    },
  };
}

/** Opens the menu without the stage intro; on a phone (390 x 844) unless `phone` is false. */
export async function openMenu(page: Page, slug: string, { locale = 'en', hash = '', phone = true }: { locale?: string; hash?: string; phone?: boolean } = {}) {
  if (phone) await page.setViewportSize(PHONE);
  await page.goto(`/${slug}/${locale}?stage=off${hash}`);
}

/**
 * The first-screen rule: at least `min` of `dishes` show a picture and a price both wholly inside the viewport. A
 * dish's picture is its first `<img>` or `<svg>`; its price is the first text that reads like one (`$` and a digit,
 * Latin or Arabic-Indic).
 */
export async function expectFirstScreen(page: Page, dishes: Locator, { min }: { min: number }) {
  await expect(dishes.first()).toBeVisible();
  const shown = await dishes.evaluateAll((nodes) => {
    const inside = (box: DOMRect) => box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth;
    return nodes.filter((node) => {
      const picture = node.querySelector('img, svg');
      if (!picture || !inside(picture.getBoundingClientRect())) return false;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!/\$\s?[\d٠-٩۰-۹]/.test(text.textContent ?? '')) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        return inside(range.getBoundingClientRect());
      }
      return false;
    }).length;
  });
  expect(shown, `dishes with a picture and a price on the first screen`).toBeGreaterThanOrEqual(min);
}

/** Every category is one tap away: `within` holds a visible button naming each of them. */
export async function expectEverySectionReachable(within: Locator, locale: 'en' | 'ar' = 'en') {
  for (const category of BODY_CATEGORIES) await expect(within.getByRole('button', { name: new RegExp(category.name[locale]!) }), category.slug).toBeVisible();
}

/** Tapping `button` reaches the section: it is in view and its heading has the focus. */
export async function expectJumpsTo(page: Page, button: Locator, categorySlug: string) {
  await button.click();
  const section = page.locator(`#cat-${categorySlug}`);
  await expect(section).toBeInViewport();
  await expect(section.locator('[data-heading]')).toBeFocused();
}

/** Tapping the dish's name in `scope` opens its detail sheet; Escape closes it again. */
export async function expectOpensProduct(page: Page, scope: Locator, productSlug: string) {
  await scope.getByRole('button', { name: dishName(productSlug), exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: dishName(productSlug) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** The dish's quick add in `scope` puts one in the cart without opening its sheet. */
export async function expectQuickAdd(page: Page, scope: Locator, productSlug: string) {
  await expect(page.getByTestId('cart-bar')).toBeHidden();
  await scope.getByRole('button', { name: `Add ${dishName(productSlug)} to your order` }).click();
  await expect(page.getByTestId('cart-bar')).toContainText('1');
  await expect(page.getByRole('dialog')).toBeHidden();
}

/** In Arabic the page is right to left, `shown` renders, and nothing scrolls sideways. */
export async function expectArabicRtl(page: Page, slug: string, shown: (page: Page) => Locator, { phone = true }: { phone?: boolean } = {}) {
  await openMenu(page, slug, { locale: 'ar', phone });
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(shown(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}
