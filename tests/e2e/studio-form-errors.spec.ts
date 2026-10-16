import { expect, test, type Locator, type Page } from '@playwright/test';
import { seriousViolations } from './helpers/axe';
import { createStudioUser, removeStudioUsers, totp, uniqueClientAddress } from './helpers/studio';

/**
 * A refusal must reach a person who cannot see it: after the server turns down a field, focus moves to that field, the
 * field says what is wrong, and an alert announces it, a fresh alert each time even when the words are the same. Checked
 * on the second step of signing in and on a password dialog of the account page, with axe on two-factor setup.
 */

/** Submits, then expects the field focused and invalid and a new alert with `message`; returns that alert's attempt. */
async function expectAnnouncedRefusal(page: Page, submit: () => Promise<void>, field: Locator, message: string): Promise<string> {
  await submit();
  const alert = page.getByRole('alert').filter({ hasText: message });
  await expect(alert).toHaveCount(1);
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  return (await alert.getAttribute('data-attempt')) as string;
}

test.describe('Studio refusals @desktop', () => {
  const created: string[] = [];
  test.afterAll(async () => {
    await removeStudioUsers(created);
  });

  test('a wrong code or password takes focus back to its field and is announced every time', async ({ browser }) => {
    const person = await createStudioUser({ label: 'refusals', name: 'Dara Refusals' });
    created.push(person.email);
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() } });
    const page = await context.newPage();
    let secret = '';

    await test.step('set up two-factor, with axe on every step', async () => {
      await page.goto('/studio/sign-in');
      await page.getByLabel('Email').fill(person.email);
      await page.getByLabel('Password', { exact: true }).fill(person.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/studio$/);

      await page.goto('/studio/setup-two-factor');
      await expect(page.getByRole('heading', { level: 1, name: 'Set up two-factor authentication' })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);

      await page.getByLabel('Password', { exact: true }).fill(person.password);
      await page.getByRole('button', { name: 'Continue' }).click();
      secret = (await page.getByLabel('Setup key').inputValue()).replace(/\s+/g, '');
      expect(await seriousViolations(page)).toEqual([]);

      await page.getByLabel('6-digit code from the app').fill(totp(secret));
      await page.getByRole('button', { name: 'Turn on two-factor' }).click();
      await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);

      await page.getByLabel('I have saved my recovery codes').check();
      await page.getByRole('button', { name: 'Back to your account' }).click();
      await expect(page).toHaveURL(/\/studio\/account$/);
    });

    await test.step('a wrong password in the new recovery codes dialog', async () => {
      // The account page has just loaded: a click before it has hydrated does nothing, so press again until it opens.
      const dialog = page.getByRole('dialog', { name: 'Make new recovery codes?' });
      await expect(async () => {
        if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'New recovery codes' }).click();
        await expect(dialog).toBeVisible({ timeout: 1000 });
      }).toPass();
      const password = dialog.getByLabel('Your password', { exact: true });
      const confirm = dialog.getByRole('button', { name: 'Make new codes' });

      await password.fill('this is not my password');
      const first = await expectAnnouncedRefusal(page, () => confirm.click(), password, 'That password is not correct');
      await password.fill('still not my password');
      const second = await expectAnnouncedRefusal(page, () => confirm.click(), password, 'That password is not correct');
      expect(second).not.toBe(first);

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('a wrong code at the second step of signing in', async () => {
      const signOut = page.getByRole('menuitem', { name: 'Sign out' });
      await expect(async () => {
        if (!(await signOut.isVisible())) await page.getByRole('button', { name: 'Account menu' }).click();
        await expect(signOut).toBeVisible({ timeout: 1000 });
      }).toPass();
      await signOut.click();
      await expect(page).toHaveURL(/\/studio\/sign-in$/);

      await page.getByLabel('Email').fill(person.email);
      await page.getByLabel('Password', { exact: true }).fill(person.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/studio\/two-factor$/);

      const code = page.getByLabel('Authentication code');
      const verify = page.getByRole('button', { name: 'Verify' });
      const wrong = () => (totp(secret) === '000000' ? '111111' : '000000');

      await code.fill(wrong());
      const first = await expectAnnouncedRefusal(page, () => verify.click(), code, 'That code is not correct');
      await code.fill(wrong());
      const second = await expectAnnouncedRefusal(page, () => verify.click(), code, 'That code is not correct');
      expect(second).not.toBe(first);
    });

    await context.close();
  });
});
