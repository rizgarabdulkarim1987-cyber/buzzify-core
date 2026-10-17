import { expect, test, type Browser, type Page } from '@playwright/test';
import { seriousViolations } from './helpers/axe';
import { expectGuestView } from './helpers/guest';
import { menuBySlug, removeMenus, removeRestaurants, removeRestaurantsNamed, SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * A menu's life through the Studio's pages, as a Super Admin (the one the setup project saved, so nothing signs in again;
 * their sign-ins are rate limited): a restaurant is created, ATELIER is duplicated into it, published and opened by a
 * guest, given a new address (the old one, and every page under it, redirects for good), suspended and restored,
 * archived and deleted, after which its addresses answer 404 and can never be taken again. The names and addresses are
 * unique per run (`e2e-bistro-…`, then `e2e-bistro-…-2`): a retired address stays retired, and the app caches what an
 * address opens for up to 5 minutes. Everything it makes is removed afterwards, by those names and addresses only.
 */

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: SUPER_ADMIN_FILE });
  return context.newPage();
}

/** Picks an item of the menu's "Manage" menu once the page has hydrated, which a loaded machine may still be doing. */
async function manage(page: Page, item: string) {
  const menu = page.getByRole('menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Manage' }).click();
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass();
  await menu.getByRole('menuitem', { name: item }).click();
}

test.describe('Studio menus @desktop', () => {
  const random = Math.random().toString(36).slice(2, 8);
  const restaurantName = `E2E Bistro ${random}`;
  const name = `Bistro Menu ${random}`;
  const slug = `e2e-bistro-${random}`;
  const renamed = `${slug}-2`;
  const menuIds: string[] = [];
  const restaurantIds: string[] = [];

  test.afterAll(async () => {
    // Menus first: a restaurant goes only without them. Removed by name too, for a run that stopped before the
    // restaurant's id was known.
    await removeMenus({ slugs: [slug, renamed], menuIds });
    await removeRestaurants(restaurantIds);
    await removeRestaurantsNamed([restaurantName]);
  });

  test('a menu is duplicated, published, renamed, suspended, archived and deleted, and its addresses stay retired', async ({ browser }) => {
    test.setTimeout(120_000);
    const atelier = await menuBySlug('atelier');
    const page = await freshPage(browser);

    // A new restaurant in Erbil, made through the Studio.
    await page.goto('/studio/restaurants/new');
    await page.getByLabel('Name', { exact: true }).fill(restaurantName);
    await page.getByLabel('Type', { exact: true }).selectOption('RESTAURANT');
    await page.getByLabel('City').fill('Erbil');
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page).toHaveURL(/\/studio\/restaurants\/(?!new$)[^/]+$/);
    const restaurantId = /\/studio\/restaurants\/([^/?]+)/.exec(page.url())![1]!;
    restaurantIds.push(restaurantId);
    await expect(page.getByRole('heading', { level: 1, name: restaurantName })).toBeVisible();
    await expect(page.getByLabel('Type', { exact: true })).toHaveValue('RESTAURANT');
    await expect(page.getByLabel('City')).toHaveValue('Erbil');

    // Duplicate ATELIER into it.
    await page.goto(`/studio/menus/${atelier.id}`);
    await expect(page.getByRole('heading', { level: 1, name: atelier.name })).toBeVisible();
    await manage(page, 'Duplicate');
    const duplicate = page.getByRole('dialog', { name: `Duplicate ${atelier.name}` });
    await expect(duplicate.getByText('Inactive categories, rules and bundles are not copied')).toBeVisible();
    await duplicate.getByLabel('Name of the copy').fill(name);
    await duplicate.getByLabel('Address').fill(slug);
    await duplicate.getByLabel('Restaurant').selectOption(restaurantId);
    await expect(duplicate.getByText('Available')).toBeVisible();
    await duplicate.getByRole('button', { name: 'Duplicate' }).click();

    // The copy's own page: ATELIER's address matches the same pattern, so wait for the copy's heading first.
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const menuId = /\/studio\/menus\/([^/?]+)$/.exec(new URL(page.url()).pathname)![1]!;
    expect(menuId).not.toBe(atelier.id);
    menuIds.push(menuId);
    await expect(page.getByRole('link', { name: restaurantName, exact: true })).toBeVisible();
    await expect(page.getByText('Not published yet', { exact: true })).toBeVisible();
    // After a client-side navigation the title follows the page; axe checks it.
    await expect(page).toHaveTitle(new RegExp(name));
    expect(await seriousViolations(page)).toEqual([]);

    // Publish it: guests find ATELIER's dishes at the new address.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog', { name: `Publish ${name}?` }).getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published as revision 1').first()).toBeVisible();
    const warnings = page.getByRole('dialog', { name: 'Published as revision 1' });
    if (await warnings.isVisible()) await warnings.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByText(/^Live: revision 1, /)).toBeVisible();
    const guest = await browser.newPage();
    await guest.goto(`/${slug}/en`);
    await expect(guest.getByTestId('brand')).toHaveText('ATELIER');
    await expect(guest.getByTestId('product-row').filter({ hasText: 'Atelier Burger' }).first()).toBeVisible();
    await guest.goto(`/${slug}/en/p/atelier-burger`);
    await expect(guest.getByRole('heading', { level: 1, name: 'Atelier Burger' })).toBeVisible();

    // The list finds it by its address.
    await page.goto(`/studio/menus?q=${slug}`);
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(name);
    await expect(rows.nth(1)).toContainText(restaurantName);
    await expect(rows.nth(1)).toContainText('Erbil');
    await expect(rows.nth(1)).toContainText('Published');
    await expect(page).toHaveTitle(/All menus/);
    expect(await seriousViolations(page)).toEqual([]);
    await rows.nth(1).getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // A new address: the old one, and every page under it, answers a permanent redirect to the same page there.
    await manage(page, 'Change address');
    const change = page.getByRole('dialog', { name: `Change the address of ${name}?` });
    await change.getByLabel('Address').fill(renamed);
    await expect(change.getByText('Available')).toBeVisible();
    await change.getByRole('button', { name: 'Change address' }).click();
    await expect(page.getByText('Address changed')).toBeVisible();
    await expect(page.getByText(`/${slug}`, { exact: true })).toBeVisible();
    const redirect = await page.request.get(`/${slug}/en?x=1`, { maxRedirects: 0 });
    expect(redirect.status()).toBe(308);
    expect(redirect.headers()['location']).toBe(`/${renamed}/en?x=1`);
    await guest.goto(`/${slug}/en/cart`);
    await expect(guest).toHaveURL(new RegExp(`/${renamed}/en/cart$`));
    await expect(guest.locator('main')).toBeVisible();

    // Suspended: guests get the unavailable page at once; restored: the menu again.
    await manage(page, 'Suspend');
    await page.getByRole('dialog', { name: `Suspend ${name}?` }).getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('Menu suspended')).toBeVisible();
    await expectGuestView(guest, `/${renamed}/en`, 'unavailable');
    await manage(page, 'Restore');
    await page.getByRole('dialog', { name: `Restore ${name}?` }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Menu restored')).toBeVisible();
    await expectGuestView(guest, `/${renamed}/en`, 'menu');
    await expect(guest.getByTestId('brand')).toHaveText('ATELIER');
    await guest.context().close();

    // Archived, then deleted with its name typed exactly.
    await manage(page, 'Archive');
    await page.getByRole('dialog', { name: `Archive ${name}?` }).getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('Menu archived')).toBeVisible();
    await expect(page.getByText('This menu is archived.')).toBeVisible();
    await manage(page, 'Delete menu');
    const remove = page.getByRole('dialog', { name: `Delete ${name}?` });
    const confirm = remove.getByLabel(`Type ${name} to confirm`);
    await confirm.fill(name.toLowerCase());
    await remove.getByRole('button', { name: 'Delete menu' }).click();
    await expect(confirm).toHaveAccessibleDescription('Type the menu name exactly to confirm');
    await confirm.fill(name);
    await remove.getByRole('button', { name: 'Delete menu' }).click();
    await expect(page).toHaveURL(/\/studio\/menus$/);
    await expect(page.getByText('Menu deleted')).toBeVisible();

    // Both addresses are gone for guests, and reserved for good: New menu refuses them.
    for (const path of [`/${renamed}/en`, `/${slug}/en`, `/${slug}/en/cart`]) {
      expect((await page.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
    await page.goto('/studio/menus/new');
    const address = page.getByLabel('Address');
    for (const taken of [renamed, slug]) {
      await address.fill(taken);
      await expect(page.getByText('This address is taken')).toBeVisible();
      await expect(address).toHaveAccessibleDescription('This address is taken');
    }
    await page.context().close();
  });
});
