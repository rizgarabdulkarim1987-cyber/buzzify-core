import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { Locale } from '@/lib/locale';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The QR tab (spec 10.8) on a temporary menu: codes for tables, a look checked for scanners as it is chosen, a PNG of
 * the asked size and every table's code in one ZIP; axe on the tab in Arabic.
 */

const en = getStudioTranslator('en');
const ar = getStudioTranslator('ar');

async function signedIn(browser: Browser, locale: Locale = 'en'): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile(locale), acceptDownloads: true });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('the QR tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('makes table codes, checks a look for scanners, and downloads a PNG and the ZIP', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/qr`);
    await expect(page.getByText(en('qr.emptyTitle'))).toBeVisible();

    await page.getByRole('button', { name: en('qr.forTables') }).click();
    const tables = page.getByRole('dialog', { name: en('qr.tablesTitle') });
    await tables.getByLabel(en('qr.from')).fill('1');
    await tables.getByLabel(en('qr.to')).fill('3');
    await tables.getByRole('button', { name: en('qr.tablesConfirm') }).click();
    await expect(page.getByText(en('qr.tablesDone', { count: 3, formatted: '3' }))).toBeVisible();
    await expect(page.getByRole('list', { name: en('qr.listLabel') }).getByRole('listitem')).toHaveCount(3);

    // A code too pale for scanners keeps Save off and says why.
    const colour = page.getByLabel(en('qr.colour.foreground'), { exact: true });
    await colour.fill('#C8C4BC');
    await expect(page.getByRole('alert').filter({ hasText: en('error.text.qrContrast') })).toBeVisible();
    const save = page.getByRole('button', { name: en('qr.save') });
    await expect(save).toBeDisabled();
    await colour.fill('#1B1A19');
    await page.getByLabel(en('qr.frameText')).fill('Scan for the menu');
    await expect(page.getByText(en('qr.unsaved'))).toBeVisible();
    await save.click();
    await expect(page.getByText(en('qr.saved'))).toBeVisible();
    await expect(page.getByText(en('qr.unsaved'))).toBeHidden();

    await page.getByLabel(en('qr.pngSize')).selectOption('2048');
    const png = page.waitForEvent('download');
    await page.getByRole('button', { name: en('qr.downloadPng') }).click();
    const pngFile = await png;
    expect(pngFile.suggestedFilename()).toBe(`${menu.slug}-table-1.png`);
    expect((await sharp(await pngFile.path()).metadata()).width).toBe(2048);

    const zip = page.waitForEvent('download');
    await page.getByRole('button', { name: en('qr.downloadTables') }).click();
    expect((await zip).suggestedFilename()).toBe(`${menu.slug}-table-codes.zip`);
  });

  test('has no serious accessibility problems in Arabic', async ({ browser }) => {
    const page = await signedIn(browser, 'ar');
    await page.goto(`/studio/menus/${menu.menuId}/qr`);
    await page.getByRole('button', { name: ar('qr.new') }).click();
    const dialog = page.getByRole('dialog', { name: ar('qr.newTitle') });
    await dialog.getByLabel(ar('qr.label')).fill('ملصق الواجهة');
    await dialog.getByRole('button', { name: ar('qr.newConfirm') }).click();
    await expect(page.getByRole('heading', { name: 'ملصق الواجهة' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
