import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import { createTemporaryMenu, type TemporaryMenu } from './helpers/db';
import { hideDevTools, makePlatformOwner, restorePlatformOwner, superAdmin, SUPER_ADMIN_FILE, uniqueClientAddress } from './helpers/studio';

/**
 * Plans (spec: plans and entitlements) end to end, on a temporary restaurant so the suites reading ATELIER in parallel
 * never see a plan change: the platform owner moves it to Basic, guests lose Explore and the animated rail at once with
 * no publish, the Brand tab shows the locks, and moving back to Premium brings everything back. The setup's Super Admin
 * is made the platform owner for this suite and the owner it had is given back afterwards.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: SUPER_ADMIN_FILE });
  await hideDevTools(context);
  return context.newPage();
}

async function choosePlan(page: Page, restaurantId: string, plan: string) {
  await page.goto(`/studio/restaurants/${restaurantId}/plan`);
  await page.getByRole('radiogroup', { name: en('plans.choose') }).getByRole('radio', { name: plan }).click();
  await page.getByRole('button', { name: en('plans.save') }).click();
}

test.describe('plans @desktop', () => {
  test.describe.configure({ mode: 'serial' });
  let menu: TemporaryMenu;
  let previousOwner: string | null = null;

  test.beforeAll(async () => {
    menu = await createTemporaryMenu();
    previousOwner = await makePlatformOwner(superAdmin().userId);
  });

  test.afterAll(async () => {
    await restorePlatformOwner(previousOwner);
    await menu.remove();
  });

  test('a downgrade hides Explore and the animated rail at once, and an upgrade brings them back', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    const guest = await browser.newPage();
    const explore = guest.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Explore' });

    await guest.goto(`/${menu.slug}/en`);
    await expect(explore).toBeVisible();

    // Basic: the dialog names what guests stop seeing before anything changes.
    await choosePlan(page, menu.restaurantId, 'Basic');
    const confirm = page.getByRole('dialog', { name: en('plans.confirmTitle', { restaurant: menu.name }) });
    await expect(confirm).toContainText('Explore mode');
    await confirm.getByRole('button', { name: en('plans.save') }).click();
    await expect(page.getByText(en('plans.saved'))).toBeVisible();

    await guest.goto(`/${menu.slug}/en`);
    await expect(explore).toHaveCount(0);
    await expect(guest.locator('nav[data-rail-style]')).toHaveAttribute('data-rail-style', 'plain');
    await guest.goto(`/${menu.slug}/en/explore`);
    await expect(guest).toHaveURL(new RegExp(`/${menu.slug}/en$`));

    // The Brand tab: a rail the plan lacks cannot be chosen, and the font pairs lead the owner to the Plan tab.
    await page.goto(`/studio/menus/${menu.menuId}/brand`);
    await expect(page.locator('option', { hasText: 'Drum' })).toBeDisabled();
    await expect(page.locator('section[aria-labelledby="brand-type"]').getByRole('link', { name: en('upgrade.changePlan') })).toHaveAttribute(
      'href',
      `/studio/restaurants/${menu.restaurantId}/plan`,
    );

    // Back to Premium: nothing is lost, so it saves without asking, and guests get Explore again.
    await choosePlan(page, menu.restaurantId, 'Premium');
    await expect(page.getByText(en('plans.saved'))).toBeVisible();
    await guest.goto(`/${menu.slug}/en`);
    await expect(explore).toBeVisible();
  });
});
