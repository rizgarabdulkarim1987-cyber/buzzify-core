import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { E2E_ORIGIN } from './helpers/origin';
import {
  assignMember,
  createStudioUser,
  hideDevTools,
  removeRestaurants,
  removeStudioUsers,
  uniqueClientAddress,
  type StudioUser,
} from './helpers/studio';

/**
 * The `/pharmacy` shell: the shared sign-in, the business and branch picker, and the signed cookie that remembers the
 * choice. Pharmacies, people and staff rows are written straight to the development database and removed afterwards.
 */

const DAY = 86_400_000;
const PLACE_COOKIE = 'bz_ph_place';
const db = () => createPrisma(databaseUrl(DEV_DB));

interface TestPharmacy {
  id: string;
  name: string;
  branches: Array<{ id: string; name: string }>;
}

/** An active pharmacy with two branches and a live `pharmacy` subscription. */
async function makePharmacy(label: string): Promise<TestPharmacy> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branches = [];
    for (const [i, branch] of ['Main street', 'Airport road'].entries()) {
      branches.push(
        await client.branch.create({ data: { restaurantId: row.id, name: `${branch} ${label}`, sortOrder: i }, select: { id: true, name: true } }),
      );
    }
    const now = Date.now();
    await client.subscription.create({
      data: {
        restaurantId: row.id,
        applicationId: 'pharmacy',
        planCode: 'standard',
        status: 'ACTIVE',
        period: 'MONTHLY',
        currency: 'IQD',
        priceMinor: 0,
        currentPeriodStart: new Date(now - DAY),
        currentPeriodEnd: new Date(now + 29 * DAY),
        graceDays: 7,
        version: 1,
      },
    });
    return { id: row.id, name, branches };
  } finally {
    await client.$disconnect();
  }
}

/** Makes `userId` staff of a pharmacy with a role and the given branches. */
async function makeStaff(userId: string, restaurantId: string, branchIds: string[]): Promise<void> {
  const client = db();
  try {
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role: 'PHARMACIST' }, select: { id: true } });
    for (const branchId of branchIds) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId } });
  } finally {
    await client.$disconnect();
  }
}

async function freshPage(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

/** Opens `/pharmacy` signed out, signs in on the Studio's form and comes back to the picker. */
async function signInToPharmacy(page: Page, user: StudioUser): Promise<void> {
  await page.goto('/pharmacy');
  await expect(page).toHaveURL(/\/studio\/sign-in\?next=(%2F|\/)pharmacy$/);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
}

async function placeCookie(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === PLACE_COOKIE);
  if (!cookie) throw new Error('no place cookie');
  return cookie.value;
}

async function setPlaceCookie(page: Page, value: string): Promise<void> {
  // Over the one the server set: same name, host and path.
  const domain = new URL(E2E_ORIGIN).hostname;
  await page.context().addCookies([{ name: PLACE_COOKIE, value, domain, path: '/pharmacy', httpOnly: true, sameSite: 'Lax' }]);
  expect((await page.context().cookies()).filter((c) => c.name === PLACE_COOKIE)).toHaveLength(1);
}

/** Whether the page scrolls sideways. */
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.describe('Pharmacy shell @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];

  test.afterAll(async () => {
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  async function owned(label: string, locale: 'en' | 'ar' = 'en') {
    const shop = await makePharmacy(label);
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-owner', name: 'Pharmacy Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('the owner signs in, lands on the picker, chooses branch 1 and sees the home', async ({ browser }) => {
    const { shop, owner } = await owned('Shifa');
    const page = await freshPage(browser);
    await signInToPharmacy(page, owner);

    await expect(page.getByRole('heading', { level: 1, name: 'Choose where you work' })).toBeVisible();
    const choices = page.getByRole('group', { name: shop.name });
    await expect(choices.getByRole('button')).toHaveText(['All branches', shop.branches[0]!.name, shop.branches[1]!.name]);
    await choices.getByRole('button', { name: shop.branches[0]!.name }).click();

    await expect(page).toHaveURL(/\/pharmacy\/home$/);
    const banner = page.getByRole('banner');
    await expect(banner.getByText(shop.name)).toBeVisible();
    await expect(banner.getByText(shop.branches[0]!.name)).toBeVisible();
    await expect(banner.getByText('Pharmacy Owner · Owner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: shop.branches[0]!.name })).toBeVisible();
    await expect(page.getByTestId('support-banner')).toHaveCount(0);

    // The choice is remembered: /pharmacy goes straight home, and "Change" goes back to the picker.
    await page.goto('/pharmacy');
    await expect(page).toHaveURL(/\/pharmacy\/home$/);
    await banner.getByRole('link', { name: 'Change branch' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/select$/);
    await page.getByRole('group', { name: shop.name }).getByRole('button', { name: 'All branches' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'All branches' })).toBeVisible();
    await page.context().close();
  });

  test('a person with only branch 2 cannot open branch 1 by editing the cookie', async ({ browser }) => {
    const { shop, owner } = await owned('Dawa');
    const ownerPage = await freshPage(browser);
    await signInToPharmacy(ownerPage, owner);
    await ownerPage.getByRole('group', { name: shop.name }).getByRole('button', { name: shop.branches[0]!.name }).click();
    await expect(ownerPage).toHaveURL(/\/pharmacy\/home$/);
    const ownersCookie = await placeCookie(ownerPage);
    await ownerPage.context().close();

    const staff = await createStudioUser({ label: 'ph-staff', name: 'Branch Two' });
    people.push(staff.email);
    await makeStaff(staff.userId, shop.id, [shop.branches[1]!.id]);
    const page = await freshPage(browser);
    await signInToPharmacy(page, staff);
    const group = page.getByRole('group', { name: shop.name });
    // No "All branches", and no branch 1.
    await expect(group.getByRole('button')).toHaveText([shop.branches[1]!.name]);
    await group.getByRole('button', { name: shop.branches[1]!.name }).click();
    await expect(page).toHaveURL(/\/pharmacy\/home$/);

    // Their own cookie with branch 1's id put in: the signature no longer matches.
    const own = await placeCookie(page);
    expect(own).toContain(shop.branches[1]!.id);
    await setPlaceCookie(page, own.replace(shop.branches[1]!.id, shop.branches[0]!.id));
    await page.goto('/pharmacy/home');
    await expect(page).toHaveURL(/\/pharmacy\/select$/);
    await expect(page.getByText(shop.branches[0]!.name)).toHaveCount(0);

    // The owner's genuine cookie for branch 1: signed for someone else, so it does not count either.
    await setPlaceCookie(page, ownersCookie);
    await page.goto('/pharmacy/home');
    await expect(page).toHaveURL(/\/pharmacy\/select$/);

    // Asking for branch 1 outright is refused as not found.
    const answer = await page.request.post('/pharmacy/select/choose', {
      form: { place: `${shop.id}:${shop.branches[0]!.id}` },
      headers: { origin: E2E_ORIGIN },
      maxRedirects: 0,
    });
    expect(answer.status()).toBe(404);
    await page.context().close();
  });

  test('a person of another pharmacy gets not found, and a person with none too', async ({ browser }) => {
    const { shop } = await owned('Noor');
    const other = await makePharmacy('Other');
    restaurants.push(other.id);
    const stranger = await createStudioUser({ label: 'ph-other', name: 'Other Staff' });
    people.push(stranger.email);
    await makeStaff(stranger.userId, other.id, [other.branches[0]!.id]);

    const page = await freshPage(browser);
    await signInToPharmacy(page, stranger);
    await expect(page.getByRole('group', { name: shop.name })).toHaveCount(0);
    const answer = await page.request.post('/pharmacy/select/choose', {
      form: { place: `${shop.id}:*` },
      headers: { origin: E2E_ORIGIN },
      maxRedirects: 0,
    });
    expect(answer.status()).toBe(404);
    await page.context().close();

    const nobody = await createStudioUser({ label: 'ph-none', name: 'No Pharmacy' });
    people.push(nobody.email);
    const empty = await freshPage(browser);
    await empty.goto('/pharmacy');
    await empty.getByLabel('Email').fill(nobody.email);
    await empty.getByLabel('Password', { exact: true }).fill(nobody.password);
    await empty.getByRole('button', { name: 'Sign in' }).click();
    // Signed in, they come back to /pharmacy and find nothing there: not found, never another trip to the sign-in.
    await expect(empty).toHaveURL(/\/pharmacy$/);
    await expect(empty.getByText('This page could not be found.')).toBeVisible();
    for (const path of ['/pharmacy', '/pharmacy/select', '/pharmacy/home']) {
      expect((await empty.request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
    await empty.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375px and 1280px, and passes axe', async ({ browser }) => {
    const { shop, owner } = await owned('Arabic', 'ar');
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInToPharmacy(page, owner);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: 'اختر مكان عملك' })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole('group', { name: shop.name }).getByRole('button', { name: shop.branches[1]!.name }).click();
    await expect(page).toHaveURL(/\/pharmacy\/home$/);
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.getByRole('heading', { level: 1, name: shop.branches[1]!.name })).toBeVisible();
      expect(await scrollsSideways(page), `${width}px`).toBe(false);
      expect(await seriousViolations(page)).toEqual([]);
    }

    // The keyboard reaches the skip link first, then the header's controls in reading order, then the page.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'انتقل إلى المحتوى' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'تغيير الفرع' })).toBeFocused();
    await page.context().close();
  });
});
