import { expect, test, type Browser, type Page } from '@playwright/test';
import { MOTIONS } from '@/motion/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { createStudioUser, hideDevTools, OWNER_FILE, removeStudioUsers, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The Motion area (docs/superpowers/plans/2026-10-18-motion-studio.md): a designer finds it in the sidebar, filters
 * and searches the 150 motions, tunes one and sees the code change, and every motion's page opens and plays without a
 * page error. An owner is sent back to their own work.
 */

const en = getStudioTranslator('en');

/** Errors a motion would raise in the console, without the dev server's own chatter. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Download the React DevTools|\[HMR\]|\[Fast Refresh\]/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function signIn(browser: Browser, person: StudioUser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
  await hideDevTools(context);
  const page = await context.newPage();
  await page.goto('/studio/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/studio$/);
  return page;
}

test.describe('the Motion area @desktop', () => {
  let designer: StudioUser;

  test.beforeAll(async () => {
    designer = await createStudioUser({ label: 'motion-designer', name: 'Mo Designer' });
  });

  test.afterAll(async () => {
    await removeStudioUsers([designer.email]);
  });

  test('lists, filters and searches the motions, and writes the code for a tuned one', async ({ browser }) => {
    test.slow();
    const page = await signIn(browser, designer);
    const errors = watchErrors(page);
    await page.getByRole('navigation', { name: en('nav.label') }).getByRole('link', { name: en('nav.motion') }).click();
    await expect(page).toHaveURL(/\/studio\/motion$/);
    await expect(page.getByRole('heading', { level: 1, name: en('motion.library.title') })).toBeVisible();
    await expect(page.getByText(en('motion.library.showing', { count: 150, total: 150 }))).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(10);

    await page.getByRole('navigation', { name: en('motion.library.categories') }).getByRole('button', { name: new RegExp(en('motion.category.food')) }).click();
    await expect(page).toHaveURL(/group=food/);
    await expect(page.getByText(en('motion.library.showing', { count: 15, total: 150 }))).toBeVisible();

    await page.getByRole('searchbox', { name: en('motion.library.search') }).fill('latte');
    await expect(page.getByText(en('motion.library.showing', { count: 1, total: 150 }))).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(en('motion.latte-art.name')) })).toBeVisible();

    await page.goto('/studio/motion/golden-particles');
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(en('motion.golden-particles.name')) })).toBeVisible();
    const snippet = page.locator('[data-snippet]');
    await expect(snippet).toHaveText(/<Motion id="golden-particles" \/>/);
    await page.getByLabel(en('motion.param.count')).fill('300');
    await expect(snippet).toContainText('params={{ count: 300 }}');
    await page.getByRole('button', { name: en('motion.detail.reset') }).click();
    await expect(snippet).toHaveText(/<Motion id="golden-particles" \/>/);
    expect(errors).toEqual([]);
  });

  test('opens every motion on its own page without an error', async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    const page = await signIn(browser, designer);
    const errors = watchErrors(page);
    await page.goto(`/studio/motion/${MOTIONS[0]!.id}`);
    for (const [index, meta] of MOTIONS.entries()) {
      await expect(page.getByRole('heading', { level: 1, name: new RegExp(en(`motion.${meta.id}.name`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible({ timeout: 30_000 });
      // The motion's own code has loaded when its host holds more than the loading frame.
      await expect(page.locator(`[data-stage="${meta.id}"] [data-motion="${meta.id}"] > :not([data-loading])`).first()).toBeAttached({ timeout: 30_000 });
      await page.waitForTimeout(250);
      expect(errors, `${meta.number} ${meta.id}`).toEqual([]);
      if (index < MOTIONS.length - 1) await page.getByRole('link', { name: en('motion.detail.next') }).click();
    }
  });

  test('sends an owner to their own work', async ({ browser }) => {
    const context = await browser.newContext({ storageState: OWNER_FILE, extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
    const page = await context.newPage();
    await page.goto('/studio/motion');
    await expect(page).not.toHaveURL(/\/studio\/motion/);
    await expect(page.getByRole('navigation', { name: en('nav.label') }).getByRole('link', { name: en('nav.motion') })).toHaveCount(0);
  });
});
