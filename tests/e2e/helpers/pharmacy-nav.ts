import type { Locator, Page } from '@playwright/test';

/** The frame's own navigation (`pharmacy.nav.main` in en, ar and ckb), never a page's own `<nav>` such as the Stock chips. */
const FRAME_NAV = /^(Main navigation|التنقل الرئيسي|ڕێنیشاندەری سەرەکی)$/;

/** The frame's navigation that is showing: the rail on a desktop (the phone's bottom bar is hidden there). */
export function frameNav(page: Page): Locator {
  return page.getByRole('navigation', { name: FRAME_NAV });
}

/**
 * The pharmacy's desktop rail shows Sell, Stock, Products, Customers and Reports (then the AI Doctor when on); every other place (Home,
 * Expiry, ...) sits under its "More" toggle, grouped as Daily, Stock and Purchasing (a native `<details>`, closed unless the current place is one of them). A closed "More" hides its links from the
 * accessibility tree, so a test that follows or rules out one of those places opens it first. A role with nothing under
 * "More" has no toggle, and this does nothing.
 */
export async function openRailMore(page: Page): Promise<void> {
  const toggle = frameNav(page).locator('details:not([open]) > summary');
  if ((await toggle.count()) > 0) await toggle.click();
}

/** Follows a place in the desktop rail, opening "More" first when the place sits there. */
export async function railLink(page: Page, name: string, options: { exact?: boolean } = {}): Promise<void> {
  const link = frameNav(page).getByRole('link', { name, exact: options.exact ?? false });
  if ((await link.count()) === 0) await openRailMore(page);
  await link.click();
}
