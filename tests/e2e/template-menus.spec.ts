import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { MAISON } from '../../prisma/seed/maison';
import { NOOR } from '../../prisma/seed/noor';
import { ONDA } from '../../prisma/seed/onda';

/**
 * The template demo menus (spec 2026-10-18-template-studio-design.md): each drawn with its preset, labelled as a
 * demonstration, readable at phone width in every language, and its product detail opening and closing like a dialog.
 * The scene is kept still (`?stage=off`); template-stage.spec.ts covers 3D.
 */

const DEMOS = [MAISON, ONDA, NOOR];

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

for (const demo of DEMOS) {
  const slug = demo.restaurant.slug;
  const signature = demo.products.find((product) => product.signature) ?? demo.products[0]!;

  test.describe(demo.profile.name, () => {
    test('is drawn with its template and says it is a demonstration', async ({ page }) => {
      await page.goto(`/${slug}/en?stage=off`);
      await expect(page.locator('.scene-layer')).toHaveAttribute('data-scene', demo.brand.templateId!);
      await expect(page.getByRole('heading', { name: 'Demonstration menu' })).toBeVisible();
      await expect(page.getByRole('button', { name: signature.name.en, exact: true }).first()).toBeVisible();
      expect(await page.locator('canvas').count()).toBe(0);
    });

    for (const locale of ['en', 'ar', 'ckb'] as const) {
      test(`fits a phone in ${locale}, with no serious accessibility problem`, async ({ page }) => {
        await page.goto(`/${slug}/${locale}?stage=off`);
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'en' ? 'ltr' : 'rtl');
        await expect(page.getByRole('heading', { name: demo.categories[0]!.name[locale] }).first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        expect(await seriousViolations(page)).toEqual([]);
      });
    }

    test('opens a product at its own address and closes it with Escape, back where the guest was', async ({ page }) => {
      await page.goto(`/${slug}/en?stage=off`);
      const opener = page.getByRole('button', { name: signature.name.en, exact: true }).first();
      await opener.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${slug}/en/p/${signature.slug}$`));
      await expect(dialog.getByRole('heading', { name: signature.name.en })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/${slug}/en(\\?stage=off)?$`));
      await expect(opener).toBeFocused();
    });
  });
}

test('a product address opens the menu with that product shown', async ({ page }) => {
  const product = ONDA.products.find((entry) => entry.slug === 'build-a-sundae')!;
  await page.goto(`/${ONDA.restaurant.slug}/en/p/${product.slug}?stage=off`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: product.name.en })).toBeVisible();
  for (const group of product.groups!) await expect(dialog.getByText(group.name.en, { exact: true })).toBeVisible();
});
