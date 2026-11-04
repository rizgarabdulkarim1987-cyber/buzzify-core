import type { Page } from '@playwright/test';

/**
 * The pharmacy's desktop rail shows Home, Sell, Stock, Expiry and Reports; every other place sits under its "More"
 * toggle (a native `<details>`, closed unless the current place is one of them). A closed "More" hides its links from the
 * accessibility tree, so a test that follows or rules out one of those places opens it first. A role with nothing under
 * "More" has no toggle, and this does nothing.
 */
export async function openRailMore(page: Page): Promise<void> {
  const toggle = page.getByRole('navigation').locator('details:not([open]) > summary');
  if ((await toggle.count()) > 0) await toggle.click();
}

/** Follows a place in the desktop rail, opening "More" first when the place sits there. */
export async function railLink(page: Page, name: string, options: { exact?: boolean } = {}): Promise<void> {
  const link = page.getByRole('navigation').getByRole('link', { name, exact: options.exact ?? false });
  if ((await link.count()) === 0) await openRailMore(page);
  await link.click();
}
