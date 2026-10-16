import { expect, test, type Browser, type Page } from '@playwright/test';
import { seriousViolations } from './helpers/axe';
import { createTemporaryMenu } from './helpers/db';
import {
  assignMember,
  createStudioUser,
  createTestRestaurant,
  inviteOwner,
  removeRestaurants,
  removeRestaurantsNamed,
  removeStudioUsers,
  SUPER_ADMIN_FILE,
  superAdmin,
  uniqueClientAddress,
  uniquePassword,
  type TestRestaurant,
} from './helpers/studio';

/**
 * The Restaurants area, through the pages a person uses: a Super Admin creates, edits, adds a branch and finds the
 * restaurant in the list; a refused save names who got there first; status and delete; and what a designer (in Arabic)
 * and an owner are shown. The signed-in Super Admin is the one the setup project saved, so nothing signs in again as
 * them (their sign-ins are rate limited). Everything these tests make is removed afterwards.
 */

async function freshPage(browser: Browser, options: { signedIn?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() },
    ...(options.signedIn ? { storageState: SUPER_ADMIN_FILE } : {}),
  });
  return context.newPage();
}

/** Opens the "Manage" menu once the page has hydrated, which a loaded machine may still be doing after the load. */
async function openManage(page: Page, label = 'Manage') {
  const menu = page.getByRole('menu');
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByRole('button', { name: label }).click();
    await expect(menu).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** Whether a guest opening the menu's address now gets the unavailable page. */
const guestUnavailable = async (page: Page, slug: string) =>
  (await (await page.request.get(`/${slug}/en`)).text()).includes('data-testid="menu-unavailable"');

const restaurantIdOf = (page: Page) => /\/studio\/restaurants\/([^/?]+)/.exec(page.url())![1]!;

test.describe('Studio restaurants @desktop', () => {
  const restaurants: string[] = [];
  const restaurantNames: string[] = [];
  const people: string[] = [];
  const cleanups: Array<() => Promise<void>> = [];

  // With fullyParallel, a worker runs this hook after each batch of these tests it is given, and the lists live as long
  // as the worker: each run takes what is listed now (so nothing is removed twice), and every removal is idempotent.
  test.afterAll(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
    await removeRestaurantsNamed(restaurantNames.splice(0));
  });

  async function made(label: string, extra: { city?: string } = {}): Promise<TestRestaurant> {
    const restaurant = await createTestRestaurant(label, extra);
    restaurants.push(restaurant.id);
    return restaurant;
  }

  test('a Super Admin creates a restaurant, edits it, adds a branch and finds it in the list', async ({ browser }) => {
    const page = await freshPage(browser, { signedIn: true });
    const name = `E2E Mazo ${Math.random().toString(36).slice(2, 8)}`;
    // Removed by name too: a run that stops before the restaurant's address is known still leaves nothing behind.
    restaurantNames.push(name);

    await page.goto('/studio/restaurants/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New restaurant' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Nothing is made without a name, and the refusal takes focus.
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveAccessibleDescription('Enter the restaurant name');
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused();

    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Type', { exact: true }).selectOption('BAKERY');
    await page.getByLabel('City').fill('Zakho');
    await page.getByLabel('Phone').fill('+964 750 123 4567');
    await page.getByRole('button', { name: 'Add hours on Monday' }).click();
    await page.getByRole('button', { name: 'Create restaurant' }).click();

    // The new restaurant opens on its profile, with its client ID.
    await expect(page).toHaveURL(/\/studio\/restaurants\/(?!new$)[^/]+$/);
    const id = restaurantIdOf(page);
    restaurants.push(id);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const clientId = (await page.getByText(/^BZ-\d{4,}$/).first().textContent())!;
    expect(clientId).toMatch(/^BZ-\d{4,}$/);
    await expect(page.getByLabel('City')).toHaveValue('Zakho');
    await expect(page.getByLabel('Opens at', { exact: false }).first()).toHaveValue('09:00');

    // Editing saves with the version the form was opened at; a refused field stays marked and focused.
    await page.getByLabel('Phone').fill('call me');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('Phone')).toHaveAccessibleDescription('Use digits, spaces, + ( ) and - only');
    await expect(page.getByLabel('Phone')).toBeFocused();

    await page.getByLabel('Phone').fill('+964 750 123 4567');
    await page.getByLabel('Description').fill('Fresh bread every morning');
    await page.getByLabel('Instagram').fill('https://instagram.com/mazo');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Restaurant saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Description')).toHaveValue('Fresh bread every morning');
    await expect(page.getByLabel('Instagram')).toHaveValue('https://instagram.com/mazo');
    expect(await seriousViolations(page)).toEqual([]);

    // A branch is added in a dialog and listed.
    const tabs = page.getByRole('navigation', { name: 'Restaurant sections' });
    await tabs.getByRole('link', { name: 'Branches' }).click();
    await expect(page.getByText('No branches yet')).toBeVisible();
    await page.getByRole('button', { name: 'Add branch' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New branch' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByLabel('Branch name')).toHaveAccessibleDescription('Enter the branch name');
    await dialog.getByLabel('Branch name').fill('Old Town');
    await dialog.getByLabel('Address').fill('4 Bazaar Road');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Branch added')).toBeVisible();
    await expect(page.getByRole('list').getByText('Old Town')).toBeVisible();
    await expect(page.getByText('4 Bazaar Road')).toBeVisible();

    // The activity tab tells the story, from the creation on.
    await tabs.getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByRole('cell', { name: 'Created the restaurant' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Edited the profile' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Added a branch' })).toBeVisible();

    // The list finds it by name, and by its client ID however it is typed.
    await page.goto('/studio/restaurants');
    expect(await seriousViolations(page)).toEqual([]);
    const search = page.getByRole('searchbox', { name: 'Search restaurants' });
    for (const query of [name.toLowerCase(), clientId.toLowerCase().replace('-', ''), clientId]) {
      await search.fill(query);
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows).toHaveCount(2); // the header and the restaurant
      await expect(rows.nth(1)).toContainText(name);
      await expect(rows.nth(1)).toContainText(clientId);
      await expect(rows.nth(1)).toContainText('Bakery');
      await expect(rows.nth(1)).toContainText('Zakho');
    }
    await expect(page).toHaveURL(/[?&]q=BZ-\d+/);

    // Filters and sorting are in the address.
    await page.getByLabel('Type', { exact: true }).selectOption('CAFE');
    await expect(page).toHaveURL(/type=CAFE/);
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page).not.toHaveURL(/type=|q=/);
    await page.getByRole('button', { name: 'Name', exact: true }).click();
    await expect(page).toHaveURL(/sort=name&dir=desc/);
    await page.context().close();
  });

  test('a save that someone else got ahead of is refused, says who and when, and reloads their version', async ({ browser }) => {
    const restaurant = await made('Conflict');
    const first = await freshPage(browser, { signedIn: true });
    const second = await freshPage(browser, { signedIn: true });
    for (const page of [first, second]) {
      await page.goto(`/studio/restaurants/${restaurant.id}`);
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(restaurant.name);
    }

    await second.getByLabel('Name', { exact: true }).fill(`${restaurant.name} renamed`);
    await second.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(second.getByText('Restaurant saved')).toBeVisible();

    await first.getByLabel('Description').fill('Written from the older page');
    await first.getByRole('button', { name: 'Save', exact: true }).click();
    const alert = first.getByRole('alert').filter({ hasText: /Changed by .*Avin Studio.* on .*Reload to see their changes/ });
    await expect(alert).toBeVisible();

    // Reloading brings in the other version and starts the form again from it.
    await alert.getByRole('button', { name: 'Reload' }).click();
    await expect(first.getByLabel('Name', { exact: true })).toHaveValue(`${restaurant.name} renamed`);
    await expect(first.getByLabel('Description')).toHaveValue('');
    await first.context().close();
    await second.context().close();
  });

  test('suspending a restaurant takes its published menu off the public page at once, and restoring brings it back', async ({
    browser,
  }) => {
    const menu = await createTemporaryMenu();
    cleanups.push(() => menu.remove());
    const page = await freshPage(browser, { signedIn: true });

    // Visit the public page first, so the slug is in the cache the change has to expire.
    expect((await page.request.get(`/${menu.slug}/en`)).ok()).toBe(true);
    expect(await (await page.request.get(`/${menu.slug}/en`)).text()).not.toContain('data-testid="menu-unavailable"');

    await page.goto(`/studio/restaurants/${menu.restaurantId}`);
    await openManage(page);
    await page.getByRole('menuitem', { name: 'Suspend' }).click();
    const dialog = page.getByRole('dialog', { name: `Suspend ${menu.name}?` });
    await dialog.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('Restaurant suspended')).toBeVisible();
    await expect(page.getByText('This restaurant is suspended.')).toBeVisible();
    // The cached answer is expired at once; polled as menus.spec.ts explains (a guest load racing the change), well inside
    // the 5 minutes the address would otherwise keep its answer.
    await expect.poll(() => guestUnavailable(page, menu.slug)).toBe(true);

    await openManage(page);
    await page.getByRole('menuitem', { name: 'Restore' }).click();
    await page.getByRole('dialog', { name: `Restore ${menu.name}?` }).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Restaurant restored')).toBeVisible();
    await expect(page.getByText('This restaurant is suspended.')).toHaveCount(0);
    await expect.poll(() => guestUnavailable(page, menu.slug)).toBe(false);
    await page.context().close();
  });

  test('a restaurant is deleted only without menus and with its name typed exactly', async ({ browser }) => {
    const withMenu = await createTemporaryMenu();
    cleanups.push(() => withMenu.remove());
    const empty = await made('Delete me');
    const page = await freshPage(browser, { signedIn: true });

    // With a menu, it cannot go.
    await page.goto(`/studio/restaurants/${withMenu.restaurantId}`);
    await openManage(page);
    await page.getByRole('menuitem', { name: 'Delete restaurant' }).click();
    let dialog = page.getByRole('dialog', { name: `Delete ${withMenu.name}?` });
    await expect(dialog.getByText('A restaurant can be deleted only after all of its menus are.')).toBeVisible();
    await dialog.getByLabel(`Type ${withMenu.name} to confirm`).fill(withMenu.name);
    await dialog.getByRole('button', { name: 'Delete restaurant' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Delete all of its menus first' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // Without one, the name has to match.
    await page.goto(`/studio/restaurants/${empty.id}`);
    await openManage(page);
    await page.getByRole('menuitem', { name: 'Delete restaurant' }).click();
    dialog = page.getByRole('dialog', { name: `Delete ${empty.name}?` });
    const confirm = dialog.getByLabel(`Type ${empty.name} to confirm`);
    await confirm.fill(empty.name.toLowerCase());
    await dialog.getByRole('button', { name: 'Delete restaurant' }).click();
    await expect(confirm).toHaveAccessibleDescription('Type the restaurant name exactly to confirm');
    await expect(confirm).toBeFocused();
    await confirm.fill(` ${empty.name} `);
    await dialog.getByRole('button', { name: 'Delete restaurant' }).click();

    await expect(page).toHaveURL(/\/studio\/restaurants$/);
    await expect(page.getByText('Restaurant deleted')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search restaurants' }).fill(empty.name);
    await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    await page.goto(`/studio/restaurants/${empty.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.context().close();
  });

  test('a designer sees only their restaurant, in Arabic and right to left, without the controls they lack', async ({ browser }) => {
    const mine = await made('Mine');
    const theirs = await made('Theirs');
    const designer = await createStudioUser({ label: 'designer', name: 'Dana Designer', locale: 'ar' });
    people.push(designer.email);
    await assignMember(designer.userId, mine.id, 'DESIGNER');

    const page = await freshPage(browser);
    await page.goto('/studio/sign-in');
    await page.getByLabel('Email').fill(designer.email);
    await page.getByLabel('Password', { exact: true }).fill(designer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/studio$/);

    await page.goto('/studio/restaurants');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'المطاعم' })).toBeVisible();
    await expect(page.getByRole('link', { name: mine.name })).toBeVisible();
    await expect(page.getByRole('link', { name: theirs.name })).toHaveCount(0);
    // Nobody but a Super Admin makes a restaurant.
    await expect(page.getByRole('link', { name: 'مطعم جديد' })).toHaveCount(0);
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('link', { name: mine.name }).click();
    await expect(page.getByRole('heading', { level: 1, name: mine.name })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'أقسام المطعم' });
    await expect(tabs.getByRole('link')).toHaveText(['الملف', 'الفروع', 'القوائم']);
    // A designer edits the profile but neither suspends nor deletes.
    await expect(page.getByRole('button', { name: 'إدارة' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Another restaurant, and the tabs they may not have, are not found.
    await page.goto(`/studio/restaurants/${theirs.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'الصفحة غير موجودة' })).toBeVisible();
    await page.goto(`/studio/restaurants/${mine.id}/activity`);
    await expect(page.getByRole('heading', { level: 1, name: 'الصفحة غير موجودة' })).toBeVisible();
    await page.goto('/studio/restaurants/new');
    await expect(page.getByRole('heading', { level: 1, name: 'الصفحة غير موجودة' })).toBeVisible();
    await page.context().close();
  });

  test('an owner reads their restaurant but cannot change it, and does not see the tabs they lack', async ({ browser }) => {
    const restaurant = await made('Owned');
    const { email, url } = await inviteOwner(superAdmin().userId, restaurant.id);
    people.push(email);
    const page = await freshPage(browser);

    await page.goto(new URL(url).pathname);
    await page.getByLabel('Your name').fill('Hawre Owner');
    await page.getByLabel('Password', { exact: true }).fill(uniquePassword());
    await page.getByRole('button', { name: 'Create account' }).click();
    // An owner of one restaurant lands in it: with no menu yet, on its Menus tab, which their navigation opens too.
    await expect(page).toHaveURL(new RegExp(`/studio/restaurants/${restaurant.id}/menus$`));
    await expect(page.getByRole('navigation', { name: 'Studio' }).getByRole('link', { name: 'My restaurant' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: restaurant.name })).toBeVisible();
    await expect(page.getByText('No menus yet')).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Restaurant sections' });
    await expect(tabs.getByRole('link')).toHaveText(['Profile', 'Branches', 'Menus']);
    await expect(page.getByRole('button', { name: 'Manage' })).toHaveCount(0);

    await tabs.getByRole('link', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
    await tabs.getByRole('link', { name: 'Branches' }).click();
    await expect(page.getByRole('button', { name: 'Add branch' })).toHaveCount(0);

    // The agency's notes are not theirs to read, and the pages behind the tabs they lack are not found.
    await page.goto(`/studio/restaurants/${restaurant.id}/people`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.goto(`/studio/restaurants/${restaurant.id}/activity`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await page.context().close();
  });

  test('an address the Studio does not have shows the Studio’s own page, not the public menu’s', async ({ browser }) => {
    const page = await freshPage(browser, { signedIn: true });
    const response = await page.goto('/studio/no/such/page');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the Studio' })).toBeVisible();
    // The real pages next to it are still theirs.
    await page.goto('/studio/restaurants');
    await expect(page.getByRole('heading', { level: 1, name: 'Restaurants' })).toBeVisible();
    await page.context().close();
  });
});
