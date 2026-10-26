import { expect, test } from '@playwright/test';
import { SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * The separate Menu Styles area is gone: the styles live in the Templates gallery (Menus, Design). Its old addresses
 * lead to the menus, so a saved link or bookmark still lands somewhere useful.
 */
test.describe('the old Menu Styles addresses @desktop', () => {
  for (const path of ['/studio/styles', '/studio/styles/themed-book', '/studio/styles/nope']) {
    test(`${path} redirects to the menus`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: SUPER_ADMIN_FILE, extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
      const page = await context.newPage();
      await page.goto(path);
      await expect(page).toHaveURL(/\/studio\/menus$/);
    });
  }
});
