import { expect, test, type Page } from '@playwright/test';

/** What a guest opening a menu's address should get: its unavailable page, or the menu itself. */
export type GuestView = 'unavailable' | 'menu';

async function shows(guest: Page, view: GuestView): Promise<boolean> {
  const unavailable = (await guest.getByTestId('menu-unavailable').count()) > 0;
  if (view === 'unavailable') return unavailable;
  // The menu itself, not merely a page without the unavailable notice: its dishes are listed.
  return !unavailable && (await guest.getByTestId('product-row').count()) > 0;
}

/**
 * Opens `path` as a guest right after a Studio change and expects `view`. A change expires the address's cached answer
 * at once (`expireMenu`), so the first load must show it. One reload is tolerated and recorded in the test's
 * annotations ("guest reloads"), so a recurrence of a stale first answer is visible in the report; a second is a failure.
 */
export async function expectGuestView(guest: Page, path: string, view: GuestView): Promise<void> {
  await guest.goto(path);
  let reloads = 0;
  if (!(await shows(guest, view))) {
    reloads = 1;
    await guest.goto(path);
  }
  test.info().annotations.push({ type: 'guest reloads', description: `${path} (${view}): ${reloads}` });
  expect(await shows(guest, view), `${path} should show the ${view === 'menu' ? 'menu' : 'unavailable page'}`).toBe(true);
}
