import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { MENU_STYLES } from '@/studio/styles/catalog';
import { TEMPLATE_FOR_STYLE } from '@/studio/styles/template-map';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Styles filter in the Templates gallery (docs/superpowers/specs/2026-10-26-menu-styles-in-templates-design.md):
 * all 35 picked styles in catalog order; every one is an ordinary template (preview, apply, customize).
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

  test('shows the 35 styles, every one an ordinary template', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    const cards = page.locator('ul[data-styles] > li');
    await expect(cards).toHaveCount(35);
    await expect(page.getByText(en('design.filter.stylesCount_other', { count: 36 }))).toBeVisible();
    // Every catalog style maps to a template, so none is coming soon (the coming-soon path stays for a future style).
    expect(Object.keys(TEMPLATE_FOR_STYLE)).toHaveLength(MENU_STYLES.length);
    await expect(cards.getByText(en('design.comingSoon'), { exact: true })).toHaveCount(0);
    // Catalog order: the first style is the Kurdish theme, a real template card.
    const first = cards.first().getByRole('button');
    await expect(first).toHaveAccessibleName(en('design.select', { name: 'Jajim and Nowruz' }));
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

  test('previews The Elevator as an ordinary template and offers to apply it', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    const card = page.getByRole('button', { name: en('design.select', { name: 'The Elevator' }) });
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(en('design.comingSoonPreview'))).toHaveCount(0);
    await expect(page.locator('aside iframe')).toHaveAttribute('src', /template=the-elevator/);
    await expect(page.getByRole('button', { name: en('design.apply'), exact: true })).toBeVisible();
  });

  test('leaving Styles with a style chosen keeps previewing a template, never a mockup', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await openStyles(page);
    await page.getByRole('button', { name: en('design.select', { name: 'The Elevator' }) }).click();
    await expect(page.locator('aside iframe')).toHaveAttribute('src', /template=the-elevator/);
    await page.getByRole('button', { name: en('design.filter.styles'), exact: true }).click();
    await expect(page.getByText(en('design.comingSoonPreview'))).toHaveCount(0);
    await expect(page.locator('aside iframe')).not.toHaveAttribute('src', /style-files/);
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
