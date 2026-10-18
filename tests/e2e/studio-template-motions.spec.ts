import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * Templates and motions (docs/superpowers/specs/2026-10-18-template-motions-design.md) on a temporary menu whose one
 * category is "Coffee": a designer looks at Obsidian Gold in the Design tab and its preview already plays its motions,
 * applies it, finds them marked as the template's in the Motion tab, publishes, and a guest's template menu plays them.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile('en') });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('template motions @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('a template brings its motions, in the preview, the Motion tab and the published menu', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/design`);
    await page.getByRole('button', { name: en('design.select', { name: 'Obsidian Gold' }) }).click();

    // Before it is applied, the preview shows what applying it would give.
    const frame = page.frameLocator('iframe[title*="Obsidian Gold"]').first();
    await expect(frame.locator('[data-motion-slot="backdrop"] [data-motion="golden-particles"]')).toBeAttached({ timeout: 30_000 });
    await expect(frame.locator('[data-motion-slot="category"] [data-motion="coffee-steam"]')).toBeAttached();

    await page.getByRole('button', { name: en('design.apply') }).click();
    await expect(page.getByText(en('design.applied'))).toBeVisible({ timeout: 15_000 });

    await page.goto(`/studio/menus/${menu.menuId}/motion`);
    await expect(page.getByText(en('menuMotions.suggestedBy', { template: 'Obsidian Gold' })).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(en('menuMotions.place.hero.templateHint'))).toBeVisible();

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText(/^Published as revision \d+$/).first()).toBeVisible();

    const guest = await (await browser.newContext()).newPage();
    await guest.goto(`/${menu.slug}/en`);
    await expect(guest.locator('[data-template="obsidian-gold"]')).toBeVisible();
    await expect(guest.locator('[data-motion-slot="backdrop"] [data-motion="golden-particles"]')).toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
    await expect(guest.locator('[data-motion-slot="category"] [data-motion="coffee-steam"]')).toBeAttached({ timeout: 15_000 });

    // The template's pause button holds them still.
    await guest.getByRole('button', { name: 'Pause background motion' }).click();
    await expect(guest.locator('[data-motion-slot="backdrop"] [data-motion="golden-particles"]')).toHaveAttribute('data-playing', 'false');
  });
});
