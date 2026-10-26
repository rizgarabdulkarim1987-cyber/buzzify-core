import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Styles filter in the Templates gallery (docs/superpowers/specs/2026-10-26-menu-styles-in-templates-design.md):
 * all 35 picked styles in catalog order; the three that are real are ordinary templates, the other 32 are coming-soon
 * cards with their mockup in the preview and no way to apply.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile('en') });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('the Styles filter in the Templates gallery @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  async function openStyles(page: Page) {
    await page.goto(`/studio/menus/${menu.menuId}/design`);
    await expect(page.getByRole('heading', { name: en('design.gallery.title') })).toBeVisible();
    const chip = page.getByRole('button', { name: en('design.filter.styles'), exact: true });
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  }

  test('shows the 35 styles, three as templates and the rest as coming soon', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    const cards = page.locator('ul[data-styles] > li');
    await expect(cards).toHaveCount(35);
    await expect(page.getByText(en('design.filter.stylesCount_other', { count: 35 }))).toBeVisible();
    // Coming-soon cards say so in text, on every one of the 32.
    await expect(cards.getByText(en('design.comingSoon'), { exact: true })).toHaveCount(32);
    // Catalog order: the first style is a coming-soon card (the Kurdish theme), with its poster from the private route.
    const first = cards.first().getByRole('button');
    await expect(first).toHaveAccessibleName(en('design.selectSoon', { name: en('styles.themed-kurd.name') }));
    await expect(first.locator('img')).toHaveAttribute('src', '/studio/style-files/poster/themed-kurd');
  });

  test('previews The Book with the menu’s own products and applies it', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    await page.getByRole('button', { name: en('design.select', { name: 'The Book' }) }).click();
    const frame = page.frameLocator('aside iframe');
    await expect(frame.getByText('Espresso').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: en('design.apply'), exact: true }).click();
    await expect(page.getByText(en('design.applied')).first()).toBeVisible();
    await expect(page.getByRole('button', { name: en('design.customize') })).toBeVisible();
  });

  test('a coming-soon card shows its mockup and offers no apply', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    const card = page.getByRole('button', { name: en('design.selectSoon', { name: en('styles.layout-elv.name') }) });
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(en('design.comingSoonPreview'))).toBeVisible();
    await expect(page.locator('aside iframe')).toHaveAttribute('src', '/studio/style-files/page/layout?style=elv');
    await expect(page.getByRole('button', { name: en('design.apply'), exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: en('design.customize') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: en('design.duplicate') })).toHaveCount(0);
  });

  test('switching the body in Customize swaps the preview, and the knobs the shape sets say so', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    await page.getByRole('button', { name: en('design.select', { name: 'The Book' }) }).click();
    await page.getByRole('button', { name: en('design.apply'), exact: true }).click();
    await page.getByRole('button', { name: en('design.customize') }).click();
    const body = page.getByLabel(en('design.layout.body'));
    await expect(body).toHaveValue('book');
    await expect(page.getByText(en('design.setByShape', { shape: en('design.body.book') })).first()).toBeVisible();
    await expect(page.locator('aside iframe')).toHaveAttribute('src', /template=the-book/);
    await body.selectOption('scroll');
    await expect(page.getByText(en('design.setByShape', { shape: en('design.body.book') }))).toHaveCount(0);
    await body.selectOption('board');
    await expect(page.getByText(en('design.setByShape', { shape: en('design.body.board') })).first()).toBeVisible();
  });
});
