import { expect, test, type Browser, type Page } from '@playwright/test';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import {
  atelierRestaurant,
  menuBySlug,
  OWNER_FILE,
  removeAuditRowsBy,
  restaurantPolicy,
  restoreRestaurantPolicy,
  SEEDED_OWNER_EMAIL,
  seededUser,
  SUPER_ADMIN_FILE,
  uniqueClientAddress,
} from './helpers/studio';

/**
 * The Studio as the seeded owner of ATELIER (owner@buzzify.test, signed in once by the setup project): they land in
 * ATELIER and see nothing of the platform, another restaurant's pages are not found, and they publish ATELIER, until a
 * Super Admin switches publishing off for ATELIER's owners. The policy is put back afterwards whatever happens, and the
 * audit rows the owner's publish wrote are removed; the new revision stays, as ATELIER's live menu, unchanged in content.
 */

async function pageAs(browser: Browser, file: string): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: file });
  return context.newPage();
}

/** Opens a dialog with its button once the page has hydrated (a click before that does nothing, so it is pressed again). */
async function openDialog(page: Page, button: string, dialogName: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: button, exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test.describe('Studio as an owner @desktop', () => {
  const temporary: TemporaryMenu[] = [];

  test.afterAll(async () => {
    for (const menu of temporary.splice(0)) await menu.remove();
  });

  test('the owner lands in ATELIER, sees none of the platform, and another restaurant is not found', async ({ browser }) => {
    // Another restaurant, with a published menu of its own, made for this test.
    const other = await createTemporaryMenu();
    temporary.push(other);
    const otherMenu = await menuBySlug(other.slug);
    const atelier = await menuBySlug('atelier');
    const restaurant = await atelierRestaurant();
    const page = await pageAs(browser, OWNER_FILE);

    // One restaurant with one menu: the Studio opens on that menu, and the navigation has that one item.
    await page.goto('/studio');
    await expect(page).toHaveURL(new RegExp(`/studio/menus/${atelier.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'ATELIER' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Studio' });
    await expect(nav.getByRole('link')).toHaveText(['My restaurant']);
    await expect(nav.getByRole('link', { name: 'My restaurant' })).toHaveAttribute('aria-current', 'page');
    for (const area of ['Overview', 'Restaurants', 'All menus', 'People', 'Activity', 'Settings']) {
      await expect(nav.getByRole('link', { name: area })).toHaveCount(0);
    }
    expect(await seriousViolations(page)).toEqual([]);

    // Their restaurant's tabs are only the ones they have.
    await page.goto(`/studio/restaurants/${restaurant.id}`);
    await expect(page.getByRole('heading', { level: 1, name: restaurant.name })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Restaurant sections' });
    await expect(tabs.getByRole('link')).toHaveText(['Profile', 'Branches', 'Menus', 'Plan']);
    await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0);

    // The platform's pages, and everything of the other restaurant, are not found.
    for (const path of [
      '/studio/settings',
      '/studio/activity',
      '/studio/people',
      `/studio/restaurants/${other.restaurantId}`,
      `/studio/restaurants/${other.restaurantId}/menus`,
      `/studio/menus/${otherMenu.id}`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' }), path).toBeVisible();
    }
    await page.context().close();
  });

  test('the owner works on what guests see now: their tabs, an item sold out at once, and no going back', async ({ browser }) => {
    const atelier = await menuBySlug('atelier');
    const page = await pageAs(browser, OWNER_FILE);
    await page.goto(`/studio/menus/${atelier.id}`);
    const tabs = page.getByRole('navigation', { name: 'Menu workspace' });
    await expect(tabs.getByRole('link')).toHaveText(['Content', 'Prices', 'Availability', 'Revisions', 'Preview']);
    // The tabs they do not have are not there to open either.
    for (const tab of ['brand', 'settings', 'qr', 'data']) {
      expect((await page.goto(`/studio/menus/${atelier.id}/${tab}`))?.status(), tab).toBe(404);
    }

    // Earl Grey (which no other suite reads) goes sold out with no publish, and comes back the same way.
    await page.goto(`/studio/menus/${atelier.id}/availability`);
    const soldOut = page.getByRole('switch', { name: 'Sold out: Earl Grey' });
    const guest = await browser.newPage();
    const row = () => guest.getByTestId('product-row').filter({ hasText: 'Earl Grey' }).first();
    await expect(soldOut).not.toBeChecked();
    try {
      const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
      await soldOut.click();
      await saved;
      await expect(soldOut).toBeChecked();
      await guest.goto('/atelier/en');
      // Guests read a product switched off as unavailable ("Sold out" is for a stock count that ran out).
      await expect(row()).toContainText('Unavailable right now');
    } finally {
      if (await soldOut.isChecked()) {
        const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
        await soldOut.click();
        await saved;
      }
    }
    await guest.goto('/atelier/en');
    await expect(row()).not.toContainText('Unavailable right now');
    await guest.close();

    // Revisions without going back, restoring or scheduling: those are for a designer or a Super Admin.
    await page.goto(`/studio/menus/${atelier.id}/revisions`);
    const history = page.getByRole('table', { name: 'Revisions of the menu' });
    await expect(history.getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Roll back' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restore to draft' })).toHaveCount(0);
    // The Manage menu, when the owner has one at all, offers no scheduling.
    const manage = page.getByRole('button', { name: 'Manage' });
    if ((await manage.count()) > 0) {
      await manage.click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Schedule publish…' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.context().close();
  });

  test('the owner publishes ATELIER, until a Super Admin switches publishing off for its owners', async ({ browser }) => {
    test.setTimeout(60_000);
    const restaurant = await atelierRestaurant();
    const atelier = await menuBySlug('atelier');
    const owner = await seededUser(SEEDED_OWNER_EMAIL);
    const policyBefore = await restaurantPolicy(restaurant.id);
    const since = new Date();
    const page = await pageAs(browser, OWNER_FILE);
    const admin = await pageAs(browser, SUPER_ADMIN_FILE);

    try {
      // Owners publish by default: the draft goes live as a new revision, published by them.
      await page.goto(`/studio/menus/${atelier.id}`);
      const publish = await openDialog(page, 'Publish', 'Publish ATELIER?');
      await publish.getByRole('button', { name: 'Publish' }).click();
      const done = page.getByText(/^Published as revision \d+$/).first();
      await expect(done).toBeVisible();
      const warnings = page.getByRole('dialog', { name: /^Published as revision \d+$/ });
      if (await warnings.isVisible()) await warnings.getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByText(new RegExp(`^Live: revision \\d+, .+, by ${owner.name}$`))).toBeVisible();

      // A Super Admin takes publishing away from ATELIER's owners on its People tab.
      await admin.goto(`/studio/restaurants/${restaurant.id}/people`);
      const ownersPublish = admin.getByRole('switch', { name: 'Owners: Publish', exact: true });
      await expect(ownersPublish).toBeChecked();
      await expect(async () => {
        if (await ownersPublish.isChecked()) await ownersPublish.click();
        await expect(ownersPublish).not.toBeChecked({ timeout: 1000 });
      }).toPass();
      await admin.getByRole('button', { name: 'Save permissions' }).click();
      await expect(admin.getByText('Permissions saved')).toBeVisible();

      // The owner's next page has no Publish button.
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'ATELIER' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    } finally {
      await restoreRestaurantPolicy(restaurant.id, policyBefore);
      await removeAuditRowsBy(owner.userId, since);
      await page.context().close();
      await admin.context().close();
    }
  });
});
