import { expect, test, type Browser, type Page } from '@playwright/test';
import { seriousViolations } from './helpers/axe';
import {
  bumpRestaurantVersion,
  createStudioUser,
  createTestRestaurant,
  menuBySlug,
  platformSettingRows,
  removeRestaurants,
  removeStudioUsers,
  restorePlatformSettings,
  SUPER_ADMIN_FILE,
  superAdmin,
  uniqueClientAddress,
  uniqueEmail,
  type TestRestaurant,
} from './helpers/studio';

/**
 * The platform screens, as a Super Admin (the one the setup project saved, so nothing signs in again): Jump to from the
 * keyboard, Overview, Settings that persist and show up in Activity, People with the restaurant picker, and a client's
 * permission switches with a refused stale save. Everything it makes is removed afterwards, and the platform settings
 * are put back as they were.
 */

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: SUPER_ADMIN_FILE });
  return context.newPage();
}

/** Opens Jump to with the shortcut once the page has hydrated (before that the key does nothing, so it is pressed again). */
async function openJump(page: Page, shortcut = 'Control+k') {
  const dialog = page.getByRole('dialog', { name: 'Jump to' });
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press(shortcut);
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

test.describe('Studio platform screens @desktop', () => {
  const random = Math.random().toString(36).slice(2, 8);
  const restaurants: string[] = [];
  const people: string[] = [];

  // With fullyParallel, a worker runs this hook after each batch of these tests it is given; each run takes what is
  // listed now, and the removals are idempotent. (The platform settings are put back by the test that changes them: a
  // snapshot taken here, in another worker, could be taken after that test's change and put it back for good.)
  test.afterAll(async () => {
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  async function made(label: string): Promise<TestRestaurant> {
    const restaurant = await createTestRestaurant(label);
    restaurants.push(restaurant.id);
    return restaurant;
  }

  test('Overview counts, and Jump to opens ATELIER from the keyboard and gives focus back', async ({ browser }) => {
    const page = await freshPage(browser);
    await page.goto('/studio');
    await expect(page.getByRole('heading', { level: 1, name: /^Welcome, / })).toBeVisible();
    for (const title of ['Restaurants', 'Menus', 'Menu views']) await expect(page.getByRole('region', { name: title })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Unpublished changes' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // Ctrl+K, type, Enter: the first result is the restaurant.
    const trigger = page.getByRole('button', { name: /Jump to/ });
    const dialog = await openJump(page);
    await dialog.getByRole('combobox').fill('atel');
    await expect(dialog.getByRole('option').first()).toContainText('ATELIER');
    await expect(dialog.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/studio\/restaurants\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ATELIER' })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // The arrow keys move on to the menu, which Enter opens.
    const again = await openJump(page);
    await again.getByRole('combobox').fill('atel');
    await expect(again.getByRole('option')).toHaveCount(2);
    await page.keyboard.press('ArrowDown');
    await expect(again.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    const atelier = await menuBySlug('atelier');
    await expect(page).toHaveURL(new RegExp(`/studio/menus/${atelier.id}$`));

    // Escape closes it without going anywhere, and the button has focus again.
    await openJump(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Jump to' })).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/studio/menus/${atelier.id}$`));

    // Cmd+K opens it too (the same key on a Mac).
    await openJump(page, 'Meta+k');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Jump to' })).toBeHidden();
    await page.context().close();
  });

  test('a setting is saved, persists, is refused for a word a menu uses, and shows in Activity', async ({ browser }) => {
    test.setTimeout(60_000);
    // Put back exactly as they were before this test, whatever else runs meanwhile.
    const settingsBefore = await platformSettingRows();
    try {
      const sender = `E2E Studio ${random}`;
      const word = `e2e-${random}`;
      const atelier = await menuBySlug('atelier');
      const page = await freshPage(browser);

      await page.goto('/studio/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(page).toHaveTitle(/Settings/);
      expect(await seriousViolations(page)).toEqual([]);

      await page.getByLabel('Sender name').fill(sender);
      await page.getByLabel('Reserved words').fill(`${word}\nCafé E2E ${random}`);
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByText('Settings saved')).toBeVisible();

      // What was saved is what comes back, with the words cleaned the way addresses are.
      await page.reload();
      await expect(page.getByLabel('Sender name')).toHaveValue(sender);
      await expect(page.getByLabel('Reserved words')).toHaveValue(`${word}\ncafe-e2e-${random}`);

      // A word that a menu already uses as its address is refused, and the menu is named.
      await page.getByLabel('Reserved words').fill('atelier');
      await page.getByRole('button', { name: 'Save settings' }).click();
      const refused = page.getByLabel('Reserved words');
      await expect(refused).toHaveAccessibleDescription(/is already the address of the menu/);
      await expect(refused).toHaveAccessibleDescription(new RegExp(atelier.name));
      await expect(refused).toBeFocused();

      // The change is in the log, with who made it.
      await page.goto('/studio/activity');
      await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
      await page.getByLabel('Action').selectOption('settings.updated');
      await expect(page).toHaveURL(/action=settings\.updated/);
      const rows = page.getByRole('table').getByRole('row');
      await expect(rows.nth(1)).toContainText('Changed the platform settings');
      await expect(rows.nth(1)).toContainText(superAdmin().name);
      await expect(rows.nth(1)).toContainText('Platform settings');
      expect(await seriousViolations(page)).toEqual([]);

      // The person who made it is found by name, and the day it was made narrows the log.
      await page.getByLabel('Person').click();
      await page.getByPlaceholder('Search').fill(superAdmin().name);
      await page.getByRole('option', { name: new RegExp(superAdmin().name) }).click();
      await expect(page).toHaveURL(/actor=/);
      await expect(rows.nth(1)).toContainText('Changed the platform settings');
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
      await page.getByLabel('From').fill(today);
      await expect(page).toHaveURL(new RegExp(`from=${today}`));
      await expect(rows.nth(1)).toContainText('Changed the platform settings');
      await page.getByLabel('Until').fill('2020-01-01');
      await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
      await page.context().close();
    } finally {
      await restorePlatformSettings(settingsBefore);
    }
  });

  test('People: the restaurant picker, links shown once, a designer assigned, an account switched off and on', async ({ browser }) => {
    test.setTimeout(90_000);
    const restaurant = await made('Picker');
    const designer = await createStudioUser({ label: 'designer', name: `E2E Designer ${random}` });
    const owner = uniqueEmail('owner-invite');
    const staff = uniqueEmail('staff-invite');
    const moved = uniqueEmail('designer-moved');
    people.push(designer.email, owner, staff, moved);
    const page = await freshPage(browser);

    await page.goto(`/studio/people?q=${encodeURIComponent(designer.name)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    const row = page.getByRole('row').filter({ hasText: designer.name });
    await expect(row).toContainText(designer.email);
    await expect(row).toContainText('No restaurant yet');

    const openActions = async (name: string, item: string) => {
      const menu = page.getByRole('menu');
      await expect(async () => {
        if (!(await menu.isVisible())) await page.getByRole('button', { name: `Actions for ${name}` }).click();
        await expect(menu).toBeVisible({ timeout: 1000 });
      }).toPass();
      await menu.getByRole('menuitem', { name: item }).click();
    };

    // Assign the designer: the restaurant is found by typing part of its name, never from a list of all of them.
    await openActions(designer.name, 'Assign to a restaurant');
    const assign = page.getByRole('dialog', { name: `Assign ${designer.name} as a designer` });
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign.getByLabel('Restaurant')).toHaveAccessibleDescription('Choose a restaurant');
    await expect(assign.getByLabel('Restaurant')).toBeFocused();
    await assign.getByLabel('Restaurant').click();
    await assign.getByRole('combobox').fill(restaurant.name);
    await assign.getByRole('option', { name: new RegExp(restaurant.name) }).click();
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Designer assigned')).toBeVisible();
    await expect(row).toContainText(`Designer · ${restaurant.name}`);

    // Deactivated and reactivated.
    await openActions(designer.name, 'Deactivate');
    await page.getByRole('dialog', { name: `Deactivate ${designer.name}?` }).getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText('Account deactivated')).toBeVisible();
    await expect(row).toContainText('Deactivated');
    await openActions(designer.name, 'Reactivate');
    await page.getByRole('dialog', { name: `Reactivate ${designer.name}?` }).getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByText('Account reactivated')).toBeVisible();
    await expect(row).not.toContainText('Deactivated');

    // Changing a person's address: refused for one that exists, then done.
    await openActions(designer.name, 'Change email');
    const change = page.getByRole('dialog', { name: `Change the email of ${designer.name}` });
    await change.getByLabel('New email address').fill(superAdmin().email);
    await change.getByRole('button', { name: 'Change email' }).click();
    await expect(change.getByLabel('New email address')).toHaveAccessibleDescription('An account with this email already exists');
    await change.getByLabel('New email address').fill(moved);
    await change.getByRole('button', { name: 'Change email' }).click();
    await expect(page.getByText('Email changed')).toBeVisible();
    await expect(row).toContainText(moved);

    // Invite an owner of that restaurant: the link is shown once, and the invitation waits until it is withdrawn.
    await page.getByRole('button', { name: 'Invite an owner' }).click();
    const invite = page.getByRole('dialog', { name: 'Invite an owner' });
    await invite.getByLabel('Restaurant').click();
    await invite.getByRole('combobox').fill(restaurant.name);
    await invite.getByRole('option', { name: new RegExp(restaurant.name) }).click();
    await invite.getByLabel('Email address').fill(owner);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    const note = page.getByRole('status').filter({ hasText: `Invitation for ${owner}` });
    await expect(note).toBeVisible();
    await expect(note.getByLabel('Invitation link')).toHaveValue(/\/studio\/invite\/[A-Za-z0-9_-]{43}$/);
    await expect(note.getByRole('button', { name: 'Copy' })).toBeVisible();
    await note.getByRole('button', { name: 'Done' }).click();
    await expect(note).toBeHidden();
    const waiting = page.getByRole('list').filter({ hasText: owner });
    await expect(waiting).toContainText(`Owner · ${restaurant.name}`);
    await waiting.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByText('Invitation withdrawn')).toBeVisible();
    await expect(page.getByText(owner)).toBeHidden();

    // Staff are invited with a role (a designer here), and their link is shown once too.
    await page.getByRole('button', { name: 'Invite staff' }).click();
    const staffDialog = page.getByRole('dialog', { name: 'Invite staff' });
    await staffDialog.getByLabel('Email address').fill(staff);
    await expect(staffDialog.getByLabel('Role')).toHaveValue('DESIGNER');
    await staffDialog.getByRole('button', { name: 'Send invitation' }).click();
    const staffNote = page.getByRole('status').filter({ hasText: `Invitation for ${staff}` });
    await expect(staffNote.getByLabel('Invitation link')).toHaveValue(/\/studio\/invite\//);
    await staffNote.getByRole('button', { name: 'Done' }).click();
    const staffWaiting = page.getByRole('list').filter({ hasText: staff });
    await expect(staffWaiting).toContainText('Staff');
    await staffWaiting.getByRole('button', { name: 'Withdraw' }).click();
    await expect(page.getByText(staff)).toBeHidden();

    // The log has all of it, found by choosing the restaurant by name.
    await page.goto('/studio/activity');
    await page.getByLabel('Restaurant').click();
    await page.getByPlaceholder('Search').fill(restaurant.name);
    await page.getByRole('option', { name: new RegExp(restaurant.name) }).click();
    await expect(page).toHaveURL(/restaurant=/);
    const log = page.getByRole('table');
    await expect(log).toContainText('Assigned a designer');
    await expect(log).toContainText('Invited someone');
    await expect(log).toContainText('Withdrew an invitation');
    await page.context().close();
  });

  test("a client's permission switches are saved with the version, and a stale save is refused", async ({ browser }) => {
    test.setTimeout(60_000);
    const restaurant = await made('Switches');
    const page = await freshPage(browser);
    await page.goto(`/studio/restaurants/${restaurant.id}/people`);
    await expect(page.getByRole('heading', { level: 2, name: 'Permissions' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // One switch per grantable key, for designers and for owners; the keys no client can have are not there.
    await expect(page.getByRole('switch')).toHaveCount(40);
    await expect(page.getByRole('switch', { name: 'Owners: Delete menus' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Owners: Change permissions' })).toHaveCount(0);

    const invite = page.getByRole('switch', { name: 'Owners: Invite owners' });
    const publish = page.getByRole('switch', { name: 'Designers: Publish' });
    await expect(invite).not.toBeChecked();
    await expect(publish).toBeChecked();
    await expect(page.getByRole('button', { name: 'Save permissions' })).toBeDisabled();

    // Owners may invite co-owners here; designers may not publish here. Both are marked as changed.
    await expect(async () => {
      await invite.click();
      await expect(invite).toBeChecked({ timeout: 1000 });
    }).toPass();
    await publish.click();
    await expect(publish).not.toBeChecked();
    await expect(page.getByText('Changed')).toHaveCount(2);
    await expect(page.getByText('You have unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save permissions' }).click();
    await expect(page.getByText('Permissions saved')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('switch', { name: 'Owners: Invite owners' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Designers: Publish' })).not.toBeChecked();
    await expect(page.getByText('Changed')).toHaveCount(2);

    // Someone else saves the restaurant meanwhile: this save is refused, and Reload shows what is there now.
    await bumpRestaurantVersion(restaurant.id);
    await page.getByRole('switch', { name: 'Designers: Publish' }).click();
    await page.getByRole('button', { name: 'Save permissions' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Reload to see their changes' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Reload' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Reload to see their changes' })).toBeHidden();
    await expect(page.getByRole('switch', { name: 'Designers: Publish' })).not.toBeChecked();
    await page.context().close();
  });
});
