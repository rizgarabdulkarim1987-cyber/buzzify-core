import { expect, test, type Browser, type Page } from '@playwright/test';
import { utcToZonedLocal } from '@/server/domain/schedule-time';
import { getStudioTranslator } from '@/studio/messages';
import { E2E_CRON_SECRET } from './helpers/cron';
import { createTemporaryMenu, makeScheduleDue, type TemporaryMenu } from './helpers/db';
import { hideDevTools, superAdminFile, uniqueClientAddress } from './helpers/studio';

/**
 * Revisions (spec 10.6) on a temporary menu published as revision 1 ("Espresso" at 3.00 USD, menu time Asia/Baghdad):
 * going back, restoring into the draft, and scheduled publishing through the scheduler's endpoint.
 */

const en = getStudioTranslator('en');

async function signedIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, storageState: superAdminFile('en') });
  await hideDevTools(context);
  return context.newPage();
}

async function setPrice(page: Page, menuId: string, price: string) {
  await page.goto(`/studio/menus/${menuId}/prices`);
  const cell = page.getByLabel(en('prices.cell', { name: 'Espresso' }));
  await cell.fill(price);
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'] !== undefined);
  await cell.press('Enter');
  await saved;
}

async function publishNow(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/^Published as revision \d+/).first()).toBeVisible();
  // Published with warnings (texts missing in a language), the dialog stays open to list them.
  const warnings = page.getByRole('dialog', { name: /^Published as revision \d+$/ });
  if (await warnings.isVisible()) {
    await warnings.getByRole('button', { name: 'Close' }).last().click();
    await expect(warnings).toBeHidden();
  }
}

test.describe('revisions @desktop', () => {
  let menu: TemporaryMenu;

  test.beforeEach(async () => {
    menu = await createTemporaryMenu();
  });

  test.afterEach(async () => {
    await menu.remove();
  });

  test('goes back, restores into the draft, and publishes on schedule', async ({ browser }) => {
    test.slow();
    const page = await signedIn(browser);
    const guest = await browser.newPage();
    const publicPrice = async () => {
      await guest.goto(`/${menu.slug}/en`);
      return guest.getByTestId('product-row').filter({ hasText: 'Espresso' }).first();
    };

    await setPrice(page, menu.menuId, '4.00');
    await publishNow(page);
    await expect(await publicPrice()).toContainText('4.00');

    // Back to revision 1: guests get its price at once.
    await page.goto(`/studio/menus/${menu.menuId}/revisions`);
    const history = page.getByRole('table', { name: en('revisions.caption') });
    await history.getByRole('row', { name: /^1 / }).getByRole('button', { name: en('revisions.rollback') }).click();
    await page.getByRole('dialog').getByRole('button', { name: en('revisions.rollbackConfirm') }).click();
    await expect(page.getByText(en('revisions.rolledBack', { number: 1 }))).toBeVisible();
    await expect(await publicPrice()).toContainText('3.00');

    // Revision 2 into the draft, then published as revision 3.
    await history.getByRole('row', { name: /^2 / }).getByRole('button', { name: en('revisions.restore') }).click();
    await page.getByRole('dialog').getByRole('button', { name: en('revisions.restoreConfirm') }).click();
    await expect(page.getByText(en('menus.unpublished'), { exact: true })).toBeVisible();
    await publishNow(page);
    await expect(await publicPrice()).toContainText('4.00');

    // A publish for tomorrow 09:00 menu time: in the tab and on Overview, then cancelled.
    const tomorrow = utcToZonedLocal(new Date(Date.now() + 86_400_000), 'Asia/Baghdad').slice(0, 10);
    await page.getByRole('button', { name: en('menus.manage') }).click();
    await page.getByRole('menuitem', { name: en('schedule.open') }).click();
    const dialog = page.getByRole('dialog', { name: en('schedule.title') });
    await expect(dialog).toContainText('Asia/Baghdad');
    await dialog.getByLabel(en('schedule.when')).fill(`${tomorrow}T09:00`);
    await dialog.getByRole('button', { name: en('schedule.confirm') }).click();
    await expect(page.getByText(en('schedule.done', { number: 4 }))).toBeVisible();
    await page.goto(`/studio/menus/${menu.menuId}/revisions`);
    const pending = page.getByRole('region', { name: en('revisions.pendingTitle') });
    await expect(pending).toContainText('9:00');
    await page.goto('/studio');
    await expect(page.getByRole('region', { name: en('overview.scheduled.title') })).toContainText(menu.name);
    await page.goto(`/studio/menus/${menu.menuId}/revisions`);
    await pending.getByRole('button', { name: en('revisions.cancelSchedule') }).click();
    await page.getByRole('dialog').getByRole('button', { name: en('revisions.cancelConfirm') }).click();
    await expect(pending).toBeHidden();

    // Scheduled again with a new price; once due, the scheduler makes it live.
    await setPrice(page, menu.menuId, '5.00');
    await page.getByRole('button', { name: en('menus.manage') }).click();
    await page.getByRole('menuitem', { name: en('schedule.open') }).click();
    await page.getByRole('dialog', { name: en('schedule.title') }).getByLabel(en('schedule.when')).fill(`${tomorrow}T09:00`);
    await page.getByRole('dialog', { name: en('schedule.title') }).getByRole('button', { name: en('schedule.confirm') }).click();
    await expect(page.getByText(/^Revision \d+ will go live/)).toBeVisible();
    await makeScheduleDue(menu.menuId);
    const cron = await page.request.get('/api/cron/publish', { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
    expect(cron.status()).toBe(200);
    expect(await cron.json()).toMatchObject({ activated: 1 });
    await expect(await publicPrice()).toContainText('5.00');
  });

  test('previews a past revision', async ({ browser }) => {
    const page = await signedIn(browser);
    await page.goto(`/studio/menus/${menu.menuId}/revisions`);
    const row = page.getByRole('table', { name: en('revisions.caption') }).getByRole('row', { name: /^1 / });
    const href = await row.getByRole('link', { name: en('revisions.preview') }).getAttribute('href');
    expect(href).toMatch(/\?revision=/);
    await page.goto(href!);
    await expect(page.getByRole('button', { name: /Espresso/ }).first()).toBeVisible();
    await expect(page.getByRole('note')).toContainText('1');
  });
});
