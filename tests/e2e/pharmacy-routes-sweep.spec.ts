import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { phActiveKey, phNav, type PhNavKey } from '@/app/pharmacy/_ui/nav';
import { createPrisma } from '@/server/data/prisma';
import { DEV_DB, databaseUrl } from '../../scripts/db-config';
import { seriousViolations } from './helpers/axe';
import { assignMember, createStudioUser, hideDevTools, removeRestaurants, removeStudioUsers, uniqueClientAddress, type StudioUser } from './helpers/studio';

/**
 * Every pharmacy place an owner can open, and one of each detail page, inside the fixed frame (Task 13 of the shell
 * redesign). At 1280px and 375px, in English and Arabic, each page:
 *   - answers 200 and has exactly one `<main id="main">`;
 *   - never scrolls the document, sideways or down (`<main>` is the one scroll container);
 *   - shows the rail (desktop) or the bottom bar (phone), and marks the place the route belongs to;
 *   - has no serious or critical axe violations.
 * The data is built through the real services (helpers/reports-world-cli.ts: sales, a return, transfers, shifts) plus a few
 * rows written straight to the development database (a customer, a supplier, a prescription, an invoice-photo batch, a count).
 *
 * The routes are separate tests that share one signed-in page per language: they run in order in one worker, and a failure
 * only costs a fresh worker (the data and the sign-in are made again), never the routes after it.
 *
 * The AI Doctor (plan Task 10 of the AI Doctor): the plan carries an AI budget for the run, so the owner's sweep includes
 * `/pharmacy/doctor` and the two owner screens (`/pharmacy/settings/staff`, `/pharmacy/settings/doctor-review`). A pharmacist
 * with the Doctor switched on gets the same checks on `/pharmacy/doctor` and a 404 on the owner screens; a pharmacist with it
 * off and a cashier get a 404 on all three.
 *
 * Run: `npx playwright test --project=desktop --no-deps --workers=1 tests/e2e/pharmacy-routes-sweep.spec.ts`.
 */

const DAY = 86_400_000;
const db = () => createPrisma(databaseUrl(DEV_DB));
const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 375, height: 800 },
] as const;
/** The places the phone's bottom bar holds itself (Shell.tsx); the rest sit behind its "More" button. */
const BAR = new Set<PhNavKey>(['home', 'sell', 'stock', 'expiry']);

interface Shop {
  id: string;
  name: string;
  branches: { id: string; name: string }[];
}

async function makeShop(): Promise<Shop> {
  const client = db();
  try {
    const name = `E2E Sweep ${randomUUID().slice(0, 6)}`;
    const row = await client.restaurant.create({ data: { name, sector: 'PHARMACY' }, select: { id: true } });
    const branches: Shop['branches'] = [];
    for (const [i, b] of ['Alpha', 'Bravo'].entries()) {
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

async function staff(userId: string, shop: Shop, role: 'BRANCH_MANAGER' | 'CASHIER' | 'PHARMACIST', aiDoctor = false): Promise<void> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId, restaurantId: shop.id, role, aiDoctor }, select: { id: true } });
    await client.phStaffBranch.create({ data: { restaurantId: shop.id, staffId: row.id, branchId: shop.branches[0]!.id } });
  } finally {
    await client.$disconnect();
  }
}

/** Signs in through `/pharmacy` (any language) and chooses branch A. */
async function enter(browser: Browser, user: StudioUser, shop: Shop): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': uniqueClientAddress() }, viewport: WIDTHS[0] });
  await hideDevTools(context);
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.dismiss());
  await page.goto('/pharmacy');
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/pharmacy\/select$/);
  await page.getByRole('group', { name: shop.name }).getByRole('button', { name: shop.branches[0]!.name }).click();
  await expect(page).toHaveURL(/\/pharmacy\/home$/);
  return page;
}

/** The owner's places: every key of `phNav`, the AI Doctor included (the plan carries an AI budget during the sweep). */
const NAV = (() => {
  const nav = phNav('OWNER', { branchCount: 2, doctorEnabled: true });
  return [...nav.primary, ...nav.more];
})();
const hrefOf = (key: PhNavKey) => NAV.find((item) => item.key === key)?.href ?? null;

/** What the frame looks like at the current viewport. */
async function frame(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    // The frame's navs only: a page's own tabs (a <nav> inside <main>) are not the frame.
    const navs = [...document.querySelectorAll('nav')].filter((nav) => !nav.closest('main') && visible(nav));
    const current = navs.flatMap((nav) => [...nav.querySelectorAll('[aria-current="page"]')].filter(visible));
    return {
      mains: document.querySelectorAll('main').length,
      mainIds: [...document.querySelectorAll('main')].map((m) => m.id),
      sideways: root.scrollWidth > root.clientWidth,
      // <main> scrolls down, so anything too wide for it would scroll it sideways instead of the document.
      mainSideways: [...document.querySelectorAll('main')].some((m) => m.scrollWidth > m.clientWidth),
      down: root.scrollHeight > root.clientHeight,
      navs: navs.map((nav) => (nav.closest('header') ? 'rail' : 'bar')),
      current: current.map((el) => ({ tag: el.tagName.toLowerCase(), href: el.getAttribute('href') })),
    };
  });
}

test.describe('Pharmacy routes sweep @desktop', () => {
  const restaurants: string[] = [];
  const people: string[] = [];
  let applicationWas: 'ACTIVE' | 'DISABLED' | null = null;
  let planWas: { limits: unknown } | null = null;
  let planMade = false;
  let shop: Shop;
  const owners: Partial<Record<'en' | 'ar', StudioUser>> = {};
  /** A pharmacist with the AI Doctor switched on, one with it off, and a cashier. */
  const others: Partial<Record<'doctorOn' | 'doctorOff' | 'cashier', StudioUser>> = {};
  const pages: Partial<Record<'en' | 'ar', Page>> = {};
  /** Route label -> path, filled once the data exists. */
  const details: Record<string, string> = {};

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
      // The AI Doctor needs an AI budget on the plan: the standard plan gets one for the sweep and is put back afterwards.
      const where = { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } };
      planWas = await client.appPlan.findUnique({ where, select: { limits: true } });
      if (planWas) {
        const was = (planWas.limits && typeof planWas.limits === 'object' ? planWas.limits : {}) as Record<string, unknown>;
        await client.appPlan.update({ where, data: { limits: { ...was, aiMonthlyBudgetMinor: 1000 } as never } });
      } else {
        await client.appPlan.create({ data: { applicationId: 'pharmacy', code: 'standard', name: { en: 'Standard' }, limits: { branches: 5, users: 20, storageMb: 50, aiMonthlyBudgetMinor: 1000 } } });
        planMade = true;
      }
    } finally {
      await client.$disconnect();
    }
    shop = await makeShop();
    restaurants.push(shop.id);
    const make = async (label: string, locale: 'en' | 'ar' = 'en') => {
      const user = await createStudioUser({ label: `ph-sweep-${label}`, name: `Sweep ${label}`, locale });
      people.push(user.email);
      return user;
    };
    const [en, ar, mgr, cashier, doctorOn, doctorOff] = await Promise.all([make('owner'), make('owner-ar', 'ar'), make('mgr'), make('cashier'), make('dr-on'), make('dr-off')]);
    owners.en = en!;
    owners.ar = ar!;
    Object.assign(others, { doctorOn, doctorOff, cashier });
    await assignMember(en!.userId, shop.id, 'OWNER');
    await assignMember(ar!.userId, shop.id, 'OWNER');
    await staff(mgr!.userId, shop, 'BRANCH_MANAGER');
    await staff(cashier!.userId, shop, 'CASHIER');
    await staff(doctorOn!.userId, shop, 'PHARMACIST', true);
    await staff(doctorOff!.userId, shop, 'PHARMACIST', false);

    const root = process.cwd();
    const output = execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        path.join(root, 'tests', 'e2e', 'helpers', 'reports-world-cli.ts'),
        JSON.stringify({ restaurantId: shop.id, branchA: shop.branches[0]!.id, branchB: shop.branches[1]!.id, owner: en!.userId, mgrA: mgr!.userId, cashierA: cashier!.userId, suffix: randomUUID().slice(0, 5) }),
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const line = output.split(/\r?\n/).find((l) => l.startsWith('WORLD '));
    if (!line) throw new Error(`the world script gave no answer:\n${output}`);
    const world = JSON.parse(line.slice('WORLD '.length)) as { productP: string; t1: string };

    const A = shop.branches[0]!.id;
    const c2 = db();
    try {
      const restaurantId = shop.id;
      const sale = await c2.phSale.findFirstOrThrow({ where: { restaurantId, branchId: A }, select: { id: true } });
      const ret = await c2.phReturn.findFirstOrThrow({ where: { restaurantId }, select: { id: true } });
      const shift = await c2.phShift.findFirstOrThrow({ where: { restaurantId, branchId: A }, select: { id: true } });
      const customer = await c2.phCustomer.create({ data: { restaurantId, name: 'Sweep Customer', phone: '07700000000', currency: 'IQD' }, select: { id: true } });
      const supplier = await c2.phSupplier.create({
        data: { restaurantId, name: 'Sweep Supplier', nameKey: 'sweep supplier', defaultCurrency: 'IQD', clientKey: randomUUID(), createdById: en!.userId },
        select: { id: true },
      });
      const rx = await c2.phPrescription.create({
        data: { restaurantId, branchId: A, number: 'RX-SWEEP-1', prescriberName: 'Dr Sweep', patientName: 'Patient Sweep', issuedOn: new Date(new Date().toISOString().slice(0, 10)), clientKey: randomUUID(), payloadHash: 'sweep', createdById: en!.userId },
        select: { id: true },
      });
      const intake = await c2.phIntakeBatch.create({
        data: { restaurantId, branchId: A, supplierId: supplier.id, clientKey: randomUUID(), payloadHash: 'sweep', createdById: en!.userId },
        select: { id: true },
      });
      const count = await c2.phStockCount.create({ data: { restaurantId, branchId: A, countedById: en!.userId }, select: { id: true } });
      Object.assign(details, {
        sale: `/pharmacy/sales/${sale.id}`,
        return: `/pharmacy/returns/${ret.id}`,
        shift: `/pharmacy/shifts/${shift.id}`,
        prescription: `/pharmacy/prescriptions/${rx.id}`,
        customer: `/pharmacy/customers/${customer.id}`,
        supplier: `/pharmacy/purchasing/suppliers/${supplier.id}`,
        intake: `/pharmacy/purchasing/intake/${intake.id}`,
        transfer: `/pharmacy/stock/transfers/${world.t1}`,
        count: `/pharmacy/stock/counts/${count.id}`,
        product: `/pharmacy/catalog/${world.productP}`,
        report: '/pharmacy/reports/sales',
        'print settings': '/pharmacy/print/settings',
        proposals: '/pharmacy/assistant/proposals',
        'doctor staff': '/pharmacy/settings/staff',
        'doctor review': '/pharmacy/settings/doctor-review',
      });
    } finally {
      await c2.$disconnect();
    }
  });

  test.afterAll(async () => {
    for (const page of Object.values(pages)) await page?.context().close();
    const client = db();
    try {
      if (applicationWas) await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      const where = { applicationId_code: { applicationId: 'pharmacy', code: 'standard' } };
      if (planMade) await client.appPlan.delete({ where });
      else if (planWas) await client.appPlan.update({ where, data: { limits: planWas.limits as never } });
    } finally {
      await client.$disconnect();
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  /** Every route in the sweep: the nav places first, then the detail pages (their paths are known once the data exists). */
  const ROUTES: Array<{ label: string; path: () => string }> = [
    ...NAV.map((item) => ({ label: item.key, path: () => item.href })),
    ...['sale', 'return', 'shift', 'prescription', 'customer', 'supplier', 'intake', 'transfer', 'count', 'product', 'report', 'print settings', 'proposals', 'doctor staff', 'doctor review'].map(
      (label) => ({
        label,
        path: () => details[label]!,
      }),
    ),
  ];

  /** The checks of one route on a signed-in page: 200, one main, the fixed frame at both widths, the place marked, axe. */
  async function sweepRoute(page: Page, target: string, locale: 'en' | 'ar'): Promise<void> {
    await page.setViewportSize(WIDTHS[0]);
    const response = await page.goto(target);
    expect(response?.status(), `${target} answers`).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('main#main')).toHaveCount(1);
    // The scroll container is in the tab order: a page with nothing focusable can still be scrolled by keyboard.
    await expect(page.locator('main#main')).toHaveAttribute('tabindex', '0');
    // The page drew its own heading inside the frame (not an error or blank page).
    await expect(page.locator('main#main h1').first()).toBeVisible();
    const key = phActiveKey(new URL(page.url()).pathname);
    const href = key ? hrefOf(key) : null;

    for (const viewport of WIDTHS) {
      await page.setViewportSize(viewport);
      const where = `${target} at ${viewport.width}px`;
      // A frame after the resize so the layout has settled.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const seen = await frame(page);
      expect.soft(seen.mains, `${where}: one <main>`).toBe(1);
      expect.soft(seen.mainIds, `${where}: main is #main`).toEqual(['main']);
      expect.soft(seen.sideways, `${where}: no sideways page scroll`).toBe(false);
      expect.soft(seen.mainSideways, `${where}: <main> does not scroll sideways`).toBe(false);
      expect.soft(seen.down, `${where}: the document itself does not scroll`).toBe(false);
      expect.soft(seen.navs, `${where}: the ${viewport.width === 1280 ? 'rail' : 'bottom bar'} is the one visible nav`).toEqual([viewport.width === 1280 ? 'rail' : 'bar']);
      if (!key) {
        expect.soft(seen.current, `${where}: no place marked`).toEqual([]);
      } else if (viewport.width === 1280 || BAR.has(key)) {
        expect.soft(seen.current, `${where}: ${key} marked`).toEqual([{ tag: 'a', href }]);
      } else {
        // On a phone a place under "More" marks the More button.
        expect.soft(seen.current, `${where}: More marked for ${key}`).toEqual([{ tag: 'button', href: null }]);
      }
      expect.soft(await seriousViolations(page), `${where}: axe`).toEqual([]);
    }
  }

  for (const locale of ['en', 'ar'] as const) {
    for (const route of ROUTES) {
      test(`${locale} ${route.label}: one main, fixed frame, place marked, no serious axe violations`, async ({ browser }) => {
        test.setTimeout(180_000);
        pages[locale] ??= await enter(browser, owners[locale]!, shop);
        await sweepRoute(pages[locale]!, route.path(), locale);
      });
    }
  }

  const DOCTOR_PATHS = ['/pharmacy/doctor', '/pharmacy/settings/staff', '/pharmacy/settings/doctor-review'] as const;

  test('a pharmacist with the AI Doctor on: the Doctor page passes the sweep, the owner screens are a 404', async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await enter(browser, others.doctorOn!, shop);
    try {
      await expect(page.locator('a[href="/pharmacy/doctor"]').first()).toBeVisible();
      await sweepRoute(page, '/pharmacy/doctor', 'en');
      for (const target of DOCTOR_PATHS.slice(1)) expect((await page.goto(target))?.status(), `${target} for the pharmacist`).toBe(404);
    } finally {
      await page.context().close();
    }
  });

  for (const who of ['doctorOff', 'cashier'] as const) {
    test(`${who === 'doctorOff' ? 'a pharmacist with the AI Doctor off' : 'a cashier'}: no Doctor link, a 404 on the Doctor page and the owner screens`, async ({ browser }) => {
      test.setTimeout(240_000);
      const page = await enter(browser, others[who]!, shop);
      try {
        await expect(page.locator('a[href="/pharmacy/doctor"]')).toHaveCount(0);
        for (const target of DOCTOR_PATHS) expect((await page.goto(target))?.status(), `${target} for ${who}`).toBe(404);
      } finally {
        await page.context().close();
      }
    });
  }
});
