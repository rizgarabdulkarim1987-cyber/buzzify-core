import { expect, test, type Browser, type Page } from '@playwright/test';
import { getStudioTranslator } from '@/studio/messages';
import {
  createTestRestaurant,
  hideDevTools,
  makePlatformOwner,
  planPriceRows,
  removeRestaurants,
  restorePlanPrices,
  restorePlatformOwner,
  superAdmin,
  SUPER_ADMIN_FILE,
  uniqueClientAddress,
  type PlanPriceRow,
  type TestRestaurant,
} from './helpers/studio';

/**
 * Billing end to end (docs/superpowers/plans/2026-10-22-business-core-in-menu.md, Task 5), on a throwaway restaurant with
 * no menus, so no seeded menu changes plan: the platform owner prices the Menu's Pro plan in Settings → Billing, starts
 * a Menu trial, records a cash payment, and sees the end of what is paid for move past the trial's end. The Menu's
 * prices and the platform owner are put back afterwards.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: SUPER_ADMIN_FILE });
  await hideDevTools(context);
  return context.newPage();
}

/** A toast, apart from the same words in the page (the history says "Trial started" too). */
const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]', { hasText: text });

test.describe('billing @desktop', () => {
  test.describe.configure({ mode: 'serial' });
  let restaurant: TestRestaurant;
  let previousOwner: string | null = null;
  let menuPrices: PlanPriceRow[] = [];

  test.beforeAll(async () => {
    restaurant = await createTestRestaurant('Billing');
    menuPrices = await planPriceRows('menu');
    previousOwner = await makePlatformOwner(superAdmin().userId);
  });

  test.afterAll(async () => {
    await restorePlatformOwner(previousOwner);
    await restorePlanPrices('menu', menuPrices);
    // Deletes the restaurant's subscriptions and payments first.
    await removeRestaurants([restaurant.id]);
  });

  test('a Menu trial, then a cash payment, moves the end of what is paid for', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);

    // Settings → Billing: Pro costs 25,000 IQD a month.
    await page.goto('/studio/settings/billing');
    // Typed as people in Iraq write it: the point groups thousands, and the field says what will be saved.
    const proMonthly = page.getByRole('textbox', { name: en('billingSettings.priceLabel', { plan: 'Pro', currency: 'IQD', period: en('billing.period.MONTHLY') }) });
    await proMonthly.fill('25.000');
    await expect(proMonthly).toHaveAccessibleDescription(/IQD.25,000/);
    await page.getByRole('button', { name: en('billingSettings.savePrices', { product: 'Menu' }) }).click();
    await expect(page.getByText(en('billingSettings.pricesSaved', { product: 'Menu' }))).toBeVisible();

    // The restaurant's Billing tab: a 14-day trial of Pro, paid in dinars every month.
    await page.goto(`/studio/restaurants/${restaurant.id}/billing`);
    const menu = page.getByRole('region', { name: 'Menu', exact: true });
    await expect(menu.getByText(en('billing.none'))).toBeVisible();
    await menu.getByRole('button', { name: en('billing.startTrial') }).click();
    const trial = page.getByRole('dialog', { name: en('billing.startTrial') });
    await trial.getByLabel(en('billing.field.plan')).selectOption({ label: 'Pro' });
    await expect(trial.getByText(/25,000/)).toBeVisible();
    await trial.getByRole('button', { name: en('billing.startTrial') }).click();
    await expect(toast(page, en('billing.trialStarted'))).toBeVisible();
    await expect(menu.getByText(en('billing.status.TRIAL'), { exact: true })).toBeVisible();
    await expect(menu.getByText(en('billing.trialEnds'))).toBeVisible();
    const periodEnd = menu.locator('dl time').first();
    const trialEnd = Date.parse((await periodEnd.getAttribute('datetime'))!);
    expect(trialEnd - Date.now()).toBeGreaterThan(13 * 86_400_000);

    // A cash payment of the plan's price: cash is the default, the amount is the subscription's price.
    await menu.getByRole('button', { name: en('billing.recordPayment') }).click();
    const payment = page.getByRole('dialog', { name: en('billing.recordPayment') });
    await expect(payment.getByLabel(en('billing.field.amount', { currency: 'IQD' }))).toHaveValue('25000');
    await expect(payment.getByLabel(en('billing.field.method'))).toHaveValue('CASH');
    await payment.getByRole('button', { name: en('billing.recordPayment') }).click();
    await expect(toast(page, en('billing.paymentRecorded'))).toBeVisible();

    await expect(menu.getByText(en('billing.status.ACTIVE'), { exact: true })).toBeVisible();
    await expect(menu.getByText(en('billing.paidUntil'))).toBeVisible();
    const paidUntil = Date.parse((await periodEnd.getAttribute('datetime'))!);
    // A month from today, past the trial's end.
    expect(paidUntil).toBeGreaterThan(trialEnd);
    expect(paidUntil - Date.now()).toBeGreaterThan(27 * 86_400_000);
    const payments = menu.getByRole('table', { name: en('billing.payments') });
    await expect(payments.getByRole('row')).toHaveCount(2);
    await expect(payments).toContainText(en('billing.method.CASH'));
    await expect(payments).toContainText('25,000');
    const history = menu.getByRole('table', { name: en('billing.history') });
    await expect(history.getByRole('row').nth(1)).toContainText(en('billing.event.ACTIVATED'));
  });
});
