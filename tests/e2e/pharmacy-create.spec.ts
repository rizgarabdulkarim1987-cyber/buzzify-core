import { expect, test, type Browser, type Page } from '@playwright/test';
import { removeRestaurants, removeRestaurantsNamed, SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * A Super Admin (the one the setup project saved) creates a pharmacy with two branches from the Pharmacy space's new
 * pharmacy form and finds it in the Pharmacy list, and in no Menu and Cashier list. Everything it makes is removed afterwards.
 */

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: SUPER_ADMIN_FILE });
  return context.newPage();
}

test.describe('Studio pharmacy creation @desktop', () => {
  const ids: string[] = [];
  const names: string[] = [];

  test.afterAll(async () => {
    await removeRestaurants(ids.splice(0));
    await removeRestaurantsNamed(names.splice(0));
  });

  test('a Super Admin creates a pharmacy with two branches and sees it in the list', async ({ browser }) => {
    const page = await freshPage(browser);
    const name = `E2E Pharmacy ${Math.random().toString(36).slice(2, 8)}`;
    names.push(name);

    // Menu and Cashier makes food restaurants only: no sector to choose, no branches or currencies on the form.
    await page.goto('/studio/restaurants/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New restaurant' })).toBeVisible();
    await expect(page.getByLabel('Sector')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Branches' })).toHaveCount(0);

    await page.goto('/studio/pharmacy/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New pharmacy' })).toBeVisible();
    await expect(page.getByLabel('Sector')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Branches' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Currencies' })).toBeVisible();
    // A pharmacy has no restaurant type.
    await expect(page.getByLabel('Type', { exact: true })).toHaveCount(0);

    await page.getByLabel('Name', { exact: true }).fill(name);
    // The branch needs a name: the refusal is said and nothing is made.
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page.getByLabel('Branch 1: name')).toHaveAccessibleDescription('Enter the branch name');

    await page.getByLabel('Branch 1: name').fill('Main branch');
    await page.getByLabel('Branch 1: city').fill('Erbil');
    await page.getByRole('button', { name: 'Add a branch' }).click();
    await page.getByLabel('Branch 2: name').fill('Ankawa branch');
    await page.getByLabel('Iraqi dinar (IQD)').check();
    await page.getByLabel('US dollar (USD)').check();
    await page.getByRole('button', { name: 'Create restaurant' }).click();

    await expect(page).toHaveURL(/\/studio\/pharmacy\/(?!new$)[^/]+$/);
    ids.push(/\/studio\/pharmacy\/([^/?]+)/.exec(page.url())![1]!);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    // A pharmacy has no menu, plan or media tabs; it keeps its branches.
    const tabs = page.getByRole('navigation', { name: 'Restaurant sections' });
    await expect(tabs.getByRole('link', { name: 'Branches' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Menus' })).toHaveCount(0);
    await expect(tabs.getByRole('link', { name: 'Plan' })).toHaveCount(0);
    await tabs.getByRole('link', { name: 'Branches' }).click();
    await expect(page.getByText('Main branch')).toBeVisible();
    await expect(page.getByText('Ankawa branch')).toBeVisible();

    // The Pharmacy list shows it, and the Menu and Cashier list does not.
    await page.goto('/studio/pharmacy');
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
    await page.goto(`/studio/restaurants?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });
});
