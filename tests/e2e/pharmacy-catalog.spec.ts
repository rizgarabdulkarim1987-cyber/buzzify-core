import { randomInt, randomUUID } from 'node:crypto';
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
 * The pharmacy catalog screens: the owner adds a product with its packs and barcodes, finds it by barcode and by its
 * Arabic name, changes its price with a reason, imports a file with bad rows and exports the catalog; a cashier only
 * looks; the screens read right to left in Arabic without sideways scroll and pass axe. Pharmacies and people are written
 * straight to the development database and removed afterwards.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));

interface TestPharmacy {
  id: string;
  name: string;
}

async function makePharmacy(label: string): Promise<TestPharmacy> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    for (const [i, branch] of ['Main street', 'Airport road'].entries()) {
      await client.branch.create({ data: { restaurantId: row.id, name: `${branch} ${label}`, sortOrder: i } });
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
    return { id: row.id, name };
  } finally {
    await client.$disconnect();
  }
}

async function makeCashier(userId: string, restaurantId: string): Promise<void> {
  const client = db();
  try {
    const branches = await client.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role: 'CASHIER' }, select: { id: true } });
    for (const branch of branches) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch.id } });
  } finally {
    await client.$disconnect();
  }
}

/** The pharmacy rows a test made, children first (prices hold their product and unit with RESTRICT). */
async function removeCatalogs(restaurantIds: string[]): Promise<void> {
  const client = db();
  const where = { restaurantId: { in: restaurantIds } };
  try {
    await client.phImportRow.deleteMany({ where });
    await client.phImportBatch.deleteMany({ where });
    await client.phPrice.deleteMany({ where });
    await client.phPriceChangeBatch.deleteMany({ where });
    await client.phBarcode.deleteMany({ where });
    await client.phProductBranch.deleteMany({ where });
    await client.phProductUnit.deleteMany({ where });
    await client.phProduct.deleteMany({ where });
    await client.phCategory.deleteMany({ where });
  } finally {
    await client.$disconnect();
  }
}

/** A valid EAN-13 from 12 digits (the 13th is the check digit). */
function ean13(first12: string): string {
  const sum = [...first12].reduce((total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3), 0);
  return `${first12}${(10 - (sum % 10)) % 10}`;
}
const digits = (n: number) => Array.from({ length: n }, () => String(randomInt(10))).join('');

async function freshPage(browser: Browser, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

/** Signs in through the Studio's form and chooses the first place offered for the pharmacy ("All branches" for an owner). */
async function signInAndChoose(page: Page, user: StudioUser, shop: TestPharmacy): Promise<void> {
  await page.goto('/pharmacy');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shop.name }).getByRole('button').first().click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
}

const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/** A CSV of `rows` products; the rows at `bad` have no trade name. */
function sampleCsv(tag: string, rows: number, bad: readonly number[]): string {
  const lines = ['Trade name,Strength,Form,Pack,Units per pack,Price,Rx'];
  for (let i = 1; i <= rows; i++) {
    const name = bad.includes(i) ? '' : `Imported ${tag} ${String(i).padStart(2, '0')}`;
    lines.push(`${name},${i * 10} mg,tablet,box,${10 + i},${1000 + i * 250},OTC`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

test.describe('Pharmacy catalog @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];

  test.afterAll(async () => {
    await removeCatalogs(restaurants);
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  async function owned(label: string, locale: 'en' | 'ar' = 'en') {
    const shop = await makePharmacy(label);
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-cat-owner', name: 'Catalog Owner', locale });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    return { shop, owner };
  }

  test('the owner adds, finds, prices, imports and exports; a cashier only looks', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned('Catalog');
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop);

    // An empty catalog says so and offers the two ways to fill it.
    await page.getByRole('navigation').getByRole('link', { name: 'Catalog' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
    await expect(page.getByTestId('catalog-empty')).toBeVisible();
    await page.getByTestId('catalog-empty').getByRole('link', { name: 'Add a product' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/catalog\/new$/);

    // A product of box / strip / tablet with two barcodes, one with leading zeros.
    const tag = randomUUID().slice(0, 6);
    const tradeName = `Panadol ${tag}`;
    const arabicName = `باراسيتامول ${tag}`;
    const zeros = ean13(`00${digits(10)}`);
    const other = ean13(`62${digits(10)}`);
    await page.getByLabel('Trade name').fill(tradeName);
    await page.getByLabel('Generic name').fill(arabicName);
    await page.getByLabel(/^Strength/).fill('500 mg');
    await page.getByLabel(/^Form/).fill('tablet');
    await expect(page.getByLabel('Base unit: Unit name')).toHaveValue('tablet');
    await page.getByRole('button', { name: 'Add a larger pack' }).click();
    await page.getByLabel('Pack 1: Unit name').fill('strip');
    await page.getByLabel('Pack 1: Holds (base units)').fill('10');
    await page.getByRole('button', { name: 'Add a larger pack' }).click();
    await page.getByLabel('Pack 2: Unit name').fill('box');
    await page.getByLabel('Pack 2: Holds (base units)').fill('30');
    await expect(page.getByText('One box holds 30 tablet')).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    const scan = page.getByLabel('Scan or type a barcode');
    await page.getByLabel('On which pack', { exact: true }).selectOption({ label: 'box' });
    await scan.fill(zeros);
    await scan.press('Enter');
    await page.getByLabel('On which pack', { exact: true }).selectOption({ label: 'strip' });
    await scan.fill(other);
    await page.getByRole('button', { name: 'Add barcode' }).click();
    await expect(page.getByText(zeros, { exact: true })).toBeVisible();
    await expect(page.getByText(other, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/catalog\/(?!new)[^/]+$/);
    const productUrl = page.url();
    await expect(page.getByRole('heading', { level: 1, name: tradeName })).toBeVisible();
    await expect(page.getByText(zeros, { exact: true })).toBeVisible();

    // Found by barcode and by its Arabic name.
    await page.goto('/pharmacy/catalog');
    const search = page.getByLabel('Search the catalog');
    await search.fill(zeros);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row').first()).toContainText(tradeName);
    await expect(page.getByTestId('product-row').first()).toContainText('Barcode match');
    await search.fill(arabicName);
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row').first()).toContainText('500 mg');

    // A price change with a reason, then the history.
    await page.goto(productUrl);
    await page.getByRole('tab', { name: 'Prices' }).click();
    await page.getByLabel('Price', { exact: true }).fill('1250');
    await page.getByLabel('Reason', { exact: true }).fill('New supplier price');
    await page.getByRole('button', { name: 'Change price' }).click();
    await expect(page.getByText('Price changed')).toBeVisible();
    const history = page.getByRole('list', { name: 'Price history' });
    await expect(history.getByText('New supplier price')).toBeVisible();
    await expect(history.getByText('Current')).toBeVisible();

    // An import of 20 rows, two without a name: they are shown and left out, the rest are added.
    await page.goto('/pharmacy/catalog/import');
    await page.getByLabel('File', { exact: true }).setInputFiles({
      name: `sample-${tag}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(sampleCsv(tag, 20, [4, 11]), 'utf8'),
    });
    await page.getByRole('button', { name: 'Preview the file' }).click();
    const rowsToCheck = page.getByRole('list', { name: 'Rows to check' });
    // Rows are numbered as the spreadsheet shows them (the header is row 1): products 4 and 11 sit on rows 5 and 12.
    await expect(rowsToCheck.getByText(/^Row 5(?!\d)/)).toBeVisible();
    await expect(rowsToCheck.getByText(/^Row 12(?!\d)/)).toBeVisible();
    await expect(rowsToCheck.getByText('The trade name is empty.')).toHaveCount(2);
    await expect(page.getByText('2 rows with errors will be left out.')).toBeVisible();
    await page.getByRole('button', { name: 'Import the ready rows' }).click();
    await expect(page.getByText('Imported 18 products.')).toBeVisible();

    // The export streams a file with what was added.
    await page.goto('/pharmacy/catalog');
    await expect(page.getByTestId('product-row')).toHaveCount(19);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const exported = await (async () => {
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    })();
    expect(exported).toContain(tradeName);
    expect(exported).toContain(`Imported ${tag} 20`);
    expect(exported).not.toContain(`Imported ${tag} 04`);
    await page.context().close();

    // A cashier sees the list and a product, and nothing to change.
    const cashier = await createStudioUser({ label: 'ph-cat-cashier', name: 'Catalog Cashier' });
    people.push(cashier.email);
    await makeCashier(cashier.userId, shop.id);
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop);
    await till.goto('/pharmacy/catalog');
    await expect(till.getByTestId('product-row').first()).toBeVisible();
    await expect(till.getByRole('link', { name: 'Add a product' })).toHaveCount(0);
    await expect(till.getByRole('link', { name: 'Import a file' })).toHaveCount(0);
    await expect(till.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
    await expect(till.locator('[data-cost]')).toHaveCount(0);
    await expect(till.getByTestId('catalog-write-blocked')).toContainText('Your role can look at the catalog');
    await till.goto(productUrl);
    await expect(till.getByRole('heading', { level: 1, name: tradeName })).toBeVisible();
    await expect(till.getByRole('button', { name: 'Save product' })).toHaveCount(0);
    await expect(till.getByLabel('Trade name')).toBeDisabled();
    // No add or import screen for this role. The catalog streams (it has a loading screen), so the not-found page arrives
    // in the stream's body rather than as a 404 status: what the person sees is checked.
    for (const path of ['/pharmacy/catalog/new', '/pharmacy/catalog/import']) {
      await till.goto(path);
      await expect(till.getByText('This page could not be found.'), path).toBeVisible();
      await expect(till.getByRole('button', { name: /Save product|Preview the file/ }), path).toHaveCount(0);
    }
    await till.context().close();
  });

  test('an upload near 5 MB is read through the route; a larger one is refused before it is parsed', async ({ browser }) => {
    const { shop, owner } = await owned('Upload');
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop);
    const csv = (bytes: number) => {
      const header = 'Trade name,Pack,Units per pack,Rx\r\n';
      const row = (i: number) => `Large upload product ${String(i).padStart(5, '0')} ${'x'.repeat(380)},box,10,OTC\r\n`;
      let text = header;
      for (let i = 1; text.length < bytes; i++) text += row(i);
      return Buffer.from(text.slice(0, bytes), 'utf8');
    };
    const send = (buffer: Buffer) =>
      page.request.post('/pharmacy/catalog/import/preview', {
        headers: { origin: E2E_ORIGIN },
        multipart: { file: { name: 'large.csv', mimeType: 'text/csv', buffer } },
        timeout: 60_000,
      });

    // 4.5 MB: past a Server Action's 1 MB body limit, inside the import's 5 MB. The route reads it and answers in JSON.
    const near = await send(csv(4.5 * 1024 * 1024));
    expect(near.status()).toBe(200);
    const nearBody = (await near.json()) as { ok: boolean; data?: { summary: { rows: number } }; error?: { fields?: Record<string, string> } };
    expect(nearBody.error?.fields?.phCode).not.toBe('FILE_TOO_LARGE');
    if (nearBody.ok) expect(nearBody.data!.summary.rows).toBeGreaterThan(9_000);

    // 5.5 MB: refused as too large, with the reason, before anything is parsed.
    const over = await send(csv(5.5 * 1024 * 1024));
    expect(over.status()).toBe(413);
    expect(((await over.json()) as { error: { fields: Record<string, string> } }).error.fields.phCode).toBe('FILE_TOO_LARGE');
    await page.context().close();
  });

  test('reads in Arabic right to left with no sideways scroll at 375, 768 and 1280px, and passes axe', async ({ browser }) => {
    test.setTimeout(120_000);
    const { shop, owner } = await owned('Arabic', 'ar');
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // One product with a long mixed-script name, so the list and the editor have something to wrap.
    await page.goto('/pharmacy/catalog/new');
    const name = 'باراسيتامول Paracetamol پاراسێتامۆڵ 500 mg '.repeat(3).trim();
    await page.getByLabel('الاسم التجاري').fill(name);
    await page.getByRole('button', { name: 'حفظ المنتج' }).click();
    await expect(page).toHaveURL(/\/pharmacy\/catalog\/(?!new)[^/]+$/);
    const productUrl = page.url();

    for (const path of ['/pharmacy/catalog', productUrl, '/pharmacy/catalog/import']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await scrollsSideways(page), `${path} at ${width}px`).toBe(false);
        expect(await seriousViolations(page), `${path} at ${width}px`).toEqual([]);
      }
    }
    await page.context().close();
  });
});
