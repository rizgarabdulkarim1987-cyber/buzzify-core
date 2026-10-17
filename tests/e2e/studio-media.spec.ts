import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, useNewestAssetInProduct, type TemporaryMenu } from './helpers/db';
import { assignMember, createStudioUser, hideDevTools, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The media library (spec 11) as a designer of a temporary restaurant: two pictures dropped in, described in Arabic,
 * filed in a folder and found by it; an SVG with a script stored without it; an animated GIF refused with the reason;
 * a picture a product uses kept, with a link to its menu. Axe on the library in Arabic.
 */

const en = getStudioTranslator('en');
const ar = getStudioTranslator('ar');

async function signIn(browser: Browser, person: StudioUser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
  await hideDevTools(context);
  const page = await context.newPage();
  await page.goto('/studio/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/studio$/);
  return page;
}

test.describe('the media library @desktop', () => {
  let menu: TemporaryMenu;
  let designer: StudioUser;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
    designer = await createStudioUser({ label: 'media-designer', name: 'Mia Media' });
    await assignMember(designer.userId, menu.restaurantId, 'DESIGNER');
  });

  test.afterEach(async () => {
    await menu.remove();
    await removeStudioUsers([designer.email]);
  });

  test('uploads, describes, files and finds pictures, cleans an SVG, refuses a GIF, and keeps a used picture', async ({ browser }) => {
    test.slow();
    const page = await signIn(browser, designer);
    await page.getByRole('navigation', { name: en('nav.label') }).getByRole('link', { name: en('nav.media') }).click();
    await expect(page).toHaveURL(/\/studio\/media/);
    await expect(page.getByRole('heading', { level: 1, name: en('media.library.title') })).toBeVisible();

    const grid = page.getByRole('list', { name: en('media.library.grid') });
    const upload = page.getByLabel(en('media.library.upload'));
    await upload.setInputFiles(['tests/e2e/fixtures/lemon.png', 'tests/e2e/fixtures/logo.png']);
    await expect(grid.getByRole('listitem')).toHaveCount(2, { timeout: 30_000 });

    // Described in Arabic and filed under Drinks.
    await grid.getByRole('button').first().click();
    const details = page.getByRole('region', { name: en('media.details.title') });
    await details.getByLabel(en('media.details.alt', { language: en('menus.language.ar') })).fill('ليمون');
    await details.getByLabel(en('media.details.folder')).fill('Drinks');
    await details.getByRole('button', { name: en('media.details.save') }).click();
    await expect(page.getByText(en('media.details.saved'))).toBeVisible();
    await page.getByLabel(en('media.library.folder')).selectOption('Drinks');
    await expect(grid.getByRole('listitem')).toHaveCount(1);
    await page.getByLabel(en('media.library.folder')).selectOption('');
    await expect(grid.getByRole('listitem')).toHaveCount(2);

    // An SVG with a script is stored, and the file served has none.
    await upload.setInputFiles('tests/e2e/fixtures/evil.svg');
    await expect(grid.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });
    await grid.getByRole('button', { name: /SVG/ }).click();
    const original = await details.getByRole('link', { name: en('media.details.open') }).getAttribute('href');
    const served = await (await page.request.get(original!)).text();
    expect(served).toContain('<svg');
    expect(served).not.toMatch(/<script|onload|onclick|foreignObject/i);

    // An animated GIF is refused, with the reason beside its name.
    await upload.setInputFiles('tests/e2e/fixtures/anim.gif');
    await expect(page.getByRole('status').filter({ hasText: 'anim.gif' })).toContainText(en('media.refusal.TYPE'));
    await expect(grid.getByRole('listitem')).toHaveCount(3);

    // A picture a product uses is kept, and the panel links to the menu that uses it.
    const used = await useNewestAssetInProduct(menu.menuId);
    await page.reload();
    await grid.getByRole('button').filter({ has: page.locator(`[data-asset-id="${used}"]`) }).click();
    await expect(details.getByRole('link', { name: /Espresso/ })).toHaveAttribute('href', `/studio/menus/${menu.menuId}`);
    await details.getByRole('button', { name: en('media.details.delete') }).click();
    await page.getByRole('dialog').getByRole('button', { name: en('media.details.deleteConfirm') }).click();
    await expect(page.getByRole('dialog')).toContainText(en('error.text.mediaInUse'));
  });

  test('has no serious accessibility problems in Arabic', async ({ browser }) => {
    await setUserLocale(designer.userId, 'ar');
    const page = await signIn(browser, designer);
    await page.goto(`/studio/restaurants/${menu.restaurantId}/media`);
    await page.getByLabel(ar('media.library.upload')).setInputFiles('tests/e2e/fixtures/lemon.png');
    const grid = page.getByRole('list', { name: ar('media.library.grid') });
    await expect(grid.getByRole('listitem')).toHaveCount(1, { timeout: 30_000 });
    await grid.getByRole('button').first().click();
    await expect(page.getByRole('region', { name: ar('media.details.title') })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
