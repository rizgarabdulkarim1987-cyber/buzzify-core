# Foundation, Customer Menu and Revenue Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working slice of the multi-tenant restaurant platform: a fast, server-priced, three-language ATELIER customer menu driven by a rule-based revenue engine (upsell, Perfect Pairing, bundles, margin- and daypart-aware promotion), backed by tenant-isolated PostgreSQL.

**Architecture:** A Next.js (App Router) monolith. All pricing and recommendation logic is a framework-free TypeScript domain layer (`src/server/domain`) that takes plain data and an injected clock. A Prisma client extension forces `restaurantId` on every tenant-owned query. The browser holds the cart; the server re-prices it on every change.

**Tech Stack:** Next.js 16.4.1, React 19.3.1, TypeScript 5.9.3, Tailwind CSS 4.3.3, Motion 14.3.0, Prisma 7.10.0 with `@prisma/adapter-pg`, PostgreSQL 18 via `embedded-postgres`, Zod 4.6.7, Zustand 5.0.15, Vitest 5.0.5, Playwright 1.64.1 with axe, Lighthouse 13.5.0.

**Spec:** `docs/superpowers/specs/2026-10-15-foundation-menu-revenue-engine-design.md` (executors read both documents).

## Spec refinements made while planning

These five points refine the approved spec. The spec file was amended in the same commit as this plan, so spec and plan agree.

1. **`Product.slot` (nullable string).** The spec's "slot already filled" filter said "the target's category". Burger and fries share the Plates category, so a category-based rule would wrongly suppress fries. The slot is now an explicit product field (`DRINK`, `SIDE`, `DESSERT`, `STARTER`, `BAKERY`, `MAIN`). A suggestion is skipped when the cart already holds a product with the same non-null slot.
2. **In-house translator replaces next-intl.** The `[locale]` path segment already owns routing, and the UI string set is small. `src/lib/i18n.ts` provides `{param}` interpolation and `_one`/`_two`/`_few`/`_many`/`_other` plural keys over `Intl.PluralRules`. Product, category and option text still uses the `translations` JSONB fields.
3. **Daypart restriction semantics.** A product with `dayparts` set is only *unorderable* outside them when `hideOutsideDaypart` is true. Otherwise it stays orderable but is not promoted or recommended outside its dayparts.
4. **Cache granularity.** The tenant `Catalog` is cached per restaurant (`unstable_cache`, 300 s, tag `catalog:{restaurantId}`). The menu view, daypart and signature item are computed per request from the cached catalog, because they depend on the clock.
5. **Cart persistence.** The cart is stored per device and restaurant (`buzzify:cart:{slug}`), not per table. Scanning a different table's QR code clears it, which gives the same guarantee (an order never silently follows a customer to another table) without re-keying the store.

## Global Constraints

Every task's requirements implicitly include this section.

- Dev server port **3100**. Embedded Postgres port **54329**, data in `.data/pg`, git-ignored.
- Work stays on the currently checked-out branch (`main`). Do not create branches. Do not push; the GitHub repository is public.
- Every commit message ends with the trailer line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Money is an integer in minor units with the currency set per restaurant. The client sends IDs and quantities only, never prices.
- Every tenant-owned table carries `restaurantId` and is accessed through `scopedDb()`. Raw SQL (`$queryRaw`, `$executeRaw` and their `Unsafe` forms) is banned by lint.
- Locales: `en`, `ar`, `ckb`. `ar` and `ckb` render `dir="rtl"`. Styles use logical properties only (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`).
- ATELIER palette: Basalt `#0E0E0F`, Charcoal `#1B1A19`, Smoke `#2A2826`, Champagne `#D6BC8A`, Bone `#EDE8DF`, Mist `#A7A096`. Fonts: Bodoni Moda (display), Hanken Grotesk (text), Noto Naskh Arabic (Arabic and Sorani), loaded with `next/font`.
- No tracked all-caps eyebrow labels, no `01/02/03` numbering, no arrows on links, no identical rounded-card grids, no decorative glow.
- Motion: transform and opacity only, interruptible springs, one page-load moment, `prefers-reduced-motion` falls back to opacity.
- There is no Submit or place-order control anywhere in this sub-project. No decorative buttons: every control does something real.
- Targets: 44 px minimum touch targets, visible focus, LCP under 2.5 s on throttled mobile reported as measured, initial JS for the menu route around 120 KB gzipped.
- Seeded Arabic and Sorani text is machine-drafted and must be marked for native review in the README.

## Review Focus

The five input classes the spec implies but its feature tests would not otherwise exercise, most likely first. Each has a pinned test in the owning task.

1. **Stale cart lines.** A product disabled, sold out or deleted after the customer added it. Expected: the quote flags the line (`UNAVAILABLE`, `OUT_OF_STOCK`, `UNKNOWN_PRODUCT`), excludes it from the subtotal, and the cart offers a one-tap remove. Pinned in Task 5 (domain) and Task 16 (end to end).
2. **Hostile URLs.** Unknown tenant, locale `xx`, table `abc`, `0` or `999`. Expected: a clean 4xx or redirect, never a 5xx. Pinned in Task 11 (API) and Task 17 (routes).
3. **Odd search input.** Empty string, only spaces, regex metacharacters such as `(` or `[`, Arabic-Indic digits, mixed scripts. Expected: no exception, empty query shows everything. Pinned in Task 4 (unit) and Task 14 (end to end).
4. **Long text and missing translations at 320 px.** A name in a locale with no translation falls back; long names wrap and never cause horizontal scroll. Pinned in Task 4 (fallback), Task 14 (menu, English and Arabic) and Task 16 (cart).
5. **Zero or negative price deltas.** A discount option or a mis-entered negative delta. Expected: unit price is clamped at zero and totals are never negative. Pinned in Task 5 (server quote) and Task 12 (the display mirror).

## File Structure

```
package.json  tsconfig.json  next.config.ts  postcss.config.mjs  eslint.config.mjs
vitest.config.ts  playwright.config.ts  prisma.config.ts  .env.example  .gitignore  README.md
scripts/
  db-config.ts          ports, credentials, URLs (shared by scripts and tests)
  db.ts                 embedded Postgres runner: start | up | down | status
prisma/
  schema.prisma  migrations/  seed.ts
  seed/atelier.ts       typed ATELIER dataset (pure data)
  seed/validate.ts      seed integrity checks (pure)
src/
  generated/prisma/     generated client (git-ignored)
  lib/                  framework-free shared code
    locale.ts  search.ts  i18n.ts  media.ts  brand.ts  cart.ts  cart-storage.ts  menu-price.ts
    messages/{en,ar,ckb,index}.ts
  server/
    domain/             pure revenue engine (no Next, no Prisma)
      types.ts  config.ts  money.ts  translate.ts  schedule.ts  catalog.ts
      pricing.ts  bundles.ts  upsell.ts  pairing.ts  promotion.ts  suggestions.ts  index.ts
    data/
      prisma.ts  tenant-db.ts  cache.ts  catalog-loader.ts  tenant.ts
      menu-view.ts  quote-view.ts  suggestion-view.ts  events.ts
    http/
      rate-limit.ts  route.ts  schemas.ts
    route-context.ts    resolveRoute and loadMenuView shared by the pages
  app/
    globals.css  fonts.ts
    [tenant]/[locale]/{layout.tsx,page.tsx,not-found.tsx,cart/page.tsx,p/[slug]/page.tsx,t/[table]/page.tsx}
    api/[tenant]/{quote,suggestions,events}/route.ts
  ui/
    AppProviders.tsx  brand.ts  Icons.tsx  LanguageSwitch.tsx  Sheet.tsx  useSuggestions.ts
    analytics/track.ts
    art/{ProductArt,ProductVisual}.tsx
    cart/{cart-store.ts,CartBar.tsx,CartView.tsx,BundleSuggestion.tsx}
    menu/{MenuApp,Header,SignatureFeature,CategoryRail,ProductRow}.tsx
    product/{ProductDetail,ProductSheet,ProductPage,OptionGroup,UpgradeOffers,PairingList}.tsx
tests/
  helpers/{global-setup.ts,db.ts}
  lib/  domain/  data/  api/  seed/  ui/  e2e/
```

---

### Task 1: Project scaffold and tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/app/globals.css`, `src/app/[tenant]/[locale]/layout.tsx`, `src/app/[tenant]/[locale]/page.tsx`
- Create: `src/lib/locale.ts`, `tests/lib/locale.test.ts`

**Interfaces:**
- Produces: `LOCALES`, `Locale`, `isLocale(value: string): value is Locale`, `direction(locale: Locale): 'ltr' | 'rtl'`, `LOCALE_NAMES: Record<Locale, string>` from `src/lib/locale.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "buzzify-menu",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.19" },
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build",
    "start": "next start -p 3100",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "perf": "tsx scripts/perf.ts",
    "db:up": "tsx scripts/db.ts up",
    "db:down": "tsx scripts/db.ts down",
    "db:start": "tsx scripts/db.ts start",
    "db:status": "tsx scripts/db.ts status",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "prisma db seed"
  },
  "dependencies": {
    "@prisma/adapter-pg": "7.10.0",
    "@prisma/client": "7.10.0",
    "dotenv": "18.0.8",
    "motion": "14.3.0",
    "next": "16.4.1",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zod": "4.6.7",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.14.0",
    "@playwright/test": "1.64.1",
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "24.19.2",
    "@types/pg": "8.23.1",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "embedded-postgres": "18.4.0-beta.17",
    "eslint": "9.39.5",
    "eslint-config-next": "16.4.1",
    "lighthouse": "13.5.0",
    "pg": "8.23.1",
    "postcss": "8.5.30",
    "prisma": "7.10.0",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.15",
    "typescript": "5.9.3",
    "vite": "8.3.4",
    "vite-tsconfig-paths": "6.1.1",
    "vitest": "5.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`**

`next.config.ts`:

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [{ source: '/', destination: '/atelier/en', permanent: false }];
  },
};

export default config;
```

`postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

`eslint.config.mjs`:

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const rawSql = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'].map((property) => ({
  property,
  message: 'Raw SQL bypasses tenant scoping. Use the scoped Prisma client.',
}));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { rules: { 'no-restricted-properties': ['error', ...rawSql] } },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/generated/**', '.data/**']),
]);
```

- [ ] **Step 4: Create `vitest.config.ts`, `.gitignore`, `.env.example`**

`vitest.config.ts`:

```ts
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
```

`.gitignore`:

```
node_modules/
.next/
.data/
.env
.env.local
src/generated/
playwright-report/
test-results/
coverage/
*.tsbuildinfo
next-env.d.ts
```

`.env.example`:

```
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54329/buzzify"
```

- [ ] **Step 5: Create the minimal app shell**

`src/app/globals.css`:

```css
@import 'tailwindcss';
```

`src/app/[tenant]/[locale]/layout.tsx`:

```tsx
import '@/app/globals.css';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { direction, isLocale } from '@/lib/locale';

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={direction(locale)}>
      <body>{children}</body>
    </html>
  );
}
```

`src/app/[tenant]/[locale]/page.tsx`:

```tsx
export default async function Page({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  return (
    <main>
      <h1>{tenant}</h1>
    </main>
  );
}
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes with `package-lock.json` created and no `ERESOLVE` error. If npm reports an unmet peer, add exactly the package and version npm names, rerun, and note it in the commit message.

- [ ] **Step 7: Write the failing locale test**

`tests/lib/locale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { direction, isLocale, LOCALES, LOCALE_NAMES } from '@/lib/locale';

describe('locale', () => {
  it('lists the three supported locales', () => {
    expect([...LOCALES]).toEqual(['en', 'ar', 'ckb']);
  });

  it('accepts only supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ckb')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });

  it('is right-to-left for Arabic and Sorani only', () => {
    expect(direction('en')).toBe('ltr');
    expect(direction('ar')).toBe('rtl');
    expect(direction('ckb')).toBe('rtl');
  });

  it('has a display name for every locale', () => {
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 8: Run it to confirm it fails**

Run: `npx vitest run tests/lib/locale.test.ts`
Expected: FAIL with a module-not-found error for `@/lib/locale`. (Vitest's `globalSetup` file does not exist yet either; create it in the next step as a tolerant stub first if Vitest reports it missing.)

If Vitest reports `tests/helpers/global-setup.ts` is missing, create it now with this stub (Task 3 replaces it):

```ts
export default function setup() {}
```

- [ ] **Step 9: Implement `src/lib/locale.ts`**

```ts
export const LOCALES = ['en', 'ar', 'ckb'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
  ckb: 'کوردی',
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function direction(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'en' ? 'ltr' : 'rtl';
}
```

- [ ] **Step 10: Run the test, typecheck, lint, build**

Run: `npx vitest run tests/lib/locale.test.ts`
Expected: PASS, 4 tests.

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all three exit 0. The build lists the route `/[tenant]/[locale]`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts .gitignore .env.example src tests
git commit -m "chore: scaffold Next.js, Tailwind, Vitest and locale helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Embedded PostgreSQL runner

**Files:**
- Create: `scripts/db-config.ts`, `scripts/db.ts`
- Test: `tests/lib/db-config.test.ts`

**Interfaces:**
- Produces: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DEV_DB`, `TEST_DB`, `ROOT`, `DATA_DIR`, `databaseUrl(name: string): string` from `scripts/db-config.ts`. CLI: `tsx scripts/db.ts start | up | down | status`.

- [ ] **Step 1: Write the failing config test**

`tests/lib/db-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { databaseUrl, DEV_DB, TEST_DB, DB_PORT } from '../../scripts/db-config';

describe('db config', () => {
  it('builds connection URLs for the embedded server', () => {
    expect(databaseUrl(DEV_DB)).toBe('postgresql://postgres:postgres@127.0.0.1:54329/buzzify');
    expect(databaseUrl(TEST_DB)).toBe('postgresql://postgres:postgres@127.0.0.1:54329/buzzify_test');
  });

  it('avoids the default Postgres port', () => {
    expect(DB_PORT).not.toBe(5432);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/lib/db-config.test.ts`
Expected: FAIL, cannot find `scripts/db-config`.

- [ ] **Step 3: Implement `scripts/db-config.ts`**

```ts
import { resolve } from 'node:path';

export const ROOT = process.cwd();
export const DATA_DIR = resolve(ROOT, '.data/pg');
export const DB_HOST = '127.0.0.1';
export const DB_PORT = 54329;
export const DB_USER = 'postgres';
export const DB_PASSWORD = 'postgres';
export const DEV_DB = 'buzzify';
export const TEST_DB = 'buzzify_test';

export function databaseUrl(name: string): string {
  return `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${name}`;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/lib/db-config.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Implement `scripts/db.ts`**

```ts
import EmbeddedPostgres from 'embedded-postgres';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import { DATA_DIR, DB_HOST, DB_PASSWORD, DB_PORT, DB_USER, DEV_DB, ROOT, TEST_DB } from './db-config';

const stopFile = resolve(ROOT, '.data/pg.stop');
const logFile = resolve(ROOT, '.data/pg.log');
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function portOpen(): Promise<boolean> {
  return new Promise((done) => {
    const socket = net.connect({ host: DB_HOST, port: DB_PORT });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

async function waitFor(open: boolean, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i += 1) {
    if ((await portOpen()) === open) return true;
    await sleep(500);
  }
  return false;
}

async function ensureDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: 'postgres' });
  await admin.connect();
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
}

async function start(): Promise<void> {
  mkdirSync(resolve(ROOT, '.data'), { recursive: true });
  rmSync(stopFile, { force: true });
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: DB_USER,
    password: DB_PASSWORD,
    port: DB_PORT,
    persistent: true,
  });
  if (!existsSync(resolve(DATA_DIR, 'PG_VERSION'))) await server.initialise();
  await server.start();
  await ensureDatabase(DEV_DB);
  await ensureDatabase(TEST_DB);
  console.log(`PostgreSQL ready on ${DB_HOST}:${DB_PORT} (${DEV_DB}, ${TEST_DB})`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    rmSync(stopFile, { force: true });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {
    if (existsSync(stopFile)) void stop();
  }, 500);
}

async function up(): Promise<void> {
  if (await portOpen()) {
    console.log(`PostgreSQL already running on ${DB_HOST}:${DB_PORT}`);
    return;
  }
  mkdirSync(resolve(ROOT, '.data'), { recursive: true });
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/db.ts', 'start'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  child.unref();
  if (!(await waitFor(true, 90))) {
    console.error(`PostgreSQL did not come up within 90 s. See ${logFile}`);
    process.exit(1);
  }
  await sleep(1500);
  console.log(`PostgreSQL running on ${DB_HOST}:${DB_PORT}. Log: ${logFile}`);
}

async function down(): Promise<void> {
  if (!(await portOpen())) {
    console.log('PostgreSQL is not running');
    return;
  }
  writeFileSync(stopFile, 'stop');
  if (!(await waitFor(false, 30))) {
    console.error('PostgreSQL did not stop within 30 s');
    process.exit(1);
  }
  rmSync(stopFile, { force: true });
  console.log('PostgreSQL stopped');
}

async function status(): Promise<void> {
  const running = await portOpen();
  console.log(running ? `running on ${DB_HOST}:${DB_PORT}` : 'not running');
  process.exit(running ? 0 : 1);
}

const commands: Record<string, () => Promise<void>> = { start, up, down, status };
const command = process.argv[2] ?? '';
const run = commands[command];
if (!run) {
  console.error('Usage: tsx scripts/db.ts start | up | down | status');
  process.exit(2);
}
run().catch((error) => {
  console.error(error);
  process.exit(1);
});
```


- [ ] **Step 6: Verify the runner end to end**

Run: `npm run db:up`
Expected: ends with `PostgreSQL running on 127.0.0.1:54329`. The first run downloads and initialises the cluster and can take over a minute.

Run: `npm run db:status`
Expected: prints `running on 127.0.0.1:54329`, exit 0.

Run: `npm run db:down` then `npm run db:status`
Expected: `PostgreSQL stopped`, then `not running` with exit 1.

Run: `npm run db:up` again.
Expected: back up, and `.data/pg` is reused (much faster).

- [ ] **Step 7: Lint and commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add scripts tests/lib/db-config.test.ts
git commit -m "feat(db): embedded PostgreSQL runner with up, down, status" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prisma schema, migration and tenant-scoped client

**Files:**
- Create: `prisma.config.ts`, `prisma/schema.prisma`, `src/server/data/prisma.ts`, `src/server/data/tenant-db.ts`
- Replace: `tests/helpers/global-setup.ts`
- Create: `tests/helpers/db.ts`, `tests/data/tenant-registry.test.ts`, `tests/data/tenant-db.test.ts`
- Modify: `package.json` (add `postinstall`)

**Interfaces:**
- Produces: `createPrisma(connectionString?: string): PrismaClient`, `getPrisma(): PrismaClient` from `src/server/data/prisma.ts`.
- Produces: `TENANT_SCOPED_MODELS`, `UNSCOPED_LOOKUP_MODELS`, `GLOBAL_MODELS`, `scopedDb(prisma: PrismaClient, restaurantId: string)` from `src/server/data/tenant-db.ts`.
- Produces (tests): `testPrisma()`, `requireTestDb()`, `resetTestData(prisma)`, `createRestaurantFixture(prisma, slug)` from `tests/helpers/db.ts`.

- [ ] **Step 1: Create `prisma.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/buzzify',
  },
});
```

- [ ] **Step 2: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

enum Daypart {
  BREAKFAST
  LUNCH
  DINNER
  LATE_NIGHT
}

enum PairingSourceType {
  PRODUCT
  CATEGORY
}

enum RestaurantStatus {
  ACTIVE
  SUSPENDED
}

enum ThemeMode {
  DARK
  LIGHT
}

enum NumeralSystem {
  LATN
  ARAB
}

enum AnalyticsEventType {
  MENU_VIEW
  PRODUCT_VIEW
  ADD_TO_CART
  UPSELL_IMPRESSION
  UPSELL_ACCEPT
  PAIRING_IMPRESSION
  PAIRING_ADD
  BUNDLE_IMPRESSION
  BUNDLE_ACCEPT
}

model Restaurant {
  id            String           @id @default(cuid())
  slug          String           @unique
  name          String
  currency      String           @default("USD")
  defaultLocale String           @default("en")
  locales       String[]
  timezone      String
  numeralSystem NumeralSystem    @default(LATN)
  engineConfig  Json             @default("{}")
  status        RestaurantStatus @default(ACTIVE)
  createdAt     DateTime         @default(now())

  domains         RestaurantDomain[]
  brand           BrandConfig?
  categories      Category[]
  products        Product[]
  variants        ProductVariant[]
  groups          ModifierGroup[]
  options         ModifierOption[]
  upsellRules     UpsellRule[]
  pairingRules    PairingRule[]
  bundles         Bundle[]
  bundleItems     BundleItem[]
  schedule        DaypartSchedule[]
  tables          Table[]
  analyticsEvents AnalyticsEvent[]
}

model RestaurantDomain {
  id           String     @id @default(cuid())
  restaurantId String
  host         String     @unique
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  @@index([restaurantId])
}

model BrandConfig {
  id              String     @id @default(cuid())
  restaurantId    String     @unique
  tokens          Json
  typography      Json
  theme           ThemeMode  @default(DARK)
  motionIntensity String     @default("subtle")
  navStyle        String     @default("rail")
  logoText        String
  restaurant      Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
}

model Category {
  id           String     @id @default(cuid())
  restaurantId String
  slug         String
  sortOrder    Int        @default(0)
  translations Json
  isActive     Boolean    @default(true)
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  products     Product[]

  @@unique([restaurantId, slug])
}

model Product {
  id                 String    @id @default(cuid())
  restaurantId       String
  categoryId         String
  slug               String
  basePrice          Int
  cost               Int?
  popularity         Int       @default(50)
  priority           Int       @default(50)
  isSignature        Boolean   @default(false)
  isFeatured         Boolean   @default(false)
  isAvailable        Boolean   @default(true)
  stockCount         Int?
  lowStockThreshold  Int?
  dayparts           Daypart[]
  hideOutsideDaypart Boolean   @default(false)
  slot               String?
  allergens          String[]
  ingredients        Json      @default("{}")
  media              Json      @default("[]")
  translations       Json
  sortOrder          Int       @default(0)

  restaurant   Restaurant        @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  category     Category          @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  variants     ProductVariant[]
  groups       ModifierGroup[]
  upsellFrom   UpsellRule[]      @relation("UpsellSource")
  upsellTo     UpsellRule[]      @relation("UpsellTarget")
  pairingFrom  PairingRule[]     @relation("PairingSource")
  pairingTo    PairingRule[]     @relation("PairingTarget")
  bundleItems  BundleItem[]

  @@unique([restaurantId, slug])
  @@index([restaurantId, categoryId])
}

model ProductVariant {
  id           String     @id @default(cuid())
  restaurantId String
  productId    String
  priceDelta   Int        @default(0)
  costDelta    Int?
  isDefault    Boolean    @default(false)
  translations Json
  sortOrder    Int        @default(0)
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  product      Product    @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([restaurantId, productId])
}

model ModifierGroup {
  id           String           @id @default(cuid())
  restaurantId String
  productId    String
  minSelect    Int              @default(0)
  maxSelect    Int              @default(1)
  translations Json
  sortOrder    Int              @default(0)
  restaurant   Restaurant       @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  product      Product          @relation(fields: [productId], references: [id], onDelete: Cascade)
  options      ModifierOption[]

  @@index([restaurantId, productId])
}

model ModifierOption {
  id              String        @id @default(cuid())
  restaurantId    String
  groupId         String
  priceDelta      Int           @default(0)
  costDelta       Int?
  isSuggested     Boolean       @default(false)
  suggestPriority Int           @default(50)
  isAvailable     Boolean       @default(true)
  translations    Json
  sortOrder       Int           @default(0)
  restaurant      Restaurant    @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  group           ModifierGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@index([restaurantId, groupId])
}

model UpsellRule {
  id              String     @id @default(cuid())
  restaurantId    String
  sourceProductId String
  targetProductId String
  priority        Int        @default(50)
  dayparts        Daypart[]
  translations    Json
  isActive        Boolean    @default(true)
  restaurant      Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  source          Product    @relation("UpsellSource", fields: [sourceProductId], references: [id], onDelete: Cascade)
  target          Product    @relation("UpsellTarget", fields: [targetProductId], references: [id], onDelete: Cascade)

  @@index([restaurantId, sourceProductId])
}

model PairingRule {
  id               String            @id @default(cuid())
  restaurantId     String
  sourceType       PairingSourceType
  sourceProductId  String?
  sourceCategoryId String?
  targetProductId  String
  weight           Int               @default(50)
  dayparts         Daypart[]
  translations     Json
  isActive         Boolean           @default(true)
  restaurant       Restaurant        @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  source           Product?          @relation("PairingSource", fields: [sourceProductId], references: [id], onDelete: Cascade)
  target           Product           @relation("PairingTarget", fields: [targetProductId], references: [id], onDelete: Cascade)

  @@index([restaurantId])
}

model Bundle {
  id           String       @id @default(cuid())
  restaurantId String
  slug         String
  price        Int
  dayparts     Daypart[]
  translations Json
  isActive     Boolean      @default(true)
  restaurant   Restaurant   @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  items        BundleItem[]

  @@unique([restaurantId, slug])
}

model BundleItem {
  id           String     @id @default(cuid())
  restaurantId String
  bundleId     String
  productId    String
  variantId    String?
  quantity     Int        @default(1)
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  bundle       Bundle     @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  product      Product    @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([restaurantId, bundleId])
}

model DaypartSchedule {
  id           String     @id @default(cuid())
  restaurantId String
  daypart      Daypart
  startMinute  Int
  endMinute    Int
  daysOfWeek   Int        @default(127)
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  @@index([restaurantId])
}

model Table {
  id           String     @id @default(cuid())
  restaurantId String
  number       Int
  label        String
  restaurant   Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  @@unique([restaurantId, number])
}

model AnalyticsEvent {
  id                 String             @id @default(cuid())
  restaurantId       String
  anonymousSessionId String
  type               AnalyticsEventType
  tableNumber        Int?
  productId          String?
  suggestionId       String?
  payload            Json               @default("{}")
  occurredAt         DateTime           @default(now())
  restaurant         Restaurant         @relation(fields: [restaurantId], references: [id], onDelete: Cascade)

  @@index([restaurantId, type, occurredAt])
}
```

- [ ] **Step 3: Validate, generate and migrate**

Run: `npm run db:up` (if not already running).

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid`.

Run: `npm run db:generate`
Expected: client generated into `src/generated/prisma`.

Run: `npm run db:migrate -- --name init`
Expected: `prisma/migrations/<timestamp>_init/migration.sql` created and applied to `buzzify`.

Then add `"postinstall": "prisma generate"` to the `scripts` block of `package.json`.

- [ ] **Step 4: Implement `src/server/data/prisma.ts`**

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export function createPrisma(connectionString: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
  globalForPrisma.__prisma ??= createPrisma();
  return globalForPrisma.__prisma;
}
```

- [ ] **Step 5: Write the failing registry test**

`tests/data/tenant-registry.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOBAL_MODELS, TENANT_SCOPED_MODELS, UNSCOPED_LOOKUP_MODELS } from '@/server/data/tenant-db';

function parseModels(schema: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    models.set(match[1] as string, match[2] as string);
  }
  return models;
}

describe('tenant scoping registry', () => {
  const models = parseModels(readFileSync('prisma/schema.prisma', 'utf8'));

  it('finds the models in the schema', () => {
    expect(models.size).toBeGreaterThan(10);
  });

  it('registers every model that has a restaurantId column', () => {
    const withTenant = [...models.entries()]
      .filter(([, body]) => /^\s*restaurantId\s+String/m.test(body))
      .map(([name]) => name)
      .sort();
    const registered = [...TENANT_SCOPED_MODELS, ...UNSCOPED_LOOKUP_MODELS].sort();
    expect(withTenant).toEqual(registered);
  });

  it('classifies every model exactly once', () => {
    const all = [...TENANT_SCOPED_MODELS, ...UNSCOPED_LOOKUP_MODELS, ...GLOBAL_MODELS].sort();
    expect([...models.keys()].sort()).toEqual(all);
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run tests/data/tenant-registry.test.ts`
Expected: FAIL, cannot find `@/server/data/tenant-db`.

- [ ] **Step 7: Implement `src/server/data/tenant-db.ts`**

```ts
import type { PrismaClient } from '@/generated/prisma/client';

export const TENANT_SCOPED_MODELS = [
  'BrandConfig',
  'Category',
  'Product',
  'ProductVariant',
  'ModifierGroup',
  'ModifierOption',
  'UpsellRule',
  'PairingRule',
  'Bundle',
  'BundleItem',
  'DaypartSchedule',
  'Table',
  'AnalyticsEvent',
] as const;

/** Looked up by host before the tenant is known, so they use the unscoped client. */
export const UNSCOPED_LOOKUP_MODELS = ['RestaurantDomain'] as const;

export const GLOBAL_MODELS = ['Restaurant'] as const;

const SCOPED = new Set<string>(TENANT_SCOPED_MODELS);
const FILTERED = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const CREATING = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown> & { where?: Record<string, unknown> };

function scopeWhere(args: Args, restaurantId: string): Args {
  const where = args.where ?? {};
  const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...args, where: { ...where, AND: [...existing, { restaurantId }] } };
}

function scopeData(row: unknown, restaurantId: string): Record<string, unknown> {
  const data = (row ?? {}) as Record<string, unknown>;
  if (data.restaurantId !== undefined && data.restaurantId !== restaurantId) {
    throw new Error('Tenant mismatch: refusing to write a row for another restaurant');
  }
  return { ...data, restaurantId };
}

export function scopedDb(prisma: PrismaClient, restaurantId: string) {
  if (!restaurantId) throw new Error('scopedDb requires a restaurantId');
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SCOPED.has(model)) return query(args);
          const input = (args ?? {}) as Args;
          if (FILTERED.has(operation)) return query(scopeWhere(input, restaurantId));
          if (CREATING.has(operation)) {
            const data = input.data;
            const next = Array.isArray(data)
              ? data.map((row) => scopeData(row, restaurantId))
              : scopeData(data, restaurantId);
            return query({ ...input, data: next });
          }
          if (operation === 'upsert') {
            return query({
              ...scopeWhere(input, restaurantId),
              create: scopeData(input.create, restaurantId),
            });
          }
          throw new Error(`Operation ${operation} is not allowed on tenant-scoped model ${model}`);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
```

- [ ] **Step 8: Run the registry test**

Run: `npx vitest run tests/data/tenant-registry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 9: Replace `tests/helpers/global-setup.ts` and add `tests/helpers/db.ts`**

`tests/helpers/global-setup.ts`:

```ts
import { execSync } from 'node:child_process';
import pg from 'pg';
import { databaseUrl, DB_HOST, DB_PASSWORD, DB_PORT, DB_USER, TEST_DB } from '../../scripts/db-config';

export default async function setup() {
  const admin = new pg.Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: 3000,
  });
  try {
    await admin.connect();
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${TEST_DB}"`);
    await admin.end();
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl(TEST_DB) },
    });
  } catch (error) {
    process.env.TEST_DB_UNAVAILABLE = error instanceof Error ? error.message : String(error);
    console.warn('[tests] Test database unavailable. Run `npm run db:up`. Database tests will fail.');
  }
}
```

`tests/helpers/db.ts`:

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrisma } from '@/server/data/prisma';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';

export function requireTestDb(): void {
  if (process.env.TEST_DB_UNAVAILABLE) {
    throw new Error(`Test database unavailable: ${process.env.TEST_DB_UNAVAILABLE}. Run \`npm run db:up\`.`);
  }
}

export function testPrisma(): PrismaClient {
  requireTestDb();
  return createPrisma(databaseUrl(TEST_DB));
}

export async function resetTestData(prisma: PrismaClient): Promise<void> {
  await prisma.restaurant.deleteMany();
}

export async function createRestaurantFixture(prisma: PrismaClient, slug: string) {
  const restaurant = await prisma.restaurant.create({
    data: {
      slug,
      name: `Restaurant ${slug}`,
      currency: 'USD',
      defaultLocale: 'en',
      locales: ['en', 'ar', 'ckb'],
      timezone: 'Asia/Baghdad',
    },
  });
  const category = await prisma.category.create({
    data: { restaurantId: restaurant.id, slug: 'coffee', translations: { en: { name: 'Coffee' } } },
  });
  const product = await prisma.product.create({
    data: {
      restaurantId: restaurant.id,
      categoryId: category.id,
      slug: `${slug}-espresso`,
      basePrice: 300,
      translations: { en: { name: 'Espresso', description: 'Short and strong' } },
    },
  });
  return { restaurant, category, product };
}
```

- [ ] **Step 10: Write the failing isolation test**

`tests/data/tenant-db.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scopedDb } from '@/server/data/tenant-db';
import { createRestaurantFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();

describe('scopedDb', () => {
  let a: Awaited<ReturnType<typeof createRestaurantFixture>>;
  let b: Awaited<ReturnType<typeof createRestaurantFixture>>;

  beforeAll(async () => {
    await resetTestData(prisma);
  });

  beforeEach(async () => {
    await resetTestData(prisma);
    a = await createRestaurantFixture(prisma, 'tenant-a');
    b = await createRestaurantFixture(prisma, 'tenant-b');
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('lists only the tenant\'s rows', async () => {
    const products = await scopedDb(prisma, a.restaurant.id).product.findMany();
    expect(products.map((p) => p.id)).toEqual([a.product.id]);
  });

  it('cannot read another tenant\'s row by id', async () => {
    const found = await scopedDb(prisma, a.restaurant.id).product.findUnique({ where: { id: b.product.id } });
    expect(found).toBeNull();
  });

  it('cannot update another tenant\'s row', async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    await expect(db.product.update({ where: { id: b.product.id }, data: { basePrice: 1 } })).rejects.toThrow();
    const untouched = await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } });
    expect(untouched.basePrice).toBe(300);
  });

  it('cannot bulk delete another tenant\'s rows', async () => {
    const result = await scopedDb(prisma, a.restaurant.id).product.deleteMany({});
    expect(result.count).toBe(1);
    expect(await prisma.product.count({ where: { restaurantId: b.restaurant.id } })).toBe(1);
  });

  it('stamps restaurantId on create and rejects a conflicting one', async () => {
    const db = scopedDb(prisma, a.restaurant.id);
    const created = await db.category.create({
      data: { slug: 'tea', translations: { en: { name: 'Tea' } } } as never,
    });
    expect(created.restaurantId).toBe(a.restaurant.id);
    await expect(
      db.category.create({
        data: { slug: 'x', restaurantId: b.restaurant.id, translations: {} },
      }),
    ).rejects.toThrow(/Tenant mismatch/);
  });

  it('counts only the tenant\'s rows', async () => {
    expect(await scopedDb(prisma, a.restaurant.id).product.count()).toBe(1);
  });
});
```

- [ ] **Step 11: Run it**

Run: `npm run db:up && npx vitest run tests/data`
Expected: PASS, all tests in `tenant-registry.test.ts` and `tenant-db.test.ts` (9 tests).

If the `create` test fails to type-check because the scoped create input requires `restaurantId`, keep the `as never` cast on the stamped-create case; it is deliberate, because the extension supplies the field at runtime.

- [ ] **Step 12: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add prisma.config.ts prisma src/server/data tests package.json package-lock.json
git commit -m "feat(data): Prisma schema, initial migration and tenant-scoped client" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared utilities and domain foundations

**Files:**
- Create: `src/lib/search.ts`, `src/lib/i18n.ts`
- Create: `src/server/domain/types.ts`, `src/server/domain/translate.ts`, `src/server/domain/money.ts`, `src/server/domain/schedule.ts`, `src/server/domain/config.ts`
- Test: `tests/lib/search.test.ts`, `tests/lib/i18n.test.ts`, `tests/domain/translate.test.ts`, `tests/domain/money.test.ts`, `tests/domain/schedule.test.ts`, `tests/domain/config.test.ts`

**Interfaces:**
- Produces from `src/lib/search.ts`: `normalizeSearch(input: string): string`, `matchesQuery(searchKey: string, query: string): boolean`.
- Produces from `src/lib/i18n.ts`: `type Messages = Record<string, string>`, `type Translate = (key: string, params?: Record<string, string | number>) => string`, `createTranslator(locale: Locale, catalog: Record<Locale, Messages>): Translate`.
- Produces from `src/server/domain/types.ts`: `Locale`, `LOCALES`, `Daypart`, `DAYPARTS`, `TranslationMap`, `CatalogOption`, `CatalogGroup`, `CatalogVariant`, `CatalogProduct`, `CatalogCategory`, `UpsellRule`, `PairingRule`, `BundleItem`, `Bundle`, `DaypartWindow`, `Catalog`, `CartLineInput`, `CartBundleInput`, `CartInput`, `MAX_QUANTITY`, `MAX_LINES`.
- Produces from `src/server/domain/translate.ts`: `resolveText(map, field, locale, defaultLocale): string`.
- Produces from `src/server/domain/money.ts`: `minorUnitDigits(currency): number`, `formatMoney(amount, currency, locale?, numerals?): string`.
- Produces from `src/server/domain/schedule.ts`: `ALL_DAYS`, `localClock(now, timeZone)`, `currentDaypart(now, windows, timeZone): Daypart | null`.
- Produces from `src/server/domain/config.ts`: `EngineWeights`, `EngineConfig`, `DEFAULT_ENGINE_CONFIG`, `resolveEngineConfig(raw: unknown): EngineConfig`.

- [ ] **Step 1: Write the failing search test**

`tests/lib/search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeSearch } from '@/lib/search';

describe('normalizeSearch', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeSearch('  Flat   WHITE ')).toBe('flat white');
  });

  it('strips Latin diacritics', () => {
    expect(normalizeSearch('Crème Brûlée')).toBe('creme brulee');
  });

  it('unifies Arabic letter variants', () => {
    expect(normalizeSearch('إسبريسو')).toBe(normalizeSearch('اسبريسو'));
    expect(normalizeSearch('قهوة')).toBe(normalizeSearch('قهوه'));
    expect(normalizeSearch('شاي')).toBe(normalizeSearch('شای'));
  });

  it('removes Arabic marks and tatweel', () => {
    expect(normalizeSearch('قَهْوَة')).toBe(normalizeSearch('قهوة'));
    expect(normalizeSearch('قـهـوة')).toBe(normalizeSearch('قهوة'));
  });

  it('maps Arabic-Indic and Persian digits to Latin digits', () => {
    expect(normalizeSearch('٢٥٠ غ')).toContain('250');
    expect(normalizeSearch('۲۵۰')).toBe('250');
  });
});

describe('matchesQuery', () => {
  const key = normalizeSearch('Flat White فلات وايت Oat milk');

  it('matches every token regardless of order', () => {
    expect(matchesQuery(key, 'white flat')).toBe(true);
    expect(matchesQuery(key, 'oat')).toBe(true);
    expect(matchesQuery(key, 'espresso')).toBe(false);
  });

  it('matches across scripts', () => {
    expect(matchesQuery(key, 'وايت')).toBe(true);
  });

  it('treats empty and whitespace-only queries as match-all', () => {
    expect(matchesQuery(key, '')).toBe(true);
    expect(matchesQuery(key, '    ')).toBe(true);
  });

  it('never throws on regex metacharacters', () => {
    for (const hostile of ['(', '[', '*', '\\', '.*', '(?<', '$^', '+?']) {
      expect(() => matchesQuery(key, hostile)).not.toThrow();
    }
    expect(matchesQuery(key, '(')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing i18n, translate, money, schedule and config tests**

`tests/lib/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTranslator, type Messages } from '@/lib/i18n';

const catalog: Record<'en' | 'ar' | 'ckb', Messages> = {
  en: {
    hello: 'Hello {name}',
    only_en: 'Only English',
    items_one: '{count} item',
    items_other: '{count} items',
  },
  ar: {
    hello: 'مرحبا {name}',
    items_one: 'عنصر واحد',
    items_two: 'عنصران',
    items_few: '{count} عناصر',
    items_many: '{count} عنصرًا',
    items_other: '{count} عنصر',
  },
  ckb: {
    hello: 'سڵاو {name}',
    items_one: '{count} بەرهەم',
    items_other: '{count} بەرهەم',
  },
};

describe('createTranslator', () => {
  it('interpolates parameters', () => {
    expect(createTranslator('en', catalog)('hello', { name: 'Sara' })).toBe('Hello Sara');
    expect(createTranslator('ar', catalog)('hello', { name: 'سارة' })).toBe('مرحبا سارة');
  });

  it('falls back to English then to the key', () => {
    expect(createTranslator('ar', catalog)('only_en')).toBe('Only English');
    expect(createTranslator('en', catalog)('missing.key')).toBe('missing.key');
  });

  it('leaves unknown placeholders visible instead of throwing', () => {
    expect(createTranslator('en', catalog)('hello')).toBe('Hello {name}');
  });

  it('selects plural forms by locale rules', () => {
    const en = createTranslator('en', catalog);
    expect(en('items', { count: 1 })).toBe('1 item');
    expect(en('items', { count: 3 })).toBe('3 items');
    const ar = createTranslator('ar', catalog);
    expect(ar('items', { count: 1 })).toBe('عنصر واحد');
    expect(ar('items', { count: 2 })).toBe('عنصران');
    expect(ar('items', { count: 5 })).toBe('5 عناصر');
    expect(ar('items', { count: 11 })).toBe('11 عنصرًا');
    expect(ar('items', { count: 100 })).toBe('100 عنصر');
  });
});
```

`tests/domain/translate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveText } from '@/server/domain/translate';

const map = {
  en: { name: 'Flat White', description: 'Silky milk' },
  ar: { name: 'فلات وايت' },
};

describe('resolveText', () => {
  it('returns the requested locale when present', () => {
    expect(resolveText(map, 'name', 'ar', 'en')).toBe('فلات وايت');
  });

  it('falls back to the restaurant default locale', () => {
    expect(resolveText(map, 'name', 'ckb', 'ar')).toBe('فلات وايت');
  });

  it('falls back to English, then to any available text', () => {
    expect(resolveText(map, 'description', 'ar', 'ar')).toBe('Silky milk');
    expect(resolveText({ ckb: { name: 'فلات' } }, 'name', 'ar', 'ar')).toBe('فلات');
  });

  it('treats blank strings as missing and never throws on empty input', () => {
    expect(resolveText({ en: { name: '   ' }, ar: { name: 'ا' } }, 'name', 'en', 'en')).toBe('ا');
    expect(resolveText(null, 'name', 'en', 'en')).toBe('');
    expect(resolveText({}, 'name', 'en', 'en')).toBe('');
  });
});
```

`tests/domain/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMoney, minorUnitDigits } from '@/server/domain/money';

describe('money', () => {
  it('knows minor unit digits per currency', () => {
    expect(minorUnitDigits('USD')).toBe(2);
    expect(minorUnitDigits('IQD')).toBe(0);
  });

  it('formats USD from integer cents', () => {
    expect(formatMoney(900, 'USD', 'en')).toBe('$9.00');
    expect(formatMoney(0, 'USD', 'en')).toBe('$0.00');
  });

  it('formats IQD without decimals', () => {
    const text = formatMoney(15000, 'IQD', 'en');
    expect(text).toMatch(/15,000/);
    expect(text).not.toMatch(/\./);
  });

  it('honours the numeral system', () => {
    const latin = formatMoney(1250, 'USD', 'ar', 'latn');
    const arabic = formatMoney(1250, 'USD', 'ar', 'arab');
    expect(latin).toMatch(/12\.50|12,50/);
    expect(arabic).toMatch(/[٠-٩]/);
  });

  it('does not throw for Sorani', () => {
    expect(() => formatMoney(500, 'USD', 'ckb')).not.toThrow();
  });
});
```

`tests/domain/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { currentDaypart, localClock } from '@/server/domain/schedule';
import type { DaypartWindow } from '@/server/domain/types';

const TZ = 'Asia/Baghdad';
const windows: DaypartWindow[] = [
  { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
  { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
  { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
  { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
];
// Local Baghdad time is UTC+3 with no daylight saving.
const at = (hour: number, minute = 0, day = 15) => new Date(Date.UTC(2026, 9, day, hour - 3, minute));

describe('localClock', () => {
  it('converts an instant to the restaurant timezone', () => {
    expect(localClock(at(10, 30), TZ)).toEqual({ day: 3, minute: 630 });
  });
});

describe('currentDaypart', () => {
  it('resolves ordinary windows with an inclusive start and exclusive end', () => {
    expect(currentDaypart(at(7, 0), windows, TZ)).toBe('BREAKFAST');
    expect(currentDaypart(at(10, 59), windows, TZ)).toBe('BREAKFAST');
    expect(currentDaypart(at(11, 0), windows, TZ)).toBe('LUNCH');
    expect(currentDaypart(at(21, 59), windows, TZ)).toBe('DINNER');
  });

  it('handles the window that wraps past midnight', () => {
    expect(currentDaypart(at(22, 0), windows, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(23, 59), windows, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(0, 30), windows, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(2, 59), windows, TZ)).toBe('LATE_NIGHT');
  });

  it('returns null when no window applies', () => {
    expect(currentDaypart(at(3, 0), windows, TZ)).toBeNull();
    expect(currentDaypart(at(6, 59), windows, TZ)).toBeNull();
  });

  it('applies the day mask, including the previous day for wrapped windows', () => {
    // Monday only (bit 0). 2026-10-15 is a Thursday, 2026-10-12 a Monday.
    const mondayOnly: DaypartWindow[] = [{ daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 1 }];
    expect(currentDaypart(at(23, 0, 15), mondayOnly, TZ)).toBeNull();
    expect(currentDaypart(at(23, 0, 12), mondayOnly, TZ)).toBe('LATE_NIGHT');
    expect(currentDaypart(at(1, 0, 13), mondayOnly, TZ)).toBe('LATE_NIGHT'); // Tuesday 01:00 belongs to Monday's window
  });

  it('returns null for an empty schedule', () => {
    expect(currentDaypart(at(12, 0), [], TZ)).toBeNull();
  });
});
```

`tests/domain/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, resolveEngineConfig } from '@/server/domain/config';

describe('resolveEngineConfig', () => {
  it('returns defaults for empty or invalid input', () => {
    expect(resolveEngineConfig({})).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(resolveEngineConfig(null)).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(resolveEngineConfig('nope')).toEqual(DEFAULT_ENGINE_CONFIG);
  });

  it('merges valid overrides', () => {
    const config = resolveEngineConfig({ upsellMaxOffers: 2, weights: { margin: 0.5 } });
    expect(config.upsellMaxOffers).toBe(2);
    expect(config.weights.margin).toBe(0.5);
    expect(config.weights.popularity).toBe(DEFAULT_ENGINE_CONFIG.weights.popularity);
  });

  it('clamps out-of-range and ignores non-numeric values', () => {
    const config = resolveEngineConfig({ upsellMaxOffers: 99, upsellDeltaCapRatio: -1, weights: { margin: 'high', popularity: 7 } });
    expect(config.upsellMaxOffers).toBe(10);
    expect(config.upsellDeltaCapRatio).toBe(0.05);
    expect(config.weights.margin).toBe(DEFAULT_ENGINE_CONFIG.weights.margin);
    expect(config.weights.popularity).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run tests/lib tests/domain`
Expected: FAIL on every new file with module-not-found errors (`locale.test.ts` and `db-config.test.ts` still pass).

- [ ] **Step 4: Implement `src/lib/search.ts`**

```ts
const MARKS = /[̀-ًͯ-ٰٟـ]/g;

export function normalizeSearch(input: string): string {
  return input
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/[ةە]/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** `searchKey` must already be normalized with `normalizeSearch`. */
export function matchesQuery(searchKey: string, query: string): boolean {
  const normalized = normalizeSearch(query);
  if (normalized === '') return true;
  return normalized.split(' ').every((token) => searchKey.includes(token));
}
```

- [ ] **Step 5: Implement `src/lib/i18n.ts`**

```ts
import type { Locale } from './locale';

export type Messages = Record<string, string>;
export type Translate = (key: string, params?: Record<string, string | number>) => string;

function pluralRules(locale: Locale): Intl.PluralRules {
  const supported = Intl.PluralRules.supportedLocalesOf([locale]).length > 0;
  return new Intl.PluralRules(supported ? locale : 'en');
}

export function createTranslator(locale: Locale, catalog: Record<Locale, Messages>): Translate {
  const rules = pluralRules(locale);
  const own = catalog[locale];
  const fallback = catalog.en;

  return (key, params) => {
    let template: string | undefined;
    if (params && typeof params.count === 'number') {
      const category = rules.select(params.count);
      template =
        own[`${key}_${category}`] ?? own[`${key}_other`] ?? fallback[`${key}_${category}`] ?? fallback[`${key}_other`];
    }
    template ??= own[key] ?? fallback[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name];
      return value === undefined ? placeholder : String(value);
    });
  };
}
```

- [ ] **Step 6: Implement `src/server/domain/types.ts`**

```ts
import { LOCALES, type Locale } from '@/lib/locale';

export { LOCALES };
export type { Locale };

export const DAYPARTS = ['BREAKFAST', 'LUNCH', 'DINNER', 'LATE_NIGHT'] as const;
export type Daypart = (typeof DAYPARTS)[number];

export const MAX_QUANTITY = 20;
export const MAX_LINES = 50;

export type TranslationMap = Partial<Record<Locale, Record<string, string>>>;

export interface CatalogOption {
  id: string;
  groupId: string;
  priceDelta: number;
  costDelta: number | null;
  isSuggested: boolean;
  suggestPriority: number;
  isAvailable: boolean;
  translations: TranslationMap; // name, effect
}

export interface CatalogGroup {
  id: string;
  productId: string;
  minSelect: number;
  maxSelect: number;
  translations: TranslationMap; // name
  options: CatalogOption[];
}

export interface CatalogVariant {
  id: string;
  productId: string;
  priceDelta: number;
  costDelta: number | null;
  isDefault: boolean;
  translations: TranslationMap; // name
}

export interface CatalogProduct {
  id: string;
  categoryId: string;
  slug: string;
  basePrice: number;
  cost: number | null;
  popularity: number;
  priority: number;
  isSignature: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  stockCount: number | null;
  lowStockThreshold: number | null;
  dayparts: Daypart[];
  hideOutsideDaypart: boolean;
  slot: string | null;
  translations: TranslationMap; // name, description
  groups: CatalogGroup[];
  variants: CatalogVariant[];
  media: unknown[]; // validated into MediaItem[] by the presentation layer
  allergens: string[];
  ingredients: Partial<Record<Locale, string[]>>;
  sortOrder: number;
}

export interface CatalogCategory {
  id: string;
  slug: string;
  sortOrder: number;
  translations: TranslationMap; // name
}

export interface UpsellRule {
  id: string;
  sourceProductId: string;
  targetProductId: string;
  priority: number;
  dayparts: Daypart[];
  translations: TranslationMap; // pitch, effect
}

export interface PairingRule {
  id: string;
  sourceType: 'PRODUCT' | 'CATEGORY';
  sourceProductId: string | null;
  sourceCategoryId: string | null;
  targetProductId: string;
  weight: number;
  dayparts: Daypart[];
  translations: TranslationMap; // reason
}

export interface BundleItem {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface Bundle {
  id: string;
  slug: string;
  price: number;
  dayparts: Daypart[];
  translations: TranslationMap; // name, description
  items: BundleItem[];
}

export interface DaypartWindow {
  daypart: Daypart;
  startMinute: number;
  endMinute: number;
  daysOfWeek: number;
}

export interface Catalog {
  restaurantId: string;
  currency: string;
  timeZone: string;
  defaultLocale: Locale;
  categories: CatalogCategory[];
  products: CatalogProduct[];
  upsellRules: UpsellRule[];
  pairingRules: PairingRule[];
  bundles: Bundle[];
  schedule: DaypartWindow[];
}

export interface CartLineInput {
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
}

export interface CartBundleInput {
  bundleId: string;
  quantity: number;
}

export interface CartInput {
  lines: CartLineInput[];
  bundles: CartBundleInput[];
}
```

- [ ] **Step 7: Implement `translate.ts`, `money.ts`, `schedule.ts`, `config.ts`**

`src/server/domain/translate.ts`:

```ts
import type { Locale, TranslationMap } from './types';

function pick(map: TranslationMap, locale: Locale, field: string): string | null {
  const value = map[locale]?.[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function resolveText(
  map: TranslationMap | null | undefined,
  field: string,
  locale: Locale,
  defaultLocale: Locale,
): string {
  if (!map) return '';
  for (const candidate of [locale, defaultLocale, 'en' as Locale]) {
    const found = pick(map, candidate, field);
    if (found !== null) return found;
  }
  for (const candidate of Object.keys(map) as Locale[]) {
    const found = pick(map, candidate, field);
    if (found !== null) return found;
  }
  return '';
}
```

`src/server/domain/money.ts`:

```ts
import type { Locale } from './types';

const LOCALE_TAG: Record<Locale, string> = { en: 'en-US', ar: 'ar-IQ', ckb: 'ckb-IQ' };

export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney(
  amount: number,
  currency: string,
  locale: Locale = 'en',
  numerals: 'latn' | 'arab' = 'latn',
): string {
  const digits = minorUnitDigits(currency);
  const wanted = `${LOCALE_TAG[locale]}-u-nu-${numerals}`;
  const tag = Intl.NumberFormat.supportedLocalesOf([wanted]).length > 0 ? wanted : `en-US-u-nu-${numerals}`;
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
}
```

`src/server/domain/schedule.ts`:

```ts
import type { Daypart, DaypartWindow } from './types';

export const ALL_DAYS = 0b1111111;

const DAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** `day` is 0 for Monday through 6 for Sunday; `minute` is minutes since local midnight. */
export function localClock(now: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: DAY_INDEX[get('weekday')] ?? 0,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

export function currentDaypart(
  now: Date,
  windows: readonly DaypartWindow[],
  timeZone: string,
): Daypart | null {
  const { day, minute } = localClock(now, timeZone);
  const previous = (day + 6) % 7;
  const onDay = (mask: number, index: number) => (mask & (1 << index)) !== 0;

  for (const window of windows) {
    if (window.startMinute <= window.endMinute) {
      if (onDay(window.daysOfWeek, day) && minute >= window.startMinute && minute < window.endMinute) {
        return window.daypart;
      }
    } else {
      if (onDay(window.daysOfWeek, day) && minute >= window.startMinute) return window.daypart;
      if (onDay(window.daysOfWeek, previous) && minute < window.endMinute) return window.daypart;
    }
  }
  return null;
}
```

`src/server/domain/config.ts`:

```ts
export interface EngineWeights {
  rulePriority: number;
  margin: number;
  popularity: number;
  priority: number;
  daypart: number;
  stockPenalty: number;
}

export interface EngineConfig {
  upsellMaxOffers: number;
  upsellDeltaCapRatio: number;
  pairingMaxOffers: number;
  cartPairingMaxOffers: number;
  weights: EngineWeights;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  upsellMaxOffers: 3,
  upsellDeltaCapRatio: 0.75,
  pairingMaxOffers: 3,
  cartPairingMaxOffers: 2,
  weights: { rulePriority: 0.45, margin: 0.25, popularity: 0.2, priority: 0.1, daypart: 0.2, stockPenalty: 0.15 },
};

function num(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

export function resolveEngineConfig(raw: unknown): EngineConfig {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const weights = (typeof source.weights === 'object' && source.weights !== null ? source.weights : {}) as Record<string, unknown>;
  const d = DEFAULT_ENGINE_CONFIG;
  return {
    upsellMaxOffers: num(source.upsellMaxOffers, d.upsellMaxOffers, 1, 10, true),
    upsellDeltaCapRatio: num(source.upsellDeltaCapRatio, d.upsellDeltaCapRatio, 0.05, 5),
    pairingMaxOffers: num(source.pairingMaxOffers, d.pairingMaxOffers, 1, 10, true),
    cartPairingMaxOffers: num(source.cartPairingMaxOffers, d.cartPairingMaxOffers, 1, 10, true),
    weights: {
      rulePriority: num(weights.rulePriority, d.weights.rulePriority, 0, 1),
      margin: num(weights.margin, d.weights.margin, 0, 1),
      popularity: num(weights.popularity, d.weights.popularity, 0, 1),
      priority: num(weights.priority, d.weights.priority, 0, 1),
      daypart: num(weights.daypart, d.weights.daypart, 0, 1),
      stockPenalty: num(weights.stockPenalty, d.weights.stockPenalty, 0, 1),
    },
  };
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/lib tests/domain`
Expected: PASS, all files green. If a money assertion fails because ICU formats IQD with a different spacing, loosen only the whitespace in the regex, not the digit checks.

- [ ] **Step 9: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src/lib src/server/domain tests
git commit -m "feat(domain): types, money, schedule, translation, engine config, search and i18n" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cart helpers and server pricing (quote)

**Files:**
- Create: `src/server/domain/catalog.ts`, `src/server/domain/pricing.ts`, `src/lib/cart.ts`
- Test: `tests/domain/fixtures.ts`, `tests/domain/pricing.test.ts`, `tests/lib/cart.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CatalogProduct`, `CartInput`, `CartLineInput`, `Daypart`, `MAX_QUANTITY`, `currentDaypart`.
- Produces from `src/server/domain/catalog.ts`: `type Orderability = 'OK' | 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'OUT_OF_DAYPART'`, `productMap(catalog)`, `daypartNow(catalog, now)`, `inDaypart(dayparts, current)`, `orderability(product, current)`, `defaultVariant(product)`, `unitPrice(product, variantId, optionIds): { price: number; cost: number | null }`, `marginRatio(price, cost): number`.
- Produces from `src/server/domain/pricing.ts`: `QuoteIssueCode`, `QuoteIssue`, `QuoteLine`, `QuoteBundleLine`, `Quote`, `quoteCart(catalog, cart, now): Quote`.
- Produces from `src/lib/cart.ts`: `EMPTY_CART`, `lineKey(line)`, `addLine(cart, line)`, `setLineQuantity(cart, key, quantity)`, `removeLine(cart, key)`, `setBundleQuantity(cart, bundleId, quantity)`, `itemCount(cart)`, `isEmpty(cart)`.
- Produces (tests): `tests/domain/fixtures.ts` exporting `WINDOWS`, `at(hour, minute?)`, `product(overrides)`, `makeCatalog(overrides?)`, and the product id constants used by later tasks.

- [ ] **Step 1: Create the shared test fixtures**

`tests/domain/fixtures.ts`:

```ts
import type {
  Bundle,
  Catalog,
  CatalogProduct,
  DaypartWindow,
  PairingRule,
  UpsellRule,
} from '@/server/domain/types';

export const WINDOWS: DaypartWindow[] = [
  { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
  { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
  { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
  { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
];

/** Local time in Asia/Baghdad (UTC+3, no daylight saving) on Thursday 2026-10-15. */
export function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 9, 15, hour - 3, minute));
}

export function product(overrides: Partial<CatalogProduct> & Pick<CatalogProduct, 'id'>): CatalogProduct {
  return {
    categoryId: 'cat-plates',
    slug: overrides.id,
    basePrice: 1000,
    cost: 300,
    popularity: 50,
    priority: 50,
    isSignature: false,
    isFeatured: false,
    isAvailable: true,
    stockCount: null,
    lowStockThreshold: null,
    dayparts: [],
    hideOutsideDaypart: false,
    slot: null,
    translations: { en: { name: overrides.id, description: '' } },
    groups: [],
    variants: [],
    media: [],
    allergens: [],
    ingredients: {},
    sortOrder: 0,
    ...overrides,
  };
}

export const IDS = {
  espresso: 'p-espresso',
  burger: 'p-burger',
  wagyu: 'p-wagyu',
  fries: 'p-fries',
  sparkling: 'p-sparkling',
  croissant: 'p-croissant',
  cheesecake: 'p-cheesecake',
  steak: 'p-steak',
  caviar: 'p-caviar',
  coldBrew: 'p-coldbrew',
  optCheese: 'o-cheese',
  optDouble: 'o-double',
  optBacon: 'o-bacon',
  optShot: 'o-shot',
  optRare: 'o-rare',
  optWell: 'o-well',
  varRegular: 'v-regular',
  varLarge: 'v-large',
  groupAddons: 'g-addons',
  groupDoneness: 'g-doneness',
  groupExtras: 'g-extras',
} as const;

const products: CatalogProduct[] = [
  product({
    id: IDS.espresso,
    categoryId: 'cat-coffee',
    basePrice: 300,
    cost: 45,
    popularity: 80,
    slot: 'DRINK',
    groups: [
      {
        id: IDS.groupExtras,
        productId: IDS.espresso,
        minSelect: 0,
        maxSelect: 1,
        translations: { en: { name: 'Extras' } },
        options: [
          {
            id: IDS.optShot,
            groupId: IDS.groupExtras,
            priceDelta: 100,
            costDelta: 20,
            isSuggested: true,
            suggestPriority: 60,
            isAvailable: true,
            translations: { en: { name: 'Extra shot', effect: 'A second shot of espresso' } },
          },
        ],
      },
    ],
  }),
  product({
    id: IDS.burger,
    basePrice: 900,
    cost: 310,
    popularity: 75,
    slot: 'MAIN',
    groups: [
      {
        id: IDS.groupAddons,
        productId: IDS.burger,
        minSelect: 0,
        maxSelect: 2,
        translations: { en: { name: 'Make it yours' } },
        options: [
          {
            id: IDS.optCheese,
            groupId: IDS.groupAddons,
            priceDelta: 100,
            costDelta: 35,
            isSuggested: true,
            suggestPriority: 70,
            isAvailable: true,
            translations: { en: { name: 'Premium cheese', effect: 'Aged cheddar, melted' } },
          },
          {
            id: IDS.optDouble,
            groupId: IDS.groupAddons,
            priceDelta: 300,
            costDelta: 160,
            isSuggested: true,
            suggestPriority: 85,
            isAvailable: true,
            translations: { en: { name: 'Double patty', effect: 'A second 140 g beef patty' } },
          },
          {
            id: IDS.optBacon,
            groupId: IDS.groupAddons,
            priceDelta: 150,
            costDelta: 60,
            isSuggested: false,
            suggestPriority: 50,
            isAvailable: true,
            translations: { en: { name: 'Bacon' } },
          },
        ],
      },
    ],
  }),
  product({ id: IDS.wagyu, basePrice: 1300, cost: 590, popularity: 60, slot: 'MAIN' }),
  product({ id: IDS.fries, basePrice: 550, cost: 120, popularity: 70, slot: 'SIDE' }),
  product({ id: IDS.sparkling, categoryId: 'cat-cold', basePrice: 300, cost: 60, popularity: 55, slot: 'DRINK' }),
  product({
    id: IDS.croissant,
    categoryId: 'cat-breakfast',
    basePrice: 350,
    cost: 80,
    popularity: 85,
    slot: 'BAKERY',
    dayparts: ['BREAKFAST'],
  }),
  product({ id: IDS.cheesecake, categoryId: 'cat-pastry', basePrice: 750, cost: 190, popularity: 65, slot: 'DESSERT' }),
  product({
    id: IDS.steak,
    basePrice: 2800,
    cost: 1150,
    popularity: 50,
    slot: 'MAIN',
    groups: [
      {
        id: IDS.groupDoneness,
        productId: IDS.steak,
        minSelect: 1,
        maxSelect: 1,
        translations: { en: { name: 'Doneness' } },
        options: [
          {
            id: IDS.optRare,
            groupId: IDS.groupDoneness,
            priceDelta: 0,
            costDelta: 0,
            isSuggested: false,
            suggestPriority: 0,
            isAvailable: true,
            translations: { en: { name: 'Rare' } },
          },
          {
            id: IDS.optWell,
            groupId: IDS.groupDoneness,
            priceDelta: 0,
            costDelta: 0,
            isSuggested: false,
            suggestPriority: 0,
            isAvailable: true,
            translations: { en: { name: 'Well done' } },
          },
        ],
      },
    ],
  }),
  // Very high margin and priority, but no rule relates it to anything: it must never be recommended.
  product({ id: IDS.caviar, basePrice: 4000, cost: 400, popularity: 20, priority: 95, slot: 'STARTER' }),
  product({
    id: IDS.coldBrew,
    categoryId: 'cat-cold',
    basePrice: 500,
    cost: 90,
    popularity: 60,
    slot: 'DRINK',
    variants: [
      {
        id: IDS.varRegular,
        productId: IDS.coldBrew,
        priceDelta: 0,
        costDelta: 0,
        isDefault: true,
        translations: { en: { name: 'Regular 350 ml' } },
      },
      {
        id: IDS.varLarge,
        productId: IDS.coldBrew,
        priceDelta: 150,
        costDelta: 40,
        isDefault: false,
        translations: { en: { name: 'Large 500 ml' } },
      },
    ],
  }),
];

const upsellRules: UpsellRule[] = [
  {
    id: 'u-wagyu',
    sourceProductId: IDS.burger,
    targetProductId: IDS.wagyu,
    priority: 80,
    dayparts: [],
    translations: { en: { pitch: 'Wagyu burger', effect: 'Wagyu beef patty on a toasted brioche bun' } },
  },
];

const pairingRules: PairingRule[] = [
  {
    id: 'r-burger-fries',
    sourceType: 'PRODUCT',
    sourceProductId: IDS.burger,
    sourceCategoryId: null,
    targetProductId: IDS.fries,
    weight: 90,
    dayparts: [],
    translations: { en: { reason: 'Crisp and salted, the classic partner' } },
  },
  {
    id: 'r-burger-sparkling',
    sourceType: 'PRODUCT',
    sourceProductId: IDS.burger,
    sourceCategoryId: null,
    targetProductId: IDS.sparkling,
    weight: 50,
    dayparts: [],
    translations: { en: { reason: 'Something cold alongside' } },
  },
  {
    id: 'r-steak-fries',
    sourceType: 'PRODUCT',
    sourceProductId: IDS.steak,
    sourceCategoryId: null,
    targetProductId: IDS.fries,
    weight: 85,
    dayparts: [],
    translations: { en: { reason: 'A side for the steak' } },
  },
  {
    id: 'r-coffee-croissant',
    sourceType: 'CATEGORY',
    sourceProductId: null,
    sourceCategoryId: 'cat-coffee',
    targetProductId: IDS.croissant,
    weight: 85,
    dayparts: [],
    translations: { en: { reason: 'Pairs with your coffee' } },
  },
  {
    id: 'r-coffee-cheesecake',
    sourceType: 'CATEGORY',
    sourceProductId: null,
    sourceCategoryId: 'cat-coffee',
    targetProductId: IDS.cheesecake,
    weight: 55,
    dayparts: [],
    translations: { en: { reason: 'Something sweet with it' } },
  },
  {
    id: 'r-pastry-espresso',
    sourceType: 'CATEGORY',
    sourceProductId: null,
    sourceCategoryId: 'cat-pastry',
    targetProductId: IDS.espresso,
    weight: 70,
    dayparts: [],
    translations: { en: { reason: 'An espresso to go with it' } },
  },
];

const bundles: Bundle[] = [
  {
    id: 'b-breakfast',
    slug: 'breakfast-set',
    price: 600,
    dayparts: ['BREAKFAST'],
    translations: { en: { name: 'Breakfast set', description: 'Croissant and espresso' } },
    items: [
      { productId: IDS.croissant, variantId: null, quantity: 1 },
      { productId: IDS.espresso, variantId: null, quantity: 1 },
    ],
  },
  {
    id: 'b-burger-meal',
    slug: 'burger-meal',
    price: 1500,
    dayparts: [],
    translations: { en: { name: 'Burger meal', description: 'Burger, fries and sparkling water' } },
    items: [
      { productId: IDS.burger, variantId: null, quantity: 1 },
      { productId: IDS.fries, variantId: null, quantity: 1 },
      { productId: IDS.sparkling, variantId: null, quantity: 1 },
    ],
  },
  {
    // Not a deal: 900 + 550 = 1450 individually, bundle price 1450.
    id: 'b-not-a-deal',
    slug: 'no-saving',
    price: 1450,
    dayparts: [],
    translations: { en: { name: 'No saving' } },
    items: [
      { productId: IDS.burger, variantId: null, quantity: 1 },
      { productId: IDS.fries, variantId: null, quantity: 1 },
    ],
  },
];

export function makeCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    restaurantId: 'r-test',
    currency: 'USD',
    timeZone: 'Asia/Baghdad',
    defaultLocale: 'en',
    categories: [
      { id: 'cat-coffee', slug: 'coffee', sortOrder: 0, translations: { en: { name: 'Coffee' } } },
      { id: 'cat-breakfast', slug: 'breakfast', sortOrder: 1, translations: { en: { name: 'Breakfast' } } },
      { id: 'cat-plates', slug: 'plates', sortOrder: 2, translations: { en: { name: 'Plates' } } },
      { id: 'cat-pastry', slug: 'patisserie', sortOrder: 3, translations: { en: { name: 'Patisserie' } } },
      { id: 'cat-cold', slug: 'cold', sortOrder: 4, translations: { en: { name: 'Cold' } } },
    ],
    products,
    upsellRules,
    pairingRules,
    bundles,
    schedule: WINDOWS,
    ...overrides,
  };
}

export function withProduct(catalog: Catalog, id: string, patch: Partial<CatalogProduct>): Catalog {
  return {
    ...catalog,
    products: catalog.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  };
}
```

- [ ] **Step 2: Write the failing pricing test**

`tests/domain/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { quoteCart } from '@/server/domain/pricing';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, product, withProduct } from './fixtures';

const catalog = makeCatalog();
const noon = at(12);
const morning = at(9);

function line(overrides: Partial<CartLineInput> & Pick<CartLineInput, 'productId'>): CartLineInput {
  return { variantId: null, optionIds: [], quantity: 1, ...overrides };
}
function cart(...lines: CartLineInput[]): CartInput {
  return { lines, bundles: [] };
}
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('quoteCart: pricing', () => {
  it('prices a plain line from the catalog, ignoring any client price', () => {
    const quote = quoteCart(catalog, cart(line({ productId: IDS.burger, quantity: 2 })), noon);
    expect(quote.lines[0]?.unitPrice).toBe(900);
    expect(quote.lines[0]?.lineTotal).toBe(1800);
    expect(quote.subtotal).toBe(1800);
    expect(quote.currency).toBe('USD');
    expect(quote.hasBlockingIssues).toBe(false);
    expect(quote.charges).toEqual([]);
  });

  it('adds option deltas to the unit price', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.burger, optionIds: [IDS.optCheese, IDS.optDouble] })),
      noon,
    );
    expect(quote.lines[0]?.unitPrice).toBe(1300);
  });

  it('uses the default variant when none is given and adds a chosen variant delta', () => {
    const base = quoteCart(catalog, cart(line({ productId: IDS.coldBrew })), noon);
    expect(base.lines[0]?.unitPrice).toBe(500);
    const large = quoteCart(catalog, cart(line({ productId: IDS.coldBrew, variantId: IDS.varLarge })), noon);
    expect(large.lines[0]?.unitPrice).toBe(650);
  });

  it('de-duplicates repeated option ids', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.burger, optionIds: [IDS.optCheese, IDS.optCheese] })),
      noon,
    );
    expect(quote.lines[0]?.unitPrice).toBe(1000);
    expect(quote.lines[0]?.issues).toEqual([]);
  });

  it('sums several lines', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.burger }), line({ productId: IDS.fries, quantity: 2 })),
      noon,
    );
    expect(quote.subtotal).toBe(900 + 1100);
  });
});

describe('quoteCart: issues', () => {
  it('flags an unknown product and excludes it from the subtotal', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: 'does-not-exist' }), line({ productId: IDS.fries })),
      noon,
    );
    expect(codes(quote.lines[0]?.issues ?? [])).toEqual(['UNKNOWN_PRODUCT']);
    expect(quote.subtotal).toBe(550);
    expect(quote.hasBlockingIssues).toBe(true);
  });

  it('flags a product disabled after it was added (stale cart line)', () => {
    const disabled = withProduct(catalog, IDS.fries, { isAvailable: false });
    const quote = quoteCart(disabled, cart(line({ productId: IDS.burger }), line({ productId: IDS.fries })), noon);
    expect(codes(quote.lines[1]?.issues ?? [])).toEqual(['UNAVAILABLE']);
    expect(quote.lines[1]?.lineTotal).toBe(0);
    expect(quote.subtotal).toBe(900);
    expect(quote.hasBlockingIssues).toBe(true);
  });

  it('flags a sold-out product', () => {
    const soldOut = withProduct(catalog, IDS.fries, { stockCount: 0 });
    const quote = quoteCart(soldOut, cart(line({ productId: IDS.fries })), noon);
    expect(codes(quote.lines[0]?.issues ?? [])).toEqual(['OUT_OF_STOCK']);
  });

  it('blocks a daypart-restricted product only when it is hidden outside its dayparts', () => {
    const soft = quoteCart(catalog, cart(line({ productId: IDS.croissant })), noon);
    expect(soft.lines[0]?.issues).toEqual([]);

    const hard = withProduct(catalog, IDS.croissant, { hideOutsideDaypart: true });
    expect(codes(quoteCart(hard, cart(line({ productId: IDS.croissant })), noon).lines[0]?.issues ?? [])).toEqual([
      'OUT_OF_DAYPART',
    ]);
    expect(quoteCart(hard, cart(line({ productId: IDS.croissant })), morning).lines[0]?.issues).toEqual([]);
  });

  it('enforces required and maximum option group sizes', () => {
    const missing = quoteCart(catalog, cart(line({ productId: IDS.steak })), noon);
    expect(codes(missing.lines[0]?.issues ?? [])).toEqual(['GROUP_MIN']);

    const ok = quoteCart(catalog, cart(line({ productId: IDS.steak, optionIds: [IDS.optRare] })), noon);
    expect(ok.lines[0]?.issues).toEqual([]);

    const tooMany = quoteCart(
      catalog,
      cart(line({ productId: IDS.steak, optionIds: [IDS.optRare, IDS.optWell] })),
      noon,
    );
    expect(codes(tooMany.lines[0]?.issues ?? [])).toEqual(['GROUP_MAX']);
  });

  it('rejects options and variants that belong to another product', () => {
    const quote = quoteCart(
      catalog,
      cart(line({ productId: IDS.fries, optionIds: [IDS.optCheese], variantId: IDS.varLarge })),
      noon,
    );
    expect(codes(quote.lines[0]?.issues ?? []).sort()).toEqual(['UNKNOWN_OPTION', 'UNKNOWN_VARIANT']);
  });

  it('flags an unavailable option', () => {
    const patched = {
      ...catalog,
      products: catalog.products.map((p) =>
        p.id === IDS.burger
          ? {
              ...p,
              groups: p.groups.map((g) => ({
                ...g,
                options: g.options.map((o) => (o.id === IDS.optCheese ? { ...o, isAvailable: false } : o)),
              })),
            }
          : p,
      ),
    };
    const quote = quoteCart(patched, cart(line({ productId: IDS.burger, optionIds: [IDS.optCheese] })), noon);
    expect(codes(quote.lines[0]?.issues ?? [])).toEqual(['OPTION_UNAVAILABLE']);
  });

  it('rejects bad quantities', () => {
    for (const quantity of [0, -1, 21, 1.5, Number.NaN]) {
      const quote = quoteCart(catalog, cart(line({ productId: IDS.fries, quantity })), noon);
      expect(codes(quote.lines[0]?.issues ?? [])).toContain('BAD_QUANTITY');
      expect(quote.lines[0]?.lineTotal).toBe(0);
      expect(quote.subtotal).toBe(0);
    }
  });
});

describe('quoteCart: price floor', () => {
  it('clamps a negative price delta so totals never go below zero', () => {
    const cheap = product({
      id: 'p-cheap',
      basePrice: 100,
      groups: [
        {
          id: 'g-discount',
          productId: 'p-cheap',
          minSelect: 0,
          maxSelect: 1,
          translations: { en: { name: 'Oops' } },
          options: [
            {
              id: 'o-discount',
              groupId: 'g-discount',
              priceDelta: -500,
              costDelta: null,
              isSuggested: false,
              suggestPriority: 0,
              isAvailable: true,
              translations: { en: { name: 'Mistyped discount' } },
            },
          ],
        },
      ],
    });
    const quote = quoteCart(
      makeCatalog({ products: [cheap] }),
      cart(line({ productId: 'p-cheap', optionIds: ['o-discount'], quantity: 3 })),
      noon,
    );
    expect(quote.lines[0]?.unitPrice).toBe(0);
    expect(quote.subtotal).toBeGreaterThanOrEqual(0);
  });

  it('clamps a zero-priced product to a zero total, not an error', () => {
    const free = product({ id: 'p-free', basePrice: 0 });
    const quote = quoteCart(makeCatalog({ products: [free] }), cart(line({ productId: 'p-free' })), noon);
    expect(quote.subtotal).toBe(0);
    expect(quote.lines[0]?.issues).toEqual([]);
  });
});

describe('quoteCart: bundles', () => {
  it('prices a bundle at its bundle price and reports the real saving', () => {
    const quote = quoteCart(catalog, { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 2 }] }, noon);
    const bundle = quote.bundles[0];
    expect(bundle?.unitPrice).toBe(1500);
    expect(bundle?.individualTotal).toBe(900 + 550 + 300);
    expect(bundle?.savings).toBe(250);
    expect(bundle?.lineTotal).toBe(3000);
    expect(quote.subtotal).toBe(3000);
  });

  it('respects bundle dayparts', () => {
    const request = { lines: [], bundles: [{ bundleId: 'b-breakfast', quantity: 1 }] };
    expect(quoteCart(catalog, request, morning).bundles[0]?.issues).toEqual([]);
    expect(codes(quoteCart(catalog, request, noon).bundles[0]?.issues ?? [])).toEqual(['OUT_OF_DAYPART']);
  });

  it('flags a bundle whose item became unavailable', () => {
    const patched = withProduct(catalog, IDS.fries, { isAvailable: false });
    const quote = quoteCart(patched, { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }] }, noon);
    expect(codes(quote.bundles[0]?.issues ?? [])).toEqual(['UNAVAILABLE']);
    expect(quote.subtotal).toBe(0);
  });

  it('flags an unknown bundle', () => {
    const quote = quoteCart(catalog, { lines: [], bundles: [{ bundleId: 'nope', quantity: 1 }] }, noon);
    expect(codes(quote.bundles[0]?.issues ?? [])).toEqual(['UNKNOWN_BUNDLE']);
  });
});
```

- [ ] **Step 3: Write the failing cart helper test**

`tests/lib/cart.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addLine,
  EMPTY_CART,
  isEmpty,
  itemCount,
  lineKey,
  removeLine,
  setBundleQuantity,
  setLineQuantity,
} from '@/lib/cart';

const burger = { productId: 'burger', variantId: null, optionIds: ['b', 'a'], quantity: 1 };

describe('cart helpers', () => {
  it('builds an order-independent line key', () => {
    expect(lineKey({ ...burger, optionIds: ['a', 'b'] })).toBe(lineKey(burger));
    expect(lineKey({ ...burger, optionIds: [] })).not.toBe(lineKey(burger));
  });

  it('merges identical lines by increasing quantity', () => {
    const once = addLine(EMPTY_CART, burger);
    const twice = addLine(once, { ...burger, optionIds: ['a', 'b'] });
    expect(twice.lines).toHaveLength(1);
    expect(twice.lines[0]?.quantity).toBe(2);
  });

  it('caps quantity at the maximum', () => {
    let cart = EMPTY_CART;
    for (let i = 0; i < 30; i += 1) cart = addLine(cart, burger);
    expect(cart.lines[0]?.quantity).toBe(20);
  });

  it('sets, removes and counts', () => {
    let cart = addLine(EMPTY_CART, burger);
    cart = addLine(cart, { productId: 'fries', variantId: null, optionIds: [], quantity: 2 });
    expect(itemCount(cart)).toBe(3);
    cart = setLineQuantity(cart, lineKey(burger), 5);
    expect(itemCount(cart)).toBe(7);
    cart = setLineQuantity(cart, lineKey(burger), 0);
    expect(cart.lines).toHaveLength(1);
    cart = removeLine(cart, lineKey({ productId: 'fries', variantId: null, optionIds: [], quantity: 1 }));
    expect(isEmpty(cart)).toBe(true);
  });

  it('tracks bundles and removes them at zero', () => {
    let cart = setBundleQuantity(EMPTY_CART, 'b1', 2);
    expect(itemCount(cart)).toBe(2);
    cart = setBundleQuantity(cart, 'b1', 0);
    expect(cart.bundles).toEqual([]);
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze({ lines: Object.freeze([]) as never, bundles: Object.freeze([]) as never });
    expect(() => addLine(frozen, burger)).not.toThrow();
  });
});
```

- [ ] **Step 4: Run both to confirm they fail**

Run: `npx vitest run tests/domain/pricing.test.ts tests/lib/cart.test.ts`
Expected: FAIL, modules `@/server/domain/pricing` and `@/lib/cart` not found.

- [ ] **Step 5: Implement `src/server/domain/catalog.ts`**

```ts
import { currentDaypart } from './schedule';
import type { Catalog, CatalogProduct, Daypart } from './types';

export type Orderability = 'OK' | 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'OUT_OF_DAYPART';

export function productMap(catalog: Catalog): Map<string, CatalogProduct> {
  return new Map(catalog.products.map((product) => [product.id, product]));
}

export function daypartNow(catalog: Catalog, now: Date): Daypart | null {
  return currentDaypart(now, catalog.schedule, catalog.timeZone);
}

/** An empty `dayparts` list means "all day". */
export function inDaypart(dayparts: readonly Daypart[], current: Daypart | null): boolean {
  return dayparts.length === 0 || (current !== null && dayparts.includes(current));
}

export function orderability(product: CatalogProduct, current: Daypart | null): Orderability {
  if (!product.isAvailable) return 'UNAVAILABLE';
  if (product.stockCount !== null && product.stockCount <= 0) return 'OUT_OF_STOCK';
  if (product.hideOutsideDaypart && !inDaypart(product.dayparts, current)) return 'OUT_OF_DAYPART';
  return 'OK';
}

export function defaultVariant(product: CatalogProduct) {
  return product.variants.find((variant) => variant.isDefault) ?? null;
}

export function marginRatio(price: number, cost: number | null): number {
  if (cost === null || price <= 0) return 0.5; // unknown cost is neutral, never guessed
  return Math.min(1, Math.max(0, (price - cost) / price));
}

function addCost(total: number | null, delta: number | null, priceDelta: number): number | null {
  if (total === null) return null;
  if (delta !== null) return total + delta;
  return priceDelta === 0 ? total : null;
}

export function unitPrice(
  product: CatalogProduct,
  variantId: string | null,
  optionIds: readonly string[],
): { price: number; cost: number | null } {
  const variant = variantId
    ? (product.variants.find((candidate) => candidate.id === variantId) ?? null)
    : defaultVariant(product);
  let price = product.basePrice;
  let cost: number | null = product.cost;
  if (variant) {
    price += variant.priceDelta;
    cost = addCost(cost, variant.costDelta, variant.priceDelta);
  }
  const chosen = new Set(optionIds);
  for (const group of product.groups) {
    for (const option of group.options) {
      if (!chosen.has(option.id)) continue;
      price += option.priceDelta;
      cost = addCost(cost, option.costDelta, option.priceDelta);
    }
  }
  return { price: Math.max(0, price), cost };
}
```

- [ ] **Step 6: Implement `src/server/domain/pricing.ts`**

```ts
import { daypartNow, inDaypart, orderability, productMap, unitPrice } from './catalog';
import {
  MAX_QUANTITY,
  type Bundle,
  type CartBundleInput,
  type CartInput,
  type CartLineInput,
  type Catalog,
  type CatalogProduct,
  type Daypart,
} from './types';

export type QuoteIssueCode =
  | 'UNKNOWN_PRODUCT'
  | 'UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'OUT_OF_DAYPART'
  | 'UNKNOWN_VARIANT'
  | 'UNKNOWN_OPTION'
  | 'OPTION_UNAVAILABLE'
  | 'GROUP_MIN'
  | 'GROUP_MAX'
  | 'BAD_QUANTITY'
  | 'UNKNOWN_BUNDLE';

export interface QuoteIssue {
  code: QuoteIssueCode;
  productId?: string;
  optionId?: string;
  groupId?: string;
  bundleId?: string;
}

export interface QuoteLine {
  index: number;
  productId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  issues: QuoteIssue[];
}

export interface QuoteBundleLine {
  index: number;
  bundleId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  individualTotal: number;
  savings: number;
  issues: QuoteIssue[];
}

export interface Quote {
  currency: string;
  lines: QuoteLine[];
  bundles: QuoteBundleLine[];
  subtotal: number;
  charges: never[];
  hasBlockingIssues: boolean;
}

function validQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY;
}

function quoteLine(
  products: Map<string, CatalogProduct>,
  current: Daypart | null,
  input: CartLineInput,
  index: number,
): QuoteLine {
  const optionIds = [...new Set(input.optionIds)];
  const base = {
    index,
    productId: input.productId,
    variantId: input.variantId,
    optionIds,
    quantity: input.quantity,
  };
  const product = products.get(input.productId);
  if (!product) {
    return { ...base, unitPrice: 0, lineTotal: 0, issues: [{ code: 'UNKNOWN_PRODUCT', productId: input.productId }] };
  }

  const issues: QuoteIssue[] = [];
  const productId = product.id;
  const quantityOk = validQuantity(input.quantity);
  if (!quantityOk) issues.push({ code: 'BAD_QUANTITY', productId });

  const state = orderability(product, current);
  if (state !== 'OK') issues.push({ code: state, productId });

  if (input.variantId !== null && !product.variants.some((variant) => variant.id === input.variantId)) {
    issues.push({ code: 'UNKNOWN_VARIANT', productId });
  }

  const known = new Map(
    product.groups.flatMap((group) => group.options.map((option) => [option.id, { group, option }] as const)),
  );
  const perGroup = new Map<string, number>();
  const validOptionIds: string[] = [];
  for (const optionId of optionIds) {
    const hit = known.get(optionId);
    if (!hit) {
      issues.push({ code: 'UNKNOWN_OPTION', productId, optionId });
      continue;
    }
    validOptionIds.push(optionId);
    if (!hit.option.isAvailable) issues.push({ code: 'OPTION_UNAVAILABLE', productId, optionId });
    perGroup.set(hit.group.id, (perGroup.get(hit.group.id) ?? 0) + 1);
  }
  for (const group of product.groups) {
    const picked = perGroup.get(group.id) ?? 0;
    if (picked < group.minSelect) issues.push({ code: 'GROUP_MIN', productId, groupId: group.id });
    if (picked > group.maxSelect) issues.push({ code: 'GROUP_MAX', productId, groupId: group.id });
  }

  const price = unitPrice(product, input.variantId, validOptionIds).price;
  const lineTotal = issues.length === 0 && quantityOk ? price * input.quantity : 0;
  return { ...base, unitPrice: price, lineTotal, issues };
}

function bundleIndividualTotal(bundle: Bundle, products: Map<string, CatalogProduct>): number | null {
  let total = 0;
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return null;
    total += unitPrice(product, item.variantId, []).price * item.quantity;
  }
  return total;
}

function quoteBundle(
  bundles: Map<string, Bundle>,
  products: Map<string, CatalogProduct>,
  current: Daypart | null,
  input: CartBundleInput,
  index: number,
): QuoteBundleLine {
  const empty = {
    index,
    bundleId: input.bundleId,
    quantity: input.quantity,
    unitPrice: 0,
    lineTotal: 0,
    individualTotal: 0,
    savings: 0,
  };
  const bundle = bundles.get(input.bundleId);
  if (!bundle) return { ...empty, issues: [{ code: 'UNKNOWN_BUNDLE', bundleId: input.bundleId }] };

  const issues: QuoteIssue[] = [];
  const quantityOk = validQuantity(input.quantity);
  if (!quantityOk) issues.push({ code: 'BAD_QUANTITY', bundleId: bundle.id });
  if (!inDaypart(bundle.dayparts, current)) issues.push({ code: 'OUT_OF_DAYPART', bundleId: bundle.id });

  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) {
      issues.push({ code: 'UNKNOWN_PRODUCT', bundleId: bundle.id, productId: item.productId });
      continue;
    }
    const state = orderability(product, current);
    if (state !== 'OK') issues.push({ code: state, bundleId: bundle.id, productId: product.id });
  }

  const individualTotal = bundleIndividualTotal(bundle, products) ?? 0;
  const savings = Math.max(0, individualTotal - bundle.price);
  return {
    index,
    bundleId: bundle.id,
    quantity: input.quantity,
    unitPrice: bundle.price,
    lineTotal: issues.length === 0 && quantityOk ? bundle.price * input.quantity : 0,
    individualTotal,
    savings,
    issues,
  };
}

export function quoteCart(catalog: Catalog, cart: CartInput, now: Date): Quote {
  const products = productMap(catalog);
  const bundleById = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));
  const current = daypartNow(catalog, now);

  const lines = cart.lines.map((input, index) => quoteLine(products, current, input, index));
  const bundles = cart.bundles.map((input, index) => quoteBundle(bundleById, products, current, input, index));
  const subtotal =
    lines.reduce((sum, line) => sum + line.lineTotal, 0) + bundles.reduce((sum, line) => sum + line.lineTotal, 0);
  const hasBlockingIssues = lines.some((l) => l.issues.length > 0) || bundles.some((b) => b.issues.length > 0);

  return { currency: catalog.currency, lines, bundles, subtotal, charges: [], hasBlockingIssues };
}
```

- [ ] **Step 7: Implement `src/lib/cart.ts`**

```ts
import type { CartBundleInput, CartInput, CartLineInput } from '@/server/domain/types';
import { MAX_QUANTITY } from '@/server/domain/types';

export const EMPTY_CART: CartInput = { lines: [], bundles: [] };

export function lineKey(line: Pick<CartLineInput, 'productId' | 'variantId' | 'optionIds'>): string {
  return [line.productId, line.variantId ?? '', [...line.optionIds].sort().join(',')].join('|');
}

const clamp = (quantity: number) => Math.min(MAX_QUANTITY, Math.max(0, Math.floor(quantity)));

export function addLine(cart: CartInput, line: CartLineInput): CartInput {
  const key = lineKey(line);
  const existing = cart.lines.find((candidate) => lineKey(candidate) === key);
  if (!existing) {
    return { ...cart, lines: [...cart.lines, { ...line, optionIds: [...line.optionIds], quantity: clamp(line.quantity) }] };
  }
  return {
    ...cart,
    lines: cart.lines.map((candidate) =>
      candidate === existing ? { ...candidate, quantity: clamp(candidate.quantity + line.quantity) } : candidate,
    ),
  };
}

export function setLineQuantity(cart: CartInput, key: string, quantity: number): CartInput {
  const next = clamp(quantity);
  if (next === 0) return removeLine(cart, key);
  return {
    ...cart,
    lines: cart.lines.map((line) => (lineKey(line) === key ? { ...line, quantity: next } : line)),
  };
}

export function removeLine(cart: CartInput, key: string): CartInput {
  return { ...cart, lines: cart.lines.filter((line) => lineKey(line) !== key) };
}

export function setBundleQuantity(cart: CartInput, bundleId: string, quantity: number): CartInput {
  const next = clamp(quantity);
  const others: CartBundleInput[] = cart.bundles.filter((bundle) => bundle.bundleId !== bundleId);
  return { ...cart, bundles: next === 0 ? others : [...others, { bundleId, quantity: next }] };
}

export function itemCount(cart: CartInput): number {
  return (
    cart.lines.reduce((sum, line) => sum + line.quantity, 0) +
    cart.bundles.reduce((sum, bundle) => sum + bundle.quantity, 0)
  );
}

export function isEmpty(cart: CartInput): boolean {
  return cart.lines.length === 0 && cart.bundles.length === 0;
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/domain tests/lib`
Expected: PASS for pricing (all cases) and cart helpers.

- [ ] **Step 9: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src tests
git commit -m "feat(domain): server-authoritative cart quote and client cart helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Upsell engine

**Files:**
- Create: `src/server/domain/upsell.ts`
- Test: `tests/domain/upsell.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `Locale`, `EngineConfig`, `productMap`, `daypartNow`, `inDaypart`, `orderability`, `unitPrice`, `defaultVariant`, `marginRatio`, `resolveText`.
- Produces: `UpsellKind = 'OPTION' | 'VARIANT' | 'SWAP'`, `UpsellOffer { suggestionId: string; kind: UpsellKind; refId: string; title: string; effect: string | null; priceDelta: number; resultingTotal: number; score: number; reasons: string[] }`, `UpsellInput { catalog: Catalog; productId: string; variantId: string | null; optionIds: string[]; now: Date; locale: Locale; config: EngineConfig }`, `suggestUpsells(input: UpsellInput): UpsellOffer[]`.

- [ ] **Step 1: Write the failing test**

`tests/domain/upsell.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from '@/server/domain/config';
import { suggestUpsells } from '@/server/domain/upsell';
import { at, IDS, makeCatalog, product, withProduct } from './fixtures';

const noon = at(12);

function run(overrides: Partial<Parameters<typeof suggestUpsells>[0]> = {}) {
  return suggestUpsells({
    catalog: makeCatalog(),
    productId: IDS.burger,
    variantId: null,
    optionIds: [],
    now: noon,
    locale: 'en',
    config: DEFAULT_ENGINE_CONFIG,
    ...overrides,
  });
}

describe('suggestUpsells', () => {
  it('offers the burger upgrades ranked by score with exact price effects', () => {
    const offers = run();
    expect(offers.map((o) => o.refId)).toEqual([IDS.optDouble, IDS.optCheese, IDS.wagyu]);
    expect(offers[0]).toMatchObject({ kind: 'OPTION', priceDelta: 300, resultingTotal: 1200, title: 'Double patty' });
    expect(offers[0]?.effect).toBe('A second 140 g beef patty');
    expect(offers[2]).toMatchObject({ kind: 'SWAP', priceDelta: 400, resultingTotal: 1300 });
    expect(offers[2]?.title).toBe('Wagyu burger');
  });

  it('gives every offer a stable id and explanatory reasons', () => {
    const offers = run();
    expect(offers[0]?.suggestionId).toBe(`up:${IDS.burger}:OPTION:${IDS.optDouble}`);
    expect(offers.every((o) => o.reasons.length > 0)).toBe(true);
    expect(run()).toEqual(offers);
  });

  it('does not re-offer what is already selected', () => {
    const offers = run({ optionIds: [IDS.optCheese] });
    expect(offers.map((o) => o.refId)).toEqual([IDS.optDouble, IDS.wagyu]);
    expect(offers[0]?.resultingTotal).toBe(1300);
  });

  it('stops offering options once the group is full and drops a swap with no price increase', () => {
    expect(run({ optionIds: [IDS.optCheese, IDS.optDouble] })).toEqual([]);
  });

  it('never offers options that are not flagged as suggested or are unavailable', () => {
    expect(run().some((o) => o.refId === IDS.optBacon)).toBe(false);
    const patched = {
      ...makeCatalog(),
      products: makeCatalog().products.map((p) =>
        p.id === IDS.burger
          ? {
              ...p,
              groups: p.groups.map((g) => ({
                ...g,
                options: g.options.map((o) => (o.id === IDS.optCheese ? { ...o, isAvailable: false } : o)),
              })),
            }
          : p,
      ),
    };
    expect(run({ catalog: patched }).some((o) => o.refId === IDS.optCheese)).toBe(false);
  });

  it('applies the delta cap relative to the current price', () => {
    const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, upsellDeltaCapRatio: 0.2 };
    expect(run({ config }).map((o) => o.refId)).toEqual([IDS.optCheese]);
  });

  it('offers at most one product swap, choosing the stronger rule', () => {
    const base = makeCatalog();
    const catalog = {
      ...base,
      products: [...base.products, product({ id: 'p-wagyu2', basePrice: 1200, cost: 500, popularity: 50, slot: 'MAIN' })],
      upsellRules: [
        ...base.upsellRules,
        {
          id: 'u-wagyu2',
          sourceProductId: IDS.burger,
          targetProductId: 'p-wagyu2',
          priority: 60,
          dayparts: [],
          translations: { en: { pitch: 'Other burger' } },
        },
      ],
    };
    const swaps = run({ catalog }).filter((o) => o.kind === 'SWAP');
    expect(swaps).toHaveLength(1);
    expect(swaps[0]?.refId).toBe(IDS.wagyu);
  });

  it('respects the maximum number of offers', () => {
    const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, upsellMaxOffers: 1 };
    expect(run({ config })).toHaveLength(1);
  });

  it('skips a swap whose target is unavailable or outside its dayparts', () => {
    const off = withProduct(makeCatalog(), IDS.wagyu, { isAvailable: false });
    expect(run({ catalog: off }).some((o) => o.kind === 'SWAP')).toBe(false);
    const dinnerOnly = withProduct(makeCatalog(), IDS.wagyu, { dayparts: ['DINNER'] });
    expect(run({ catalog: dinnerOnly }).some((o) => o.kind === 'SWAP')).toBe(false);
    expect(run({ catalog: dinnerOnly, now: at(19) }).some((o) => o.kind === 'SWAP')).toBe(true);
  });

  it('offers a larger variant with its delta, and nothing once it is chosen', () => {
    const offers = run({ productId: IDS.coldBrew });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ kind: 'VARIANT', refId: IDS.varLarge, priceDelta: 150, resultingTotal: 650 });
    expect(run({ productId: IDS.coldBrew, variantId: IDS.varLarge })).toEqual([]);
  });

  it('returns nothing for an unknown or unavailable product', () => {
    expect(run({ productId: 'nope' })).toEqual([]);
    expect(run({ catalog: withProduct(makeCatalog(), IDS.burger, { isAvailable: false }) })).toEqual([]);
  });

  it('falls back to English text when the locale has no translation', () => {
    expect(run({ locale: 'ar' })[0]?.title).toBe('Double patty');
  });

  it('never recommends a high-margin product that has no relationship to the selection', () => {
    const catalog = makeCatalog();
    for (const p of catalog.products) {
      const offers = run({ catalog, productId: p.id });
      expect(offers.some((o) => o.refId === IDS.caviar)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/domain/upsell.test.ts`
Expected: FAIL, cannot find `@/server/domain/upsell`.

- [ ] **Step 3: Implement `src/server/domain/upsell.ts`**

```ts
import { daypartNow, defaultVariant, inDaypart, marginRatio, orderability, productMap, unitPrice } from './catalog';
import type { EngineConfig } from './config';
import { resolveText } from './translate';
import type { Catalog, Locale, TranslationMap } from './types';

export type UpsellKind = 'OPTION' | 'VARIANT' | 'SWAP';

export interface UpsellOffer {
  suggestionId: string;
  kind: UpsellKind;
  refId: string;
  title: string;
  effect: string | null;
  priceDelta: number;
  resultingTotal: number;
  score: number;
  reasons: string[];
}

export interface UpsellInput {
  catalog: Catalog;
  productId: string;
  variantId: string | null;
  optionIds: string[];
  now: Date;
  locale: Locale;
  config: EngineConfig;
}

interface Candidate {
  kind: UpsellKind;
  refId: string;
  title: string;
  effect: string | null;
  priceDelta: number;
  costDelta: number | null;
  rulePriority: number;
  popularity: number;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function deltaMargin(priceDelta: number, costDelta: number | null): number {
  if (costDelta === null || priceDelta <= 0) return 0.5;
  return Math.min(1, Math.max(0, (priceDelta - costDelta) / priceDelta));
}

export function suggestUpsells(input: UpsellInput): UpsellOffer[] {
  const { catalog, now, locale, config } = input;
  const products = productMap(catalog);
  const product = products.get(input.productId);
  if (!product) return [];
  const current = daypartNow(catalog, now);
  if (orderability(product, current) !== 'OK') return [];

  const text = (map: TranslationMap, field: string) => resolveText(map, field, locale, catalog.defaultLocale);
  const chosen = new Set(input.optionIds);
  const base = unitPrice(product, input.variantId, input.optionIds);
  const cap = Math.round(base.price * config.upsellDeltaCapRatio);
  const candidates: Candidate[] = [];

  for (const group of product.groups) {
    const picked = group.options.filter((option) => chosen.has(option.id)).length;
    if (picked >= group.maxSelect) continue;
    for (const option of group.options) {
      if (!option.isSuggested || !option.isAvailable || chosen.has(option.id)) continue;
      candidates.push({
        kind: 'OPTION',
        refId: option.id,
        title: text(option.translations, 'name'),
        effect: text(option.translations, 'effect') || null,
        priceDelta: option.priceDelta,
        costDelta: option.costDelta,
        rulePriority: option.suggestPriority,
        popularity: product.popularity,
      });
    }
  }

  const currentVariant =
    (input.variantId ? product.variants.find((variant) => variant.id === input.variantId) : defaultVariant(product)) ??
    null;
  const currentDelta = currentVariant?.priceDelta ?? 0;
  for (const variant of product.variants) {
    if (variant.id === currentVariant?.id || variant.priceDelta <= currentDelta) continue;
    const currentCost = currentVariant ? currentVariant.costDelta : 0;
    candidates.push({
      kind: 'VARIANT',
      refId: variant.id,
      title: text(variant.translations, 'name'),
      effect: null,
      priceDelta: variant.priceDelta - currentDelta,
      costDelta: variant.costDelta !== null && currentCost !== null ? variant.costDelta - currentCost : null,
      rulePriority: 50,
      popularity: product.popularity,
    });
  }

  for (const rule of catalog.upsellRules) {
    if (rule.sourceProductId !== product.id || !inDaypart(rule.dayparts, current)) continue;
    const target = products.get(rule.targetProductId);
    if (!target || orderability(target, current) !== 'OK' || !inDaypart(target.dayparts, current)) continue;
    const targetPrice = unitPrice(target, null, []);
    candidates.push({
      kind: 'SWAP',
      refId: target.id,
      title: text(rule.translations, 'pitch') || text(target.translations, 'name'),
      effect: text(rule.translations, 'effect') || null,
      priceDelta: targetPrice.price - base.price,
      costDelta: targetPrice.cost !== null && base.cost !== null ? targetPrice.cost - base.cost : null,
      rulePriority: rule.priority,
      popularity: target.popularity,
    });
  }

  const w = config.weights;
  const offers = candidates
    .filter((candidate) => candidate.priceDelta > 0 && candidate.priceDelta <= cap)
    .map<UpsellOffer>((candidate) => {
      const margin = deltaMargin(candidate.priceDelta, candidate.costDelta);
      const score =
        w.rulePriority * (candidate.rulePriority / 100) + w.margin * margin + w.popularity * (candidate.popularity / 100);
      return {
        suggestionId: `up:${product.id}:${candidate.kind}:${candidate.refId}`,
        kind: candidate.kind,
        refId: candidate.refId,
        title: candidate.title,
        effect: candidate.effect,
        priceDelta: candidate.priceDelta,
        resultingTotal: base.price + candidate.priceDelta,
        score: round4(score),
        reasons: [
          `rule priority ${candidate.rulePriority}`,
          `delta margin ${Math.round(margin * 100)}%`,
          `popularity ${candidate.popularity}`,
        ],
      };
    })
    .sort((a, b) => b.score - a.score || a.suggestionId.localeCompare(b.suggestionId));

  const result: UpsellOffer[] = [];
  let swaps = 0;
  for (const offer of offers) {
    if (result.length >= config.upsellMaxOffers) break;
    if (offer.kind === 'SWAP') {
      if (swaps >= 1) continue;
      swaps += 1;
    }
    result.push(offer);
  }
  return result;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/domain/upsell.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src/server/domain/upsell.ts tests/domain/upsell.test.ts
git commit -m "feat(domain): relevance-gated upsell engine" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Perfect Pairing cross-sell and promotion scoring

**Files:**
- Create: `src/server/domain/pairing.ts`, `src/server/domain/promotion.ts`
- Test: `tests/domain/pairing.test.ts`, `tests/domain/promotion.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CartInput`, `Locale`, `EngineConfig`, catalog helpers, `resolveText`.
- Produces from `pairing.ts`: `PairingInput { catalog; cart: CartInput; dismissedIds: readonly string[]; now: Date; locale: Locale; config: EngineConfig; maxOffers?: number }`, `PairingOffer { suggestionId: string; productId: string; reason: string; score: number; reasons: string[] }`, `suggestPairings(input): PairingOffer[]`.
- Produces from `promotion.ts`: `PromotionResult { productId: string; eligible: boolean; score: number; reasons: string[] }`, `scoreProducts(catalog, now, config): PromotionResult[]`, `pickSignature(catalog, now, config): PromotionResult | null`.

- [ ] **Step 1: Write the failing pairing test**

`tests/domain/pairing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { suggestPairings, type PairingInput } from '@/server/domain/pairing';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const noon = at(12);
const line = (productId: string, quantity = 1): CartLineInput => ({ productId, variantId: null, optionIds: [], quantity });
const cartOf = (...ids: string[]): CartInput => ({ lines: ids.map((id) => line(id)), bundles: [] });

function run(overrides: Partial<PairingInput> = {}) {
  return suggestPairings({
    catalog: makeCatalog(),
    cart: cartOf(IDS.burger),
    dismissedIds: [],
    now: noon,
    locale: 'en',
    config: DEFAULT_ENGINE_CONFIG,
    ...overrides,
  });
}

describe('suggestPairings', () => {
  it('ranks the strongest relevant pairing first and explains it', () => {
    const offers = run();
    expect(offers.map((o) => o.productId)).toEqual([IDS.fries, IDS.sparkling]);
    expect(offers[0]?.reason).toBe('Crisp and salted, the classic partner');
    expect(offers[0]?.suggestionId).toBe(`pair:${IDS.fries}`);
  });

  it('returns nothing for an empty cart', () => {
    expect(run({ cart: { lines: [], bundles: [] } })).toEqual([]);
  });

  it('matches category rules against any product in the category', () => {
    const offers = run({ cart: cartOf(IDS.espresso), now: at(9) });
    expect(offers.map((o) => o.productId)).toEqual([IDS.croissant, IDS.cheesecake]);
  });

  it('skips targets outside their own dayparts', () => {
    const offers = run({ cart: cartOf(IDS.espresso), now: noon });
    expect(offers.map((o) => o.productId)).toEqual([IDS.cheesecake]);
  });

  it('does not suggest what is already in the cart, including inside a bundle', () => {
    expect(run({ cart: cartOf(IDS.burger, IDS.fries) }).map((o) => o.productId)).toEqual([IDS.sparkling]);
    const withBundle = run({ cart: { lines: [], bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }] } });
    expect(withBundle.map((o) => o.productId)).not.toContain(IDS.fries);
    expect(withBundle.map((o) => o.productId)).not.toContain(IDS.sparkling);
  });

  it('suppresses a suggestion whose slot is already filled', () => {
    const offers = run({ cart: cartOf(IDS.burger, IDS.espresso) });
    expect(offers.map((o) => o.productId)).not.toContain(IDS.sparkling); // DRINK slot filled by espresso
    expect(offers.map((o) => o.productId)).toContain(IDS.fries);
  });

  it('offers at most one product per slot', () => {
    const base = makeCatalog();
    const catalog = {
      ...base,
      pairingRules: [
        ...base.pairingRules,
        {
          id: 'r-burger-coldbrew',
          sourceType: 'PRODUCT' as const,
          sourceProductId: IDS.burger,
          sourceCategoryId: null,
          targetProductId: IDS.coldBrew,
          weight: 60,
          dayparts: [],
          translations: { en: { reason: 'Cold brew' } },
        },
      ],
    };
    const drinks = run({ catalog }).filter((o) => [IDS.sparkling, IDS.coldBrew].includes(o.productId));
    expect(drinks).toHaveLength(1);
    expect(drinks[0]?.productId).toBe(IDS.coldBrew);
  });

  it('skips dismissed suggestions', () => {
    const offers = run({ dismissedIds: [`pair:${IDS.fries}`] });
    expect(offers.map((o) => o.productId)).toEqual([IDS.sparkling]);
  });

  it('rewards a target supported by several cart items without letting it run away', () => {
    const single = run({ cart: cartOf(IDS.burger) }).find((o) => o.productId === IDS.fries);
    const double = run({ cart: cartOf(IDS.burger, IDS.steak) }).find((o) => o.productId === IDS.fries);
    expect(double?.score).toBeGreaterThan(single?.score ?? 0);
    expect((double?.score ?? 0) - (single?.score ?? 0)).toBeLessThan(0.3);
  });

  it('excludes unavailable targets and penalises low stock', () => {
    const gone = withProduct(makeCatalog(), IDS.fries, { isAvailable: false });
    expect(run({ catalog: gone }).map((o) => o.productId)).toEqual([IDS.sparkling]);

    const normal = run().find((o) => o.productId === IDS.fries);
    const low = withProduct(makeCatalog(), IDS.fries, { stockCount: 2, lowStockThreshold: 5 });
    const penalised = run({ catalog: low }).find((o) => o.productId === IDS.fries);
    expect(penalised?.score).toBeLessThan(normal?.score ?? 0);
  });

  it('never invents candidates from margin alone', () => {
    expect(run({ cart: cartOf(IDS.caviar) })).toEqual([]);
    for (const p of makeCatalog().products) {
      expect(run({ cart: cartOf(p.id) }).some((o) => o.productId === IDS.caviar)).toBe(false);
    }
  });

  it('respects the maximum number of offers', () => {
    expect(run({ maxOffers: 1 })).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Write the failing promotion test**

`tests/domain/promotion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { pickSignature, scoreProducts } from '@/server/domain/promotion';
import { at, IDS, makeCatalog, product, withProduct } from './fixtures';

const noon = at(12);
const morning = at(9);
const byId = (results: ReturnType<typeof scoreProducts>, id: string) => results.find((r) => r.productId === id);

describe('scoreProducts', () => {
  it('marks unavailable, sold-out and out-of-daypart products ineligible', () => {
    const catalog = makeCatalog({
      products: [
        product({ id: 'a', isAvailable: false }),
        product({ id: 'b', stockCount: 0 }),
        product({ id: 'c', dayparts: ['DINNER'] }),
        product({ id: 'd' }),
      ],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'a')?.eligible).toBe(false);
    expect(byId(results, 'b')?.eligible).toBe(false);
    expect(byId(results, 'c')?.eligible).toBe(false);
    expect(byId(results, 'd')?.eligible).toBe(true);
  });

  it('treats an unknown cost as neutral and says so', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'known', basePrice: 1000, cost: 500 }), product({ id: 'unknown', basePrice: 1000, cost: null })],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'unknown')?.score).toBe(byId(results, 'known')?.score);
    expect(byId(results, 'unknown')?.reasons.join(' ')).toMatch(/cost unknown/);
  });

  it('prefers higher margin when everything else is equal', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'low', basePrice: 1000, cost: 800 }), product({ id: 'high', basePrice: 1000, cost: 200 })],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(results[0]?.productId).toBe('high');
  });

  it('boosts a product whose daypart matches the current one', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'plain' }), product({ id: 'breakfast', dayparts: ['BREAKFAST'] })],
    });
    const results = scoreProducts(catalog, morning, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'breakfast')?.score).toBeGreaterThan(byId(results, 'plain')?.score ?? 0);
    expect(byId(results, 'breakfast')?.reasons.join(' ')).toMatch(/daypart/);
  });

  it('penalises low stock', () => {
    const catalog = makeCatalog({
      products: [product({ id: 'fine' }), product({ id: 'scarce', stockCount: 1, lowStockThreshold: 3 })],
    });
    const results = scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG);
    expect(byId(results, 'scarce')?.score).toBeLessThan(byId(results, 'fine')?.score ?? 0);
    expect(byId(results, 'scarce')?.reasons.join(' ')).toMatch(/low stock/);
  });

  it('breaks ties by product id', () => {
    const catalog = makeCatalog({ products: [product({ id: 'b' }), product({ id: 'a' })] });
    expect(scoreProducts(catalog, noon, DEFAULT_ENGINE_CONFIG).map((r) => r.productId)).toEqual(['a', 'b']);
  });
});

describe('pickSignature', () => {
  it('chooses the best eligible signature product', () => {
    let catalog = makeCatalog();
    catalog = withProduct(catalog, IDS.croissant, { isSignature: true });
    catalog = withProduct(catalog, IDS.cheesecake, { isSignature: true });
    expect(pickSignature(catalog, morning, DEFAULT_ENGINE_CONFIG)?.productId).toBe(IDS.croissant);
  });

  it('skips ineligible signatures and falls back to featured products', () => {
    let catalog = makeCatalog();
    catalog = withProduct(catalog, IDS.croissant, { isSignature: true, isAvailable: false });
    catalog = withProduct(catalog, IDS.fries, { isFeatured: true });
    expect(pickSignature(catalog, noon, DEFAULT_ENGINE_CONFIG)?.productId).toBe(IDS.fries);
  });

  it('returns null when nothing qualifies', () => {
    expect(pickSignature(makeCatalog(), noon, DEFAULT_ENGINE_CONFIG)).toBeNull();
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npx vitest run tests/domain/pairing.test.ts tests/domain/promotion.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/server/domain/promotion.ts`**

```ts
import { daypartNow, inDaypart, marginRatio, orderability } from './catalog';
import type { EngineConfig } from './config';
import type { Catalog } from './types';

export interface PromotionResult {
  productId: string;
  eligible: boolean;
  score: number;
  reasons: string[];
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function scoreProducts(catalog: Catalog, now: Date, config: EngineConfig): PromotionResult[] {
  const current = daypartNow(catalog, now);
  const w = config.weights;

  return catalog.products
    .map<PromotionResult>((product) => {
      const state = orderability(product, current);
      const dayOk = inDaypart(product.dayparts, current);
      const eligible = state === 'OK' && dayOk;
      const margin = marginRatio(product.basePrice, product.cost);
      const explicitDaypart = product.dayparts.length > 0 && current !== null && product.dayparts.includes(current);
      const lowStock =
        product.stockCount !== null && product.lowStockThreshold !== null && product.stockCount <= product.lowStockThreshold;

      const score =
        w.margin * margin +
        w.popularity * (product.popularity / 100) +
        w.priority * (product.priority / 100) +
        (explicitDaypart ? w.daypart : 0) -
        (lowStock ? w.stockPenalty : 0);

      const reasons = [
        product.cost === null ? 'cost unknown (neutral margin)' : `margin ${Math.round(margin * 100)}%`,
        `popularity ${product.popularity}`,
        `priority ${product.priority}`,
      ];
      if (explicitDaypart) reasons.push('matches current daypart');
      if (lowStock) reasons.push('low stock');
      if (state !== 'OK') reasons.push(`not orderable: ${state}`);
      else if (!dayOk) reasons.push('outside its dayparts');

      return { productId: product.id, eligible, score: round4(score), reasons };
    })
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId));
}

export function pickSignature(catalog: Catalog, now: Date, config: EngineConfig): PromotionResult | null {
  const ranked = scoreProducts(catalog, now, config).filter((result) => result.eligible);
  const byId = new Map(catalog.products.map((product) => [product.id, product]));
  const signature = ranked.find((result) => byId.get(result.productId)?.isSignature);
  if (signature) return signature;
  return ranked.find((result) => byId.get(result.productId)?.isFeatured) ?? null;
}
```

- [ ] **Step 5: Implement `src/server/domain/pairing.ts`**

```ts
import { daypartNow, inDaypart, marginRatio, orderability, productMap } from './catalog';
import type { EngineConfig } from './config';
import { resolveText } from './translate';
import type { CartInput, Catalog, CatalogProduct, Locale } from './types';

export interface PairingInput {
  catalog: Catalog;
  cart: CartInput;
  dismissedIds: readonly string[];
  now: Date;
  locale: Locale;
  config: EngineConfig;
  maxOffers?: number;
}

export interface PairingOffer {
  suggestionId: string;
  productId: string;
  reason: string;
  score: number;
  reasons: string[];
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

interface Contribution {
  value: number;
  reason: string;
  weight: number;
}

export function suggestPairings(input: PairingInput): PairingOffer[] {
  const { catalog, cart, now, locale, config } = input;
  const products = productMap(catalog);
  const current = daypartNow(catalog, now);
  const w = config.weights;

  const inCart = new Set<string>(cart.lines.map((line) => line.productId));
  for (const entry of cart.bundles) {
    const bundle = catalog.bundles.find((candidate) => candidate.id === entry.bundleId);
    for (const item of bundle?.items ?? []) inCart.add(item.productId);
  }
  const cartProducts = [...inCart]
    .map((id) => products.get(id))
    .filter((product): product is CatalogProduct => product !== undefined);
  if (cartProducts.length === 0) return [];

  const filledSlots = new Set(cartProducts.map((p) => p.slot).filter((slot): slot is string => slot !== null));
  const dismissed = new Set(input.dismissedIds);
  const contributions = new Map<string, Contribution[]>();

  for (const rule of catalog.pairingRules) {
    if (!inDaypart(rule.dayparts, current)) continue;
    const matches = cartProducts.filter((p) =>
      rule.sourceType === 'PRODUCT' ? p.id === rule.sourceProductId : p.categoryId === rule.sourceCategoryId,
    ).length;
    if (matches === 0) continue;

    const target = products.get(rule.targetProductId);
    if (!target || inCart.has(target.id)) continue;
    if (orderability(target, current) !== 'OK' || !inDaypart(target.dayparts, current)) continue;
    if (target.slot !== null && filledSlots.has(target.slot)) continue;
    if (dismissed.has(`pair:${target.id}`)) continue;

    const matchFactor = Math.min(1.5, 1 + 0.25 * (matches - 1));
    const entry: Contribution = {
      value: w.rulePriority * (rule.weight / 100) * matchFactor,
      reason: resolveText(rule.translations, 'reason', locale, catalog.defaultLocale),
      weight: rule.weight,
    };
    contributions.set(target.id, [...(contributions.get(target.id) ?? []), entry]);
  }

  const offers: Array<PairingOffer & { slot: string | null }> = [];
  for (const [targetId, entries] of contributions) {
    const target = products.get(targetId) as CatalogProduct;
    const sorted = [...entries].sort((a, b) => b.value - a.value);
    const rulePart = Math.min(
      w.rulePriority * 1.5,
      sorted.reduce((sum, entry, index) => sum + entry.value * 0.5 ** index, 0),
    );
    const lowStock =
      target.stockCount !== null && target.lowStockThreshold !== null && target.stockCount <= target.lowStockThreshold;
    const margin = marginRatio(target.basePrice, target.cost);
    const score =
      rulePart +
      w.margin * margin +
      w.popularity * (target.popularity / 100) +
      w.priority * (target.priority / 100) -
      (lowStock ? w.stockPenalty : 0);

    offers.push({
      suggestionId: `pair:${target.id}`,
      productId: target.id,
      reason: sorted[0]?.reason ?? '',
      score: round4(score),
      reasons: [
        `${sorted.length} matching rule${sorted.length === 1 ? '' : 's'}`,
        `top rule weight ${sorted[0]?.weight ?? 0}`,
        `margin ${Math.round(margin * 100)}%`,
        ...(lowStock ? ['low stock'] : []),
      ],
      slot: target.slot,
    });
  }

  offers.sort((a, b) => b.score - a.score || a.suggestionId.localeCompare(b.suggestionId));

  const limit = input.maxOffers ?? config.pairingMaxOffers;
  const usedSlots = new Set<string>();
  const result: PairingOffer[] = [];
  for (const offer of offers) {
    if (result.length >= limit) break;
    if (offer.slot !== null) {
      if (usedSlots.has(offer.slot)) continue;
      usedSlots.add(offer.slot);
    }
    const { slot: _slot, ...clean } = offer;
    result.push(clean);
  }
  return result;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/domain/pairing.test.ts tests/domain/promotion.test.ts`
Expected: PASS, 13 pairing tests and 9 promotion tests. If `const { slot: _slot, ...clean }` trips the unused-variable lint rule, replace it with an explicit object literal of the five `PairingOffer` fields.

- [ ] **Step 7: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src/server/domain/pairing.ts src/server/domain/promotion.ts tests/domain
git commit -m "feat(domain): Perfect Pairing cross-sell and promotion scoring" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Bundles and suggestion assembly

**Files:**
- Create: `src/server/domain/bundles.ts`, `src/server/domain/suggestions.ts`, `src/server/domain/index.ts`
- Test: `tests/domain/bundles.test.ts`, `tests/domain/suggestions.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4 to 7.
- Produces from `bundles.ts`: `BundleComparison { bundleId; individualTotal; bundlePrice; savings; isDeal }`, `compareBundle(catalog, bundle): BundleComparison | null`, `BundleOpportunity { suggestionId: string; bundleId: string; times: number; individualTotal: number; bundlePrice: number; savings: number }`, `detectBundleOpportunities(catalog, cart, now): BundleOpportunity[]`, `applyBundle(cart, catalog, bundleId, times): CartInput`.
- Produces from `suggestions.ts`: `SuggestionsRequest`, `SignaturePick`, `SuggestionsResponse`, `buildSuggestions(catalog, request, now, config): SuggestionsResponse`.
- Produces from `index.ts`: re-exports the whole domain surface.

- [ ] **Step 1: Write the failing bundles test**

`tests/domain/bundles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyBundle, compareBundle, detectBundleOpportunities } from '@/server/domain/bundles';
import { quoteCart } from '@/server/domain/pricing';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const catalog = makeCatalog();
const noon = at(12);
const line = (productId: string, quantity = 1, optionIds: string[] = []): CartLineInput => ({
  productId,
  variantId: null,
  optionIds,
  quantity,
});

describe('compareBundle', () => {
  it('reports the real saving against the live sum of items', () => {
    const bundle = catalog.bundles.find((b) => b.id === 'b-burger-meal')!;
    expect(compareBundle(catalog, bundle)).toEqual({
      bundleId: 'b-burger-meal',
      individualTotal: 1750,
      bundlePrice: 1500,
      savings: 250,
      isDeal: true,
    });
  });

  it('does not call a bundle a deal when it saves nothing', () => {
    const bundle = catalog.bundles.find((b) => b.id === 'b-not-a-deal')!;
    expect(compareBundle(catalog, bundle)).toMatchObject({ savings: 0, isDeal: false });
  });

  it('follows current prices, not stored ones', () => {
    const pricier = withProduct(catalog, IDS.fries, { basePrice: 800 });
    const bundle = pricier.bundles.find((b) => b.id === 'b-burger-meal')!;
    expect(compareBundle(pricier, bundle)?.savings).toBe(500);
  });

  it('returns null when an item no longer exists', () => {
    const broken = { ...catalog, products: catalog.products.filter((p) => p.id !== IDS.fries) };
    expect(compareBundle(broken, broken.bundles.find((b) => b.id === 'b-burger-meal')!)).toBeNull();
  });
});

describe('detectBundleOpportunities', () => {
  it('finds a complete set and totals the saving', () => {
    const cart: CartInput = { lines: [line(IDS.burger), line(IDS.fries), line(IDS.sparkling)], bundles: [] };
    const found = detectBundleOpportunities(catalog, cart, noon);
    expect(found).toEqual([
      {
        suggestionId: 'bundle:b-burger-meal',
        bundleId: 'b-burger-meal',
        times: 1,
        individualTotal: 1750,
        bundlePrice: 1500,
        savings: 250,
      },
    ]);
  });

  it('multiplies by how many full sets the cart contains', () => {
    const cart: CartInput = { lines: [line(IDS.burger, 2), line(IDS.fries, 2), line(IDS.sparkling, 3)], bundles: [] };
    const found = detectBundleOpportunities(catalog, cart, noon)[0];
    expect(found?.times).toBe(2);
    expect(found?.savings).toBe(500);
  });

  it('needs every item and ignores lines with customisations', () => {
    expect(detectBundleOpportunities(catalog, { lines: [line(IDS.burger), line(IDS.fries)], bundles: [] }, noon)).toEqual([]);
    const customised: CartInput = {
      lines: [line(IDS.burger, 1, [IDS.optCheese]), line(IDS.fries), line(IDS.sparkling)],
      bundles: [],
    };
    expect(detectBundleOpportunities(catalog, customised, noon)).toEqual([]);
  });

  it('never suggests a bundle that is not a real deal', () => {
    const cart: CartInput = { lines: [line(IDS.burger), line(IDS.fries)], bundles: [] };
    expect(detectBundleOpportunities(catalog, cart, noon).map((o) => o.bundleId)).not.toContain('b-not-a-deal');
  });

  it('respects bundle dayparts', () => {
    const cart: CartInput = { lines: [line(IDS.croissant), line(IDS.espresso)], bundles: [] };
    expect(detectBundleOpportunities(catalog, cart, noon)).toEqual([]);
    expect(detectBundleOpportunities(catalog, cart, at(9)).map((o) => o.bundleId)).toEqual(['b-breakfast']);
  });
});

describe('applyBundle', () => {
  it('moves matching quantities from lines into the bundle', () => {
    const cart: CartInput = { lines: [line(IDS.burger, 2), line(IDS.fries), line(IDS.sparkling)], bundles: [] };
    const next = applyBundle(cart, catalog, 'b-burger-meal', 1);
    expect(next.lines).toEqual([line(IDS.burger, 1)]);
    expect(next.bundles).toEqual([{ bundleId: 'b-burger-meal', quantity: 1 }]);
  });

  it('merges into an existing bundle line', () => {
    const cart: CartInput = {
      lines: [line(IDS.burger), line(IDS.fries), line(IDS.sparkling)],
      bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }],
    };
    expect(applyBundle(cart, catalog, 'b-burger-meal', 1).bundles).toEqual([{ bundleId: 'b-burger-meal', quantity: 2 }]);
  });

  it('leaves the cart unchanged when the set is incomplete', () => {
    const cart: CartInput = { lines: [line(IDS.burger)], bundles: [] };
    expect(applyBundle(cart, catalog, 'b-burger-meal', 1)).toEqual(cart);
  });

  it('lowers the quoted subtotal', () => {
    const cart: CartInput = { lines: [line(IDS.burger), line(IDS.fries), line(IDS.sparkling)], bundles: [] };
    const before = quoteCart(catalog, cart, noon).subtotal;
    const after = quoteCart(catalog, applyBundle(cart, catalog, 'b-burger-meal', 1), noon).subtotal;
    expect(before).toBe(1750);
    expect(after).toBe(1500);
  });
});
```

- [ ] **Step 2: Write the failing suggestions test**

`tests/domain/suggestions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { buildSuggestions } from '@/server/domain/suggestions';
import type { CartInput } from '@/server/domain/types';
import { at, IDS, makeCatalog, withProduct } from './fixtures';

const empty: CartInput = { lines: [], bundles: [] };
const noon = at(12);

describe('buildSuggestions', () => {
  it('menu context returns the daypart and a signature pick only', () => {
    const catalog = withProduct(makeCatalog(), IDS.croissant, { isSignature: true });
    const result = buildSuggestions(
      catalog,
      { context: 'menu', locale: 'en', cart: empty, dismissedIds: [] },
      at(9),
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.daypart).toBe('BREAKFAST');
    expect(result.signature).toMatchObject({ productId: IDS.croissant, suggestionId: `sig:${IDS.croissant}` });
    expect(result.upgrades).toEqual([]);
    expect(result.pairings).toEqual([]);
    expect(result.bundles).toEqual([]);
  });

  it('product context returns upgrades and pairings for that product even with an empty cart', () => {
    const result = buildSuggestions(
      makeCatalog(),
      {
        context: 'product',
        locale: 'en',
        product: { productId: IDS.burger, variantId: null, optionIds: [] },
        cart: empty,
        dismissedIds: [],
      },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.upgrades.map((o) => o.refId)).toEqual([IDS.optDouble, IDS.optCheese, IDS.wagyu]);
    expect(result.pairings.map((o) => o.productId)).toEqual([IDS.fries, IDS.sparkling]);
    expect(result.signature).toBeNull();
  });

  it('cart context limits pairings and includes bundle opportunities', () => {
    const cart: CartInput = {
      lines: [
        { productId: IDS.burger, variantId: null, optionIds: [], quantity: 1 },
        { productId: IDS.steak, variantId: null, optionIds: [IDS.optRare], quantity: 1 },
        { productId: IDS.fries, variantId: null, optionIds: [], quantity: 1 },
        { productId: IDS.sparkling, variantId: null, optionIds: [], quantity: 1 },
      ],
      bundles: [],
    };
    const result = buildSuggestions(
      makeCatalog(),
      { context: 'cart', locale: 'en', cart, dismissedIds: [] },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.pairings.length).toBeLessThanOrEqual(DEFAULT_ENGINE_CONFIG.cartPairingMaxOffers);
    expect(result.bundles.map((b) => b.bundleId)).toEqual(['b-burger-meal']);
    expect(result.upgrades).toEqual([]);
  });

  it('honours dismissed pairings', () => {
    const result = buildSuggestions(
      makeCatalog(),
      {
        context: 'product',
        locale: 'en',
        product: { productId: IDS.burger, variantId: null, optionIds: [] },
        cart: empty,
        dismissedIds: [`pair:${IDS.fries}`],
      },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.pairings.map((o) => o.productId)).toEqual([IDS.sparkling]);
  });

  it('returns empty upgrades for an unknown product without throwing', () => {
    const result = buildSuggestions(
      makeCatalog(),
      {
        context: 'product',
        locale: 'en',
        product: { productId: 'nope', variantId: null, optionIds: [] },
        cart: empty,
        dismissedIds: [],
      },
      noon,
      DEFAULT_ENGINE_CONFIG,
    );
    expect(result.upgrades).toEqual([]);
    expect(result.pairings).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npx vitest run tests/domain/bundles.test.ts tests/domain/suggestions.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/server/domain/bundles.ts`**

```ts
import { daypartNow, defaultVariant, inDaypart, orderability, productMap, unitPrice } from './catalog';
import {
  MAX_QUANTITY,
  type Bundle,
  type CartInput,
  type Catalog,
  type CatalogProduct,
} from './types';

export interface BundleComparison {
  bundleId: string;
  individualTotal: number;
  bundlePrice: number;
  savings: number;
  isDeal: boolean;
}

export interface BundleOpportunity {
  suggestionId: string;
  bundleId: string;
  times: number;
  individualTotal: number;
  bundlePrice: number;
  savings: number;
}

export function compareBundle(catalog: Catalog, bundle: Bundle): BundleComparison | null {
  const products = productMap(catalog);
  let individualTotal = 0;
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return null;
    individualTotal += unitPrice(product, item.variantId, []).price * item.quantity;
  }
  const savings = Math.max(0, individualTotal - bundle.price);
  return { bundleId: bundle.id, individualTotal, bundlePrice: bundle.price, savings, isDeal: savings > 0 };
}

function variantKey(product: CatalogProduct, variantId: string | null): string {
  return variantId ?? defaultVariant(product)?.id ?? '';
}

function slotKey(product: CatalogProduct, variantId: string | null): string {
  return `${product.id}|${variantKey(product, variantId)}`;
}

function availability(catalog: Catalog, cart: CartInput): Map<string, number> {
  const products = productMap(catalog);
  const available = new Map<string, number>();
  for (const line of cart.lines) {
    if (line.optionIds.length > 0) continue;
    const product = products.get(line.productId);
    if (!product) continue;
    const key = slotKey(product, line.variantId);
    available.set(key, (available.get(key) ?? 0) + line.quantity);
  }
  return available;
}

function fullSets(catalog: Catalog, bundle: Bundle, available: Map<string, number>): number {
  const products = productMap(catalog);
  let times = Number.POSITIVE_INFINITY;
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return 0;
    const have = available.get(slotKey(product, item.variantId)) ?? 0;
    times = Math.min(times, Math.floor(have / item.quantity));
  }
  return Number.isFinite(times) ? times : 0;
}

export function detectBundleOpportunities(catalog: Catalog, cart: CartInput, now: Date): BundleOpportunity[] {
  const current = daypartNow(catalog, now);
  const products = productMap(catalog);
  const available = availability(catalog, cart);
  const found: BundleOpportunity[] = [];

  for (const bundle of catalog.bundles) {
    if (!inDaypart(bundle.dayparts, current)) continue;
    const comparison = compareBundle(catalog, bundle);
    if (!comparison || !comparison.isDeal) continue;
    const orderable = bundle.items.every((item) => {
      const product = products.get(item.productId);
      return product !== undefined && orderability(product, current) === 'OK';
    });
    if (!orderable) continue;
    const times = Math.min(MAX_QUANTITY, fullSets(catalog, bundle, available));
    if (times < 1) continue;
    found.push({
      suggestionId: `bundle:${bundle.id}`,
      bundleId: bundle.id,
      times,
      individualTotal: comparison.individualTotal,
      bundlePrice: comparison.bundlePrice,
      savings: comparison.savings * times,
    });
  }
  return found.sort((a, b) => b.savings - a.savings || a.bundleId.localeCompare(b.bundleId));
}

export function applyBundle(cart: CartInput, catalog: Catalog, bundleId: string, times: number): CartInput {
  const bundle = catalog.bundles.find((candidate) => candidate.id === bundleId);
  if (!bundle || !Number.isInteger(times) || times < 1) return cart;
  if (fullSets(catalog, bundle, availability(catalog, cart)) < times) return cart;

  const products = productMap(catalog);
  let lines = cart.lines.map((line) => ({ ...line, optionIds: [...line.optionIds] }));
  for (const item of bundle.items) {
    const product = products.get(item.productId);
    if (!product) return cart;
    const key = slotKey(product, item.variantId);
    let remaining = item.quantity * times;
    lines = lines
      .map((line) => {
        const lineProduct = products.get(line.productId);
        if (remaining === 0 || line.optionIds.length > 0 || !lineProduct) return line;
        if (slotKey(lineProduct, line.variantId) !== key) return line;
        const take = Math.min(line.quantity, remaining);
        remaining -= take;
        return { ...line, quantity: line.quantity - take };
      })
      .filter((line) => line.quantity > 0);
  }

  const existing = cart.bundles.find((entry) => entry.bundleId === bundleId);
  const quantity = Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + times);
  const others = cart.bundles.filter((entry) => entry.bundleId !== bundleId);
  return { lines, bundles: [...others, { bundleId, quantity }] };
}
```

- [ ] **Step 5: Implement `src/server/domain/suggestions.ts` and `src/server/domain/index.ts`**

`src/server/domain/suggestions.ts`:

```ts
import { detectBundleOpportunities, type BundleOpportunity } from './bundles';
import { daypartNow } from './catalog';
import type { EngineConfig } from './config';
import { suggestPairings, type PairingOffer } from './pairing';
import { pickSignature } from './promotion';
import { suggestUpsells, type UpsellOffer } from './upsell';
import type { CartInput, Catalog, Daypart, Locale } from './types';

export interface SuggestionsRequest {
  context: 'menu' | 'product' | 'cart';
  locale: Locale;
  product?: { productId: string; variantId: string | null; optionIds: string[] };
  cart: CartInput;
  dismissedIds: string[];
}

export interface SignaturePick {
  suggestionId: string;
  productId: string;
  reasons: string[];
}

export interface SuggestionsResponse {
  daypart: Daypart | null;
  signature: SignaturePick | null;
  upgrades: UpsellOffer[];
  pairings: PairingOffer[];
  bundles: BundleOpportunity[];
}

export function buildSuggestions(
  catalog: Catalog,
  request: SuggestionsRequest,
  now: Date,
  config: EngineConfig,
): SuggestionsResponse {
  const response: SuggestionsResponse = {
    daypart: daypartNow(catalog, now),
    signature: null,
    upgrades: [],
    pairings: [],
    bundles: [],
  };

  if (request.context === 'menu') {
    const pick = pickSignature(catalog, now, config);
    response.signature = pick
      ? { suggestionId: `sig:${pick.productId}`, productId: pick.productId, reasons: pick.reasons }
      : null;
    return response;
  }

  if (request.context === 'product') {
    const selected = request.product;
    if (!selected) return response;
    response.upgrades = suggestUpsells({
      catalog,
      productId: selected.productId,
      variantId: selected.variantId,
      optionIds: selected.optionIds,
      now,
      locale: request.locale,
      config,
    });
    response.pairings = suggestPairings({
      catalog,
      cart: {
        lines: [
          ...request.cart.lines,
          { productId: selected.productId, variantId: selected.variantId, optionIds: selected.optionIds, quantity: 1 },
        ],
        bundles: request.cart.bundles,
      },
      dismissedIds: request.dismissedIds,
      now,
      locale: request.locale,
      config,
    });
    return response;
  }

  response.pairings = suggestPairings({
    catalog,
    cart: request.cart,
    dismissedIds: request.dismissedIds,
    now,
    locale: request.locale,
    config,
    maxOffers: config.cartPairingMaxOffers,
  });
  response.bundles = detectBundleOpportunities(catalog, request.cart, now);
  return response;
}
```

`src/server/domain/index.ts`:

```ts
export * from './types';
export * from './config';
export * from './money';
export * from './translate';
export * from './schedule';
export * from './catalog';
export * from './pricing';
export * from './upsell';
export * from './pairing';
export * from './promotion';
export * from './bundles';
export * from './suggestions';
```

- [ ] **Step 6: Run the full domain suite**

Run: `npx vitest run tests/domain tests/lib`
Expected: PASS, every domain and lib test.

- [ ] **Step 7: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src/server/domain tests/domain
git commit -m "feat(domain): honest bundles and suggestion assembly" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ATELIER seed data, media model and seed integrity checks

**Files:**
- Create: `src/lib/media.ts`
- Create: `prisma/seed/atelier.ts`, `prisma/seed/validate.ts`, `prisma/seed/apply.ts`, `prisma/seed.ts`
- Test: `tests/lib/media.test.ts`, `tests/seed/atelier.test.ts`

**Interfaces:**
- Produces from `src/lib/media.ts`: `ART_KINDS`, `ArtKind`, `MediaItem` (union of `art | image | video | model3d`), `parseMedia(raw: unknown): MediaItem[]`.
- Produces from `prisma/seed/atelier.ts`: `Tri`, `SeedData`, `ATELIER: SeedData`.
- Produces from `prisma/seed/validate.ts`: `validateSeed(data: SeedData): string[]`, `assertSeedValid(data: SeedData): void`.
- Produces from `prisma/seed/apply.ts`: `seedRestaurant(prisma: PrismaClient, data: SeedData): Promise<{ restaurantId: string }>`.

- [ ] **Step 1: Write the failing media test**

`tests/lib/media.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseMedia } from '@/lib/media';

describe('parseMedia', () => {
  it('accepts generated art', () => {
    expect(parseMedia([{ kind: 'art', art: 'cup', tone: '#6B4A2F' }])).toEqual([
      { kind: 'art', art: 'cup', tone: '#6B4A2F' },
    ]);
  });

  it('accepts images with safe URLs', () => {
    const image = { kind: 'image', url: '/media/atelier/espresso.jpg', alt: 'Espresso', width: 800, height: 600 };
    expect(parseMedia([image])).toEqual([image]);
    expect(parseMedia([{ ...image, url: 'https://cdn.example.com/a.jpg' }])).toHaveLength(1);
  });

  it('drops unsafe, malformed and unknown entries instead of throwing', () => {
    const bad = [
      { kind: 'image', url: 'javascript:alert(1)', alt: 'x', width: 1, height: 1 },
      { kind: 'image', url: '//evil.example/a.jpg', alt: 'x', width: 1, height: 1 },
      { kind: 'art', art: 'spaceship', tone: '#000000' },
      { kind: 'art', art: 'cup', tone: 'red' },
      { kind: 'video' },
      { kind: 'nope' },
      null,
      'text',
      42,
    ];
    expect(parseMedia(bad)).toEqual([]);
    expect(parseMedia(null)).toEqual([]);
    expect(parseMedia({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing seed test**

`tests/seed/atelier.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ATELIER, type SeedData } from '../../prisma/seed/atelier';
import { validateSeed } from '../../prisma/seed/validate';

const clone = (): SeedData => structuredClone(ATELIER);

describe('ATELIER seed', () => {
  it('passes every integrity check', () => {
    expect(validateSeed(ATELIER)).toEqual([]);
  });

  it('meets the demo requirements', () => {
    expect(ATELIER.products).toHaveLength(24);
    expect(ATELIER.categories).toHaveLength(5);
    expect(ATELIER.tables).toContain(4);
    expect(ATELIER.bundles.length).toBeGreaterThanOrEqual(2);
    expect(ATELIER.pairingRules.length).toBeGreaterThanOrEqual(10);
    expect(ATELIER.upsellRules.length).toBeGreaterThanOrEqual(1);
    for (const category of ATELIER.categories) {
      expect(ATELIER.products.some((p) => p.category === category.slug)).toBe(true);
    }
  });

  it('provides visual art for every product', () => {
    for (const product of ATELIER.products) {
      expect(product.art.length).toBeGreaterThan(0);
      expect(product.tone).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('has unique slugs and a single default variant per variant list', () => {
    const slugs = ATELIER.products.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const product of ATELIER.products) {
      if (!product.variants) continue;
      expect(product.variants.filter((v) => v.isDefault)).toHaveLength(1);
    }
  });
});

describe('validateSeed', () => {
  it('flags a bundle that is not cheaper than its items', () => {
    const data = clone();
    data.bundles[0]!.price = 99_999;
    expect(validateSeed(data).join('\n')).toMatch(/not cheaper/i);
  });

  it('flags a missing Sorani translation', () => {
    const data = clone();
    data.products[0]!.name.ckb = '';
    expect(validateSeed(data).join('\n')).toMatch(/ckb/);
  });

  it('flags Arabic text that is not in Arabic script', () => {
    const data = clone();
    data.products[0]!.description.ar = 'Latin text';
    expect(validateSeed(data).join('\n')).toMatch(/Arabic script/);
  });

  it('flags a pairing rule that points at an unknown product', () => {
    const data = clone();
    data.pairingRules[0]!.target = 'does-not-exist';
    expect(validateSeed(data).join('\n')).toMatch(/does-not-exist/);
  });

  it('flags a cost at or above the price', () => {
    const data = clone();
    data.products[0]!.cost = data.products[0]!.price;
    expect(validateSeed(data).join('\n')).toMatch(/cost/i);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npx vitest run tests/lib/media.test.ts tests/seed`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/lib/media.ts`**

```ts
export const ART_KINDS = ['cup', 'glass', 'plate', 'pastry', 'bowl', 'burger'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

export type MediaItem =
  | { kind: 'art'; art: ArtKind; tone: string }
  | { kind: 'image'; url: string; alt: string; width: number; height: number }
  | { kind: 'video'; url: string; poster: string }
  | { kind: 'model3d'; url: string; poster: string };

/** Same-origin paths and https URLs only. Protocol-relative and script URLs are rejected. */
function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('//')) return false;
  return value.startsWith('/') || value.startsWith('https://');
}

export function parseMedia(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const items: MediaItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const v = entry as Record<string, unknown>;
    if (v.kind === 'art') {
      if ((ART_KINDS as readonly unknown[]).includes(v.art) && typeof v.tone === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.tone)) {
        items.push({ kind: 'art', art: v.art as ArtKind, tone: v.tone });
      }
    } else if (v.kind === 'image') {
      if (isSafeUrl(v.url) && typeof v.alt === 'string' && Number.isFinite(v.width) && Number.isFinite(v.height)) {
        items.push({ kind: 'image', url: v.url, alt: v.alt, width: Number(v.width), height: Number(v.height) });
      }
    } else if (v.kind === 'video' || v.kind === 'model3d') {
      if (isSafeUrl(v.url) && isSafeUrl(v.poster)) items.push({ kind: v.kind, url: v.url, poster: v.poster });
    }
  }
  return items;
}
```

- [ ] **Step 5: Implement `prisma/seed/atelier.ts`**

```ts
import type { ArtKind } from '@/lib/media';
import type { Daypart } from '@/server/domain/types';

export interface Tri {
  en: string;
  ar: string;
  ckb: string;
}

export interface TriList {
  en: string[];
  ar: string[];
  ckb: string[];
}

export interface SeedOption {
  name: Tri;
  effect?: Tri;
  priceDelta: number;
  costDelta: number | null;
  suggested?: boolean;
  suggestPriority?: number;
}

export interface SeedGroup {
  name: Tri;
  min: number;
  max: number;
  options: SeedOption[];
}

export interface SeedVariant {
  name: Tri;
  priceDelta: number;
  costDelta: number | null;
  isDefault?: boolean;
}

export interface SeedProduct {
  slug: string;
  category: string;
  price: number;
  cost: number | null;
  popularity: number;
  priority: number;
  signature?: boolean;
  featured?: boolean;
  stock?: number;
  lowStock?: number;
  dayparts?: Daypart[];
  hideOutsideDaypart?: boolean;
  slot?: string;
  art: ArtKind;
  tone: string;
  name: Tri;
  description: Tri;
  ingredients: TriList;
  allergens: string[];
  groups?: SeedGroup[];
  variants?: SeedVariant[];
}

export interface SeedPairingRule {
  source: { product: string } | { category: string };
  target: string;
  weight: number;
  reason: Tri;
  dayparts?: Daypart[];
}

export interface SeedUpsellRule {
  source: string;
  target: string;
  priority: number;
  pitch: Tri;
  effect: Tri;
}

export interface SeedBundle {
  slug: string;
  price: number;
  dayparts?: Daypart[];
  name: Tri;
  description: Tri;
  items: Array<{ product: string; quantity: number }>;
}

export interface SeedPalette {
  bg: string;
  surface: string;
  raised: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  onAccent: string;
}

export interface SeedData {
  restaurant: {
    slug: string;
    name: string;
    currency: string;
    defaultLocale: 'en' | 'ar' | 'ckb';
    locales: Array<'en' | 'ar' | 'ckb'>;
    timezone: string;
    numeralSystem: 'LATN' | 'ARAB';
    domains: string[];
  };
  brand: {
    logoText: string;
    theme: 'DARK' | 'LIGHT';
    motionIntensity: 'none' | 'subtle' | 'expressive';
    navStyle: string;
    typography: { display: string; text: string; arabic: string };
    tokens: { dark: SeedPalette; light: SeedPalette };
  };
  categories: Array<{ slug: string; name: Tri }>;
  products: SeedProduct[];
  pairingRules: SeedPairingRule[];
  upsellRules: SeedUpsellRule[];
  bundles: SeedBundle[];
  schedule: Array<{ daypart: Daypart; startMinute: number; endMinute: number; daysOfWeek: number }>;
  tables: number[];
}

const t = (en: string, ar: string, ckb: string): Tri => ({ en, ar, ckb });
const list = (en: string[], ar: string[], ckb: string[]): TriList => ({ en, ar, ckb });

const MILK_GROUP = (): SeedGroup => ({
  name: t('Milk', 'الحليب', 'شیر'),
  min: 0,
  max: 1,
  options: [
    {
      name: t('Oat milk', 'حليب الشوفان', 'شیری جۆ'),
      effect: t('Creamy, plant-based, lightly sweet', 'كريمي نباتي بحلاوة خفيفة', 'کرێمی و ڕووەکی و کەمێک شیرین'),
      priceDelta: 50,
      costDelta: 15,
      suggested: true,
      suggestPriority: 40,
    },
    {
      name: t('Almond milk', 'حليب اللوز', 'شیری بادەم'),
      priceDelta: 50,
      costDelta: 20,
    },
  ],
});

const EXTRA_SHOT_GROUP = (): SeedGroup => ({
  name: t('Extras', 'إضافات', 'زیادەکراوەکان'),
  min: 0,
  max: 1,
  options: [
    {
      name: t('Extra shot', 'جرعة إضافية', 'شۆتی زیادە'),
      effect: t('A second shot of espresso', 'جرعة ثانية من الإسبريسو', 'شۆتێکی دووەمی ئێسپرێسۆ'),
      priceDelta: 100,
      costDelta: 20,
      suggested: true,
      suggestPriority: 60,
    },
  ],
});

const SIZE_VARIANTS = (largeCost: number): SeedVariant[] => [
  { name: t('Regular 350 ml', 'عادي ٣٥٠ مل', 'ئاسایی ٣٥٠ مل'), priceDelta: 0, costDelta: 0, isDefault: true },
  { name: t('Large 500 ml', 'كبير ٥٠٠ مل', 'گەورە ٥٠٠ مل'), priceDelta: 150, costDelta: largeCost },
];

const REASON = {
  fries: t('Crisp and salted, the classic partner', 'مقرمشة ومملّحة، الرفيق الكلاسيكي', 'کرچ و سویر، هاوەڵی کلاسیکی'),
  coldDrink: t('Something cold and bright alongside', 'شيء بارد ومنعش بجانبه', 'شتێکی ساردی تازە لەگەڵیدا'),
  bubbles: t('Clean bubbles to reset the palate', 'فقاعات نقيّة تنعش الذوق', 'بلقی پاک بۆ تازەکردنەوەی تامەکە'),
  steakSide: t('A side that stands up to the steak', 'طبق جانبي يليق بالستيك', 'لایەنێک کە لەگەڵ ستەیکەکە دەگونجێت'),
  starter: t('A crisp start before the pasta', 'بداية مقرمشة قبل المعكرونة', 'دەستپێکێکی کرچ پێش پاستاکە'),
  finish: t('A bright finish to the meal', 'ختام منعش للوجبة', 'کۆتاییەکی تازە بۆ ژەمەکە'),
  withCoffee: t('Pairs with your coffee', 'يتناغم مع قهوتك', 'لەگەڵ قاوەکەت دەگونجێت'),
  sweet: t('Something sweet with it', 'شيء حلو معها', 'شتێکی شیرین لەگەڵیدا'),
  chocolate: t('Dark chocolate suits a short espresso', 'الشوكولاتة الداكنة تناسب الإسبريسو', 'چکلێتی تاریک لەگەڵ ئێسپرێسۆ دەگونجێت'),
  coffeeAfter: t('A coffee to go with it', 'قهوة تناسبها', 'قاوەیەک بۆ لەگەڵیدا'),
  juice: t('Fresh juice with your eggs', 'عصير طازج مع البيض', 'شەربەتی تازە لەگەڵ هێلکەکان'),
  flatWhite: t('A flat white goes well with it', 'فلات وايت يناسبها', 'فلات وایت لەگەڵیدا باشە'),
};

export const ATELIER: SeedData = {
  restaurant: {
    slug: 'atelier',
    name: 'ATELIER',
    currency: 'USD',
    defaultLocale: 'en',
    locales: ['en', 'ar', 'ckb'],
    timezone: 'Asia/Baghdad',
    numeralSystem: 'LATN',
    domains: ['atelier.localhost'],
  },
  brand: {
    logoText: 'ATELIER',
    theme: 'DARK',
    motionIntensity: 'subtle',
    navStyle: 'rail',
    typography: { display: 'Bodoni Moda', text: 'Hanken Grotesk', arabic: 'Noto Naskh Arabic' },
    tokens: {
      dark: {
        bg: '#0E0E0F',
        surface: '#1B1A19',
        raised: '#2A2826',
        accent: '#D6BC8A',
        text: '#EDE8DF',
        muted: '#A7A096',
        line: '#3A3633',
        onAccent: '#0E0E0F',
      },
      light: {
        bg: '#F7F5F1',
        surface: '#FFFFFF',
        raised: '#EFEBE4',
        accent: '#7A5F26',
        text: '#1B1A19',
        muted: '#6B655D',
        line: '#D9D3C9',
        onAccent: '#FFFFFF',
      },
    },
  },
  categories: [
    { slug: 'coffee-tea', name: t('Coffee & Tea', 'القهوة والشاي', 'قاوە و چا') },
    { slug: 'breakfast', name: t('Breakfast', 'الفطور', 'نانی بەیانی') },
    { slug: 'plates', name: t('Plates', 'الأطباق الرئيسية', 'خواردنی سەرەکی') },
    { slug: 'patisserie', name: t('Pâtisserie', 'الحلويات', 'شیرینی') },
    { slug: 'cold', name: t('Cold & Sparkling', 'المشروبات الباردة', 'خواردنەوە ساردەکان') },
  ],
  products: [
    {
      slug: 'espresso',
      category: 'coffee-tea',
      price: 300,
      cost: 45,
      popularity: 80,
      priority: 40,
      slot: 'DRINK',
      art: 'cup',
      tone: '#6B4A2F',
      name: t('Espresso', 'إسبريسو', 'ئێسپرێسۆ'),
      description: t(
        'A short, concentrated shot of our house blend.',
        'جرعة قصيرة ومركّزة من مزيجنا الخاص.',
        'شۆتێکی کورت و خەست لە تێکەڵەی تایبەتی ئێمە.',
      ),
      ingredients: list(['Coffee'], ['قهوة'], ['قاوە']),
      allergens: [],
      groups: [EXTRA_SHOT_GROUP()],
    },
    {
      slug: 'flat-white',
      category: 'coffee-tea',
      price: 450,
      cost: 90,
      popularity: 85,
      priority: 60,
      signature: true,
      slot: 'DRINK',
      art: 'cup',
      tone: '#8A6A4B',
      name: t('Flat White', 'فلات وايت', 'فلات وایت'),
      description: t(
        'Silky steamed milk over a double espresso.',
        'حليب مبخّر ناعم فوق إسبريسو مزدوج.',
        'شیری بەرزکراوەی نەرم لەسەر ئێسپرێسۆی دووجار.',
      ),
      ingredients: list(['Espresso', 'Milk'], ['إسبريسو', 'حليب'], ['ئێسپرێسۆ', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP(), EXTRA_SHOT_GROUP()],
    },
    {
      slug: 'cappuccino',
      category: 'coffee-tea',
      price: 450,
      cost: 85,
      popularity: 78,
      priority: 50,
      slot: 'DRINK',
      art: 'cup',
      tone: '#9B7653',
      name: t('Cappuccino', 'كابتشينو', 'کاپوچینۆ'),
      description: t(
        'Espresso under a thick cap of velvety foam.',
        'إسبريسو تحت طبقة كثيفة من الرغوة المخملية.',
        'ئێسپرێسۆ لەژێر چینێکی خەستی کەفی نەرم.',
      ),
      ingredients: list(['Espresso', 'Milk'], ['إسبريسو', 'حليب'], ['ئێسپرێسۆ', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP(), EXTRA_SHOT_GROUP()],
    },
    {
      slug: 'cortado',
      category: 'coffee-tea',
      price: 400,
      cost: 80,
      popularity: 55,
      priority: 40,
      slot: 'DRINK',
      art: 'cup',
      tone: '#7A5A3F',
      name: t('Cortado', 'كورتادو', 'کۆرتادۆ'),
      description: t(
        'Equal parts espresso and warm milk.',
        'كميات متساوية من الإسبريسو والحليب الدافئ.',
        'بڕی یەکسان ئێسپرێسۆ و شیری گەرم.',
      ),
      ingredients: list(['Espresso', 'Milk'], ['إسبريسو', 'حليب'], ['ئێسپرێسۆ', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP()],
    },
    {
      slug: 'matcha-latte',
      category: 'coffee-tea',
      price: 550,
      cost: 140,
      popularity: 62,
      priority: 70,
      slot: 'DRINK',
      art: 'cup',
      tone: '#7F9A5E',
      name: t('Matcha Latte', 'ماتشا لاتيه', 'ماچا لاتە'),
      description: t(
        'Stone-ground matcha whisked with steamed milk.',
        'ماتشا مطحونة على الحجر مخفوقة مع حليب مبخّر.',
        'ماچای ئاش‌کراو بە بەرد لەگەڵ شیری بەرزکراوە.',
      ),
      ingredients: list(['Matcha', 'Milk'], ['ماتشا', 'حليب'], ['ماچا', 'شیر']),
      allergens: ['milk'],
      groups: [MILK_GROUP()],
    },
    {
      slug: 'earl-grey',
      category: 'coffee-tea',
      price: 350,
      cost: 40,
      popularity: 45,
      priority: 30,
      slot: 'DRINK',
      art: 'cup',
      tone: '#B58B4C',
      name: t('Earl Grey', 'شاي إيرل غراي', 'چای ئێرل گرەی'),
      description: t(
        'Black tea scented with bergamot, served in a pot.',
        'شاي أسود معطّر بالبرغموت، يُقدَّم في إبريق.',
        'چایی ڕەش بۆنخۆشکراو بە بێرگاموت، لە قوریەکدا.',
      ),
      ingredients: list(['Black tea', 'Bergamot'], ['شاي أسود', 'برغموت'], ['چایی ڕەش', 'بێرگاموت']),
      allergens: [],
    },
    {
      slug: 'croissant',
      category: 'breakfast',
      price: 350,
      cost: 80,
      popularity: 85,
      priority: 60,
      signature: true,
      stock: 30,
      lowStock: 8,
      dayparts: ['BREAKFAST'],
      slot: 'BAKERY',
      art: 'pastry',
      tone: '#C98F4A',
      name: t('Croissant au beurre', 'كرواسون بالزبدة', 'کرواسانی کەرە'),
      description: t(
        'Laminated all-butter pastry, baked each morning.',
        'عجينة مورّقة بالزبدة الخالصة، تُخبز كل صباح.',
        'هەویری چین‌چین بە کەرەی خاڵیس، هەموو بەیانییەک دەکرێتە فڕن.',
      ),
      ingredients: list(['Butter', 'Flour', 'Milk'], ['زبدة', 'طحين', 'حليب'], ['کەرە', 'ئارد', 'شیر']),
      allergens: ['gluten', 'milk'],
    },
    {
      slug: 'avocado-toast',
      category: 'breakfast',
      price: 900,
      cost: 260,
      popularity: 70,
      priority: 55,
      dayparts: ['BREAKFAST', 'LUNCH'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#7C9B5A',
      name: t('Avocado Toast', 'توست الأفوكادو', 'تۆستی ئەڤۆکادۆ'),
      description: t(
        'Sourdough, smashed avocado, lime and chilli flakes.',
        'خبز العجين المخمّر مع أفوكادو مهروس وليمون ورقائق الفلفل الحار.',
        'نانی هەویری ترش لەگەڵ ئەڤۆکادۆی کوتراو، لیمۆ و پەلی بیبەری تیژ.',
      ),
      ingredients: list(
        ['Sourdough', 'Avocado', 'Lime', 'Chilli'],
        ['خبز العجين المخمّر', 'أفوكادو', 'ليمون', 'فلفل حار'],
        ['نانی هەویری ترش', 'ئەڤۆکادۆ', 'لیمۆ', 'بیبەری تیژ'],
      ),
      allergens: ['gluten'],
      groups: [
        {
          name: t('Add', 'إضافة', 'زیادە بکە'),
          min: 0,
          max: 1,
          options: [
            {
              name: t('Poached egg', 'بيضة مسلوقة', 'هێلکەی کوڵاو'),
              effect: t('One soft poached egg', 'بيضة واحدة مسلوقة طرية', 'یەک هێلکەی نەرمی کوڵاو'),
              priceDelta: 150,
              costDelta: 40,
              suggested: true,
              suggestPriority: 65,
            },
          ],
        },
      ],
    },
    {
      slug: 'shakshuka',
      category: 'breakfast',
      price: 1050,
      cost: 240,
      popularity: 68,
      priority: 60,
      dayparts: ['BREAKFAST', 'LUNCH'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#B5432F',
      name: t('Shakshuka', 'شكشوكة', 'شەکشوکە'),
      description: t(
        'Eggs baked in spiced tomato and pepper sauce, with warm bread.',
        'بيض مخبوز في صلصة الطماطم والفلفل المتبّلة، مع خبز دافئ.',
        'هێلکەی فڕنکراو لە سۆسی تەماتە و بیبەری بەهاراتکراو، لەگەڵ نانی گەرم.',
      ),
      ingredients: list(
        ['Eggs', 'Tomato', 'Pepper', 'Bread'],
        ['بيض', 'طماطم', 'فلفل', 'خبز'],
        ['هێلکە', 'تەماتە', 'بیبەر', 'نان'],
      ),
      allergens: ['egg', 'gluten'],
    },
    {
      slug: 'granola-bowl',
      category: 'breakfast',
      price: 800,
      cost: 190,
      popularity: 52,
      priority: 45,
      dayparts: ['BREAKFAST'],
      slot: 'MAIN',
      art: 'bowl',
      tone: '#C9A86A',
      name: t('Granola Bowl', 'وعاء الغرانولا', 'قاپی گرانۆلا'),
      description: t(
        'House granola, yoghurt, seasonal fruit and honey.',
        'غرانولا منزلية الصنع مع لبن وفاكهة موسمية وعسل.',
        'گرانۆلای ماڵی لەگەڵ ماست، میوەی وەرز و هەنگوین.',
      ),
      ingredients: list(
        ['Granola', 'Yoghurt', 'Fruit', 'Honey'],
        ['غرانولا', 'لبن', 'فاكهة', 'عسل'],
        ['گرانۆلا', 'ماست', 'میوە', 'هەنگوین'],
      ),
      allergens: ['milk', 'nuts', 'gluten'],
    },
    {
      slug: 'atelier-burger',
      category: 'plates',
      price: 900,
      cost: 310,
      popularity: 75,
      priority: 70,
      signature: true,
      dayparts: ['LUNCH', 'DINNER'],
      slot: 'MAIN',
      art: 'burger',
      tone: '#A5662F',
      name: t('Atelier Burger', 'برغر أتيليه', 'بەرگەری ئاتەلیە'),
      description: t(
        'Dry-aged beef, brioche bun, house pickles and sauce.',
        'لحم بقري معتّق، خبز بريوش، مخلل منزلي وصلصة خاصة.',
        'گۆشتی مانگای پیرکراو، نانی بریۆش، تورشی ماڵی و سۆسی تایبەت.',
      ),
      ingredients: list(
        ['Beef', 'Brioche', 'Pickles', 'House sauce'],
        ['لحم بقري', 'بريوش', 'مخلل', 'صلصة خاصة'],
        ['گۆشتی مانگا', 'بریۆش', 'تورشی', 'سۆسی تایبەت'],
      ),
      allergens: ['gluten', 'egg', 'milk', 'mustard'],
      groups: [
        {
          name: t('Make it yours', 'اجعلها على ذوقك', 'بە دڵی خۆت بیکە'),
          min: 0,
          max: 2,
          options: [
            {
              name: t('Premium cheese', 'جبنة فاخرة', 'پەنیری تایبەت'),
              effect: t('Aged cheddar, melted', 'شيدر معتّق مذاب', 'چێدەری پیرکراوی تواوە'),
              priceDelta: 100,
              costDelta: 35,
              suggested: true,
              suggestPriority: 70,
            },
            {
              name: t('Double patty', 'قرصان من اللحم', 'دوو پارچە گۆشت'),
              effect: t('A second 140 g beef patty', 'قرص لحم ثانٍ بوزن ١٤٠ غ', 'پارچەیەکی دووەمی گۆشت ١٤٠ گرام'),
              priceDelta: 300,
              costDelta: 160,
              suggested: true,
              suggestPriority: 85,
            },
            {
              name: t('Bacon', 'لحم مقدد', 'باکۆن'),
              priceDelta: 150,
              costDelta: 60,
            },
          ],
        },
      ],
    },
    {
      slug: 'wagyu-burger',
      category: 'plates',
      price: 1300,
      cost: 590,
      popularity: 58,
      priority: 65,
      dayparts: ['DINNER'],
      slot: 'MAIN',
      art: 'burger',
      tone: '#7D4A25',
      name: t('Wagyu Burger', 'برغر واغيو', 'بەرگەری واگیو'),
      description: t(
        'Wagyu beef patty, aged cheddar and truffle mayo on toasted brioche.',
        'قرص لحم واغيو مع شيدر معتّق ومايونيز الكمأة على خبز بريوش محمّص.',
        'پارچەی گۆشتی واگیو لەگەڵ چێدەری پیرکراو و مایۆنیزی ترۆفڵ لەسەر بریۆشی برژاو.',
      ),
      ingredients: list(
        ['Wagyu beef', 'Cheddar', 'Truffle mayo', 'Brioche'],
        ['لحم واغيو', 'شيدر', 'مايونيز الكمأة', 'بريوش'],
        ['گۆشتی واگیو', 'چێدەر', 'مایۆنیزی ترۆفڵ', 'بریۆش'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
    },
    {
      slug: 'truffle-pasta',
      category: 'plates',
      price: 1550,
      cost: 420,
      popularity: 66,
      priority: 72,
      dayparts: ['LUNCH', 'DINNER'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#D8C39A',
      name: t('Truffle Tagliatelle', 'تاليتيلي بالكمأة', 'تاگلیاتێلی ترۆفڵ'),
      description: t(
        'Fresh egg pasta, black truffle butter and parmesan.',
        'معكرونة بيض طازجة بزبدة الكمأة السوداء والبارميزان.',
        'پاستای هێلکەی تازە لەگەڵ کەرەی ترۆفڵی ڕەش و پارمیزان.',
      ),
      ingredients: list(
        ['Egg pasta', 'Black truffle', 'Butter', 'Parmesan'],
        ['معكرونة بيض', 'كمأة سوداء', 'زبدة', 'بارميزان'],
        ['پاستای هێلکە', 'ترۆفڵی ڕەش', 'کەرە', 'پارمیزان'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
      groups: [
        {
          name: t('Add', 'إضافة', 'زیادە بکە'),
          min: 0,
          max: 1,
          options: [
            {
              name: t('Grilled chicken', 'دجاج مشوي', 'مریشکی برژاو'),
              effect: t('Sliced grilled chicken breast', 'شرائح صدر دجاج مشوي', 'پارچە سنگی مریشکی برژاو'),
              priceDelta: 400,
              costDelta: 160,
              suggested: true,
              suggestPriority: 50,
            },
            {
              name: t('Burrata', 'بوراتا', 'بوراتا'),
              effect: t('A whole burrata, torn over the top', 'حبّة بوراتا كاملة تُمزَّق فوق الطبق', 'بوراتایەکی تەواو لەسەر خواردنەکە'),
              priceDelta: 350,
              costDelta: 150,
              suggested: true,
              suggestPriority: 60,
            },
          ],
        },
      ],
    },
    {
      slug: 'ribeye',
      category: 'plates',
      price: 2800,
      cost: 1150,
      popularity: 55,
      priority: 60,
      dayparts: ['DINNER'],
      slot: 'MAIN',
      art: 'plate',
      tone: '#5C3524',
      name: t('Ribeye 250 g', 'ريب آي ٢٥٠ غ', 'ڕیب‌ئای ٢٥٠ گرام'),
      description: t(
        'Ribeye grilled over charcoal with bone-marrow butter.',
        'ريب آي مشوي على الفحم مع زبدة نخاع العظم.',
        'ڕیب‌ئای برژاو لەسەر خەڵووز لەگەڵ کەرەی مۆخی ئێسقان.',
      ),
      ingredients: list(
        ['Ribeye', 'Bone-marrow butter', 'Sea salt'],
        ['ريب آي', 'زبدة نخاع العظم', 'ملح البحر'],
        ['ڕیب‌ئای', 'کەرەی مۆخی ئێسقان', 'خوێی دەریا'],
      ),
      allergens: ['milk'],
      groups: [
        {
          name: t('Doneness', 'درجة النضج', 'پلەی پێگەیشتن'),
          min: 1,
          max: 1,
          options: [
            { name: t('Rare', 'نادج', 'خاو'), priceDelta: 0, costDelta: 0 },
            { name: t('Medium rare', 'متوسط النضج قليلاً', 'ناوەندی خاو'), priceDelta: 0, costDelta: 0 },
            { name: t('Medium', 'متوسط', 'ناوەند'), priceDelta: 0, costDelta: 0 },
            { name: t('Well done', 'ناضج جيدًا', 'باش برژاو'), priceDelta: 0, costDelta: 0 },
          ],
        },
        {
          name: t('Sauce', 'الصلصة', 'سۆس'),
          min: 0,
          max: 1,
          options: [
            {
              name: t('Peppercorn sauce', 'صلصة الفلفل الأسود', 'سۆسی بیبەری ڕەش'),
              effect: t('Cracked pepper cream sauce', 'صلصة كريمة بالفلفل المجروش', 'سۆسی کرێمی بیبەری کوتراو'),
              priceDelta: 150,
              costDelta: 40,
              suggested: true,
              suggestPriority: 55,
            },
          ],
        },
      ],
    },
    {
      slug: 'caesar-salad',
      category: 'plates',
      price: 1000,
      cost: 280,
      popularity: 48,
      priority: 40,
      slot: 'STARTER',
      art: 'bowl',
      tone: '#8DAA6A',
      name: t('Caesar Salad', 'سلطة سيزر', 'زەڵاتەی سیزەر'),
      description: t(
        'Little gem, parmesan, sourdough croutons and anchovy dressing.',
        'خس صغير مع بارميزان وقطع خبز محمّصة وصلصة الأنشوجة.',
        'کاهووی بچووک لەگەڵ پارمیزان، پارچە نانی برژاو و سۆسی ئەنچۆڤی.',
      ),
      ingredients: list(
        ['Little gem', 'Parmesan', 'Croutons', 'Anchovy'],
        ['خس صغير', 'بارميزان', 'خبز محمّص', 'أنشوجة'],
        ['کاهووی بچووک', 'پارمیزان', 'نانی برژاو', 'ئەنچۆڤی'],
      ),
      allergens: ['gluten', 'milk', 'fish', 'egg'],
    },
    {
      slug: 'truffle-fries',
      category: 'plates',
      price: 550,
      cost: 120,
      popularity: 70,
      priority: 55,
      slot: 'SIDE',
      art: 'plate',
      tone: '#D9B45A',
      name: t('Truffle Fries', 'بطاطس بالكمأة', 'پەتاتەی سووربەکراوی ترۆفڵ'),
      description: t(
        'Hand-cut fries, truffle oil and grated parmesan.',
        'بطاطس مقطّعة يدويًا مع زيت الكمأة وبارميزان مبشور.',
        'پەتاتەی بە دەست بڕاو لەگەڵ زەیتی ترۆفڵ و پارمیزانی ڕنراو.',
      ),
      ingredients: list(
        ['Potato', 'Truffle oil', 'Parmesan'],
        ['بطاطس', 'زيت الكمأة', 'بارميزان'],
        ['پەتاتە', 'زەیتی ترۆفڵ', 'پارمیزان'],
      ),
      allergens: ['milk'],
    },
    {
      slug: 'tarte-citron',
      category: 'patisserie',
      price: 650,
      cost: 170,
      popularity: 60,
      priority: 55,
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#E5D06A',
      name: t('Tarte au Citron', 'تارت الليمون', 'تارتی لیمۆ'),
      description: t(
        'Buttery shortcrust, lemon curd and torched meringue.',
        'عجينة هشّة بالزبدة وكريمة الليمون وميرنغ محروق.',
        'هەویری کەرەیی، کرێمی لیمۆ و مرینگی سووتێنراو.',
      ),
      ingredients: list(
        ['Butter pastry', 'Lemon', 'Meringue'],
        ['عجينة بالزبدة', 'ليمون', 'ميرنغ'],
        ['هەویری کەرە', 'لیمۆ', 'مرینگ'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
    },
    {
      slug: 'mille-feuille',
      category: 'patisserie',
      price: 800,
      cost: 230,
      popularity: 64,
      priority: 70,
      signature: true,
      stock: 12,
      lowStock: 4,
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#9DB07A',
      name: t('Pistachio Mille-feuille', 'ميل فوي بالفستق', 'میلفۆیی فستق'),
      description: t(
        'Caramelised puff pastry, pistachio cream, crushed pistachio.',
        'عجينة مورّقة مكرمَلة مع كريمة الفستق وفتات الفستق.',
        'هەویری چین‌چینی کاراملکراو لەگەڵ کرێمی فستق و پارچەی فستق.',
      ),
      ingredients: list(
        ['Puff pastry', 'Pistachio', 'Cream'],
        ['عجينة مورّقة', 'فستق', 'كريمة'],
        ['هەویری چین‌چین', 'فستق', 'کرێم'],
      ),
      allergens: ['gluten', 'milk', 'egg', 'nuts'],
    },
    {
      slug: 'chocolate-fondant',
      category: 'patisserie',
      price: 850,
      cost: 210,
      popularity: 72,
      priority: 60,
      stock: 10,
      lowStock: 4,
      dayparts: ['DINNER', 'LATE_NIGHT'],
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#4A2C21',
      name: t('Chocolate Fondant', 'فوندان الشوكولاتة', 'فۆندانی چکلێت'),
      description: t(
        'Warm dark-chocolate cake with a molten centre.',
        'كيك الشوكولاتة الداكنة الدافئ بقلب سائل.',
        'کێکی چکلێتی تاریکی گەرم بە ناوەڕاستێکی تواوە.',
      ),
      ingredients: list(
        ['Dark chocolate', 'Butter', 'Eggs'],
        ['شوكولاتة داكنة', 'زبدة', 'بيض'],
        ['چکلێتی تاریک', 'کەرە', 'هێلکە'],
      ),
      allergens: ['gluten', 'egg', 'milk'],
    },
    {
      slug: 'basque-cheesecake',
      category: 'patisserie',
      price: 750,
      cost: 190,
      popularity: 66,
      priority: 50,
      slot: 'DESSERT',
      art: 'pastry',
      tone: '#C88A4B',
      name: t('Basque Cheesecake', 'تشيز كيك باسك', 'چیزکێکی باسک'),
      description: t(
        'Burnt-top cheesecake, creamy in the centre.',
        'تشيز كيك بوجه محروق وقلب كريمي.',
        'چیزکێک بە سەرووی سووتاو و ناوەڕاستی کرێمی.',
      ),
      ingredients: list(
        ['Cream cheese', 'Cream', 'Eggs'],
        ['جبنة كريمية', 'كريمة', 'بيض'],
        ['پەنیری کرێمی', 'کرێم', 'هێلکە'],
      ),
      allergens: ['milk', 'egg'],
    },
    {
      slug: 'cold-brew',
      category: 'cold',
      price: 500,
      cost: 90,
      popularity: 60,
      priority: 50,
      slot: 'DRINK',
      art: 'glass',
      tone: '#3D2A1E',
      name: t('Cold Brew', 'قهوة باردة', 'قاوەی ساردی دەرهێنراو'),
      description: t(
        'Steeped for 18 hours, served over ice.',
        'منقوعة لمدة ١٨ ساعة، تُقدَّم مع الثلج.',
        'بۆ ١٨ کاتژمێر هەڵکێشراوە، لەگەڵ سەهۆڵ پێشکەش دەکرێت.',
      ),
      ingredients: list(['Coffee', 'Water'], ['قهوة', 'ماء'], ['قاوە', 'ئاو']),
      allergens: [],
      variants: SIZE_VARIANTS(40),
    },
    {
      slug: 'yuzu-lemonade',
      category: 'cold',
      price: 550,
      cost: 110,
      popularity: 58,
      priority: 65,
      slot: 'DRINK',
      art: 'glass',
      tone: '#E8D96A',
      name: t('Yuzu Lemonade', 'عصير اليوزو بالليمون', 'لیمۆنادەی یوزو'),
      description: t(
        'Yuzu, lemon and a little honey, over ice.',
        'يوزو وليمون وقليل من العسل مع الثلج.',
        'یوزو و لیمۆ و کەمێک هەنگوین لەگەڵ سەهۆڵ.',
      ),
      ingredients: list(['Yuzu', 'Lemon', 'Honey'], ['يوزو', 'ليمون', 'عسل'], ['یوزو', 'لیمۆ', 'هەنگوین']),
      allergens: [],
      variants: SIZE_VARIANTS(35),
    },
    {
      slug: 'orange-juice',
      category: 'cold',
      price: 500,
      cost: 130,
      popularity: 62,
      priority: 50,
      slot: 'DRINK',
      art: 'glass',
      tone: '#E58A2E',
      name: t('Fresh Orange Juice', 'عصير برتقال طازج', 'شەربەتی پرتەقاڵی تازە'),
      description: t(
        'Pressed to order from whole oranges.',
        'يُعصر عند الطلب من برتقال كامل.',
        'لەکاتی داواکاری لە پرتەقاڵی تەواو دەگوشرێت.',
      ),
      ingredients: list(['Orange'], ['برتقال'], ['پرتەقاڵ']),
      allergens: [],
    },
    {
      slug: 'sparkling-water',
      category: 'cold',
      price: 300,
      cost: 60,
      popularity: 55,
      priority: 40,
      slot: 'DRINK',
      art: 'glass',
      tone: '#CFE3E6',
      name: t('Sparkling Water 500 ml', 'مياه غازية ٥٠٠ مل', 'ئاوی گازدار ٥٠٠ مل'),
      description: t(
        'Chilled mineral water with fine bubbles.',
        'مياه معدنية باردة بفقاعات ناعمة.',
        'ئاوی کانزایی سارد بە بلقی ورد.',
      ),
      ingredients: list(['Mineral water'], ['مياه معدنية'], ['ئاوی کانزایی']),
      allergens: [],
    },
  ],
  pairingRules: [
    { source: { product: 'atelier-burger' }, target: 'truffle-fries', weight: 90, reason: REASON.fries },
    { source: { product: 'atelier-burger' }, target: 'yuzu-lemonade', weight: 70, reason: REASON.coldDrink },
    { source: { product: 'atelier-burger' }, target: 'sparkling-water', weight: 50, reason: REASON.bubbles },
    { source: { product: 'wagyu-burger' }, target: 'truffle-fries', weight: 90, reason: REASON.fries },
    { source: { product: 'wagyu-burger' }, target: 'sparkling-water', weight: 60, reason: REASON.bubbles },
    { source: { product: 'ribeye' }, target: 'truffle-fries', weight: 85, reason: REASON.steakSide },
    { source: { product: 'ribeye' }, target: 'yuzu-lemonade', weight: 50, reason: REASON.coldDrink },
    { source: { product: 'truffle-pasta' }, target: 'caesar-salad', weight: 80, reason: REASON.starter },
    { source: { product: 'truffle-pasta' }, target: 'tarte-citron', weight: 60, reason: REASON.finish },
    { source: { category: 'coffee-tea' }, target: 'croissant', weight: 85, reason: REASON.withCoffee },
    { source: { category: 'coffee-tea' }, target: 'tarte-citron', weight: 55, reason: REASON.sweet },
    { source: { category: 'coffee-tea' }, target: 'basque-cheesecake', weight: 50, reason: REASON.sweet },
    { source: { product: 'espresso' }, target: 'chocolate-fondant', weight: 70, reason: REASON.chocolate },
    { source: { category: 'patisserie' }, target: 'flat-white', weight: 70, reason: REASON.coffeeAfter },
    { source: { category: 'patisserie' }, target: 'espresso', weight: 60, reason: REASON.coffeeAfter },
    { source: { product: 'shakshuka' }, target: 'orange-juice', weight: 65, reason: REASON.juice },
    { source: { product: 'shakshuka' }, target: 'flat-white', weight: 60, reason: REASON.flatWhite },
    { source: { product: 'avocado-toast' }, target: 'flat-white', weight: 70, reason: REASON.flatWhite },
    { source: { product: 'avocado-toast' }, target: 'orange-juice', weight: 60, reason: REASON.juice },
    { source: { product: 'granola-bowl' }, target: 'orange-juice', weight: 60, reason: REASON.juice },
  ],
  upsellRules: [
    {
      source: 'atelier-burger',
      target: 'wagyu-burger',
      priority: 80,
      pitch: t('Wagyu burger', 'برغر واغيو', 'بەرگەری واگیو'),
      effect: t(
        'Wagyu beef patty and truffle mayo on a toasted brioche bun',
        'قرص لحم واغيو ومايونيز الكمأة على خبز بريوش محمّص',
        'پارچەی گۆشتی واگیو و مایۆنیزی ترۆفڵ لەسەر بریۆشی برژاو',
      ),
    },
  ],
  bundles: [
    {
      slug: 'breakfast-set',
      price: 1150,
      dayparts: ['BREAKFAST'],
      name: t('Breakfast set', 'باقة الفطور', 'پاکێجی نانی بەیانی'),
      description: t(
        'Croissant, flat white and fresh orange juice',
        'كرواسون وفلات وايت وعصير برتقال طازج',
        'کرواسان، فلات وایت و شەربەتی پرتەقاڵی تازە',
      ),
      items: [
        { product: 'croissant', quantity: 1 },
        { product: 'flat-white', quantity: 1 },
        { product: 'orange-juice', quantity: 1 },
      ],
    },
    {
      slug: 'burger-set',
      price: 1550,
      name: t('Burger set', 'وجبة البرغر', 'پاکێجی بەرگەر'),
      description: t(
        'Atelier burger, truffle fries and sparkling water',
        'برغر أتيليه وبطاطس بالكمأة ومياه غازية',
        'بەرگەری ئاتەلیە، پەتاتەی ترۆفڵ و ئاوی گازدار',
      ),
      items: [
        { product: 'atelier-burger', quantity: 1 },
        { product: 'truffle-fries', quantity: 1 },
        { product: 'sparkling-water', quantity: 1 },
      ],
    },
  ],
  schedule: [
    { daypart: 'BREAKFAST', startMinute: 420, endMinute: 660, daysOfWeek: 127 },
    { daypart: 'LUNCH', startMinute: 660, endMinute: 960, daysOfWeek: 127 },
    { daypart: 'DINNER', startMinute: 960, endMinute: 1320, daysOfWeek: 127 },
    { daypart: 'LATE_NIGHT', startMinute: 1320, endMinute: 180, daysOfWeek: 127 },
  ],
  tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};
```

- [ ] **Step 6: Implement `prisma/seed/validate.ts`**

```ts
import type { SeedData, Tri } from './atelier';

const LOCALES = ['en', 'ar', 'ckb'] as const;
const ARABIC_SCRIPT = /[؀-ۿ]/;

function checkTri(problems: string[], label: string, value: Tri | undefined): void {
  if (!value) {
    problems.push(`${label}: missing`);
    return;
  }
  for (const locale of LOCALES) {
    const text = value[locale];
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${label}: missing ${locale} text`);
    } else if (locale !== 'en' && !ARABIC_SCRIPT.test(text)) {
      problems.push(`${label}: ${locale} text is not in Arabic script ("${text}")`);
    }
  }
}

export function validateSeed(data: SeedData): string[] {
  const problems: string[] = [];
  const categories = new Set(data.categories.map((c) => c.slug));
  const slugs = new Set<string>();

  for (const category of data.categories) checkTri(problems, `category ${category.slug} name`, category.name);

  for (const product of data.products) {
    const label = `product ${product.slug}`;
    if (slugs.has(product.slug)) problems.push(`${label}: duplicate slug`);
    slugs.add(product.slug);
    if (!categories.has(product.category)) problems.push(`${label}: unknown category ${product.category}`);
    if (product.price <= 0) problems.push(`${label}: price must be positive`);
    if (product.cost !== null && product.cost >= product.price) {
      problems.push(`${label}: cost ${product.cost} is not below price ${product.price}`);
    }
    checkTri(problems, `${label} name`, product.name);
    checkTri(problems, `${label} description`, product.description);
    for (const locale of LOCALES) {
      if (product.ingredients[locale].length !== product.ingredients.en.length) {
        problems.push(`${label}: ${locale} ingredients count differs from English`);
      }
    }
    for (const group of product.groups ?? []) {
      checkTri(problems, `${label} group name`, group.name);
      if (group.min > group.max) problems.push(`${label}: group min above max`);
      for (const option of group.options) {
        checkTri(problems, `${label} option`, option.name);
        if (option.effect) checkTri(problems, `${label} option effect`, option.effect);
      }
    }
    for (const variant of product.variants ?? []) checkTri(problems, `${label} variant`, variant.name);
  }

  for (const rule of data.pairingRules) {
    const source = 'product' in rule.source ? rule.source.product : rule.source.category;
    const known = 'product' in rule.source ? slugs.has(source) : categories.has(source);
    if (!known) problems.push(`pairing rule: unknown source ${source}`);
    if (!slugs.has(rule.target)) problems.push(`pairing rule: unknown target ${rule.target}`);
    checkTri(problems, `pairing ${source}->${rule.target} reason`, rule.reason);
  }

  for (const rule of data.upsellRules) {
    if (!slugs.has(rule.source)) problems.push(`upsell rule: unknown source ${rule.source}`);
    if (!slugs.has(rule.target)) problems.push(`upsell rule: unknown target ${rule.target}`);
    checkTri(problems, `upsell ${rule.source} pitch`, rule.pitch);
    checkTri(problems, `upsell ${rule.source} effect`, rule.effect);
  }

  const priceBySlug = new Map(data.products.map((p) => [p.slug, p.price]));
  for (const bundle of data.bundles) {
    checkTri(problems, `bundle ${bundle.slug} name`, bundle.name);
    checkTri(problems, `bundle ${bundle.slug} description`, bundle.description);
    let total = 0;
    for (const item of bundle.items) {
      const price = priceBySlug.get(item.product);
      if (price === undefined) {
        problems.push(`bundle ${bundle.slug}: unknown item ${item.product}`);
        continue;
      }
      total += price * item.quantity;
    }
    if (bundle.price >= total) {
      problems.push(`bundle ${bundle.slug}: price ${bundle.price} is not cheaper than its items (${total})`);
    }
  }

  for (const window of data.schedule) {
    if (window.startMinute < 0 || window.startMinute > 1439 || window.endMinute < 0 || window.endMinute > 1439) {
      problems.push(`schedule ${window.daypart}: minutes out of range`);
    }
  }
  return problems;
}

export function assertSeedValid(data: SeedData): void {
  const problems = validateSeed(data);
  if (problems.length > 0) throw new Error(`Seed data is invalid:\n- ${problems.join('\n- ')}`);
}
```

- [ ] **Step 7: Implement `prisma/seed/apply.ts` and `prisma/seed.ts`**

`prisma/seed/apply.ts`:

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { LOCALES } from '@/lib/locale';
import type { SeedData, Tri } from './atelier';

type TranslationJson = Record<string, Record<string, string>>;

function translations(fields: Record<string, Tri>): TranslationJson {
  const out: TranslationJson = {};
  for (const locale of LOCALES) {
    out[locale] = {};
    for (const [field, tri] of Object.entries(fields)) out[locale]![field] = tri[locale];
  }
  return out;
}

export async function seedRestaurant(prisma: PrismaClient, data: SeedData): Promise<{ restaurantId: string }> {
  await prisma.restaurant.deleteMany({ where: { slug: data.restaurant.slug } });

  const r = data.restaurant;
  const restaurant = await prisma.restaurant.create({
    data: {
      slug: r.slug,
      name: r.name,
      currency: r.currency,
      defaultLocale: r.defaultLocale,
      locales: r.locales,
      timezone: r.timezone,
      numeralSystem: r.numeralSystem,
      engineConfig: {},
      domains: { create: r.domains.map((host) => ({ host })) },
      brand: {
        create: {
          tokens: data.brand.tokens,
          typography: data.brand.typography,
          theme: data.brand.theme,
          motionIntensity: data.brand.motionIntensity,
          navStyle: data.brand.navStyle,
          logoText: data.brand.logoText,
        },
      },
    },
  });
  const restaurantId = restaurant.id;

  const categoryIds = new Map<string, string>();
  for (const [index, category] of data.categories.entries()) {
    const row = await prisma.category.create({
      data: { restaurantId, slug: category.slug, sortOrder: index, translations: translations({ name: category.name }) },
    });
    categoryIds.set(category.slug, row.id);
  }

  const productIds = new Map<string, string>();
  for (const [index, product] of data.products.entries()) {
    const row = await prisma.product.create({
      data: {
        restaurantId,
        categoryId: categoryIds.get(product.category) as string,
        slug: product.slug,
        basePrice: product.price,
        cost: product.cost,
        popularity: product.popularity,
        priority: product.priority,
        isSignature: product.signature ?? false,
        isFeatured: product.featured ?? false,
        stockCount: product.stock ?? null,
        lowStockThreshold: product.lowStock ?? null,
        dayparts: product.dayparts ?? [],
        hideOutsideDaypart: product.hideOutsideDaypart ?? false,
        slot: product.slot ?? null,
        allergens: product.allergens,
        ingredients: product.ingredients,
        media: [{ kind: 'art', art: product.art, tone: product.tone }],
        translations: translations({ name: product.name, description: product.description }),
        sortOrder: index,
        variants: {
          create: (product.variants ?? []).map((variant, order) => ({
            restaurantId,
            priceDelta: variant.priceDelta,
            costDelta: variant.costDelta,
            isDefault: variant.isDefault ?? false,
            translations: translations({ name: variant.name }),
            sortOrder: order,
          })),
        },
        groups: {
          create: (product.groups ?? []).map((group, order) => ({
            restaurantId,
            minSelect: group.min,
            maxSelect: group.max,
            translations: translations({ name: group.name }),
            sortOrder: order,
            options: {
              create: group.options.map((option, optionOrder) => ({
                restaurantId,
                priceDelta: option.priceDelta,
                costDelta: option.costDelta,
                isSuggested: option.suggested ?? false,
                suggestPriority: option.suggestPriority ?? 50,
                translations: translations({
                  name: option.name,
                  ...(option.effect ? { effect: option.effect } : {}),
                }),
                sortOrder: optionOrder,
              })),
            },
          })),
        },
      },
    });
    productIds.set(product.slug, row.id);
  }

  const productId = (slug: string) => productIds.get(slug) as string;

  for (const rule of data.pairingRules) {
    const bySource = rule.source;
    await prisma.pairingRule.create({
      data: {
        restaurantId,
        sourceType: 'product' in bySource ? 'PRODUCT' : 'CATEGORY',
        sourceProductId: 'product' in bySource ? productId(bySource.product) : null,
        sourceCategoryId: 'category' in bySource ? (categoryIds.get(bySource.category) as string) : null,
        targetProductId: productId(rule.target),
        weight: rule.weight,
        dayparts: rule.dayparts ?? [],
        translations: translations({ reason: rule.reason }),
      },
    });
  }

  for (const rule of data.upsellRules) {
    await prisma.upsellRule.create({
      data: {
        restaurantId,
        sourceProductId: productId(rule.source),
        targetProductId: productId(rule.target),
        priority: rule.priority,
        translations: translations({ pitch: rule.pitch, effect: rule.effect }),
      },
    });
  }

  for (const bundle of data.bundles) {
    await prisma.bundle.create({
      data: {
        restaurantId,
        slug: bundle.slug,
        price: bundle.price,
        dayparts: bundle.dayparts ?? [],
        translations: translations({ name: bundle.name, description: bundle.description }),
        items: {
          create: bundle.items.map((item) => ({
            restaurantId,
            productId: productId(item.product),
            variantId: null,
            quantity: item.quantity,
          })),
        },
      },
    });
  }

  await prisma.daypartSchedule.createMany({
    data: data.schedule.map((window) => ({ restaurantId, ...window })),
  });
  await prisma.table.createMany({
    data: data.tables.map((number) => ({
      restaurantId,
      number,
      label: `Table ${String(number).padStart(2, '0')}`,
    })),
  });

  return { restaurantId };
}
```

`prisma/seed.ts`:

```ts
import 'dotenv/config';
import { createPrisma } from '@/server/data/prisma';
import { ATELIER } from './seed/atelier';
import { seedRestaurant } from './seed/apply';
import { assertSeedValid } from './seed/validate';

async function main() {
  assertSeedValid(ATELIER);
  const prisma = createPrisma();
  try {
    const { restaurantId } = await seedRestaurant(prisma, ATELIER);
    console.log(`Seeded ${ATELIER.restaurant.slug} (${restaurantId}): ${ATELIER.products.length} products`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 8: Run the tests, then seed the dev database**

Run: `npx vitest run tests/lib/media.test.ts tests/seed`
Expected: PASS. If `validateSeed(ATELIER)` reports problems, fix the seed data, not the validator, unless the validator is wrong.

Run: `npm run db:up && npm run db:seed`
Expected: prints `Seeded atelier (<id>): 24 products`.

- [ ] **Step 9: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src/lib/media.ts prisma tests
git commit -m "feat(seed): ATELIER dataset with three-language content and integrity checks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Data layer: loaders, tenant resolution, menu and quote views

**Files:**
- Create: `src/lib/brand.ts`
- Create: `src/server/data/cache.ts`, `src/server/data/catalog-loader.ts`, `src/server/data/tenant.ts`, `src/server/data/menu-view.ts`, `src/server/data/quote-view.ts`, `src/server/data/events.ts`
- Test: `tests/lib/brand.test.ts`, `tests/data/loader.test.ts`, `tests/data/menu-view.test.ts`, `tests/data/quote-view.test.ts`

**Interfaces:**
- Consumes: `scopedDb`, `createPrisma`, `getPrisma`, `seedRestaurant`, `ATELIER`, domain functions, `parseMedia`, `normalizeSearch`.
- Produces from `cache.ts`: `cached<T>(fn: () => Promise<T>, keyParts: string[], options: { revalidate: number; tags: string[] }): () => Promise<T>` (uses `unstable_cache` only inside the Next runtime).
- Produces from `catalog-loader.ts`: `loadCatalog(prisma, restaurantId): Promise<Catalog>`, `getCatalog(restaurantId): Promise<Catalog>` (cached, 300 s, tag `catalog:{restaurantId}`).
- Produces from `src/lib/brand.ts`: `Palette`, `HEX`, `DEFAULT_PALETTES`, `sanitizePalette(input: unknown, fallback: Palette): Palette` (every colour must be a six-digit hex value, otherwise the fallback is used, so stored brand data can never inject CSS).
- Produces from `tenant.ts`: `Palette` (re-export), `BrandView`, `TenantInfo`, `findTenant(prisma, ref: { slug?: string; host?: string }): Promise<TenantInfo | null>`, `getTenant(slug: string): Promise<TenantInfo | null>` (cached 60 s).
- Produces from `menu-view.ts`: `MenuOptionView`, `MenuGroupView`, `MenuVariantView`, `MenuProductView`, `MenuView`, `buildMenuView(catalog, tenant, locale, now): MenuView`.
- Produces from `quote-view.ts`: `QuoteLineView`, `QuoteBundleView`, `QuoteView`, `describeQuote(catalog, quote, locale): QuoteView`.
- Produces from `events.ts`: `EventInput`, `recordEvents(prisma, restaurantId, input: { anonymousSessionId: string; tableNumber: number | null; events: EventInput[] }): Promise<number>`.

- [ ] **Step 0: Write the failing brand test and implement `src/lib/brand.ts`**

`tests/lib/brand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES, sanitizePalette } from '@/lib/brand';

describe('sanitizePalette', () => {
  const fallback = DEFAULT_PALETTES.dark;

  it('keeps valid hex colours', () => {
    const palette = { ...fallback, accent: '#112233' };
    expect(sanitizePalette(palette, fallback).accent).toBe('#112233');
  });

  it('replaces invalid colours with the fallback instead of passing them through', () => {
    const hostile = { ...fallback, bg: 'red;}body{display:none', accent: 'url(javascript:alert(1))', text: '#GGGGGG' };
    const result = sanitizePalette(hostile, fallback);
    expect(result.bg).toBe(fallback.bg);
    expect(result.accent).toBe(fallback.accent);
    expect(result.text).toBe(fallback.text);
  });

  it('returns the fallback for non-objects and missing keys', () => {
    expect(sanitizePalette(null, fallback)).toEqual(fallback);
    expect(sanitizePalette('nope', fallback)).toEqual(fallback);
    expect(sanitizePalette({ bg: '#000000' }, fallback).surface).toBe(fallback.surface);
  });
});
```

Run: `npx vitest run tests/lib/brand.test.ts`
Expected: FAIL, cannot find `@/lib/brand`.

`src/lib/brand.ts`:

```ts
export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  accent: string;
  text: string;
  muted: string;
  line: string;
  onAccent: string;
}

export const HEX = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_PALETTES: { dark: Palette; light: Palette } = {
  dark: {
    bg: '#0E0E0F',
    surface: '#1B1A19',
    raised: '#2A2826',
    accent: '#D6BC8A',
    text: '#EDE8DF',
    muted: '#A7A096',
    line: '#3A3633',
    onAccent: '#0E0E0F',
  },
  light: {
    bg: '#F7F5F1',
    surface: '#FFFFFF',
    raised: '#EFEBE4',
    accent: '#7A5F26',
    text: '#1B1A19',
    muted: '#6B655D',
    line: '#D9D3C9',
    onAccent: '#FFFFFF',
  },
};

const KEYS: Array<keyof Palette> = ['bg', 'surface', 'raised', 'accent', 'text', 'muted', 'line', 'onAccent'];

export function sanitizePalette(input: unknown, fallback: Palette): Palette {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const result = { ...fallback };
  for (const key of KEYS) {
    const value = source[key];
    if (typeof value === 'string' && HEX.test(value)) result[key] = value;
  }
  return result;
}
```

Run: `npx vitest run tests/lib/brand.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 1: Write the failing loader test (real database)**

`tests/data/loader.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATELIER } from '../../prisma/seed/atelier';
import { seedRestaurant } from '../../prisma/seed/apply';
import { loadCatalog } from '@/server/data/catalog-loader';
import { findTenant } from '@/server/data/tenant';
import { recordEvents } from '@/server/data/events';
import { resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
let restaurantId = '';

describe('data layer (database)', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
    restaurantId = (await seedRestaurant(prisma, ATELIER)).restaurantId;
  });
  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  it('loads the full ATELIER catalog into domain types', async () => {
    const catalog = await loadCatalog(prisma, restaurantId);
    expect(catalog.currency).toBe('USD');
    expect(catalog.timeZone).toBe('Asia/Baghdad');
    expect(catalog.products).toHaveLength(24);
    expect(catalog.categories).toHaveLength(5);
    expect(catalog.bundles).toHaveLength(2);
    expect(catalog.schedule).toHaveLength(4);
    const burger = catalog.products.find((p) => p.slug === 'atelier-burger')!;
    expect(burger.basePrice).toBe(900);
    expect(burger.groups[0]?.options.map((o) => o.priceDelta)).toEqual([100, 300, 150]);
    expect(burger.slot).toBe('MAIN');
    expect(burger.translations.ckb?.name).toBeTruthy();
  });

  it('resolves a tenant by slug and by host', async () => {
    const bySlug = await findTenant(prisma, { slug: 'atelier' });
    expect(bySlug?.name).toBe('ATELIER');
    expect(bySlug?.locales).toEqual(['en', 'ar', 'ckb']);
    expect(bySlug?.brand.tokens.dark.accent).toBe('#D6BC8A');
    const byHost = await findTenant(prisma, { host: 'atelier.localhost' });
    expect(byHost?.id).toBe(bySlug?.id);
  });

  it('rejects unknown, malformed and suspended tenants', async () => {
    expect(await findTenant(prisma, { slug: 'nope' })).toBeNull();
    expect(await findTenant(prisma, { slug: "x'; DROP TABLE" })).toBeNull();
    expect(await findTenant(prisma, { slug: '' })).toBeNull();
    expect(await findTenant(prisma, { host: 'unknown.example' })).toBeNull();
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { status: 'SUSPENDED' } });
    expect(await findTenant(prisma, { slug: 'atelier' })).toBeNull();
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { status: 'ACTIVE' } });
  });

  it('records analytics events scoped to the tenant', async () => {
    const stored = await recordEvents(prisma, restaurantId, {
      anonymousSessionId: 'session-12345',
      tableNumber: 4,
      events: [
        { type: 'MENU_VIEW', payload: {} },
        { type: 'UPSELL_IMPRESSION', productId: 'p1', suggestionId: 'up:p1:OPTION:o1', payload: { position: 0 } },
      ],
    });
    expect(stored).toBe(2);
    const rows = await prisma.analyticsEvent.findMany({ where: { restaurantId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.tableNumber === 4)).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing menu-view test (pure)**

`tests/data/menu-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMenuView } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { at, IDS, makeCatalog, withProduct } from '../domain/fixtures';

const tenant: TenantInfo = {
  id: 'r-test',
  slug: 'test',
  name: 'Test',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en', 'ar', 'ckb'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  brand: {
    logoText: 'TEST',
    theme: 'dark',
    motionIntensity: 'subtle',
    tokens: {
      dark: { bg: '#000000', surface: '#111111', raised: '#222222', accent: '#D6BC8A', text: '#ffffff', muted: '#999999', line: '#333333', onAccent: '#000000' },
      light: { bg: '#ffffff', surface: '#ffffff', raised: '#eeeeee', accent: '#7A5F26', text: '#000000', muted: '#666666', line: '#dddddd', onAccent: '#ffffff' },
    },
  },
};

describe('buildMenuView', () => {
  it('groups products under ordered categories with localized text', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    expect(view.categories.map((c) => c.slug)).toEqual(['coffee', 'breakfast', 'plates', 'patisserie', 'cold']);
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(burger.name).toBe(IDS.burger); // fixture names equal ids
    expect(burger.groups[0]?.options.map((o) => o.name)).toEqual(['Premium cheese', 'Double patty', 'Bacon']);
  });

  it('flags products that need choices and keeps simple ones quick-addable', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.steak)?.needsChoices).toBe(true);
    expect(view.products.find((p) => p.id === IDS.burger)?.needsChoices).toBe(false);
    expect(view.products.find((p) => p.id === IDS.fries)?.needsChoices).toBe(false);
  });

  it('shows unavailable products as unavailable and hides out-of-daypart ones', () => {
    let catalog = withProduct(makeCatalog(), IDS.fries, { isAvailable: false });
    catalog = withProduct(catalog, IDS.croissant, { hideOutsideDaypart: true });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.fries)?.orderState).toBe('UNAVAILABLE');
    expect(view.products.some((p) => p.id === IDS.croissant)).toBe(false);
    expect(buildMenuView(catalog, tenant, 'en', at(9)).products.some((p) => p.id === IDS.croissant)).toBe(true);
  });

  it('builds a search key across all locales and ingredients', () => {
    const catalog = withProduct(makeCatalog(), IDS.espresso, {
      translations: { en: { name: 'Espresso', description: '' }, ar: { name: 'إسبريسو' }, ckb: { name: 'ئێسپرێسۆ' } },
      ingredients: { en: ['Coffee'], ar: ['قهوة'] },
    });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    const key = view.products.find((p) => p.id === IDS.espresso)!.searchKey;
    expect(key).toContain('espresso');
    expect(key).toContain('اسبريسو');
    expect(key).toContain('قهوه');
  });

  it('picks the signature product for the daypart and reports the daypart', () => {
    const catalog = withProduct(makeCatalog(), IDS.croissant, { isSignature: true });
    const view = buildMenuView(catalog, tenant, 'en', at(9));
    expect(view.daypart).toBe('BREAKFAST');
    expect(view.signatureProductId).toBe(IDS.croissant);
  });

  it('falls back to the default locale when a translation is missing', () => {
    const view = buildMenuView(makeCatalog(), tenant, 'ckb', at(12));
    expect(view.products.find((p) => p.id === IDS.burger)?.name).toBe(IDS.burger);
    expect(view.categories[0]?.name).toBe('Coffee');
  });

  it('drops invalid media entries instead of failing', () => {
    const catalog = withProduct(makeCatalog(), IDS.fries, {
      media: [{ kind: 'image', url: 'javascript:alert(1)', alt: 'x', width: 1, height: 1 }, { kind: 'art', art: 'plate', tone: '#D9B45A' }],
    });
    const view = buildMenuView(catalog, tenant, 'en', at(12));
    expect(view.products.find((p) => p.id === IDS.fries)?.media).toEqual([{ kind: 'art', art: 'plate', tone: '#D9B45A' }]);
  });
});
```

- [ ] **Step 3: Write the failing quote-view test (pure)**

`tests/data/quote-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeQuote } from '@/server/data/quote-view';
import { quoteCart } from '@/server/domain/pricing';
import { at, IDS, makeCatalog } from '../domain/fixtures';

describe('describeQuote', () => {
  it('adds localized names to quote lines and bundles', () => {
    const catalog = makeCatalog();
    const quote = quoteCart(
      catalog,
      {
        lines: [{ productId: IDS.burger, variantId: null, optionIds: [IDS.optCheese], quantity: 1 }],
        bundles: [{ bundleId: 'b-burger-meal', quantity: 1 }],
      },
      at(12),
    );
    const view = describeQuote(catalog, quote, 'en');
    expect(view.lines[0]).toMatchObject({ name: IDS.burger, optionNames: ['Premium cheese'], variantName: null });
    expect(view.bundles[0]).toMatchObject({ name: 'Burger meal' });
    expect(view.subtotal).toBe(quote.subtotal);
  });

  it('names a stale product as an empty string without throwing', () => {
    const catalog = makeCatalog();
    const quote = quoteCart(
      catalog,
      { lines: [{ productId: 'gone', variantId: null, optionIds: [], quantity: 1 }], bundles: [] },
      at(12),
    );
    expect(describeQuote(catalog, quote, 'en').lines[0]?.name).toBe('');
  });
});
```

- [ ] **Step 4: Run them to confirm they fail**

Run: `npx vitest run tests/data/loader.test.ts tests/data/menu-view.test.ts tests/data/quote-view.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement `cache.ts`, `events.ts` and `catalog-loader.ts`**

`src/server/data/cache.ts`:

```ts
import { unstable_cache } from 'next/cache';

/** Uses the Next.js data cache inside the Next runtime and calls straight through elsewhere (tests, scripts). */
export function cached<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  options: { revalidate: number; tags: string[] },
): () => Promise<T> {
  if (!process.env.NEXT_RUNTIME) return fn;
  return unstable_cache(fn, keyParts, options);
}
```

`src/server/data/events.ts`:

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { scopedDb } from './tenant-db';

export const EVENT_TYPES = [
  'MENU_VIEW',
  'PRODUCT_VIEW',
  'ADD_TO_CART',
  'UPSELL_IMPRESSION',
  'UPSELL_ACCEPT',
  'PAIRING_IMPRESSION',
  'PAIRING_ADD',
  'BUNDLE_IMPRESSION',
  'BUNDLE_ACCEPT',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventInput {
  type: EventType;
  productId?: string;
  suggestionId?: string;
  payload: Record<string, unknown>;
}

export async function recordEvents(
  prisma: PrismaClient,
  restaurantId: string,
  input: { anonymousSessionId: string; tableNumber: number | null; events: EventInput[] },
): Promise<number> {
  const db = scopedDb(prisma, restaurantId);
  const result = await db.analyticsEvent.createMany({
    data: input.events.map((event) => ({
      anonymousSessionId: input.anonymousSessionId,
      tableNumber: input.tableNumber,
      type: event.type,
      productId: event.productId ?? null,
      suggestionId: event.suggestionId ?? null,
      payload: event.payload as never,
    })) as never,
  });
  return result.count;
}
```

`src/server/data/catalog-loader.ts`:

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { isLocale, type Locale } from '@/lib/locale';
import type {
  Catalog,
  CatalogGroup,
  CatalogProduct,
  Daypart,
  TranslationMap,
} from '@/server/domain/types';
import { cached } from './cache';
import { getPrisma } from './prisma';
import { scopedDb } from './tenant-db';

function translationMap(value: unknown): TranslationMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as TranslationMap) : {};
}

function ingredientMap(value: unknown): Partial<Record<Locale, string[]>> {
  const result: Partial<Record<Locale, string[]>> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    if (isLocale(key) && Array.isArray(entry)) result[key] = entry.filter((v): v is string => typeof v === 'string');
  }
  return result;
}

export async function loadCatalog(prisma: PrismaClient, restaurantId: string): Promise<Catalog> {
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
  const db = scopedDb(prisma, restaurantId);

  const [categories, products, upsellRules, pairingRules, bundles, schedule] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    db.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        groups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      },
    }),
    db.upsellRule.findMany({ where: { isActive: true } }),
    db.pairingRule.findMany({ where: { isActive: true } }),
    db.bundle.findMany({ where: { isActive: true }, include: { items: true }, orderBy: { slug: 'asc' } }),
    db.daypartSchedule.findMany({ orderBy: { startMinute: 'asc' } }),
  ]);

  return {
    restaurantId,
    currency: restaurant.currency,
    timeZone: restaurant.timezone,
    defaultLocale: isLocale(restaurant.defaultLocale) ? restaurant.defaultLocale : 'en',
    categories: categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      sortOrder: c.sortOrder,
      translations: translationMap(c.translations),
    })),
    products: products.map<CatalogProduct>((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      slug: p.slug,
      basePrice: p.basePrice,
      cost: p.cost,
      popularity: p.popularity,
      priority: p.priority,
      isSignature: p.isSignature,
      isFeatured: p.isFeatured,
      isAvailable: p.isAvailable,
      stockCount: p.stockCount,
      lowStockThreshold: p.lowStockThreshold,
      dayparts: p.dayparts as Daypart[],
      hideOutsideDaypart: p.hideOutsideDaypart,
      slot: p.slot,
      translations: translationMap(p.translations),
      media: Array.isArray(p.media) ? (p.media as unknown[]) : [],
      allergens: p.allergens,
      ingredients: ingredientMap(p.ingredients),
      sortOrder: p.sortOrder,
      variants: p.variants.map((v) => ({
        id: v.id,
        productId: v.productId,
        priceDelta: v.priceDelta,
        costDelta: v.costDelta,
        isDefault: v.isDefault,
        translations: translationMap(v.translations),
      })),
      groups: p.groups.map<CatalogGroup>((g) => ({
        id: g.id,
        productId: g.productId,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        translations: translationMap(g.translations),
        options: g.options.map((o) => ({
          id: o.id,
          groupId: o.groupId,
          priceDelta: o.priceDelta,
          costDelta: o.costDelta,
          isSuggested: o.isSuggested,
          suggestPriority: o.suggestPriority,
          isAvailable: o.isAvailable,
          translations: translationMap(o.translations),
        })),
      })),
    })),
    upsellRules: upsellRules.map((r) => ({
      id: r.id,
      sourceProductId: r.sourceProductId,
      targetProductId: r.targetProductId,
      priority: r.priority,
      dayparts: r.dayparts as Daypart[],
      translations: translationMap(r.translations),
    })),
    pairingRules: pairingRules.map((r) => ({
      id: r.id,
      sourceType: r.sourceType,
      sourceProductId: r.sourceProductId,
      sourceCategoryId: r.sourceCategoryId,
      targetProductId: r.targetProductId,
      weight: r.weight,
      dayparts: r.dayparts as Daypart[],
      translations: translationMap(r.translations),
    })),
    bundles: bundles.map((b) => ({
      id: b.id,
      slug: b.slug,
      price: b.price,
      dayparts: b.dayparts as Daypart[],
      translations: translationMap(b.translations),
      items: b.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
    })),
    schedule: schedule.map((s) => ({
      daypart: s.daypart as Daypart,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      daysOfWeek: s.daysOfWeek,
    })),
  };
}

export function getCatalog(restaurantId: string): Promise<Catalog> {
  return cached(() => loadCatalog(getPrisma(), restaurantId), ['catalog', restaurantId], {
    revalidate: 300,
    tags: [`catalog:${restaurantId}`],
  })();
}
```

- [ ] **Step 6: Implement `tenant.ts`**

```ts
import type { PrismaClient } from '@/generated/prisma/client';
import { DEFAULT_PALETTES, sanitizePalette, type Palette } from '@/lib/brand';
import { isLocale, type Locale } from '@/lib/locale';
import { resolveEngineConfig, type EngineConfig } from '@/server/domain/config';
import { cached } from './cache';
import { getPrisma } from './prisma';

export type { Palette };

export interface BrandView {
  logoText: string;
  theme: 'dark' | 'light';
  motionIntensity: 'none' | 'subtle' | 'expressive';
  tokens: { dark: Palette; light: Palette };
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  currency: string;
  defaultLocale: Locale;
  locales: Locale[];
  timeZone: string;
  numeralSystem: 'latn' | 'arab';
  engineConfig: EngineConfig;
  brand: BrandView;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOST = /^[a-z0-9.-]{1,253}$/;

export async function findTenant(
  prisma: PrismaClient,
  ref: { slug?: string; host?: string },
): Promise<TenantInfo | null> {
  let restaurantId: string | null = null;
  let where: { slug: string } | { id: string };

  if (ref.slug !== undefined) {
    if (!SLUG.test(ref.slug)) return null;
    where = { slug: ref.slug };
  } else if (ref.host !== undefined) {
    const host = ref.host.toLowerCase().split(':')[0] ?? '';
    if (!HOST.test(host)) return null;
    const domain = await prisma.restaurantDomain.findUnique({ where: { host } });
    restaurantId = domain?.restaurantId ?? null;
    if (!restaurantId) return null;
    where = { id: restaurantId };
  } else {
    return null;
  }

  const row = await prisma.restaurant.findUnique({ where, include: { brand: true } });
  if (!row || row.status !== 'ACTIVE') return null;

  const rawTokens = (row.brand?.tokens ?? {}) as { dark?: unknown; light?: unknown };
  const locales = row.locales.filter(isLocale);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : 'en',
    locales: locales.length > 0 ? locales : ['en'],
    timeZone: row.timezone,
    numeralSystem: row.numeralSystem === 'ARAB' ? 'arab' : 'latn',
    engineConfig: resolveEngineConfig(row.engineConfig),
    brand: {
      logoText: row.brand?.logoText ?? row.name,
      theme: row.brand?.theme === 'LIGHT' ? 'light' : 'dark',
      motionIntensity:
        row.brand?.motionIntensity === 'none' || row.brand?.motionIntensity === 'expressive'
          ? row.brand.motionIntensity
          : 'subtle',
      tokens: {
        dark: sanitizePalette(rawTokens.dark, DEFAULT_PALETTES.dark),
        light: sanitizePalette(rawTokens.light, DEFAULT_PALETTES.light),
      },
    },
  };
}

export function getTenant(slug: string): Promise<TenantInfo | null> {
  return cached(() => findTenant(getPrisma(), { slug }), ['tenant', slug], {
    revalidate: 60,
    tags: [`tenant:${slug}`],
  })();
}
```

- [ ] **Step 7: Implement `menu-view.ts` and `quote-view.ts`**

`src/server/data/menu-view.ts`:

```ts
import { normalizeSearch } from '@/lib/search';
import { LOCALES, type Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import {
  daypartNow,
  orderability,
  pickSignature,
  resolveText,
  type Catalog,
  type CatalogGroup,
  type CatalogProduct,
  type Daypart,
  type Orderability,
} from '@/server/domain';
import type { TenantInfo } from './tenant';

export interface MenuOptionView {
  id: string;
  name: string;
  effect: string | null;
  priceDelta: number;
  isAvailable: boolean;
}

export interface MenuGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOptionView[];
}

export interface MenuVariantView {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
}

export interface MenuProductView {
  id: string;
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  basePrice: number;
  needsChoices: boolean;
  orderState: Orderability;
  isSignature: boolean;
  media: MediaItem[];
  allergens: string[];
  ingredients: string[];
  searchKey: string;
  groups: MenuGroupView[];
  variants: MenuVariantView[];
}

export interface MenuView {
  restaurant: {
    slug: string;
    name: string;
    currency: string;
    numeralSystem: 'latn' | 'arab';
    locales: Locale[];
    defaultLocale: Locale;
  };
  daypart: Daypart | null;
  categories: Array<{ id: string; slug: string; name: string }>;
  products: MenuProductView[];
  signatureProductId: string | null;
}

function mapGroup(group: CatalogGroup, locale: Locale, fallback: Locale): MenuGroupView {
  return {
    id: group.id,
    name: resolveText(group.translations, 'name', locale, fallback),
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: group.options.map((option) => ({
      id: option.id,
      name: resolveText(option.translations, 'name', locale, fallback),
      effect: resolveText(option.translations, 'effect', locale, fallback) || null,
      priceDelta: option.priceDelta,
      isAvailable: option.isAvailable,
    })),
  };
}

function searchKey(product: CatalogProduct): string {
  const parts: string[] = [product.slug];
  for (const locale of LOCALES) {
    parts.push(product.translations[locale]?.name ?? '', product.translations[locale]?.description ?? '');
    parts.push(...(product.ingredients[locale] ?? []));
  }
  return normalizeSearch(parts.join(' '));
}

export function buildMenuView(catalog: Catalog, tenant: TenantInfo, locale: Locale, now: Date): MenuView {
  const fallback = catalog.defaultLocale;
  const current = daypartNow(catalog, now);
  const categoryOrder = new Map(catalog.categories.map((category, index) => [category.id, index]));

  const products = catalog.products
    .filter((product) => orderability(product, current) !== 'OUT_OF_DAYPART')
    .map<MenuProductView>((product) => ({
      id: product.id,
      slug: product.slug,
      categoryId: product.categoryId,
      name: resolveText(product.translations, 'name', locale, fallback),
      description: resolveText(product.translations, 'description', locale, fallback),
      basePrice: product.basePrice,
      needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
      orderState: orderability(product, current),
      isSignature: product.isSignature,
      media: parseMedia(product.media),
      allergens: product.allergens,
      ingredients: product.ingredients[locale] ?? product.ingredients[fallback] ?? product.ingredients.en ?? [],
      searchKey: searchKey(product),
      groups: product.groups.map((group) => mapGroup(group, locale, fallback)),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: resolveText(variant.translations, 'name', locale, fallback),
        priceDelta: variant.priceDelta,
        isDefault: variant.isDefault,
      })),
    }))
    .sort(
      (a, b) =>
        (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0) ||
        (catalog.products.find((p) => p.id === a.id)?.sortOrder ?? 0) -
          (catalog.products.find((p) => p.id === b.id)?.sortOrder ?? 0) ||
        a.slug.localeCompare(b.slug),
    );

  const signature = pickSignature(catalog, now, tenant.engineConfig);
  return {
    restaurant: {
      slug: tenant.slug,
      name: tenant.name,
      currency: tenant.currency,
      numeralSystem: tenant.numeralSystem,
      locales: tenant.locales,
      defaultLocale: tenant.defaultLocale,
    },
    daypart: current,
    categories: catalog.categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: resolveText(category.translations, 'name', locale, fallback),
    })),
    products,
    signatureProductId: signature?.productId ?? null,
  };
}
```

`src/server/data/quote-view.ts`:

```ts
import type { Locale } from '@/lib/locale';
import type { Catalog, Quote, QuoteBundleLine, QuoteLine } from '@/server/domain';
import { resolveText } from '@/server/domain';

export interface QuoteLineView extends QuoteLine {
  name: string;
  variantName: string | null;
  optionNames: string[];
}

export interface QuoteBundleView extends QuoteBundleLine {
  name: string;
}

export interface QuoteView extends Omit<Quote, 'lines' | 'bundles'> {
  lines: QuoteLineView[];
  bundles: QuoteBundleView[];
}

export function describeQuote(catalog: Catalog, quote: Quote, locale: Locale): QuoteView {
  const fallback = catalog.defaultLocale;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const bundles = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));

  return {
    ...quote,
    lines: quote.lines.map((line) => {
      const product = products.get(line.productId);
      if (!product) return { ...line, name: '', variantName: null, optionNames: [] };
      const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : undefined;
      const optionNames = product.groups
        .flatMap((group) => group.options)
        .filter((option) => line.optionIds.includes(option.id))
        .map((option) => resolveText(option.translations, 'name', locale, fallback));
      return {
        ...line,
        name: resolveText(product.translations, 'name', locale, fallback),
        variantName: variant ? resolveText(variant.translations, 'name', locale, fallback) : null,
        optionNames,
      };
    }),
    bundles: quote.bundles.map((line) => {
      const bundle = bundles.get(line.bundleId);
      return { ...line, name: bundle ? resolveText(bundle.translations, 'name', locale, fallback) : '' };
    }),
  };
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/data tests/domain`
Expected: PASS. In `menu-view.test.ts` the fixture product names equal their ids, which is why the assertions compare against `IDS`.

- [ ] **Step 9: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src/server/data tests/data
git commit -m "feat(data): catalog loader, tenant resolution, menu and quote views, event recording" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Public API: quote, suggestions, events

**Files:**
- Create: `src/server/http/rate-limit.ts`, `src/server/http/schemas.ts`, `src/server/http/route.ts`
- Create: `src/app/api/[tenant]/quote/route.ts`, `src/app/api/[tenant]/suggestions/route.ts`, `src/app/api/[tenant]/events/route.ts`
- Create: `src/server/data/suggestion-view.ts`
- Test: `tests/api/rate-limit.test.ts`, `tests/api/routes.test.ts`

**Interfaces:**
- Consumes: `getTenant`, `getCatalog`, `quoteCart`, `describeQuote`, `buildSuggestions`, `recordEvents`.
- Produces from `rate-limit.ts`: `createRateLimiter({ limit, windowMs }): { check(key: string, nowMs: number): { allowed: boolean; retryAfterMs: number } }`.
- Produces from `schemas.ts`: `quoteRequestSchema`, `suggestionsRequestSchema`, `eventsRequestSchema`.
- Produces from `route.ts`: `problem(status, code, message, headers?)`, `handleTenantRequest(request, ctx, options, handler)`.
- Produces from `suggestion-view.ts`: `PairingView`, `BundleView` (includes `cartAfter: CartInput`, the cart with the set applied, computed by the server), `SuggestionsView`, `describeSuggestions(catalog, response, locale, cart): SuggestionsView`.
- HTTP contract: `POST /api/{tenant}/quote` body `{ locale, cart }` → `{ quote: QuoteView }`; `POST /api/{tenant}/suggestions` body `{ context, locale, product?, cart, dismissedIds }` → `SuggestionsView`; `POST /api/{tenant}/events` body `{ anonymousSessionId, tableNumber, events[] }` → `204`.

- [ ] **Step 1: Write the failing rate-limit test**

`tests/api/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/server/http/rate-limit';

describe('createRateLimiter', () => {
  it('allows up to the limit within the window, then blocks with a retry hint', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 100).allowed).toBe(true);
    expect(limiter.check('a', 200).allowed).toBe(true);
    const blocked = limiter.check('a', 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(700);
  });

  it('frees capacity as old hits leave the window', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    limiter.check('a', 0);
    limiter.check('a', 10);
    expect(limiter.check('a', 500).allowed).toBe(false);
    expect(limiter.check('a', 1001).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 1).allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing route integration test**

`tests/api/routes.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATELIER } from '../../prisma/seed/atelier';
import { seedRestaurant } from '../../prisma/seed/apply';
import { databaseUrl, TEST_DB } from '../../scripts/db-config';
import { createRestaurantFixture, resetTestData, testPrisma } from '../helpers/db';

process.env.DATABASE_URL = databaseUrl(TEST_DB);
const prisma = testPrisma();

type RouteModule = { POST: (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response> };

let quote: RouteModule;
let suggestions: RouteModule;
let events: RouteModule;
let atelier: Awaited<ReturnType<typeof prisma.restaurant.findUniqueOrThrow>>;
let burgerId = '';
let friesId = '';
let otherTenantProductId = '';
let burgerSetId = '';
let cheeseOptionId = '';
let ipCounter = 0;

function post(route: RouteModule, tenant: string, body: unknown, init: { raw?: string; ip?: string } = {}) {
  ipCounter += 1;
  const request = new Request(`http://localhost/api/${tenant}/x`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': init.ip ?? `10.0.0.${ipCounter}` },
    body: init.raw ?? JSON.stringify(body),
  });
  return route.POST(request, { params: Promise.resolve({ tenant }) });
}

describe('public API', () => {
  beforeAll(async () => {
    await resetTestData(prisma);
    await seedRestaurant(prisma, ATELIER);
    const other = await createRestaurantFixture(prisma, 'other-cafe');
    otherTenantProductId = other.product.id;
    atelier = await prisma.restaurant.findUniqueOrThrow({ where: { slug: 'atelier' } });
    const products = await prisma.product.findMany({ where: { restaurantId: atelier.id } });
    burgerId = products.find((p) => p.slug === 'atelier-burger')!.id;
    friesId = products.find((p) => p.slug === 'truffle-fries')!.id;
    const bundle = await prisma.bundle.findFirstOrThrow({ where: { restaurantId: atelier.id, slug: 'burger-set' } });
    burgerSetId = bundle.id;
    const cheese = await prisma.modifierOption.findFirstOrThrow({
      where: { restaurantId: atelier.id, group: { productId: burgerId } },
      orderBy: { sortOrder: 'asc' },
    });
    cheeseOptionId = cheese.id;
    quote = (await import('@/app/api/[tenant]/quote/route')) as RouteModule;
    suggestions = (await import('@/app/api/[tenant]/suggestions/route')) as RouteModule;
    events = (await import('@/app/api/[tenant]/events/route')) as RouteModule;
  });

  afterAll(async () => {
    await resetTestData(prisma);
    await prisma.$disconnect();
  });

  describe('quote', () => {
    it('prices from the database and ignores any client-supplied price', async () => {
      const response = await post(quote, 'atelier', {
        locale: 'en',
        cart: {
          lines: [{ productId: burgerId, variantId: null, optionIds: [cheeseOptionId], quantity: 2, price: 1, unitPrice: 1 }],
          bundles: [],
        },
        subtotal: 1,
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.quote.subtotal).toBe(2000);
      expect(body.quote.lines[0].name).toBe('Atelier Burger');
      expect(body.quote.lines[0].optionNames).toEqual(['Premium cheese']);
    });

    it('flags a stale or foreign product instead of failing', async () => {
      const response = await post(quote, 'atelier', {
        locale: 'en',
        cart: {
          lines: [
            { productId: otherTenantProductId, variantId: null, optionIds: [], quantity: 1 },
            { productId: friesId, variantId: null, optionIds: [], quantity: 1 },
          ],
          bundles: [],
        },
      });
      expect(response.status).toBe(200);
      const { quote: result } = await response.json();
      expect(result.lines[0].issues[0].code).toBe('UNKNOWN_PRODUCT');
      expect(result.subtotal).toBe(550);
      expect(result.hasBlockingIssues).toBe(true);
    });

    it('prices a bundle at its bundle price', async () => {
      const response = await post(quote, 'atelier', {
        locale: 'en',
        cart: { lines: [], bundles: [{ bundleId: burgerSetId, quantity: 1 }] },
      });
      const { quote: result } = await response.json();
      expect(result.subtotal).toBe(1550);
      expect(result.bundles[0].savings).toBe(200);
    });

    it('returns 404 for an unknown tenant and for a malformed slug', async () => {
      expect((await post(quote, 'nope', { locale: 'en', cart: { lines: [], bundles: [] } })).status).toBe(404);
      expect((await post(quote, "x'--", { locale: 'en', cart: { lines: [], bundles: [] } })).status).toBe(404);
    });

    it('rejects invalid JSON, invalid shapes and oversized bodies', async () => {
      expect((await post(quote, 'atelier', null, { raw: '{not json' })).status).toBe(400);
      expect(
        (await post(quote, 'atelier', { locale: 'en', cart: { lines: [{ productId: burgerId, quantity: 99 }], bundles: [] } })).status,
      ).toBe(400);
      expect((await post(quote, 'atelier', { locale: 'xx', cart: { lines: [], bundles: [] } })).status).toBe(400);
      const huge = JSON.stringify({ locale: 'en', cart: { lines: [], bundles: [] }, pad: 'x'.repeat(40_000) });
      expect((await post(quote, 'atelier', null, { raw: huge })).status).toBe(413);
    });

    it('rate limits a single client', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 62; i += 1) {
        const response = await post(quote, 'atelier', { locale: 'en', cart: { lines: [], bundles: [] } }, { ip: '203.0.113.9' });
        statuses.push(response.status);
      }
      expect(statuses.filter((s) => s === 200).length).toBe(60);
      expect(statuses.slice(60)).toEqual([429, 429]);
    });
  });

  describe('suggestions', () => {
    it('returns upgrades and pairings for a product', async () => {
      const response = await post(suggestions, 'atelier', {
        context: 'product',
        locale: 'en',
        product: { productId: burgerId, variantId: null, optionIds: [] },
        cart: { lines: [], bundles: [] },
        dismissedIds: [],
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.upgrades.map((u: { title: string }) => u.title)).toContain('Premium cheese');
      expect(body.pairings[0].name).toBe('Truffle Fries');
      expect(body.pairings[0].price).toBe(550);
    });

    it('finds a bundle opportunity from the cart', async () => {
      const products = await prisma.product.findMany({ where: { restaurantId: atelier.id } });
      const idOf = (slug: string) => products.find((p) => p.slug === slug)!.id;
      const response = await post(suggestions, 'atelier', {
        context: 'cart',
        locale: 'en',
        cart: {
          lines: ['atelier-burger', 'truffle-fries', 'sparkling-water'].map((slug) => ({
            productId: idOf(slug),
            variantId: null,
            optionIds: [],
            quantity: 1,
          })),
          bundles: [],
        },
        dismissedIds: [],
      });
      const body = await response.json();
      expect(body.bundles[0]).toMatchObject({ name: 'Burger set', savings: 200, times: 1 });
      expect(body.bundles[0].cartAfter.lines).toEqual([]);
      expect(body.bundles[0].cartAfter.bundles).toEqual([{ bundleId: burgerSetId, quantity: 1 }]);
    });

    it('works for the menu context with no cart', async () => {
      const response = await post(suggestions, 'atelier', { context: 'menu', locale: 'ar' });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.signature?.productId).toBeTruthy();
    });
  });

  describe('events', () => {
    it('stores a batch and returns 204', async () => {
      const response = await post(events, 'atelier', {
        anonymousSessionId: 'session-abcdef12',
        tableNumber: 4,
        events: [{ type: 'MENU_VIEW' }, { type: 'PRODUCT_VIEW', productId: burgerId }],
      });
      expect(response.status).toBe(204);
      expect(await prisma.analyticsEvent.count({ where: { restaurantId: atelier.id } })).toBe(2);
    });

    it('rejects unknown event types and empty batches', async () => {
      const bad = await post(events, 'atelier', { anonymousSessionId: 'session-abcdef12', events: [{ type: 'HACK' }] });
      expect(bad.status).toBe(400);
      const empty = await post(events, 'atelier', { anonymousSessionId: 'session-abcdef12', events: [] });
      expect(empty.status).toBe(400);
    });
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npx vitest run tests/api`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `rate-limit.ts` and `schemas.ts`**

`src/server/http/rate-limit.ts`:

```ts
export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Sliding-window limiter held in process memory. It is per server instance;
 * a shared store replaces it in the Phase 7 hardening work.
 */
export function createRateLimiter(options: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return {
    check(key: string, nowMs: number): RateLimitVerdict {
      const cutoff = nowMs - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterMs: Math.max(0, (recent[0] as number) + options.windowMs - nowMs) };
      }
      recent.push(nowMs);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [candidate, times] of hits) {
          if ((times[times.length - 1] ?? 0) <= cutoff) hits.delete(candidate);
        }
      }
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
```

`src/server/http/schemas.ts`:

```ts
import { z } from 'zod';
import { EVENT_TYPES } from '@/server/data/events';
import { LOCALES, MAX_LINES, MAX_QUANTITY } from '@/server/domain/types';

const id = z.string().min(1).max(64);
const locale = z.enum(LOCALES).default('en');

export const cartSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: id,
        variantId: id.nullable().default(null),
        optionIds: z.array(id).max(20).default([]),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
      }),
    )
    .max(MAX_LINES)
    .default([]),
  bundles: z
    .array(z.object({ bundleId: id, quantity: z.number().int().min(1).max(MAX_QUANTITY) }))
    .max(10)
    .default([]),
});

export const quoteRequestSchema = z.object({
  locale,
  cart: cartSchema,
});

export const suggestionsRequestSchema = z.object({
  context: z.enum(['menu', 'product', 'cart']),
  locale,
  product: z
    .object({
      productId: id,
      variantId: id.nullable().default(null),
      optionIds: z.array(id).max(20).default([]),
    })
    .optional(),
  cart: cartSchema.default({ lines: [], bundles: [] }),
  dismissedIds: z.array(z.string().max(128)).max(100).default([]),
});

export const eventsRequestSchema = z.object({
  anonymousSessionId: z.string().min(8).max(64),
  tableNumber: z.number().int().min(1).max(999).nullable().default(null),
  events: z
    .array(
      z.object({
        type: z.enum(EVENT_TYPES),
        productId: id.optional(),
        suggestionId: z.string().max(128).optional(),
        payload: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(20),
});
```

- [ ] **Step 5: Implement `route.ts` and `suggestion-view.ts`**

`src/server/http/route.ts`:

```ts
import type { z } from 'zod';
import { getTenant, type TenantInfo } from '@/server/data/tenant';
import { createRateLimiter } from './rate-limit';

const MAX_BODY_CHARS = 32 * 1024;
const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

function limiterFor(route: string, limit: number, windowMs: number) {
  const key = `${route}:${limit}:${windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = createRateLimiter({ limit, windowMs });
    limiters.set(key, limiter);
  }
  return limiter;
}

export function problem(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

export async function handleTenantRequest<S extends z.ZodType>(
  request: Request,
  ctx: { params: Promise<{ tenant: string }> },
  options: { schema: S; route: string; limit: number; windowMs?: number },
  handler: (args: { tenant: TenantInfo; input: z.infer<S>; now: Date }) => Promise<Response>,
): Promise<Response> {
  const { tenant: slug } = await ctx.params;
  const tenant = await getTenant(slug);
  if (!tenant) return problem(404, 'TENANT_NOT_FOUND', 'Unknown restaurant');

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const verdict = limiterFor(options.route, options.limit, options.windowMs ?? 60_000).check(
    `${tenant.id}:${ip}`,
    Date.now(),
  );
  if (!verdict.allowed) {
    return problem(429, 'RATE_LIMITED', 'Too many requests', {
      'Retry-After': String(Math.ceil(verdict.retryAfterMs / 1000)),
    });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return problem(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return problem(400, 'BAD_JSON', 'Request body must be valid JSON');
  }

  const parsed = options.schema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return problem(400, 'INVALID_REQUEST', message);
  }
  return handler({ tenant, input: parsed.data, now: new Date() });
}
```

`src/server/data/suggestion-view.ts`:

```ts
import type { Locale } from '@/lib/locale';
import { parseMedia, type MediaItem } from '@/lib/media';
import {
  applyBundle,
  resolveText,
  unitPrice,
  type BundleOpportunity,
  type CartInput,
  type Catalog,
  type PairingOffer,
  type SuggestionsResponse,
  type UpsellOffer,
} from '@/server/domain';

export interface PairingView extends PairingOffer {
  slug: string;
  name: string;
  price: number;
  media: MediaItem[];
  needsChoices: boolean;
  defaultVariantId: string | null;
}

export interface BundleView extends BundleOpportunity {
  name: string;
  description: string;
  cartAfter: CartInput;
}

export interface SuggestionsView {
  daypart: SuggestionsResponse['daypart'];
  signature: SuggestionsResponse['signature'];
  upgrades: UpsellOffer[];
  pairings: PairingView[];
  bundles: BundleView[];
}

export function describeSuggestions(
  catalog: Catalog,
  response: SuggestionsResponse,
  locale: Locale,
  cart: CartInput,
): SuggestionsView {
  const fallback = catalog.defaultLocale;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const bundles = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));

  return {
    daypart: response.daypart,
    signature: response.signature,
    upgrades: response.upgrades,
    pairings: response.pairings.flatMap((offer) => {
      const product = products.get(offer.productId);
      if (!product) return [];
      return [
        {
          ...offer,
          slug: product.slug,
          name: resolveText(product.translations, 'name', locale, fallback),
          price: unitPrice(product, null, []).price,
          media: parseMedia(product.media),
          needsChoices: product.groups.some((group) => group.minSelect > 0 && group.options.length > 0),
          defaultVariantId: product.variants.find((variant) => variant.isDefault)?.id ?? null,
        },
      ];
    }),
    bundles: response.bundles.flatMap((opportunity) => {
      const bundle = bundles.get(opportunity.bundleId);
      if (!bundle) return [];
      return [
        {
          ...opportunity,
          name: resolveText(bundle.translations, 'name', locale, fallback),
          description: resolveText(bundle.translations, 'description', locale, fallback),
          cartAfter: applyBundle(cart, catalog, opportunity.bundleId, opportunity.times),
        },
      ];
    }),
  };
}
```

- [ ] **Step 6: Implement the three route handlers**

`src/app/api/[tenant]/quote/route.ts`:

```ts
import { getCatalog } from '@/server/data/catalog-loader';
import { describeQuote } from '@/server/data/quote-view';
import { quoteCart } from '@/server/domain';
import { handleTenantRequest } from '@/server/http/route';
import { quoteRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: quoteRequestSchema, route: 'quote', limit: 60 },
    async ({ tenant, input, now }) => {
      const catalog = await getCatalog(tenant.id);
      const quote = quoteCart(catalog, input.cart, now);
      return Response.json({ quote: describeQuote(catalog, quote, input.locale) });
    },
  );
}
```

`src/app/api/[tenant]/suggestions/route.ts`:

```ts
import { getCatalog } from '@/server/data/catalog-loader';
import { describeSuggestions } from '@/server/data/suggestion-view';
import { buildSuggestions } from '@/server/domain';
import { handleTenantRequest } from '@/server/http/route';
import { suggestionsRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: suggestionsRequestSchema, route: 'suggestions', limit: 90 },
    async ({ tenant, input, now }) => {
      const catalog = await getCatalog(tenant.id);
      const response = buildSuggestions(catalog, input, now, tenant.engineConfig);
      return Response.json(describeSuggestions(catalog, response, input.locale, input.cart));
    },
  );
}
```

`src/app/api/[tenant]/events/route.ts`:

```ts
import { recordEvents } from '@/server/data/events';
import { getPrisma } from '@/server/data/prisma';
import { handleTenantRequest } from '@/server/http/route';
import { eventsRequestSchema } from '@/server/http/schemas';

export async function POST(request: Request, ctx: { params: Promise<{ tenant: string }> }) {
  return handleTenantRequest(
    request,
    ctx,
    { schema: eventsRequestSchema, route: 'events', limit: 120 },
    async ({ tenant, input }) => {
      await recordEvents(getPrisma(), tenant.id, input);
      return new Response(null, { status: 204 });
    },
  );
}
```

- [ ] **Step 7: Run the API tests**

Run: `npm run db:up && npx vitest run tests/api`
Expected: PASS. If the rate-limit test counts 59 or 61 successes, check that no earlier request in the file reused the `203.0.113.9` address; the helper assigns unique IPs by default.

- [ ] **Step 8: Full suite, lint, typecheck, commit**

Run: `npx vitest run && npm run lint && npm run typecheck && npm run build`
Expected: every test passes, lint and typecheck exit 0, build succeeds and lists the three `/api/[tenant]/*` routes.

```bash
git add src tests
git commit -m "feat(api): server-priced quote, suggestions and event endpoints with limits" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Client libraries: messages, cart persistence, menu pricing, analytics

**Files:**
- Create: `src/lib/messages/en.ts`, `src/lib/messages/ar.ts`, `src/lib/messages/ckb.ts`, `src/lib/messages/index.ts`
- Create: `src/lib/cart-storage.ts`, `src/lib/menu-price.ts`, `src/ui/analytics/track.ts`
- Test: `tests/lib/messages.test.ts`, `tests/lib/cart-storage.test.ts`, `tests/lib/menu-price.test.ts`, `tests/lib/track.test.ts`

**Interfaces:**
- Produces from `src/lib/messages/index.ts`: `MESSAGES: Record<Locale, Messages>`, `getTranslator(locale: Locale): Translate`.
- Produces from `src/lib/cart-storage.ts`: `sanitizeCart(raw: unknown): CartInput`.
- Produces from `src/lib/menu-price.ts`: `unitPriceFromMenu(product: Pick<MenuProductView, 'basePrice' | 'groups' | 'variants'>, variantId: string | null, optionIds: readonly string[]): number`.
- Produces from `src/ui/analytics/track.ts`: `configureTracking(config: { slug: string; table: number | null }): void`, `track(type: EventType, data?: { productId?: string; suggestionId?: string; payload?: Record<string, unknown> }, options?: { once?: boolean }): void`, `flushTracking(): void`, `resetTrackingForTests(): void`.

- [ ] **Step 1: Write the failing messages test**

`tests/lib/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MESSAGES, getTranslator } from '@/lib/messages';

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('messages', () => {
  const englishKeys = Object.keys(MESSAGES.en);

  it('has every English key in Arabic and Sorani', () => {
    for (const locale of ['ar', 'ckb'] as const) {
      const missing = englishKeys.filter((key) => !(key in MESSAGES[locale]) && !PLURAL.test(key));
      expect(missing, `${locale} is missing keys`).toEqual([]);
    }
  });

  it('provides an "other" plural form wherever English has plural forms', () => {
    const pluralBases = new Set(englishKeys.filter((key) => PLURAL.test(key)).map(base));
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const key of pluralBases) expect(MESSAGES[locale][`${key}_other`], `${locale} ${key}`).toBeTruthy();
    }
  });

  it('uses the same placeholders as English for non-plural messages', () => {
    for (const key of englishKeys.filter((k) => !PLURAL.test(k))) {
      for (const locale of ['ar', 'ckb'] as const) {
        expect(placeholders(MESSAGES[locale][key] as string), `${locale} ${key}`).toEqual(
          placeholders(MESSAGES.en[key] as string),
        );
      }
    }
  });

  it('has no empty strings', () => {
    for (const locale of ['en', 'ar', 'ckb'] as const) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(value.trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('translates with interpolation and plurals', () => {
    expect(getTranslator('en')('menu.table', { number: '04' })).toBe('Table 04');
    expect(getTranslator('en')('cart.items', { count: 1 })).toBe('1 item');
    expect(getTranslator('en')('cart.items', { count: 3 })).toBe('3 items');
    expect(getTranslator('ar')('cart.items', { count: 2 })).toBe('عنصران');
  });
});
```

- [ ] **Step 2: Write the failing cart-storage, menu-price and tracking tests**

`tests/lib/cart-storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeCart } from '@/lib/cart-storage';

describe('sanitizeCart', () => {
  it('returns an empty cart for garbage', () => {
    for (const raw of [null, undefined, 'x', 42, [], { lines: 'no' }, { lines: null, bundles: 7 }]) {
      expect(sanitizeCart(raw)).toEqual({ lines: [], bundles: [] });
    }
  });

  it('keeps well-formed lines and bundles', () => {
    const raw = {
      lines: [{ productId: 'p1', variantId: null, optionIds: ['o1', 'o2'], quantity: 2 }],
      bundles: [{ bundleId: 'b1', quantity: 1 }],
    };
    expect(sanitizeCart(raw)).toEqual(raw);
  });

  it('drops malformed entries and clamps quantities', () => {
    const cart = sanitizeCart({
      lines: [
        { productId: 'ok', variantId: 'v', optionIds: [], quantity: 99 },
        { productId: 7, variantId: null, optionIds: [], quantity: 1 },
        { productId: 'x', variantId: null, optionIds: 'no', quantity: 1 },
        { productId: 'y', variantId: null, optionIds: [], quantity: 0 },
        { productId: 'z', variantId: null, optionIds: [], quantity: 1.5 },
      ],
      bundles: [{ bundleId: 'b', quantity: -3 }, { bundleId: 4, quantity: 1 }],
    });
    expect(cart.lines).toEqual([{ productId: 'ok', variantId: 'v', optionIds: [], quantity: 20 }]);
    expect(cart.bundles).toEqual([]);
  });

  it('limits the number of lines and option ids', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({
      productId: `p${i}`,
      variantId: null,
      optionIds: Array.from({ length: 40 }, (_, j) => `o${j}`),
      quantity: 1,
    }));
    const cart = sanitizeCart({ lines, bundles: [] });
    expect(cart.lines).toHaveLength(50);
    expect(cart.lines[0]?.optionIds).toHaveLength(20);
  });
});
```

`tests/lib/menu-price.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { unitPriceFromMenu } from '@/lib/menu-price';
import { buildMenuView } from '@/server/data/menu-view';
import type { TenantInfo } from '@/server/data/tenant';
import { DEFAULT_ENGINE_CONFIG } from '@/server/domain/config';
import { unitPrice } from '@/server/domain/catalog';
import { at, IDS, makeCatalog, product } from '../domain/fixtures';

const tenant = {
  id: 'r',
  slug: 'r',
  name: 'R',
  currency: 'USD',
  defaultLocale: 'en',
  locales: ['en'],
  timeZone: 'Asia/Baghdad',
  numeralSystem: 'latn',
  engineConfig: DEFAULT_ENGINE_CONFIG,
  brand: { logoText: 'R', theme: 'dark', motionIntensity: 'subtle', tokens: {} },
} as unknown as TenantInfo;

describe('unitPriceFromMenu', () => {
  const discount = product({
    id: 'p-discount',
    basePrice: 100,
    groups: [
      {
        id: 'g',
        productId: 'p-discount',
        minSelect: 0,
        maxSelect: 1,
        translations: { en: { name: 'G' } },
        options: [
          {
            id: 'o-neg',
            groupId: 'g',
            priceDelta: -500,
            costDelta: null,
            isSuggested: false,
            suggestPriority: 0,
            isAvailable: true,
            translations: { en: { name: 'Neg' } },
          },
        ],
      },
    ],
  });
  const base = makeCatalog();
  const catalog = { ...base, products: [...base.products, discount] };
  const view = buildMenuView(catalog, tenant, 'en', at(12));

  it('matches the server unit price for every product, variant and single option', () => {
    for (const source of catalog.products) {
      const shown = view.products.find((p) => p.id === source.id)!;
      const variantIds: Array<string | null> = [null, ...source.variants.map((v) => v.id)];
      const optionSets: string[][] = [[], ...source.groups.flatMap((g) => g.options.map((o) => [o.id]))];
      for (const variantId of variantIds) {
        for (const optionIds of optionSets) {
          expect(unitPriceFromMenu(shown, variantId, optionIds), `${source.id} ${variantId} ${optionIds}`).toBe(
            unitPrice(source, variantId, optionIds).price,
          );
        }
      }
    }
  });

  it('matches for the burger with two options and clamps at zero', () => {
    const burger = view.products.find((p) => p.id === IDS.burger)!;
    expect(unitPriceFromMenu(burger, null, [IDS.optCheese, IDS.optDouble])).toBe(1300);
    const shown = view.products.find((p) => p.id === 'p-discount')!;
    expect(unitPriceFromMenu(shown, null, ['o-neg'])).toBe(0);
  });
});
```

`tests/lib/track.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTracking, flushTracking, resetTrackingForTests, track } from '@/ui/analytics/track';

describe('analytics tracking', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    resetTrackingForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body);

  it('does nothing before it is configured', () => {
    track('MENU_VIEW');
    vi.advanceTimersByTime(5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('batches events and sends them after two seconds', () => {
    configureTracking({ slug: 'atelier', table: 4 });
    track('MENU_VIEW');
    track('PRODUCT_VIEW', { productId: 'p1' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/atelier/events');
    const body = lastBody();
    expect(body.tableNumber).toBe(4);
    expect(body.anonymousSessionId.length).toBeGreaterThanOrEqual(8);
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(['MENU_VIEW', 'PRODUCT_VIEW']);
  });

  it('flushes immediately at ten queued events', () => {
    configureTracking({ slug: 'atelier', table: null });
    for (let i = 0; i < 10; i += 1) track('PRODUCT_VIEW', { productId: `p${i}` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody().events).toHaveLength(10);
  });

  it('records a once-only event a single time', () => {
    configureTracking({ slug: 'atelier', table: null });
    track('UPSELL_IMPRESSION', { suggestionId: 'up:1' }, { once: true });
    track('UPSELL_IMPRESSION', { suggestionId: 'up:1' }, { once: true });
    track('UPSELL_IMPRESSION', { suggestionId: 'up:2' }, { once: true });
    flushTracking();
    expect(lastBody().events).toHaveLength(2);
  });

  it('never throws when the network fails', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    configureTracking({ slug: 'atelier', table: null });
    track('MENU_VIEW');
    expect(() => flushTracking()).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `npx vitest run tests/lib/messages.test.ts tests/lib/cart-storage.test.ts tests/lib/menu-price.test.ts tests/lib/track.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the three message files and `index.ts`**

`src/lib/messages/en.ts`:

```ts
import type { Messages } from '../i18n';

const en: Messages = {
  'menu.skip': 'Skip to the menu',
  'menu.table': 'Table {number}',
  'menu.search': 'Search the menu',
  'menu.searchPlaceholder': 'Search dishes and drinks',
  'menu.noResults': 'Nothing matches “{query}”. Try another word.',
  'menu.clearSearch': 'Clear search',
  'menu.categories': 'Menu categories',
  'signature.BREAKFAST': 'This morning’s pick',
  'signature.LUNCH': 'Today’s pick',
  'signature.DINNER': 'Tonight’s pick',
  'signature.LATE_NIGHT': 'Late-night pick',
  'signature.NONE': 'Our pick',
  'product.add': 'Add to order',
  'product.quickAdd': 'Add {name} to your order',
  'product.unavailable': 'Unavailable right now',
  'product.soldOut': 'Sold out',
  'product.required': 'Required',
  'product.optional': 'Optional',
  'product.chooseOne': 'Choose one',
  'product.chooseUpTo': 'Choose up to {max}',
  'product.ingredients': 'Ingredients',
  'product.allergens': 'Contains',
  'product.size': 'Size',
  'product.close': 'Close',
  'product.back': 'Back to the menu',
  'product.quantity': 'Quantity',
  'product.increase': 'Increase quantity',
  'product.decrease': 'Decrease quantity',
  'product.makeChoices': 'Make your choices to continue',
  'product.availableAt': 'Served at {daypart}',
  'upgrade.title': 'Upgrades',
  'upgrade.add': 'Add',
  'upgrade.switch': 'Switch',
  'upgrade.becomes': 'Total becomes {amount}',
  'pairing.title': 'Perfect pairing',
  'pairing.add': 'Add {name}',
  'pairing.choose': 'Choose options for {name}',
  'pairing.dismiss': 'Not now',
  'bundle.title': 'Make it a set',
  'bundle.save': 'You save {amount}',
  'bundle.apply': 'Switch to the set',
  'bundle.compare': 'Separately {individual}, as a set {price}',
  'cart.title': 'Your order',
  'cart.open': 'View order',
  'cart.empty': 'Your order is empty',
  'cart.emptyHint': 'Add something from the menu.',
  'cart.back': 'Back to the menu',
  'cart.subtotal': 'Subtotal',
  'cart.remove': 'Remove',
  'cart.removeNamed': 'Remove {name}',
  'cart.updating': 'Updating prices',
  'cart.quoteError': 'We could not update prices. Check your connection.',
  'cart.fixIssues': 'Remove the unavailable items to continue.',
  'cart.reviewTitle': 'Order review',
  'cart.reviewNote': 'This is a read-only summary. Ordering with your table’s PIN arrives in the next release.',
  'cart.added': '{name} added to your order',
  'cart.items_one': '{count} item',
  'cart.items_other': '{count} items',
  'lang.switch': 'Language',
  'error.generic': 'Something went wrong. Please try again.',
  'notFound.title': 'We couldn’t find that page',
  'notFound.body': 'Check the link, or go back to the menu.',
  'issue.UNKNOWN_PRODUCT': 'No longer on the menu',
  'issue.UNAVAILABLE': 'Unavailable right now',
  'issue.OUT_OF_STOCK': 'Sold out',
  'issue.OUT_OF_DAYPART': 'Not served at this time',
  'issue.UNKNOWN_VARIANT': 'This size is no longer offered',
  'issue.UNKNOWN_OPTION': 'A choice is no longer offered',
  'issue.OPTION_UNAVAILABLE': 'A choice is unavailable right now',
  'issue.GROUP_MIN': 'A required choice is missing',
  'issue.GROUP_MAX': 'Too many choices selected',
  'issue.BAD_QUANTITY': 'Check the quantity',
  'issue.UNKNOWN_BUNDLE': 'This set is no longer offered',
  'allergen.gluten': 'Gluten',
  'allergen.milk': 'Milk',
  'allergen.egg': 'Egg',
  'allergen.nuts': 'Nuts',
  'allergen.fish': 'Fish',
  'allergen.mustard': 'Mustard',
  'daypart.BREAKFAST': 'Breakfast',
  'daypart.LUNCH': 'Lunch',
  'daypart.DINNER': 'Dinner',
  'daypart.LATE_NIGHT': 'Late night',
};

export default en;
```

`src/lib/messages/ar.ts`:

```ts
import type { Messages } from '../i18n';

const ar: Messages = {
  'menu.skip': 'انتقل إلى القائمة',
  'menu.table': 'الطاولة {number}',
  'menu.search': 'ابحث في القائمة',
  'menu.searchPlaceholder': 'ابحث عن الأطباق والمشروبات',
  'menu.noResults': 'لا يوجد ما يطابق «{query}». جرّب كلمة أخرى.',
  'menu.clearSearch': 'مسح البحث',
  'menu.categories': 'أقسام القائمة',
  'signature.BREAKFAST': 'اختيار هذا الصباح',
  'signature.LUNCH': 'اختيار اليوم',
  'signature.DINNER': 'اختيار الليلة',
  'signature.LATE_NIGHT': 'اختيار آخر الليل',
  'signature.NONE': 'اختيارنا',
  'product.add': 'أضف إلى الطلب',
  'product.quickAdd': 'أضف {name} إلى طلبك',
  'product.unavailable': 'غير متوفر حاليًا',
  'product.soldOut': 'نفد المخزون',
  'product.required': 'مطلوب',
  'product.optional': 'اختياري',
  'product.chooseOne': 'اختر واحدًا',
  'product.chooseUpTo': 'اختر حتى {max}',
  'product.ingredients': 'المكوّنات',
  'product.allergens': 'يحتوي على',
  'product.size': 'الحجم',
  'product.close': 'إغلاق',
  'product.back': 'العودة إلى القائمة',
  'product.quantity': 'الكمية',
  'product.increase': 'زيادة الكمية',
  'product.decrease': 'إنقاص الكمية',
  'product.makeChoices': 'أكمل اختياراتك للمتابعة',
  'product.availableAt': 'يُقدَّم وقت {daypart}',
  'upgrade.title': 'ترقيات',
  'upgrade.add': 'أضف',
  'upgrade.switch': 'بدّل',
  'upgrade.becomes': 'يصبح المجموع {amount}',
  'pairing.title': 'الثنائي المثالي',
  'pairing.add': 'أضف {name}',
  'pairing.choose': 'اختر خيارات {name}',
  'pairing.dismiss': 'ليس الآن',
  'bundle.title': 'اجعلها وجبة كاملة',
  'bundle.save': 'توفّر {amount}',
  'bundle.apply': 'حوّل إلى الوجبة',
  'bundle.compare': 'بشكل منفصل {individual}، كوجبة {price}',
  'cart.title': 'طلبك',
  'cart.open': 'عرض الطلب',
  'cart.empty': 'طلبك فارغ',
  'cart.emptyHint': 'أضف شيئًا من القائمة.',
  'cart.back': 'العودة إلى القائمة',
  'cart.subtotal': 'المجموع الفرعي',
  'cart.remove': 'إزالة',
  'cart.removeNamed': 'إزالة {name}',
  'cart.updating': 'جارٍ تحديث الأسعار',
  'cart.quoteError': 'تعذّر تحديث الأسعار. تحقّق من اتصالك.',
  'cart.fixIssues': 'أزل العناصر غير المتوفرة للمتابعة.',
  'cart.reviewTitle': 'مراجعة الطلب',
  'cart.reviewNote': 'هذا ملخص للقراءة فقط. سيتوفر الطلب برمز طاولتك في الإصدار القادم.',
  'cart.added': 'تمت إضافة {name} إلى طلبك',
  'cart.items_one': 'عنصر واحد',
  'cart.items_two': 'عنصران',
  'cart.items_few': '{count} عناصر',
  'cart.items_many': '{count} عنصرًا',
  'cart.items_other': '{count} عنصر',
  'lang.switch': 'اللغة',
  'error.generic': 'حدث خطأ ما. حاول مرة أخرى.',
  'notFound.title': 'لم نعثر على هذه الصفحة',
  'notFound.body': 'تحقّق من الرابط، أو عد إلى القائمة.',
  'issue.UNKNOWN_PRODUCT': 'لم يعد في القائمة',
  'issue.UNAVAILABLE': 'غير متوفر حاليًا',
  'issue.OUT_OF_STOCK': 'نفد المخزون',
  'issue.OUT_OF_DAYPART': 'لا يُقدَّم في هذا الوقت',
  'issue.UNKNOWN_VARIANT': 'هذا الحجم لم يعد متوفرًا',
  'issue.UNKNOWN_OPTION': 'أحد الخيارات لم يعد متوفرًا',
  'issue.OPTION_UNAVAILABLE': 'أحد الخيارات غير متوفر حاليًا',
  'issue.GROUP_MIN': 'ينقصك اختيار مطلوب',
  'issue.GROUP_MAX': 'عدد الخيارات أكبر من المسموح',
  'issue.BAD_QUANTITY': 'تحقّق من الكمية',
  'issue.UNKNOWN_BUNDLE': 'هذه الوجبة لم تعد متوفرة',
  'allergen.gluten': 'غلوتين',
  'allergen.milk': 'حليب',
  'allergen.egg': 'بيض',
  'allergen.nuts': 'مكسرات',
  'allergen.fish': 'سمك',
  'allergen.mustard': 'خردل',
  'daypart.BREAKFAST': 'الفطور',
  'daypart.LUNCH': 'الغداء',
  'daypart.DINNER': 'العشاء',
  'daypart.LATE_NIGHT': 'آخر الليل',
};

export default ar;
```

`src/lib/messages/ckb.ts`:

```ts
import type { Messages } from '../i18n';

const ckb: Messages = {
  'menu.skip': 'بازدە بۆ مینیوو',
  'menu.table': 'مێزی {number}',
  'menu.search': 'گەڕان لە مینیوو',
  'menu.searchPlaceholder': 'بگەڕێ بۆ خواردن و خواردنەوە',
  'menu.noResults': 'هیچ شتێک لەگەڵ «{query}» ناگونجێت. وشەیەکی تر تاقی بکەرەوە.',
  'menu.clearSearch': 'سڕینەوەی گەڕان',
  'menu.categories': 'بەشەکانی مینیوو',
  'signature.BREAKFAST': 'هەڵبژاردەی ئەم بەیانییە',
  'signature.LUNCH': 'هەڵبژاردەی ئەمڕۆ',
  'signature.DINNER': 'هەڵبژاردەی ئەمشەو',
  'signature.LATE_NIGHT': 'هەڵبژاردەی درەنگی شەو',
  'signature.NONE': 'هەڵبژاردەی ئێمە',
  'product.add': 'زیادکردن بۆ داواکاری',
  'product.quickAdd': 'زیادکردنی {name} بۆ داواکارییەکەت',
  'product.unavailable': 'ئێستا بەردەست نییە',
  'product.soldOut': 'تەواو بووە',
  'product.required': 'پێویستە',
  'product.optional': 'ئارەزوومەندانە',
  'product.chooseOne': 'یەکێک هەڵبژێرە',
  'product.chooseUpTo': 'هەتا {max} هەڵبژێرە',
  'product.ingredients': 'پێکهاتەکان',
  'product.allergens': 'لەخۆدەگرێت',
  'product.size': 'قەبارە',
  'product.close': 'داخستن',
  'product.back': 'گەڕانەوە بۆ مینیوو',
  'product.quantity': 'ژمارە',
  'product.increase': 'زیادکردنی ژمارە',
  'product.decrease': 'کەمکردنەوەی ژمارە',
  'product.makeChoices': 'هەڵبژاردنەکانت تەواو بکە',
  'product.availableAt': 'لە کاتی {daypart} پێشکەش دەکرێت',
  'upgrade.title': 'باشترکردنەکان',
  'upgrade.add': 'زیاد بکە',
  'upgrade.switch': 'بیگۆڕە',
  'upgrade.becomes': 'کۆی گشتی دەبێتە {amount}',
  'pairing.title': 'هاوبەشی تەواو',
  'pairing.add': 'زیادکردنی {name}',
  'pairing.choose': 'هەڵبژاردنەکانی {name} دیاری بکە',
  'pairing.dismiss': 'ئێستا نا',
  'bundle.title': 'بیکە بە پاکێج',
  'bundle.save': 'دەستکەوتی {amount}',
  'bundle.apply': 'بیگۆڕە بۆ پاکێج',
  'bundle.compare': 'بە جیا {individual}، وەک پاکێج {price}',
  'cart.title': 'داواکارییەکەت',
  'cart.open': 'بینینی داواکاری',
  'cart.empty': 'داواکارییەکەت بەتاڵە',
  'cart.emptyHint': 'شتێک لە مینیوو زیاد بکە.',
  'cart.back': 'گەڕانەوە بۆ مینیوو',
  'cart.subtotal': 'کۆی بچووک',
  'cart.remove': 'لابردن',
  'cart.removeNamed': 'لابردنی {name}',
  'cart.updating': 'نرخەکان نوێ دەکرێنەوە',
  'cart.quoteError': 'نەتوانرا نرخەکان نوێ بکرێنەوە. پەیوەندییەکەت بپشکنە.',
  'cart.fixIssues': 'ئەو شتانەی بەردەست نین لاببە بۆ بەردەوامبوون.',
  'cart.reviewTitle': 'پێداچوونەوەی داواکاری',
  'cart.reviewNote': 'ئەمە پوختەیەکی تەنیا بۆ خوێندنەوەیە. داواکردن بە پینی مێزەکەت لە وەشانی داهاتوو دێت.',
  'cart.added': '{name} زیادکرا بۆ داواکارییەکەت',
  'cart.items_one': '{count} شت',
  'cart.items_other': '{count} شت',
  'lang.switch': 'زمان',
  'error.generic': 'کێشەیەک ڕوویدا. دووبارە هەوڵبدەرەوە.',
  'notFound.title': 'ئەو پەڕەیەمان نەدۆزییەوە',
  'notFound.body': 'بەستەرەکە بپشکنە، یان بگەڕێوە بۆ مینیوو.',
  'issue.UNKNOWN_PRODUCT': 'چیتر لە مینیوودا نییە',
  'issue.UNAVAILABLE': 'ئێستا بەردەست نییە',
  'issue.OUT_OF_STOCK': 'تەواو بووە',
  'issue.OUT_OF_DAYPART': 'لەم کاتەدا پێشکەش ناکرێت',
  'issue.UNKNOWN_VARIANT': 'ئەم قەبارەیە چیتر بەردەست نییە',
  'issue.UNKNOWN_OPTION': 'یەکێک لە هەڵبژاردنەکان چیتر بەردەست نییە',
  'issue.OPTION_UNAVAILABLE': 'یەکێک لە هەڵبژاردنەکان ئێستا بەردەست نییە',
  'issue.GROUP_MIN': 'هەڵبژاردنێکی پێویست کەمە',
  'issue.GROUP_MAX': 'ژمارەی هەڵبژاردنەکان زۆرە',
  'issue.BAD_QUANTITY': 'ژمارەکە بپشکنە',
  'issue.UNKNOWN_BUNDLE': 'ئەم پاکێجە چیتر بەردەست نییە',
  'allergen.gluten': 'گلوتین',
  'allergen.milk': 'شیر',
  'allergen.egg': 'هێلکە',
  'allergen.nuts': 'گوێز و فستق',
  'allergen.fish': 'ماسی',
  'allergen.mustard': 'خەردەل',
  'daypart.BREAKFAST': 'نانی بەیانی',
  'daypart.LUNCH': 'نانی نیوەڕۆ',
  'daypart.DINNER': 'نانی ئێوارە',
  'daypart.LATE_NIGHT': 'درەنگی شەو',
};

export default ckb;
```

`src/lib/messages/index.ts`:

```ts
import { createTranslator, type Messages, type Translate } from '../i18n';
import type { Locale } from '../locale';
import ar from './ar';
import ckb from './ckb';
import en from './en';

export const MESSAGES: Record<Locale, Messages> = { en, ar, ckb };

export function getTranslator(locale: Locale): Translate {
  return createTranslator(locale, MESSAGES);
}
```

- [ ] **Step 5: Implement `cart-storage.ts` and `menu-price.ts`**

`src/lib/cart-storage.ts`:

```ts
import { MAX_LINES, MAX_QUANTITY, type CartBundleInput, type CartInput, type CartLineInput } from '@/server/domain/types';

const EMPTY: CartInput = { lines: [], bundles: [] };

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function quantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Validates a cart read from storage. Anything malformed is dropped rather than trusted. */
export function sanitizeCart(raw: unknown): CartInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY };
  const source = raw as { lines?: unknown; bundles?: unknown };

  const lines: CartLineInput[] = [];
  if (Array.isArray(source.lines)) {
    for (const entry of source.lines) {
      if (lines.length >= MAX_LINES) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const line = entry as Record<string, unknown>;
      if (!text(line.productId) || !quantity(line.quantity)) continue;
      if (!(line.variantId === null || text(line.variantId))) continue;
      if (!Array.isArray(line.optionIds)) continue;
      lines.push({
        productId: line.productId,
        variantId: line.variantId as string | null,
        optionIds: line.optionIds.filter(text).slice(0, 20),
        quantity: Math.min(MAX_QUANTITY, line.quantity),
      });
    }
  }

  const bundles: CartBundleInput[] = [];
  if (Array.isArray(source.bundles)) {
    for (const entry of source.bundles) {
      if (bundles.length >= 10) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const bundle = entry as Record<string, unknown>;
      if (!text(bundle.bundleId) || !quantity(bundle.quantity)) continue;
      bundles.push({ bundleId: bundle.bundleId, quantity: Math.min(MAX_QUANTITY, bundle.quantity) });
    }
  }
  return { lines, bundles };
}
```

`src/lib/menu-price.ts`:

```ts
import type { MenuProductView } from '@/server/data/menu-view';

/** Mirrors the server's `unitPrice` for display. The cart always uses the server quote. */
export function unitPriceFromMenu(
  product: Pick<MenuProductView, 'basePrice' | 'groups' | 'variants'>,
  variantId: string | null,
  optionIds: readonly string[],
): number {
  const variant = variantId
    ? product.variants.find((candidate) => candidate.id === variantId)
    : product.variants.find((candidate) => candidate.isDefault);
  let price = product.basePrice + (variant?.priceDelta ?? 0);
  const chosen = new Set(optionIds);
  for (const group of product.groups) {
    for (const option of group.options) {
      if (chosen.has(option.id)) price += option.priceDelta;
    }
  }
  return Math.max(0, price);
}
```

- [ ] **Step 6: Implement `src/ui/analytics/track.ts`**

```ts
import type { EventType } from '@/server/data/events';

interface Config {
  slug: string;
  table: number | null;
}

interface QueuedEvent {
  type: EventType;
  productId?: string;
  suggestionId?: string;
  payload: Record<string, unknown>;
}

let config: Config | null = null;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let memorySession: string | null = null;
let listening = false;
const seen = new Set<string>();

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem('buzzify:sid');
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem('buzzify:sid', created);
    return created;
  } catch {
    memorySession ??= globalThis.crypto?.randomUUID?.() ?? `m-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    return memorySession;
  }
}

export function flushTracking(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!config || queue.length === 0) return;
  const batch = queue.splice(0, 20);
  try {
    void fetch(`/api/${config.slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anonymousSessionId: sessionId(), tableNumber: config.table, events: batch }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never affect the menu.
  }
  if (queue.length > 0) flushTracking();
}

export function configureTracking(next: Config): void {
  config = next;
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTracking();
    });
  }
}

export function track(
  type: EventType,
  data: { productId?: string; suggestionId?: string; payload?: Record<string, unknown> } = {},
  options: { once?: boolean } = {},
): void {
  if (!config) return;
  if (options.once) {
    const key = `${type}:${data.suggestionId ?? data.productId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
  }
  queue.push({ type, productId: data.productId, suggestionId: data.suggestionId, payload: data.payload ?? {} });
  if (queue.length >= 10) flushTracking();
  else timer ??= setTimeout(flushTracking, 2000);
}

export function resetTrackingForTests(): void {
  config = null;
  queue = [];
  seen.clear();
  memorySession = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/lib`
Expected: PASS for messages, cart-storage, menu-price and track.

- [ ] **Step 8: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src tests
git commit -m "feat(ui): three-language messages, cart sanitizer, menu pricing mirror and analytics queue" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Application shell: brand tokens, fonts, providers, layout, sheet, language switch

**Files:**
- Create: `src/ui/brand.ts`, `src/app/fonts.ts`, `src/server/route-context.ts`
- Create: `src/ui/cart/cart-store.ts`, `src/ui/AppProviders.tsx`, `src/ui/LanguageSwitch.tsx`, `src/ui/Sheet.tsx`, `src/ui/Icons.tsx`
- Replace: `src/app/globals.css`, `src/app/[tenant]/[locale]/layout.tsx`
- Create: `src/app/[tenant]/[locale]/not-found.tsx`
- Create: `playwright.config.ts`
- Test: `tests/ui/brand.test.ts`, `tests/ui/cart-store.test.ts`, `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `BrandView`, `TenantInfo`, `getTenant`, `getTranslator`, `formatMoney`, `sanitizeCart`, cart helpers, `configureTracking`, `QuoteView`.
- Produces from `src/ui/brand.ts`: `brandCss(brand: BrandView): string`.
- Produces from `src/server/route-context.ts`: `resolveRoute(params: { tenant: string; locale: string }): Promise<{ tenant: TenantInfo; locale: Locale } | null>`, `loadMenuView(route): Promise<MenuView>`.
- Produces from `src/ui/cart/cart-store.ts`: `KeyValueStorage`, `CartState`, `createCartStore(storageKey: string, storage?: KeyValueStorage)`, `CartStore`.
- Produces from `src/ui/AppProviders.tsx`: `AppProviders`, `useApp(): AppContext`, `RouteTable` (client component that claims a table number).
- `AppContext` fields: `tenant: { slug; name; currency; numeralSystem; locales; defaultLocale; logoText }`, `locale`, `table: number | null`, `t: Translate`, `money(amount: number): string`, `href(path?: string): string`, `cart: CartInput`, `itemCount: number`, `quote: QuoteView | null`, `quoting: boolean`, `quoteError: boolean`, `hydrated: boolean`, `addLine(line)`, `setQuantity(key, quantity)`, `removeLine(key)`, `setBundleQuantity(bundleId, quantity)`, `replaceCart(cart)`, `dismissed: string[]`, `dismiss(id)`, `announce(message)`.
- Produces from `src/ui/Sheet.tsx`: `Sheet({ labelledBy, onClose, children: (close: () => void) => ReactNode })`.

- [ ] **Step 1: Write the failing brand and cart-store tests**

`tests/ui/brand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTES } from '@/lib/brand';
import { brandCss } from '@/ui/brand';

const brand = {
  logoText: 'ATELIER',
  theme: 'dark' as const,
  motionIntensity: 'subtle' as const,
  tokens: DEFAULT_PALETTES,
};

describe('brandCss', () => {
  it('emits dark variables for the root and light variables for the light theme', () => {
    const css = brandCss(brand);
    expect(css).toContain('html:root{');
    expect(css).toContain('--bg:#0E0E0F');
    expect(css).toContain("html:root[data-theme='light']{");
    expect(css).toContain('--bg:#F7F5F1');
    expect(css).toContain('--accent:#D6BC8A');
  });

  it('never emits anything but hex colours', () => {
    const hostile = {
      ...brand,
      tokens: { ...DEFAULT_PALETTES, dark: { ...DEFAULT_PALETTES.dark, bg: 'red;}body{display:none' } },
    };
    const css = brandCss(hostile);
    expect(css).not.toContain('display:none');
    expect(css).toContain(`--bg:${DEFAULT_PALETTES.dark.bg}`);
  });
});
```

`tests/ui/cart-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lineKey } from '@/lib/cart';
import { createCartStore, type KeyValueStorage } from '@/ui/cart/cart-store';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const burger = { productId: 'burger', variantId: null, optionIds: ['cheese'], quantity: 1 };

describe('cart store', () => {
  it('adds, merges, updates and removes lines', () => {
    const store = createCartStore('k', memoryStorage());
    store.getState().add(burger);
    store.getState().add(burger);
    expect(store.getState().cart.lines[0]?.quantity).toBe(2);
    store.getState().setQuantity(lineKey(burger), 5);
    expect(store.getState().cart.lines[0]?.quantity).toBe(5);
    store.getState().remove(lineKey(burger));
    expect(store.getState().cart.lines).toEqual([]);
  });

  it('persists the cart but not dismissed suggestions', async () => {
    const storage = memoryStorage();
    const first = createCartStore('k', storage);
    first.getState().add(burger);
    first.getState().dismiss('pair:p1');
    const saved = JSON.parse(storage.data.k as string);
    expect(saved.state.cart.lines).toHaveLength(1);
    expect(saved.state.dismissed).toBeUndefined();

    const second = createCartStore('k', storage);
    expect(second.getState().cart.lines).toEqual([]); // skipHydration until rehydrate()
    await second.persist.rehydrate();
    expect(second.getState().cart.lines).toHaveLength(1);
    expect(second.getState().dismissed).toEqual([]);
  });

  it('recovers from corrupted storage', async () => {
    const storage = memoryStorage({ k: '{"state":{"cart":{"lines":[{"productId":7}],"bundles":"x"}},"version":1}' });
    const store = createCartStore('k', storage);
    await store.persist.rehydrate();
    expect(store.getState().cart).toEqual({ lines: [], bundles: [] });
    const broken = createCartStore('k2', memoryStorage({ k2: '{not json' }));
    await broken.persist.rehydrate();
    expect(broken.getState().cart).toEqual({ lines: [], bundles: [] });
  });

  it('replaces and clears the cart', () => {
    const store = createCartStore('k', memoryStorage());
    store.getState().replace({ lines: [], bundles: [{ bundleId: 'b', quantity: 1 }] });
    expect(store.getState().cart.bundles).toHaveLength(1);
    store.getState().clear();
    expect(store.getState().cart).toEqual({ lines: [], bundles: [] });
  });
});
```

- [ ] **Step 2: Write the failing shell end-to-end test and Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grep: /@desktop/ },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100/atelier/en',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

`tests/e2e/shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('application shell', () => {
  test('applies the brand tokens on the server', async ({ page }) => {
    await page.goto('/atelier/en');
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    expect(bg.toLowerCase()).toBe('#0e0e0f');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('switches language by changing the path and flips direction', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(/\/atelier\/ar$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await page.getByRole('link', { name: 'کوردی' }).click();
    await expect(page).toHaveURL(/\/atelier\/ckb$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ckb');
  });

  test('returns 404 for an unknown restaurant or locale', async ({ request }) => {
    expect((await request.get('/nope/en')).status()).toBe(404);
    expect((await request.get('/atelier/xx')).status()).toBe(404);
  });
});
```

- [ ] **Step 3: Run the unit tests to confirm they fail; install the browser**

Run: `npx vitest run tests/ui`
Expected: FAIL, modules not found.

Run: `npx playwright install chromium`
Expected: downloads Chromium once (about 150 MB into the Playwright cache).

- [ ] **Step 4: Implement `src/ui/brand.ts` and `src/server/route-context.ts`**

`src/ui/brand.ts`:

```ts
import { DEFAULT_PALETTES, sanitizePalette, type Palette } from '@/lib/brand';
import type { BrandView } from '@/server/data/tenant';

function declarations(palette: Palette): string {
  return (
    `--bg:${palette.bg};--surface:${palette.surface};--raised:${palette.raised};--accent:${palette.accent};` +
    `--text:${palette.text};--muted:${palette.muted};--line:${palette.line};--on-accent:${palette.onAccent};`
  );
}

/** Builds the tenant's CSS variables. Every value is re-validated as a hex colour. */
export function brandCss(brand: BrandView): string {
  const dark = sanitizePalette(brand.tokens.dark, DEFAULT_PALETTES.dark);
  const light = sanitizePalette(brand.tokens.light, DEFAULT_PALETTES.light);
  return `html:root{${declarations(dark)}color-scheme:dark}html:root[data-theme='light']{${declarations(light)}color-scheme:light}`;
}
```

`src/server/route-context.ts`:

```ts
import { getCatalog } from '@/server/data/catalog-loader';
import { buildMenuView, type MenuView } from '@/server/data/menu-view';
import { getTenant, type TenantInfo } from '@/server/data/tenant';
import { isLocale, type Locale } from '@/lib/locale';

export interface RouteContext {
  tenant: TenantInfo;
  locale: Locale;
}

/** Returns null for an unknown restaurant, an unsupported locale, or a locale the restaurant does not offer. */
export async function resolveRoute(params: { tenant: string; locale: string }): Promise<RouteContext | null> {
  if (!isLocale(params.locale)) return null;
  const tenant = await getTenant(params.tenant);
  if (!tenant || !tenant.locales.includes(params.locale)) return null;
  return { tenant, locale: params.locale };
}

export async function loadMenuView(route: RouteContext): Promise<MenuView> {
  const catalog = await getCatalog(route.tenant.id);
  return buildMenuView(catalog, route.tenant, route.locale, new Date());
}
```

- [ ] **Step 5: Implement the cart store**

`src/ui/cart/cart-store.ts`:

```ts
import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { addLine, EMPTY_CART, removeLine, setBundleQuantity, setLineQuantity } from '@/lib/cart';
import { sanitizeCart } from '@/lib/cart-storage';
import type { CartInput, CartLineInput } from '@/server/domain/types';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CartState {
  cart: CartInput;
  dismissed: string[];
  add(line: CartLineInput): void;
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  setBundleQuantity(bundleId: string, quantity: number): void;
  replace(cart: CartInput): void;
  dismiss(suggestionId: string): void;
  clear(): void;
}

/** localStorage when it works; an in-memory fallback for private windows and blocked storage. */
function safeLocalStorage(): KeyValueStorage {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
    removeItem(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        memory.delete(key);
      }
    },
  };
}

export function createCartStore(storageKey: string, storage?: KeyValueStorage) {
  const backing = storage ?? safeLocalStorage();
  return createStore<CartState>()(
    persist(
      (set) => ({
        cart: EMPTY_CART,
        dismissed: [],
        add: (line) => set((state) => ({ cart: addLine(state.cart, line) })),
        setQuantity: (key, quantity) => set((state) => ({ cart: setLineQuantity(state.cart, key, quantity) })),
        remove: (key) => set((state) => ({ cart: removeLine(state.cart, key) })),
        setBundleQuantity: (bundleId, quantity) =>
          set((state) => ({ cart: setBundleQuantity(state.cart, bundleId, quantity) })),
        replace: (cart) => set({ cart: sanitizeCart(cart) }),
        dismiss: (id) => set((state) => ({ dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id] })),
        clear: () => set({ cart: EMPTY_CART, dismissed: [] }),
      }),
      {
        name: storageKey,
        version: 1,
        storage: createJSONStorage(() => backing),
        partialize: (state) => ({ cart: state.cart }),
        skipHydration: true,
        merge: (persisted, current) => ({
          ...current,
          cart: sanitizeCart((persisted as { cart?: unknown } | undefined)?.cart),
        }),
      },
    ),
  );
}

export type CartStore = ReturnType<typeof createCartStore>;
```

- [ ] **Step 6: Implement fonts, global CSS and icons**

`src/app/fonts.ts`:

```ts
import { Bodoni_Moda, Hanken_Grotesk, Noto_Naskh_Arabic } from 'next/font/google';

export const bodoni = Bodoni_Moda({ subsets: ['latin'], variable: '--font-bodoni', display: 'swap', axes: ['opsz'] });
export const hanken = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken', display: 'swap' });
export const naskh = Noto_Naskh_Arabic({ subsets: ['arabic'], variable: '--font-naskh', display: 'swap' });

export const fontVariables = `${bodoni.variable} ${hanken.variable} ${naskh.variable}`;
```

`src/app/globals.css`:

```css
@import 'tailwindcss';

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-raised: var(--raised);
  --color-accent: var(--accent);
  --color-text: var(--text);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-on-accent: var(--on-accent);
  --font-display: var(--font-display-stack);
  --font-sans: var(--font-text-stack);
}

:root {
  --bg: #0e0e0f;
  --surface: #1b1a19;
  --raised: #2a2826;
  --accent: #d6bc8a;
  --text: #ede8df;
  --muted: #a7a096;
  --line: #3a3633;
  --on-accent: #0e0e0f;
  --font-display-stack: var(--font-bodoni), 'Times New Roman', serif;
  --font-text-stack: var(--font-hanken), system-ui, sans-serif;
}

:root[lang='ar'],
:root[lang='ckb'] {
  --font-display-stack: var(--font-naskh), 'Noto Naskh Arabic', serif;
  --font-text-stack: var(--font-naskh), system-ui, sans-serif;
}

html {
  background: var(--bg);
  color: var(--text);
  -webkit-text-size-adjust: 100%;
}

html:has(dialog[open]) {
  overflow: hidden;
}

body {
  min-height: 100dvh;
  font-family: var(--font-text-stack);
  overflow-wrap: anywhere;
  -webkit-tap-highlight-color: transparent;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.62);
}

.scroll-hidden {
  scrollbar-width: none;
}
.scroll-hidden::-webkit-scrollbar {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

`src/ui/Icons.tsx`:

```tsx
import type { SVGProps } from 'react';

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };
}

export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M10 4v12M4 10h12" />
  </svg>
);

export const MinusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 10h12" />
  </svg>
);

export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
);

export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <circle cx="9" cy="9" r="5" />
    <path d="M13 13l3.5 3.5" />
  </svg>
);

/** Points toward the start of the line and mirrors automatically in right-to-left layouts. */
export const BackIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)} className={`rtl:rotate-180 ${props.className ?? ''}`}>
    <path d="M12 4l-6 6 6 6" />
  </svg>
);
```

- [ ] **Step 7: Implement `Sheet.tsx` and `LanguageSwitch.tsx`**

`src/ui/Sheet.tsx`:

```tsx
'use client';

import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface SheetProps {
  labelledBy: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}

/**
 * A modal bottom sheet built on the native <dialog>, which supplies focus trapping,
 * Escape handling and an inert background. Motion animates the panel in and out.
 */
export function Sheet({ labelledBy, onClose, children }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(true);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const element = dialog.current;
    opener.current = document.activeElement;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
      if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="m-0 mt-auto h-auto max-h-[94dvh] w-full max-w-none overflow-hidden rounded-t-2xl border-0 bg-surface p-0 text-text sm:mx-auto sm:mb-auto sm:max-w-xl sm:rounded-2xl"
    >
      <motion.div
        className="flex max-h-[94dvh] flex-col"
        initial={{ y: 48 }}
        animate={{ y: open ? 0 : 48, opacity: open ? 1 : 0 }}
        transition={{ type: 'spring', duration: 0.36, bounce: 0.1 }}
        onAnimationComplete={() => {
          if (!open) onClose();
        }}
      >
        {children(close)}
      </motion.div>
    </dialog>
  );
}
```

`src/ui/LanguageSwitch.tsx`:

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { LOCALE_NAMES } from '@/lib/locale';
import { useApp } from '@/ui/AppProviders';

export function LanguageSwitch() {
  const { tenant, locale, t } = useApp();
  const pathname = usePathname();
  // Path shape is /{tenant}/{locale}/...rest
  const rest = pathname.split('/').slice(3).join('/');

  return (
    <nav aria-label={t('lang.switch')} className="flex shrink-0 items-center gap-1 text-sm">
      {tenant.locales.map((code) => (
        <a
          key={code}
          href={`/${tenant.slug}/${code}${rest ? `/${rest}` : ''}`}
          lang={code}
          hrefLang={code}
          aria-current={code === locale ? 'true' : undefined}
          className={`grid min-h-11 min-w-11 place-items-center rounded-full px-3 transition-colors ${
            code === locale ? 'bg-raised text-text' : 'text-muted hover:text-text'
          }`}
        >
          {LOCALE_NAMES[code]}
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 8: Implement `AppProviders.tsx`**

```tsx
'use client';

import { MotionConfig } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import { isEmpty, itemCount as countItems } from '@/lib/cart';
import type { Translate } from '@/lib/i18n';
import type { Locale } from '@/lib/locale';
import { getTranslator } from '@/lib/messages';
import type { QuoteView } from '@/server/data/quote-view';
import { formatMoney } from '@/server/domain/money';
import type { CartInput, CartLineInput } from '@/server/domain/types';
import { configureTracking } from '@/ui/analytics/track';
import { createCartStore, type CartStore } from '@/ui/cart/cart-store';

export interface TenantClientInfo {
  slug: string;
  name: string;
  logoText: string;
  currency: string;
  numeralSystem: 'latn' | 'arab';
  locales: Locale[];
  defaultLocale: Locale;
}

export interface AppContext {
  tenant: TenantClientInfo;
  locale: Locale;
  table: number | null;
  t: Translate;
  money(amount: number): string;
  href(path?: string): string;
  cart: CartInput;
  itemCount: number;
  quote: QuoteView | null;
  quoting: boolean;
  quoteError: boolean;
  hydrated: boolean;
  addLine(line: CartLineInput): void;
  setQuantity(key: string, quantity: number): void;
  removeLine(key: string): void;
  setBundleQuantity(bundleId: string, quantity: number): void;
  replaceCart(cart: CartInput): void;
  dismissed: string[];
  dismiss(id: string): void;
  announce(message: string): void;
  claimTable(table: number): void;
}

const Context = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProviders');
  return value;
}

function readTable(slug: string): number | null {
  try {
    const raw = window.localStorage.getItem(`buzzify:table:${slug}`);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : null;
  } catch {
    return null;
  }
}

function writeTable(slug: string, table: number): void {
  try {
    window.localStorage.setItem(`buzzify:table:${slug}`, String(table));
  } catch {
    // Storage can be blocked; the table still applies for this page view.
  }
}

export function AppProviders({
  tenant,
  locale,
  children,
}: {
  tenant: TenantClientInfo;
  locale: Locale;
  children: ReactNode;
}) {
  const storeRef = useRef<CartStore | null>(null);
  storeRef.current ??= createCartStore(`buzzify:cart:${tenant.slug}`);
  const store = storeRef.current;

  const cart = useStore(store, (state) => state.cart);
  const dismissed = useStore(store, (state) => state.dismissed);

  const [hydrated, setHydrated] = useState(false);
  const [table, setTable] = useState<number | null>(null);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(false);
  const [message, setMessage] = useState('');
  const pendingTable = useRef<number | null>(null);

  const t = useMemo(() => getTranslator(locale), [locale]);
  const money = useCallback(
    (amount: number) => formatMoney(amount, tenant.currency, locale, tenant.numeralSystem),
    [tenant.currency, tenant.numeralSystem, locale],
  );
  const href = useCallback((path = '') => `/${tenant.slug}/${locale}${path}`, [tenant.slug, locale]);

  const applyTable = useCallback(
    (next: number) => {
      const previous = readTable(tenant.slug);
      if (previous !== null && previous !== next) store.getState().clear();
      writeTable(tenant.slug, next);
      setTable(next);
    },
    [store, tenant.slug],
  );

  useEffect(() => {
    let active = true;
    Promise.resolve(store.persist.rehydrate()).then(() => {
      if (!active) return;
      setHydrated(true);
      if (pendingTable.current !== null) applyTable(pendingTable.current);
      else setTable(readTable(tenant.slug));
    });
    return () => {
      active = false;
    };
  }, [store, applyTable, tenant.slug]);

  useEffect(() => {
    configureTracking({ slug: tenant.slug, table });
  }, [tenant.slug, table]);

  useEffect(() => {
    if (!hydrated) return;
    if (isEmpty(cart)) {
      setQuote(null);
      setQuoting(false);
      setQuoteError(false);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/${tenant.slug}/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale, cart }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`quote ${response.status}`);
        const body = (await response.json()) as { quote: QuoteView };
        setQuote(body.quote);
        setQuoteError(false);
      } catch {
        if (!controller.signal.aborted) setQuoteError(true);
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cart, locale, tenant.slug, hydrated]);

  const claimTable = useCallback(
    (next: number) => {
      if (hydrated) applyTable(next);
      else pendingTable.current = next;
    },
    [hydrated, applyTable],
  );

  const value = useMemo<AppContext>(
    () => ({
      tenant,
      locale,
      table,
      t,
      money,
      href,
      cart,
      itemCount: countItems(cart),
      quote,
      quoting,
      quoteError,
      hydrated,
      addLine: (line) => store.getState().add(line),
      setQuantity: (key, quantity) => store.getState().setQuantity(key, quantity),
      removeLine: (key) => store.getState().remove(key),
      setBundleQuantity: (bundleId, quantity) => store.getState().setBundleQuantity(bundleId, quantity),
      replaceCart: (next) => store.getState().replace(next),
      dismissed,
      dismiss: (id) => store.getState().dismiss(id),
      announce: setMessage,
      claimTable,
    }),
    [tenant, locale, table, t, money, href, cart, quote, quoting, quoteError, hydrated, dismissed, store, claimTable],
  );

  return (
    <Context.Provider value={value}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
      <div aria-live="polite" role="status" className="sr-only">
        {message}
      </div>
    </Context.Provider>
  );
}

/** Rendered by the QR entry route to tell the shell which table this device is at. */
export function RouteTable({ number }: { number: number }) {
  const { claimTable } = useApp();
  useEffect(() => {
    claimTable(number);
  }, [claimTable, number]);
  return null;
}
```

- [ ] **Step 9: Replace the layout and add the not-found page**

`src/app/[tenant]/[locale]/layout.tsx`:

```tsx
import '@/app/globals.css';
import type { ReactNode } from 'react';
import { fontVariables } from '@/app/fonts';
import { direction, isLocale } from '@/lib/locale';
import { resolveRoute } from '@/server/route-context';
import { AppProviders } from '@/ui/AppProviders';
import { brandCss } from '@/ui/brand';

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string; locale: string }>;
}) {
  const raw = await params;
  const route = await resolveRoute(raw);

  // Unknown tenant or locale: render a bare shell so the page can call notFound() with a real 404.
  if (!route) {
    return (
      <html lang={isLocale(raw.locale) ? raw.locale : 'en'} className={fontVariables}>
        <body>{children}</body>
      </html>
    );
  }

  const { tenant, locale } = route;
  return (
    <html lang={locale} dir={direction(locale)} data-theme={tenant.brand.theme} className={fontVariables}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCss(tenant.brand) }} />
      </head>
      <body className="bg-bg font-sans text-text antialiased">
        <AppProviders
          locale={locale}
          tenant={{
            slug: tenant.slug,
            name: tenant.name,
            logoText: tenant.brand.logoText,
            currency: tenant.currency,
            numeralSystem: tenant.numeralSystem,
            locales: tenant.locales,
            defaultLocale: tenant.defaultLocale,
          }}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
```

`src/app/[tenant]/[locale]/not-found.tsx`:

```tsx
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="font-display text-3xl">We couldn’t find that page</h1>
      <p className="text-muted">Check the link, or go back to the menu.</p>
      <a href="/" className="mt-2 inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-on-accent">
        Back to the menu
      </a>
    </main>
  );
}
```

Replace `src/app/[tenant]/[locale]/page.tsx` with a version that returns 404 for unknown routes (the menu replaces it in Task 14):

```tsx
import { notFound } from 'next/navigation';
import { resolveRoute } from '@/server/route-context';

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  return (
    <main>
      <h1>{route.tenant.name}</h1>
    </main>
  );
}
```

- [ ] **Step 10: Run unit tests, then the shell end-to-end test**

Run: `npx vitest run tests/ui`
Expected: PASS, brand (2) and cart-store (4) tests.

Run: `npm run db:up && npm run db:seed && npx playwright test tests/e2e/shell.spec.ts`
Expected: PASS, 3 tests. The language test clicks the `کوردی` link and expects `lang="ckb"`.

- [ ] **Step 11: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src tests playwright.config.ts
git commit -m "feat(ui): application shell with brand tokens, providers, sheet and language switch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Quick Menu

**Files:**
- Create: `src/ui/art/ProductArt.tsx`, `src/ui/art/ProductVisual.tsx`
- Create: `src/ui/menu/Header.tsx`, `src/ui/menu/SignatureFeature.tsx`, `src/ui/menu/CategoryRail.tsx`, `src/ui/menu/ProductRow.tsx`, `src/ui/menu/MenuApp.tsx`
- Create: `src/ui/cart/CartBar.tsx`
- Replace: `src/app/[tenant]/[locale]/page.tsx`
- Test: `tests/e2e/menu.spec.ts`

**Interfaces:**
- Consumes: `MenuView`, `MenuProductView`, `useApp`, `matchesQuery`, `normalizeSearch`, `MediaItem`.
- Produces: `ProductVisual({ media, name, slug, className?, priority?, sizes? })`, `MenuApp({ view }: { view: MenuView })`, `CartBar()`. `MenuApp` tracks which product is open (`openId`) and pushes `/p/{slug}` onto history; Task 15 renders the sheet at the marked comment.

- [ ] **Step 1: Write the failing end-to-end test**

`tests/e2e/menu.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('Quick Menu', () => {
  test('shows the menu immediately without any interaction', async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.getByTestId('brand')).toHaveText('ATELIER');
    await expect(page.getByRole('searchbox', { name: 'Search the menu' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu categories' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Atelier Burger/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coffee & Tea' })).toBeVisible();
  });

  test('lists all five categories and twenty-four products', async ({ page }) => {
    await page.goto('/atelier/en');
    const rail = page.getByRole('navigation', { name: 'Menu categories' });
    await expect(rail.getByRole('link')).toHaveCount(5);
    await expect(page.getByTestId('product-row')).toHaveCount(24);
  });

  test('filters by search in English, Arabic and Sorani', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });

    const rows = page.getByTestId('product-row');

    await search.fill('burger');
    await expect(rows.filter({ hasText: 'Atelier Burger' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Espresso' })).toHaveCount(0);

    await search.fill('برغر');
    await expect(rows.filter({ hasText: 'Atelier Burger' })).toHaveCount(1);

    await search.fill('کرواسان');
    await expect(rows.filter({ hasText: 'Croissant' })).toHaveCount(1);

    await search.fill('٢٥٠');
    await expect(rows.filter({ hasText: 'Ribeye' })).toHaveCount(1);
  });

  test('handles empty and hostile search input without breaking', async ({ page }) => {
    await page.goto('/atelier/en');
    const search = page.getByRole('searchbox', { name: 'Search the menu' });
    for (const hostile of ['(', '[', '.*', '\\', '   ']) {
      await search.fill(hostile);
      await expect(page.getByTestId('brand')).toBeVisible();
    }
    await search.fill('zzzzqqqq');
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('product-row')).toHaveCount(24);
  });

  test('quick add puts a simple item into the order bar', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    const bar = page.getByTestId('cart-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 item');
    await expect(bar).toContainText('$3.00');
  });

  test('items that need choices have no quick add', async ({ page }) => {
    await page.goto('/atelier/en');
    await expect(page.getByRole('button', { name: /Add Ribeye/ })).toHaveCount(0);
  });

  test('never scrolls horizontally on a 320 px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/atelier/en');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto('/atelier/ar');
    const overflowRtl = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowRtl).toBeLessThanOrEqual(0);
  });

  test('renders right to left in Arabic with translated content', async ({ page }) => {
    await page.goto('/atelier/ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('searchbox', { name: 'ابحث في القائمة' })).toBeVisible();
    await expect(page.getByRole('button', { name: /برغر أتيليه/ }).first()).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/menu.spec.ts`
Expected: FAIL; the page is only the placeholder heading.

- [ ] **Step 3: Implement the product art**

`src/ui/art/ProductArt.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { ArtKind } from '@/lib/media';

interface Ids {
  metal: string;
  glass: string;
  shade: string;
}

const SHAPES: Record<ArtKind, (tone: string, ids: Ids) => ReactNode> = {
  cup: (tone, ids) => (
    <>
      <ellipse cx="100" cy="150" rx="62" ry="11" fill={`url(#${ids.metal})`} />
      <ellipse cx="100" cy="147" rx="46" ry="7" fill="#1B1A19" opacity=".35" />
      <path d="M58 92h84c0 36-14 58-42 58S58 128 58 92z" fill="#F4EFE6" />
      <path d="M58 92h84c0 36-14 58-42 58S58 128 58 92z" fill={`url(#${ids.shade})`} />
      <ellipse cx="100" cy="92" rx="42" ry="9" fill="#E9E1D3" />
      <ellipse cx="100" cy="93" rx="36" ry="6.5" fill={tone} />
      <path d="M141 100c18-2 22 16 8 24-5 3-10 4-15 4" fill="none" stroke="#F4EFE6" strokeWidth="6" strokeLinecap="round" />
      <path d="M70 100c2 20 10 34 22 40" stroke="#fff" strokeOpacity=".5" strokeWidth="3" fill="none" strokeLinecap="round" />
    </>
  ),
  glass: (tone, ids) => (
    <>
      <path d="M68 52h64l-8 100a8 8 0 0 1-8 7H84a8 8 0 0 1-8-7z" fill={`url(#${ids.glass})`} stroke="#fff" strokeOpacity=".35" />
      <path d="M73 88h54l-5 64a6 6 0 0 1-6 5H84a6 6 0 0 1-6-5z" fill={tone} opacity=".92" />
      <rect x="86" y="96" width="12" height="12" rx="3" fill="#fff" opacity=".35" transform="rotate(-12 92 102)" />
      <rect x="106" y="116" width="10" height="10" rx="3" fill="#fff" opacity=".3" transform="rotate(10 111 121)" />
      <path d="M116 40l12 52" stroke="#D6BC8A" strokeWidth="3" strokeLinecap="round" />
    </>
  ),
  plate: (tone, ids) => (
    <>
      <ellipse cx="100" cy="132" rx="78" ry="26" fill={`url(#${ids.metal})`} opacity=".9" />
      <ellipse cx="100" cy="128" rx="64" ry="20" fill="#F4EFE6" />
      <ellipse cx="100" cy="126" rx="46" ry="13" fill="#E9E1D3" />
      <ellipse cx="92" cy="116" rx="26" ry="14" fill={tone} />
      <ellipse cx="116" cy="122" rx="18" ry="10" fill={tone} opacity=".75" />
      <circle cx="80" cy="106" r="5" fill="#7C9B5A" />
      <circle cx="124" cy="112" r="4" fill="#7C9B5A" />
      <ellipse cx="88" cy="110" rx="12" ry="5" fill="#fff" opacity=".18" />
    </>
  ),
  pastry: (tone, ids) => (
    <>
      <ellipse cx="100" cy="150" rx="60" ry="10" fill={`url(#${ids.metal})`} />
      <rect x="58" y="112" width="84" height="30" rx="8" fill="#E6C98F" />
      <rect x="58" y="92" width="84" height="22" rx="8" fill={tone} />
      <rect x="58" y="76" width="84" height="18" rx="8" fill="#F4EFE6" />
      <rect x="58" y="62" width="84" height="16" rx="8" fill={tone} opacity=".9" />
      <path d="M70 66c14-8 46-8 60 0" stroke="#fff" strokeOpacity=".4" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M96 56l8-8 8 8-8 6z" fill="#D6BC8A" />
    </>
  ),
  bowl: (tone, ids) => (
    <>
      <path d="M46 98h108c0 38-22 58-54 58S46 136 46 98z" fill="#F4EFE6" />
      <path d="M46 98h108c0 38-22 58-54 58S46 136 46 98z" fill={`url(#${ids.shade})`} />
      <ellipse cx="100" cy="98" rx="54" ry="10" fill="#E9E1D3" />
      <path d="M52 98c10-26 30-34 48-34s38 8 48 34z" fill={tone} />
      <circle cx="82" cy="84" r="5" fill="#fff" opacity=".35" />
      <circle cx="116" cy="78" r="6" fill="#7C9B5A" />
      <circle cx="102" cy="90" r="4" fill="#D6BC8A" />
    </>
  ),
  burger: (tone, ids) => (
    <>
      <ellipse cx="100" cy="152" rx="60" ry="9" fill={`url(#${ids.metal})`} />
      <path d="M50 118h100a8 8 0 0 1 0 22H50a8 8 0 0 1 0-22z" fill="#C98F4A" />
      <rect x="48" y="104" width="104" height="16" rx="8" fill="#4A2C21" />
      <path d="M46 104h108l-8 10h-22l-10 8-10-8H62z" fill="#E5C14B" />
      <path d="M46 98c4-8 12-8 18-4 6-6 14-6 20 0 6-6 14-6 20 0 6-6 14-6 20 0 6-4 14-4 20 4z" fill="#7C9B5A" />
      <path d="M48 90c0-30 24-46 52-46s52 16 52 46z" fill={tone} />
      <path d="M70 62c8-8 22-10 34-8" stroke="#fff" strokeOpacity=".4" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="86" cy="70" r="2.5" fill="#F4EFE6" />
      <circle cx="112" cy="64" r="2.5" fill="#F4EFE6" />
      <circle cx="128" cy="76" r="2.5" fill="#F4EFE6" />
    </>
  ),
};

/** Art-directed placeholder still life. Real photography replaces it through the product's media list. */
export function ProductArt({
  kind,
  tone,
  uid,
  className,
}: {
  kind: ArtKind;
  tone: string;
  uid: string;
  className?: string;
}) {
  const ids: Ids = { metal: `${uid}-metal`, glass: `${uid}-glass`, shade: `${uid}-shade` };
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={className} preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`${uid}-bg`} cx="50%" cy="38%" r="75%">
          <stop offset="0" stopColor="#3A3633" />
          <stop offset="1" stopColor="#1B1A19" />
        </radialGradient>
        <linearGradient id={ids.metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F2E4C4" />
          <stop offset=".5" stopColor="#D6BC8A" />
          <stop offset="1" stopColor="#8F7648" />
        </linearGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".06" />
          <stop offset="1" stopColor="#fff" stopOpacity=".2" />
        </linearGradient>
        <linearGradient id={ids.shade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".35" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill={`url(#${uid}-bg)`} />
      <ellipse cx="100" cy="162" rx="64" ry="9" fill="#000" opacity=".4" />
      {SHAPES[kind](tone, ids)}
    </svg>
  );
}
```

`src/ui/art/ProductVisual.tsx`:

```tsx
import Image from 'next/image';
import type { MediaItem } from '@/lib/media';
import { ProductArt } from './ProductArt';

interface Props {
  media: MediaItem[];
  name: string;
  slug: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

export function ProductVisual({ media, name, slug, className = '', priority = false, sizes = '96px' }: Props) {
  const first = media[0];
  const frame = `relative block overflow-hidden bg-raised ${className}`;

  if (!first) return <span className={frame} aria-hidden="true" />;

  if (first.kind === 'art') {
    return (
      <span className={frame}>
        <ProductArt kind={first.art} tone={first.tone} uid={slug} className="size-full" />
      </span>
    );
  }

  const source = first.kind === 'image' ? first.url : first.poster;
  const sameOrigin = source.startsWith('/');
  return (
    <span className={frame}>
      {sameOrigin ? (
        <Image
          src={source}
          alt={first.kind === 'image' ? first.alt : name}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt={first.kind === 'image' ? first.alt : name} className="size-full object-cover" />
      )}
    </span>
  );
}
```

- [ ] **Step 4: Implement the menu components**

`src/ui/menu/Header.tsx`:

```tsx
'use client';

import { useApp } from '@/ui/AppProviders';
import { LanguageSwitch } from '@/ui/LanguageSwitch';

export function Header() {
  const { tenant, table, t, href } = useApp();
  return (
    <header className="flex items-start justify-between gap-4 px-4 pt-5 pb-2">
      <div className="min-w-0">
        <h1 className="font-display text-3xl tracking-wide text-text">
          <a href={href()} data-testid="brand" className="flex min-h-11 items-center">
            {tenant.logoText}
          </a>
        </h1>
        {table !== null && (
          <p className="mt-0.5 text-sm text-muted">{t('menu.table', { number: String(table).padStart(2, '0') })}</p>
        )}
      </div>
      <LanguageSwitch />
    </header>
  );
}
```

`src/ui/menu/CategoryRail.tsx`:

```tsx
'use client';

import { useApp } from '@/ui/AppProviders';

export function CategoryRail({
  categories,
  activeId,
}: {
  categories: Array<{ id: string; slug: string; name: string }>;
  activeId: string | null;
}) {
  const { t } = useApp();
  return (
    <nav
      aria-label={t('menu.categories')}
      className="scroll-hidden sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg px-3"
    >
      {categories.map((category) => (
        <a
          key={category.id}
          href={`#cat-${category.slug}`}
          aria-current={category.id === activeId ? 'true' : undefined}
          className={`grid min-h-12 shrink-0 place-items-center border-b-2 px-3 text-sm transition-colors ${
            category.id === activeId ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
          }`}
        >
          {category.name}
        </a>
      ))}
    </nav>
  );
}
```

`src/ui/menu/ProductRow.tsx`:

```tsx
'use client';

import { motion } from 'motion/react';
import type { MenuProductView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { PlusIcon } from '@/ui/Icons';

export function ProductRow({ product, onOpen }: { product: MenuProductView; onOpen: (id: string) => void }) {
  const { t, money, addLine, announce } = useApp();
  const orderable = product.orderState === 'OK';
  const canQuickAdd = orderable && !product.needsChoices;

  return (
    <li data-testid="product-row" className="relative border-b border-line">
      <button
        type="button"
        onClick={() => onOpen(product.id)}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-4 text-start"
      >
        <span className="min-w-0">
          <span className="block font-display text-lg leading-snug">{product.name}</span>
          {product.description && (
            <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-muted">{product.description}</span>
          )}
          <span className="mt-2 block text-sm tabular-nums">{money(product.basePrice)}</span>
          {!orderable && (
            <span className="mt-1 block text-sm text-accent">
              {t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable')}
            </span>
          )}
        </span>
        <ProductVisual
          media={product.media}
          name={product.name}
          slug={product.slug}
          className={`size-24 rounded-lg ${orderable ? '' : 'opacity-50'}`}
        />
      </button>
      {canQuickAdd && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          aria-label={t('product.quickAdd', { name: product.name })}
          onClick={() => {
            addLine({ productId: product.id, variantId: null, optionIds: [], quantity: 1 });
            track('ADD_TO_CART', { productId: product.id, payload: { source: 'quick-add' } });
            announce(t('cart.added', { name: product.name }));
          }}
          className="absolute end-3 bottom-3 grid size-11 place-items-center rounded-full bg-accent text-on-accent"
        >
          <PlusIcon />
        </motion.button>
      )}
    </li>
  );
}
```

`src/ui/menu/SignatureFeature.tsx`:

```tsx
'use client';

import { motion } from 'motion/react';
import type { MenuProductView } from '@/server/data/menu-view';
import type { Daypart } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';

export function SignatureFeature({
  product,
  daypart,
  onOpen,
}: {
  product: MenuProductView;
  daypart: Daypart | null;
  onOpen: (id: string) => void;
}) {
  const { t, money } = useApp();
  return (
    <motion.section
      aria-labelledby="signature-title"
      initial={{ y: 10 }}
      animate={{ y: 0 }}
      transition={{ type: 'spring', duration: 0.6, bounce: 0.1 }}
      className="px-4 pt-4 pb-6"
    >
      <p className="text-sm text-muted">{t(`signature.${daypart ?? 'NONE'}`)}</p>
      <button type="button" onClick={() => onOpen(product.id)} className="mt-2 block w-full text-start">
        <ProductVisual
          media={product.media}
          name={product.name}
          slug={`${product.slug}-feature`}
          priority
          sizes="(min-width: 640px) 576px, 100vw"
          className="aspect-[4/3] w-full rounded-xl"
        />
        <span id="signature-title" className="mt-4 block font-display text-3xl leading-tight">
          {product.name}
        </span>
        {product.description && <span className="mt-2 block max-w-prose text-muted">{product.description}</span>}
        <span className="mt-3 block tabular-nums">{money(product.basePrice)}</span>
      </button>
    </motion.section>
  );
}
```

`src/ui/cart/CartBar.tsx`:

```tsx
'use client';

import { useApp } from '@/ui/AppProviders';

export function CartBar() {
  const { itemCount, quote, quoting, money, t, href } = useApp();
  if (itemCount === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <a
        href={href('/cart')}
        data-testid="cart-bar"
        className="pointer-events-auto mx-auto flex min-h-14 w-full max-w-xl items-center justify-between rounded-full bg-accent px-6 text-on-accent"
      >
        <span>{t('cart.items', { count: itemCount })}</span>
        <span className="tabular-nums" aria-live="polite">
          {quote ? money(quote.subtotal) : quoting ? t('cart.updating') : t('cart.open')}
        </span>
      </a>
    </div>
  );
}
```

`src/ui/menu/MenuApp.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { matchesQuery } from '@/lib/search';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { CartBar } from '@/ui/cart/CartBar';
import { CloseIcon, SearchIcon } from '@/ui/Icons';
import { CategoryRail } from './CategoryRail';
import { Header } from './Header';
import { ProductRow } from './ProductRow';
import { SignatureFeature } from './SignatureFeature';

export function MenuApp({ view }: { view: MenuView }) {
  const { t, href } = useApp();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(view.categories[0]?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    track('MENU_VIEW', {}, { once: true });
  }, []);

  const visible = useMemo(
    () => view.products.filter((product) => matchesQuery(product.searchKey, query)),
    [view.products, query],
  );
  const byCategory = useMemo(() => {
    const groups = new Map<string, MenuProductView[]>();
    for (const product of visible) groups.set(product.categoryId, [...(groups.get(product.categoryId) ?? []), product]);
    return groups;
  }, [visible]);
  const categories = useMemo(
    () => view.categories.filter((category) => byCategory.has(category.id)),
    [view.categories, byCategory],
  );
  const signature = view.products.find((product) => product.id === view.signatureProductId);

  useEffect(() => {
    const targets = categories
      .map((category) => document.getElementById(`cat-${category.slug}`))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((entry) => entry.isIntersecting);
        if (hit) {
          const match = categories.find((category) => `cat-${category.slug}` === hit.target.id);
          if (match) setActiveId(match.id);
        }
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [categories]);

  // Product sheet history: opening pushes /p/{slug}; Back closes the sheet.
  const openProduct = (id: string) => {
    const product = view.products.find((candidate) => candidate.id === id);
    if (!product) return;
    track('PRODUCT_VIEW', { productId: id });
    window.history.pushState({ sheet: true }, '', href(`/p/${product.slug}`));
    setOpenId(id);
  };
  const closeProduct = () => {
    if (window.history.state?.sheet) window.history.back();
    else setOpenId(null);
  };
  useEffect(() => {
    const onPop = () => {
      const match = window.location.pathname.match(/\/p\/([^/]+)$/);
      const product = match ? view.products.find((candidate) => candidate.slug === decodeURIComponent(match[1] as string)) : null;
      setOpenId(product?.id ?? null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [view.products]);

  const opened = openId ? view.products.find((product) => product.id === openId) : undefined;
  void opened;
  void closeProduct;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <a
        href="#menu"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-30 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        {t('menu.skip')}
      </a>
      <Header />

      <div className="px-4 pb-3">
        <label className="relative block">
          <span className="sr-only">{t('menu.search')}</span>
          <SearchIcon className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            role="searchbox"
            aria-label={t('menu.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('menu.searchPlaceholder')}
            className="h-12 w-full rounded-full border border-line bg-surface ps-11 pe-12 text-base text-text placeholder:text-muted"
          />
          {query !== '' && (
            <button
              type="button"
              aria-label={t('menu.clearSearch')}
              onClick={() => setQuery('')}
              className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-muted"
            >
              <CloseIcon />
            </button>
          )}
        </label>
      </div>

      {query.trim() === '' && signature && (
        <SignatureFeature product={signature} daypart={view.daypart} onOpen={openProduct} />
      )}

      <CategoryRail categories={categories.length > 0 ? categories : view.categories} activeId={activeId} />

      <main id="menu">
        {visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-muted">{t('menu.noResults', { query: query.trim() })}</p>
        ) : (
          categories.map((category) => (
            <section key={category.id} id={`cat-${category.slug}`} aria-labelledby={`h-${category.slug}`} className="scroll-mt-14">
              <h2 id={`h-${category.slug}`} className="px-4 pt-8 pb-2 font-display text-2xl">
                {category.name}
              </h2>
              <ul>
                {(byCategory.get(category.id) ?? []).map((product) => (
                  <ProductRow key={product.id} product={product} onOpen={openProduct} />
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      <CartBar />
      {/* Task 15 renders <ProductSheet product={opened} view={view} close={closeProduct} open={openProduct} /> here. */}
    </div>
  );
}
```

Replace `src/app/[tenant]/[locale]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { MenuApp } from '@/ui/menu/MenuApp';

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  const view = await loadMenuView(route);
  return <MenuApp view={view} />;
}
```

- [ ] **Step 5: Run the end-to-end test**

Run: `npx playwright test tests/e2e/menu.spec.ts tests/e2e/shell.spec.ts`
Expected: PASS, every test. If the Arabic search expectation for `برغر` fails, confirm the Arabic name `برغر أتيليه` is in the seed and that `normalizeSearch` is applied to both the key and the query (it is, in `buildMenuView` and `matchesQuery`).

- [ ] **Step 6: Lint, typecheck, build, commit**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all exit 0. The build output lists `/[tenant]/[locale]` as a dynamic route.

```bash
git add src tests
git commit -m "feat(menu): Quick Menu with signature pick, category rail, search and quick add" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Product detail: sheet, full page, options, upgrades and Perfect Pairing

**Files:**
- Create: `src/ui/useSuggestions.ts`
- Create: `src/ui/product/OptionGroup.tsx`, `src/ui/product/UpgradeOffers.tsx`, `src/ui/product/PairingList.tsx`, `src/ui/product/ProductDetail.tsx`, `src/ui/product/ProductSheet.tsx`, `src/ui/product/ProductPage.tsx`
- Create: `src/app/[tenant]/[locale]/p/[slug]/page.tsx`
- Modify: `src/ui/menu/MenuApp.tsx`
- Test: `tests/e2e/product.spec.ts`

**Interfaces:**
- Consumes: `useApp`, `unitPriceFromMenu`, `SuggestionsView`, `UpsellOffer`, `PairingView`, `Sheet`, `ProductVisual`, `track`, `MenuProductView`, `MenuView`.
- Produces from `useSuggestions.ts`: `type SuggestionsBody = { context: 'menu' | 'product' | 'cart'; product?: { productId: string; variantId: string | null; optionIds: string[] }; cart: CartInput; dismissedIds: string[] }`, `useSuggestions(body: SuggestionsBody | null): { data: SuggestionsView | null }`.
- Produces: `ProductDetail({ product, mode: 'sheet' | 'page', titleId, onDone, onSwitch })`, `ProductSheet({ product, close, open })`, `ProductPage({ product, view })`, `PairingList({ offers, onAdd, onChoose, onDismiss })`, `UpgradeOffers({ offers, onAccept })`, `OptionGroup(...)`.

- [ ] **Step 1: Write the failing end-to-end test**

`tests/e2e/product.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

async function openBurger(page: import('@playwright/test').Page) {
  await page.goto('/atelier/en');
  await page
    .getByTestId('product-row')
    .filter({ hasText: 'Atelier Burger' })
    .getByRole('button', { name: /Atelier Burger/ })
    .first()
    .click();
  return page.getByRole('dialog');
}

test.describe('Product detail', () => {
  test('opens a sheet with live totals, upgrades and a pairing', async ({ page }) => {
    const dialog = await openBurger(page);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/atelier\/en\/p\/atelier-burger$/);
    await expect(dialog.getByRole('heading', { name: 'Atelier Burger' })).toBeVisible();

    const add = dialog.getByRole('button', { name: /Add to order/ });
    await expect(add).toContainText('$9.00');

    await dialog.getByRole('checkbox', { name: /Premium cheese/ }).check();
    await expect(add).toContainText('$10.00');

    await expect(dialog.getByRole('heading', { name: 'Upgrades' })).toBeVisible();
    await expect(dialog.getByText('Total becomes $13.00').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Add Double patty' }).click();
    await expect(add).toContainText('$13.00');

    await expect(dialog.getByRole('heading', { name: 'Perfect pairing' })).toBeVisible();
    await expect(dialog.getByText('Truffle Fries')).toBeVisible();
  });

  test('adds the configured burger to the order and closes', async ({ page }) => {
    const dialog = await openBurger(page);
    await dialog.getByRole('checkbox', { name: /Premium cheese/ }).check();
    await dialog.getByRole('button', { name: /Add to order/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    const bar = page.getByTestId('cart-bar');
    await expect(bar).toContainText('1 item');
    await expect(bar).toContainText('$10.00');
  });

  test('adds a pairing straight from the sheet', async ({ page }) => {
    const dialog = await openBurger(page);
    await dialog.getByRole('button', { name: 'Add Truffle Fries' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await expect(page.getByTestId('cart-bar')).toContainText('$5.50');
  });

  test('can dismiss a pairing for the session', async ({ page }) => {
    const dialog = await openBurger(page);
    const fries = dialog.getByRole('listitem').filter({ hasText: 'Truffle Fries' });
    await expect(fries).toHaveCount(1);
    await fries.getByRole('button', { name: 'Not now' }).click();
    await expect(dialog.getByRole('listitem').filter({ hasText: 'Truffle Fries' })).toHaveCount(0);
  });

  test('closes with Escape and returns to the menu URL', async ({ page }) => {
    const dialog = await openBurger(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en$/);
  });

  test('closes with the browser back button', async ({ page }) => {
    const dialog = await openBurger(page);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/atelier\/en$/);
  });

  test('blocks adding until a required choice is made', async ({ page }) => {
    await page.goto('/atelier/en');
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Ribeye' })
      .getByRole('button', { name: /Ribeye/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    const add = dialog.getByRole('button', { name: /Add to order/ });
    await expect(add).toBeDisabled();
    await expect(dialog.getByText('Make your choices to continue')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Medium rare' }).check();
    await expect(add).toBeEnabled();
    await expect(add).toContainText('$28.00');
  });

  test('offers a larger size as an upgrade and applies it', async ({ page }) => {
    await page.goto('/atelier/en');
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Cold Brew' })
      .getByRole('button', { name: /Cold Brew/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: /Regular 350 ml/ })).toBeChecked();
    await dialog.getByRole('button', { name: /Add Large 500 ml/ }).click();
    await expect(dialog.getByRole('radio', { name: /Large 500 ml/ })).toBeChecked();
    await expect(dialog.getByRole('button', { name: /Add to order/ })).toContainText('$6.50');
  });

  test('works as a full page on direct load', async ({ page }) => {
    await page.goto('/atelier/en/p/atelier-burger');
    await expect(page.getByRole('heading', { name: 'Atelier Burger', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the menu' })).toBeVisible();
    await page.getByRole('button', { name: /Add to order/ }).click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
  });

  test('returns 404 for an unknown product', async ({ request }) => {
    expect((await request.get('/atelier/en/p/does-not-exist')).status()).toBe(404);
  });

  test('shows the product in Sorani with direction flipped', async ({ page }) => {
    await page.goto('/atelier/ckb/p/atelier-burger');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'بەرگەری ئاتەلیە' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/product.spec.ts`
Expected: FAIL; clicking a row opens nothing yet and `/p/{slug}` returns 404.

- [ ] **Step 3: Implement `useSuggestions.ts`**

`src/ui/useSuggestions.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import type { SuggestionsView } from '@/server/data/suggestion-view';
import type { CartInput } from '@/server/domain/types';
import { useApp } from '@/ui/AppProviders';

export interface SuggestionsBody {
  context: 'menu' | 'product' | 'cart';
  product?: { productId: string; variantId: string | null; optionIds: string[] };
  cart: CartInput;
  dismissedIds: string[];
}

/** Fetches suggestions, keeping the previous answer on screen while a new one loads. */
export function useSuggestions(body: SuggestionsBody | null): { data: SuggestionsView | null } {
  const { tenant, locale } = useApp();
  const [data, setData] = useState<SuggestionsView | null>(null);
  const payload = body ? JSON.stringify({ ...body, locale }) : null;

  useEffect(() => {
    if (!payload) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/${tenant.slug}/suggestions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: payload,
          signal: controller.signal,
        });
        if (response.ok) setData((await response.json()) as SuggestionsView);
      } catch {
        // Suggestions are optional; the menu works without them.
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [payload, tenant.slug]);

  return { data: payload ? data : null };
}
```

- [ ] **Step 4: Implement the option group, upgrade list and pairing list**

`src/ui/product/OptionGroup.tsx`:

```tsx
'use client';

import { useId } from 'react';
import { useApp } from '@/ui/AppProviders';

export interface OptionItem {
  id: string;
  name: string;
  effect?: string | null;
  priceDelta: number;
  disabled?: boolean;
}

export function OptionGroup({
  title,
  items,
  selected,
  min,
  max,
  onToggle,
}: {
  title: string;
  items: OptionItem[];
  selected: string[];
  min: number;
  max: number;
  onToggle: (id: string) => void;
}) {
  const { t, money } = useApp();
  const name = useId();
  const single = max === 1;
  const requirement =
    min > 0 ? t('product.required') : single ? t('product.optional') : t('product.chooseUpTo', { max });

  return (
    <fieldset className="mt-6 border-0 p-0">
      <legend className="flex w-full items-baseline justify-between gap-3 pb-1">
        <span className="font-display text-lg">{title}</span>
        <span className="text-sm text-muted">{requirement}</span>
      </legend>
      <ul>
        {items.map((item) => {
          const checked = selected.includes(item.id);
          return (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <label
                className={`flex min-h-12 cursor-pointer items-center gap-3 py-2 ${item.disabled ? 'opacity-50' : ''}`}
              >
                <input
                  type={single && min > 0 ? 'radio' : 'checkbox'}
                  name={name}
                  checked={checked}
                  disabled={item.disabled}
                  onChange={() => onToggle(item.id)}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{item.name}</span>
                  {item.effect && <span className="block text-sm text-muted">{item.effect}</span>}
                </span>
                {item.priceDelta !== 0 && (
                  <span className="shrink-0 text-sm tabular-nums text-muted">
                    {item.priceDelta > 0 ? '+' : ''}
                    {money(item.priceDelta)}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
```

`src/ui/product/UpgradeOffers.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import type { UpsellOffer } from '@/server/domain';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';

export function UpgradeOffers({
  productId,
  offers,
  onAccept,
}: {
  productId: string;
  offers: UpsellOffer[];
  onAccept: (offer: UpsellOffer) => void;
}) {
  const { t, money } = useApp();

  useEffect(() => {
    for (const offer of offers) {
      track('UPSELL_IMPRESSION', { productId, suggestionId: offer.suggestionId }, { once: true });
    }
  }, [offers, productId]);

  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="upgrades-title" className="mt-8">
      <h3 id="upgrades-title" className="font-display text-lg">
        {t('upgrade.title')}
      </h3>
      <ul className="mt-1">
        {offers.map((offer) => (
          <li key={offer.suggestionId} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p>{offer.title}</p>
              {offer.effect && <p className="text-sm text-muted">{offer.effect}</p>}
              <p className="text-sm text-muted tabular-nums">
                {t('upgrade.becomes', { amount: money(offer.resultingTotal) })}
              </p>
            </div>
            <span className="shrink-0 text-sm tabular-nums">+{money(offer.priceDelta)}</span>
            <button
              type="button"
              onClick={() => {
                track('UPSELL_ACCEPT', { productId, suggestionId: offer.suggestionId });
                onAccept(offer);
              }}
              className="min-h-11 shrink-0 rounded-full border border-accent px-4 text-sm text-accent"
              aria-label={`${offer.kind === 'SWAP' ? t('upgrade.switch') : t('upgrade.add')} ${offer.title}`}
            >
              {offer.kind === 'SWAP' ? t('upgrade.switch') : t('upgrade.add')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/ui/product/PairingList.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import type { PairingView } from '@/server/data/suggestion-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { CloseIcon } from '@/ui/Icons';

export function PairingList({
  offers,
  onAdd,
  onChoose,
  onDismiss,
}: {
  offers: PairingView[];
  onAdd: (offer: PairingView) => void;
  onChoose: (offer: PairingView) => void;
  onDismiss: (offer: PairingView) => void;
}) {
  const { t, money } = useApp();

  useEffect(() => {
    for (const offer of offers) {
      track('PAIRING_IMPRESSION', { productId: offer.productId, suggestionId: offer.suggestionId }, { once: true });
    }
  }, [offers]);

  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="pairing-title" className="mt-8">
      <h3 id="pairing-title" className="font-display text-lg">
        {t('pairing.title')}
      </h3>
      <ul className="mt-1">
        {offers.map((offer) => (
          <li key={offer.suggestionId} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
            <ProductVisual
              media={offer.media}
              name={offer.name}
              slug={`pair-${offer.productId}`}
              className="size-14 shrink-0 rounded-lg"
              sizes="56px"
            />
            <div className="min-w-0 flex-1">
              <p>{offer.name}</p>
              {offer.reason && <p className="text-sm text-muted">{offer.reason}</p>}
              <p className="text-sm tabular-nums text-muted">{money(offer.price)}</p>
            </div>
            <button
              type="button"
              onClick={() => (offer.needsChoices ? onChoose(offer) : onAdd(offer))}
              aria-label={offer.needsChoices ? t('pairing.choose', { name: offer.name }) : t('pairing.add', { name: offer.name })}
              className="min-h-11 shrink-0 rounded-full border border-accent px-4 text-sm text-accent"
            >
              {t('upgrade.add')}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(offer)}
              aria-label={t('pairing.dismiss')}
              title={t('pairing.dismiss')}
              className="grid size-11 shrink-0 place-items-center text-muted"
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```


- [ ] **Step 5: Implement `ProductDetail.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { unitPriceFromMenu } from '@/lib/menu-price';
import type { MenuProductView } from '@/server/data/menu-view';
import type { UpsellOffer } from '@/server/domain';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { ProductVisual } from '@/ui/art/ProductVisual';
import { CloseIcon, MinusIcon, PlusIcon } from '@/ui/Icons';
import { useSuggestions } from '@/ui/useSuggestions';
import { OptionGroup } from './OptionGroup';
import { PairingList } from './PairingList';
import { UpgradeOffers } from './UpgradeOffers';

interface Props {
  product: MenuProductView;
  mode: 'sheet' | 'page';
  titleId: string;
  /** Called after the item is added, or when the sheet is dismissed. */
  onDone: () => void;
  /** Replaces the open product with another one (an upgrade swap or a pairing that needs choices). */
  onSwitch: (productId: string) => void;
}

export function ProductDetail({ product, mode, titleId, onDone, onSwitch }: Props) {
  const { t, money, addLine, announce, cart, dismissed, dismiss } = useApp();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  const orderable = product.orderState === 'OK';
  const unit = unitPriceFromMenu(product, variantId, selected);
  const missing = product.groups.filter(
    (group) => group.minSelect > group.options.filter((option) => selected.includes(option.id)).length,
  );
  const canAdd = orderable && missing.length === 0;

  const body = useMemo(
    () => ({
      context: 'product' as const,
      product: { productId: product.id, variantId, optionIds: selected },
      cart,
      dismissedIds: dismissed,
    }),
    [product.id, variantId, selected, cart, dismissed],
  );
  const { data } = useSuggestions(orderable ? body : null);

  useEffect(() => {
    if (mode === 'page') track('PRODUCT_VIEW', { productId: product.id }, { once: true });
  }, [mode, product.id]);

  const toggle = (groupId: string, optionId: string) => {
    const group = product.groups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    setSelected((current) => {
      const inGroup = group.options.map((option) => option.id);
      const chosen = current.filter((id) => inGroup.includes(id));
      const others = current.filter((id) => !inGroup.includes(id));
      if (current.includes(optionId)) {
        return group.minSelect > 0 && group.maxSelect === 1 ? current : [...others, ...chosen.filter((id) => id !== optionId)];
      }
      if (group.maxSelect === 1) return [...others, optionId];
      if (chosen.length >= group.maxSelect) return current;
      return [...others, ...chosen, optionId];
    });
  };

  const accept = (offer: UpsellOffer) => {
    if (offer.kind === 'VARIANT') setVariantId(offer.refId);
    else if (offer.kind === 'OPTION') {
      const group = product.groups.find((candidate) => candidate.options.some((option) => option.id === offer.refId));
      if (group) toggle(group.id, offer.refId);
    } else onSwitch(offer.refId);
  };

  const add = () => {
    if (!canAdd) return;
    addLine({ productId: product.id, variantId, optionIds: selected, quantity });
    track('ADD_TO_CART', { productId: product.id, payload: { source: 'detail', options: selected.length } });
    announce(t('cart.added', { name: product.name }));
    onDone();
  };

  const Heading = mode === 'page' ? 'h1' : 'h2';
  const defaultVariant = product.variants.find((variant) => variant.isDefault)?.id ?? null;
  const effectiveVariant = variantId ?? defaultVariant;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative">
        <ProductVisual
          media={product.media}
          name={product.name}
          slug={`${product.slug}-detail`}
          priority
          sizes="(min-width: 640px) 576px, 100vw"
          className="aspect-[16/10] w-full"
        />
        {mode === 'sheet' && (
          <button
            type="button"
            onClick={onDone}
            aria-label={t('product.close')}
            className="absolute end-3 top-3 grid size-11 place-items-center rounded-full bg-bg/80 text-text"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <Heading id={titleId} className="mt-5 font-display text-3xl leading-tight">
          {product.name}
        </Heading>
        {product.description && <p className="mt-2 max-w-prose text-muted">{product.description}</p>}
        <p className="mt-3 tabular-nums">{money(product.basePrice)}</p>
        {!orderable && (
          <p className="mt-3 text-accent">
            {t(product.orderState === 'OUT_OF_STOCK' ? 'product.soldOut' : 'product.unavailable')}
          </p>
        )}

        {product.variants.length > 1 && (
          <OptionGroup
            title={t('product.size')}
            min={1}
            max={1}
            selected={effectiveVariant ? [effectiveVariant] : []}
            items={product.variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              priceDelta: variant.priceDelta - (product.variants.find((v) => v.isDefault)?.priceDelta ?? 0),
            }))}
            onToggle={(id) => setVariantId(id === defaultVariant ? null : id)}
          />
        )}

        {product.groups.map((group) => (
          <OptionGroup
            key={group.id}
            title={group.name}
            min={group.minSelect}
            max={group.maxSelect}
            selected={selected}
            items={group.options.map((option) => ({
              id: option.id,
              name: option.name,
              effect: option.effect,
              priceDelta: option.priceDelta,
              disabled: !option.isAvailable,
            }))}
            onToggle={(id) => toggle(group.id, id)}
          />
        ))}

        {orderable && <UpgradeOffers productId={product.id} offers={data?.upgrades ?? []} onAccept={accept} />}

        {orderable && (
          <PairingList
            offers={data?.pairings ?? []}
            onAdd={(offer) => {
              addLine({ productId: offer.productId, variantId: null, optionIds: [], quantity: 1 });
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              announce(t('cart.added', { name: offer.name }));
            }}
            onChoose={(offer) => {
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              onSwitch(offer.productId);
            }}
            onDismiss={(offer) => dismiss(offer.suggestionId)}
          />
        )}

        {product.ingredients.length > 0 && (
          <section className="mt-8">
            <h3 className="font-display text-lg">{t('product.ingredients')}</h3>
            <p className="mt-1 text-muted">{product.ingredients.join(', ')}</p>
          </section>
        )}
        {product.allergens.length > 0 && (
          <p className="mt-4 text-sm text-muted">
            {t('product.allergens')}: {product.allergens.map((key) => t(`allergen.${key}`)).join(', ')}
          </p>
        )}
      </div>

      <div className="border-t border-line bg-surface px-5 py-4">
        {!canAdd && orderable && <p className="mb-3 text-sm text-accent">{t('product.makeChoices')}</p>}
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full border border-line" role="group" aria-label={t('product.quantity')}>
            <button
              type="button"
              aria-label={t('product.decrease')}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="grid size-11 place-items-center"
            >
              <MinusIcon />
            </button>
            <output className="min-w-6 text-center tabular-nums" aria-live="polite">
              {quantity}
            </output>
            <button
              type="button"
              aria-label={t('product.increase')}
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              className="grid size-11 place-items-center"
            >
              <PlusIcon />
            </button>
          </div>
          <button
            type="button"
            disabled={!canAdd}
            onClick={add}
            className="flex min-h-12 flex-1 items-center justify-between rounded-full bg-accent px-6 text-on-accent disabled:opacity-40"
          >
            <span>{t('product.add')}</span>
            <span className="tabular-nums">{money(unit * quantity)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
```


- [ ] **Step 6: Implement the sheet, the page wrapper and the route**

`src/ui/product/ProductSheet.tsx`:

```tsx
'use client';

import type { MenuProductView } from '@/server/data/menu-view';
import { Sheet } from '@/ui/Sheet';
import { ProductDetail } from './ProductDetail';

export function ProductSheet({
  product,
  close,
  open,
}: {
  product: MenuProductView;
  /** Called once the exit animation has finished. */
  close: () => void;
  /** Swaps the open product in place (history is replaced, not pushed). */
  open: (id: string, replace?: boolean) => void;
}) {
  const titleId = `sheet-title-${product.slug}`;
  return (
    <Sheet labelledBy={titleId} onClose={close}>
      {(requestClose) => (
        <ProductDetail
          key={product.id}
          product={product}
          mode="sheet"
          titleId={titleId}
          onDone={requestClose}
          onSwitch={(id) => open(id, true)}
        />
      )}
    </Sheet>
  );
}
```

`src/ui/product/ProductPage.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';
import { useApp } from '@/ui/AppProviders';
import { CartBar } from '@/ui/cart/CartBar';
import { BackIcon } from '@/ui/Icons';
import { ProductDetail } from './ProductDetail';

export function ProductPage({ product, view }: { product: MenuProductView; view: MenuView }) {
  const { t, href } = useApp();
  const router = useRouter();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <a href={href()} className="flex min-h-12 items-center gap-2 px-4 text-muted">
        <BackIcon />
        <span>{t('product.back')}</span>
      </a>
      <main>
        <ProductDetail
          key={product.id}
          product={product}
          mode="page"
          titleId="product-title"
          onDone={() => router.push(href())}
          onSwitch={(id) => {
            const next = view.products.find((candidate) => candidate.id === id);
            if (next) router.replace(href(`/p/${next.slug}`));
          }}
        />
      </main>
      <CartBar />
    </div>
  );
}
```

`src/app/[tenant]/[locale]/p/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { ProductPage } from '@/ui/product/ProductPage';

export default async function Page({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; slug: string }>;
}) {
  const raw = await params;
  const route = await resolveRoute(raw);
  if (!route) notFound();
  const view = await loadMenuView(route);
  const product = view.products.find((candidate) => candidate.slug === raw.slug);
  if (!product) notFound();
  return <ProductPage product={product} view={view} />;
}
```

- [ ] **Step 7: Wire the sheet into `MenuApp`**

In `src/ui/menu/MenuApp.tsx` make these edits.

Load the sheet lazily so the menu route does not carry it in its initial JavaScript (the spec's code-splitting requirement). Add these imports at the top of the file:

```tsx
import dynamic from 'next/dynamic';

const ProductSheet = dynamic(() => import('@/ui/product/ProductSheet').then((module) => module.ProductSheet));
```

Warm the chunk shortly after the menu is interactive, so the first tap feels instant. Add this effect inside `MenuApp`, next to the existing `MENU_VIEW` effect:

```tsx
  useEffect(() => {
    const warm = setTimeout(() => void import('@/ui/product/ProductSheet'), 1500);
    return () => clearTimeout(warm);
  }, []);
```

Replace the `openProduct` helper so a swap can replace the history entry:

```tsx
  const openProduct = (id: string, replace = false) => {
    const product = view.products.find((candidate) => candidate.id === id);
    if (!product) return;
    track('PRODUCT_VIEW', { productId: id });
    const url = href(`/p/${product.slug}`);
    if (replace) window.history.replaceState({ sheet: true }, '', url);
    else window.history.pushState({ sheet: true }, '', url);
    setOpenId(id);
  };
```

Delete the two lines `void opened;` and `void closeProduct;`, and replace the marked comment near the end of the returned JSX with:

```tsx
      {opened && <ProductSheet product={opened} close={closeProduct} open={openProduct} />}
```

- [ ] **Step 8: Run the end-to-end tests**

Run: `npx playwright test tests/e2e/product.spec.ts tests/e2e/menu.spec.ts`
Expected: PASS. Two likely adjustments:

- If `Add Double patty` is not found, check that `useSuggestions` ran (the network tab shows `POST /api/atelier/suggestions`) and that `UpgradeOffers` renders `aria-label` as `Add Double patty`.
- If the Escape test leaves the URL on `/p/atelier-burger`, confirm `closeProduct` calls `history.back()` and the `popstate` handler clears `openId`.

- [ ] **Step 9: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

```bash
git add src tests
git commit -m "feat(product): detail sheet and page with live totals, upgrades and Perfect Pairing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Cart, bundle suggestion and read-only order review

**Files:**
- Create: `src/ui/cart/BundleSuggestion.tsx`, `src/ui/cart/CartView.tsx`
- Create: `src/app/[tenant]/[locale]/cart/page.tsx`
- Test: `tests/e2e/cart.spec.ts`

**Interfaces:**
- Consumes: `useApp`, `useSuggestions`, `PairingList`, `lineKey`, `QuoteView`, `BundleView`.
- Produces: `CartView()`, `BundleSuggestion({ bundle, onApply })`.
- Relies on `PairingView.slug` (added in Task 11) so a pairing that needs choices can open its product page.

- [ ] **Step 1: Write the failing end-to-end test**

`tests/e2e/cart.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

async function quickAdd(page: Page, name: string) {
  await page.getByRole('button', { name: `Add ${name} to your order` }).click();
}

test.describe('Cart', () => {
  test('shows the server-priced order and a read-only review with no submit control', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await quickAdd(page, 'Truffle Fries');
    await page.getByTestId('cart-bar').click();

    await expect(page).toHaveURL(/\/atelier\/en\/cart$/);
    await expect(page.getByRole('heading', { name: 'Your order' })).toBeVisible();
    const lines = page.getByTestId('cart-line');
    await expect(lines).toHaveCount(2);
    await expect(page.getByTestId('cart-subtotal')).toContainText('$8.50');
    await expect(page.getByRole('heading', { name: 'Order review' })).toBeVisible();
    await expect(page.getByText(/read-only summary/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /submit|place order|confirm|checkout|pay/i }),
    ).toHaveCount(0);
  });

  test('changes quantity and removes lines', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await page.goto('/atelier/en/cart');
    const line = page.getByTestId('cart-line').first();
    await line.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$6.00');
    await line.getByRole('button', { name: 'Decrease quantity' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$3.00');
    await line.getByRole('button', { name: /Remove Espresso/ }).click();
    await expect(page.getByText('Your order is empty')).toBeVisible();
  });

  test('suggests turning a complete meal into a set with the real saving', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Atelier Burger');
    await quickAdd(page, 'Truffle Fries');
    await quickAdd(page, 'Sparkling Water 500 ml');
    await page.goto('/atelier/en/cart');

    await expect(page.getByTestId('cart-subtotal')).toContainText('$17.50');
    const offer = page.getByTestId('bundle-suggestion');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('Burger set');
    await expect(offer).toContainText('You save $2.00');
    await expect(offer).toContainText('Separately $17.50, as a set $15.50');

    await offer.getByRole('button', { name: 'Switch to the set' }).click();
    await expect(page.getByTestId('cart-subtotal')).toContainText('$15.50');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('cart-line')).toContainText('Burger set');
  });

  test('flags a stale line and keeps it out of the total', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'buzzify:cart:atelier',
        JSON.stringify({
          state: {
            cart: {
              lines: [{ productId: 'product-that-was-deleted', variantId: null, optionIds: [], quantity: 2 }],
              bundles: [],
            },
          },
          version: 1,
        }),
      );
    });
    await page.goto('/atelier/en/cart');
    const line = page.getByTestId('cart-line');
    await expect(line).toContainText('No longer on the menu');
    await expect(page.getByTestId('cart-subtotal')).toContainText('$0.00');
    await expect(page.getByText('Remove the unavailable items to continue.')).toBeVisible();
    await line.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByText('Your order is empty')).toBeVisible();
  });

  test('survives corrupted storage', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('buzzify:cart:atelier', '{definitely not json');
    });
    await page.goto('/atelier/en');
    await expect(page.getByTestId('brand')).toBeVisible();
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
  });

  test('keeps the order when the language changes', async ({ page }) => {
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await page.getByRole('link', { name: 'العربية' }).click();
    await expect(page).toHaveURL(/\/atelier\/ar$/);
    await expect(page.getByTestId('cart-bar')).toContainText('عنصر واحد');
    await page.getByTestId('cart-bar').click();
    await expect(page.getByTestId('cart-line')).toContainText('إسبريسو');
  });

  test('is usable without horizontal scroll at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/atelier/en');
    await quickAdd(page, 'Espresso');
    await page.goto('/atelier/en/cart');
    await expect(page.getByTestId('cart-line')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/cart.spec.ts`
Expected: FAIL; `/atelier/en/cart` returns 404.

- [ ] **Step 3: Implement `BundleSuggestion.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import type { BundleView } from '@/server/data/suggestion-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';

export function BundleSuggestion({ bundle, onApply }: { bundle: BundleView; onApply: (bundle: BundleView) => void }) {
  const { t, money } = useApp();

  useEffect(() => {
    track('BUNDLE_IMPRESSION', { suggestionId: bundle.suggestionId }, { once: true });
  }, [bundle.suggestionId]);

  return (
    <section data-testid="bundle-suggestion" aria-labelledby="bundle-title" className="mt-8 rounded-xl border border-line p-4">
      <h3 id="bundle-title" className="font-display text-lg">
        {t('bundle.title')}
      </h3>
      <p className="mt-1">{bundle.name}</p>
      {bundle.description && <p className="text-sm text-muted">{bundle.description}</p>}
      <p className="mt-2 text-sm tabular-nums text-muted">
        {t('bundle.compare', { individual: money(bundle.individualTotal * bundle.times), price: money(bundle.bundlePrice * bundle.times) })}
      </p>
      <p className="text-sm tabular-nums">{t('bundle.save', { amount: money(bundle.savings) })}</p>
      <button
        type="button"
        onClick={() => {
          track('BUNDLE_ACCEPT', { suggestionId: bundle.suggestionId });
          onApply(bundle);
        }}
        className="mt-3 min-h-11 rounded-full bg-accent px-5 text-on-accent"
      >
        {t('bundle.apply')}
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Implement `CartView.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { lineKey } from '@/lib/cart';
import type { QuoteBundleView, QuoteLineView } from '@/server/data/quote-view';
import { track } from '@/ui/analytics/track';
import { useApp } from '@/ui/AppProviders';
import { BackIcon, MinusIcon, PlusIcon } from '@/ui/Icons';
import { PairingList } from '@/ui/product/PairingList';
import { useSuggestions } from '@/ui/useSuggestions';
import { BundleSuggestion } from './BundleSuggestion';

function Stepper({
  quantity,
  name,
  onChange,
}: {
  quantity: number;
  name: string;
  onChange: (next: number) => void;
}) {
  const { t } = useApp();
  return (
    <div className="flex items-center rounded-full border border-line" role="group" aria-label={`${t('product.quantity')}: ${name}`}>
      <button type="button" aria-label={t('product.decrease')} onClick={() => onChange(quantity - 1)} className="grid size-11 place-items-center">
        <MinusIcon />
      </button>
      <output className="min-w-6 text-center tabular-nums">{quantity}</output>
      <button type="button" aria-label={t('product.increase')} onClick={() => onChange(quantity + 1)} className="grid size-11 place-items-center">
        <PlusIcon />
      </button>
    </div>
  );
}

export function CartView() {
  const {
    t,
    money,
    href,
    cart,
    quote,
    quoting,
    quoteError,
    hydrated,
    setQuantity,
    removeLine,
    setBundleQuantity,
    replaceCart,
    addLine,
    announce,
    dismissed,
    dismiss,
  } = useApp();

  const body = useMemo(
    () => (hydrated && (cart.lines.length > 0 || cart.bundles.length > 0) ? { context: 'cart' as const, cart, dismissedIds: dismissed } : null),
    [hydrated, cart, dismissed],
  );
  const { data } = useSuggestions(body);

  const empty = hydrated && cart.lines.length === 0 && cart.bundles.length === 0;
  const issueText = (line: QuoteLineView | QuoteBundleView) =>
    line.issues.map((issue) => t(`issue.${issue.code}`)).filter((text, index, all) => all.indexOf(text) === index);
  const hasIssues = (quote?.hasBlockingIssues ?? false) && !quoting;

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-16">
      <a href={href()} className="flex min-h-12 items-center gap-2 text-muted">
        <BackIcon />
        <span>{t('cart.back')}</span>
      </a>
      <h1 className="mt-2 font-display text-3xl">{t('cart.title')}</h1>

      {empty && (
        <div className="py-16 text-center">
          <p className="font-display text-2xl">{t('cart.empty')}</p>
          <p className="mt-2 text-muted">{t('cart.emptyHint')}</p>
        </div>
      )}

      {!empty && (
        <>
          <ul className="mt-4">
            {(quote?.lines ?? []).map((line) => {
              const source = cart.lines[line.index];
              if (!source) return null;
              const key = lineKey(source);
              const title = line.name || t('issue.UNKNOWN_PRODUCT');
              const issues = issueText(line).filter((text) => text !== title);
              return (
                <li key={`${key}-${line.index}`} data-testid="cart-line" className="border-b border-line py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg">{title}</p>
                      {(line.variantName || line.optionNames.length > 0) && (
                        <p className="text-sm text-muted">
                          {[line.variantName, ...line.optionNames].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {issues.map((text) => (
                        <p key={text} className="text-sm text-accent">
                          {text}
                        </p>
                      ))}
                    </div>
                    <p className="shrink-0 tabular-nums">{money(line.lineTotal)}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stepper
                      quantity={source.quantity}
                      name={title}
                      onChange={(next) => setQuantity(key, next)}
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(key)}
                      aria-label={line.name ? t('cart.removeNamed', { name: line.name }) : t('cart.remove')}
                      className="min-h-11 px-3 text-sm text-muted underline underline-offset-4"
                    >
                      {t('cart.remove')}
                    </button>
                  </div>
                </li>
              );
            })}

            {(quote?.bundles ?? []).map((line) => {
              const source = cart.bundles[line.index];
              if (!source) return null;
              const issues = issueText(line);
              return (
                <li key={`bundle-${line.bundleId}`} data-testid="cart-line" className="border-b border-line py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg">{line.name || t('issue.UNKNOWN_BUNDLE')}</p>
                      {line.savings > 0 && issues.length === 0 && (
                        <p className="text-sm text-muted">{t('bundle.save', { amount: money(line.savings * line.quantity) })}</p>
                      )}
                      {issues.map((text) => (
                        <p key={text} className="text-sm text-accent">
                          {text}
                        </p>
                      ))}
                    </div>
                    <p className="shrink-0 tabular-nums">{money(line.lineTotal)}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Stepper
                      quantity={source.quantity}
                      name={line.name}
                      onChange={(next) => setBundleQuantity(source.bundleId, next)}
                    />
                    <button
                      type="button"
                      onClick={() => setBundleQuantity(source.bundleId, 0)}
                      aria-label={t('cart.removeNamed', { name: line.name })}
                      className="min-h-11 px-3 text-sm text-muted underline underline-offset-4"
                    >
                      {t('cart.remove')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {quoteError && <p className="mt-4 text-sm text-accent">{t('cart.quoteError')}</p>}

          {data?.bundles[0] && (
            <BundleSuggestion
              bundle={data.bundles[0]}
              onApply={(bundle) => {
                replaceCart(bundle.cartAfter);
                announce(bundle.name);
              }}
            />
          )}

          <PairingList
            offers={data?.pairings ?? []}
            onAdd={(offer) => {
              addLine({ productId: offer.productId, variantId: null, optionIds: [], quantity: 1 });
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              announce(t('cart.added', { name: offer.name }));
            }}
            onChoose={(offer) => {
              track('PAIRING_ADD', { productId: offer.productId, suggestionId: offer.suggestionId });
              window.location.assign(href(`/p/${offer.slug}`));
            }}
            onDismiss={(offer) => dismiss(offer.suggestionId)}
          />

          <section className="mt-8 border-t border-line pt-4" aria-labelledby="review-title">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-xl">{t('cart.subtotal')}</h2>
              <p data-testid="cart-subtotal" className="text-xl tabular-nums" aria-live="polite">
                {quote ? money(quote.subtotal) : t('cart.updating')}
              </p>
            </div>
            {hasIssues && <p className="mt-2 text-sm text-accent">{t('cart.fixIssues')}</p>}
            <h3 id="review-title" className="mt-8 font-display text-lg">
              {t('cart.reviewTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted">{t('cart.reviewNote')}</p>
          </section>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Add the cart page**

`src/app/[tenant]/[locale]/cart/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { resolveRoute } from '@/server/route-context';
import { CartView } from '@/ui/cart/CartView';

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  return <CartView />;
}
```

- [ ] **Step 6: Run the end-to-end tests**

Run: `npx playwright test tests/e2e/cart.spec.ts`
Expected: PASS, 7 tests.

Likely adjustments:

- If the stale-line test shows two `Remove` buttons, the line's accessible name for the remove button is `Remove` when `line.name` is empty; `first()` already handles it.
- If the bundle test finds more than one `cart-line`, the quote still holds the three plain lines because `replaceCart` has not propagated; the assertion auto-retries until the new quote arrives.

- [ ] **Step 7: Full suite, lint, typecheck, commit**

Run: `npx vitest run && npx playwright test && npm run lint && npm run typecheck`
Expected: everything passes.

```bash
git add src tests
git commit -m "feat(cart): server-priced cart, set conversion, stale-line handling and read-only review" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: QR table entry and hostile-URL handling

**Files:**
- Create: `src/app/[tenant]/[locale]/t/[table]/page.tsx`
- Test: `tests/e2e/routes.spec.ts`

**Interfaces:**
- Consumes: `resolveRoute`, `loadMenuView`, `scopedDb`, `getPrisma`, `RouteTable`, `MenuApp`.
- Produces: the route `/{tenant}/{locale}/t/{table}`. The table number is validated against the restaurant's `Table` rows. It never authorizes anything; it only labels the order for later sub-projects.

- [ ] **Step 1: Write the failing end-to-end test**

`tests/e2e/routes.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('QR table entry', () => {
  test('shows the table label immediately and remembers it on other pages', async ({ page }) => {
    await page.goto('/atelier/en/t/04');
    await expect(page.getByText('Table 04')).toBeVisible();
    await expect(page.getByRole('button', { name: /Atelier Burger/ }).first()).toBeVisible();
    await page.getByTestId('brand').click();
    await expect(page).toHaveURL(/\/atelier\/en$/);
    await expect(page.getByText('Table 04')).toBeVisible();
  });

  test('keeps the order when the same table is scanned again', async ({ page }) => {
    await page.goto('/atelier/en/t/04');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await page.goto('/atelier/en/t/04');
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
  });

  test('starts a fresh order when a different table is scanned', async ({ page }) => {
    await page.goto('/atelier/en/t/04');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await expect(page.getByTestId('cart-bar')).toContainText('1 item');
    await page.goto('/atelier/en/t/05');
    await expect(page.getByText('Table 05')).toBeVisible();
    await expect(page.getByTestId('cart-bar')).toHaveCount(0);
  });

  test('translates the table label', async ({ page }) => {
    await page.goto('/atelier/ar/t/04');
    await expect(page.getByText('الطاولة 04')).toBeVisible();
    await page.goto('/atelier/ckb/t/04');
    await expect(page.getByText('مێزی 04')).toBeVisible();
  });

  test('sends analytics with the table number', async ({ page }) => {
    const request = page.waitForRequest((r) => r.url().includes('/api/atelier/events') && r.method() === 'POST', {
      timeout: 10_000,
    });
    await page.goto('/atelier/en/t/04');
    const body = JSON.parse((await request).postData() ?? '{}');
    expect(body.tableNumber).toBe(4);
    expect(body.events.map((e: { type: string }) => e.type)).toContain('MENU_VIEW');
    expect(body.anonymousSessionId.length).toBeGreaterThanOrEqual(8);
  });
});

test.describe('hostile and unknown URLs get a clean 4xx, never a 5xx', () => {
  const paths = [
    '/atelier/en/t/abc',
    '/atelier/en/t/0',
    '/atelier/en/t/999',
    '/atelier/en/t/-1',
    '/atelier/en/t/4.5',
    '/atelier/en/t/1e3',
    '/atelier/en/t/%20',
    '/nope/en/t/04',
    '/atelier/xx/t/04',
    '/atelier/en/p/%2e%2e%2fsecret',
    '/atelier/en/cart/extra',
    "/atelier/en/p/'; DROP TABLE products;--",
  ];
  for (const path of paths) {
    test(`GET ${path}`, async ({ request }) => {
      const response = await request.get(path);
      expect([400, 404]).toContain(response.status());
    });
  }

  test('the unknown tenant API answers with JSON 404', async ({ request }) => {
    const response = await request.post('/api/nope/quote', { data: { locale: 'en', cart: { lines: [], bundles: [] } } });
    expect(response.status()).toBe(404);
    expect((await response.json()).error.code).toBe('TENANT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/routes.spec.ts`
Expected: FAIL; `/atelier/en/t/04` returns 404 because the route does not exist yet.

- [ ] **Step 3: Implement the route**

`src/app/[tenant]/[locale]/t/[table]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getPrisma } from '@/server/data/prisma';
import { scopedDb } from '@/server/data/tenant-db';
import { loadMenuView, resolveRoute } from '@/server/route-context';
import { RouteTable } from '@/ui/AppProviders';
import { MenuApp } from '@/ui/menu/MenuApp';

const TABLE_NUMBER = /^\d{1,3}$/;

export default async function Page({
  params,
}: {
  params: Promise<{ tenant: string; locale: string; table: string }>;
}) {
  const raw = await params;
  const route = await resolveRoute(raw);
  if (!route || !TABLE_NUMBER.test(raw.table)) notFound();

  const number = Number(raw.table);
  if (number < 1) notFound();
  const table = await scopedDb(getPrisma(), route.tenant.id).table.findFirst({ where: { number } });
  if (!table) notFound();

  const view = await loadMenuView(route);
  return (
    <>
      <RouteTable number={number} />
      <MenuApp view={view} />
    </>
  );
}
```

- [ ] **Step 4: Run the end-to-end tests**

Run: `npx playwright test tests/e2e/routes.spec.ts`
Expected: PASS, all tests.

Likely adjustments:

- The two slug probes (`%2e%2e%2fsecret` and the SQL-looking slug) either reach the product page and call `notFound()` (404) or are rejected by Next before routing (400). Both are clean 4xx answers, which is what the assertion allows.
- If `/atelier/en/cart/extra` returns 200, a catch-all route exists; there should be none.

- [ ] **Step 5: Full suite, lint, typecheck, commit**

Run: `npx vitest run && npx playwright test && npm run lint && npm run typecheck`
Expected: everything passes.

```bash
git add src tests
git commit -m "feat(routes): QR table entry with per-table carts and hostile URL handling" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Accessibility, reduced motion, performance baseline, README and final verification

**Files:**
- Create: `tests/e2e/a11y.spec.ts`, `tests/e2e/motion.spec.ts`
- Create: `scripts/perf.ts`, `README.md`
- Create (generated by the script): `docs/perf/baseline-<date>.md`

**Interfaces:**
- Consumes: the whole application.
- Produces: `npm run perf` which writes `docs/perf/baseline-<YYYY-MM-DD>.md` with the measured LCP, performance score and script weight, and states whether the 2.5 s target was met.

- [ ] **Step 1: Write the accessibility and motion tests**

`tests/e2e/a11y.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`);
}

test.describe('accessibility', () => {
  for (const [name, path] of [
    ['menu in English', '/atelier/en'],
    ['menu in Arabic', '/atelier/ar'],
    ['menu in Sorani', '/atelier/ckb'],
    ['product page', '/atelier/en/p/atelier-burger'],
    ['empty cart', '/atelier/en/cart'],
    ['table entry', '/atelier/en/t/04'],
  ] as const) {
    test(`${name} has no serious violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });
  }

  test('open product sheet has no serious violations', async ({ page }) => {
    await page.goto('/atelier/en');
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Atelier Burger' })
      .getByRole('button', { name: /Atelier Burger/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Perfect pairing' })).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test('cart with items has no serious violations', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.getByRole('button', { name: 'Add Espresso to your order' }).click();
    await page.getByTestId('cart-bar').click();
    await expect(page.getByTestId('cart-line')).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test('the skip link is the first focus stop and becomes visible', async ({ page }) => {
    await page.goto('/atelier/en');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to the menu' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('every interactive control is at least 44 px tall', async ({ page }) => {
    await page.goto('/atelier/en');
    const small = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select')];
      return controls
        .filter((el) => el.offsetParent !== null && !el.matches('.sr-only, .sr-only *'))
        .map((el) => ({ label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '', h: el.getBoundingClientRect().height }))
        .filter((c) => c.h > 0 && c.h < 40);
    });
    expect(small).toEqual([]);
  });
});
```

`tests/e2e/motion.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the product sheet opens and closes without relying on animation', async ({ page }) => {
    await page.goto('/atelier/en');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page
      .getByTestId('product-row')
      .filter({ hasText: 'Atelier Burger' })
      .getByRole('button', { name: /Atelier Burger/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('global CSS collapses transition and animation durations', async ({ page }) => {
    await page.goto('/atelier/en');
    const duration = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transition = 'opacity 2s';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });
    expect(parseFloat(duration)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run them to see the baseline**

Run: `npx playwright test tests/e2e/a11y.spec.ts tests/e2e/motion.spec.ts`
Expected: PASS. If axe reports a real violation, fix the markup (labels, roles, contrast tokens) rather than loosening the test. The most likely finding is colour contrast of `text-muted` on `bg-raised`; the muted token `#A7A096` against `#2A2826` is about 5.6:1, which passes AA, so a failure means a different background is involved and its token should be adjusted.

- [ ] **Step 3: Write `scripts/perf.ts`**

```ts
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:3100/atelier/en/t/04';
const outDir = resolve('docs/perf');
mkdirSync(outDir, { recursive: true });
const jsonPath = resolve(outDir, 'lighthouse-latest.json');

execFileSync(
  process.execPath,
  [
    resolve('node_modules/lighthouse/cli/index.js'),
    url,
    '--only-categories=performance',
    '--output=json',
    `--output-path=${jsonPath}`,
    '--quiet',
    '--chrome-flags=--headless=new --no-sandbox',
  ],
  { stdio: 'inherit', env: { ...process.env, CHROME_PATH: chromium.executablePath() } },
);

const lhr = JSON.parse(readFileSync(jsonPath, 'utf8'));
const lcp: number = lhr.audits['largest-contentful-paint'].numericValue;
const fcp: number = lhr.audits['first-contentful-paint'].numericValue;
const tbt: number = lhr.audits['total-blocking-time'].numericValue;
const cls: number = lhr.audits['cumulative-layout-shift'].numericValue;
const score: number = Math.round(lhr.categories.performance.score * 100);
const summary: Array<{ resourceType: string; transferSize: number; requestCount: number }> =
  lhr.audits['resource-summary'].details.items;
const script = summary.find((item) => item.resourceType === 'script');
const total = summary.find((item) => item.resourceType === 'total');
const kb = (bytes = 0) => `${(bytes / 1024).toFixed(0)} KB`;

const date = new Date().toISOString().slice(0, 10);
const verdict = lcp <= 2500 ? 'met' : 'not met';
const report = `# Performance baseline ${date}

Measured with Lighthouse ${lhr.lighthouseVersion} against \`${url}\` using the default mobile profile
(simulated slow 4G, 4x CPU slowdown), production build, local server.

| Metric | Value |
|---|---|
| Performance score | ${score} |
| Largest Contentful Paint | ${(lcp / 1000).toFixed(2)} s |
| First Contentful Paint | ${(fcp / 1000).toFixed(2)} s |
| Total Blocking Time | ${tbt.toFixed(0)} ms |
| Cumulative Layout Shift | ${cls.toFixed(3)} |
| Script transfer size | ${kb(script?.transferSize)} (${script?.requestCount ?? 0} requests) |
| Total transfer size | ${kb(total?.transferSize)} |

**LCP target (under 2.5 s): ${verdict}.**

Numbers vary by machine. Re-run with \`npm run build && npm run start\` in one terminal and \`npm run perf\` in another.
`;
writeFileSync(resolve(outDir, `baseline-${date}.md`), report);
console.log(report);
```

- [ ] **Step 4: Run the production build and record the baseline**

Stop any running dev server on port 3100, then:

Run: `npm run build`
Expected: exits 0.

Run in one terminal: `npm run start`
Run in another: `npm run perf`
Expected: prints a table and writes `docs/perf/baseline-<date>.md`. The report states whether the LCP target was met; record the measured number whatever it is. If it is not met, note the largest contributors from `docs/perf/lighthouse-latest.json` in the README's "Known limitations" and leave the target open for a follow-up; do not edit the verdict.

- [ ] **Step 5: Write `README.md`**

````markdown
# ATELIER menu platform (buzzify-menu)

A multi-tenant digital menu and revenue platform for cafés and restaurants. This repository holds
sub-project 1: the foundation, the customer menu and the revenue engine, demonstrated with the fictional
luxury café ATELIER.

> The Arabic and Sorani text in the seed data and UI is machine-drafted. Have a native speaker review it
> before real customers see it.

## What works

- Quick Menu with a daypart-aware signature pick, category rail and instant three-language search
- Product detail with options, sizes, live totals, upgrades and Perfect Pairing
- Server-priced cart with set (bundle) conversion that only shows real savings
- Stale-item handling, per-table carts and a read-only order review
- English, Arabic and Sorani with right-to-left layout
- Tenant-isolated PostgreSQL data access and an analytics event feed

Not in this release: table PIN verification, order submission, cashier and kitchen screens, admin UI,
3D and Explore mode, tax and service charge. See `docs/superpowers/specs`.

## Requirements

- Node.js 22.19 or newer
- Nothing else. PostgreSQL runs from an npm package (`embedded-postgres`); no Docker or installer.

## Run it

```bash
npm install
npm run db:up        # starts PostgreSQL on 127.0.0.1:54329 (data in .data/, git-ignored)
npm run db:migrate   # creates the schema (first run: name the migration "init")
npm run db:seed      # loads ATELIER
npm run dev          # http://localhost:3100/atelier/en/t/04
```

Port 3100 is used because 3000 is often taken. Other routes:

| URL | Page |
|---|---|
| `/atelier/en`, `/atelier/ar`, `/atelier/ckb` | Quick Menu |
| `/atelier/en/t/04` | QR entry for Table 04 |
| `/atelier/en/p/atelier-burger` | Product page |
| `/atelier/en/cart` | Cart and order review |

Stop the database with `npm run db:down`. Copy `.env.example` to `.env` if you use a different database.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3100 |
| `npm test` | Unit and database integration tests (Vitest) |
| `npm run test:e2e` | Browser tests with Playwright and axe |
| `npm run perf` | Lighthouse mobile baseline into `docs/perf/` (needs `build` and `start`) |
| `npm run db:up` / `db:down` / `db:status` | Embedded PostgreSQL |
| `npm run db:seed` | Reseeds ATELIER (replaces the restaurant) |
| `npm run lint` / `typecheck` | Static checks |

First-time browser tests need `npx playwright install chromium`.

## How it is built

```
src/server/domain   pure revenue engine: quote, upsell, pairing, bundles, promotion, daypart schedule
src/server/data     Prisma access, tenant-scoped client, view builders
src/server/http     request validation, limits, rate limiting
src/app             routes and API handlers
src/ui              components, motion, providers
prisma              schema, migrations, ATELIER seed
```

- **Prices are never trusted from the browser.** The cart sends product ids, option ids and quantities. Every
  total comes from `quoteCart` on the server.
- **Tenants are isolated by construction.** Tenant-owned tables carry `restaurantId`, all access goes through
  `scopedDb()`, a test fails if a new model is not classified, and raw SQL is blocked by lint.
- **The engine is plain functions.** Anything in `src/server/domain` takes data and a clock and returns data,
  so every rule is unit-tested without a database.

### Tuning the revenue engine

Per restaurant, `Restaurant.engineConfig` (JSON) overrides defaults: `upsellMaxOffers`,
`upsellDeltaCapRatio`, `pairingMaxOffers`, `cartPairingMaxOffers`, and `weights`
(`rulePriority`, `margin`, `popularity`, `priority`, `daypart`, `stockPenalty`). Values are clamped.
Relevance is a hard gate: a recommendation must come from a rule or from the product's own options; margin only
orders candidates that already qualify.

### Replacing the placeholder art

Each product's `media` list drives its visual. Put real files under `public/media/atelier/` and set, for
example, `[{ "kind": "image", "url": "/media/atelier/flat-white.jpg", "alt": "Flat white", "width": 1200, "height": 900 }]`.
Only same-origin paths and `https://` URLs are accepted.

## Performance and accessibility

`docs/perf/` holds the latest measured baseline. The suite runs axe on the menu, product sheet and cart
in all three languages, checks 44 px targets, keyboard entry and reduced motion.

## Known limitations

- The rate limiter is in memory, so it applies per server instance. A shared store comes with hardening.
- No tax or service charge; the quote reserves a `charges` list for them.
- The Lighthouse result depends on the machine; see the dated file in `docs/perf/`.
- Hosting is undecided. The schema targets PostgreSQL.

## Security notes

This repository is public. The seed data is fictional demo data; no secrets are committed. `.env` and `.data/`
are git-ignored. The demo table PIN arrives with sub-project 2 and will be a development-only credential.
````

- [ ] **Step 6: Run the complete verification**

Run each and read the output; do not assume.

```bash
npm run db:up
npm run db:migrate
npm run db:seed
npx vitest run
npx playwright test
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits 0. Record the Vitest and Playwright totals in the commit message body.

- [ ] **Step 7: Check the spec's definition of done, item by item**

Confirm and note each in the final commit message:

1. A fresh checkout plus the README commands opens `/atelier/en/t/04` with the menu visible: confirmed by `routes.spec.ts` and `menu.spec.ts`.
2. Search works in all three languages and Arabic and Sorani render right to left: `menu.spec.ts`, `shell.spec.ts`, `product.spec.ts`.
3. Upgrades, pairings and bundles behave per the rules and the quote matches the UI: unit tests in `tests/domain`, `cart.spec.ts`, `product.spec.ts`.
4. Tampered payloads are rejected and tenant isolation holds: `tests/api/routes.test.ts`, `tests/data/tenant-db.test.ts`.
5. All tests pass and the Lighthouse baseline is recorded in `docs/perf/`.
6. Work is committed with a README.

- [ ] **Step 8: Commit**

```bash
git add tests scripts README.md docs/perf
git commit -m "feat: accessibility and motion tests, performance baseline, README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
