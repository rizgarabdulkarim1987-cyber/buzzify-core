# Sub-project 2: Studio Core

Status: draft for review
Date: 2026-10-16
Branch: `studio-core`
Part of: Buzzify Menu Studio (repository `buzzify-menu`)

## 1. Purpose and outcome

Buzzify, a digital marketing agency, will create, publish and manage at least 1,000 restaurant and café
menus from one backend. Sub-project 1 built the public menu and its revenue engine for one demo café.
This sub-project builds the agency side, so Buzzify can run real clients.

Success looks like this:

- A Buzzify staff member signs in to `studio.buzzify.me`, creates a restaurant, creates its menu, loads
  the products from a spreadsheet, applies the client's logo, colors and fonts, previews the menu in
  three languages, publishes it to `menu.buzzify.me/{slug}` and downloads its QR code.
- The restaurant owner is invited by email, signs in, and changes prices, items, images and
  availability for their own restaurant only. Their changes reach customers on the same URL with no
  redeployment and no new QR code.
- Every change is a draft until published. Every publish is a revision that can be rolled back.
- The Studio stays fast with 1,000 menus, and Restaurant A's data can never reach Restaurant B.
- It runs in production on Vercel, Neon and Cloudflare R2.

## 2. Scope

### 2.1 Decomposition of the master brief

The master build prompt ("Buzzify Digital Menu Platform", 2026-10-16) supersedes the earlier three-part
decomposition. Sub-project 1 (foundation, customer menu, revenue engine) and the immersive work that
followed it (3D stage, Explore, category rails) are done.

| # | Sub-project | Master brief phases | Delivers |
|---|---|---|---|
| 1 | Foundation, customer menu, revenue engine | 1 (public hosting) | Done |
| **2** | **Studio Core (this document)** | 1, part of 2 | Sign-in, roles, restaurant and menu management, draft and publish with revisions, permanent URLs, QR codes, product editor, media, brand kit, import and export, bulk prices, scheduled publishing, production deployment |
| 3 | Brand and template engine | 2, 3 | Templates as data, the six starter templates, section-based visual builder with live preview, undo and redo, autosave, licensed font uploads, full color system |
| 4 | Motion and 3D studio | 3 | Motion library (Lottie, video, animated SVG, image sequences), animation presets, GLB and glTF upload with model settings, shared 3D asset library |
| 5 | Business layer | 4 | Subscriptions and feature gating, invoices, analytics dashboards and reports, promotions and upsell management UI, custom domains, PDF and URL menu importer, AI-assisted translation with review, branch managers, bulk settings changes |
| 6 | Verified table ordering | 5 | Table sessions, orders, cashier and kitchen screens, real-time updates, tax and service charge |
| 7 | Production hardening | throughout | Shared rate limiting and caching (Redis), error tracking, monitoring, row-level security, disaster recovery |

### 2.2 In scope

- Data model split into `Restaurant` (the client business) and `Menu` (the published unit), with
  migrations.
- Snapshot publishing: draft, publish, revisions, rollback, restore to draft, scheduled publishing.
- Menu states: draft, published, suspended, archived; duplicate and delete.
- Permanent public URLs, slug history with redirects, reserved slugs, per-menu SEO, QR codes.
- Accounts: invitation-only sign-up, email and password, password reset, email change, two-factor
  authentication for Super Admins, email through Resend.
- Roles and permissions: Super Admin, Agency Designer, Restaurant Owner; per-client permission
  overrides; server-side enforcement; audit log.
- The Studio in English, Arabic and Sorani: Jump to, Overview, Restaurants, All Menus, menu workspace
  (Content, Prices, Availability, Brand, Settings, QR codes, Import and Export, Revisions, Preview),
  Media, People, Activity, Settings.
- Media uploads to R2 with validation and image variants.
- Brand kit per menu.
- CSV and Excel import with preview, and export in the same format.
- Bulk price changes with preview.
- Product fields from the brief: dietary tags, calories, badges.
- Demo data: ATELIER plus two new demo restaurants, and a 1,000-menu load seed.
- Production deployment on Vercel, Neon, R2 and Resend, with setup instructions.

### 2.3 Out of scope

Templates and the visual builder, licensed font uploads, motion and 3D asset management, subscriptions
and billing, analytics dashboards, promotions and upsell editing (the engine keeps working; new menus
have no rules until sub-project 5), custom domains (the resolver exists; wiring is sub-project 5), the
PDF and URL importer, AI translation, branches beyond profile data, branch managers and staff roles,
ordering, tax and service charge, scheduled discounts, bulk changes to settings across menus,
Redis, error tracking, row-level security.

## 3. Decisions

| Decision | Choice | Reason |
|---|---|---|
| First goal | Run real clients | User choice. Templates, 3D tools and ordering build on a working admin |
| Hosting | Vercel (Next.js), Neon (PostgreSQL), Cloudflare R2 (media), Resend (email) | User choice. Managed, little server work; Vercel's API supports client custom domains later |
| Region | Vercel `fra1` and Neon `eu-central-1` (Frankfurt) | Closest major region to Iraq, and the database sits next to the functions |
| Who signs in | Buzzify staff and invited restaurant owners | User choice |
| Sign-in | Email and password, invitations and resets by email, Super Admins also use an authenticator app | User choice; one stolen Super Admin password would expose every menu |
| Auth library | Better Auth 1.7 with the Prisma adapter | Supports Next.js 16 and Prisma 7; email and password, sessions, rate limits in the database, TOTP plugin |
| Publishing | Immutable snapshots per revision | Fast public reads, trivial rollback and scheduling, structural isolation between drafts and live menus |
| Live fields | Availability, sold-out, stock and tables bypass publishing | An owner marking an item sold out cannot wait for a publish |
| Catalog sharing | Each menu owns its catalog; duplicate copies it | Simplest correct model; shared products across menus can come later if needed |
| Studio host | `studio.buzzify.me`, same deployment as `menu.buzzify.me` | One codebase; the session cookie never reaches public menu domains |
| Studio languages | English, Arabic, Sorani | User choice |
| Extras in this release | Brand kit, CSV and Excel import and export, bulk prices, scheduled publishing | User choice |
| Branch | `studio-core`, created from `main` | User choice |

## 4. Architecture

### 4.1 Stack additions

Added to the existing Next.js 16, React 19, Prisma 7, PostgreSQL, Zod, Tailwind 4 stack:

| Need | Package |
|---|---|
| Authentication | `better-auth` (Prisma adapter, two-factor plugin) |
| Email | `resend` |
| Object storage | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (R2 is S3-compatible) |
| Images | `sharp` (variants, metadata stripping, palette extraction) |
| SVG sanitizing | `dompurify` with `jsdom` on the server |
| Spreadsheets | `exceljs` (XLSX), `papaparse` (CSV) |
| QR codes | `qrcode` (generation), `jsqr` (decoding, tests only) |
| Studio components | Radix primitives with in-repo styled components, `@tanstack/react-table`, `cmdk` |

Exact versions are pinned when the plan is written. The Studio's code must never enter the public
menu's JavaScript; a lint rule bans imports from `src/studio` outside Studio routes, in the same way
the motion library is fenced today.

### 4.2 Hosts and routing

One deployment serves two hosts. `proxy.ts` (Next.js 16's replacement for middleware) routes by host:

| Host | Serves |
|---|---|
| `menu.buzzify.me` | Public menus. `/studio` paths return 404 |
| `studio.buzzify.me` | The Studio. Requests are rewritten to `/studio/...` |
| `media.buzzify.me` | R2 bucket through its custom domain (not the app) |
| `localhost:3100` | Development: public menus at `/{slug}/...`, Studio at `/studio/...` |

Host names come from environment variables, so preview deployments and development work without code
changes.

### 4.3 Code layout

```
prisma/                    schema, migrations, seeds (demo and load)
src/server/domain/         pure functions (existing engine, plus snapshot, slug, permissions, pricing-bulk,
                           import-diff, palette and contrast rules)
src/server/data/           Prisma access, menu-scoped and restaurant-scoped clients, loaders
src/server/publish/        snapshot builder, publish, schedule, rollback, restore, live overlay
src/server/studio/         auth setup, studioAction wrapper, services (restaurants, menus, people, media,
                           brand, import, qr, audit)
src/server/storage/        storage interface with R2 and local-folder adapters
src/app/[tenant]/...       public menu routes (existing)
src/app/studio/...         Studio routes and server actions
src/app/api/...            public APIs (existing), upload, export, cron
src/studio/                Studio components, layout, messages
src/ui/                    public menu components (existing)
```

### 4.4 Tenancy and isolation

Isolation works at two levels:

- **Menu scope.** Every catalog table carries `menuId`. Public reads and draft edits go through the
  existing scoped client, renamed `menuDb(menuId)`, which injects the scope on every query. The
  registry test that fails on an unclassified model stays, with three classes: menu-scoped,
  restaurant-scoped and global.
- **Restaurant scope.** `Branch`, `Membership`, `Invitation`, `MediaAsset` and `QrCode` access go through
  `restaurantDb(restaurantId)`. Every menu belongs to one restaurant; the Studio's permission check
  resolves a menu to its restaurant before anything runs.

Raw SQL stays banned in application code by lint. Migration files may contain SQL (for example the
trigram indexes in section 5.4).

### 4.5 Read path for public menus

1. Resolve the slug (or, later, the host) to `{ menuId, status, liveRevisionId }`. Cached with tag
   `menu:{menuId}`.
2. Load the live revision's snapshot. Revisions never change, so this is cached by revision id with no
   expiry.
3. Load the live overlay: product and option availability, stock, and tables. Cached with tag
   `live:{menuId}` for at most 30 seconds and revalidated on every change.
4. Combine into the domain `Catalog` the existing engine already uses.

The quote, suggestions, search-index and events APIs use the same path, so the cart is always priced
against what the customer sees. Pages stay rendered per request because the signature pick depends on
the time of day; they read from the cache, so 1,000 menus cost about the same as one.

### 4.6 Cache invalidation

Publish, rollback, scheduled activation, status changes and slug changes revalidate `menu:{menuId}`.
Availability, stock and table changes revalidate `live:{menuId}`. Studio actions use `updateTag` so the
person who made the change sees it at once; the cron job uses `revalidateTag` with the `max` profile.
The cache helpers are checked against the Next.js 16 documentation in `node_modules/next/dist/docs`
during planning, as `AGENTS.md` requires.

## 5. Data model

### 5.1 Renames

Today's `Restaurant` model becomes `Menu`, and `restaurantId` becomes `menuId` on `Category`, `Product`,
`ProductVariant`, `ModifierGroup`, `ModifierOption`, `UpsellRule`, `PairingRule`, `Bundle`,
`BundleItem`, `DaypartSchedule`, `Table`, `AnalyticsEvent` and `BrandConfig`. The local database holds
only seed data, so the migration renames in place and the seed is rerun.

### 5.2 New and changed models

| Model | Fields |
|---|---|
| `Restaurant` | `clientId` (unique, `BZ-0001` style, generated), `name`, `type` (café, restaurant, bakery, fast food, fine dining, other), `description`, `logoAssetId?`, `address`, `city`, `country`, `phone`, `whatsapp`, `socialLinks` (JSON: Instagram, Facebook, TikTok, website), `workingHours` (JSON per weekday, several ranges per day), `status` (ACTIVE, SUSPENDED, ARCHIVED), `notes`, `permissionPolicy` (JSON, section 9.3), `version`, timestamps |
| `Branch` | `restaurantId`, `name`, `address`, `city`, `phone`, `workingHours`, `sortOrder` |
| `Menu` | `restaurantId`, `name`, `slug` (unique), `status` (DRAFT, PUBLISHED, SUSPENDED, ARCHIVED), `statusBeforeArchive?`, `liveRevisionId?`, `draftHash`, `currency`, `defaultLocale`, `locales[]`, `timezone`, `numeralSystem`, `engineConfig`, `seo` (JSON: title and description per locale), `notes`, `version`, timestamps |
| `MenuSlug` | `slug` (unique), `menuId?` (null once the menu is deleted: a tombstone), `createdAt` |
| `MenuRevision` | `menuId`, `number` (unique per menu), `schemaVersion`, `snapshot` (JSON), `snapshotHash`, `goLiveAt?`, `wentLiveAt?`, `cancelledAt?`, `createdById`, `note`, `createdAt` |
| `BrandConfig` | Per menu: `logoAssetId?`, `logoDarkAssetId?`, `faviconAssetId?`, `logoText`, `palette` (JSON), `fontPairId`, `theme`, `railStyle`, `motionIntensity`, `navStyle`, `version` |
| `User` | Better Auth user fields, `isSuperAdmin`, `locale` (Studio language), `deactivatedAt?` |
| `Session`, `Account`, `Verification`, `TwoFactor` | Better Auth tables |
| `Membership` | `userId`, `restaurantId`, `role` (DESIGNER, OWNER; BRANCH_MANAGER and STAFF are reserved for later), unique per user and restaurant |
| `Invitation` | `email`, `restaurantId?` (null for staff invites), `role` or `asSuperAdmin`, `tokenHash`, `expiresAt`, `acceptedAt?`, `revokedAt?`, `invitedById` |
| `MediaAsset` | `restaurantId?` (null means shared), `kind` (IMAGE, SVG, ICON), `storageKey`, `contentHash`, `mime`, `bytes`, `width?`, `height?`, `variants` (JSON), `placeholder`, `alt` (JSON per locale), `folder`, `tags[]`, `uploadedById`, `createdAt` |
| `QrCode` | `restaurantId`, `menuId`, `label`, `tableNumber?`, `style` (JSON: foreground, background, logo on or off, frame text), `createdAt` |
| `ImportJob` | `menuId`, `fileName`, `status` (PARSED, APPLIED, DISCARDED, FAILED), `preview` (JSON), `rowCount`, `createdById`, `appliedAt?`, `createdAt` |
| `AuditLog` | `actorId`, `restaurantId?`, `menuId?`, `action`, `entityType`, `entityId`, `changes` (JSON: before and after of changed fields), `ip`, `userAgent`, `occurredAt` |
| `AnalyticsEvent` | Existing fields with `menuId`, plus `qrCodeId?` and `source?` |

### 5.3 Product additions

| Field | Meaning |
|---|---|
| `dietary[]` | VEGETARIAN, VEGAN, SPICY, GLUTEN_FREE, DAIRY_FREE, HALAL, CONTAINS_NUTS |
| `calories?` | Integer kcal for the default variant |
| `badges[]` | NEW, POPULAR, RECOMMENDED (shown on the public menu as quiet labels) |
| `version` | Optimistic concurrency, section 10.5 |

`Category`, `ModifierGroup`, `ModifierOption` and `ProductVariant` also get `version`. Product `media`
accepts a new entry kind, `{ "kind": "asset", "assetId": "..." }`, resolved to image variants at publish
time. Existing `art` entries keep working.

### 5.4 Indexes for 1,000 menus

- `Menu(status)`, `Menu(restaurantId)`, `Menu(createdAt)`, `Restaurant(city)`, `Restaurant(status)`.
- Trigram GIN indexes (`pg_trgm`) on `Restaurant.name`, `Restaurant.clientId`, `Menu.name`, `Menu.slug`
  for the search box and Jump to.
- `AnalyticsEvent(menuId, type, occurredAt)` and `AnalyticsEvent(type, occurredAt)`.
- `AuditLog(restaurantId, occurredAt)`, `AuditLog(actorId, occurredAt)`.
- `MenuRevision(goLiveAt)` where `wentLiveAt` and `cancelledAt` are null, for the scheduler.

### 5.5 What is published and what is live

| Published with a revision | Live, no publish needed |
|---|---|
| Menu settings that customers see (languages, currency, numerals, timezone, SEO, engine config) | Product and option availability (sold out, hidden) |
| Brand kit | Stock counts |
| Categories, products, variants, options, prices, texts, images, dietary tags, badges, calories | Tables |
| Upsell, pairing and bundle rules, daypart schedule | Menu status (suspend, archive, restore) |

## 6. Menu lifecycle

### 6.1 States

| State | Public URL shows | Can move to |
|---|---|---|
| DRAFT (never published) | 404 page | PUBLISHED (publish), ARCHIVED |
| PUBLISHED | The live revision | SUSPENDED, ARCHIVED |
| SUSPENDED | Neutral "temporarily unavailable" page, `noindex` | PUBLISHED (restore), ARCHIVED |
| ARCHIVED | Same unavailable page; hidden from Studio lists by default | The state before archiving (restore); deleted |

Suspending or archiving a restaurant applies to all its menus.

### 6.2 Publish

1. Build the snapshot from the draft tables with the existing catalog loader and serializer.
2. Validate. Blocking: a product without a price, a category with no visible products, a modifier group
   whose minimum cannot be met, a broken reference, a brand palette failing the body-text contrast
   rule. Warnings: missing translations (they fall back to the default language), products without
   images.
3. Insert `MenuRevision` number *n + 1* with the snapshot and its hash, set `liveRevisionId`, set status
   to PUBLISHED, write the audit entry and revalidate.

`draftHash` is recomputed after every draft edit. The Studio shows "unpublished changes" when it differs
from the live revision's `snapshotHash`.

### 6.3 Schedule

Publishing with a go-live time creates a revision with `goLiveAt` in the future. A Vercel Cron job calls
`/api/cron/publish` every minute with `CRON_SECRET`; it makes due revisions live in order and
revalidates. A menu has at most one pending scheduled revision; scheduling another replaces it after
confirmation. Pending schedules are listed on Overview and in the menu's Revisions tab, where they can
be cancelled. Publishing immediately while a schedule is pending keeps the schedule and says so.

### 6.4 Roll back and restore to draft

- **Roll back** makes an older revision live again by moving `liveRevisionId`. No data is copied.
- **Restore to draft** replaces the draft tables with an older revision's content in one transaction,
  so it can be edited and published again. The Studio asks for confirmation because unpublished draft
  changes are discarded. Live fields (availability, stock, tables) are not touched.

### 6.5 Duplicate and delete

- **Duplicate** copies a menu's draft catalog and brand kit into a new DRAFT menu with a new slug, in
  the same restaurant. A Super Admin can duplicate into another restaurant; media assets are then
  copied as new records that point at the same stored files.
- **Delete** is Super Admin only, only for ARCHIVED menus, and requires typing the menu's name. Its
  slugs remain as tombstones in `MenuSlug`, so no other restaurant can take them and old QR codes never
  open someone else's menu. Restaurants can be deleted only when all their menus are deleted.

## 7. URLs, SEO and QR codes

### 7.1 Public routes

| Route | Behavior |
|---|---|
| `/{slug}` | Redirects (307) to the visitor's browser language if the menu offers it, otherwise the default language |
| `/{slug}/t/{table}` | New language-neutral table entry; same language choice, then the existing table route |
| `/{slug}/{locale}`, `/t/{table}`, `/p/{product}`, `/cart`, `/explore` | Existing pages |
| Any path under an old slug | Permanent redirect (308) to the same path under the current slug, query kept |

### 7.2 Slugs

Lowercase Latin letters, digits and single hyphens, 3 to 48 characters. Unique across the platform
including tombstones. Reserved: `studio`, `api`, `admin`, `www`, `menu`, `media`, `app`, `help`, `login`,
`assets`, `static`, `_next` and any word added in Studio Settings. Changing a slug keeps the old one as a
redirect. The Studio suggests a slug from the menu name and checks availability as you type.

### 7.3 SEO

Per menu and language: title, description and social preview image (default: the logo on the brand
background, generated with `sharp`). Draft, suspended and archived menus are `noindex`. Each published
menu has a canonical URL and `hreflang` alternates for its languages.

### 7.4 QR codes

- Encoded URL: `https://menu.buzzify.me/{slug}?qr={id}` for the menu, or `.../{slug}/t/{table}?qr={id}`
  for a table. Because slugs redirect forever, a printed code survives renames.
- Generated as SVG with error correction level H. Style options: foreground and background colors
  (contrast checked), optional logo in the center (at most 20% of the width), optional frame text.
- Downloads: SVG and PNG (512, 1024, 2048 px). Bulk download of all table codes as a ZIP.
- Each scan records a `MENU_VIEW` event with `qrCodeId`, so scans are counted per code. The `qr`
  parameter is removed from the address bar after it is recorded.

## 8. Accounts and sign-in

- **No public sign-up.** Accounts come only from invitations. The first Super Admin is created with
  `npm run studio:create-admin`, which prompts for email and password in the terminal.
- **Invitations.** A Super Admin invites staff (Super Admin or Designer). A Super Admin, or an owner
  granted `people.invite`, invites owners to a restaurant. The email holds a single-use link valid for
  7 days; the inviter also sees the link to send another way. Accepting sets a name and password.
- **Passwords.** At least 12 characters, checked against a list of common passwords. Hashed by Better
  Auth (scrypt).
- **Reset and email change.** Reset links are valid for 1 hour. Changing email requires confirming from
  the new address. Both notify the old address.
- **Two-factor.** Super Admins must set up an authenticator app (TOTP) on first sign-in, with ten
  single-use recovery codes. Optional for designers and owners.
- **Sessions.** Stored in Postgres, 30-day sliding expiry, cookie host-only on the Studio host,
  `Secure`, `HttpOnly`, `SameSite=Lax`. People can see and end their sessions. Deactivating a user ends
  all their sessions.
- **Rate limits.** Sign-in, reset and invite acceptance are limited per IP address and per account,
  stored in Postgres (Vercel instances do not share memory).
- **Email.** Sent through Resend from `studio@buzzify.me`, in the recipient's Studio language. In
  development, emails are written to the console and to `.data/mail/` instead.

## 9. Roles and permissions

### 9.1 Permission keys

| Area | Keys |
|---|---|
| Restaurants | `restaurant.create`, `restaurant.edit`, `restaurant.status`, `restaurant.delete` |
| Menus | `menu.create`, `menu.duplicate`, `menu.settings`, `menu.status`, `menu.delete` |
| Content | `content.edit`, `content.prices`, `content.media`, `content.availability` |
| Design | `brand.edit`, `qr.manage` |
| Publishing | `publish.now`, `publish.schedule`, `publish.rollback` |
| Data | `import.run`, `export.run`, `prices.bulk` |
| Media library | `media.manage` |
| People | `people.invite`, `people.manage`, `permissions.manage` |
| Platform | `audit.view`, `platform.settings` |

### 9.2 Role defaults

| Role | Scope | Default permissions |
|---|---|---|
| Super Admin | Every restaurant | All keys |
| Designer | Restaurants they are assigned to | `restaurant.edit`, `menu.create`, `menu.duplicate`, `menu.settings`, `menu.status`, `content.*`, `brand.edit`, `qr.manage`, `publish.*`, `import.run`, `export.run`, `prices.bulk`, `media.manage` |
| Owner | Their own restaurant | `content.*`, `publish.now`, `prices.bulk` |

Owners upload product images through `content.media`; organizing and deleting library files needs
`media.manage`.

### 9.3 Per-client overrides

`Restaurant.permissionPolicy` holds, for each role, keys granted and keys revoked for that client only,
for example "owners at this client cannot publish" or "owners at this client may invite co-owners". The
People screen shows these as switches. `restaurant.create`, `restaurant.delete`, `menu.delete`,
`people.manage`, `permissions.manage`, `audit.view` and `platform.settings` can never be granted to
designers or owners.

### 9.4 Enforcement

- Every Studio server action and route handler is built with `studioAction(permission, resolveTarget,
  handler)`. It loads the session, rejects deactivated users, resolves the target (restaurant or menu)
  to its restaurant, computes the effective permissions (role defaults, then the client's policy), and
  only then calls the handler with a scoped data client and the actor. On success it writes the audit
  entry.
- Pages load data through the same check (`studioQuery`), so a user cannot read another restaurant's
  data by changing an id in the address bar.
- A test fails if any exported server action or route handler under `src/app/studio` or the Studio APIs
  is not built with the wrapper.
- The permission resolver is a pure function with a full matrix test: every role, every key, own
  restaurant and another restaurant, with and without policy overrides.

## 10. The Studio

### 10.1 Principles

Desktop-first and dense. Black, white and neutral grays with one restrained accent. Tables, filters and
keyboard shortcuts come first; previews are one click away. Navigation shows only features that exist
and that the person is allowed to use; a tab they lack permission for is hidden, not disabled.
The final look is designed during implementation with the project's design skills and reviewed in the
browser.

### 10.2 Languages

The Studio interface is available in English, Arabic and Sorani, chosen per user and stored on the
user. Interface strings live in the existing typed message module with a Studio namespace. Layout uses
logical properties throughout and `dir` follows the language. Content fields for Arabic and Sorani are
always right-to-left with the Arabic-script font, whatever the interface language. Arabic and Sorani
interface strings are machine-drafted and flagged for native review, like the public menu's.

### 10.3 Screens

| Screen | Contents |
|---|---|
| Jump to (Ctrl+K) | Search restaurants, menus, slugs and client IDs; open a result's workspace, profile, preview or public URL |
| Overview | Restaurants and menus by status, menus with unpublished changes, upcoming scheduled publishes, storage used, menu views in the last 7 days, recent activity |
| Restaurants | Table with search, filters (city, type, status, created), sorting and server paging. Profile tabs: Profile, Branches, Menus, People, Media, Activity |
| All Menus | Table with search (menu, restaurant, slug, client ID), filters (status, city, restaurant, created range, unpublished changes), sorting and server paging. Bulk publish, suspend, archive and restore with a per-menu result report. Row actions: edit, preview, copy URL, QR codes, duplicate |
| Menu workspace | Tabs: Content, Prices, Availability, Brand, Settings, QR codes, Import and Export, Revisions. A sticky bar shows unpublished changes, Preview and Publish (with "schedule" in its menu) |
| Media | Per-restaurant and shared libraries, folders, tags, drag-and-drop upload, previews, where each file is used |
| People | Users, pending invitations, assignments to restaurants, per-client permission switches, deactivate |
| Activity | The audit log, filterable by person, restaurant, menu, action and date |
| Settings | Reserved slugs, email sender name, platform defaults (languages, currency, timezone for new menus) |

An owner sees only their restaurant and lands in their menu's workspace. With several menus they land
on their restaurant's Menus tab.

### 10.4 Menu workspace details

- **Content.** Category tree with drag to reorder. Product drawer with the three languages side by
  side, price, sizes (variants), option groups with minimum and maximum, images from the library or
  uploaded in place, allergens, dietary tags, calories, badges, signature and featured flags. Missing
  translations are marked.
- **Prices.** A spreadsheet-like grid of products and variants with inline editing and bulk changes
  (section 13).
- **Availability.** Sold-out and hidden switches for products and options, applied immediately; a
  banner says these changes are live.
- **Brand.** Section 12, with a live preview beside the controls.
- **Settings.** Name, slug, languages, default language, currency, numerals, timezone, SEO, notes.
- **Revisions.** History with who, when and note; open any revision's preview; roll back; restore to
  draft; pending schedule with cancel.
- **Preview.** The draft rendered by the public menu's components in phone and desktop frames, in every
  enabled language, never cached and behind sign-in.

### 10.5 Concurrent editing

Every editable row carries `version`. A save sends the version it started from; if the row changed in
the meantime the save is refused and the Studio says who changed it and when, with a reload option.
Edits save to the draft immediately; Publish is the only gate before customers see anything.

## 11. Media

- **Upload.** The browser asks for an upload slot; the server checks permission, type and size and
  returns a presigned PUT URL to R2 valid for 5 minutes. The browser uploads directly, then asks the
  server to finalize.
- **Finalize.** The server reads the object, checks the real type from its bytes, computes its SHA-256
  and reuses an existing asset with the same hash in the same library. Images are stripped of metadata,
  converted to AVIF and WebP at 320, 640, 1080 and 1600 px wide (never upscaled) with a small blurred
  placeholder. SVG is sanitized (no scripts, event handlers, external references or foreign objects).
- **Types and limits.** JPEG, PNG, WebP, AVIF, SVG and ICO; 15 MB per file. Storage used per restaurant
  is tracked; quotas come with subscriptions.
- **Keys and delivery.** `r/{restaurantId}/{contentHash}/{variant}.{ext}` or `shared/...`, served from
  `media.buzzify.me` with a one-year immutable cache.
- **Deletion.** Blocked while any revision or draft references the asset; the Studio lists where it is
  used.
- **Development.** A local-folder adapter in `.data/media` behind the same interface, served by a
  development-only route.

## 12. Brand kit

| Control | Behavior |
|---|---|
| Logo | Light and optional dark version; SVG or raster |
| Favicon | Uploaded, or generated from the logo at 32, 180 and 512 px |
| Palette | Background, surface, raised surface, text, muted text, accent, text on accent, divider |
| Contrast | Text and muted text on background and surface must reach WCAG AA 4.5:1, or saving is blocked. Accent pairs below 3:1 warn |
| Suggest from logo | Extracts dominant colors and proposes three palettes that pass the contrast rule |
| Presets | Luxury, Coffee, Bakery, Fast food, Fine dining, each light and dark |
| Fonts | About six curated pairs, each with a Latin display face, a Latin text face and an Arabic-script face. Every Arabic-script face is checked for full Sorani coverage (ڕ ڵ ۆ ێ ە ڤ گ چ پ ژ) before it is offered |
| Theme | Light or dark |
| Rail | The existing category rail styles: grains, drum, flap, deck, plain |

Fonts stay self-hosted, subset, and loaded per page language, keeping the existing font budget tests
passing for every pair. The brand kit is part of the snapshot and goes live on publish.

## 13. Import, export and bulk prices

### 13.1 Format

CSV (UTF-8, with or without a byte order mark) or XLSX, one row per product:

`category_slug, category_en, category_ar, category_ckb, product_slug, name_en, name_ar, name_ckb,
description_en, description_ar, description_ckb, price, available, featured, signature, badges,
dietary, allergens, calories, sort`

Prices are written in the menu currency's major unit (`4.50` for USD, `6000` for IQD). Lists use `|`.

### 13.2 Import flow

1. Upload. Parsing is limited to 2,000 rows and 5 MB.
2. Preview: every row is classified as new, changed (with each changed field shown old and new),
   unchanged or invalid (with the reason). Rows match existing products by `product_slug`, otherwise by
   English name within the category. Products missing from the sheet are listed and left alone unless
   "hide products not in the sheet" is ticked.
3. Apply writes all changes to the draft in one transaction and records the import in the audit log.
   Nothing is live until publish.

Sizes and option groups are not in the sheet; they are edited in the Studio.

### 13.3 Export

Exports the draft in the same format as CSV or XLSX. A test checks that export followed by import
changes nothing.

### 13.4 Bulk prices

Select products (or filter by category), then: set to a price, add or subtract an amount, or add or
subtract a percentage, optionally including variants. Results round to the menu's rounding step:
0.05 for USD and 250 for IQD by default, configurable in Settings. A preview shows every old and new
price; applying writes to the draft in one transaction.

## 14. Seed and demo data

- **ATELIER** becomes restaurant `BZ-0001` with menu `atelier`, published as revision 1. Existing URLs keep
  working.
- **Two new demo restaurants**, fictional, each with about 12 products in three languages and its own
  brand kit, to prove that menus look and behave independently: a light-themed specialty coffee shop
  and a bold fast-food restaurant priced in IQD. Their Arabic and Sorani text is machine-drafted and
  flagged for review.
- **Development users**: a Super Admin, a Designer assigned to ATELIER and an owner of one demo
  restaurant, with development-only passwords and a development-only TOTP secret read from `.env`.
  They are never created in production.
- **Load seed** (`npm run db:seed:load`, not run by default): 1,000 restaurants with one menu each and
  small catalogs, for Studio performance tests.

## 15. Deployment and operations

### 15.1 What the user sets up

The plan includes step-by-step instructions. The user creates the accounts and enters secrets; Claude
does not sign up for services or handle credentials.

| Service | Setup |
|---|---|
| Vercel | Pro plan (commercial use), project linked to the GitHub repository, region `fra1`, environment variables, cron enabled |
| Neon | Project in `eu-central-1`, pooled connection for the app, direct connection for migrations |
| Cloudflare R2 | Bucket, API token limited to that bucket, custom domain `media.buzzify.me`, CORS for the Studio host |
| Resend | Domain `buzzify.me` verified (SPF, DKIM, DMARC records), API key |
| DNS | `menu`, `studio` pointing to Vercel; `media` to R2 |

### 15.2 Environment

`DATABASE_URL`, `DIRECT_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`,
`EMAIL_FROM`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`MEDIA_PUBLIC_URL`, `CRON_SECRET`, `PUBLIC_MENU_HOST`, `STUDIO_HOST`. `.env.example` lists them with
placeholder values. No secret is ever committed.

### 15.3 Release process

Migrations run with `prisma migrate deploy` during the Vercel build. Backups rely on Neon's
point-in-time restore for now; disaster recovery drills belong to sub-project 7.

## 16. Testing

| Layer | Coverage |
|---|---|
| Domain unit tests | Snapshot building and validation, draft hashing, schedule ordering, slug rules and reserved words, the permission matrix, import parsing and preview classification, bulk price rounding (USD and IQD), palette contrast and suggestion, QR codes decoded by `jsqr` for every style including the logo |
| Integration against real Postgres | Restaurant A's edits never change B; an owner of A cannot read or write B through any Studio action; draft edits are invisible until publish; availability changes are visible at once; scheduled revisions go live and can be cancelled; rollback and restore to draft; slug change redirects and old QR URLs resolve; duplicated menus are independent; only archived menus can be deleted; tombstoned slugs cannot be reused; optimistic concurrency rejects stale saves |
| Static | Every model classified; every Studio action and route uses `studioAction`; Studio code not imported by public routes; raw SQL banned |
| End to end (Playwright) | Super Admin with TOTP creates a restaurant and menu, imports a sheet, sets the brand, publishes, opens the public URL, changes a price, publishes again and sees the new price on the same URL; an owner sees only their restaurant and can mark an item sold out live; invite acceptance; the Studio in Arabic and Sorani checked with axe |
| Load | With the 1,000-menu seed, All Menus search, filters and paging respond within 300 ms of server time locally |
| Public menu | All existing tests keep passing against the snapshot read path |

## 17. Milestones and definition of done

The work ships in two milestones, each with its own implementation plan and each ending deployed.

**2a Platform**: the Restaurant and Menu split with migration and seed, snapshot publishing and the
live overlay, public routes and redirects, accounts with invitations, reset and two-factor, permissions
and audit, and the Studio shell in three languages with Jump to, Overview, Restaurants, All Menus,
People, Activity and Settings, deployed on Vercel, Neon and Resend.

**2b Content**: the menu workspace (Content, Prices, Availability, Settings, Revisions, Preview), media
on R2, the brand kit, QR codes, import and export, bulk prices, scheduled publishing, the two demo
restaurants and the load seed.

Done means:

1. The end-to-end flow in section 16 passes locally and works on the deployed site.
2. Tenant isolation, permission matrix and publishing tests pass.
3. A published menu's URL and QR code keep working through content changes, slug changes and rollbacks.
4. The Studio works fully in English, Arabic and Sorani.
5. All existing public menu tests pass, and the public menu's performance baseline is re-measured and
   recorded.
6. The README documents setup, deployment and architecture.

## 18. Risks and assumptions

| Item | Note |
|---|---|
| Public repository | The GitHub repository is public. Studio code can be public, but with real clients the user should consider making it private. Secrets are never committed either way |
| Vercel Pro and Neon costs | About $20 to $60 a month at the start; the plan notes current prices before setup |
| Better Auth on Next.js 16 and Prisma 7 | Supported by its declared peer ranges; verified with a spike at the start of 2a |
| `sharp` on Vercel | Supported in Node functions; image processing time is checked against the function time limit with 15 MB uploads |
| Snapshot size | A large menu with three languages is estimated at 100 to 400 KB of JSON per revision; revisions older than a configurable count (default 50) can be pruned later, except the live one |
| Public API rate limits | Still in memory per instance until Redis arrives in sub-project 7; sign-in limits move to Postgres now |
| Translation quality | Arabic and Sorani interface and demo strings are machine-drafted and need native review |
| Sorani font coverage | Pairs whose Arabic-script face misses Sorani letters are not offered |
| Scheduling precision | Within one minute, limited by the cron interval |
