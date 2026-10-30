import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createPrisma } from '@/server/data/prisma';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * The report screens and the chain dashboard, end to end (phase 6, task 6). The world is built through the real services
 * (helpers/reports-world-cli.ts) and the screens are compared with figures written out by hand below (all in IQD or USD minor
 * units, today, Baghdad):
 *
 *   IQD sales (4): S1 1800 + S2 285 (3 tablets, 15 off) at A, S5 2000 at A, S3 500 at B = 4585; one refund 450 (5 tablets of S1);
 *     gross 1800 + 300 + 2000 + 500 = 4600, discount 15, net 4585 - 450 = 4135, average sale floor(4585 / 4) = 1146.
 *     A net 4085 - 450 = 3635, B net 500.   USD (1): 200 cents, net 2.00 USD.
 *   Panadol IQD by product: sales 1800 + 285 + 500 = 2585, refunds 450, net 2135, 28 tablets.  Aspirin: 2000, 10 tablets.
 *   Margin (lines with a complete IQD cost): A 2085 - 450 = 1635 net, cost 1410 + 211 - 352 = 1269, margin 366;
 *     B 500 net, cost 300, margin 200.  Total net 2135, cost 1569, margin 566 = 26.51 %.  S5 (no cost) is left out: 2000 excluded.
 *   Stock now: A Panadol 200 - 20 - 3 - 2 - 12 sent = 163 available + 5 in quarantine (a return goes to quarantine), Aspirin 90; B Panadol 200 - 5 - 3 damaged = 192.
 *     Available 445, damaged 3.  Value at cost: A floor(705 x 168 / 10) = 11844, B floor(600 x 192 / 10) = 11520 = 23364 IQD.
 *   On the road: T1 A to B 12 tablets.  Transfers requested in the window: 2.  Low stock: A Panadol (minimum 200, 163 available) = 1.
 *   Expiry: PB1 (168) expires in 20 days, PB2 (192) in 45 days.
 *
 * Run: `npx playwright test -c playwright.reports.config.ts --workers=1 tests/e2e/pharmacy-reports.spec.ts`.
 */

const DAY = 86_400_000;
const SHOTS = '.superpowers/sdd/2026-10-31-pharmacy-phase-6/task-6-shots';
const db = () => createPrisma(databaseUrl(DEV_DB));
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

interface Shop {
  id: string;
  name: string;
  branches: { id: string; name: string }[];
}

async function makeShop(label: string, branchNames: string[]): Promise<Shop> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branches: Shop['branches'] = [];
    for (const [i, b] of branchNames.entries()) {
      const bn = `${b} ${randomUUID().slice(0, 4)}`;
      const created = await client.branch.create({ data: { restaurantId: row.id, name: bn, sortOrder: i }, select: { id: true } });
      branches.push({ id: created.id, name: bn });
    }
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    return { id: row.id, name, branches };
  } finally {
    await client.$disconnect();
  }
}

async function staff(userId: string, shop: Shop, role: 'BRANCH_MANAGER' | 'STOCK' | 'CASHIER' | 'PHARMACIST' | 'PHARMACIST_IN_CHARGE' | 'ACCOUNTANT', branchIndexes: number[]): Promise<void> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId, restaurantId: shop.id, role }, select: { id: true } });
    for (const i of branchIndexes) await client.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: shop.branches[i]!.id } });
  } finally {
    await client.$disconnect();
  }
}

const logins = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** Signs in (once per person) and chooses a place: a branch by name, or `null` for "All branches". */
async function session(browser: Browser, user: StudioUser, shop: Shop, branch: string | null, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const saved = logins.get(user.email);
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport, acceptDownloads: true, ...(saved ? { storageState: saved } : {}) });
  await hideDevTools(context);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  if (saved) {
    await page.goto('/pharmacy/select');
  } else {
    await page.goto('/pharmacy');
    await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/pharmacy\/select$/);
    logins.set(user.email, await context.storageState());
  }
  const group = page.getByRole('group', { name: shop.name });
  await (branch === null ? group.getByRole('button').first() : group.getByRole('button', { name: new RegExp(branch) })).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
  return page;
}

/** The numbers in a CSV (UTF-8 with a byte order mark), split by line and comma; no quoted commas occur in these reports. */
function csvRows(file: string): string[][] {
  return readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((line) => line.split(','));
}
const digits = (text: string | null) => (text ?? '').replace(/[^\d.-]/g, '');

test.describe.configure({ mode: 'serial' });

test.describe('Pharmacy reports and chain @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let shop: Shop;
  let empty: Shop;
  let big: Shop;
  let other: Shop;
  let owner: StudioUser;
  let mgrA: StudioUser;
  let cashier: StudioUser;
  let pic: StudioUser;
  let accountant: StudioUser;
  let stock: StudioUser;
  let pharmacist: StudioUser;
  let ownerEmpty: StudioUser;
  let ownerBig: StudioUser;
  let ownerOther: StudioUser;
  let world: { names: { P: string; Q: string }; productP: string };
  let A: string;
  let B: string;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      console.log(`Application(pharmacy) before: ${applicationWas}, set to ACTIVE for this run`);
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
    } finally {
      await client.$disconnect();
    }
    shop = await makeShop('Reports', ['Alpha', 'Bravo']);
    empty = await makeShop('Empty', ['Echo', 'Foxtrot']);
    big = await makeShop('Big', ['Main']);
    other = await makeShop('Other', ['Delta']);
    restaurants.push(shop.id, empty.id, big.id, other.id);
    [A, B] = shop.branches.map((b) => b.name) as [string, string];
    const make = async (label: string) => {
      const user = await createStudioUser({ label: `ph-rep-${label}`, name: `Rep ${label}` });
      people.push(user.email);
      return user;
    };
    const made = await Promise.all(['owner', 'mgr-a', 'cashier', 'pic', 'acct', 'stock', 'pharm', 'owner-e', 'owner-b', 'owner-o'].map(make));
    [owner, mgrA, cashier, pic, accountant, stock, pharmacist, ownerEmpty, ownerBig, ownerOther] = made as [StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser];
    await assignMember(owner.userId, shop.id, 'OWNER');
    await assignMember(ownerEmpty.userId, empty.id, 'OWNER');
    await assignMember(ownerBig.userId, big.id, 'OWNER');
    await assignMember(ownerOther.userId, other.id, 'OWNER');
    await staff(mgrA.userId, shop, 'BRANCH_MANAGER', [0]);
    await staff(cashier.userId, shop, 'CASHIER', [0]);
    await staff(pic.userId, shop, 'PHARMACIST_IN_CHARGE', [0, 1]);
    await staff(accountant.userId, shop, 'ACCOUNTANT', [0, 1]);
    await staff(stock.userId, shop, 'STOCK', [0, 1]);
    await staff(pharmacist.userId, shop, 'PHARMACIST', [0]);
    const root = process.cwd();
    const output = execFileSync(
      process.execPath,
      [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'tests', 'e2e', 'helpers', 'reports-world-cli.ts'), JSON.stringify({ restaurantId: shop.id, branchA: shop.branches[0]!.id, branchB: shop.branches[1]!.id, owner: owner.userId, mgrA: mgrA.userId, cashierA: cashier.userId, suffix: randomUUID().slice(0, 5) })],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const line = output.split(/\r?\n/).find((l) => l.startsWith('WORLD '));
    if (!line) throw new Error(`the world script gave no answer:\n${output}`);
    world = JSON.parse(line.slice('WORLD '.length));
    // The big pharmacy: 1,000 products, each below its minimum (no stock), for "Load more" and the long list at 375px.
    const client2 = db();
    try {
      const ids: string[] = [];
      await client2.phProduct.createMany({
        data: Array.from({ length: 1000 }, (_, i) => {
          const tradeName = `Bulk ${String(i).padStart(4, '0')}`;
          return { restaurantId: big.id, tradeName, identityKey: `${tradeName}|${big.id}`, searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '', form: '', manufacturer: '' }) };
        }),
      });
      for (const p of await client2.phProduct.findMany({ where: { restaurantId: big.id }, select: { id: true } })) ids.push(p.id);
      await client2.phProductBranch.createMany({ data: ids.map((productId) => ({ restaurantId: big.id, branchId: big.branches[0]!.id, productId, minQty: 5, reorderQty: 5 })) });
    } finally {
      await client2.$disconnect();
    }
    mkdirSync(SHOTS, { recursive: true });
  });

  test.afterAll(async () => {
    const client = db();
    try {
      await client.subscription.updateMany({ where: { restaurantId: shop?.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() + 29 * DAY) } });
      if (applicationWas) {
        await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
        console.log(`Application(pharmacy) restored to ${applicationWas}`);
      }
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  const text = async (page: Page, testid: string) => (await page.getByTestId(testid).first().innerText()).replace(/\s+/g, ' ').trim();

  test('the owner sees the hand-computed figures on every report and the chain', async ({ browser }) => {
    test.setTimeout(240_000);
    const o = await session(browser, owner, shop, null);
    await o.goto('/pharmacy/reports');
    await expect(o.getByTestId('reports-index')).toBeVisible();
    for (const id of ['sales', 'returns', 'discounts', 'margin', 'stockValuation', 'expiry', 'damaged', 'transfers', 'lowStock']) await expect(o.getByTestId(`report-card-${id}`)).toBeVisible();
    await expect(o.getByTestId('report-card-payables')).toBeVisible();
    await expect(o.getByTestId('report-card-shifts')).toBeVisible();
    await expect(o.getByTestId('report-card-chain')).toBeVisible();

    // Sales by day: IQD and USD apart, never added.
    await o.goto('/pharmacy/reports/sales');
    expect(await text(o, 'net-IQD')).toBe('4,135 IQD');
    expect(await text(o, 'sales-IQD')).toBe('4,585 IQD');
    expect(await text(o, 'refunds-IQD')).toBe('450 IQD');
    expect(await text(o, 'count-IQD')).toBe('4');
    expect(await text(o, 'net-USD')).toBe('2.00 USD');
    expect(await text(o, 'totals-IQD')).toContain('1,146 IQD');
    expect(await text(o, 'totals-IQD')).toContain('4,600 IQD');
    await expect(o.getByTestId('report-rows').getByTestId('report-row')).toHaveCount(2);
    await expect(o.getByTestId('sales-by-branch')).toContainText('3,635 IQD');
    await expect(o.getByTestId('sales-by-branch')).toContainText('500 IQD');
    await o.goto('/pharmacy/reports/sales?group=product');
    const panadol = o.getByTestId('report-rows').getByTestId('report-row').filter({ hasText: world.names.P }).filter({ hasText: 'IQD' });
    await expect(panadol).toContainText('2,585 IQD');
    await expect(panadol).toContainText('2,135 IQD');
    await expect(panadol).toContainText('28');
    await expect(o.getByTestId('report-rows').getByTestId('report-row').filter({ hasText: world.names.Q })).toContainText('2,000 IQD');

    await o.goto('/pharmacy/reports/returns');
    expect(await text(o, 'refund-IQD')).toBe('450 IQD');
    await expect(o.getByTestId('report-rows').getByTestId('report-row')).toHaveCount(1);
    await expect(o.getByTestId('report-rows')).toContainText('Damaged box');
    await o.goto('/pharmacy/reports/discounts');
    expect(await text(o, 'discount-IQD')).toBe('15 IQD');
    expect(await text(o, 'discounted-IQD')).toBe('1');
    await expect(o.getByTestId('report-rows')).toContainText('5.00%');

    await o.goto('/pharmacy/reports/margin');
    expect(await text(o, 'margin-IQD')).toBe('566 IQD');
    await expect(o.getByTestId('totals-IQD')).toContainText('26.51%');
    await expect(o.getByTestId('totals-IQD')).toContainText('2,135 IQD');
    await expect(o.getByTestId('totals-IQD')).toContainText('1,569 IQD');
    expect(await text(o, 'excluded-IQD')).toBe('2,000 IQD');
    await expect(o.locator('[data-notice="margin.estimated"]')).toBeVisible();
    await expect(o.locator('[data-notice="margin.costMissing"]')).toContainText('1 lines');
    await expect(o.locator('[data-notice="margin.otherCurrency"]')).toBeVisible();

    await o.goto('/pharmacy/reports/stock-valuation');
    expect(await text(o, 'units-available')).toBe('445');
    expect(await text(o, 'units-damaged')).toBe('3');
    expect(await text(o, 'value-IQD')).toBe('23,364 IQD');
    expect(await text(o, 'transit-units')).toBe('12');
    await expect(o.locator('[data-notice="valuation.incomplete"]')).toBeVisible();
    await o.goto('/pharmacy/reports/expiry');
    await expect(o.getByTestId('expiry-bands')).toContainText('168');
    await expect(o.getByTestId('expiry-bands')).toContainText('192');
    await o.goto('/pharmacy/reports/damaged');
    expect(await text(o, 'units-damaged')).toBe('3');
    await expect(o.getByTestId('damaged-movements')).toContainText('180 IQD');
    await o.goto('/pharmacy/reports/transfers');
    expect(await text(o, 'transfers-total')).toBe('2');
    expect(await text(o, 'transit-units')).toBe('12');
    await expect(o.locator('[data-notice="transfers.scope"]')).toBeVisible();
    await o.goto('/pharmacy/reports/low-stock');
    expect(await text(o, 'low-total')).toBe('1');
    await expect(o.getByTestId('report-rows')).toContainText('163');
    await expect(o.getByTestId('report-rows')).toContainText('200');

    // The chain: the cards, the total, the ranking, the road counted once.
    await o.goto('/pharmacy/chain');
    await expect(o.getByTestId('chain-scope')).toContainText(A);
    await expect(o.getByTestId('chain-scope')).toContainText(B);
    await expect(o.getByTestId('chain-card-total').getByTestId('net-IQD')).toContainText('4,135 IQD');
    const idA = shop.branches[0]!.id;
    const idB = shop.branches[1]!.id;
    await expect(o.getByTestId(`chain-card-${idA}`).getByTestId('net-IQD')).toContainText('3,635 IQD');
    await expect(o.getByTestId(`chain-card-${idB}`).getByTestId('net-IQD')).toContainText('500 IQD');
    expect(await text(o, 'transit-total')).toBe('12');
    await expect(o.getByTestId(`chain-card-${idA}`)).toContainText('Outgoing on the road (units)12');
    await expect(o.getByTestId(`chain-card-${idB}`)).toContainText('Incoming on the road (units)12');
    const compare = o.getByTestId('chain-compare-IQD').getByTestId('report-row');
    await expect(compare.first()).toContainText(A);
    await expect(compare.first()).toContainText('1');
    await expect(o.locator('[data-notice="chain.transit"]')).toBeVisible();
    // A figure links to the report with the same period.
    const href = await o.getByTestId(`chain-card-${idA}`).getByRole('link').first().getAttribute('href');
    expect(href).toContain('/pharmacy/reports/sales?');
    expect(href).toContain(`branch=${idA}`);
    await o.context().close();
  });

  test('the exports equal the screen, and a double click makes one file and one audit row', async ({ browser }) => {
    test.setTimeout(180_000);
    const o = await session(browser, owner, shop, null);
    await o.goto('/pharmacy/reports/sales');
    const screenNet = digits(await text(o, 'net-IQD'));
    const auditCount = async () => {
      const client = db();
      try {
        return await client.auditLog.count({ where: { restaurantId: shop.id, action: 'pharmacy.report.export' } });
      } finally {
        await client.$disconnect();
      }
    };
    const before = await auditCount();
    const downloads: string[] = [];
    o.on('download', (d) => downloads.push(d.suggestedFilename()));
    const first = o.waitForEvent('download');
    await o.getByTestId('export-csv').dblclick();
    const file = await first;
    await expect(o.getByTestId('export-done')).toBeVisible();
    await o.waitForTimeout(1500);
    expect(downloads).toHaveLength(1);
    expect(await auditCount()).toBe(before + 1);
    expect(file.suggestedFilename()).toMatch(/^pharmacy-sales-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    const rows = csvRows(await file.path());
    const header = rows[0]!;
    const total = rows.find((r) => r[header.indexOf('rowType')] === 'total' && r[header.indexOf('currency')] === 'IQD')!;
    expect(total[header.indexOf('net')]).toBe(screenNet);
    expect(total[header.indexOf('net')]).toBe('4135');
    const totalUsd = rows.find((r) => r[header.indexOf('rowType')] === 'total' && r[header.indexOf('currency')] === 'USD')!;
    expect(totalUsd[header.indexOf('net')]).toBe('2.00');
    // Excel: the same screen gives a workbook with the server's file name.
    const xlsx = o.waitForEvent('download');
    await o.getByTestId('export-xlsx').click();
    expect((await xlsx).suggestedFilename()).toMatch(/\.xlsx$/);
    // The valuation file carries the screen's value.
    await o.goto('/pharmacy/reports/stock-valuation');
    const screenValue = digits(await text(o, 'value-IQD'));
    const valuationFile = o.waitForEvent('download');
    await o.getByTestId('export-csv').click();
    const vrows = csvRows(await (await valuationFile).path());
    expect(vrows.flat().some((cell) => cell === screenValue)).toBe(true);
    // The chain file.
    await o.goto('/pharmacy/chain');
    const chainFile = o.waitForEvent('download');
    await o.getByTestId('export-csv').click();
    expect((await chainFile).suggestedFilename()).toMatch(/^pharmacy-chain-/);
    // A refusal is said in words: the server's row-cap answer, faked for this one request.
    await o.goto('/pharmacy/reports/sales');
    await o.route('**/pharmacy/reports/export**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID', message: 'This report has too many rows for one file. Narrow the dates or choose a branch.', fields: { phCode: 'EXPORT_TOO_LARGE', limit: '50000' } } }) }));
    await o.getByTestId('export-csv').click();
    await expect(o.getByTestId('export-error')).toContainText('too many rows');
    await o.unroute('**/pharmacy/reports/export**');
    await o.route('**/pharmacy/reports/export**', (route) => route.abort('failed'));
    await o.getByTestId('export-xlsx').click();
    await expect(o.getByTestId('export-error')).toContainText('connection failed');
    await o.context().close();
  });

  test('who sees what: branch-limited manager, in-charge, accountant, and the roles without report.view', async ({ browser }) => {
    test.setTimeout(240_000);
    const idA = shop.branches[0]!.id;
    const idB = shop.branches[1]!.id;
    // A manager of A only: A's figures alone, margin yes, no chain page (explained), a foreign branch refused.
    const m = await session(browser, mgrA, shop, A);
    await m.goto('/pharmacy/reports');
    await expect(m.getByTestId('report-card-margin')).toBeVisible();
    await expect(m.getByTestId('report-card-chain')).toHaveCount(0);
    await expect(m.getByRole('link', { name: 'Chain', exact: true })).toHaveCount(0);
    await m.goto('/pharmacy/reports/sales');
    expect(await text(m, 'net-IQD')).toBe('3,635 IQD');
    await expect(m.getByTestId('filter-branch').locator('option')).toHaveCount(2);
    await m.goto(`/pharmacy/reports/sales?branch=${idB}`);
    await expect(m.getByTestId('filter-error-branch')).toBeVisible();
    await expect(m.getByTestId('report-totals')).toHaveCount(0);
    await m.goto('/pharmacy/chain');
    await expect(m.getByTestId('chain-one-branch')).toBeVisible();
    await expect(m.getByTestId('chain-one-branch').getByRole('link')).toHaveAttribute('href', '/pharmacy/reports');
    await m.context().close();

    // The pharmacist in charge: reports and the chain, but no margin (profit.view is missing).
    const p = await session(browser, pic, shop, null);
    await p.goto('/pharmacy/reports');
    await expect(p.getByTestId('report-card-margin')).toHaveCount(0);
    await expect(p.getByTestId('report-card-sales')).toBeVisible();
    await p.goto('/pharmacy/reports/margin');
    await expect(p.getByTestId('report-gated')).toBeVisible();
    await expect(p.getByTestId('report-totals')).toHaveCount(0);
    await p.goto('/pharmacy/chain');
    await expect(p.getByTestId('chain-card-total')).toBeVisible();
    await expect(p.locator('[data-notice="margin.estimated"]')).toHaveCount(0);
    await expect(p.getByTestId('chain-card-total')).not.toContainText('Margin');
    await p.context().close();

    // The accountant: margin and the chain.
    const a = await session(browser, accountant, shop, null);
    await a.goto('/pharmacy/reports/margin');
    expect(await text(a, 'margin-IQD')).toBe('566 IQD');
    await a.goto('/pharmacy/chain');
    await expect(a.getByTestId('chain-card-total')).toContainText('Margin');
    await a.context().close();

    // Stock keeper, cashier, pharmacist: the blocked state, no figure of the world anywhere, no link in the navigation.
    for (const [who, place] of [[stock, null], [cashier, A], [pharmacist, A]] as const) {
      const s = await session(browser, who, shop, place);
      for (const route of ['/pharmacy/reports', '/pharmacy/reports/sales', '/pharmacy/reports/margin', '/pharmacy/chain']) {
        await s.goto(route);
        await expect(s.getByTestId('reports-forbidden')).toBeVisible();
        await expect(s.getByTestId('report-row')).toHaveCount(0);
        await expect(s.getByTestId('report-totals')).toHaveCount(0);
        expect(await s.content()).not.toContain(world.names.P);
      }
      await expect(s.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
      // The file route refuses too.
      const refused = await s.request.get(`/pharmacy/reports/export?report=sales&format=csv&branch=${idA}`);
      expect(refused.status()).toBe(403);
      await s.context().close();
    }

    // Another business sees nothing of this one, whatever the address says.
    const x = await session(browser, ownerOther, other, null);
    await x.goto('/pharmacy/reports/sales');
    await expect(x.getByTestId('report-empty')).toBeVisible();
    expect(await x.content()).not.toContain(world.names.P);
    await x.goto(`/pharmacy/reports/sales?branch=${idA}`);
    await expect(x.getByTestId('filter-error-branch')).toBeVisible();
    await x.goto('/pharmacy/reports/low-stock');
    await expect(x.getByTestId('report-empty')).toBeVisible();
    await x.goto('/pharmacy/chain');
    await expect(x.getByTestId('chain-one-branch')).toBeVisible();
    const exportOfOthers = await x.request.get(`/pharmacy/reports/export?report=sales&format=csv&branch=${idB}`);
    expect(exportOfOthers.status()).toBe(403);
    await x.context().close();
  });

  test('stale filters in the address say what is wrong and load nothing; presets and offline keep the filters', async ({ browser }) => {
    test.setTimeout(180_000);
    const o = await session(browser, owner, shop, null);
    const cases: Array<[string, string]> = [
      ['/pharmacy/reports/sales?from=2026-13-45&to=2026-01-31', 'filter-error-from'],
      ['/pharmacy/reports/sales?from=2026-02-01&to=2026-01-01', 'filter-error-from'],
      ['/pharmacy/reports/sales?from=2025-01-01&to=2026-06-01', 'filter-error-to'],
      ['/pharmacy/reports/sales?group=moon', 'filter-error-group'],
      ['/pharmacy/reports/sales?currency=EUR', 'filter-error-currency'],
      ['/pharmacy/reports/transfers?status=LOST', 'filter-error-status'],
      [`/pharmacy/reports/sales?branch=${other.branches[0]!.id}`, 'filter-error-branch'],
      ['/pharmacy/chain?from=nope&to=2026-01-31', 'filter-error-from'],
      ['/pharmacy/chain?from=2025-01-01&to=2026-06-01', 'filter-error-to'],
    ];
    for (const [url, field] of cases) {
      await o.goto(url);
      await expect(o.getByTestId(field), url).toBeVisible();
      await expect(o.getByTestId('filters-invalid'), url).toBeVisible();
      await expect(o.getByTestId('report-totals'), url).toHaveCount(0);
      await expect(o.getByTestId('chain-card-total'), url).toHaveCount(0);
    }
    // A 366-day range is allowed, 367 is not; a long range says it may take a few seconds.
    await o.goto('/pharmacy/reports/sales?from=2026-01-01&to=2027-01-01');
    await expect(o.getByTestId('filters-invalid')).toHaveCount(0);
    await expect(o.getByTestId('long-range-hint')).toBeVisible();
    await o.goto('/pharmacy/reports/sales?from=2026-01-01&to=2026-03-31');
    await expect(o.getByTestId('long-range-hint')).toHaveCount(0);
    // A preset is a link that carries the period; "today" is one day.
    await o.getByTestId('preset-today').click();
    await expect(o).toHaveURL(/from=(\d{4}-\d{2}-\d{2})&to=\1/);
    expect(await text(o, 'net-IQD')).toBe('4,135 IQD');
    // Changing the branch filter narrows the figures and the address.
    await o.getByTestId('filter-branch').selectOption({ label: B });
    await o.getByTestId('filter-apply').click();
    await expect(o).toHaveURL(new RegExp(`branch=${shop.branches[1]!.id}`));
    expect(await text(o, 'net-IQD')).toBe('500 IQD');
    // Offline: the notice shows and the filters stay as they are.
    await o.getByTestId('filter-from').fill('2026-02-02');
    await o.context().setOffline(true);
    await expect(o.getByTestId('stock-offline')).toBeVisible();
    await expect(o.getByTestId('filter-from')).toHaveValue('2026-02-02');
    await expect(o.getByTestId('filter-branch')).toHaveValue(shop.branches[1]!.id);
    await o.context().setOffline(false);
    await o.context().close();
  });

  test('a long list pages by "Load more", and 1,000 rows stay usable at 375px', async ({ browser }) => {
    test.setTimeout(240_000);
    const o = await session(browser, ownerBig, big, null, { width: 375, height: 800 });
    await o.goto('/pharmacy/reports/low-stock');
    expect(await text(o, 'low-total')).toBe('1,000');
    await expect(o.getByTestId('report-rows').getByTestId('report-row')).toHaveCount(100);
    await o.getByTestId('report-more').click();
    await expect(o).toHaveURL(/pages=2/);
    await expect(o.getByTestId('report-rows').getByTestId('report-row')).toHaveCount(200);
    await o.goto('/pharmacy/reports/low-stock?pages=10');
    await expect(o.getByTestId('report-rows').getByTestId('report-row')).toHaveCount(1000);
    await expect(o.getByTestId('report-more')).toHaveCount(0);
    expect(await scrollsSideways(o)).toBe(false);
    expect(await seriousViolations(o)).toEqual([]);
    await o.screenshot({ path: `${SHOTS}/low-stock-1000-375.png` });
    await o.context().close();
  });

  test('a read-only pharmacy keeps the reports, the chain and the exports open', async ({ browser }) => {
    test.setTimeout(180_000);
    const client = db();
    try {
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
      const o = await session(browser, owner, shop, null);
      await o.goto('/pharmacy/reports/sales');
      await expect(o.getByTestId('read-only-notice')).toBeVisible();
      expect(await text(o, 'net-IQD')).toBe('4,135 IQD');
      const download = o.waitForEvent('download');
      await o.getByTestId('export-csv').click();
      expect((await download).suggestedFilename()).toMatch(/\.csv$/);
      await expect(o.getByTestId('export-done')).toBeVisible();
      await o.goto('/pharmacy/reports/stock-valuation');
      expect(await text(o, 'units-available')).toBe('445');
      await o.goto('/pharmacy/chain');
      await expect(o.getByTestId('chain-card-total')).toBeVisible();
      const chain = o.waitForEvent('download');
      await o.getByTestId('export-xlsx').click();
      expect((await chain).suggestedFilename()).toMatch(/\.xlsx$/);
      await o.context().close();
    } finally {
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() + 29 * DAY) } });
      await client.$disconnect();
    }
  });

  /** No sideways scroll and no serious axe finding at 375, 768 and 1280 (a screenshot of each). */
  async function check(page: Page, name: string, widths = [375, 768, 1280]): Promise<void> {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await scrollsSideways(page), `${name} at ${width}px`).toBe(false);
      expect(await seriousViolations(page), `${name} at ${width}px`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
    }
  }

  async function auditLocale(browser: Browser, locale: 'en' | 'ar' | 'ckb'): Promise<void> {
    for (const u of [owner, mgrA, cashier, pic, ownerEmpty, ownerBig]) await setUserLocale(u.userId, locale);
    const dir = locale === 'en' ? 'ltr' : 'rtl';
    const small = { width: 375, height: 800 };
    const idA = shop.branches[0]!.id;

    // The owner, with data: the index, every report, the chain, an invalid address, and the export refusal.
    const o = await session(browser, owner, shop, null, small);
    await expect(o.locator('html')).toHaveAttribute('dir', dir);
    const states: Array<[string, string]> = [
      ['index', '/pharmacy/reports'],
      ['sales', '/pharmacy/reports/sales'],
      ['sales-product', '/pharmacy/reports/sales?group=product'],
      ['sales-method', '/pharmacy/reports/sales?group=method'],
      ['returns', '/pharmacy/reports/returns'],
      ['discounts', '/pharmacy/reports/discounts'],
      ['margin', '/pharmacy/reports/margin'],
      ['valuation', '/pharmacy/reports/stock-valuation'],
      ['expiry', '/pharmacy/reports/expiry'],
      ['damaged', '/pharmacy/reports/damaged'],
      ['transfers', '/pharmacy/reports/transfers'],
      ['low-stock', '/pharmacy/reports/low-stock'],
      ['chain', '/pharmacy/chain'],
      ['invalid-dates', '/pharmacy/reports/sales?from=2026-13-45&to=2026-01-31'],
      ['invalid-range', '/pharmacy/reports/sales?from=2025-01-01&to=2026-06-01'],
      ['invalid-branch', `/pharmacy/reports/sales?branch=${other.branches[0]!.id}`],
      ['long-range', '/pharmacy/reports/sales?from=2026-01-01&to=2026-12-31'],
      ['chain-invalid', '/pharmacy/chain?from=nope'],
      ['one-branch-branch', `/pharmacy/reports/sales?branch=${idA}`],
    ];
    for (const [name, url] of states) {
      await o.goto(url);
      await check(o, `${locale}-${name}`);
    }
    // The export refusal in words.
    await o.goto('/pharmacy/reports/sales');
    await o.route('**/pharmacy/reports/export**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID', message: 'This report has too many rows for one file. Narrow the dates or choose a branch.', fields: { phCode: 'EXPORT_TOO_LARGE', limit: '50000' } } }) }));
    await o.getByTestId('export-csv').click();
    await expect(o.getByTestId('export-error')).toBeVisible();
    await check(o, `${locale}-export-refused`);
    await o.unroute('**/pharmacy/reports/export**');
    await o.context().close();

    // The pharmacist in charge: the margin gate. The manager of one branch: the chain explanation.
    const p = await session(browser, pic, shop, null, small);
    await p.goto('/pharmacy/reports/margin');
    await expect(p.getByTestId('report-gated')).toBeVisible();
    await check(p, `${locale}-gated`);
    await p.goto('/pharmacy/reports');
    await check(p, `${locale}-index-no-margin`);
    await p.goto('/pharmacy/chain');
    await check(p, `${locale}-chain-no-margin`);
    await p.context().close();
    const m = await session(browser, mgrA, shop, A, small);
    await m.goto('/pharmacy/chain');
    await expect(m.getByTestId('chain-one-branch')).toBeVisible();
    await check(m, `${locale}-chain-one-branch`);
    await m.context().close();

    // A role without report.view: the blocked state on the index, a report and the chain.
    const c = await session(browser, cashier, shop, A, small);
    for (const [name, url] of [['forbidden', '/pharmacy/reports'], ['forbidden-report', '/pharmacy/reports/sales'], ['forbidden-chain', '/pharmacy/chain']] as const) {
      await c.goto(url);
      await expect(c.getByTestId('reports-forbidden')).toBeVisible();
      await check(c, `${locale}-${name}`);
    }
    await c.context().close();

    // A pharmacy with nothing in it: every report and the chain say so, naming the filter.
    const e = await session(browser, ownerEmpty, empty, null, small);
    for (const [name, url] of [['empty-sales', '/pharmacy/reports/sales'], ['empty-returns', '/pharmacy/reports/returns'], ['empty-valuation', '/pharmacy/reports/stock-valuation'], ['empty-expiry', '/pharmacy/reports/expiry'], ['empty-transfers', '/pharmacy/reports/transfers'], ['empty-low-stock', '/pharmacy/reports/low-stock'], ['empty-chain', '/pharmacy/chain']] as const) {
      await e.goto(url);
      await expect(e.getByTestId('report-empty')).toBeVisible();
      await check(e, `${locale}-${name}`);
    }
    await e.context().close();

    // A long list, 200 rows at the phone width.
    const b = await session(browser, ownerBig, big, null, small);
    await b.goto('/pharmacy/reports/low-stock?pages=2');
    await check(b, `${locale}-low-stock-200`, [375]);
    await b.context().close();

    // A lapsed subscription: reports and the chain stay readable.
    const client = db();
    try {
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
      const ro = await session(browser, owner, shop, null, small);
      for (const [name, url] of [['read-only-sales', '/pharmacy/reports/sales'], ['read-only-chain', '/pharmacy/chain']] as const) {
        await ro.goto(url);
        await expect(ro.getByTestId('read-only-notice')).toBeVisible();
        await check(ro, `${locale}-${name}`);
      }
      await ro.context().close();
    } finally {
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() + 29 * DAY) } });
      await client.$disconnect();
    }
  }

  test('English: no sideways scroll and axe clean on every screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'en');
  });
  test('Arabic: no sideways scroll and axe clean on every screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'ar');
  });
  test('Sorani: no sideways scroll and axe clean on every screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'ckb');
    for (const u of [owner, mgrA, cashier, pic, ownerEmpty, ownerBig]) await setUserLocale(u.userId, 'en');
  });
});
