import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Driving the pharmacy cashier (/pharmacy/sell, `CashierScreen`) from an e2e spec: the steps every spec that sells as setup
 * shares (open the shift, add an item from the search, set its quantity, pay in cash or on account), on the cashier's own
 * testids. One place, so a change to the screen changes one file.
 */

/** Opens /pharmacy/sell and, when no shift is open, opens one with `float` in the drawer. Ends on the cashier. */
export async function openCashier(page: Page, float = '10,000'): Promise<void> {
  await page.goto('/pharmacy/sell');
  await expect(page.getByTestId('open-shift').or(page.getByTestId('cashier-screen'))).toBeVisible();
  if (await page.getByTestId('open-shift').isVisible()) {
    await page.getByTestId('shift-float').fill(float);
    await page.getByTestId('shift-open').click();
  }
  await expect(page.getByTestId('cashier-search')).toBeVisible();
}

/** The suggestion row for `name` after typing it in the scan field (the list under the field; never a dialog). */
export async function suggestionFor(page: Page, name: string): Promise<Locator> {
  await page.getByTestId('cashier-search').fill(name);
  const row = page.getByTestId('suggestion').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  return row;
}

/**
 * Adds `name` from the search to the active receipt, in its smallest unit (the cashier's start unit), and waits for its line.
 * `unitSteps` presses the unit key that many times on the new (selected) line, each moving it to its next priced unit.
 */
export async function addFromSearch(page: Page, name: string, { unitSteps = 0 }: { unitSteps?: number } = {}): Promise<void> {
  const before = await page.getByTestId('sale-line').count();
  await (await suggestionFor(page, name)).click();
  const line = page.getByTestId('sale-line').filter({ hasText: name });
  await expect(line.first()).toBeVisible();
  await expect(page.getByTestId('sale-line')).toHaveCount(before + 1);
  for (let i = 0; i < unitSteps; i += 1) await page.getByTestId('unit-button').click();
}

/** Puts `qty` on the selected line with the keypad (digits, then its enter key). */
export async function setQty(page: Page, qty: number): Promise<void> {
  await page.getByTestId('keypad-clear').click();
  for (const digit of String(qty)) await page.getByTestId('key-digit').getByText(digit, { exact: true }).click();
  await page.getByTestId('keypad-enter').click();
  await expect(page.getByTestId('sale-line').and(page.locator('[aria-selected="true"]'))).toContainText(String(qty));
}

/** Pays the active receipt in cash (F2 flow): `tendered` received, or empty for exactly the total. Ends on the done receipt. */
export async function payCash(page: Page, tendered = ''): Promise<void> {
  await page.getByTestId('pay-cash').click();
  await expect(page.getByTestId('work-panel')).toHaveAttribute('data-flow', 'cash');
  await page.getByTestId('flow-tendered').fill(tendered);
  await page.getByTestId('flow-confirm').click();
  await expect(page.getByTestId('sale-done')).toBeVisible();
}

/**
 * Pays the active receipt on a customer's account (F3 flow): the customer found by `customer` in the side column, `now` paid
 * now in cash (0 = wholly on the account). Ends on the done receipt.
 */
export async function payOnAccount(page: Page, customer: string, now = '0'): Promise<void> {
  await openCredit(page, customer);
  await page.getByTestId('flow-now').fill(now);
  await page.getByTestId('flow-confirm').click();
  await expect(page.getByTestId('sale-done')).toBeVisible();
}

/** Picks the receipt's customer in the side column (the first found by `query`), changing one already picked. */
export async function pickCustomer(page: Page, query: string): Promise<Locator> {
  const side = page.getByTestId('cashier-customer');
  if (await side.getByTestId('customer-change').isVisible()) await side.getByTestId('customer-change').click();
  await side.getByTestId('customer-search').fill(query);
  await side.getByTestId('customer-option').first().click();
  await expect(side.getByTestId('customer-picked')).toBeVisible();
  return side.getByTestId('customer-picked');
}

/** Picks the customer and opens the credit flow (F3) for the active receipt; nothing is sent yet. */
export async function openCredit(page: Page, customer: string): Promise<void> {
  await pickCustomer(page, customer);
  await page.getByTestId('pay-credit').click();
  await expect(page.getByTestId('work-panel')).toHaveAttribute('data-flow', 'credit');
}

/** Empties the active receipt with the toolbar's discard (a press arms it, a second press discards). */
export async function discardReceipt(page: Page): Promise<void> {
  const discard = page.getByTestId('tool-discard');
  if (!(await discard.isEnabled())) return;
  await discard.click();
  await expect(discard).toHaveAttribute('aria-pressed', 'true');
  await discard.click();
  await expect(page.getByTestId('sale-line')).toHaveCount(0);
}

/** Leaves the done receipt for a new, empty one. */
export async function nextReceipt(page: Page): Promise<void> {
  await page.getByTestId('receipt-next').click();
  await expect(page.getByTestId('sale-done')).toHaveCount(0);
}

/** The stock note of `name`'s suggestion ("Stock 48", or "Out of stock"), read from the scan field's list. */
export async function stockNoteOf(page: Page, name: string): Promise<Locator> {
  return (await suggestionFor(page, name)).getByTestId('suggestion-note');
}
