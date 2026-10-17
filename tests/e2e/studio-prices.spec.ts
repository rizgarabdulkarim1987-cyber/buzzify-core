import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Prices tab (spec 10.3, 13.4) on a temporary menu (one category, "Coffee", with "Espresso" at 3.00 USD): a price
 * edited in its cell, and a bulk change previewed and applied to a category.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile('en') });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('the Prices tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('edits a price in its cell, then adds 10% to a category from a preview', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/prices`);

    const cell = page.getByLabel(en('prices.cell', { name: 'Espresso' }));
    await expect(cell).toHaveValue('3.00');
    await cell.fill('3.25');
    const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
    await cell.press('Enter');
    await saved;
    await page.reload();
    await expect(page.getByLabel(en('prices.cell', { name: 'Espresso' }))).toHaveValue('3.25');

    await page.getByLabel(en('prices.category')).selectOption({ label: 'Coffee' });
    await page.getByRole('button', { name: en('prices.bulk.open') }).click();
    const dialog = page.getByRole('dialog', { name: en('prices.bulk.title') });
    await dialog.getByLabel(en('prices.bulk.operation')).selectOption('percent');
    await dialog.getByLabel(en('prices.bulk.percent')).fill('10');
    await dialog.getByRole('button', { name: en('prices.bulk.preview') }).click();
    const preview = dialog.getByRole('table', { name: en('prices.bulk.previewCaption') });
    await expect(preview.getByRole('row').filter({ hasText: 'Espresso' })).toContainText('3.25');
    await expect(preview.getByRole('row').filter({ hasText: 'Espresso' })).toContainText('3.60');
    await dialog.getByRole('button', { name: en('prices.bulk.apply') }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel(en('prices.cell', { name: 'Espresso' }))).toHaveValue('3.60');
    await expect(page.getByText(en('menus.unpublished'))).toBeVisible();
  });
});
