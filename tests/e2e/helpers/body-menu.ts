import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import type { Prisma } from '@/generated/prisma/client';
import { TEMPLATES } from '@/lib/templates';
import type { DesignOverrides, DesignPalette, TemplateId } from '@/lib/templates/types';
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
  /** One of the template's curated palettes (an alternative), by id. */
  paletteId?: string;
  /** Colours picked in Customize, over the palette (a light accent, a light background). */
  colors?: Partial<DesignPalette>;
  /** Dishes (by slug) on a 20% discount all day, so the cards show the sale. */
  discount?: string[];
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
    async create(menuSlug, label, { templateId, layout, numeralSystem = 'LATN', paletteId, colors, discount } = {}) {
      const restaurant = await prisma.restaurant.create({ data: { name: `${MAISON.profile.name} ${label} e2e-${run}`, type: MAISON.profile.type } });
      const seeded = await seedMenu(
        prisma,
        {
          ...MAISON,
          products: BODY_PRODUCTS,
          ...(discount ? { promotions: [{ kind: 'DISCOUNT' as const, percentOff: 20, products: discount, title: { en: 'A fifth off', ar: 'خصم الخُمس', ckb: 'پێنج یەک داشکاندن' } }] } : {}),
          brand: templateId ? { ...MAISON.brand, templateId } : MAISON.brand,
          restaurant: { ...MAISON.restaurant, slug: menuSlug, domains: [], numeralSystem },
        },
        restaurant.id,
      );
      made.push({ restaurantId: restaurant.id, menuId: seeded.menuId, slug: menuSlug });
      await prisma.menuSlug.create({ data: { slug: menuSlug, menuId: seeded.menuId } });
      if (layout || paletteId || colors) {
        const design: DesignOverrides = { ...MAISON.brand.design, ...(layout ? { layout } : {}), ...(paletteId ? { paletteId } : {}), ...(colors ? { colors } : {}) };
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

/**
 * The strip of sections stays at the top: scrolled to the end of the menu, `strip` is still pinned to the top of the
 * viewport, `button` (a section's entry on it) still jumps there, and the section's heading lands below the strip,
 * not under it.
 */
export async function expectStripStays(page: Page, strip: Locator, button: Locator, categorySlug: string) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Math.abs((await strip.boundingBox())?.y ?? 99), { message: 'the strip is pinned to the top' }).toBeLessThanOrEqual(1);
  await expectJumpsTo(page, button, categorySlug);
  const heading = page.locator(`#cat-${categorySlug} [data-heading]`);
  await expect
    .poll(async () => {
      const bar = (await strip.boundingBox())!;
      return (await heading.boundingBox())!.y - (bar.y + bar.height);
    }, { message: 'the heading clears the strip' })
    .toBeGreaterThanOrEqual(-1);
}

/**
 * The contrast ratio of `node`'s text colour on the colour behind it: its own background or, where that is transparent
 * or translucent, its ancestors' composited under it. 0 when a gradient or an image comes before an opaque colour.
 */
export async function contrastOf(node: Locator): Promise<number> {
  return node.evaluate((element) => {
    // `rgb(a)` (0 to 255) or `color(srgb ...)` (0 to 1, what `color-mix` computes to), as [r, g, b, alpha] from 0 to 1.
    const parse = (value: string): number[] => {
      const parts = value.match(/[\d.]+/g)!.map(Number);
      const srgb = value.startsWith('color(');
      const [r, g, b] = parts.slice(0, 3).map((part) => (srgb ? part : part / 255));
      const alpha = value.startsWith('rgba') || value.includes('/') ? parts[3]! : 1;
      return [r!, g!, b!, alpha];
    };
    // The element's own background, then its ancestors', until an opaque one; a gradient or image on the way: unknown.
    const layers: number[][] = [];
    for (let at: Element | null = element; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.backgroundImage !== 'none') return 0;
      const colour = parse(style.backgroundColor);
      if (colour[3]! > 0) layers.push(colour);
      if (colour[3] === 1) break;
    }
    if (layers.at(-1)?.[3] !== 1) return 0;
    const ground = layers.reduceRight<number[]>((under, [r, g, b, a]) => [r!, g!, b!].map((c, i) => c * a! + under[i]! * (1 - a!)), [1, 1, 1]);
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.slice(0, 3).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [light, dark] = [luminance(parse(getComputedStyle(element).color)), luminance(ground)].sort((a, b) => b - a);
    return (light! + 0.05) / (dark! + 0.05);
  });
}

/** The template's curated palettes by id: its own first (`signature`), then its alternatives. */
export const paletteIdsOf = (templateId: TemplateId) => TEMPLATES[templateId].palettes.map(({ id }) => id);

/**
 * Every pair (a name, and the element whose text sits on a fill) reads at 4.5:1 or more on the menu. Polled, so a fill
 * still in its colour transition (a chip that just lit) is measured once it has settled.
 */
export async function expectReadable(menu: string, pairs: Record<string, Locator>) {
  for (const [name, node] of Object.entries(pairs)) {
    await expect(node, `${menu}: ${name}`).toBeVisible();
    await expect.poll(() => contrastOf(node), { message: `${menu}: ${name}` }).toBeGreaterThanOrEqual(4.5);
  }
}

/**
 * Keyboard focus on the focused element draws a ring that nothing clips: the ring (an outline of `outset` px around
 * `ringOf`, or inside it when negative) lies wholly inside every ancestor that clips (overflow other than visible, or a
 * clip-path), the element itself included. Pass `ringOf` when the ring is drawn around another box (a whole-card tap
 * area). Checks the outline is really drawn, too.
 */
export async function expectFocusRingShows(page: Page, ringOf: Locator, { outset, pseudo }: { outset: number; pseudo?: '::after' }) {
  const result = await ringOf.evaluate(
    (box, { outset, pseudo }) => {
      const focused = document.activeElement as HTMLElement | null;
      if (!focused) return 'nothing has the focus';
      const style = getComputedStyle(focused, pseudo ?? null);
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0) return 'no outline is drawn';
      const rect = box.getBoundingClientRect();
      const ring = { top: rect.top - outset, left: rect.left - outset, bottom: rect.bottom + outset, right: rect.right + outset };
      // A whole-card ring (`::after`) belongs to the card, not to the button, so the button's own clipping does not cut it.
      for (let node: HTMLElement | null = pseudo ? focused.parentElement : focused; node && node !== document.body; node = node.parentElement) {
        const own = getComputedStyle(node);
        const clips = own.overflowX !== 'visible' || own.overflowY !== 'visible' || own.clipPath !== 'none';
        if (!clips) continue;
        const edge = node.getBoundingClientRect();
        if (ring.top < edge.top - 0.5 || ring.left < edge.left - 0.5 || ring.bottom > edge.bottom + 0.5 || ring.right > edge.right + 0.5) {
          return `clipped by ${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`;
        }
      }
      return 'ok';
    },
    { outset, pseudo },
  );
  expect(result).toBe('ok');
}
