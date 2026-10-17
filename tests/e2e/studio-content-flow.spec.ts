import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { getStudioTranslator } from '@/studio/messages';
import { qrScans } from './helpers/db';
import { hideDevTools, removeMenus, removeRestaurantsNamed, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * From a spreadsheet to a published menu (spec 16), as a Super Admin: a restaurant and an IQD menu made in the Studio,
 * twelve products imported from a sheet with Arabic and Sorani names, the Fast food look, a publish, a price changed and
 * published again, and table QR codes whose printed address opens the table, counts the scan and survives a new address.
 * Everything it made is removed afterwards; the names carry a random part so runs never share an address.
 */

const en = getStudioTranslator('en');
const random = Math.random().toString(36).slice(2, 8);
const RESTAURANT = `E2E Grill ${random}`;
const SLUG = `e2e-grill-${random}`;
const RENAMED = `${SLUG}-new`;
const menuIds: string[] = [];

const serverAction = (page: Page) => page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);

async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/^Published as revision \d+/).first()).toBeVisible();
  // Published with warnings (descriptions missing in a language), the dialog stays open to list them.
  const warnings = page.getByRole('dialog', { name: /^Published as revision \d+$/ });
  if (await warnings.isVisible()) {
    await warnings.getByRole('button', { name: 'Close' }).last().click();
    await expect(warnings).toBeHidden();
  }
}

/** What a phone's camera reads from a downloaded PNG. */
async function decode(file: string): Promise<string> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (!code) throw new Error(`no QR code in ${file}`);
  return code.data;
}

test.describe('from a spreadsheet to a published menu @desktop', () => {
  test.afterAll(async () => {
    await removeMenus({ slugs: [SLUG, RENAMED], menuIds });
    await removeRestaurantsNamed([RESTAURANT]);
  });

  test('imports, brands, publishes, reprices and prints table codes that follow the menu', async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile('en'), acceptDownloads: true });
    await hideDevTools(context);
    const page = await context.newPage();
    const guest = await browser.newPage();

    // A fast-food restaurant in Erbil, and its menu in dinars and three languages.
    await page.goto('/studio/restaurants/new');
    await page.getByLabel('Name', { exact: true }).fill(RESTAURANT);
    await page.getByLabel('Type', { exact: true }).selectOption('FAST_FOOD');
    await page.getByLabel('City').fill('Erbil');
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page).toHaveURL(/\/studio\/restaurants\/(?!new$)[^/]+$/);
    const restaurantId = /\/studio\/restaurants\/([^/?]+)/.exec(page.url())![1]!;

    await page.goto('/studio/menus/new');
    await page.getByLabel(en('menus.form.restaurant')).selectOption(restaurantId);
    await page.getByLabel(en('menus.form.name'), { exact: true }).fill('E2E Grill');
    await page.getByLabel('Address').fill(SLUG);
    await expect(page.getByText('Available')).toBeVisible();
    await page.getByLabel(en('menus.form.currency')).selectOption('IQD');
    await page.getByRole('button', { name: en('menus.form.create') }).click();
    await expect(page).toHaveURL(/\/studio\/menus\/(?!new$)[^/]+$/);
    const menuId = /\/studio\/menus\/([^/?]+)/.exec(page.url())![1]!;
    menuIds.push(menuId);

    // Twelve products from the sheet.
    await page.goto(`/studio/menus/${menuId}/data`);
    await page.getByLabel(en('data.import.choose')).setInputFiles('tests/e2e/fixtures/e2e-grill.csv');
    await page.getByRole('button', { name: en('data.import.read') }).click();
    await expect(page.getByRole('table', { name: en('data.preview.caption') }).getByRole('row')).toHaveCount(13);
    await page.getByRole('button', { name: en('data.preview.apply') }).click();
    await expect(page.getByText(en('data.applied', { created: '12', changed: '0' }))).toBeVisible();

    // The Fast food look: dark, its preset, the Street pair.
    await page.goto(`/studio/menus/${menuId}/brand`);
    await page.getByRole('radiogroup', { name: en('brand.theme') }).getByRole('radio', { name: en('brand.theme.dark') }).check();
    await page.getByRole('button', { name: en('brand.preset.fastFood') }).click();
    await page.getByRole('radio', { name: /^Street/ }).check();
    await page.getByRole('button', { name: en('brand.save') }).click();
    await expect(page.getByText(en('brand.saved'))).toBeVisible();

    await publish(page);
    const smash = () => guest.getByTestId('product-row').filter({ hasText: 'Smash burger' }).first();
    await guest.goto(`/${SLUG}`);
    await expect(guest).toHaveURL(new RegExp(`/${SLUG}/en$`));
    await expect(guest.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(smash()).toContainText('9,000');

    // A new price, live after the next publish.
    await page.goto(`/studio/menus/${menuId}/prices`);
    const cell = page.getByLabel(en('prices.cell', { name: 'Smash burger' }));
    await cell.fill('9,500');
    const saved = serverAction(page);
    await cell.press('Enter');
    await saved;
    await publish(page);
    await guest.goto(`/${SLUG}/en`);
    await expect(smash()).toContainText('9,500');

    // Codes for tables 1 to 3; table 1's PNG, read the way a phone would, opens table 1 and counts as a scan.
    await page.goto(`/studio/menus/${menuId}/qr`);
    await page.getByRole('button', { name: en('qr.forTables') }).click();
    const tables = page.getByRole('dialog', { name: en('qr.tablesTitle') });
    await tables.getByLabel(en('qr.from')).fill('1');
    await tables.getByLabel(en('qr.to')).fill('3');
    await tables.getByRole('button', { name: en('qr.tablesConfirm') }).click();
    await expect(page.getByRole('list', { name: en('qr.listLabel') }).getByRole('listitem')).toHaveCount(3);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: en('qr.downloadPng') }).click();
    const printed = await decode(await (await download).path());
    expect(printed).toMatch(new RegExp(`/${SLUG}/t/1\\?qr=`));
    const code = new URL(printed).searchParams.get('qr')!;

    const scanned = guest.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`/api/${SLUG}/events`));
    await guest.goto(printed);
    await expect(guest).toHaveURL(new RegExp(`/${SLUG}/en/t/1$`));
    await scanned;
    await expect.poll(() => qrScans(code)).toBe(1);
    await page.reload();
    await expect(page.getByRole('list', { name: en('qr.listLabel') }).getByRole('listitem').first()).toContainText(en('qr.scans', { count: 1, formatted: '1' }));

    // A new address for the menu: the printed code still opens table 1, at the new address.
    await page.goto(`/studio/menus/${menuId}`);
    const menu = page.getByRole('menu');
    await expect(async () => {
      if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Manage' }).click();
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass();
    await menu.getByRole('menuitem', { name: 'Change address' }).click();
    const change = page.getByRole('dialog', { name: /^Change the address of / });
    await change.getByLabel('Address').fill(RENAMED);
    await expect(change.getByText('Available')).toBeVisible();
    await change.getByRole('button', { name: 'Change address' }).click();
    await expect(page.getByText('Address changed')).toBeVisible();
    await guest.goto(printed);
    await expect(guest).toHaveURL(new RegExp(`/${RENAMED}/en/t/1$`));

    await guest.close();
    await context.close();
  });
});
