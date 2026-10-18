import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Locale } from '@/lib/locale';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Motion tab (docs/superpowers/specs/2026-10-18-menu-motions-design.md) on a temporary menu: a designer puts golden
 * particles at the top of the menu, changes its colour and publishes; a guest's menu plays it, and stays still for a
 * guest who asks for reduced motion. Axe on the tab and its editor in Arabic.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser, locale: Locale = 'en'): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile(locale) });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('the Motion tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('places a motion at the top of the menu, and guests see it play after a publish', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/motion`);
    await expect(page.getByRole('heading', { name: en('menuMotions.categoryPlaces') })).toBeVisible();
    await expect(page.getByRole('heading', { name: en('menuMotions.place.category', { name: 'Coffee' }) })).toBeVisible();

    await page.getByRole('link', { name: `${en('menuMotions.choose')}: ${en('menuMotions.place.hero')}` }).click();
    // The first visit to the editor compiles it on a dev server: give it more than the usual wait.
    await expect(page).toHaveURL(new RegExp(`/studio/menus/${menu.menuId}/motion/hero$`), { timeout: 20_000 });
    await expect(page.getByText(en('menuMotions.editor.pickFirst'))).toBeVisible();

    // The place offers the picture motions only: a micro-interaction is not among them.
    await page.getByRole('searchbox', { name: en('menuMotions.editor.search') }).fill('add to cart');
    await expect(page.getByText(en('menuMotions.editor.empty', { q: 'add to cart' }))).toBeVisible();
    await page.getByRole('searchbox', { name: en('menuMotions.editor.search') }).fill('golden');
    const card = page.getByRole('button', { name: new RegExp(en('motion.golden-particles.name')) });
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    // The pick plays in the place's own shape beside the list.
    await expect(page.getByRole('complementary', { name: en('menuMotions.editor.preview') }).locator('[data-motion="golden-particles"]')).toBeVisible();

    // The colour's code, beside its swatch (which has the same name).
    const colour = page.getByLabel(en('motion.param.color'), { exact: true }).and(page.locator(':not([type="color"])'));
    await colour.fill('#ff0000');
    await page.getByRole('button', { name: en('menuMotions.editor.save') }).click();

    await expect(page).toHaveURL(new RegExp(`/studio/menus/${menu.menuId}/motion$`));
    await expect(page.getByText(en('menuMotions.saved'))).toBeVisible();
    await expect(page.getByText(en('menus.unpublished'))).toBeVisible();
    await expect(page.getByRole('link', { name: `${en('menuMotions.change')}: ${en('menuMotions.place.hero')}` })).toBeVisible();

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText(/^Published as revision \d+$/).first()).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/${menu.slug}/en`);
    const hero = guest.locator('[data-motion-slot="hero"] [data-motion="golden-particles"]');
    await expect(hero).toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
    await expect(guest.locator('[data-motion-slot="hero"]')).toHaveAttribute('aria-hidden', 'true');

    const still = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
    await still.goto(`/${menu.slug}/en`);
    await expect(still.locator('[data-motion-slot="hero"] [data-motion="golden-particles"]')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
  });

  test('passes axe on the tab and its editor in Arabic', async ({ browser }) => {
    test.slow();
    const ar = getStudioTranslator('ar');
    const page = await signedIn(browser, 'ar');
    await page.goto(`/studio/menus/${menu.menuId}/motion`);
    await expect(page.getByRole('heading', { name: ar('menuMotions.menuPlaces'), exact: true })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.goto(`/studio/menus/${menu.menuId}/motion/hero`);
    // One motion in the list, so axe reads the editor's structure rather than waiting on thirty previews.
    await page.getByRole('searchbox', { name: ar('menuMotions.editor.search') }).fill(ar('motion.golden-particles.name'));
    await page.getByRole('button', { name: new RegExp(ar('motion.golden-particles.name')) }).click();
    await expect(page.getByRole('button', { name: ar('menuMotions.editor.save') })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
