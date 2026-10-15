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

Stop the database with `npm run db:down`.

**Production mode** (`npm run build && npm run start`) requires `DATABASE_URL`. Copy `.env.example` to
`.env` first. In development the embedded database URL is used when the variable is unset.

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

First-time browser tests need `npx playwright install chromium`. `npm run perf` uses the Chromium that
Playwright installed; set `CHROME_PATH` to use another Chrome if that binary will not launch.

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

- **LCP target not met.** The latest baseline measures LCP at 3.46 s against the 2.5 s goal (score 91, TBT
  62 ms, CLS 0.024). The LCP element is the first product row's text, which repaints when web fonts swap in.
  The largest contributors are the web fonts (about 172 KB across 3 files) and JavaScript (207 KB across 12
  requests, above the roughly 120 KB goal). Follow-ups: fewer font files or `font-display: optional` for body
  text, and trimming the menu route's initial chunks.
- The rate limiter is in memory, so it applies per server instance. A shared store comes with hardening.
- No tax or service charge; the quote reserves a `charges` list for them.
- The Lighthouse result depends on the machine; see the dated file in `docs/perf/`.
- Hosting is undecided. The schema targets PostgreSQL.

## Security notes

This repository is public. The seed data is fictional demo data; no secrets are committed. `.env` and `.data/`
are git-ignored. The demo table PIN arrives with sub-project 2 and will be a development-only credential.
