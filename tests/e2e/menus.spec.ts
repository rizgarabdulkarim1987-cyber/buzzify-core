import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  createTestRestaurant,
  menuBySlug,
  removeMenus,
  removeRestaurants,
  SUPER_ADMIN_FILE,
  uniqueClientAddress,
  type TestRestaurant,
} from './helpers/studio';

/**
 * A menu's life through the Studio's pages, as a Super Admin (the one the setup project saved, so nothing signs in again;
 * their sign-ins are rate limited): ATELIER is duplicated into a new restaurant, published and opened by a guest, given
 * a new address (the old one redirects for good), suspended and restored, archived and deleted, after which its
 * addresses answer 404 and can never be taken again. Everything it makes is removed afterwards.
 */

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: SUPER_ADMIN_FILE });
  return context.newPage();
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
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

const unavailable = async (page: Page, path: string) => (await (await page.request.get(path)).text()).includes('data-testid="menu-unavailable"');

test.describe('Studio menus @desktop', () => {
  const random = Math.random().toString(36).slice(2, 8);
  const slug = `e2e-bistro-${random}`;
  const renamed = `${slug}-new`;
  const name = `E2E Bistro ${random}`;
  const menuIds: string[] = [];
  let restaurant: TestRestaurant | undefined;

  test.afterAll(async () => {
    await removeMenus({ slugs: [slug, renamed], menuIds });
    if (restaurant) await removeRestaurants([restaurant.id]);
  });

  test('a menu is duplicated, published, renamed, suspended, archived and deleted, and its addresses stay retired', async ({ browser }) => {
    test.setTimeout(90_000);
    restaurant = await createTestRestaurant('Bistro');
    const atelier = await menuBySlug('atelier');
    const page = await freshPage(browser);

    // Duplicate ATELIER into the new restaurant.
    await page.goto(`/studio/menus/${atelier.id}`);
    await expect(page.getByRole('heading', { level: 1, name: atelier.name })).toBeVisible();
    await manage(page, 'Duplicate');
    const duplicate = page.getByRole('dialog', { name: `Duplicate ${atelier.name}` });
    await expect(duplicate.getByText('Inactive categories, rules and bundles are not copied')).toBeVisible();
    await duplicate.getByLabel('Name of the copy').fill(name);
    await duplicate.getByLabel('Address').fill(slug);
    await duplicate.getByLabel('Restaurant').selectOption(restaurant.id);
    await expect(duplicate.getByText('Available')).toBeVisible();
    await duplicate.getByRole('button', { name: 'Duplicate' }).click();

    // The copy's own page: ATELIER's address matches the same pattern, so wait for the copy's heading first.
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const menuId = /\/studio\/menus\/([^/?]+)$/.exec(new URL(page.url()).pathname)![1]!;
    expect(menuId).not.toBe(atelier.id);
    menuIds.push(menuId);
    await expect(page.getByRole('link', { name: restaurant.name })).toBeVisible();
    await expect(page.getByText('Not published yet.')).toBeVisible();
    // After a client-side navigation the title follows the page; axe checks it.
    await expect(page).toHaveTitle(new RegExp(name));
    expect(await seriousViolations(page)).toEqual([]);

    // Publish it: guests see it at its address.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog', { name: `Publish ${name}?` }).getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published as revision 1').first()).toBeVisible();
    const warnings = page.getByRole('dialog', { name: 'Published as revision 1' });
    if (await warnings.isVisible()) await warnings.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
    const guest = await browser.newPage();
    await guest.goto(`/${slug}/en`);
    await expect(guest.getByTestId('brand')).toHaveText('ATELIER');
    await guest.close();

    // The list finds it by its address.
    await page.goto(`/studio/menus?q=${slug}`);
    const rows = page.getByRole('table').getByRole('row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText(name);
    await expect(rows.nth(1)).toContainText(restaurant.name);
    await expect(rows.nth(1)).toContainText('Published');
    await expect(page).toHaveTitle(/All menus/);
    expect(await seriousViolations(page)).toEqual([]);
    await rows.nth(1).getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    // A new address: the old one answers a permanent redirect to it.
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

    // Suspended: guests get the unavailable page at once; restored: the menu again.
    await manage(page, 'Suspend');
    await page.getByRole('dialog', { name: `Suspend ${name}?` }).getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('Menu suspended')).toBeVisible();
    expect(await unavailable(page, `/${renamed}/en`)).toBe(true);
    await manage(page, 'Restore');
    await page.getByRole('dialog', { name: `Restore ${name}?` }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Menu restored')).toBeVisible();
    expect(await unavailable(page, `/${renamed}/en`)).toBe(false);

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

    // Both addresses are gone for guests, and reserved for good.
    for (const path of [`/${renamed}/en`, `/${slug}/en`]) {
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
