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
| `/atelier` | Opens the menu in the browser’s language (the menu’s default language when it has none of them) |
| `/atelier/en`, `/atelier/ar`, `/atelier/ckb` | Quick Menu |
| `/atelier/en/t/04` | QR entry for Table 04 |
| `/atelier/t/04` | The same, without a language: what a table’s QR code carries |
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
| `npm run db:seed` | Reseeds ATELIER (keeps its restaurant, replaces its menu). With `DEV_SEED_PASSWORD` set (see `.env.example`) it also creates `admin@`, `designer@` and `owner@buzzify.test` for signing in to the Studio |
| `npm run db:seed:load` | Adds 1,000 load-test restaurants with a published menu each, and 20,000 audit rows (replaces its earlier run) |
| `npm run test:load` | Seeds that into the test database and times the Studio's lists (p95 under 300 ms) |
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
- **Tenants are isolated by construction.** A restaurant owns menus and branches. Catalog tables carry `menuId` and
  branches carry `restaurantId`; all access goes through `menuDb()`, `restaurantDb()` or `scopedClient()`, a test
  fails if a new model is not classified, and raw SQL is blocked by lint.
- **The engine is plain functions.** Anything in `src/server/domain` takes data and a clock and returns data,
  so every rule is unit-tested without a database.

### Tuning the revenue engine

Per menu, `Menu.engineConfig` (JSON) overrides defaults: `upsellMaxOffers`,
`upsellDeltaCapRatio`, `pairingMaxOffers`, `cartPairingMaxOffers`, and `weights`
(`rulePriority`, `margin`, `popularity`, `priority`, `daypart`, `stockPenalty`). Values are clamped.
Relevance is a hard gate: a recommendation must come from a rule or from the product's own options; margin only
orders candidates that already qualify.

### The 3D stage

The signature hero, the product sheet and Explore show a live 3D model for products whose first media item
is art with a model: `burger`, `cup` and `glass` by art kind, or any of `croissant` and `millefeuille` named
through the media item's `model` field (for example `{ "kind": "art", "art": "pastry", "model": "croissant" }`).
Three.js through React Three Fiber, built from code, no model files.
Options can change the model: an option's `visualKey` (`cheese`, `patty`, `bacon`) adds a draped cheese
slice, a second patty or bacon to the burger. See `docs/superpowers/specs/2026-10-15-immersive-slice-design.md`.

- The page is server-rendered with the illustration first. The 3D chunk loads after the page is idle and only
  when the device qualifies (WebGL available, no data saver, at least 4 GB of memory and 4 cores when the
  browser says so). Anywhere else the illustration stays and everything else works.
- `?stage=off` turns 3D off on this device, `?stage=on` forces it on where WebGL exists, `?stage=auto`
  forgets the choice. A stage that falls back says why in `data-stage-reason`.
- Drag or swipe to turn the model; arrow keys turn it when it is focused. `prefers-reduced-motion` removes the
  assembly animation, the idle turn and the hero's scroll drift.
- The browser tests run with 3D remembered as off except `tests/e2e/stage.spec.ts`, which opts in.

### Explore

`/{tenant}/{locale}/explore` is the menu as a film you scrub with your thumb: one fixed canvas, one scene per
category led by that category's signature dish (`isSignature`), gliding across a dark set as you scroll.
Scenes come from data, so a new signature or category appears without code. Design and research notes are in
`docs/superpowers/specs/2026-10-16-explore-experience-design.md`.

- The dish name is set huge and outlined behind the object. Scrolling glides the objects across the set and
  fans their layers apart a little in transit; each scene snaps into place.
- "What is inside" pulls the layers apart and pins an ingredient label to each. Chips for options with a
  `visualKey` (Premium cheese, Double patty, Bacon) change the model live. "Add to order" and "Customise"
  use the existing cart and product sheet, and the cart is shared with the full menu.
- Where 3D cannot run (`?stage=off`, weak devices, no WebGL) the dish illustrations glide across the same set.
  `prefers-reduced-motion` removes the glide, the fan, the steam and the dust; one scene is reachable at a time.
- Layer names ("Brioche bun", "Clear ice") are generic strings per model in the message files, not tenant data.

### Replacing the placeholder art

Each product's `media` list drives its visual. Put real files under `public/media/atelier/` and set, for
example, `[{ "kind": "image", "url": "/media/atelier/flat-white.jpg", "alt": "Flat white", "width": 1200, "height": 900 }]`.
Only same-origin paths and `https://` URLs are accepted.

## Performance and accessibility

`docs/perf/baseline-2026-10-16.md` is the latest measured baseline, with the menu before and after the
performance pass. The suite runs axe on the menu, product sheet and cart in all three languages, checks 44 px
targets, keyboard entry and reduced motion.

What keeps the menu's first load small, and the tests that hold it there:

- Fonts are not preloaded (`next/font` would preload every face on every locale), each page downloads only its
  own script's faces, and every face is a single regular-weight file. Bodoni Moda is bundled with its weight
  pinned and its optical-size axis kept (`src/app/fonts/README.md`). `tests/e2e/fonts.spec.ts` checks which
  faces each locale downloads, their weights and a byte budget.
- The animation library is not in the menu's initial JavaScript. Menu motion is CSS, the Web Animations API
  or a scroll listener; the library loads with the product sheet, imported from `framer-motion` (the
  `motion/react` entry builds its full component at module scope and defeats tree shaking). ESLint rejects
  `motion` and `framer-motion` imports outside the sheet, product and Explore code.
- The page carries search text in its own language only; the other languages load from
  `POST /api/[tenant]/search-index` the first time the search box is used.
- `npm run perf` reports initial script (requested before the largest paint) separately from script loaded
  afterwards, and the verdicts for both goals.

### Measured cost of the 3D stage

`docs/perf/baseline-2026-10-15-menu-3d-off.md` and `...-menu-3d-on.md` measure the same page with and without
3D. The stage does not change LCP (the heading and illustration paint first), but its chunk adds about 242 KB of
script transferred after load, and headless Chrome's software WebGL blocks the main thread for seconds while
it initialises (TBT 3.7 s in that run). That figure is inflated by software rendering and has not been
checked on a phone GPU.

## Known limitations

- **Performance goals narrowly missed.** `baseline-2026-10-16.md` measures a median LCP of 2.51 s on
  `/atelier/en` (from 3.61 s; individual runs 2.49 to 2.58 s) against the 2.5 s goal, and 166 KB of initial
  script (from 217 KB) against about 120 KB. React DOM, the Next.js client and the runtime alone are about
  139 KB, so the script goal is not reachable on this stack. The two Latin web fonts (40 KB) are the largest
  remaining cost before the first paint; the system font for body text would save about 13 KB.
- 3D exists for five models: burger, cup, glass, croissant and mille-feuille. Other dishes keep their
  illustration. The models are stylized product renders built from code, not photographs; real `.glb` files or
  photography would replace them and are the way to photorealism. Three.js logs a one-line `THREE.Clock` deprecation warning from
  React Three Fiber at each stage start; it is harmless.
- The rate limiter is in memory, so it applies per server instance. A shared store comes with hardening.
- No tax or service charge; the quote reserves a `charges` list for them.
- The Lighthouse result depends on the machine; see the dated file in `docs/perf/`.
- Stop `npm run dev` before `npm run build` or `npm run perf`. Both write `.next`, and a production build under a
  running dev server leaves it serving broken routes until it is restarted from a clean `.next`.
- Hosting is undecided. The schema targets PostgreSQL.

## Security notes

This repository is public. The seed data is fictional demo data; no secrets are committed. `.env` and `.data/`
are git-ignored. The demo table PIN arrives with sub-project 2 and will be a development-only credential.
