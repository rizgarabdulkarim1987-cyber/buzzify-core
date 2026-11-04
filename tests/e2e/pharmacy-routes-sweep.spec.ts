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

async function staff(userId: string, shop: Shop, role: 'BRANCH_MANAGER' | 'CASHIER'): Promise<void> {
  const client = db();
  try {
    const row = await client.phStaff.create({ data: { userId, restaurantId: shop.id, role }, select: { id: true } });
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

/** The owner's places: every key of `phNav` (no AI Doctor until it is switched on). */
const NAV = (() => {
  const nav = phNav('OWNER', { branchCount: 2, doctorEnabled: false });
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
  let shop: Shop;
  const owners: Partial<Record<'en' | 'ar', StudioUser>> = {};
  const pages: Partial<Record<'en' | 'ar', Page>> = {};
  /** Route label -> path, filled once the data exists. */
  const details: Record<string, string> = {};

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const client = db();
    try {
      applicationWas = (await client.application.findUnique({ where: { id: 'pharmacy' }, select: { status: true } }))?.status ?? null;
      await client.application.update({ where: { id: 'pharmacy' }, data: { status: 'ACTIVE' } });
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
    const [en, ar, mgr, cashier] = await Promise.all([make('owner'), make('owner-ar', 'ar'), make('mgr'), make('cashier')]);
    owners.en = en!;
    owners.ar = ar!;
    await assignMember(en!.userId, shop.id, 'OWNER');
    await assignMember(ar!.userId, shop.id, 'OWNER');
    await staff(mgr!.userId, shop, 'BRANCH_MANAGER');
    await staff(cashier!.userId, shop, 'CASHIER');

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
      });
    } finally {
      await c2.$disconnect();
    }
  });

  test.afterAll(async () => {
    for (const page of Object.values(pages)) await page?.context().close();
    if (applicationWas) {
      const client = db();
      try {
        await client.application.update({ where: { id: 'pharmacy' }, data: { status: applicationWas } });
      } finally {
        await client.$disconnect();
      }
    }
    await removeStudioUsers(people.splice(0));
    await removeRestaurants(restaurants.splice(0));
  });

  /** Every route in the sweep: the nav places first, then the detail pages (their paths are known once the data exists). */
  const ROUTES: Array<{ label: string; path: () => string }> = [
    ...NAV.map((item) => ({ label: item.key, path: () => item.href })),
    ...['sale', 'return', 'shift', 'prescription', 'customer', 'supplier', 'intake', 'transfer', 'count', 'product', 'report', 'print settings', 'proposals'].map((label) => ({
      label,
      path: () => details[label]!,
    })),
  ];

  for (const locale of ['en', 'ar'] as const) {
    for (const route of ROUTES) {
      test(`${locale} ${route.label}: one main, fixed frame, place marked, no serious axe violations`, async ({ browser }) => {
        test.setTimeout(180_000);
        pages[locale] ??= await enter(browser, owners[locale]!, shop);
        const page = pages[locale]!;
        const target = route.path();
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
      });
    }
  }
});
