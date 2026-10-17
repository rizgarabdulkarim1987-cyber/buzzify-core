import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Locale } from '@/lib/locale';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Import and export tab (spec 13) on a temporary menu ("Espresso" at 3.00 USD): the draft exported, a sheet that
 * changes a price and adds a product in a new category previewed and applied, then seen in the Prices tab; axe on the
 * preview in Arabic.
 */

const en = getStudioTranslator('en');
const ar = getStudioTranslator('ar');

async function signedIn(browser: Browser, locale: Locale = 'en'): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile(locale), acceptDownloads: true });
  await hideDevTools(context);
  return context.newPage();
}

/** The sheet a person sends back: Espresso at a new price, and a new product in a new category. */
const sheet = (productSlug: string) =>
  Buffer.from(
    ['category_slug,category_en,product_slug,name_en,name_ar,price', `coffee,,${productSlug},Espresso,إسبريسو,3.50`, 'milk-drinks,Milk drinks,,Flat white,فلات وايت,4.25'].join('\r\n'),
  );

test.describe('the Import and export tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('exports the draft, then previews and applies a sheet', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/data`);

    const csv = page.waitForEvent('download');
    await page.getByRole('button', { name: en('data.export.csv') }).click();
    const exported = await csv;
    expect(exported.suggestedFilename()).toBe(`${menu.slug}-menu.csv`);
    const text = (await readFile(await exported.path())).toString('utf8');
    expect(text.split('\r\n')[1]).toContain(`,${menu.productSlug},Espresso,`);

    await page.getByLabel(en('data.import.choose')).setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: sheet(menu.productSlug) });
    await page.getByRole('button', { name: en('data.import.read') }).click();
    const rows = page.getByRole('table', { name: en('data.preview.caption') });
    await expect(rows.getByRole('row')).toHaveCount(3);
    await expect(rows.getByRole('row', { name: /Espresso/ })).toContainText('3.50 USD');
    await expect(rows.getByRole('row', { name: /Flat white/ })).toContainText(en('data.statusName.new'));
    await expect(page.getByText(en('data.preview.newCategories'))).toBeVisible();

    await page.getByRole('button', { name: en('data.preview.apply') }).click();
    await expect(page.getByText(en('data.applied', { created: '1', changed: '1' }))).toBeVisible();

    await page.goto(`/studio/menus/${menu.menuId}/prices`);
    await expect(page.getByLabel(en('prices.cell', { name: 'Espresso' }))).toHaveValue('3.50');
    await expect(page.getByLabel(en('prices.cell', { name: 'Flat white' }))).toHaveValue('4.25');
  });

  test('names a wrong column, and has no serious accessibility problems in Arabic', async ({ browser }) => {
    const page = await signedIn(browser, 'ar');
    await page.goto(`/studio/menus/${menu.menuId}/data`);
    const choose = page.getByLabel(ar('data.import.choose'));
    await choose.setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: Buffer.from('category_slug,name_en,colour\ncoffee,Espresso,red\n') });
    await page.getByRole('button', { name: ar('data.import.read') }).click();
    await expect(page.getByText(ar('data.columns.unknownColumns', { columns: 'colour' }))).toBeVisible();

    await choose.setInputFiles({ name: 'menu.csv', mimeType: 'text/csv', buffer: sheet(menu.productSlug) });
    await page.getByRole('button', { name: ar('data.import.read') }).click();
    await expect(page.getByRole('table', { name: ar('data.preview.caption') })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
