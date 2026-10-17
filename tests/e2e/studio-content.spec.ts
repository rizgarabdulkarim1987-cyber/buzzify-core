import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Locale } from '@/lib/locale';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdmin, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Content tab (spec 10.3): categories and products added, edited in the product drawer, reordered from the keyboard,
 * a picture uploaded in place, a save refused because someone saved first, and axe on the tab and the drawer in Arabic.
 * Each test works on a temporary menu of its own (one category, "Coffee", with one product, "Espresso").
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser, locale: Locale = 'en'): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
    storageState: superAdminFile(locale),
  });
  await hideDevTools(context);
  return context.newPage();
}

/** One of a text's inputs in the drawer or a dialog: "Name (Arabic)". */
const inLanguage = (t: typeof en, field: string, locale: Locale) => t('content.inLanguage', { field, language: t(`menus.language.${locale}`) });

test.describe('the Content tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('adds a category and a product, edits it in the drawer, reorders and uploads a picture', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}`);

    await page.getByRole('button', { name: en('content.addCategory') }).first().click();
    const addCategory = page.getByRole('dialog', { name: en('content.addCategoryTitle') });
    await addCategory.getByLabel(inLanguage(en, en('content.name'), 'en')).fill('Cold drinks');
    await addCategory.getByRole('button', { name: en('content.addCategory') }).click();
    const cold = page.getByRole('region', { name: 'Cold drinks' });
    await expect(cold).toBeVisible();

    await cold.getByRole('button', { name: en('content.addProduct') }).click();
    const addProduct = page.getByRole('dialog', { name: en('content.addProductTitle') });
    await addProduct.getByLabel(inLanguage(en, en('content.name'), 'en')).fill('Lemonade');
    await addProduct.getByLabel(en('content.price')).fill('3.50');
    await addProduct.getByRole('button', { name: en('content.addProduct') }).click();

    // The new product opens in the drawer: its Arabic and Sorani names are written right to left.
    const drawer = page.getByRole('dialog', { name: 'Lemonade', exact: true });
    const arabic = drawer.getByLabel(inLanguage(en, en('content.name'), 'ar'));
    const sorani = drawer.getByLabel(inLanguage(en, en('content.name'), 'ckb'));
    await expect(arabic).toHaveAttribute('dir', 'rtl');
    await expect(sorani).toHaveAttribute('dir', 'rtl');
    await arabic.fill('ليموناضة');
    await sorani.fill('لیمۆناتە');
    await drawer.getByRole('button', { name: en('content.sizes.add') }).click();
    await drawer.getByLabel(inLanguage(en, en('content.sizes.name', { n: 1 }), 'en')).fill('Large');
    await drawer.getByLabel(en('content.sizes.delta', { n: 1 })).fill('+1.00');
    await drawer.getByRole('button', { name: en('common.save') }).click();
    await expect(drawer).toBeHidden();

    const lemonade = cold.getByRole('listitem').filter({ hasText: 'Lemonade' });
    await expect(lemonade).toContainText('3.50');
    await expect(page.getByText(en('menus.unpublished'))).toBeVisible();

    // Cold drinks moves above Coffee from the keyboard, and stays there.
    const categories = page.getByRole('list', { name: en('content.categories') });
    await expect(categories.getByRole('heading', { level: 2 })).toHaveText(['Coffee', 'Cold drinks']);
    // Each key waits for the step before it to land, as a person would: picked up (the handle is pressed), then moved.
    const handle = page.getByRole('button', { name: en('content.reorder', { name: 'Cold drinks' }) });
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText(en('content.dnd.over', { name: 'Cold drinks', position: 1, count: 2 }));
    // The drop shows the new order at once; the reload waits for the Server Action that saves it.
    const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
    await page.keyboard.press('Space');
    await expect(categories.getByRole('heading', { level: 2 })).toHaveText(['Cold drinks', 'Coffee']);
    await saved;
    await page.reload();
    await expect(categories.getByRole('heading', { level: 2 })).toHaveText(['Cold drinks', 'Coffee']);

    // A picture uploaded in the drawer shows in the list once saved.
    await lemonade.getByRole('button', { name: 'Lemonade', exact: true }).click();
    const again = page.getByRole('dialog', { name: 'Lemonade', exact: true });
    await again.getByLabel(en('content.media.upload')).setInputFiles('tests/e2e/fixtures/lemon.png');
    await again.getByRole('button', { name: en('content.media.uploadStart') }).click();
    await expect(again.getByRole('list', { name: en('content.media.title') }).getByRole('listitem')).toHaveCount(1, { timeout: 20_000 });
    await again.getByRole('button', { name: en('common.save') }).click();
    await expect(again).toBeHidden();
    await expect(lemonade.locator('img')).toHaveAttribute('src', /\S/);
  });

  test("refuses a save after someone else's, and names them", async ({ browser }) => {
    // Two people, each in a browser of their own, open the same product.
    test.slow();
    const ar = getStudioTranslator('ar');
    const first = await signedIn(browser);
    const second = await signedIn(browser, 'ar');
    await first.goto(`/studio/menus/${menu.menuId}`);
    await second.goto(`/studio/menus/${menu.menuId}`);

    await first.getByRole('button', { name: 'Espresso', exact: true }).click();
    const mine = first.getByRole('dialog', { name: 'Espresso', exact: true });
    await mine.getByLabel(inLanguage(en, en('content.name'), 'en')).fill('Ristretto');

    await second.getByRole('button', { name: 'Espresso', exact: true }).click();
    const theirs = second.getByRole('dialog', { name: 'Espresso', exact: true });
    await theirs.getByLabel(inLanguage(ar, ar('content.name'), 'en')).fill('Lungo');
    await theirs.getByRole('button', { name: ar('common.save') }).click();
    await expect(theirs).toBeHidden();

    await mine.getByRole('button', { name: en('common.save') }).click();
    await expect(mine.getByRole('alert')).toContainText(superAdmin(superAdminFile('ar')).name);
    await expect(mine.getByRole('button', { name: en('content.drawer.reload') })).toBeVisible();
  });

  test('passes axe on the tab and the drawer in Arabic', async ({ browser }) => {
    const ar = getStudioTranslator('ar');
    const page = await signedIn(browser, 'ar');
    await page.goto(`/studio/menus/${menu.menuId}`);
    await expect(page.getByRole('list', { name: ar('content.categories') })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Espresso', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Espresso', exact: true })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
