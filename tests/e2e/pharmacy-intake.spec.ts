import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { generateInvoices, modelTextFor, renderInvoicePng } from '../pharmacy/fixtures/intake-invoices';
import { blurredPage } from '../pharmacy/intake-helpers';
import { INTAKE_SCRIPT_PATH } from './helpers/intake-env';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * Invoice by photo (phase 5, task 8): the list with this month's AI figures, "New batch" with the upload queue, and the
 * batch detail with each file's state. One serial run over one pharmacy: a generated invoice picture is stored, read by the
 * scripted provider and shown as Read; a blurred picture is refused with the retake hint; the same file again is "already
 * uploaded"; a failed reading shows its sentence with "Enter manually instead" and a retry that works; a used-up budget
 * stops "Read all"; a lost answer to the batch creation finds the same batch again; the list of files survives a reload;
 * the screens keep the form offline; a stock clerk sees the AI controls disabled with the reason; a cashier is locked out;
 * a pharmacy past its grace period is read-only; and every new screen passes axe and does not scroll sideways at 375, 768
 * and 1280 px in English, Arabic and Sorani.
 *
 * Run it only through `playwright.intake.config.ts`: that config starts its own dev server with the scripted provider and sets
 * `PH_INTAKE_E2E_CONFIG`; without it the suite skips, so it can never send these invoices to a real provider.
 *
 * The AI is the scripted provider (`AI_PROVIDER=scripted`, `PH_INTAKE_E2E_SCRIPT=<json>`): the dev server this run drives
 * reads the answer for each file's SHA-256 from that file on every call. The hook exists only outside production. The run
 * needs the dev server to be started with that variable and the two model prices (see the playwright config used for it).
 * Everything is written straight to the development database and removed afterwards. Screenshots go to INTAKE_SHOTS.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const SHOTS = process.env.INTAKE_SHOTS;
const WIDTHS = [375, 768, 1280] as const;
const SCRIPT = INTAKE_SCRIPT_PATH;
const INVOICES = generateInvoices();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** What the scripted provider answers, by file hash; written whole to the file the dev server reads on every call. */
const script: Record<string, unknown> = {};
function setScript(entries: Record<string, unknown>): void {
  Object.assign(script, entries);
  writeFileSync(SCRIPT, JSON.stringify(script));
}

interface TestPharmacy {
  id: string;
  name: string;
  branchIds: string[];
}

async function makePharmacy(label: string): Promise<TestPharmacy> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branchIds: string[] = [];
    for (const [i, branch] of ['Main street', 'Airport road'].entries()) {
      const created = await client.branch.create({ data: { restaurantId: row.id, name: `${branch} ${label}`, sortOrder: i }, select: { id: true } });
      branchIds.push(created.id);
    }
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    return { id: row.id, name, branchIds };
  } finally {
    await client.$disconnect();
  }
}

/** The subscription ended `endedDaysAgo` days ago (more than the 7 grace days reads as read-only); a negative number reopens it. */
async function endSubscription(shop: TestPharmacy, endedDaysAgo: number): Promise<void> {
  const client = db();
  try {
    await client.subscription.updateMany({ where: { restaurantId: shop.id }, data: { currentPeriodEnd: new Date(Date.now() - endedDaysAgo * DAY) } });
  } finally {
    await client.$disconnect();
  }
}

async function makeStaff(userId: string, restaurantId: string, role: 'CASHIER' | 'STOCK'): Promise<void> {
  const client = db();
  try {
    const branches = await client.branch.findMany({ where: { restaurantId }, select: { id: true } });
    const staff = await client.phStaff.create({ data: { userId, restaurantId, role }, select: { id: true } });
    for (const branch of branches) await client.phStaffBranch.create({ data: { restaurantId, staffId: staff.id, branchId: branch.id } });
  } finally {
    await client.$disconnect();
  }
}

async function makeSupplier(shop: TestPharmacy, userId: string): Promise<string> {
  const client = db();
  try {
    const name = `Al Noor ${randomUUID().slice(0, 5)}`;
    await client.phSupplier.create({ data: { restaurantId: shop.id, name, nameKey: name.toLowerCase(), defaultCurrency: 'IQD', termsDays: 30, clientKey: `e2e-${randomUUID()}`, createdById: userId } });
    return name;
  } finally {
    await client.$disconnect();
  }
}

const LINE = { name: 'Panadol', strength: '500 mg', form: 'tablet', pack: '10 strip', quantity: 10, bonus: 0, unitCost: 1000, lineTotal: 10000, lot: 'A1', expiry: '2027-03', barcodeText: null, unclear: [], page: 1 };

/** A batch holding one file in each state, written directly (no stored objects), for the state and accessibility checks. */
async function seedZoo(shop: TestPharmacy, userId: string): Promise<{ batchId: string; uploadedFileId: string }> {
  const client = db();
  try {
    const batch = await client.phIntakeBatch.create({
      data: { restaurantId: shop.id, branchId: shop.branchIds[0]!, clientKey: `zoo-${randomUUID()}`, payloadHash: 'seed', createdById: userId, header: { extracted: { supplierName: 'Zoo', invoiceNumber: 'Z-1', currency: 'IQD', total: 20000 } } },
      select: { id: true },
    });
    const file = async (status: 'UPLOADED' | 'REJECTED_QUALITY' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED' | 'PURGED', extra: Record<string, unknown> = {}) =>
      client.phIntakeFile.create({
        data: {
          restaurantId: shop.id,
          batchId: batch.id,
          sha256: createHash('sha256').update(`zoo-${status}-${batch.id}`).digest('hex'),
          storageKey: null,
          mediaType: 'image/png',
          bytes: 123_456,
          pages: 1,
          status,
          uploadedById: userId,
          expiresAt: new Date(Date.now() + 30 * DAY),
          ...extra,
        },
        select: { id: true },
      });
    const uploaded = await file('UPLOADED');
    await file('REJECTED_QUALITY', { failureCode: 'BLURRY,TOO_DARK' });
    await file('EXTRACTING', { extractingSince: new Date(), attempts: 1 });
    const read = await file('EXTRACTED', { extractedAt: new Date(), attempts: 1 });
    await file('FAILED', { failureCode: 'AI_BUDGET_REACHED', attempts: 1 });
    await file('PURGED');
    for (const lineNo of [1, 2]) await client.phIntakeRow.create({ data: { restaurantId: shop.id, fileId: read.id, lineNo, page: 1, extracted: LINE } });
    return { batchId: batch.id, uploadedFileId: uploaded.id };
  } finally {
    await client.$disconnect();
  }
}

/** The Baghdad month the budget is counted in, as `yyyy-mm`. */
const baghdadMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit' }).format(new Date());

async function setSpent(shop: TestPharmacy, micro: bigint | null): Promise<void> {
  const client = db();
  try {
    const month = baghdadMonth();
    await client.phAiUsageMonth.deleteMany({ where: { restaurantId: shop.id, month } });
    if (micro !== null) await client.phAiUsageMonth.create({ data: { restaurantId: shop.id, month, spentMicroUsd: micro } });
  } finally {
    await client.$disconnect();
  }
}

async function batchCount(shop: TestPharmacy): Promise<number> {
  const client = db();
  try {
    return await client.phIntakeBatch.count({ where: { restaurantId: shop.id } });
  } finally {
    await client.$disconnect();
  }
}

async function setFile(fileId: string, data: Record<string, unknown>): Promise<void> {
  const client = db();
  try {
    await client.phIntakeFile.update({ where: { id: fileId }, data });
  } finally {
    await client.$disconnect();
  }
}

async function fileIdBySha(shop: TestPharmacy, hash: string): Promise<string | null> {
  const client = db();
  try {
    return (await client.phIntakeFile.findFirst({ where: { restaurantId: shop.id, sha256: hash }, select: { id: true } }))?.id ?? null;
  } finally {
    await client.$disconnect();
  }
}

/** A batch whose only file has been "being read" for 15 minutes: its reading died, past the server's 10 minute lease. */
async function seedStale(shop: TestPharmacy, userId: string): Promise<string> {
  const client = db();
  try {
    const batch = await client.phIntakeBatch.create({ data: { restaurantId: shop.id, branchId: shop.branchIds[0]!, clientKey: `stale-${randomUUID()}`, payloadHash: 'seed', createdById: userId }, select: { id: true } });
    await client.phIntakeFile.create({
      data: { restaurantId: shop.id, batchId: batch.id, sha256: createHash('sha256').update(`stale-${batch.id}`).digest('hex'), storageKey: null, mediaType: 'image/png', bytes: 1000, pages: 1, status: 'EXTRACTING', extractingSince: new Date(Date.now() - 15 * 60_000), attempts: 1, uploadedById: userId, expiresAt: new Date(Date.now() + 30 * DAY) },
    });
    return batch.id;
  } finally {
    await client.$disconnect();
  }
}

async function freshPage(browser: Browser, viewport: { width: number; height: number } = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

/** A signed-in person's cookies, by person and place: the Studio limits sign-ins per account. */
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** Signs in and chooses a place: `branch` 0 is "All branches" for an owner, 1 the first branch. */
async function signInAndChoose(page: Page, user: StudioUser, shop: TestPharmacy, branch = 0): Promise<void> {
  const key = `${user.email}:${shop.id}:${branch}`;
  const saved = sessions.get(key);
  if (saved) {
    await page.context().addCookies(saved.cookies);
    await page.goto('/pharmacy/home');
    if (/\/pharmacy\/home$/.test(page.url())) return;
  }
  await page.goto('/pharmacy');
  await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shop.name }).getByRole('button').nth(branch).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
  sessions.set(key, await page.context().storageState());
}

const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

/** At 375, 768 and 1280 px: no sideways scroll and no serious axe violation. Screenshots when `shot` names the screen. */
async function checkWidths(page: Page, url: string, lang: 'en' | 'ar' | 'ckb', shot?: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    expect(await scrollsSideways(page), `${lang} ${url} at ${width}px`).toBe(false);
    expect(await seriousViolations(page), `${lang} ${url} at ${width}px`).toEqual([]);
    if (shot) await shoot(page, `${lang}-${shot}-${width}`);
  }
}

const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });

test.describe('Pharmacy invoice by photo @desktop', () => {
  // One worker, one order: the hooks switch the shared pharmacy application on and then put it back, and the tests follow
  // one pharmacy's batches from the first upload to the last accessibility pass.
  test.describe.configure({ mode: 'serial' });
  test.skip(process.env.PH_INTAKE_E2E_CONFIG !== '1', 'run through playwright.intake.config.ts (its own server with the scripted AI provider)');
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let planMade = false;
  const world: { shop?: TestPharmacy; owner?: StudioUser; supplier?: string; zoo?: { batchId: string; uploadedFileId: string } } = {};

  test.beforeAll(async () => {
    writeFileSync(SCRIPT, '{}');
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
      // The plan the pharmacy's subscription names: room for the files and a ten dollar AI budget a month.
      if (!(await client.appPlan.findUnique({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, select: { code: true } }))) {
        await client.appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 1000 } } });
        planMade = true;
      }
    } finally {
      await client.$disconnect();
    }
  });

  test.afterAll(async () => {
    const client = db();
    try {
      if (applicationWas) await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      if (planMade) await client.appPlan.delete({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } } });
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
    rmSync(SCRIPT, { force: true });
  });

  async function owned() {
    if (world.shop && world.owner) return { shop: world.shop, owner: world.owner };
    const shop = await makePharmacy('Intake');
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-intake-owner', name: 'Intake Owner' });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    world.shop = shop;
    world.owner = owner;
    world.supplier = await makeSupplier(shop, owner.userId);
    return { shop, owner };
  }

  /** The batch with a file in each state, made the first time a test needs it (the first test wants an empty list). */
  async function zoo(): Promise<{ batchId: string; uploadedFileId: string }> {
    const { shop, owner } = await owned();
    world.zoo ??= await seedZoo(shop, owner.userId);
    return world.zoo;
  }

  /** Uploads these files through the screen as a new batch and opens it; returns the batch's address. */
  async function uploadBatch(page: Page, files: ReturnType<typeof file>[]): Promise<string> {
    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-pick').setInputFiles(files);
    await expect(page.getByTestId('up-item')).toHaveCount(files.length);
    await page.getByTestId('intake-start').click();
    await expect(page.getByTestId('intake-open-batch')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('intake-open-batch').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/intake\/(?!new$)[^/?]+$/);
    await expect(page.getByTestId('intake-batch')).toBeVisible();
    return new URL(page.url()).pathname;
  }

  const good = (n: number) => renderInvoicePng(INVOICES[n]!);

  test('upload, store, read: a picture becomes Read with its lines; a blurred one is refused with the retake hint; the same file again is already uploaded; cancel closes the batch', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);

    // The list before anything: the feature in one sentence, the budget as figures and a bar.
    await page.goto('/pharmacy/purchasing/intake');
    await expect(page.getByTestId('intake-empty')).toContainText('Invoice by photo reads a supplier’s invoice');
    await expect(page.getByTestId('usage-budget')).toHaveText('$10.00');
    await expect(page.getByTestId('usage-spent')).toHaveText('$0.00');
    await expect(page.getByRole('meter', { name: 'Budget used' })).toHaveAttribute('aria-valuenow', '0');
    await shoot(page, 'en-list-empty-1280');

    const png = await good(0);
    setScript({ [sha(png)]: modelTextFor(INVOICES[0]!) });
    const blurry = await blurredPage(31);
    await page.getByTestId('intake-new').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/intake\/new$/);
    await page.getByTestId('intake-supplier').selectOption({ label: world.supplier! });
    await page.getByTestId('intake-pick').setInputFiles([file('invoice-1.png', 'image/png', png), file('blurry.jpg', 'image/jpeg', blurry), file('notes.txt', 'text/plain', Buffer.from('not an invoice'))]);
    const items = page.getByTestId('up-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(2)).toHaveAttribute('data-state', 'invalid');
    await expect(items.nth(2)).toContainText('Only JPEG, PNG, WebP and PDF');
    await expect(items.nth(0)).toHaveAttribute('data-state', 'queued');
    await shoot(page, 'en-new-chosen-1280');
    await page.getByTestId('intake-start').click();
    await expect(items.nth(0)).toHaveAttribute('data-state', 'stored', { timeout: 60_000 });
    await expect(items.nth(1)).toHaveAttribute('data-state', 'rejected', { timeout: 60_000 });
    await expect(items.nth(1).getByTestId('quality-reasons')).toContainText('blurry');
    await expect(items.nth(1).getByTestId('quality-reasons')).toContainText('Retake the photo in good light');

    // The same bytes again are not stored twice.
    await page.getByTestId('intake-pick').setInputFiles([file('invoice-copy.png', 'image/png', png)]);
    await expect(items).toHaveCount(4);
    await page.getByTestId('intake-start').click();
    await expect(items.nth(3)).toHaveAttribute('data-state', 'duplicate', { timeout: 60_000 });
    await expect(items.nth(3)).toContainText('already uploaded');
    // The counts, not just the labels: one stored, one rejected, one already uploaded, none failed or waiting.
    const count = (label: string) => page.getByTestId('intake-summary').locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd');
    await expect(count('Stored')).toHaveText('1');
    await expect(count('Rejected')).toHaveText('1');
    await expect(count('Already uploaded')).toHaveText('1');
    await expect(count('Failed')).toHaveText('0');
    await expect(count('Waiting')).toHaveText('0');
    await shoot(page, 'en-new-uploaded-1280');

    await page.getByTestId('intake-open-batch').click();
    await expect(page).toHaveURL(/\/pharmacy\/purchasing\/intake\/(?!new$)[^/?]+$/);
    const batchUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId('intake-status')).toContainText('Open');
    await expect(page.getByTestId('intake-view')).toContainText(world.supplier!);
    const files = page.getByTestId('intake-file');
    await expect(files).toHaveCount(2);
    await expect(files.nth(0)).toHaveAttribute('data-state', 'UPLOADED');
    await expect(files.nth(1)).toHaveAttribute('data-state', 'REJECTED_QUALITY');
    await expect(files.nth(1).getByTestId('quality-reasons')).toContainText('blurry');
    await expect(files.nth(1).getByTestId('file-manual')).toBeVisible();

    // The picture comes from a signed link made on request.
    await files.nth(0).getByTestId('file-show').click();
    const picture = files.nth(0).getByTestId('file-picture').locator('img');
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await shoot(page, 'en-detail-uploaded-1280');

    // Read invoice: Read, with the number of lines the scripted answer holds.
    await files.nth(0).getByTestId('file-read').click();
    await expect(files.nth(0)).toHaveAttribute('data-state', 'EXTRACTED', { timeout: 60_000 });
    await expect(files.nth(0).getByTestId('file-lines')).toHaveText(String(INVOICES[0]!.lines.length));
    await expect(files.nth(0).getByTestId('file-read')).toHaveCount(0);
    await expect(page.getByTestId('intake-review-slot')).toBeVisible();
    await shoot(page, 'en-detail-read-1280');

    // The list: one batch, two files, the lines read, one file that needs attention, and the budget now spent.
    await page.goto('/pharmacy/purchasing/intake');
    const row = page.getByTestId('intake-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(world.supplier!);
    await expect(row).toContainText('Files: 2');
    await expect(row).toContainText(`Lines read: ${INVOICES[0]!.lines.length}`);
    await expect(row.getByTestId('intake-attention')).toContainText('Needs attention: 1');
    await expect(page.getByTestId('usage-spent')).not.toHaveText('$0.00');
    // The figures moved with the reading: spent is more than nothing and the bar says so.
    await expect(page.getByRole('meter', { name: 'Budget used' })).not.toHaveAttribute('aria-valuenow', '0');
    await shoot(page, 'en-list-1280');
    await page.getByRole('navigation', { name: 'Filter batches by state' }).getByRole('link', { name: 'Approved' }).click();
    await expect(page.getByTestId('intake-empty')).toContainText('No batches in this state');

    // Cancel: asks first, closes the batch, and its files are gone.
    await page.goto(batchUrl);
    await page.getByTestId('intake-cancel').click();
    await expect(page.getByTestId('intake-cancel-form')).toContainText('deletes its uploaded files');
    await page.getByTestId('intake-cancel-form').getByRole('textbox').fill('Wrong supplier');
    await page.getByTestId('intake-cancel-yes').click();
    await expect(page.getByTestId('intake-cancelled')).toBeVisible();
    await expect(page.getByTestId('intake-status')).toContainText('Cancelled');
    await expect(page.getByTestId('intake-file').nth(0)).toHaveAttribute('data-state', 'PURGED');
    await expect(page.getByTestId('file-read')).toHaveCount(0);
    await page.goto('/pharmacy/purchasing/intake?status=CANCELLED');
    await expect(page.getByTestId('intake-row')).toHaveCount(1);
    await page.context().close();
  });

  test('a failed reading shows its sentence and "Enter manually instead", and Try again works', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    const png = await good(1);
    setScript({ [sha(png)]: { error: 'error' } });
    await uploadBatch(page, [file('invoice-2.png', 'image/png', png)]);
    const one = page.getByTestId('intake-file');
    await one.getByTestId('file-read').click();
    await expect(one).toHaveAttribute('data-state', 'FAILED', { timeout: 60_000 });
    await expect(one.getByTestId('file-failure')).toHaveAttribute('data-code', 'AI_PROVIDER_ERROR');
    await expect(one.getByTestId('file-failure')).toContainText('The AI service did not answer');
    await expect(one.getByTestId('file-manual')).toHaveAttribute('href', '/pharmacy/stock/receive/new');
    await expect(page.getByTestId('intake-manual')).toBeVisible();
    await shoot(page, 'en-detail-failed-1280');
    // The service answers this time.
    setScript({ [sha(png)]: modelTextFor(INVOICES[1]!) });
    await one.getByTestId('file-retry').click();
    await expect(one).toHaveAttribute('data-state', 'EXTRACTED', { timeout: 60_000 });
    await expect(one.getByTestId('file-lines')).toHaveText(String(INVOICES[1]!.lines.length));
    await expect(one.getByTestId('file-failure')).toHaveCount(0);
    await page.context().close();
  });

  test('a used-up budget is said in words and stops "Read all" after the first file; with budget back it reads the rest one at a time', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    const a = await good(2);
    const b = await good(3);
    setScript({ [sha(a)]: modelTextFor(INVOICES[2]!), [sha(b)]: modelTextFor(INVOICES[3]!) });
    const url = await uploadBatch(page, [file('a.png', 'image/png', a), file('b.png', 'image/png', b)]);
    await setSpent(shop, 10_000_000n);
    try {
      await page.getByTestId('intake-read-all').click();
      const files = page.getByTestId('intake-file');
      await expect(files.nth(0)).toHaveAttribute('data-state', 'FAILED', { timeout: 60_000 });
      await expect(files.nth(0).getByTestId('file-failure')).toHaveAttribute('data-code', 'AI_BUDGET_REACHED');
      await expect(files.nth(0).getByTestId('file-failure')).toContainText('budget is used up');
      await expect(page.getByTestId('intake-run-note')).toContainText('Stopped because the next file would fail');
      await expect(files.nth(1)).toHaveAttribute('data-state', 'UPLOADED');
      await expect(files.nth(0).getByTestId('file-manual')).toBeVisible();
      await shoot(page, 'en-detail-budget-1280');
      await page.goto('/pharmacy/purchasing/intake');
      await expect(page.getByTestId('usage-used')).toContainText('budget is used up');
      await expect(page.getByTestId('usage-remaining')).toHaveText('$0.00');
      await shoot(page, 'en-list-budget-1280');
    } finally {
      await setSpent(shop, null);
    }
    await page.goto(url);
    await page.getByTestId('intake-read-all').click();
    await expect(page.getByTestId('intake-file').nth(1)).toHaveAttribute('data-state', 'EXTRACTED', { timeout: 60_000 });
    await expect(page.getByTestId('intake-file').nth(0)).toHaveAttribute('data-state', 'FAILED');
    await page.getByTestId('intake-file').nth(0).getByTestId('file-retry').click();
    await expect(page.getByTestId('intake-file').nth(0)).toHaveAttribute('data-state', 'EXTRACTED', { timeout: 60_000 });
    await page.context().close();
  });

  test('a file being read refreshes the batch every few seconds with the word Reading and stops when it ends', async ({ browser }) => {
    test.setTimeout(120_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    const png = await good(4);
    const url = await uploadBatch(page, [file('slow.png', 'image/png', png)]);
    const only = page.getByTestId('intake-file');
    const id = await fileIdBySha(shop, sha(png));
    expect(id).toBeTruthy();
    // Another tab (here: the database) says a reading started; the page reloads and shows it.
    await setFile(id!, { status: 'EXTRACTING', extractingSince: new Date(), attempts: 1 });
    await page.goto(url);
    await expect(only).toHaveAttribute('data-state', 'EXTRACTING');
    await expect(only.getByTestId('file-reading')).toContainText('Reading…');
    // It ends elsewhere; the open page notices on its own, without a reload.
    await setFile(id!, { status: 'UPLOADED', extractingSince: null });
    await expect(only).toHaveAttribute('data-state', 'UPLOADED', { timeout: 15_000 });
    await expect(only.getByTestId('file-reading')).toHaveCount(0);
    // And it stops: with nothing being read, no further refresh goes out (a refresh is a Server Action POST to this page).
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url());
    });
    await page.waitForTimeout(8_000);
    expect(posts).toEqual([]);
    await page.context().close();
  });

  test('a lost answer to the batch creation finds the same batch again, and the list of files survives a reload', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    const before = await batchCount(shop);
    const png = await good(5);
    setScript({ [sha(png)]: modelTextFor(INVOICES[5]!) });
    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-pick').setInputFiles([file('lost-answer.png', 'image/png', png)]);
    // The first Server Action (the batch is made) does its work and its answer never arrives.
    let aborted = false;
    await page.route('**/pharmacy/purchasing/intake/new', async (route) => {
      const request = route.request();
      if (!aborted && request.method() === 'POST' && request.headers()['next-action']) {
        aborted = true;
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await page.getByTestId('intake-start').click();
    await expect(page.getByTestId('intake-error')).toBeVisible({ timeout: 30_000 });
    expect(aborted).toBe(true);
    expect(await batchCount(shop)).toBe(before + 1);
    // Trying again sends the same key: the server finds the batch it already made.
    await page.getByTestId('intake-start').click();
    await expect(page.getByTestId('up-item').first()).toHaveAttribute('data-state', 'stored', { timeout: 60_000 });
    expect(await batchCount(shop)).toBe(before + 1);
    await page.unroute('**/pharmacy/purchasing/intake/new');

    // A file chosen but not sent is listed after a reload, but its bytes are gone: it says to choose it again.
    await page.getByTestId('intake-pick').setInputFiles([file('waiting.png', 'image/png', await good(6))]);
    await expect(page.getByTestId('up-item')).toHaveCount(2);
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('intake-resumed')).toBeVisible();
    const listed = page.getByTestId('up-item');
    await expect(listed).toHaveCount(2);
    await expect(listed.nth(0)).toHaveAttribute('data-state', 'stored');
    await expect(listed.nth(1)).toHaveAttribute('data-state', 'lost');
    await expect(listed.nth(1)).toContainText('Choose it again');
    await shoot(page, 'en-new-resumed-1280');
    await page.context().close();
  });

  test('offline keeps the form: the notice shows, upload is off, the list stays, and it works again online', async ({ browser }) => {
    test.setTimeout(120_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-pick').setInputFiles([file('offline.png', 'image/png', await good(7))]);
    await expect(page.getByTestId('up-item')).toHaveCount(1);
    await page.context().setOffline(true);
    await expect(page.getByTestId('stock-offline')).toBeVisible();
    await expect(page.getByTestId('intake-start')).toBeDisabled();
    await expect(page.getByTestId('up-item')).toHaveCount(1);
    await page.context().setOffline(false);
    await expect(page.getByTestId('stock-offline')).toHaveCount(0);
    await expect(page.getByTestId('intake-start')).toBeEnabled();
    await page.context().close();
  });

  test('a stock clerk sees everything but the AI controls are disabled with the reason; a cashier is locked out', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop } = await owned();
    await zoo();
    const stock = await createStudioUser({ label: 'ph-intake-stock', name: 'Intake Stock' });
    people.push(stock.email);
    await assignMember(stock.userId, shop.id, 'OWNER').catch(() => undefined);
    // A member with a stock role only: replace the owner membership by a staff role.
    const client = db();
    try {
      await client.membership.deleteMany({ where: { userId: stock.userId, restaurantId: shop.id } });
    } finally {
      await client.$disconnect();
    }
    await makeStaff(stock.userId, shop.id, 'STOCK');
    const page = await freshPage(browser);
    await signInAndChoose(page, stock, shop, 0);
    await page.goto('/pharmacy/purchasing/intake');
    await expect(page.getByTestId('intake-row').first()).toBeVisible();
    await expect(page.getByTestId('intake-new')).toBeDisabled();
    await expect(page.getByTestId('intake-new-why')).toContainText('cannot read invoices with the AI');
    await page.goto('/pharmacy/purchasing/intake/new');
    await expect(page.getByTestId('intake-new-blocked')).toContainText('cannot read invoices with the AI');
    await expect(page.getByTestId('intake-upload')).toHaveCount(0);
    await page.goto(`/pharmacy/purchasing/intake/${(await zoo()).batchId}`);
    const uploaded = page.getByTestId('intake-file').filter({ has: page.locator('[data-chip="uploaded"]') });
    await expect(uploaded.getByTestId('file-read')).toBeDisabled();
    await expect(uploaded.getByTestId('file-read-why')).toContainText('Your role cannot use the AI');
    await expect(uploaded.getByTestId('file-manual')).toBeVisible();
    const failed = page.getByTestId('intake-file').filter({ has: page.locator('[data-chip="failed"]') });
    await expect(failed.getByTestId('file-retry')).toBeDisabled();
    await expect(failed.getByTestId('file-retry-why')).toContainText('Your role cannot use the AI');
    await expect(page.getByTestId('intake-read-all')).toBeDisabled();
    await expect(page.getByTestId('intake-noai-note')).toBeVisible();
    await expect(page.getByTestId('intake-cancel')).toBeEnabled();
    // The picture can still be looked at: seeing is `purchase.manage`.
    await shoot(page, 'en-detail-stock-1280');
    await page.context().close();

    const cashier = await createStudioUser({ label: 'ph-intake-cashier', name: 'Intake Cashier' });
    people.push(cashier.email);
    await makeStaff(cashier.userId, shop.id, 'CASHIER');
    const till = await freshPage(browser);
    await signInAndChoose(till, cashier, shop, 0);
    for (const url of ['/pharmacy/purchasing/intake', '/pharmacy/purchasing/intake/new', `/pharmacy/purchasing/intake/${(await zoo()).batchId}`]) {
      await till.goto(url);
      await expect(till.getByTestId('purchasing-forbidden'), url).toContainText('Purchasing is not available to you');
      await expect(till.getByTestId('intake-row')).toHaveCount(0);
      await expect(till.getByTestId('intake-file')).toHaveCount(0);
      await expect(till.getByTestId('intake-upload')).toHaveCount(0);
    }
    await till.context().close();
  });

  test('a reading that died is said in words, offers Try again and Enter manually, and is not polled for ever', async ({ browser }) => {
    test.setTimeout(120_000);
    const { shop, owner } = await owned();
    const batchId = await seedStale(shop, owner.userId);
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url());
    });
    await page.goto(`/pharmacy/purchasing/intake/${batchId}`);
    const only = page.getByTestId('intake-file');
    await expect(only).toHaveAttribute('data-stale', 'true');
    await expect(only.getByTestId('file-stale')).toContainText('The reading did not finish');
    await expect(only.getByTestId('file-reading')).toHaveCount(0);
    await expect(only.getByTestId('file-retry')).toBeEnabled();
    await expect(only.getByTestId('file-manual')).toBeVisible();
    // Nothing refreshes it: no Server Action goes out while the page sits there.
    await page.waitForTimeout(8_000);
    expect(posts).toEqual([]);
    await shoot(page, 'en-detail-stale-1280');
    await page.context().close();
  });

  test('a lost answer to a file upload: sending again shows the file the server kept, with its reasons and the retake hint', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-pick').setInputFiles([file('lost-blur.jpg', 'image/jpeg', await blurredPage(41))]);
    let aborted = false;
    await page.route('**/api/pharmacy/intake/files', async (route) => {
      if (!aborted) {
        aborted = true;
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });
    await page.getByTestId('intake-start').click();
    // The connection broke after the server did the work: the file waits (it is not marked failed) and the screen says it paused.
    await expect(page.getByTestId('intake-paused')).toBeVisible({ timeout: 60_000 });
    expect(aborted).toBe(true);
    const item = page.getByTestId('up-item').first();
    await expect(item).toHaveAttribute('data-state', 'queued');
    await page.getByTestId('intake-start').click();
    // The same file comes back as the server's rejected picture: reasons and retake hint, not a green "Already uploaded".
    await expect(item).toHaveAttribute('data-state', 'rejected', { timeout: 60_000 });
    await expect(item.getByTestId('quality-reasons')).toContainText('blurry');
    await expect(item.getByTestId('quality-reasons')).toContainText('Retake the photo in good light');
    await page.unroute('**/api/pharmacy/intake/files');
    await page.context().close();
  });

  test('the connection going in the middle of a queue pauses it: the rest stay waiting and go when it is back', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-pick').setInputFiles([file('q1.png', 'image/png', await good(11)), file('q2.png', 'image/png', await good(12)), file('q3.png', 'image/png', await good(13))]);
    await page.route('**/api/pharmacy/intake/files', (route) => route.abort('connectionreset'));
    await page.getByTestId('intake-start').click();
    await expect(page.getByTestId('intake-paused')).toBeVisible({ timeout: 60_000 });
    const items = page.getByTestId('up-item');
    for (const i of [0, 1, 2]) await expect(items.nth(i)).toHaveAttribute('data-state', 'queued');
    await expect(page.getByTestId('intake-summary').locator('dt', { hasText: /^Failed$/ }).locator('xpath=following-sibling::dd')).toHaveText('0');
    await page.unroute('**/api/pharmacy/intake/files');
    await page.getByTestId('intake-start').click();
    for (const i of [0, 1, 2]) await expect(items.nth(i)).toHaveAttribute('data-state', 'stored', { timeout: 60_000 });
    await expect(page.getByTestId('intake-paused')).toHaveCount(0);
    await page.context().close();
  });

  test('a file already in another batch of the branch says so and links to that batch', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    const png = await good(14);
    const firstUrl = await uploadBatch(page, [file('shared.png', 'image/png', png)]);
    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-pick').setInputFiles([file('shared-again.png', 'image/png', png)]);
    await page.getByTestId('intake-start').click();
    const item = page.getByTestId('up-item').first();
    await expect(item).toHaveAttribute('data-state', 'elsewhere', { timeout: 60_000 });
    await expect(page.getByTestId('up-elsewhere')).toContainText('already uploaded in another batch');
    await expect(page.getByTestId('up-elsewhere-link')).toHaveAttribute('href', firstUrl);
    // It is not counted as stored in this batch.
    const count = (label: string) => page.getByTestId('intake-summary').locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd');
    await expect(count('Stored')).toHaveText('0');
    await expect(count('In another batch')).toHaveText('1');
    await shoot(page, 'en-new-elsewhere-1280');
    await page.context().close();
  });

  test('a pharmacy past its grace period is read-only: the reason in words, no upload, no reading, no cancel', async ({ browser }) => {
    test.setTimeout(180_000);
    const { shop, owner } = await owned();
    await zoo();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await endSubscription(shop, 10);
    try {
      await page.goto('/pharmacy/purchasing/intake');
      await expect(page.getByTestId('receive-write-blocked')).toContainText('subscription has lapsed');
      await expect(page.getByTestId('intake-new')).toBeDisabled();
      await expect(page.getByTestId('intake-row').first()).toBeVisible();
      await page.goto('/pharmacy/purchasing/intake/new');
      await expect(page.getByTestId('receive-write-blocked')).toBeVisible();
      await expect(page.getByTestId('intake-upload')).toHaveCount(0);
      await page.goto(`/pharmacy/purchasing/intake/${(await zoo()).batchId}`);
      await expect(page.getByTestId('receive-write-blocked')).toBeVisible();
      const uploaded = page.getByTestId('intake-file').filter({ has: page.locator('[data-chip="uploaded"]') });
      await expect(uploaded.getByTestId('file-read')).toBeDisabled();
      await expect(uploaded.getByTestId('file-read-why')).toContainText('read-only');
      await expect(page.getByTestId('intake-cancel')).toBeDisabled();
      await expect(page.getByTestId('intake-cancel-why')).toContainText('read-only');
      await shoot(page, 'en-read-only-1280');
      await page.setViewportSize({ width: 375, height: 800 });
      await shoot(page, 'en-read-only-375');
    } finally {
      await endSubscription(shop, -29);
    }
    await page.context().close();
  });

  for (const lang of ['en', 'ar', 'ckb'] as const) {
    test(`the intake screens pass axe and do not scroll sideways at 375, 768 and 1280px in ${{ en: 'English', ar: 'Arabic', ckb: 'Sorani' }[lang]}`, async ({ browser }) => {
      test.setTimeout(420_000);
      const { shop, owner } = await owned();
      await zoo();
      if (lang !== 'en') await setUserLocale(owner.userId, lang);
      try {
        const page = await freshPage(browser, { width: 375, height: 800 });
        await signInAndChoose(page, owner, shop, 1);
        if (lang !== 'en') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        // The list with batches, a failure count and the budget figures.
        await page.goto('/pharmacy/purchasing/intake');
        await expect(page.getByTestId('intake-row').first()).toBeVisible();
        await expect(page.getByTestId('intake-usage')).toBeVisible();
        await checkWidths(page, 'list', lang, 'list');
        // The hub card.
        await page.goto('/pharmacy/purchasing');
        await expect(page.getByTestId('hub-intake')).toBeVisible();
        await checkWidths(page, 'hub', lang, 'hub');
        // New batch with a mix of chosen files (one cannot be uploaded).
        await page.goto('/pharmacy/purchasing/intake/new');
        await expect(page.getByTestId('intake-upload')).toBeVisible();
        await checkWidths(page, 'new empty', lang, 'new');
        await page.getByTestId('intake-pick').setInputFiles([file('invoice-a.png', 'image/png', await good(8)), file('a-very-long-name-for-a-supplier-invoice-photo-taken-at-the-counter-2026-10-29.jpg', 'image/jpeg', await good(9)), file('notes.txt', 'text/plain', Buffer.from('x'))]);
        await expect(page.getByTestId('up-item')).toHaveCount(3);
        await checkWidths(page, 'new files', lang, 'new-files');
        // The batch with a file in each state.
        await page.goto(`/pharmacy/purchasing/intake/${(await zoo()).batchId}`);
        await expect(page.getByTestId('intake-file')).toHaveCount(6);
        await checkWidths(page, 'detail', lang, 'detail');
        // Open the cancel panel and look again.
        await page.getByTestId('intake-cancel').click();
        await expect(page.getByTestId('intake-cancel-form')).toBeVisible();
        await checkWidths(page, 'detail cancel', lang);
        await page.context().close();
      } finally {
        if (lang !== 'en') await setUserLocale(owner.userId, 'en');
      }
    });
  }
});
