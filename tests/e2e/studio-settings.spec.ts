import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Settings tab (spec 10.3) on a temporary menu (USD, three languages, "Espresso" at 3.00): the name and an Arabic
 * search title saved, and a currency of other decimals that asks for a confirmation showing what a price becomes.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile('en') });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('the Settings tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('saves the name and a search title, and asks before converting prices to IQD', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/settings`);

    await page.getByLabel(en('menus.form.name'), { exact: true }).fill('Evening menu');
    const arabicTitle = page.getByLabel(en('content.inLanguage', { field: en('menuSettings.seo.pageTitle'), language: en('menus.language.ar') }));
    await expect(arabicTitle).toHaveAttribute('dir', 'rtl');
    await arabicTitle.fill('قائمة المساء');
    await page.getByRole('button', { name: en('menuSettings.save') }).click();
    await expect(page.getByText(en('menuSettings.saved'))).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(en('menus.form.name'), { exact: true })).toHaveValue('Evening menu');
    await expect(arabicTitle).toHaveValue('قائمة المساء');
    await expect(page.getByText(en('menus.unpublished'))).toBeVisible();

    await page.getByLabel(en('menus.form.currency')).selectOption('IQD');
    await expect(page.getByText(en('menuSettings.currency.example', { before: '4.50 USD', after: '5 IQD' }))).toBeVisible();
    const save = page.getByRole('button', { name: en('menuSettings.save') });
    await expect(save).toBeDisabled();
    await page.getByLabel(en('menuSettings.currency.confirm')).check();
    await save.click();
    await expect(page.getByText(/^Settings saved; 1 row of prices converted$/)).toBeVisible();
    await page.goto(`/studio/menus/${menu.menuId}/prices`);
    await expect(page.getByLabel(en('prices.cell', { name: 'Espresso' }))).toHaveValue('3');
  });
});
