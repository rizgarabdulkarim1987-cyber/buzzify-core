import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { uniquePage } from '../pharmacy/intake-helpers';
import { seriousViolations } from './helpers/axe';
import { INTAKE_SCRIPT_PATH } from './helpers/intake-env';
import { bigLines, cleanLines, db, endSubscription, makePharmacy, makeProduct, makeStaff, makeSupplier, movementCount, receiptOf, seedBatch, type SeededProduct, type TestPharmacy } from './helpers/intake-review-seed';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * Invoice by photo, the review (phase 5, task 9): the lines the AI read as cards beside the original, the flags with their
 * sentences, the product match and picker, the barcode fill, the header's arithmetic and its acknowledgement, and the approve
 * bar that makes a DRAFT receipt. One serial run over one pharmacy. The first test goes all the way: a generated picture is
 * uploaded and read by the scripted provider, the review equals the scripted answer, an edit recomputes the flags, a product
 * is chosen from the candidates, a barcode fills a line, the approve button lists what blocks it, and approving makes a draft
 * receipt that adds nothing to the stock. The others start from batches written to the database: the acknowledgement that a
 * later edit reopens, the duplicate invoice refusal, a stock clerk (edits disabled with the reason, a clean batch approved), a
 * pharmacy past its grace period, 200 lines at 375 px, and axe plus sideways-scroll checks in English, Arabic and Sorani.
 *
 * Run it only through `playwright.intake.config.ts` (its own dev server with the scripted provider); without it the suite skips.
 * Screenshots go to INTAKE_SHOTS.
 */

const SHOTS = process.env.INTAKE_SHOTS;
const WIDTHS = [375, 768, 1280] as const;
const SCRIPT = INTAKE_SCRIPT_PATH;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const script: Record<string, unknown> = {};
function setScript(entries: Record<string, unknown>): void {
  Object.assign(script, entries);
  writeFileSync(SCRIPT, JSON.stringify(script));
}

async function freshPage(browser: Browser, viewport: { width: number; height: number } = { width: 1280, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport });
  await hideDevTools(context);
  return context.newPage();
}

const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

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

async function shoot(page: Page, name: string, fullPage = true): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

/** At 375, 768 and 1280 px: no sideways scroll and no serious axe violation. Screenshots when `shot` names the screen. */
async function checkWidths(page: Page, what: string, lang: 'en' | 'ar' | 'ckb', shot?: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    expect(await scrollsSideways(page), `${lang} ${what} at ${width}px: sideways scroll`).toBe(false);
    expect(await seriousViolations(page), `${lang} ${what} at ${width}px: axe`).toEqual([]);
    if (shot) await shoot(page, `${lang}-${shot}-${width}`);
  }
}

/** The lines of the scripted invoice, by position: a line in edit mode no longer shows its name as text. */
const ORDER = ['Panadol', 'Brufen', 'Scribble', 'Zorbex'];
const rowByName = (page: Page, name: string): Locator => page.getByTestId('review-row').nth(ORDER.indexOf(name));
const flagsOf = async (row: Locator): Promise<string[]> => (await row.getByTestId('flag-chip').evaluateAll((els) => els.filter((e) => e.getAttribute('data-open') === 'true').map((e) => e.getAttribute('data-flag') ?? ''))).sort();

test.describe('Pharmacy invoice review @desktop', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ actionTimeout: 15_000 });
  test.skip(process.env.PH_INTAKE_E2E_CONFIG !== '1', 'run through playwright.intake.config.ts (its own server with the scripted AI provider)');
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let planMade = false;
  const world: {
    shop?: TestPharmacy;
    owner?: StudioUser;
    supplier?: { id: string; name: string };
    panadol?: SeededProduct;
    cetrax?: SeededProduct;
    approvedPath?: string;
    flagsPath?: string;
  } = {};

  test.beforeAll(async () => {
    writeFileSync(SCRIPT, '{}');
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
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
    if (world.shop && world.owner && world.supplier && world.panadol && world.cetrax) return { shop: world.shop, owner: world.owner, supplier: world.supplier, panadol: world.panadol, cetrax: world.cetrax };
    const shop = await makePharmacy('Review');
    restaurants.push(shop.id);
    const owner = await createStudioUser({ label: 'ph-review-owner', name: 'Review Owner' });
    people.push(owner.email);
    await assignMember(owner.userId, shop.id, 'OWNER');
    world.shop = shop;
    world.owner = owner;
    world.supplier = await makeSupplier(shop, owner.userId);
    world.panadol = await makeProduct(shop, { name: 'Panadol', strength: '500 mg', form: 'tablet' });
    world.cetrax = await makeProduct(shop, { name: 'Cetrax', strength: '10 mg', form: 'tablet', barcode: '6291000000013' });
    await makeProduct(shop, { name: 'Brufen', strength: '400 mg', form: 'tablet' });
    await makeProduct(shop, { name: 'Brufen', strength: '600 mg', form: 'tablet' });
    return { shop, owner, supplier: world.supplier, panadol: world.panadol, cetrax: world.cetrax };
  }

  /** A person who is staff with this role only. */
  async function staffUser(role: 'STOCK' | 'ACCOUNTANT', label: string): Promise<StudioUser> {
    const { shop } = await owned();
    const user = await createStudioUser({ label, name: label });
    people.push(user.email);
    await makeStaff(user.userId, shop.id, role);
    return user;
  }

  test('upload, read, review: the cards equal the scripted answer, an edit recomputes the flags, a product is chosen, a barcode fills a line, approving makes a draft receipt and no stock', async ({ browser }) => {
    test.setTimeout(420_000);
    const { shop, owner, supplier } = await owned();
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);

    const lines = [
      { name: 'Panadol', strength: '500 mg', form: 'tablet', pack: '30 box', quantity: 10, bonus: 0, unitCost: 1000, lineTotal: 10000, lot: 'A1', expiry: '2027-03', barcodeText: null, unclear: [], page: 1 },
      { name: 'Brufen', strength: null, form: 'tablet', pack: null, quantity: 5, bonus: 0, unitCost: 2000, lineTotal: 10000, lot: 'B2', expiry: '2027-06', barcodeText: null, unclear: [], page: 1 },
      { name: 'Scribble', strength: null, form: null, pack: null, quantity: 2, bonus: 0, unitCost: 500, lineTotal: 1000, lot: null, expiry: null, barcodeText: null, unclear: [], page: 1 },
      { name: 'Zorbex', strength: '5 mg', form: 'tablet', pack: null, quantity: 3, bonus: 0, unitCost: 1000, lineTotal: 4000, lot: 'X9', expiry: '2027-02', barcodeText: null, unclear: ['lot'], page: 1 },
    ];
    const png = await uniquePage(9101, { format: 'png', width: 1000, height: 1400 });
    setScript({
      [sha(png)]: JSON.stringify({
        header: { supplierName: supplier.name, invoiceNumber: 'RV-1001', invoiceDate: '2026-10-20', currency: 'IQD', total: 25000, discount: null, tax: null, unclear: [] },
        lines,
      }),
    });

    await page.goto('/pharmacy/purchasing/intake/new');
    await page.getByTestId('intake-supplier').selectOption({ label: supplier.name });
    await page.getByTestId('intake-pick').setInputFiles([{ name: 'invoice.png', mimeType: 'image/png', buffer: png }]);
    await page.getByTestId('intake-start').click();
    await expect(page.getByTestId('intake-open-batch')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('intake-open-batch').click();
    await expect(page.getByTestId('intake-batch')).toBeVisible();
    const batchPath = new URL(page.url()).pathname;
    await page.getByTestId('file-read').click();
    await expect(page.getByTestId('intake-file').first()).toHaveAttribute('data-state', 'EXTRACTED', { timeout: 60_000 });

    // The review equals the scripted answer.
    await expect(page.getByTestId('intake-review')).toBeVisible();
    const rows = page.getByTestId('review-row');
    await expect(rows).toHaveCount(4);
    for (const [i, line] of lines.entries()) await expect(rows.nth(i)).toContainText(line.name);
    await expect(rowByName(page, 'Panadol').getByTestId('match-chip')).toHaveAttribute('data-match', 'matched');
    await expect(rowByName(page, 'Brufen').getByTestId('match-chip')).toHaveAttribute('data-match', 'ambiguous');
    await expect(rowByName(page, 'Scribble').getByTestId('match-chip')).toHaveAttribute('data-match', 'unmatched');
    // A line with nothing read says so in words, and its flag has a sentence.
    expect(await flagsOf(rowByName(page, 'Scribble'))).toContain('MISSING');
    await expect(rowByName(page, 'Scribble').getByTestId('flag-text-MISSING')).not.toBeEmpty();
    await expect(rowByName(page, 'Scribble').getByTestId('not-read').first()).toBeVisible();
    expect(await flagsOf(rowByName(page, 'Brufen'))).toContain('AMBIGUOUS_MATCH');
    expect(await flagsOf(rowByName(page, 'Zorbex'))).toEqual(expect.arrayContaining(['MATH_MISMATCH', 'MODEL_UNCLEAR']));
    await expect(rowByName(page, 'Panadol').getByTestId('row-clean')).toBeVisible();
    await shoot(page, 'en-review-flags-1280');

    // Blocked: the button is disabled and the reasons are listed, each with a way to the first line.
    const approve = page.getByTestId('intake-approve');
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('approve-blocker').first()).toBeVisible();
    await shoot(page, 'en-review-blocked-1280');
    await page.getByTestId('approve-jump').first().click();
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'review-row');

    // The original: the picture is asked for on tap; "Row N" names the line.
    await page.getByTestId('original-load').click();
    const box = page.getByTestId('original-box').locator('img');
    await expect(box).toBeVisible();
    await expect.poll(() => box.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await rowByName(page, 'Zorbex').getByTestId('row-show-original').click();
    await expect(page.getByTestId('original-row-label')).toContainText('Row 4');
    await page.getByTestId('original-zoom-in').click();
    await expect(page.getByTestId('original-zoom')).not.toHaveText(/^100/);

    // Edit a cell: the lot of Scribble and the total of Zorbex; the flags recompute on the server.
    const scribble = rowByName(page, 'Scribble');
    await expect(scribble.getByTestId('flag-text-MISSING')).toContainText('lot');
    await scribble.getByTestId('row-edit').click();
    await scribble.getByTestId('edit-lot').fill('S7');
    await scribble.getByTestId('row-save').click();
    await expect(rowByName(page, 'Scribble').getByTestId('row-form')).toHaveCount(0);
    await expect(rowByName(page, 'Scribble').getByTestId('flag-text-MISSING')).not.toContainText('lot');
    const zorbex = rowByName(page, 'Zorbex');
    await zorbex.getByTestId('row-edit').click();
    await zorbex.getByTestId('edit-lineTotal').fill('3000');
    await zorbex.getByTestId('row-save').click();
    await expect(rowByName(page, 'Zorbex').getByTestId('row-form')).toHaveCount(0);
    expect(await flagsOf(rowByName(page, 'Zorbex'))).not.toContain('MATH_MISMATCH');
    // The unclear note stays until a person marks the line reviewed with a note.
    expect(await flagsOf(rowByName(page, 'Zorbex'))).toContain('MODEL_UNCLEAR');
    await rowByName(page, 'Zorbex').getByTestId('row-review-open').click();
    await rowByName(page, 'Zorbex').getByTestId('row-review-note').fill('Lot checked on the box');
    await rowByName(page, 'Zorbex').getByTestId('row-review-save').click();
    await expect(rowByName(page, 'Zorbex').getByTestId('reviewed-chip')).toBeVisible();

    // The header: the lines now sum to less than the printed total; the difference is shown, and a person accepts it.
    await expect(page.getByTestId('header-arithmetic')).toBeVisible();
    await expect(page.getByTestId('arith-form')).toBeVisible();
    await page.getByTestId('arith-reason').fill('The supplier rounded the total');
    await page.getByTestId('arith-accept').click();
    await expect(page.getByTestId('arith-accepted')).toBeVisible();

    // Choose a product from the candidates (Brufen is ambiguous), and fill Scribble from a barcode scan.
    const brufen = rowByName(page, 'Brufen');
    await brufen.getByTestId('row-choose').click();
    await page.getByTestId('pick-candidate').first().click();
    await expect(rowByName(page, 'Brufen').getByTestId('match-chip')).toHaveAttribute('data-match', 'chosen');
    expect(await flagsOf(rowByName(page, 'Brufen'))).not.toContain('AMBIGUOUS_MATCH');
    // A scanned GS1 label fills what the line lacks (its expiry) and says where it came from; matching again finds the product by its code.
    await expect(rowByName(page, 'Scribble').getByTestId('flag-text-MISSING')).toContainText('expiry');
    const scribbleScan = rowByName(page, 'Scribble').getByTestId('row-scan');
    await scribbleScan.fill('(01)06291000000013(17)271100(10)LOT77');
    await scribbleScan.press('Enter');
    await expect(rowByName(page, 'Scribble').getByTestId('flag-text-MISSING')).not.toContainText('expiry', { timeout: 30_000 });
    await expect(rowByName(page, 'Scribble').getByTestId('source-tag').filter({ hasText: /barcode/i }).first()).toBeVisible();
    await page.getByTestId('rematch').click();
    await expect(rowByName(page, 'Scribble').getByTestId('matched-product')).toContainText('Cetrax', { timeout: 30_000 });

    // Zorbex has no product: choose one from the catalog search.
    await rowByName(page, 'Zorbex').getByTestId('row-choose').click();
    await page.getByRole('dialog').getByRole('searchbox').fill('Panadol');
    await page.getByRole('list', { name: 'Matching products' }).getByRole('button').first().click();
    await expect(rowByName(page, 'Zorbex').getByTestId('match-chip')).toHaveAttribute('data-match', 'chosen', { timeout: 30_000 });

    // Ready: approving asks first and says what it makes.
    await expect(approve).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('approve-ready')).toBeVisible();
    await shoot(page, 'en-review-ready-1280');
    const before = await movementCount(shop.id);
    await approve.click();
    await expect(page.getByTestId('approve-confirm-body')).toContainText('This creates a DRAFT receipt. Nothing enters stock until you confirm the receipt');
    await shoot(page, 'en-review-confirm-1280');
    await page.getByTestId('approve-yes').click();
    await expect(page.getByTestId('intake-approved')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('intake-receipt-link')).toBeVisible();
    await expect(page.getByTestId('review-history')).toBeVisible();
    await shoot(page, 'en-review-approved-1280');

    // A DRAFT receipt exists and the stock did not move.
    const batchId = batchPath.split('/').pop()!;
    const made = await receiptOf(batchId);
    expect(made.status).toBe('DRAFT');
    expect(await movementCount(shop.id)).toBe(before);
    world.approvedPath = batchPath;

    // Read-only after approval: no edit controls.
    await expect(page.getByTestId('row-edit')).toHaveCount(0);
    await expect(approve).toHaveCount(0);

    // The receipt is confirmed in the normal screen and the stock arrives.
    await page.getByTestId('intake-receipt-link').click();
    await expect(page).toHaveURL(/\/pharmacy\/stock\/receive\//);
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await page.getByTestId('receipt-confirm').getByRole('button', { name: 'Confirm and add to stock' }).click();
    await expect(page.getByTestId('receipt-number')).toHaveText('R-000001');
    await expect.poll(async () => (await receiptOf(batchId)).status, { timeout: 30_000 }).toBe('CONFIRMED');
    expect((await receiptOf(batchId)).movements).toBeGreaterThan(0);
    await page.context().close();
  });

  test('the acknowledgement of the total is asked for again after an edit changes the difference', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, supplier, panadol, cetrax } = await owned();
    const { lines, total } = cleanLines([panadol, cetrax]);
    const seeded = await seedBatch(shop, { userId: owner.userId, branch: 0, supplier, invoiceNumber: `ACK-${randomUUID().slice(0, 5)}`, total: total + 500, lines });
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto(seeded.path);
    await expect(page.getByTestId('arith-form')).toBeVisible();
    await expect(page.getByTestId('intake-approve')).toBeDisabled();
    await page.getByTestId('arith-reason').fill('Rounded by the supplier');
    await page.getByTestId('arith-accept').click();
    await expect(page.getByTestId('arith-accepted')).toBeVisible();
    await expect(page.getByTestId('intake-approve')).toBeEnabled();
    // An edit that moves the lines' sum changes the difference: the acceptance no longer covers it.
    const first = page.getByTestId('review-row').first();
    await first.getByTestId('row-edit').click();
    await first.getByTestId('edit-lineTotal').fill('12345');
    await first.getByTestId('row-save').click();
    await expect(page.getByTestId('arith-form')).toBeVisible();
    await expect(page.getByTestId('arith-accepted')).toHaveCount(0);
    await expect(page.getByTestId('intake-approve')).toBeDisabled();
    await page.context().close();
  });

  test('the same invoice number from the same supplier is refused with a link to the earlier one', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, supplier, panadol } = await owned();
    const { lines, total } = cleanLines([panadol]);
    const seeded = await seedBatch(shop, { userId: owner.userId, branch: 0, supplier, invoiceNumber: 'RV-1001', total, lines });
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await page.goto(seeded.path);
    await page.getByTestId('intake-approve').click();
    await page.getByTestId('approve-yes').click();
    await expect(page.getByTestId('approve-message')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('approve-link')).toBeVisible();
    await shoot(page, 'en-review-duplicate-1280');
    await expect(page.getByTestId('intake-approved')).toHaveCount(0);
    await page.context().close();
  });

  test('a stock clerk sees the edit controls disabled with the reason, and can approve a batch that is clean', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, supplier, panadol, cetrax } = await owned();
    const stock = await staffUser('STOCK', 'ph-review-stock');
    const { lines, total } = cleanLines([panadol, cetrax]);
    const seeded = await seedBatch(shop, { userId: owner.userId, branch: 0, supplier, invoiceNumber: `STK-${randomUUID().slice(0, 5)}`, total, lines });
    const page = await freshPage(browser);
    await signInAndChoose(page, stock, shop, 0);
    await page.goto(seeded.path);
    await expect(page.getByTestId('review-row')).toHaveCount(2);
    const first = page.getByTestId('review-row').first();
    await expect(first.getByTestId('row-edit')).toBeDisabled();
    await expect(first.getByTestId('row-remove')).toBeDisabled();
    await expect(page.getByTestId('review-why')).toBeVisible();
    await expect(page.getByTestId('add-line')).toBeDisabled();
    await shoot(page, 'en-review-stock-1280');
    await expect(page.getByTestId('intake-approve')).toBeEnabled();
    await page.getByTestId('intake-approve').click();
    await page.getByTestId('approve-yes').click();
    await expect(page.getByTestId('intake-approved')).toBeVisible({ timeout: 60_000 });
    await page.context().close();
  });

  test('a pharmacy past its grace period sees the review read-only with the reason', async ({ browser }) => {
    test.setTimeout(240_000);
    const { shop, owner, supplier, panadol } = await owned();
    const { lines, total } = cleanLines([panadol]);
    const seeded = await seedBatch(shop, { userId: owner.userId, branch: 0, supplier, invoiceNumber: `RO-${randomUUID().slice(0, 5)}`, total, lines });
    const page = await freshPage(browser);
    await signInAndChoose(page, owner, shop, 1);
    await endSubscription(shop, 10);
    try {
      await page.goto(seeded.path);
      await expect(page.getByTestId('receive-write-blocked')).toContainText('subscription has lapsed');
      const first = page.getByTestId('review-row').first();
      await expect(first.getByTestId('row-edit')).toBeDisabled();
      await expect(page.getByTestId('intake-approve')).toBeDisabled();
      await expect(page.getByTestId('approve-why')).toBeVisible();
      await shoot(page, 'en-review-read-only-1280');
    } finally {
      await endSubscription(shop, -29);
    }
    await page.context().close();
  });

  test('200 lines with long names stay usable at 375px: no sideways scroll and no serious axe violation', async ({ browser }) => {
    test.setTimeout(300_000);
    const { shop, owner, supplier } = await owned();
    const seeded = await seedBatch(shop, { userId: owner.userId, branch: 0, supplier, invoiceNumber: `BIG-${randomUUID().slice(0, 5)}`, total: null, lines: bigLines(200) });
    const page = await freshPage(browser, { width: 375, height: 800 });
    await signInAndChoose(page, owner, shop, 1);
    await page.goto(seeded.path);
    await expect(page.getByTestId('review-row')).toHaveCount(200);
    expect(await scrollsSideways(page)).toBe(false);
    expect(await seriousViolations(page)).toEqual([]);
    // The approve bar stays within reach and says why it is blocked.
    await expect(page.getByTestId('intake-approve')).toBeDisabled();
    // A card is about 900px at this width (measured 920): a guard against it growing, not a claim that it is short. The bar follows the person down the list.
    const perLine = await page.evaluate(() => document.documentElement.scrollHeight / document.querySelectorAll('[data-testid=review-row]').length);
    expect(perLine).toBeLessThan(1100);
    await page.evaluate(() => window.scrollTo(0, 5000));
    await expect(page.getByTestId('intake-approve-bar')).toBeInViewport();
    await shoot(page, 'en-review-200-375', false);
    await page.context().close();
  });

  for (const lang of ['en', 'ar', 'ckb'] as const) {
    test(`the review passes axe and does not scroll sideways at 375, 768 and 1280px in ${{ en: 'English', ar: 'Arabic', ckb: 'Sorani' }[lang]}`, async ({ browser }) => {
      test.setTimeout(420_000);
      const { shop, owner, supplier, panadol, cetrax } = await owned();
      if (lang !== 'en') await setUserLocale(owner.userId, lang);
      try {
        const flagged = await seedBatch(shop, {
          userId: owner.userId,
          branch: 0,
          supplier,
          invoiceNumber: `LNG-${randomUUID().slice(0, 5)}`,
          total: 99999,
          lines: [
            { name: 'Scribble', quantity: 2, unitCost: 500, lineTotal: 900, expiry: '2020-01', unclear: ['lot'] },
            { name: 'أموكسيسيلين مع حمض الكلافولانيك أقراص مغلفة بالفيلم', strength: '500 mg', quantity: null, unitCost: null, lineTotal: null },
            { name: panadol.name, strength: '500 mg', form: 'tablet', quantity: 10, unitCost: 1000, lineTotal: 10000, lot: 'A1', expiry: '2027-03', match: panadol },
          ],
        });
        const clean = cleanLines([panadol, cetrax]);
        const ready = await seedBatch(shop, { userId: owner.userId, branch: 0, supplier, invoiceNumber: `RDY-${randomUUID().slice(0, 5)}`, total: clean.total, lines: clean.lines });
        const page = await freshPage(browser, { width: 375, height: 800 });
        await signInAndChoose(page, owner, shop, 1);
        if (lang !== 'en') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

        // Flags and a blocked approve bar.
        await page.goto(flagged.path);
        await expect(page.getByTestId('review-row')).toHaveCount(3);
        // On a phone the reasons start closed (once the page has settled); open them.
        await expect(page.getByTestId('approve-blockers')).toHaveJSProperty('open', false);
        await page.getByTestId('approve-blockers').locator('summary').click();
        await expect(page.getByTestId('approve-blocker').first()).toBeVisible();
        await checkWidths(page, 'review flags', lang, 'review-flags');
        // A line being edited, and the picker.
        await page.getByTestId('row-edit').first().click();
        await expect(page.getByTestId('row-form')).toBeVisible();
        await checkWidths(page, 'review editing', lang, 'review-editing');
        await page.getByTestId('row-discard').click();
        await page.getByTestId('row-choose').first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await checkWidths(page, 'review picker', lang, 'review-picker');
        await page.keyboard.press('Escape');
        // The original pane opened.
        await page.getByTestId('original-toggle').click().catch(() => undefined);
        await checkWidths(page, 'review original', lang, 'review-original');
        // Ready, and the confirmation.
        await page.goto(ready.path);
        await expect(page.getByTestId('approve-ready')).toBeVisible();
        await checkWidths(page, 'review ready', lang, 'review-ready');
        await page.getByTestId('intake-approve').click();
        await expect(page.getByTestId('approve-confirm-body')).toBeVisible();
        await checkWidths(page, 'review confirm', lang, 'review-confirm');
        await page.keyboard.press('Escape');
        // Approved.
        if (world.approvedPath) {
          await page.goto(world.approvedPath);
          await expect(page.getByTestId('intake-approved')).toBeVisible();
          await checkWidths(page, 'review approved', lang, 'review-approved');
        }
        await page.context().close();
      } finally {
        if (lang !== 'en') await setUserLocale(owner.userId, 'en');
      }
    });
  }
});
