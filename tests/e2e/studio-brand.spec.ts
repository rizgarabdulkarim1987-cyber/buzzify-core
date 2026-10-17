import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Locale } from '@/lib/locale';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Brand tab (spec 12) on a temporary menu: a preset, the live contrast check, a logo with palettes suggested from it,
 * a font pair, then what guests get after a publish; axe on the tab in Arabic.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser, locale: Locale = 'en'): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile(locale) });
  await hideDevTools(context);
  return context.newPage();
}

test.describe('the Brand tab @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('sets a palette, a logo and a pair, and guests get them after a publish', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/brand`);

    await page.getByRole('radiogroup', { name: en('brand.theme') }).getByRole('radio', { name: en('brand.theme.light') }).check();
    await page.getByRole('button', { name: en('brand.preset.coffee') }).click();

    // A text colour that cannot be read on the background keeps Save off and says why.
    const text = page.getByLabel(en('brand.colour.text'), { exact: true });
    const original = await text.inputValue();
    await text.fill('#999999');
    const save = page.getByRole('button', { name: en('brand.save') });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: en('brand.pair.text/bg') })).toBeVisible();
    await text.fill(original);
    await expect(save).toBeEnabled();

    // A logo, palettes suggested from it, the first one applied.
    await page.getByLabel(en('brand.logo.upload')).setInputFiles('tests/e2e/fixtures/logo.png');
    await expect(page.getByRole('img', { name: en('brand.logo.current') })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: en('brand.suggest') }).click();
    const suggestions = page.getByRole('list', { name: en('brand.suggestions') });
    await expect(suggestions.getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
    await suggestions.getByRole('button', { name: en('brand.suggestion.apply', { n: 1 }) }).click();
    const background = await page.getByLabel(en('brand.colour.bg'), { exact: true }).inputValue();

    await page.getByRole('radio', { name: /^Café/ }).check();
    await save.click();
    await expect(page.getByText(en('brand.saved'))).toBeVisible();
    await expect(page.getByText(en('menus.unpublished'))).toBeVisible();

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText(/^Published as revision \d+$/).first()).toBeVisible();

    // A guest's first visit: a fresh browser, so the fonts it downloads are this page's alone.
    const guest = await (await browser.newContext()).newPage();
    const fonts: string[] = [];
    guest.on('response', (response) => {
      if (response.request().resourceType() === 'font') fonts.push(new URL(response.url()).pathname);
    });
    await guest.goto(`/${menu.slug}/en`, { waitUntil: 'networkidle' });
    await guest.evaluate(() => document.fonts.ready);
    await expect(guest.locator('html')).toHaveAttribute('data-theme', 'light');
    const bg = await guest.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    expect(bg.toLowerCase()).toBe(background.toLowerCase());
    await expect(guest.getByTestId('brand').locator('img')).toBeVisible();
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((path) => /fraunces|dm_sans/i.test(path)), fonts.join(', ')).toBe(true);
  });

  test('passes axe on the tab in Arabic', async ({ browser }) => {
    const ar = getStudioTranslator('ar');
    const page = await signedIn(browser, 'ar');
    await page.goto(`/studio/menus/${menu.menuId}/brand`);
    await expect(page.getByRole('button', { name: ar('brand.save') })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
