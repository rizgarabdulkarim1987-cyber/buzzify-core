# Buzzify Core

A multi-tenant digital menu and revenue platform for cafés and restaurants. Guests open a restaurant's published menu on
their phone; the team runs restaurants, menus and people in the **Studio**. The repository is demonstrated with three
fictional places: the luxury café ATELIER, Riverlight Coffee (a light, English-first café) and Hot Brick Burgers (a dark,
Sorani-first burger place priced in dinars).

> The Arabic and Sorani text in the seed data (ATELIER, Riverlight Coffee and Hot Brick Burgers), the public menu and the
> Studio interface (the menu workspace included) is machine-drafted. Have a native
> speaker review it before real customers or staff see it.

## What works

**Public menus** (what guests see)

- Quick Menu with a daypart-aware signature pick, category rail and instant three-language search
- Product detail with options, sizes, live totals, upgrades and Perfect Pairing
- Server-priced cart with set (bundle) conversion that only shows real savings
- Stale-item handling, per-table carts and a read-only order review
- **Template menus:** a menu can be drawn with one of 30 template presets (10 restaurant, 8 café, 7 bakery, 5 ice
  cream), each with its own layout, palette, type and a background scene that is still, moving or real 3D. See
  [Template Studio](#template-studio). A menu without a template keeps the classic layout exactly
- English, Arabic and Sorani with right-to-left layout
- Stable addresses: `/{address}` opens a menu, and an address that was changed keeps redirecting to the new one
- Only what has been published is shown. Guests never see a draft
- Tenant-isolated PostgreSQL data access and an analytics event feed

**The Studio** (`/studio`, for the team; milestones 2a and 2b)

- Accounts by invitation only, with password sign-in, reset, sessions you can see and end, and two-factor sign-in
  (required for Super Admins)
- Three roles (Super Admin, Designer, Owner) with permissions you can adjust per client
- Jump to (Ctrl+K), Overview, Restaurants (profile, branches, working hours, suspend, archive, restore, delete),
  All menus (search, filters, paging, create, duplicate, change address, publish, suspend, archive, restore, delete,
  and the same for many at once), People (invitations, permission switches, deactivate), Activity (the audit log)
  and Settings (platform defaults)
- The whole Studio in English, Arabic and Sorani, with right-to-left layout
- **The menu workspace**, one tab per job, each shown only to those allowed it:
  - **Content:** categories (reordered by drag or from the keyboard) and products in a drawer: names and descriptions
    in each language, price, sizes, option groups, pictures, ingredients, allergens, dietary tags and badges
  - **Prices:** every price in one grid, and bulk changes by a percentage or an amount with rounding, previewed first
  - **Availability:** sold out and hidden, live for guests at once without a publish
  - **Design:** the template gallery (filters by business, style and mode; thumbnails), a live preview on a phone, a
    tablet or a desktop in each language, apply, duplicate, customize (curated palettes and colours checked for
    contrast, fonts, layout, motion, featured products, the offer, business details, ordering), reset, and designs
    saved for reuse
  - **Brand:** palettes checked for contrast as you pick them, presets, logos (light and dark), a favicon, six font pairs
    and the rail and motion styles, with a live sample
  - **Settings:** languages, currency (prices converted), rounding step, time zone, SEO texts and image
  - **QR codes:** for the menu or per table, styled (colours checked for scanners, the logo, a line of text below),
    downloaded as SVG or PNG, every table's code in one ZIP, scans counted
  - **Import and export:** the draft as CSV or Excel, and a sheet back in, previewed row by row before it is applied
  - **Revisions:** go back to an earlier revision, restore one into the draft, schedule a publish on the menu's clock
  - **Preview:** the draft on a phone and a desktop, in each language
- **Media library** (`/studio/media` and each restaurant's Media tab): uploads checked by their bytes (SVGs sanitised),
  renditions in WebP and AVIF, each compressed to the smallest file that still looks the same as the upload (a
  similarity check per picture), folders, tags, alt text in three languages, where each picture is used, and the storage
  used
- **Plans:** Basic, Pro and Premium decide which features a restaurant's menus may use (finer design, Explore and the 3D
  dishes, scheduled publishing, smart selling), never how many menus or pictures it has. The platform owner, one Super
  Admin, sets each restaurant's plan on its Plan tab (with per-restaurant extras and a private note) and decides what each
  plan includes, its names and the WhatsApp number in Settings → Plans. Anyone else sees a locked feature with the plan
  that has it and a button that opens a WhatsApp chat with the owner, never an error. Guests get only what the plan
  includes, at once and without a republish; a downgrade keeps every saved choice, so moving back brings it all back

Not in this release: table PIN verification, order submission, cashier and kitchen screens, tax and service charge.
See `docs/superpowers/specs`.

### The spreadsheet format

Import and export use the same twenty columns, in this order (an export is a valid import; a template with the header
row alone is on the Import and export tab):

```
category_slug,category_en,category_ar,category_ckb,product_slug,name_en,name_ar,name_ckb,description_en,description_ar,description_ckb,price,available,featured,signature,badges,dietary,allergens,calories,sort
```

Only `category_slug`, `name_en` and `price` are required; a column the sheet leaves out is left as it is. Prices are in
the menu currency's major unit as people write them (`4.50`, `6000`, `6,000`, `٦٠٠٠`); yes/no columns take
`yes`/`no`, `true`/`false` or `1`/`0`; badges, dietary tags and allergens are lists separated by `|`. A row finds its
product by `product_slug`, else by its English name within the category. CSV must be UTF-8 (Excel: Save As, CSV UTF-8).
For example:

```
coffee,Coffee,,,flat-white,Flat white,فلات وايت,فلات وایت,Silky microfoam,,,3.75,yes,yes,no,POPULAR,VEGETARIAN,milk,120,1
```

## Requirements

- Node.js 22.19 or newer
- Nothing else. PostgreSQL runs from an npm package (`embedded-postgres`); no Docker or installer.

## Run it

```bash
npm install
cp .env.example .env # Windows PowerShell: Copy-Item .env.example .env
npm run db:up        # starts PostgreSQL on 127.0.0.1:54329 (data in .data/, git-ignored)
npm run db:migrate   # creates the schema from the migrations
npm run db:seed      # loads the three demo menus, and the development sign-in users (see below)
npm run dev          # http://localhost:3100/atelier/en/t/04
```

Port 3100 is used because 3000 is often taken. The other demo menus open at `/riverlight` and `/hot-brick`. Public routes:

| URL | Page |
|---|---|
| `/atelier` | Opens the menu in the browser’s language (the menu’s default language when it has none of them) |
| `/atelier/en`, `/atelier/ar`, `/atelier/ckb` | Quick Menu |
| `/atelier/en/t/04` | QR entry for Table 04 |
| `/atelier/t/04` | The same, without a language: what a table’s QR code carries |
| `/atelier/en/p/atelier-burger` | Product page |
| `/atelier/en/cart` | Cart and order review |

Stop the database with `npm run db:down`.

### The Studio in development

Open **http://127.0.0.1:3100/studio**. Stay on this address rather than `localhost`: links in the Studio’s emails use it,
and a session belongs to one of the two.

`npm run db:seed` creates three development users when `DEV_SEED_PASSWORD` is set, which `.env.example` does:

| Email | Role |
|---|---|
| `admin@buzzify.test` | Super Admin |
| `designer@buzzify.test` | Designer of ATELIER |
| `owner@buzzify.test` | Owner of ATELIER |

All three sign in with the password in your `.env` as `DEV_SEED_PASSWORD`. A Super Admin must set up two-factor on the
first sign-in: scan the QR code with an authenticator app and keep the recovery codes. `admin@buzzify.test` is the
platform owner (the one who changes plans) when the database has none yet. A fresh seed puts ATELIER on Premium,
Riverlight Coffee on Pro and Hot Brick Burgers on Basic, so the three plans can be seen side by side; a reseed leaves a
demo restaurant's plan as it is. Emails the Studio sends
(invitations, resets) are written to `.data/mail/` instead of being sent, and the subject and first link are logged, so
an invitation link can be opened straight from the log.

**Media in development:** uploads are kept in `.data/media` (git-ignored) and served by the development-only route
`/api/dev-media`, which also accepts the browser's signed uploads; it answers 404 in production, where the files live in
Cloudflare R2.

**Scheduled publishing in development:** nothing calls the scheduler by itself. Set `CRON_SECRET` in `.env`, restart
`npm run dev`, and run it by hand once a scheduled time has passed (it makes due revisions live and answers how many):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3100/api/cron/publish
```

These users and their password exist for local development only. The password is public (it is written in
`.env.example`), so the seed refuses to create them in production or in a database that is not on this machine. Real
accounts come from invitations; the first Super Admin on a hosted database is created with `npm run studio:create-admin`
(see the deployment guide).

**Production mode** (`npm run build && npm run start`): the build needs no secrets, but the server then needs
`DATABASE_URL`, and the Studio’s sign-in refuses to start without a `BETTER_AUTH_SECRET` of 32 or more characters and a
`BETTER_AUTH_URL`. In development the embedded database URL and a fixed development secret are used when these are unset.

## Putting it online

The deployment guide, `docs/deploy/production.md`, takes you step by step through Vercel, Neon (PostgreSQL), Resend
(email), Cloudflare R2 (pictures and downloads) and the scheduler that makes scheduled publishes live: accounts, DNS,
every environment variable, the first deploy, creating the first Super Admin, a checklist that it works, and backups. A deploy first checks the production environment and lists everything missing or wrong at once.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on port 3100 |
| `npm test` | Unit and database integration tests (Vitest) |
| `npm run test:e2e` | Browser tests with Playwright and axe |
| `npm run test:load` | Opt-in: seeds the load data (below) into the test database and times the Studio’s lists (p95 under 300 ms) |
| `npm run perf` | Lighthouse mobile baseline into `docs/perf/` (needs `build` and `start`) |
| `npm run db:up` / `db:down` / `db:status` | Embedded PostgreSQL |
| `npm run db:migrate` / `db:deploy` | Create and apply migrations in development / apply the existing ones |
| `npm run db:seed` | Reseeds the demo menus `atelier`, `riverlight`, `hot-brick`, and the template demos `maison-demo` (bakery), `onda-demo` (gelateria) and `noor-demo` (restaurant), each named "(Demo)" and showing a "Demonstration menu" card. `npx tsx prisma/seed.ts --only=maison-demo,onda-demo` seeds just those and leaves the other menus alone (each keeps its restaurant and gets its menu replaced, published as revision 1). With `DEV_SEED_PASSWORD` set it also creates the development users above (only on a local database, never in production; a loopback tunnel to a remote database cannot be detected, so do not run it with one open) |
| `npm run db:seed:load` | Opt-in tooling, local databases only: adds load-test restaurants with a published menu each (1,000 of them, a sizing assumption for the Studio’s lists, not data you need) and 20,000 audit rows, replacing its earlier run |
| `npm run studio:create-admin` | Creates the first Super Admin: asks for a name, email and password in the terminal (never shown, never stored in the clear), and refuses when one exists unless `--force` is given. It prints which database it will change before it asks anything |
| `npm run studio:template -- <address> <template|classic> [--apply]` | Draws a menu with a template preset (or back to classic) and republishes it; without `--apply` it only says what it would do, and it refuses a menu with unpublished changes |
| `npm run studio:thumbnails` | Redraws the Design tab's gallery thumbnails (`public/templates/*.webp`) from the demo menus through the Studio preview, signed in as the temporary Super Admin the e2e setup creates and removes. `THUMBNAILS_BASE_URL` points it at another dev server |
| `npm run studio:set-platform-owner` | Moves the platform owner (who changes plans) to another active Super Admin, for a handover or when the owner's account is lost. Asks for the email, shows who holds it now, and changes nothing until you type yes. The Studio has no screen for it on purpose |
| `npm run media:calibrate -- <folder>` | Opt-in tooling: scores the photos in a folder at each quality, to check the similarity threshold uploads are compressed to |
| `npm run lint` / `typecheck` | Static checks |

First-time browser tests need `npx playwright install chromium`. They use the dev server on port 3100 (and reuse one
already running there); when another checkout's server has 3100, run them with `E2E_PORT=3120` (any free port) and they
start their own. `npm run perf` uses the Chromium that
Playwright installed; set `CHROME_PATH` to use another Chrome if that binary will not launch.

## How it is built

```
src/server/domain    pure rules: the revenue engine (quote, upsell, pairing, bundles, promotion, daypart schedule),
                     snapshots, publish rules, slugs, permissions
src/server/data      Prisma access, scoped clients, the cached public read path, view builders
src/server/publish   drafts, and publishing a draft as a numbered snapshot
src/server/studio    the Studio's server side: sign-in, the action and query framework, actions, queries, services
src/server/http      host routing, request validation, limits, rate limiting
src/server/email     sending through Resend (files in .data/mail in development)
src/app              routes: public menus ([tenant]), the Studio (studio), API handlers
src/studio           Studio components and its English, Arabic and Sorani messages
src/ui               public menu components, motion, providers
prisma               schema, migrations, seeds
scripts              database tooling, create-admin, the production check, performance
```

- **One app, two hosts.** `src/proxy.ts` routes by host. In production `menu.buzzify.me` serves public menus (and answers
  404 for `/studio`) and `studio.buzzify.me` serves the Studio (`/studio` and its APIs). Any other host, such as
  localhost, serves both. Each part of the configuration (hosts, email, sign-in) is read on first use on its own, so a
  mistake in one cannot break another; in particular nothing but the host settings can ever stop public menus from loading.
- **Menus are published as snapshots.** Publishing turns the draft into an immutable, numbered revision and makes it the
  menu’s live one. Guests read the live revision’s snapshot; it never changes, so it is cached by revision id. Editing the
  draft never touches what guests see until the next publish.
- **A live overlay carries what must change without a publish**: sold-out, hidden and stock state. It is read next to the
  snapshot, cached for at most 30 seconds and expired the moment it changes.
- **The Studio framework.** Every Studio operation is defined with `defineAction` or `defineQuery`
  (`src/server/studio/framework`), declaring the permission it needs and the restaurant or menu it targets. The runner
  loads the session, refuses deactivated people, resolves the target to its restaurant, works out the person’s effective
  permissions, runs the handler with a client scoped to that restaurant, and writes the audit entry. Static tests fail if
  anything under the Studio is not built that way, and lint stops Studio pages from importing the database client.
- **Permissions** are a pure function (`src/server/domain/permissions.ts`): role defaults for Super Admin, Designer and
  Owner, then each client’s overrides, which the People page shows as switches. Some permissions can never be granted to
  anyone but a Super Admin.
- **Prices are never trusted from the browser.** The cart sends product ids, option ids and quantities. Every
  total comes from `quoteCart` on the server.
- **Tenants are isolated by construction.** A restaurant owns menus and branches. Catalog tables carry `menuId` and
  branches carry `restaurantId`; all access goes through `menuDb()`, `restaurantDb()` or `scopedClient()`, a test
  fails if a new model is not classified, and raw SQL is blocked by lint.
- **The engine is plain functions.** Anything in `src/server/domain` takes data and a clock and returns data,
  so every rule is unit-tested without a database.

The design is in `docs/superpowers/specs/2026-10-16-studio-core-design.md`.

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

### Template Studio

A menu can be drawn with one of 30 template presets instead of the classic layout. See
`docs/superpowers/specs/2026-10-18-template-studio-design.md`.

- **Presets are code** in `src/lib/templates/presets/` (restaurant, café, bakery, ice cream). Each one has a palette
  (its signature and three curated alternatives), a font pair, a layout (hero, navigation, cards, section headings,
  product detail, option style, image ratio, density, corners, shadows) and scene settings. `src/ui/template/` draws
  them and `skins.css` holds each preset's own touches.
- **A business's changes are kept apart from the preset.** `BrandConfig.templateId` names the preset and
  `BrandConfig.design` holds only what the business changed. Featured products, the offer, which details to show and
  ordering carry over when the template changes; the look's changes stay with the template they were made for. Reset
  puts the look back and keeps the rest.
- **Publishing freezes the result.** The resolved design is part of the revision's snapshot, with the preset's version
  and the overrides, so a later change to a preset never alters a published menu, and restoring a revision brings its
  design back. A classic menu's snapshot has no design and its hash is unchanged.
- **Three visual modes per menu:** static (a drawn poster), motion (CSS) and 3D (React Three Fiber, one canvas, each
  preset's scene loaded on its own). Each has tap reaction, scroll that scrubs both ways, ambient movement, intensity,
  speed, brightness, blur, opacity and a readability veil, all set per business. 3D loads after the page is idle and
  only on a device that qualifies; anywhere else, with reduced motion, on a lost WebGL context or a scene that throws,
  the menu falls back to motion or still. `?scene=fail` forces the fallback to check it. Guests can pause the movement
  from the footer.
- **Saved designs** (`DesignTemplate`) belong to a restaurant, or are shared with every restaurant by a Super Admin.
  "Powered by Buzzify" is a per-restaurant setting only a Super Admin changes.
- **Menu-only mode:** ordering set to none hides the add buttons and the cart (`/cart` redirects to the menu).

#### Scene files (stage 2)

A business can put its own background behind a template menu: a GLB model, an MP4 video or a Lottie animation from the
media library. See `docs/superpowers/specs/2026-10-18-template-studio-stage-2-scene-files-design.md`.

- **The library takes three more kinds** (`MediaKind` `MODEL`, `VIDEO`, `LOTTIE`), judged by their bytes, each with its
  own limit: a GLB up to 10 MB, an MP4 up to 20 MB, a Lottie JSON file up to 2 MB (pictures stay at 15 MB). The Media
  page uploads and lists them; picture pickers (products, logos, favicon, search image) never offer or accept them.
- **Nothing in a file can run or reach out.** A GLB is parsed on the server (`src/server/media/glb.ts`): a well-formed
  container, no `uri` anywhere, only extensions the menu's loader handles (no Draco or KTX2), real PNG, JPEG or WebP
  textures, at most 300,000 triangles. A video must be H.264 (`src/server/media/mp4.ts`), at most 30 s and 1920 px; its
  length is read from the header or, for a browser recording, from its fragments. A Lottie file is checked as data
  (`src/server/media/lottie.ts`): any expression, an audio or video layer, an image or font from elsewhere refuses it,
  and element ids and classes are stripped. The menu plays Lottie with lottie-web's light build, which has no
  expression engine.
- **A video needs a poster frame.** The Studio takes one in the browser before the upload (`src/studio/media/poster.ts`)
  and the server makes its widths and a placeholder like a photo's.
- **Choosing one:** the Design tab's Motion panel, under "Background file", lists the restaurant's scene files and the
  shared ones and can upload one. A model gets size, position and turn sliders. The choice is part of the look, like
  the colours: changing template or resetting removes it, and a saved design keeps it. A shared saved design (a
  platform template) may only name a shared file.
- **Playing it:** a model replaces the template's scene in its one canvas (static mode: the template's poster; no
  WebGL: the template's motion); a video plays muted and looped over its poster (reduced motion and data saver: the
  poster); a Lottie animation loops, or follows the scroll with ambient movement off (reduced motion: the template's
  poster). Any failure falls back to the template's motion, and `?scene=fail` forces it for each kind.
- **In use, kept:** publishing freezes the file's URLs into the snapshot and lists it in `MenuRevision.assetIds`. Usage
  shows the menus whose draft and the saved designs that name it, and the file cannot be deleted while any of them or a
  revision does. Restoring a revision brings the choice back; duplicating a menu into another restaurant copies it.
- **Try it locally:** `npx tsx scripts/scene-fixtures.ts` writes a sample GLB and Lottie file to `.data/scene-fixtures/`.
- **In production** the R2 bucket needs a CORS rule that allows `GET` from the menu and Studio origins: the menu fetches
  GLB and Lottie files with `fetch` (a video plays without CORS). R2 answers range requests, which Safari needs for video.

Not built yet (later stages of the spec): assigning a scene file to one category or product, tap reactions and scroll
ranges for a model, background photos; options specific to a business (a flavour per scoop, prices by weight, a cake
inquiry flow); order submission and table sessions; analytics for the template features.

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
Only same-origin paths and `https://` URLs are accepted. Uploading images from the Studio (stored on Cloudflare R2)
arrives with milestone 2b.

## Performance and accessibility

`docs/perf/baseline-2026-10-16.md` is the latest measured baseline, with the menu before and after the
performance pass. The suite runs axe on the menu, product sheet and cart in all three languages, and on the Studio’s
screens in all three, and checks 44 px targets, keyboard entry and reduced motion.

What keeps the menu's first load small, and the tests that hold it there:

- Fonts are not preloaded (`next/font` would preload every face on every locale), each page downloads only its
  own script's faces, and every face is a single regular-weight file. Bodoni Moda is bundled with its weight
  pinned and its optical-size axis kept (`src/app/fonts/README.md`). `tests/e2e/fonts.spec.ts` checks which
  faces each locale downloads, their weights and a byte budget.
- The animation library is not in the menu's initial JavaScript. Menu motion is CSS, the Web Animations API
  or a scroll listener; the library loads with the product sheet, imported from `framer-motion` (the
  `motion/react` entry builds its full component at module scope and defeats tree shaking). ESLint rejects
  `motion` and `framer-motion` imports outside the sheet, product and Explore code.
- The Studio’s code never reaches the public menu: ESLint rejects Studio imports from the public menu’s routes and
  components.
- The page carries search text in its own language only; the other languages load from
  `POST /api/[tenant]/search-index` the first time the search box is used.
- The 404 page (`src/app/[tenant]/[locale]/not-found.tsx`) has no client code: Next renders it with every menu page,
  so anything it imports is in every page's first scripts. Its link back is a plain anchor whose address the server
  works out from the path the proxy passes on.
- Only the menu's home and product pages list their translations (`hreflang`); the table's entry page, the cart and
  explore name just the canonical, which keeps the table's page inside the first round trip.
- `next.config.ts` merges small chunks (`experimental.turbopackChunking.minChunkSize`): with the Studio's routes in
  the same build, the default split the framework into one more file and cost the menu 150 ms of LCP
  (`docs/perf/baseline-2026-10-17-studio-core-2a.md`, "After the fix").
- `npm run perf` reports initial script (requested before the largest paint) separately from script loaded
  afterwards, the verdicts for both goals, and whether the HTML document fits in the first round trip (14,600 bytes).

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
- The public API’s rate limiter is in memory, so it applies per server instance. Sign-in, reset and invitation limits are
  stored in PostgreSQL and do not have this problem. A shared store for the rest comes with hardening.
- No tax or service charge; the quote reserves a `charges` list for them.
- The Lighthouse result depends on the machine; see the dated file in `docs/perf/`.
- Stop `npm run dev` before `npm run build` or `npm run perf`. Both write `.next`, and a production build under a
  running dev server leaves it serving broken routes until it is restarted from a clean `.next`.
- Hosting is Vercel (region `fra1`), Neon (PostgreSQL, `eu-central-1`) and Resend; the guide is
  `docs/deploy/production.md`. Image storage and scheduled publishing (Cloudflare R2 and a cron job) arrive with
  milestone 2b.
- `src/server/data/cache.ts` works around a timing mismatch in Next.js 16.4.1’s tag expiry. After upgrading Next.js,
  `npm test` fails (on `tests/data/cache.test.ts`) if Next’s internals moved; re-check the workaround then.

## Security notes

This repository is public. The seed data is fictional demo data; no secrets are committed. `.env` and `.data/`
are git-ignored, and production secrets live only in the hosting provider’s environment variables. The development
sign-in users share a password that is public by design, so they are never created in production or in a database that
is not on the developer’s machine. The demo table PIN arrives with sub-project 2 and will be a development-only credential.

Uploaded scene files are data, never code: GLB and MP4 files are parsed and checked before they are stored, and a Lottie
file is stored only as its checked JSON, without expressions, external images or fonts, or element ids. See
"Scene files" above.
