import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { barsOf } from '@/app/pharmacy/_ui/code128';
import { QUIET_MODULES } from '@/app/pharmacy/_ui/print-logic';
import { createPrisma } from '@/server/data/prisma';
import { scopedClient } from '@/server/data/tenant-db';
import { searchTextOf } from '@/server/domain/pharmacy/product-identity';
import { applyMovement } from '@/server/pharmacy/stock';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { ASSISTANT_SCRIPT_PATH } from './helpers/phase7b-env';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, setUserLocale, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * Phase 7 task 6, end to end: the assistant (answers with tables, the scripted mock model, every degraded state, starters, suggestions
 * that open a pre-filled draft and create nothing else, read-only mode) and advanced printing (A4 invoice and return slip with hand
 * figures, reprint logging with a dropped answer, label sheets with a Code 128 SVG equal to the unit encoder, per-workstation settings
 * and the test pages), then English, Arabic and Sorani with axe and no sideways scroll at three widths on every new screen and state.
 * The AI is the SCRIPTED provider (never a real model). Run:
 * `npx playwright test -c playwright.phase7b.config.ts --workers=1 tests/e2e/pharmacy-phase7b.spec.ts`.
 */

const DAY = 86_400_000;
const SHOTS = '.superpowers/sdd/2026-11-01-pharmacy-phase-7/task-6-shots';
const CODE = '5901234123457';
const db = () => createPrisma(databaseUrl(DEV_DB));
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const script = (answer: unknown) => writeFileSync(ASSISTANT_SCRIPT_PATH, JSON.stringify({ '': answer }));

interface Shop {
  id: string;
  name: string;
  branches: { id: string; name: string }[];
}

async function makeShop(label: string): Promise<Shop> {
  const client = db();
  try {
    const name = `E2E ${label} ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branches: Shop['branches'] = [];
    for (const [i, base] of ['Main', 'Second'].entries()) {
      const bn = `${base} ${randomUUID().slice(0, 4)}`;
      const created = await client.branch.create({ data: { restaurantId: row.id, name: bn, sortOrder: i }, select: { id: true } });
      branches.push({ id: created.id, name: bn });
    }
    const now = Date.now();
    await client.subscription.create({
      data: { restaurantId: row.id, applicationId: 'pharmacy', planCode: 'standard', status: 'ACTIVE', period: 'MONTHLY', currency: 'IQD', priceMinor: 0, currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY), graceDays: 7, version: 1 },
    });
    await client.phSettings.upsert({ where: { restaurantId: row.id }, create: { restaurantId: row.id, enabledCurrencies: ['IQD'], defaultCurrency: 'IQD' }, update: {} });
    return { id: row.id, name, branches };
  } finally {
    await client.$disconnect();
  }
}

/** Panadol (OTC, 250 IQD a tablet, a barcode) with LOT-1 (100 tablets, expires in 20 days) and LOT-2 (40, in 300) at Main; minimums at both branches (Main 50 so it can spare stock, Second 30 with none). */
async function seedCatalog(shop: Shop, tag: string): Promise<{ name: string; productId: string; plainName: string }> {
  const client = db();
  try {
    const make = async (tradeName: string, barcode: string | null, stocked: boolean) => {
      const product = await client.phProduct.create({
        data: {
          restaurantId: shop.id,
          tradeName,
          strength: '500 mg',
          form: 'tablet',
          rxLevel: 'OTC',
          identityKey: `${tradeName}|${shop.id}`,
          searchText: searchTextOf({ tradeName, genericName: '', activeIngredient: '', strength: '500 mg', form: 'tablet', manufacturer: '' }),
        },
        select: { id: true },
      });
      const tablet = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 0, label: 'tablet', baseQty: 1 }, select: { id: true } });
      const strip = await client.phProductUnit.create({ data: { restaurantId: shop.id, productId: product.id, level: 1, label: 'strip', baseQty: 10 }, select: { id: true } });
      for (const [unitId, amountMinor] of [[tablet.id, 250n], [strip.id, 2000n]] as const) {
        await client.phPrice.create({ data: { restaurantId: shop.id, productId: product.id, unitId, currency: 'IQD', amountMinor, validFrom: new Date('2026-01-01T00:00:00.000Z'), changedById: 'seed' } });
      }
      if (barcode) await client.phBarcode.create({ data: { restaurantId: shop.id, productId: product.id, unitId: tablet.id, code: barcode } });
      if (!stocked) return product.id;
      const scoped = scopedClient(client, { restaurantId: shop.id, allBranches: true });
      for (const [lot, days, qty] of [['LOT-1', 20, 100], ['LOT-2', 300, 40]] as const) {
        const batch = await client.phBatch.create({ data: { restaurantId: shop.id, productId: product.id, lot, expiryDate: new Date(`${dateIn(days)}T00:00:00.000Z`) }, select: { id: true } });
        await scoped.$transaction(async (tx) => {
          await applyMovement(tx, { restaurantId: shop.id, branchId: shop.branches[0]!.id, batchId: batch.id, userId: 'seed', type: 'RECEIPT', deltas: { available: qty }, reason: '' });
        });
      }
      await client.phProductBranch.create({ data: { restaurantId: shop.id, branchId: shop.branches[0]!.id, productId: product.id, minQty: 50, reorderQty: 200 } });
      await client.phProductBranch.create({ data: { restaurantId: shop.id, branchId: shop.branches[1]!.id, productId: product.id, minQty: 30, reorderQty: 50 } });
      return product.id;
    };
    const productId = await make(`Panadol ${tag}`, CODE, true);
    await make(`Plainbox ${tag}`, null, false);
    return { name: `Panadol ${tag}`, productId, plainName: `Plainbox ${tag}` };
  } finally {
    await client.$disconnect();
  }
}

type StaffRole = 'BRANCH_MANAGER' | 'PHARMACIST' | 'CASHIER' | 'ACCOUNTANT';
async function staff(userId: string, shop: Shop, role: StaffRole, both: boolean): Promise<void> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId, restaurantId: shop.id, role }, select: { id: true } });
    for (const b of both ? shop.branches : [shop.branches[0]!]) await client.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: b.id } });
  } finally {
    await client.$disconnect();
  }
}

const logins = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

/** Signs in (once per person) and chooses a place: the branch by name, or `null` for "All branches" (an owner). */
async function session(browser: Browser, user: StudioUser, shop: Shop, branch: string | null, viewport = { width: 1280, height: 900 }): Promise<Page> {
  const saved = logins.get(user.email);
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport, ...(saved ? { storageState: saved } : {}) });
  await hideDevTools(context);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  // The print dialog is not driven here: window.print is counted instead.
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
  });
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

const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);

async function openShift(page: Page): Promise<void> {
  await page.goto('/pharmacy/sell');
  await expect(page.getByTestId('open-shift').or(page.getByTestId('sell-workspace'))).toBeVisible();
  if (await page.getByTestId('open-shift').isVisible()) {
    await page.getByTestId('shift-float').fill('10,000');
    await page.getByTestId('shift-open').click();
  }
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

/** Asks a typed question (the model path). */
async function ask(page: Page, question: string): Promise<void> {
  await page.getByTestId('assistant-question').fill(question);
  await page.getByTestId('assistant-ask').click();
}

/** Chooses a product (and optionally a batch) in the assistant's picker. */
async function pickProduct(page: Page, name: string, lot?: string): Promise<void> {
  const box = page.getByTestId('assistant-product').getByTestId('receipt-picker').locator('input[type="search"]');
  await box.fill(name);
  await box.press('Enter');
  await expect(page.getByTestId('assistant-product-chosen')).toBeVisible();
  if (lot) {
    const value = await page.getByTestId('assistant-batch').locator('option', { hasText: lot }).first().getAttribute('value');
    await page.getByTestId('assistant-batch').selectOption(value!);
  }
}

const counts = async (shopId: string) => {
  const client = db();
  try {
    const [transfers, orders, returns, proposals, accepted] = await Promise.all([
      client.phTransfer.count({ where: { restaurantId: shopId } }),
      client.phPurchaseOrder.count({ where: { restaurantId: shopId } }),
      client.phSupplierReturn.count({ where: { restaurantId: shopId } }),
      client.phAiProposal.count({ where: { restaurantId: shopId } }),
      client.phAiProposal.count({ where: { restaurantId: shopId, status: 'ACCEPTED' } }),
    ]);
    return { transfers, orders, returns, proposals, accepted };
  } finally {
    await client.$disconnect();
  }
};

/** The server does the next Server Action on `url` and the browser never gets the answer (a dropped connection). */
async function dropNextAnswer(page: Page, url: string): Promise<void> {
  let dropped = false;
  await page.route(url, async (route) => {
    if (!dropped && route.request().method() === 'POST' && route.request().headers()['next-action']) {
      dropped = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
}

async function barsOnScreen(label: Locator): Promise<{ x: number; w: number }[]> {
  return label.locator('rect').evaluateAll((rects) => rects.map((r) => ({ x: Number(r.getAttribute('x')), w: Number(r.getAttribute('width')) })));
}

test.describe.configure({ mode: 'serial' });

test.describe('Pharmacy phase 7 assistant and printing @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let planWas: { limits: unknown } | null = null;
  let planMade = false;
  let shop: Shop;
  let other: Shop;
  let names: { name: string; productId: string; plainName: string };
  let owner: StudioUser;
  let ownerB: StudioUser;
  let manager: StudioUser;
  let pharmacist: StudioUser;
  let accountant: StudioUser;
  let cashier: StudioUser;
  let main: string;
  const ids: { sale?: string; ret?: string; proposals?: Record<string, string> } = {};

  const setBudgetCents = async (cents: number) => {
    const client = db();
    try {
      await client.appPlan.update({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, data: { limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: cents } } });
    } finally {
      await client.$disconnect();
    }
  };

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    mkdirSync(SHOTS, { recursive: true });
    script({ text: 'Some batches are close to their expiry dates.' });
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      console.log(`Application(pharmacy) before: ${applicationWas}, set to ACTIVE for this run`);
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
      planWas = await client.appPlan.findUnique({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, select: { limits: true } });
      console.log(`AppPlan(pharmacy/standard) before: ${planWas ? JSON.stringify(planWas.limits) : 'none'}`);
      if (planWas) await client.appPlan.update({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, data: { limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 1000 } } });
      else {
        await client.appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 1000 } } });
        planMade = true;
      }
    } finally {
      await client.$disconnect();
    }
    shop = await makeShop('Phase7b');
    other = await makeShop('Other7b');
    restaurants.push(shop.id, other.id);
    main = shop.branches[0]!.name;
    names = await seedCatalog(shop, randomUUID().slice(0, 5));
    const make = async (label: string) => {
      const user = await createStudioUser({ label: `ph-p7b-${label}`, name: `P7b ${label}` });
      people.push(user.email);
      return user;
    };
    [owner, ownerB, manager, pharmacist, accountant, cashier] = (await Promise.all(['owner', 'ownerb', 'manager', 'pharmacist', 'accountant', 'cashier'].map(make))) as [StudioUser, StudioUser, StudioUser, StudioUser, StudioUser, StudioUser];
    await staff(manager.userId, shop, 'BRANCH_MANAGER', true);
    await staff(pharmacist.userId, shop, 'PHARMACIST', false);
    await staff(accountant.userId, shop, 'ACCOUNTANT', true);
    await staff(cashier.userId, shop, 'CASHIER', false);
    await assignMember(owner.userId, shop.id, 'OWNER');
    await assignMember(ownerB.userId, other.id, 'OWNER');
  });

  test.afterAll(async () => {
    const client = db();
    try {
      if (applicationWas) {
        await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
        console.log(`Application(pharmacy) restored to ${applicationWas}`);
      }
      if (planMade) {
        await client.appPlan.delete({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } } });
        console.log('AppPlan(pharmacy/standard) removed (it did not exist before)');
      } else if (planWas) {
        await client.appPlan.update({ where: { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } }, data: { limits: planWas.limits as never } });
        console.log(`AppPlan(pharmacy/standard) restored to ${JSON.stringify(planWas.limits)}`);
      }
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  // -----------------------------------------------------------------------------------------------------------------------------
  // The assistant
  // -----------------------------------------------------------------------------------------------------------------------------

  test('the owner asks: grounded prose from the scripted model, the tables, the facts and a link to the matching report; starters need no model', async ({ browser }) => {
    test.setTimeout(240_000);
    script({ text: 'Some batches are close to their expiry dates.' });
    const o = await session(browser, owner, shop, null);
    await o.goto('/pharmacy/assistant');
    await expect(o.getByTestId('assistant')).toBeVisible();
    await expect(o.getByTestId('assistant-counter')).toContainText('0');
    await o.getByTestId('assistant-question').fill('x'.repeat(1001));
    await expect(o.getByTestId('assistant-ask')).toBeDisabled();
    await ask(o, 'Which batches are expiring soon?');
    await expect(o.getByTestId('assistant-result')).toBeVisible();
    await expect(o.getByTestId('assistant-result')).toHaveAttribute('data-label', 'fact');
    await expect(o.getByTestId('assistant-prose')).toContainText('close to their expiry dates');
    await expect(o.getByTestId('assistant-notice')).toHaveCount(0);
    const rows = o.getByTestId('result-batches_expiring').getByTestId('table-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('LOT-1');
    await expect(rows.first()).toContainText('100');
    await expect(o.getByTestId('result-asof')).toBeVisible();
    await expect(o.getByTestId('result-link').first()).toHaveAttribute('href', /\/pharmacy\/stock\/expiry\?days=\d+/);
    // The question is nowhere in the address bar or the browser's storage.
    expect(o.url()).not.toContain('expiring');
    expect(await o.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain('expiring');

    // A starter runs the tool with no model: the model is scripted to fail, and nothing about it shows.
    script({ error: 'error' });
    await o.getByTestId('starter-stock_below_reorder').click();
    await expect(o.getByTestId('result-stock_below_reorder')).toBeVisible();
    await expect(o.getByTestId('assistant-notice')).toHaveCount(0);
    await expect(o.getByTestId('assistant-prose')).toHaveCount(0);
    await expect(o.getByTestId('result-stock_below_reorder').getByTestId('table-row')).toHaveCount(1); // only Second (0 of 30): Main holds 140 against a minimum of 50
    // A forecast needs a product, and there is not enough history: the fixed sentence in words.
    await pickProduct(o, names.name);
    await o.getByTestId('starter-forecast').click();
    await expect(o.getByTestId('assistant-refusal')).toHaveAttribute('data-refusal', 'insufficientData');
    await o.screenshot({ path: `${SHOTS}/en-assistant-forecast-insufficient.png`, fullPage: true });
    await o.context().close();
  });

  test('degraded states, each in words with an icon and the tables kept: ungrounded, provider failure, budget reached, no ai.use, a refusal, and a role without reports', async ({ browser }) => {
    test.setTimeout(300_000);
    const m = await session(browser, manager, shop, main);
    await m.goto('/pharmacy/assistant');
    // Ungrounded: the model's prose names a figure the tables do not hold, so it is withheld.
    script({ text: 'There are 999 batches close to expiry.' });
    await ask(m, 'Which batches are expiring soon?');
    await expect(m.getByTestId('assistant-notice')).toHaveAttribute('data-notice', 'ungrounded');
    await expect(m.getByTestId('assistant-prose')).toHaveCount(0);
    await expect(m.getByTestId('result-batches_expiring').getByTestId('table-row')).toHaveCount(1);
    await expect(m.getByTestId('assistant-result')).not.toContainText('999');
    // Provider failure.
    script({ error: 'error' });
    await ask(m, 'Which batches are expiring soon?');
    await expect(m.getByTestId('assistant-notice')).toHaveAttribute('data-notice', 'provider');
    await expect(m.getByTestId('result-batches_expiring').getByTestId('table-row')).toHaveCount(1);
    // Budget reached: the plan allows one cent a month, less than one call reserves.
    script({ text: 'Some batches are close to their expiry dates.' });
    await setBudgetCents(1);
    await ask(m, 'Which batches are expiring soon?');
    await expect(m.getByTestId('assistant-notice')).toHaveAttribute('data-notice', 'budget');
    await expect(m.getByTestId('result-batches_expiring').getByTestId('table-row')).toHaveCount(1);
    await setBudgetCents(1000);
    // A clinical question is refused in words, with no tables and no model.
    await ask(m, 'What is the dose of amoxicillin for a child?');
    await expect(m.getByTestId('assistant-refusal')).toHaveAttribute('data-refusal', 'clinical');
    await expect(m.getByTestId('result-batches_expiring')).toHaveCount(0);
    await ask(m, 'Can we sell the expired batches to customers?');
    await expect(m.getByTestId('assistant-refusal')).toHaveAttribute('data-refusal', 'unsafeStock');
    await m.context().close();

    // An accountant reads reports but has no ai.use: the tables, a plain notice, no prose, and no suggestion control.
    const a = await session(browser, accountant, shop, main);
    await a.goto('/pharmacy/assistant');
    await ask(a, 'Which products are below the reorder level?');
    await expect(a.getByTestId('assistant-notice')).toHaveAttribute('data-notice', 'noAi');
    await expect(a.getByTestId('assistant-prose')).toHaveCount(0);
    await expect(a.getByTestId('result-stock_below_reorder').getByTestId('table-row').first()).toBeVisible();
    await expect(a.getByTestId('row-propose')).toHaveCount(0);
    await expect(a.getByTestId('proposals-link')).toHaveCount(0);
    await a.context().close();

    // A cashier has no reports: the question is refused in words and no table is drawn.
    const c = await session(browser, cashier, shop, main);
    await c.goto('/pharmacy/assistant');
    await ask(c, 'Which batches are expiring soon?');
    await expect(c.getByTestId('assistant-problem')).toBeVisible();
    await expect(c.getByTestId('assistant-result')).toHaveCount(0);
    await c.context().close();
  });

  test('suggestions: made from table rows, reviewed in words, accepting opens the existing pre-filled draft and creates nothing else; one decision wins', async ({ browser }) => {
    test.setTimeout(300_000);
    const m = await session(browser, manager, shop, main);
    await m.goto('/pharmacy/assistant');
    // From three tables: below reorder, expiring (a supplier return) and a transfer candidate (needs a product and batch).
    await m.getByTestId('starter-stock_below_reorder').click();
    await m.getByTestId('result-stock_below_reorder').getByTestId('row-propose').first().click();
    await expect(m.getByTestId('result-stock_below_reorder').getByTestId('row-propose').first()).toBeDisabled();
    await m.getByTestId('starter-batches_expiring').click();
    await m.getByTestId('result-batches_expiring').getByTestId('row-propose').first().click();
    await pickProduct(m, names.name, 'LOT-1');
    await m.getByTestId('starter-transfer_candidates').click();
    await expect(m.getByTestId('result-transfer_candidates').getByTestId('table-row').first()).toBeVisible();
    await m.getByTestId('result-transfer_candidates').getByTestId('row-propose').first().click();
    await expect(m.getByTestId('proposals-made')).toBeVisible();
    await m.screenshot({ path: `${SHOTS}/en-assistant-suggestions-made.png`, fullPage: true });

    const client = db();
    try {
      const rows = await client.phAiProposal.findMany({ where: { restaurantId: shop.id }, select: { id: true, kind: true } });
      expect(rows.map((r) => r.kind).sort()).toEqual(['REORDER', 'SUPPLIER_RETURN', 'TRANSFER']);
      ids.proposals = Object.fromEntries(rows.map((r) => [r.kind, r.id]));
    } finally {
      await client.$disconnect();
    }
    const before = await counts(shop.id);
    expect(before).toMatchObject({ transfers: 0, orders: 0, returns: 0, proposals: 3, accepted: 0 });

    await m.goto('/pharmacy/assistant/proposals');
    await expect(m.getByTestId('proposal-row')).toHaveCount(3);
    // The review spells out the effect; a second person opens the same suggestion to try a conflicting decision.
    await m.goto(`/pharmacy/assistant/proposals/${ids.proposals!.TRANSFER}`);
    await expect(m.getByTestId('proposal-review')).toContainText('creates nothing until you accept');
    await expect(m.getByTestId('proposal-line')).toHaveCount(1);
    const other2 = await session(browser, manager, shop, main);
    await other2.goto(`/pharmacy/assistant/proposals/${ids.proposals!.TRANSFER}`);
    await expect(other2.getByTestId('proposal-dismiss')).toBeVisible();

    await m.getByTestId('proposal-accept').click();
    await expect(m).toHaveURL(/\/pharmacy\/stock\/transfers\/new\?proposal=/);
    await expect(m.getByTestId('assistant-prefill')).toBeVisible();
    await expect(m.getByTestId('transfer-line')).toHaveCount(1);
    expect(await counts(shop.id)).toEqual({ transfers: 0, orders: 0, returns: 0, proposals: 3, accepted: 1 });
    await m.screenshot({ path: `${SHOTS}/en-assistant-accept-opens-draft.png`, fullPage: true });

    // The other person's dismiss loses: the suggestion is shown as decided, and nothing changed.
    await other2.getByTestId('proposal-dismiss').click();
    await expect(other2.getByTestId('proposal-decided')).toHaveAttribute('data-state', 'accepted');
    expect(await counts(shop.id)).toEqual({ transfers: 0, orders: 0, returns: 0, proposals: 3, accepted: 1 });
    await other2.context().close();

    // The reorder suggestion opens a purchase order draft with its line; again nothing is created.
    await m.goto(`/pharmacy/assistant/proposals/${ids.proposals!.REORDER}`);
    await m.getByTestId('proposal-accept').click();
    await expect(m).toHaveURL(/\/pharmacy\/purchasing\/orders\/new\?proposal=/);
    await expect(m.getByTestId('assistant-prefill')).toBeVisible();
    await expect(m.getByTestId('po-line')).toHaveCount(1);
    expect(await counts(shop.id)).toEqual({ transfers: 0, orders: 0, returns: 0, proposals: 3, accepted: 2 });
    // The supplier return suggestion is dismissed: nothing opens.
    await m.goto(`/pharmacy/assistant/proposals/${ids.proposals!.SUPPLIER_RETURN}`);
    await m.getByTestId('proposal-dismiss').click();
    await expect(m.getByTestId('proposal-decided')).toHaveAttribute('data-state', 'dismissed');
    expect(await counts(shop.id)).toEqual({ transfers: 0, orders: 0, returns: 0, proposals: 3, accepted: 2 });
    await m.context().close();
  });

  // -----------------------------------------------------------------------------------------------------------------------------
  // Printing: A4 invoice and return slip
  // -----------------------------------------------------------------------------------------------------------------------------

  test('A4 invoice and return slip show the hand figures; each reprint writes one numbered log row, and a retry after a dropped answer does not duplicate', async ({ browser }) => {
    test.setTimeout(420_000);
    // 3 tablets at 250 = 750, paid with 1 000: change 250.
    const p = await session(browser, pharmacist, shop, main);
    await openShift(p);
    await p.getByTestId('sell-search').fill(names.name);
    await p.getByTestId('result').filter({ hasText: names.name }).getByTestId('add-unit').first().click();
    await expect(p.getByTestId('cart-line')).toHaveCount(1);
    await p.getByTestId('qty-input').fill('3');
    await p.keyboard.press('F4');
    await p.getByTestId('pay-tendered').fill('1000');
    await p.getByTestId('pay-confirm').click();
    await expect(p.getByTestId('sale-done')).toBeVisible();
    await p.getByTestId('receipt-done').click();
    await p.context().close();
    const client = db();
    try {
      ids.sale = (await client.phSale.findFirstOrThrow({ where: { restaurantId: shop.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })).id;
    } finally {
      await client.$disconnect();
    }

    // A return of one tablet (250) by the manager.
    const m = await session(browser, manager, shop, main);
    await openShift(m); // the refund is recorded in the manager's shift
    await m.goto(`/pharmacy/sales/${ids.sale}`);
    await m.getByTestId('sale-return').click();
    await m.getByTestId('return-qty').fill('1');
    await m.getByTestId('return-reason').fill('Box damaged');
    await m.getByTestId('return-confirm').click();
    await expect(m.getByTestId('return-done')).toBeVisible();
    const check = db();
    try {
      ids.ret = (await check.phReturn.findFirstOrThrow({ where: { restaurantId: shop.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })).id;
    } finally {
      await check.$disconnect();
    }
    await m.goto(`/pharmacy/returns/${ids.ret}/slip`);
    await expect(m.getByTestId('a4-sheet')).toBeVisible();
    await expect(m.getByTestId('a4-line')).toHaveCount(1);
    await expect(m.getByTestId('a4-total')).toContainText('250');
    await m.context().close();

    const o = await session(browser, owner, shop, main); // a document is drawn for a branch, so an owner chooses one
    await o.goto(`/pharmacy/sales/${ids.sale}/invoice`);
    await expect(o.getByTestId('a4-sheet')).toBeVisible();
    await expect(o.getByTestId('a4-line')).toHaveCount(1);
    await expect(o.getByTestId('a4-qty')).toContainText('3');
    await expect(o.getByTestId('a4-line-total')).toContainText('750');
    await expect(o.getByTestId('a4-total')).toContainText('750');
    await expect(o.getByTestId('a4-paid')).toContainText(/1,?000/);
    await expect(o.getByTestId('a4-change')).toContainText('250');
    await expect(o.getByTestId('a4-payment')).toHaveCount(1);
    await expect(o.getByTestId('a4-copy-marker')).toHaveCount(0); // the first print is not a copy
    // The page carries an A4 @page rule and the browser's print dialog is the only printing.
    expect(await o.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join(''))).toMatch(/@page\s*\{\s*size:\s*A4/);
    await o.getByTestId('a4-print').click();
    expect(await prints(o)).toBe(1);
    const logRows = async () => {
      const c = db();
      try {
        return await c.phReceiptReprint.findMany({ where: { restaurantId: shop.id, saleId: ids.sale! }, select: { copyNumber: true, clientKey: true }, orderBy: { copyNumber: 'asc' } });
      } finally {
        await c.$disconnect();
      }
    };
    expect(await logRows()).toEqual([]); // printing the first copy writes nothing
    // Reprint 1: one log row, copy number 1, the page says COPY and prints.
    await o.getByTestId('a4-reprint').click();
    await expect(o.getByTestId('a4-logged')).toContainText('1');
    await expect(o.getByTestId('a4-copy-marker')).toBeVisible();
    expect(await prints(o)).toBe(2);
    expect((await logRows()).map((r) => r.copyNumber)).toEqual([1]);
    // Reprint 2: the server logs it but the answer never reaches the browser; the person presses again with the SAME key and gets the copy already logged.
    await dropNextAnswer(o, `**/pharmacy/sales/${ids.sale}/invoice`);
    await o.getByTestId('a4-reprint').click();
    await expect(o.getByTestId('a4-problem')).toBeVisible();
    expect((await logRows()).map((r) => r.copyNumber)).toEqual([1, 2]);
    await o.getByTestId('a4-reprint').click();
    await expect(o.getByTestId('a4-logged')).toContainText('2');
    expect((await logRows()).map((r) => r.copyNumber)).toEqual([1, 2]);
    await o.screenshot({ path: `${SHOTS}/en-a4-invoice-copy.png`, fullPage: true });
    await o.context().close();
  });

  // -----------------------------------------------------------------------------------------------------------------------------
  // Printing: labels and settings
  // -----------------------------------------------------------------------------------------------------------------------------

  test('labels: shelf and batch labels with a Code 128 SVG equal to the unit encoder, three sizes with their @page size, quantity, the price only when shown', async ({ browser }) => {
    test.setTimeout(240_000);
    const o = await session(browser, owner, shop, main);
    await o.goto('/pharmacy/print/labels');
    await expect(o.getByTestId('labels-empty')).toBeVisible();
    const box = o.getByTestId('receipt-picker').locator('input[type="search"]');
    await box.fill(names.name);
    await box.press('Enter');
    await expect(o.getByTestId('labels-current')).toBeVisible();
    await o.getByTestId('labels-add-shelf').click();
    await expect(o.getByTestId('labels-queue-item')).toHaveCount(1);
    await o.getByTestId('labels-qty').first().fill('3');
    const label = o.getByTestId('labels-preview').getByTestId('label').first();
    await expect(label).toBeVisible();
    await expect(label.getByTestId('label-name')).toContainText(names.name);
    await expect(label.getByTestId('label-barcode')).toHaveAttribute('data-code', CODE);
    // The bars on screen are exactly the encoder's, shifted by the quiet zone on the left.
    expect((await barsOnScreen(label.getByTestId('label-barcode'))).map((b) => ({ x: b.x - QUIET_MODULES, w: b.w }))).toEqual(barsOf(CODE).bars);
    await expect(label.getByTestId('label-code')).toContainText(CODE);
    // Three copies in the print sheet; the price follows the toggle.
    await expect(o.getByTestId('labels-sheet').getByTestId('label')).toHaveCount(3);
    await o.getByTestId('labels-price').check();
    await expect(label.getByTestId('label-price')).toContainText('250');
    await o.getByTestId('labels-price').uncheck();
    await expect(label.getByTestId('label-price')).toHaveCount(0);
    // Sizes: the preview and the @page rule follow, in millimetres.
    for (const [value, w, h] of [['40x25', 40, 25], ['50x30', 50, 30], ['58', 58, 40]] as const) {
      await o.getByTestId('labels-size').selectOption(value);
      await expect(o.getByTestId('labels-page-size')).toContainText(`${w}`);
      expect(await o.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join(''))).toContain(`size: ${w}mm ${h}mm`);
      const size = await label.evaluate((el) => ({ w: (el as HTMLElement).style.width, h: (el as HTMLElement).style.height }));
      expect(size).toEqual({ w: `${w}mm`, h: `${h}mm` });
    }
    // A batch label carries the batch and expiry instead of the price.
    await o.getByTestId('labels-add-batch').first().click();
    await expect(o.getByTestId('labels-queue-item')).toHaveCount(2);
    await expect(o.getByTestId('labels-preview').getByTestId('label-batch').first()).toContainText('LOT-');
    // A bad quantity is said in words and blocks printing; a whole number from 1 to 200 prints.
    await o.getByTestId('labels-qty').first().fill('0');
    await expect(o.getByTestId('labels-print')).toBeDisabled();
    await o.getByTestId('labels-qty').first().fill('2');
    await o.getByTestId('labels-print').click();
    expect(await prints(o)).toBe(1);
    // A product with no barcode is said in words, never drawn wrong.
    await box.fill(names.plainName);
    await box.press('Enter');
    await expect(o.getByTestId('labels-current')).toContainText(names.plainName);
    await o.getByTestId('labels-add-shelf').click();
    await expect(o.getByTestId('labels-sheet').getByTestId('label-no-barcode')).toHaveCount(1); // the preview shows only the first labels; the sheet holds them all
    await o.screenshot({ path: `${SHOTS}/en-labels.png`, fullPage: true });
    await o.context().close();
  });

  test('print settings: the owner saves per workstation, a manager only reads, the test pages print, and a bad margin is refused in words', async ({ browser }) => {
    test.setTimeout(240_000);
    const o = await session(browser, owner, shop, main);
    await o.goto('/pharmacy/print/settings');
    await expect(o.getByTestId('print-settings')).toBeVisible();
    await o.getByTestId('ws-name').fill('Counter 1');
    await o.getByTestId('ws-paper').selectOption('A5');
    await o.getByTestId('ws-margin-top').fill('99');
    await expect(o.getByTestId('ws-save')).toBeDisabled();
    await o.getByTestId('ws-margin-top').fill('12');
    await o.getByTestId('ws-margin-left').fill('8');
    await o.getByTestId('ws-label-size').selectOption('50x30');
    await o.getByTestId('ws-show-price').check();
    await o.getByTestId('ws-save').click();
    await expect(o.getByTestId('print-settings-saved')).toBeVisible();
    const client = db();
    try {
      const row = await client.phSettings.findUniqueOrThrow({ where: { restaurantId: shop.id }, select: { print: true } });
      expect(row.print).toMatchObject({ workstations: { 'Counter 1': { paper: 'A5', labelSize: '50x30', showPrice: true, marginMm: { top: 12, left: 8 } } } });
    } finally {
      await client.$disconnect();
    }
    // The name is remembered on this device; the next screens use its settings.
    await o.goto(`/pharmacy/sales/${ids.sale}/invoice`);
    await expect(o.getByTestId('a4-workstation')).toContainText('Counter 1');
    expect(await o.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join(''))).toContain('margin: 12mm');
    await o.goto('/pharmacy/print/settings');
    await o.getByTestId('test-a4').click();
    expect(await prints(o)).toBe(1);
    await expect(o.getByTestId('test-a4-sheet')).toBeAttached();
    await o.getByTestId('test-label').click();
    expect(await prints(o)).toBe(2);
    await expect(o.getByTestId('test-label-sheet').getByTestId('label-barcode')).toBeAttached();
    await o.screenshot({ path: `${SHOTS}/en-print-settings.png`, fullPage: true });
    await o.context().close();

    const m = await session(browser, manager, shop, main);
    await m.goto('/pharmacy/print/settings');
    await expect(m.getByTestId('print-settings-readonly')).toBeVisible();
    await expect(m.getByTestId('ws-save')).toHaveCount(0);
    await expect(m.getByTestId('test-a4')).toBeVisible();
    await m.context().close();
  });

  test('read-only (lapsed) pharmacy: asking and tables and printing stay, suggestions and copies and settings are blocked in words', async ({ browser }) => {
    test.setTimeout(300_000);
    // Leave one open suggestion to look at.
    const seed = db();
    let was: Date | null = null;
    try {
      const proposal = await seed.phAiProposal.findFirstOrThrow({ where: { restaurantId: shop.id, kind: 'SUPPLIER_RETURN' }, select: { id: true, payload: true, branchId: true, createdById: true } });
      await seed.phAiProposal.create({ data: { restaurantId: shop.id, branchId: proposal.branchId, kind: 'SUPPLIER_RETURN', payload: proposal.payload as never, createdById: proposal.createdById } });
      was = (await seed.subscription.findFirstOrThrow({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, select: { currentPeriodEnd: true } })).currentPeriodEnd;
      await seed.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
    } finally {
      await seed.$disconnect();
    }
    try {
      const m = await session(browser, manager, shop, main);
      await m.goto('/pharmacy/assistant');
      await expect(m.getByTestId('assistant-write-blocked')).toBeVisible();
      await m.getByTestId('starter-batches_expiring').click();
      await expect(m.getByTestId('result-batches_expiring').getByTestId('table-row')).toHaveCount(1);
      await expect(m.getByTestId('row-propose')).toHaveCount(0);
      await m.goto('/pharmacy/assistant/proposals');
      await expect(m.getByTestId('proposal-row').first()).toBeVisible();
      const open = m.getByTestId('proposal-row').filter({ hasText: /Waiting/ }).first();
      await open.getByRole('link').first().click();
      await expect(m.getByTestId('proposal-write-blocked')).toBeVisible();
      await expect(m.getByTestId('proposal-accept')).toHaveCount(0);
      await expect(m.getByTestId('proposal-dismiss')).toHaveCount(0);
      await m.goto(`/pharmacy/sales/${ids.sale}/invoice`);
      await expect(m.getByTestId('a4-sheet')).toBeVisible();
      await m.getByTestId('a4-print').click();
      expect(await prints(m)).toBe(1);
      await expect(m.getByTestId('a4-reprint-blocked')).toBeVisible();
      await expect(m.getByTestId('a4-reprint')).toHaveCount(0);
      await m.goto('/pharmacy/print/labels');
      await expect(m.getByTestId('labels-page')).toBeVisible();
      await m.context().close();
      const o = await session(browser, owner, shop, null);
      await o.goto('/pharmacy/print/settings');
      await expect(o.getByTestId('print-settings-blocked')).toBeVisible();
      await expect(o.getByTestId('ws-save')).toHaveCount(0);
      await o.context().close();
    } finally {
      const back = db();
      try {
        if (was) await back.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: was } });
      } finally {
        await back.$disconnect();
      }
    }
  });

  // -----------------------------------------------------------------------------------------------------------------------------
  // Languages, widths, axe
  // -----------------------------------------------------------------------------------------------------------------------------

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
    for (const u of [owner, manager, accountant, cashier]) await setUserLocale(u.userId, locale);
    script({ text: 'Some batches are close to their expiry dates.' });
    const dir = locale === 'en' ? 'ltr' : 'rtl';
    const small = { width: 375, height: 800 };

    const o = await session(browser, owner, shop, main, small);
    await expect(o.locator('html')).toHaveAttribute('dir', dir);
    await o.goto('/pharmacy/assistant');
    await expect(o.getByTestId('assistant')).toBeVisible();
    await check(o, `${locale}-assistant`);
    await ask(o, 'Which batches are expiring soon?');
    await expect(o.getByTestId('assistant-prose')).toBeVisible();
    await check(o, `${locale}-assistant-answer`);
    await o.getByTestId('starter-stock_below_reorder').click();
    await expect(o.getByTestId('result-stock_below_reorder')).toBeVisible();
    await check(o, `${locale}-assistant-tables`);
    await ask(o, 'What is the dose of amoxicillin for a child?');
    await expect(o.getByTestId('assistant-refusal')).toBeVisible();
    await check(o, `${locale}-assistant-refusal`, [375, 1280]);
    script({ text: 'There are 999 batches close to expiry.' });
    await ask(o, 'Which batches are expiring soon?');
    await expect(o.getByTestId('assistant-notice')).toBeVisible();
    await check(o, `${locale}-assistant-ungrounded`, [375, 1280]);
    script({ text: 'Some batches are close to their expiry dates.' });
    await o.goto('/pharmacy/assistant/proposals');
    await expect(o.getByTestId('proposal-row').first()).toBeVisible();
    await check(o, `${locale}-proposals`);
    const open = o.getByTestId('proposal-row').filter({ hasText: /^(?!.*(Accepted|Dismissed)).*$/s }).first();
    if (await open.count()) {
      await open.getByRole('link').first().click();
      await expect(o.getByTestId('proposal-review')).toBeVisible();
      await check(o, `${locale}-proposal-review`);
    }
    await o.goto(`/pharmacy/sales/${ids.sale}/invoice`);
    await expect(o.getByTestId('a4-sheet')).toBeVisible();
    await check(o, `${locale}-a4-invoice`);
    await o.goto(`/pharmacy/returns/${ids.ret}/slip`);
    await expect(o.getByTestId('a4-sheet')).toBeVisible();
    await check(o, `${locale}-a4-slip`);
    await o.goto('/pharmacy/print/labels');
    await expect(o.getByTestId('labels-empty')).toBeVisible();
    await check(o, `${locale}-labels-empty`);
    const box = o.getByTestId('receipt-picker').locator('input[type="search"]');
    await box.fill(names.name);
    await box.press('Enter');
    await o.getByTestId('labels-add-shelf').click();
    await o.getByTestId('labels-add-batch').first().click();
    await expect(o.getByTestId('labels-queue-item')).toHaveCount(2);
    await check(o, `${locale}-labels`);
    await o.goto('/pharmacy/print/settings');
    await expect(o.getByTestId('print-settings')).toBeVisible();
    await check(o, `${locale}-print-settings`);
    await o.getByTestId('ws-margin-top').fill('99');
    await check(o, `${locale}-print-settings-bad-margin`, [375, 1280]);
    await o.context().close();

    const c = await session(browser, cashier, shop, main, small);
    await c.goto('/pharmacy/assistant');
    await ask(c, 'Which batches are expiring soon?');
    await expect(c.getByTestId('assistant-problem')).toBeVisible();
    await check(c, `${locale}-assistant-cashier`, [375, 1280]);
    await c.context().close();

    const a = await session(browser, accountant, shop, main, small);
    await a.goto('/pharmacy/assistant');
    await ask(a, 'Which products are below the reorder level?');
    await expect(a.getByTestId('assistant-notice')).toBeVisible();
    await check(a, `${locale}-assistant-no-ai`, [375, 1280]);
    await a.context().close();

    // A lapsed subscription: the read-only notices.
    const client = db();
    let was: Date | null = null;
    try {
      was = (await client.subscription.findFirstOrThrow({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, select: { currentPeriodEnd: true } })).currentPeriodEnd;
      await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: new Date(Date.now() - 20 * DAY) } });
      const m = await session(browser, manager, shop, main, small);
      for (const [name, path] of [['ro-assistant', '/pharmacy/assistant'], ['ro-a4-invoice', `/pharmacy/sales/${ids.sale}/invoice`], ['ro-print-settings', '/pharmacy/print/settings']] as const) {
        await m.goto(path);
        await expect(m.locator('main')).toBeVisible();
        await check(m, `${locale}-${name}`, [375, 1280]);
      }
      await m.context().close();
    } finally {
      if (was) await client.subscription.updateMany({ where: { restaurantId: shop.id, applicationId: 'pharmacy' }, data: { currentPeriodEnd: was } });
      await client.$disconnect();
    }
  }

  test('English: no sideways scroll and axe clean on every new screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'en');
  });
  test('Arabic: no sideways scroll and axe clean on every new screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'ar');
  });
  test('Sorani: no sideways scroll and axe clean on every new screen and state', async ({ browser }) => {
    test.setTimeout(900_000);
    await auditLocale(browser, 'ckb');
    await setUserLocale(owner.userId, 'en');
  });
});
