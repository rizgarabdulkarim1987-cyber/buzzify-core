import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import type { Locale } from '@/lib/locale';
import { getStudioTranslator } from '@/studio/messages';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { menuBySlug, superAdmin, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * The Studio in each of its languages: axe (WCAG 2.0 and 2.1, A and AA) on the sign-in page and on the pages a Super
 * Admin works in, with Arabic and Sorani right to left; All Menus used from the keyboard alone; and Jump to opened with
 * Ctrl+K and followed with Enter (in English that is in studio-platform.spec.ts). The signed-in Super Admins are the ones
 * the setup project saved, one per language, since the Studio speaks a signed-in person's own language. The texts come
 * from the Studio's catalogs, so each check reads what that language's reader sees.
 */

const LOCALES: readonly Locale[] = ['en', 'ar', 'ckb'];

async function signedIn(browser: Browser, locale: Locale): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
    storageState: superAdminFile(locale),
  });
  return context.newPage();
}

async function expectDirection(page: Page, locale: Locale) {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'en' ? 'ltr' : 'rtl');
}

/** Presses Tab (Shift+Tab going back) until `target` has focus, failing after `max` presses. */
async function tabTo(page: Page, target: Locator, { backwards = false, max = 80 } = {}) {
  for (let presses = 0; presses <= max; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`${target} did not take focus within ${max} presses of ${backwards ? 'Shift+Tab' : 'Tab'}`);
}

/**
 * Walks the page with Tab from its start and returns the controls of `main` that never took focus (none: `[]`), and
 * whether the ones that did took it in the order they appear in the page.
 */
async function unreachedControls(page: Page): Promise<{ missed: string[]; inOrder: boolean }> {
  const count = await page.locator('main').evaluate((main) => {
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const controls = [...main.querySelectorAll<HTMLElement>(selector)].filter((control) => control.getClientRects().length > 0);
    controls.forEach((control, index) => control.setAttribute('data-e2e-control', String(index)));
    return controls.length;
  });
  expect(count).toBeGreaterThan(0);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const visited: number[] = [];
  let entered = false;
  for (let presses = 0; presses < 200; presses++) {
    await page.keyboard.press('Tab');
    const index = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || !document.querySelector('main')?.contains(active)) return null;
      return Number(active.closest('[data-e2e-control]')?.getAttribute('data-e2e-control') ?? -1);
    });
    if (index === null) {
      if (entered) break;
      continue;
    }
    entered = true;
    if (index >= 0 && !visited.includes(index)) visited.push(index);
  }

  const missed = await page.evaluate(
    (seen) =>
      [...document.querySelectorAll<HTMLElement>('[data-e2e-control]')]
        .filter((control) => !seen.includes(Number(control.dataset.e2eControl)))
        .map((control) => `${control.tagName.toLowerCase()} "${control.getAttribute('aria-label') ?? control.textContent?.trim() ?? ''}"`),
    visited,
  );
  return { missed, inOrder: visited.every((index, position) => position === 0 || index > visited[position - 1]!) };
}

test.describe('Studio accessibility @desktop', () => {
  const temporary: TemporaryMenu[] = [];

  test.afterAll(async () => {
    for (const menu of temporary.splice(0)) await menu.remove();
  });

  for (const locale of LOCALES) {
    const t = getStudioTranslator(locale);

    test(`the sign-in page in ${locale}`, async ({ browser }) => {
      const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
      await context.addCookies([{ name: 'studio-locale', value: locale, url: 'http://127.0.0.1:3100/studio' }]);
      const page = await context.newPage();
      await page.goto('/studio/sign-in');
      await expectDirection(page, locale);
      await expect(page.getByRole('heading', { level: 1, name: t('auth.signIn.title') })).toBeVisible();
      await expect(page.getByRole('button', { name: t('auth.signIn.submit'), exact: true })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await context.close();
    });

    test(`Overview, Restaurants, All Menus, a menu and People in ${locale}`, async ({ browser }) => {
      test.setTimeout(60_000);
      const atelier = await menuBySlug('atelier');
      const page = await signedIn(browser, locale);
      for (const [path, heading] of [
        ['/studio', t('overview.welcome', { name: superAdmin(superAdminFile(locale)).name })],
        ['/studio/restaurants', t('restaurants.title')],
        ['/studio/menus', t('menus.title')],
        [`/studio/menus/${atelier.id}`, atelier.name],
        ['/studio/people', t('people.title')],
      ] as const) {
        await page.goto(path);
        await expectDirection(page, locale);
        await expect(page.getByRole('heading', { level: 1, name: heading }), path).toBeVisible();
        expect(await seriousViolations(page), `${path} in ${locale}`).toEqual([]);
      }
      await page.context().close();
    });

    test(`All Menus in ${locale} works from the keyboard alone`, async ({ browser }) => {
      test.setTimeout(60_000);
      // A menu of this test's own, so selecting it and opening the bulk actions touches nothing else.
      const menu = await createTemporaryMenu();
      temporary.push(menu);
      const page = await signedIn(browser, locale);
      await page.goto(`/studio/menus?q=${menu.slug}`);
      await expectDirection(page, locale);
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows).toHaveCount(2);

      // Tab from the top of the page reaches every control of the page (the filters, the column sorts, the row's
      // checkbox, links and actions), in the order they are shown.
      const { missed, inOrder } = await unreachedControls(page);
      expect(missed).toEqual([]);
      expect(inOrder).toBe(true);

      // Space selects the row; the bulk actions appear.
      const select = rows.nth(1).getByRole('checkbox', { name: t('common.selectRow') });
      await select.focus();
      await page.keyboard.press('Space');
      await expect(select).toBeChecked();
      await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
      const bulk = page.getByRole('region', { name: t('menus.bulk.label') });
      await expect(bulk).toContainText(t('menus.bulk.selected', { count: 1 }));
      expect(await seriousViolations(page)).toEqual([]);

      // The bulk actions sit above the table: Shift+Tab reaches them, Enter opens the chosen one, Escape closes it again
      // without doing anything and gives focus back.
      const publish = bulk.getByRole('button', { name: t('menus.bulk.action.publish'), exact: true });
      await tabTo(page, publish, { backwards: true });
      await page.keyboard.press('Enter');
      const confirm = page.getByRole('dialog', { name: t('menus.bulk.title.publish', { count: 1 }) });
      await expect(confirm).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(confirm).toBeHidden();
      await expect(publish).toBeFocused();

      // The row's own actions open with Enter too, and Escape gives focus back to their button.
      const { name } = await menuBySlug(menu.slug);
      const actions = rows.nth(1).getByRole('button', { name: t('menus.list.rowActions', { name }) });
      await tabTo(page, actions);
      await page.keyboard.press('Enter');
      const items = page.getByRole('menu');
      await expect(items.getByRole('menuitem', { name: t('menus.open') })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(items).toBeHidden();
      await expect(actions).toBeFocused();
      await page.context().close();
    });

    if (locale !== 'en') {
      test(`Jump to in ${locale}: Ctrl+K opens it, Enter opens the first result`, async ({ browser }) => {
        const page = await signedIn(browser, locale);
        await page.goto('/studio/menus');
        await expectDirection(page, locale);
        const dialog = page.getByRole('dialog', { name: t('common.jumpTo') });
        // Before the page has hydrated the shortcut does nothing, so it is pressed again.
        await expect(async () => {
          if (!(await dialog.isVisible())) await page.keyboard.press('Control+k');
          await expect(dialog).toBeVisible({ timeout: 1000 });
        }).toPass();
        await expect(dialog.getByRole('combobox')).toBeFocused();
        await page.keyboard.type('atel');
        const first = dialog.getByRole('option').first();
        await expect(first).toContainText('ATELIER');
        await expect(first).toHaveAttribute('aria-selected', 'true');
        expect(await seriousViolations(page)).toEqual([]);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/studio\/restaurants\/[^/]+$/);
        await expect(page.getByRole('heading', { level: 1, name: 'ATELIER' })).toBeVisible();
        await expect(dialog).toBeHidden();
        await page.context().close();
      });
    }
  }
});
