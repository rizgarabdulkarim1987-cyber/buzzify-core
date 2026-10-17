# Studio Core 2b (Content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buzzify staff and owners edit a menu's content, prices, availability, brand kit, settings and QR codes in a nine-tab workspace, load and export it as a spreadsheet, preview the draft, and publish now, on a schedule, or back to an older revision, with media stored on Cloudflare R2.

**Architecture:** Every workspace edit is a framework action (`defineAction`) that writes the draft tables in one transaction and refreshes the draft hash in that same transaction; live switches (sold out, hidden) bypass publishing and expire the live overlay. Media goes from the browser straight to storage through presigned URLs, is checked and turned into variants on the server, and is resolved into image URLs when a snapshot is built, so a revision never depends on the library afterwards. Revisions gain rollback (move the live pointer), restore to draft (write a snapshot back with its own ids) and scheduled go-live (a Vercel Cron route).

**Tech Stack:** Next.js 16.4.1, React 19.3, TypeScript 5.9, Prisma 7.10 on PostgreSQL, Zod 4, Tailwind 4, Radix UI, TanStack Table, dnd-kit, sharp, DOMPurify with jsdom, AWS SDK v3 (S3 API of R2), exceljs, papaparse, qrcode, fontkit, fflate, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-16-studio-core-design.md` (milestone 2b in section 17). Conventions and the 2a file structure: `docs/superpowers/plans/2026-10-16-studio-core-2a-platform.md`. Preconditions: `docs/superpowers/plans/2026-10-17-studio-core-2a-followups.md`. Read the spec and this plan before starting a task.

**Base:** 2a was fast-forwarded into `main` on 2026-10-17 (`main` and `studio-core` both at `a45b8ad`). Execute this plan on a new branch `studio-core-2b` created from `main`.

## Global Constraints

All of 2a's Global Constraints still apply (Node 22.19 floor, exact pins, read `node_modules/next/dist/docs/` before a Next API, no raw SQL outside migrations, money in integer minor units, locales `en`/`ar`/`ckb` with logical CSS, machine-drafted Arabic and Sorani flagged, Studio code never imported by `src/app/[tenant]`, `src/app/api/[tenant]` or `src/ui`, no committed secret, every Studio write and read through the framework, commit after every task ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, nothing pushed, `npm run db:up` before database tests). In addition:

- **New dependencies, exact versions:** `@aws-sdk/client-s3@3.1146.0`, `@aws-sdk/s3-request-presigner@3.1146.0`, `sharp@0.35.5`, `dompurify@3.4.16`, `jsdom@29.1.1` (30.x needs Node 22.22), `exceljs@4.4.0`, `papaparse@5.7.0`, `fflate@0.8.3`, `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, the `@fontsource/*@5.3.0` faces of Task 14; dev: `@types/jsdom@28.0.3`, `@types/papaparse@5.5.2`, `jsqr@1.4.0`. `fontkit@2.0.4` moves from dev to runtime dependencies (QR frame text).
- **Draft hash invariant (2a follow-up 2):** every action that writes draft rows runs inside `editDraft` (Task 1), which refreshes `Menu.draftHash` in the same transaction. A change outside the menu that enters its snapshot (an asset's alt text or files, the restaurant's name or logo) calls `refreshDraftHashes(ctx.db, menuIds)` after commit.
- **Canonical sets (2a follow-up 8):** dayparts, dietary tags, badges and languages are written with `canonicalSet`, allergens with `canonicalStrings` (Task 1), so re-saving the same set never shows unpublished changes.
- **Versions:** every editable row (`Category`, `Product`, `ProductVariant`, `ModifierGroup`, `ModifierOption`, `BrandConfig`, `Menu`, `MediaAsset`, `QrCode`) is saved with `updateWithVersion`. Bulk writes (bulk prices, import, restore, currency change) move the version of every row they change. Live switches (`isAvailable`, `isHidden`) and reorders never move a version.
- **Cross-tenant sweep (2a follow-up 6):** every new action and query gets cases in `tests/studio/cross-tenant.test.ts` in the task that defines it (`SWEPT` with B's ids and with B's ids smuggled into A's target; `PLATFORM_ONLY` for Super-Admin-only definitions). Every new model with B's rows joins `buildWorld` and `snapshotOfB` in the task that creates it.
- **Studio routes:** no path segment under `src/app/api/studio/` contains a dot (2a follow-up 5); downloads are chosen with a field, never a file extension in the path. POST routes require a matching `Origin` or an `application/json` body (2a follow-up 4).
- **Audit:** every action name written is in `AUDIT_ACTIONS` and every entity type in `AUDIT_ENTITY_TYPES` (`src/server/domain/audit-actions.ts`), each with `activity.action.*` / `activity.entity.*` labels in all three Studio languages.
- **Media (spec 11):** JPEG, PNG, WebP, AVIF, SVG and ICO; at most 15 MB (15,728,640 bytes); presigned PUT valid 300 s; raster variants AVIF and WebP at 320, 640, 1080 and 1600 px wide, never upscaled; keys `r/{restaurantId}/{contentHash}/{variant}.{ext}` or `shared/{contentHash}/{variant}.{ext}`; public files served with `cache-control: public, max-age=31536000, immutable`.
- **Import (spec 13):** CSV (UTF-8, with or without BOM) or XLSX; at most 2,000 rows and 5 MB (5,242,880 bytes); columns exactly `category_slug, category_en, category_ar, category_ckb, product_slug, name_en, name_ar, name_ckb, description_en, description_ar, description_ckb, price, available, featured, signature, badges, dietary, allergens, calories, sort`; prices in the currency's major unit; lists separated by `|`.
- **Prices:** default rounding step 0.05 USD (5 minor units) and 250 IQD; every other currency one minor unit.
- **Contrast (spec 12):** text and muted text on background and on surface at least 4.5:1, else saving and publishing are blocked; text on accent, accent on background and accent on surface below 3:1 warn.
- **QR (spec 7.4):** error correction H; logo at most 20% of the code's width; PNG at 512, 1024 and 2048 px; URLs `${PUBLIC_MENU_ORIGIN}/{slug}?qr={id}` and `${PUBLIC_MENU_ORIGIN}/{slug}/t/{table}?qr={id}`.
- **Fonts (spec 12):** for every font pair, an English page downloads under 45 KB of fonts and an Arabic or Sorani page under 70 KB; every Arabic-script face has ڕ ڵ ۆ ێ ە ڤ گ چ پ ژ.
- **UI work:** use the `impeccable` skill, then `21st-ui-build`, within the Studio tokens of `src/studio/studio.css`; the project's tokens win over either skill. Every Studio string exists in `src/studio/messages/{en,ar,ckb}.ts`; Arabic and Sorani content inputs are `dir="rtl"` with the Arabic-script font whatever the interface language.

## Spec refinements

Decisions made while planning; each is a narrower or more concrete reading of the spec. Tell the user about them at handoff.

1. **The 1,000-menu load seed shipped in 2a** (its refinement 2). 2b only keeps `npm run test:load` passing.
2. **Snapshots stay at schema version 1.** 2b's brand, image and SEO fields are optional and left out when unused, so every revision published under 2a still parses and a menu that uses none of 2b's features keeps its hash (no false "unpublished changes" after the deploy).
3. **`QrCode` is menu-scoped and has no `restaurantId` column**; its restaurant is its menu's. **`MediaAsset` gets a registry class of its own**, "restaurant or shared": a restaurant's client reads its own and shared assets and writes only its own; a client without a restaurant sees only shared ones.
4. **Large files never pass through a function.** Vercel functions accept and return at most 4.5 MB, so media (15 MB) and sheets (5 MB) are uploaded with presigned PUTs, and every download (spreadsheet export, QR files, the table-code ZIP) is written to storage under `exports/` and handed out as a link signed for 300 s.
5. **Sheet live columns.** `available` and "hide products not in the sheet" change live fields (`isAvailable`, `isHidden`), so they apply at once like the Availability tab, need `content.availability`, and the preview lists them under "Live now". Everything else waits for publish.
6. **Sheet cells.** A column missing from the sheet leaves that field alone; a present, empty cell is the empty value (no text, no tags, no calories, false), except `available` (empty is true), `sort` (empty keeps the order; new rows go last) and `product_slug` (empty matches by English name, or makes a slug from it).
7. **Bulk prices.** "Set to" uses the typed price as it is; add and percentage results are rounded half up to the menu's step and never fall below one step; a result of zero or less refuses the whole change. Without "include variants" a variant keeps its difference from the base price.
8. **Rounding step** is `Menu.priceStep` (minor units; empty means the currency default), edited in Settings.
9. **Restore to draft** writes the revision back with its own ids, keeps the live switches of rows that still exist, moves every version forward, removes what the revision lacks (inactive categories included), and restores the brand kit and the settings guests see (languages, default language, currency, numerals, time zone, engine config, SEO). Name, slug, notes and rounding step stay. It needs `publish.rollback`, like rollback.
10. **Rollback** goes only to a revision that has been live; a pending scheduled revision is cancelled or waited for, never rolled back to.
11. **Scheduled activation expires the cache with `expireMenu`** (an immediate expiry), not `revalidateTag(tag, 'max')`: 2a found that stale-while-revalidate serves the old menu to the next guest. The cron route answers on every host (it is secured by `CRON_SECRET`), because Vercel calls the deployment URL, which the production host rules otherwise refuse.
12. **Preview** renders the draft's menu page and product sheets with the public components, with ordering off (no cart, suggestions, search or events) and a banner, from a second root layout under `/studio/preview`.
13. **Currency change** keeps the numbers people typed: when the minor-unit digits differ, every stored amount is rescaled (6,000 stays 6,000; 4.50 USD becomes 5 IQD), after confirmation.
14. **Social preview image:** an uploaded image per language wins; otherwise the live revision's logo on its background is drawn on request by a public route and cached forever per revision; a menu with neither has none.
15. **Price edits need `content.prices`** as well as `content.edit` (the owner role holds both by default).
16. **The Brand tab's live preview** is a sample drawn in the Studio from the unsaved palette and fonts; the Preview tab shows the saved draft.
17. **`Restaurant.logoAssetId`** is set on the Profile tab and becomes a new menu's brand logo.
18. **A category with products cannot be deleted**, and neither can a product or a size that a bundle uses.
19. **QR frame text is drawn as outlines** (fontkit), so SVG and PNG look alike without fonts on the machine. QR colours must be dark on light with at least 4.5:1. The ZIP holds an SVG and a 1024 px PNG per table code and a `codes.csv` index.
20. **Media navigation:** Super Admins and designers get a Media item and a restaurant Media tab; owners upload only from the product drawer.
21. **The scheduler index** is a plain `MenuRevision(goLiveAt)` index (pending rows are few).
22. **Options get a sold-out switch only.** Spec 10.4 offers "hidden" for options too, but options have no hidden field and a hidden option would still count toward its group's minimum; an option nobody should see is removed in the drawer.

## Review Focus

Inputs the spec implies but no feature test would naturally hit. Each line has a test in the named task.

1. **An editor opened before a restore to draft, a bulk price change, an import or a currency change, saved afterwards,** must be refused as a conflict naming who changed it, never overwrite the restored or bulk-changed values. (Tasks 9, 12, 13, 16, 19)
2. **A sheet that went through Excel:** Arabic and Sorani text, a name starting with `=`, `+`, `-` or `@`, prices typed `6,000`, `٦٠٠٠` or `4,50`, headers in other case or with spaces, a semicolon-delimited CSV, a CSV saved in Windows-1256: the same values come back, or the exact row and cell (or "save as CSV UTF-8") is named. (Tasks 2 and 19)
3. **A go-live time typed in the menu's time zone** (Asia/Baghdad) from a browser in another zone, a time inside a daylight-saving gap, a time in the past or within the next minute: it goes live at the menu-local time, or is refused with a clear message. (Task 16)
4. **A file that lies about itself:** a PNG named `.jpg`, an HTML page named `.svg`, an SVG with `<script>`, `onload`, `<foreignObject>` or an external `href`, a 1 × 20,000 px image, 15 MB plus one byte, an animated GIF: stored only if the bytes are an allowed type, sanitized and sized, otherwise refused with the reason, and nothing is left in storage. (Task 5)
5. **Old and copied content after 2b ships:** a revision published under 2a still renders and its menu shows no unpublished changes; a menu duplicated into another restaurant keeps its images after the source menu and the source asset are deleted. (Tasks 3 and 6)

## File structure

Every 2a path under `src/app/studio/(app)` and `src/app/studio/(auth)` moves under `src/app/studio/(studio)` in Task 8; later paths are written after the move.

```
prisma/schema.prisma                         MediaAsset, QrCode, ImportJob; columns on Restaurant, Menu, BrandConfig, MenuRevision
prisma/seed/riverlight.ts, hot-brick.ts      the two new demo menus (Task 21)
src/lib/canonical.ts                         canonicalSet, canonicalStrings
src/lib/product-tags.ts                      DIETARY_TAGS, BADGES
src/lib/palette.ts                           contrastRatio, paletteProblems, BRAND_PRESETS, dominantColors, suggestPalettes
src/lib/money-input.ts                       parsePriceInput, formatPriceInput, rescaleMinor, defaultPriceStep, roundToStep
src/lib/font-pairs.ts                        FONT_PAIRS, FontPairId
src/lib/media.ts                             MediaItem image fields for library images (modified)
src/server/domain/snapshot.ts                optional brand and SEO fields, snapshotAssetIds (modified)
src/server/domain/publish-rules.ts           LOW_CONTRAST, MISSING_ASSET (modified)
src/server/domain/media-type.ts              sniffMediaType, upload limits
src/server/domain/bulk-prices.ts             planBulkPrices
src/server/domain/schedule-time.ts           zonedLocalToUtc, checkGoLive
src/server/domain/qr.ts                      QrStyle, qrStyleProblem, qrTargetUrl, qrSvg
src/server/domain/import-sheet.ts            SHEET_COLUMNS, readHeaders, parseSheetRow, diffSheet, sheetRowsFromDraft
src/server/storage/                          storage.ts (interface, getStorage), r2.ts, folder.ts, keys.ts
src/server/media/                            svg.ts, process.ts, resolve.ts, usage.ts, copy.ts
src/server/sheets/                           read.ts, write.ts
src/server/qr/render.ts                      renderQr, frameTextPath, qrPng, qrZip
src/server/publish/draft.ts                  asset resolution, brand rows, restoreDraftFromSnapshot (modified)
src/server/publish/revisions.ts              rollbackMenu, scheduleRevision, cancelSchedule, activateDueRevisions
src/server/studio/services/                  draft-edit.ts, content.ts, media.ts, brand.ts, qr.ts, imports.ts
src/server/studio/actions/                   content, availability, prices, media, brand, revisions, qr, imports (+ menus.ts settings)
src/server/studio/queries/                   content, availability, prices, media, brand, revisions, qr, imports, preview
src/app/api/studio/media/finalize/route.ts, media/finalize-shared/route.ts
src/app/api/cron/publish/route.ts            scheduled go-live
src/app/api/dev-media/[...key]/route.ts      development storage (404 in production)
src/app/api/[tenant]/social-image/route.ts   generated social preview image
src/app/studio/(studio)/                     the Studio's root layout and its groups (moved in Task 8)
src/app/studio/(studio)/(app)/menus/[id]/    workspace layout and tabs: page (Content), prices, availability, brand, settings, qr, data, revisions, preview
src/app/studio/(studio)/(app)/media/         Media library; restaurants/[id]/media is the restaurant tab
src/app/studio/(preview)/preview/[menuId]/[locale]/   the draft preview (its own root layout)
src/app/studio/_actions/                     content, availability, prices, media, brand, revisions, qr, imports
src/studio/workspace/                        workspace components (tabs.ts, WorkspaceBar, editors)
src/studio/media/                            upload.ts (browser upload), MediaPicker
```

---

### Task 1: Draft-edit guardrails (2a follow-ups 2, 4, 5, 6, 8)

**Files:**
- Create: `src/lib/canonical.ts`, `src/lib/product-tags.ts`, `src/server/studio/services/draft-edit.ts`
- Modify: `src/server/studio/framework/route.ts`, `tests/studio/enforcement.test.ts`, `tests/studio/cross-tenant.test.ts` (opening comment)
- Test: `tests/lib/canonical.test.ts`, `tests/studio/draft-edit.test.ts`, `tests/studio/invoke.test.ts`

**Interfaces:**
- Produces:
  - `canonicalSet<T extends string>(values: readonly string[], order: readonly T[]): T[]` (each member once, in `order`'s order; a value outside `order` throws `Error('Unknown value X')`, since inputs are validated before).
  - `canonicalStrings(values: readonly string[]): string[]` (trimmed, empties dropped, duplicates ignoring case removed keeping the first spelling, sorted by code unit).
  - `DIETARY_TAGS = ['VEGETARIAN', 'VEGAN', 'SPICY', 'GLUTEN_FREE', 'DAIRY_FREE', 'HALAL', 'CONTAINS_NUTS'] as const`, `BADGES = ['NEW', 'POPULAR', 'RECOMMENDED'] as const`, types `DietaryTag`, `Badge`.
  - `editDraft<T>(ctx: ActionContext, fn: (tx: ScopedTx, menuId: string) => Promise<T>): Promise<T>` (runs `ctx.transaction`; after `fn` returns, calls `refreshDraftHash(tx, menuId)` inside the same transaction; throws when the action has no menu target).
  - `studioRoute` POST rule: a request with an `Origin` passes only when it names the request's host; a request without one passes only when its `content-type` is `application/json` (parameters ignored).
  - Enforcement rule 4 also accepts `export const maxDuration = <integer>;` and `export const runtime = 'nodejs';` in Studio route files. New rule 6: no directory or file name under `src/app/api/studio/` contains a dot, except the file `route.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/canonical.test.ts
expect(canonicalSet(['LUNCH', 'BREAKFAST', 'LUNCH'], DAYPARTS)).toEqual(['BREAKFAST', 'LUNCH']);
expect(canonicalSet(['ckb', 'en'], LOCALES)).toEqual(['en', 'ckb']);
expect(() => canonicalSet(['BRUNCH'], DAYPARTS)).toThrow('Unknown value BRUNCH');
expect(canonicalStrings([' Nuts', 'milk', 'nuts', ''])).toEqual(['Nuts', 'milk']);
```

```ts
// tests/studio/draft-edit.test.ts (a test-only defineAction on a menu target, run with runAction, as in framework.test.ts)
it('stores the hash of the draft as it stands at commit', async () => {
  // the action raises a product's basePrice through editDraft
  const menu = await prisma.menu.findUniqueOrThrow({ where: { id: a.menu.id } });
  expect(menu.draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma, a.menu.id)));
});
it('rolls the edit and the hash back together when the handler throws', async () => { /* price and draftHash unchanged */ });
```

```ts
// tests/studio/invoke.test.ts, describe('studioRoute')
it('refuses a POST with no Origin unless its body is JSON', async () => {
  // text/plain body without Origin → 403 FORBIDDEN; application/json body without Origin → 200 from the definition
});
```

Enforcement samples: `src/app/api/studio/menus/[menuId]/export.csv/route.ts` is flagged by rule 6; `export const maxDuration = 60;` passes rule 4; `export const dynamic = 'force-static';` fails it.

- [ ] **Step 2: Run `npm test -- tests/lib/canonical.test.ts tests/studio/draft-edit.test.ts tests/studio/invoke.test.ts tests/studio/enforcement.test.ts`.** Expected: FAIL (modules missing, rule 6 absent, the no-Origin text POST answers 200).
- [ ] **Step 3: Implement** the two lib files, `editDraft`, the POST rule in `sameOrigin` and the enforcement rules. Rewrite the opening comment of `tests/studio/cross-tenant.test.ts`: for the `PLATFORM_ONLY` definitions no designer or owner holds the permission, so their refusal shows the permission check, not the tenant check.
- [ ] **Step 4: Run the same command, then `npm test && npm run lint`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): draft edits keep the hash current; Studio routes refuse untrusted posts and dotted paths`).

---

### Task 2: Palettes, prices typed by people (pure)

**Files:**
- Create: `src/lib/palette.ts`, `src/lib/money-input.ts`
- Test: `tests/lib/palette.test.ts`, `tests/lib/money-input.test.ts`

**Interfaces:**
- Consumes: `Palette`, `DEFAULT_PALETTES` (`src/lib/brand.ts`), `minorUnitDigits` (`src/server/domain/money.ts`; move it to `src/lib/money-input.ts` and re-export it from `money.ts` so client components can use it).
- Produces:
  - `contrastRatio(foreground: string, background: string): number` (WCAG 2 relative luminance of `#RRGGBB`).
  - `interface PaletteProblem { foreground: keyof Palette; background: keyof Palette; ratio: number; severity: 'block' | 'warn' }` and `paletteProblems(palette: Palette): PaletteProblem[]` (block below 4.5 for text/bg, text/surface, muted/bg, muted/surface; warn below 3 for onAccent/accent, accent/bg, accent/surface; `ratio` rounded to two decimals; that order).
  - `BRAND_PRESET_IDS = ['luxury', 'coffee', 'bakery', 'fastFood', 'fineDining'] as const`, `BRAND_PRESETS: Record<BrandPresetId, { light: Palette; dark: Palette }>`.
  - `dominantColors(pixels: Uint8Array, channels: 3 | 4, count: number): string[]` (hex, most frequent first).
  - `suggestPalettes(colors: readonly string[], theme: 'light' | 'dark'): Palette[]` (always three).
  - `parsePriceInput(text: string, currency: string): { ok: true; minor: number } | { ok: false; reason: 'EMPTY' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'TOO_PRECISE' | 'TOO_LARGE' }` (Latin, Arabic-Indic `٠-٩` and extended `۰-۹` digits; `.`, `,` or `٫` as decimal mark; `,`, `٬`, space or no-break space between groups of three; when both `.` and `,` appear the last one is the decimal mark; a lone `,` or `٬` followed by exactly three digits groups thousands, followed by one or two digits it is the decimal mark; at most 1,000,000,000 minor units).
  - `formatPriceInput(minor: number, currency: string): string` (Latin digits, `.` decimal mark, no grouping: `4.50`, `6000`).
  - `rescaleMinor(minor: number, fromDigits: number, toDigits: number): number` (half up).
  - `defaultPriceStep(currency: string): number` (USD 5, IQD 250, else 1) and `roundToStep(minor: number, step: number): number` (half up to a multiple of `step`, never below `step`).

`dominantColors` buckets pixels by the top four bits of each channel, skips pixels with alpha below 128, and returns the mean colour of the largest buckets, skipping a bucket whose mean is within 24 of an earlier one on every channel. `suggestPalettes` takes up to three colours (saturated ones first, saturation ≥ 0.15) as accents; for each it builds bg, surface, raised, line, text and muted as near-neutrals tinted with the accent's hue (light: lightness 97, 100, 93, 85, 12 and 38 percent; dark: 7, 11, 16, 24, 92 and 70), then darkens (light) or lightens (dark) the accent in 2-point lightness steps until it reaches 3:1 on bg and surface, and picks `onAccent` as whichever of white and the text colour contrasts more with it. With fewer than three colours, the missing palettes reuse the first accent with untinted (saturation 0) and more strongly tinted (saturation 20) neutrals.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/palette.test.ts
expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
it('blocks muted text below 4.5:1 on the surface and names the pair', () =>
  expect(paletteProblems({ ...DEFAULT_PALETTES.light, muted: '#999999' })).toContainEqual(
    expect.objectContaining({ foreground: 'muted', background: 'surface', severity: 'block' })));
it('only warns for a weak accent', ...); // accent '#E8D9B0' on the light default → warn entries only
it.each(BRAND_PRESET_IDS.flatMap((id) => [[id, 'light'], [id, 'dark']]))('preset %s %s has no problem at all', ...);
it('finds the two colours of a red and blue logo, red first', ...); // 70% #D32F2F pixels, 30% #1565C0
it.each(['light', 'dark'])('suggests three %s palettes that pass every pair', ...); // inputs: one grey, one red, red+blue+green
```

```ts
// tests/lib/money-input.test.ts
it.each([
  ['4.50', 'USD', 450], ['4,50', 'USD', 450], ['1,234.5', 'USD', 123450], ['1.234,5', 'USD', 123450],
  ['6000', 'IQD', 6000], ['6,000', 'IQD', 6000], ['٦٠٠٠', 'IQD', 6000], ['۶,۰۰۰', 'IQD', 6000], ['٤٫٥', 'USD', 450],
])('reads %s %s as %i', (text, currency, minor) => expect(parsePriceInput(text, currency)).toEqual({ ok: true, minor }));
it.each([['', 'EMPTY'], ['abc', 'NOT_A_NUMBER'], ['-1', 'NEGATIVE'], ['4.555', 'TOO_PRECISE'], ['99999999999', 'TOO_LARGE']])(
  'refuses %s', (text, reason) => expect(parsePriceInput(text, 'USD')).toEqual({ ok: false, reason }));
expect(parsePriceInput('6000.5', 'IQD')).toEqual({ ok: false, reason: 'TOO_PRECISE' });
expect(formatPriceInput(450, 'USD')).toBe('4.50');
expect(rescaleMinor(450, 2, 0)).toBe(5);
expect(rescaleMinor(6000, 0, 2)).toBe(600000);
expect(roundToStep(489, 5)).toBe(490);
expect(roundToStep(6600, 250)).toBe(6500);
expect(roundToStep(1, 250)).toBe(250);
```

- [ ] **Step 2: Run them.** Expected: FAIL (modules not found).
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run them, then `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(lib): palette contrast, presets and suggestions; prices as people type them`).

---

### Task 3: Snapshot additions and publish rules (pure)

**Files:**
- Modify: `src/server/domain/snapshot.ts`, `src/server/data/tenant.ts` (`BrandView`), `src/server/domain/publish-rules.ts`, `src/lib/media.ts`
- Create: `src/lib/font-pairs.ts` (ids only here; faces in Task 14), `tests/domain/fixtures/atelier-snapshot-2a.json`
- Test: `tests/domain/snapshot.test.ts`, `tests/domain/publish-rules.test.ts`, `tests/lib/media.test.ts`

**Interfaces:**
- Produces:
  - `FONT_PAIR_IDS = ['classic', 'cafe', 'bakery', 'street', 'fine', 'modern'] as const`, `type FontPairId`, `DEFAULT_FONT_PAIR: FontPairId = 'classic'`, `isFontPairId(value: unknown): value is FontPairId`.
  - `BrandView` gains optional `fontPairId?: FontPairId` (absent means classic), `railChoice?: RailStyle` (the stored rail style, present only when motion `none` made `railStyle` plain and the two differ), `logo?: BrandImage`, `logoDark?: BrandImage`, `favicon?: BrandFavicon`, with `interface BrandImage { assetId: string; url: string; width: number; height: number; svg: boolean; rasterKey: string }` (`rasterKey`: the storage key of a raster rendition, for server-side drawing) and `interface BrandFavicon { assetId: string; png32: string; png180: string; png512: string }`.
  - `SnapshotMenu['seo'][locale]` gains optional `image?: { assetId: string; url: string; width: number; height: number }`.
  - `MediaItem` image kind gains optional `alts?: Partial<Record<Locale, string>>`, `srcset?: { avif: string; webp: string }` (`url 320w, url 640w, …`), `placeholder?: string` (a `data:image/webp;base64,` URI of at most 1,024 characters) and `assetId?: string`. `type DraftMediaItem = MediaItem | { kind: 'asset'; assetId: string }`: the asset kind lives only in draft rows; `parseMedia` drops it.
  - `snapshotAssetIds(snapshot: MenuSnapshot): string[]` (sorted, unique: product images, brand logos and favicon, SEO images).
  - `PublishIssueCode` gains `'LOW_CONTRAST'` (block, one per blocking pair of the palette of `brand.theme`, with `pair: { foreground: string; background: string; ratio: number }` on the issue) and `'MISSING_ASSET'` (block, for a product media entry still of kind `asset`, entity the product).
  - Every optional field is left out of the snapshot object when unused (never `undefined`, never `null`), so `snapshotHash` of a menu without them is what 2a computed.

- [ ] **Step 1: Write the fixture before changing code.** With the test database seeded (`seedAtelier` from `tests/helpers/db.ts`), write a scratch script (not committed) that saves `{ snapshot: await loadDraftSnapshot(prisma, menuId), hash }` to `tests/domain/fixtures/atelier-snapshot-2a.json`. Commit only the JSON.
- [ ] **Step 2: Write the failing tests**

```ts
// tests/domain/snapshot.test.ts
it('reads a snapshot published before 2b and hashes it as it was', () => {
  const { snapshot, hash } = fixture;
  expect(snapshotHash(parseSnapshot(snapshot))).toBe(hash);
});
it('leaves unused 2b fields out of the hash', () =>
  expect(snapshotHash(buildSnapshot({ menu, brand: { ...brand }, catalog }))).toBe(snapshotHash(base)));
it('changes the hash when a logo is set', ...);
it('round-trips logos, favicon, font pair, rail choice and SEO images through JSON', ...);
it('refuses a logo whose url is not https or same-origin', () => expect(() => parseSnapshot(withLogoUrl('javascript:x'))).toThrow());
it('lists every asset a snapshot uses, once', ...);
```

```ts
// tests/domain/publish-rules.test.ts
it('blocks publishing when text on the background is below 4.5:1', () =>
  expect(issues(withPalette({ text: '#777777', bg: '#FFFFFF' }))).toContainEqual(
    expect.objectContaining({ code: 'LOW_CONTRAST', severity: 'block', pair: expect.objectContaining({ foreground: 'text', background: 'bg' }) })));
it('checks only the palette of the theme guests see', ...);
it('blocks a library image that could not be resolved', ...); // media [{ kind: 'asset', assetId: 'a1' }] → MISSING_ASSET
it('finds nothing blocking in the ATELIER fixture', ...);
```

```ts
// tests/lib/media.test.ts
it('keeps the alts, srcset, placeholder and asset id of a library image', ...);
it('drops a draft asset entry', ...);
it('drops a placeholder that is not a small WebP data URI', ...);
it('drops a srcset that names an unsafe URL', ...);
```

- [ ] **Step 3: Run `npm test -- tests/domain tests/lib/media.test.ts`.** Expected: the new cases FAIL.
- [ ] **Step 4: Implement.** Extend the Zod schema with the optional fields (strict types, URLs checked with the same rule as `parseMedia`).
- [ ] **Step 5: Run `npm test`.** Expected: PASS, including the 2a snapshot and public read path suites.
- [ ] **Step 6: Commit** (`feat(domain): snapshots carry library images, brand assets and font pairs without changing old hashes`).

---

### Task 4: Storage on R2 and in a development folder

**Files:**
- Create: `src/server/storage/storage.ts`, `r2.ts`, `folder.ts`, `keys.ts`; `src/app/api/dev-media/[...key]/route.ts`
- Modify: `src/server/env.ts`, `.env.example`, `package.json` (AWS SDK)
- Test: `tests/storage/keys.test.ts`, `tests/storage/folder.test.ts`, `tests/storage/r2.test.ts`, `tests/storage/dev-media-route.test.ts`, `tests/server/env.test.ts`, `tests/server/production-env.test.ts`

**Interfaces:**
- Produces:
  - `storageEnv()`: `{ kind: 'r2'; accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; publicUrl: string } | { kind: 'folder'; dir: string; publicUrl: string }`. R2 when `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` are all set (some but not all: throws naming the missing ones); otherwise the folder `MEDIA_LOCAL_DIR` (default `.data/media`) with `MEDIA_PUBLIC_URL` (default `/api/dev-media`); in production the folder kind throws.
  - `cronEnv()`: `{ secret: string | null }` from `CRON_SECRET` (at least 32 characters when set).
  - `checkProductionEnv` also checks `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (set), `MEDIA_PUBLIC_URL` (an `https://` address), `CRON_SECRET` (set, at least 32 characters) and refuses `MEDIA_LOCAL_DIR`.
  - `interface Storage { presignPut(key: string, o: { contentType: string; contentLength: number; expiresInSec: number }): Promise<{ url: string; headers: Record<string, string> }>; presignGet(key: string, o: { fileName: string; expiresInSec: number }): Promise<string>; head(key: string): Promise<{ bytes: number; contentType: string } | null>; get(key: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string } | null>; put(key: string, body: Uint8Array, o: { contentType: string; cacheControl: string }): Promise<void>; delete(keys: readonly string[]): Promise<void>; publicUrl(key: string): string }`; `get` throws `StorageTooLargeError` beyond `maxBytes`; `delete` ignores missing keys.
  - `getStorage(): Storage` (from `storageEnv()`, kept per process).
  - `assetKey(owner: { restaurantId: string | null }, contentHash: string, variant: string, ext: string)`, `uploadKey(owner, id)` → `uploads/{restaurantId | 'shared'}/{id}`, `importKey(menuId, id)` → `imports/{menuId}/{id}`, `exportKey(menuId, id, fileName)` → `exports/{menuId}/{id}/{fileName}`, `isPublicKey(key)` (`r/` and `shared/` only), `IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'`. Keys match `^[a-z0-9][a-z0-9/_.-]*$` and never contain `..` (file names are reduced to that alphabet).
  - `r2Storage(config, client?: { send(command: unknown): Promise<unknown> }): Storage` (S3 client with `region: 'auto'`, endpoint `https://{accountId}.r2.cloudflarestorage.com`; presigned GET sets `ResponseContentDisposition: attachment; filename*=UTF-8''…`).
  - `folderStorage(dir: string, publicUrl: string, signingSecret: string): Storage` (presigned URLs are `/api/dev-media/{key}?method=PUT&len=N&expires=T&sig=HMAC` or `?method=GET&…`, signed with HMAC-SHA256 of the auth secret).
  - `GET /api/dev-media/{key}` serves a public key, or a private one with a valid GET signature; `PUT` stores the body with a valid PUT signature and a body no longer than `len`. Both answer 404 when `NODE_ENV` is `production`.

- [ ] **Step 1: Write the failing tests:** key shapes and refusals (`../x`, uppercase, spaces); folder storage put, head, get, delete, `StorageTooLargeError`, signature accepted, refused when expired, when the key or method was changed and when the body exceeds `len`; `r2Storage` with a fake client records `PutObjectCommand`, `GetObjectCommand` and `DeleteObjectsCommand` with bucket and key, and a presigned PUT URL (offline, fake credentials) contains host `acc.r2.cloudflarestorage.com`, path `/bucket/uploads/r1/u1` and `X-Amz-Expires=300`; the dev route serves a public file with its type and the immutable header, refuses a private key without signature, stores a signed PUT, and answers 404 with `NODE_ENV=production`; `storageEnv` with two R2 variables set throws naming the other two; production checks list every new variable.
- [ ] **Step 2: Run `npm test -- tests/storage tests/server`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `.env.example` gains the R2 variables, `MEDIA_PUBLIC_URL` and `CRON_SECRET` as commented placeholders.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(storage): R2 and a development folder behind one storage interface`).

---

### Task 5: Media assets: model, scope and processing

**Files:**
- Create: `src/server/domain/media-type.ts`, `src/server/media/svg.ts`, `src/server/media/process.ts`; migration `<timestamp>_media_assets`
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts`, `tests/helpers/db.ts` (`resetTestData` deletes assets), `next.config.ts` (`serverExternalPackages: ['jsdom']`), `package.json` (sharp, dompurify, jsdom)
- Test: `tests/domain/media-type.test.ts`, `tests/media/svg.test.ts`, `tests/media/process.test.ts`, `tests/data/tenant-registry.test.ts`, `tests/data/tenant-db.test.ts`

**Interfaces:**
- Produces:
  - Prisma `enum MediaKind { IMAGE SVG ICON }` and `MediaAsset { id; restaurantId String? (null: the shared library); kind MediaKind; storageKey String (the key prefix the files live under); contentHash String; mime String; bytes Int (the upload); storedBytes Int (every file written); width Int?; height Int?; variants Json @default("{}"); placeholder String @default(""); alt Json @default("{}"); folder String @default(""); tags String[]; uploadedById String?; version Int @default(1); createdAt; restaurant Restaurant? @relation(onDelete: Cascade); @@index([restaurantId, contentHash]); @@index([restaurantId, folder]); @@index([storageKey]) }`.
  - Registry `RESTAURANT_OR_SHARED_MODELS = ['MediaAsset']`. With a restaurant, reads are confined to `restaurantId = id OR restaurantId IS NULL`, updates and deletes to `restaurantId = id`, creates are stamped with `id` (a `null` or other id is refused), `upsert` is refused. Without a restaurant (a menu-only or global client), reads, updates and deletes are confined to `restaurantId IS NULL` and creates are stamped `null`.
  - `MEDIA_MAX_BYTES = 15_728_640`, `type MediaMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/svg+xml' | 'image/x-icon'`, `sniffMediaType(head: Uint8Array): MediaMime | null` (magic bytes; SVG is text whose first element, after an optional BOM, XML declaration, comments and whitespace, is `<svg`), `checkUploadRequest(r: { mime: string; bytes: number }): null | 'TYPE' | 'SIZE'`.
  - `sanitizeSvg(text: string): { svg: string; width: number; height: number } | null` (DOMPurify on a jsdom window with the SVG profiles; `script`, `style`, `foreignObject`, `iframe` and `use` of external files removed; `on*` attributes removed; `href`/`xlink:href` kept only when they start with `#`; attribute values with `url(` kept only for `url(#…)`; size from `width`/`height`, else the `viewBox`; null when there is no root `svg` or no size).
  - `type MediaRefusal = 'TYPE' | 'SIZE' | 'DIMENSIONS' | 'UNREADABLE' | 'SVG_UNSAFE'`.
  - `interface PreparedFile { variant: string; ext: 'avif' | 'webp' | 'png' | 'jpg' | 'svg' | 'ico'; contentType: string; body: Uint8Array }` and `interface PreparedAsset { kind: MediaKind; mime: MediaMime; contentHash: string; bytes: number; width: number; height: number; placeholder: string; files: PreparedFile[] }` (`contentHash`: SHA-256 hex of the bytes as uploaded; `files` always holds `original`).
  - `prepareAsset(bytes: Uint8Array): Promise<{ ok: true; asset: PreparedAsset } | { ok: false; reason: MediaRefusal }>`: rasters through `sharp(bytes, { failOn: 'error', limitInputPixels: 50_000_000, animated: false }).rotate()`, metadata dropped, refused as `DIMENSIONS` when a side exceeds 10,000 px or the long side is more than 8 times the short one; variants `avif-{w}` (quality 55) and `webp-{w}` (quality 75) for each of 320, 640, 1080 and 1600 no wider than the source (one pair at the source width when it is under 320); placeholder 16 px wide WebP, quality 40, as a data URI of at most 1,024 characters. SVGs: sanitized text as `original` plus `webp-320` and `webp-640` renderings. ICO: stored as it is, size from its first directory entry, no variants.
  - `storeAsset(storage: Storage, owner: { restaurantId: string | null }, asset: PreparedAsset): Promise<{ storageKey: string; variants: AssetVariants; storedBytes: number }>` with `type AssetVariants = { original: string; avif?: Record<string, string>; webp?: Record<string, string>; favicon?: Record<'32' | '180' | '512', string> }` (storage keys), every file written with `IMMUTABLE_CACHE`.
  - `faviconFiles(asset: { kind: MediaKind; original: Uint8Array }): Promise<Record<'32' | '180' | '512', Uint8Array>>` (square PNG, `fit: 'contain'`, transparent; used in Task 14).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/media-type.test.ts
it.each([['jpeg', JPEG_HEAD, 'image/jpeg'], ['png', PNG_HEAD, 'image/png'], ['webp', WEBP_HEAD, 'image/webp'],
  ['avif', AVIF_HEAD, 'image/avif'], ['ico', ICO_HEAD, 'image/x-icon'], ['svg', utf8('<?xml version="1.0"?><svg …'), 'image/svg+xml']])(
  'recognizes %s by its bytes', (_, head, mime) => expect(sniffMediaType(head)).toBe(mime));
it('refuses a GIF, an HTML page and a PDF', ...);
it('refuses 15 MB plus one byte before the upload', () => expect(checkUploadRequest({ mime: 'image/png', bytes: 15_728_641 })).toBe('SIZE'));
```

```ts
// tests/media/svg.test.ts
it('removes scripts, handlers, foreign objects, style elements and external references', () => {
  const out = sanitizeSvg(EVIL_SVG)!.svg;
  expect(out).not.toMatch(/<script|onload=|foreignObject|<style|https?:\/\/|javascript:/i);
});
it('keeps gradients referenced by #id', ...);
it('refuses an SVG without a size, and a document that is not SVG', ...);
```

```ts
// tests/media/process.test.ts (inputs made with sharp in the test)
it('makes AVIF and WebP at 320, 640 and 1080 for a 1200 px photo, never upscaled', async () => {
  const out = await prepareAsset(await jpeg(1200, 800));
  expect(variantNames(out)).toEqual(['avif-320', 'avif-640', 'avif-1080', 'original', 'webp-320', 'webp-640', 'webp-1080']);
});
it('drops EXIF metadata and applies its orientation', ...);
it('treats a PNG named .jpg as the PNG it is', ...); // mime from bytes
it('refuses a 1 × 20,000 image as DIMENSIONS', ...);
it('refuses bytes sharp cannot read as UNREADABLE', ...);
it('keeps the placeholder under 1,024 characters', ...);
it('hashes the bytes as uploaded', ...);
```

Tenant tests: `registers every model with an optional restaurantId column` expects `[...RESTAURANT_OR_SHARED_MODELS, 'AuditLog', 'Invitation'].sort()`; `restaurantDb(a)` lists A's and shared assets but not B's, cannot update or delete a shared one (count 0), and refuses to create one with `restaurantId: null`; `globalDb` lists only shared ones.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Add the model, create and apply the migration, implement the scope rule and the three modules.**
- [ ] **Step 4: Run `npm test && npm run build`.** Expected: PASS; the build bundles sharp and leaves jsdom external.
- [ ] **Step 5: Commit** (`feat(media): media assets with a shared library, type sniffing, SVG sanitizing and image variants`).

---

### Task 6: Media actions, resolution into snapshots, usage and copies

**Files:**
- Create: `src/server/media/resolve.ts`, `src/server/media/usage.ts`, `src/server/media/copy.ts`, `src/server/studio/services/media.ts`, `src/server/studio/actions/media.ts`, `src/server/studio/queries/media.ts`, `src/app/studio/_actions/media.ts`, `src/app/api/studio/media/finalize/route.ts`, `src/app/api/studio/media/finalize-shared/route.ts`, `src/studio/media/upload.ts`; migration `<timestamp>_revision_assets`
- Modify: `prisma/schema.prisma` (`MenuRevision.assetIds String[]`), `src/server/publish/draft.ts`, `src/server/publish/publish.ts`, `src/server/studio/actions/menus.ts` (`duplicateMenu`), `src/server/domain/audit-actions.ts`, Studio messages
- Test: `tests/studio/media.test.ts`, `tests/publish/draft.test.ts`, `tests/publish/publish.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Consumes: `prepareAsset`, `storeAsset`, `checkUploadRequest`, `MEDIA_MAX_BYTES` (Task 5); `getStorage`, keys (Task 4); `MediaItem`, `snapshotAssetIds` (Task 3); `editDraft` (Task 1); `refreshDraftHashes` (`src/server/studio/services/restaurants.ts`).
- Produces:
  - Actions (restaurant target): `media.requestUpload({ restaurantId, fileName, mime, bytes })` (`content.media`) → `{ uploadKey, url, headers, expiresAt }`; `media.finalize({ restaurantId, uploadKey, alt?: Partial<Record<Locale, string>>, folder? })` (`content.media`) → `{ assetId, deduplicated: boolean }`; `media.update({ restaurantId, assetId, version, alt, folder, tags })` (`media.manage`); `media.delete({ restaurantId, assetId })` (`media.manage`). Platform twins for the shared library, all `media.manage`: `media.requestSharedUpload`, `media.finalizeShared`, `media.updateShared`, `media.deleteShared` (same inputs without `restaurantId`).
  - Finalize: the key must start with `uploadKey({ restaurantId })`'s prefix (else `NOT_FOUND`); reads it with `MEDIA_MAX_BYTES`; on `prepareAsset` refusal answers `INVALID` with `fields.file` naming the reason; reuses an asset of the same library with the same `contentHash` (no new files); deletes the upload object in every case. Audit `media.uploaded`.
  - Delete: refused with `INVALID` and `fields.usage` (the count) while `assetUsage` finds any use; removes the row, then the files only when no other row has the same `storageKey`. Audit `media.deleted`. Update moves `version`, audits `media.updated` and refreshes the draft hash of every menu whose draft uses the asset (after commit).
  - Queries: `media.list({ restaurantId?, folder?, tag?, q?, page })` (`'view'`; with a restaurant: its assets and shared ones, marked; without: shared only) → `{ rows: Array<{ id; kind; thumbUrl; width; height; alt; folder; tags; shared: boolean; version; bytes }>; folders: string[]; tags: string[]; total }`; `media.usage({ restaurantId, assetId })` (`'view'`) and `media.sharedUsage({ assetId })` (`media.manage`, platform) → `AssetUsage`.
  - `type AssetUsage = { drafts: Array<{ menuId: string; menuName: string; where: 'product' | 'logo' | 'logoDark' | 'favicon' | 'seo' | 'restaurant'; label: string }>; revisions: Array<{ menuId: string; menuName: string; number: number }> }`; `assetUsage(db: AnyDb, asset: { id: string; restaurantId: string | null }): Promise<AssetUsage>` (product media through Prisma's JSON `array_contains` with `{ kind: 'asset', assetId }`, the brand and restaurant columns once they exist, revisions through `assetIds: { has: id }`).
  - `loadAssets(db: AnyDb | ScopedDb (overloads), restaurantId: string, ids: readonly string[]): Promise<Map<string, ResolvableAsset>>` (only the restaurant's and shared assets, named explicitly in the `where`, so it holds on any client; used for product media here, SEO images in Task 13 and brand assets in Task 14).
  - `assetImage(asset: ResolvableAsset, mediaUrl: (key: string) => string): { url: string; width: number; height: number; svg: boolean; rasterKey: string }` (`url`: the widest WebP no wider than 1080, or the sanitized SVG; `rasterKey`: the `webp-640` key, else the widest WebP), the base of `BrandImage` and of SEO images.
  - `resolveDraftMedia(media: unknown[], assets: ReadonlyMap<string, ResolvableAsset>, defaultLocale: Locale, mediaUrl: (key: string) => string): unknown[]` (an asset entry becomes an image with `url` = the widest WebP no wider than 1080, `srcset`, `width`/`height` of the original, `alt` = the default language's text, `alts`, `placeholder`, `assetId`; an SVG asset becomes an image of its sanitized file without `srcset`; an id not in `assets` stays `{ kind: 'asset', assetId }`), with `ResolvableAsset = Pick<MediaAsset, 'id' | 'kind' | 'width' | 'height' | 'variants' | 'placeholder' | 'alt'>`.
  - `draftMediaFromSnapshot(media: unknown[], assetMap?: ReadonlyMap<string, string>): unknown[]` (an image with `assetId` goes back to `{ kind: 'asset', assetId }`, through `assetMap` when given).
  - `loadDraftSnapshot` resolves product media with `loadAssets` and `resolveDraftMedia`. `publishMenu` stores `assetIds = snapshotAssetIds(snapshot)` on the revision. `writeDraftFromSnapshot(tx, menuId, snapshot, assetMap?)` writes media with `draftMediaFromSnapshot`.
  - `copyAssetsForMenu(tx: ScopedTx, args: { assetIds: string[]; toRestaurantId: string }): Promise<Map<string, string>>` (for each asset of another restaurant: an asset of the target with the same `contentHash`, or a new row in the target pointing at the same `storageKey`, variants and alt; shared assets map to themselves). `duplicateMenu` into another restaurant calls it and passes the map to `writeDraftFromSnapshot` (2a follow-up 7).
  - Browser helper `uploadMedia(file: File, target: { restaurantId: string } | { shared: true }, o?: { alt?; folder?; onProgress?(fraction: number): void }): Promise<ActionResult<{ assetId: string; deduplicated: boolean }>>` (request through the Server Action, PUT with `XMLHttpRequest` for progress, finalize with a JSON POST to the route). Both finalize routes export `maxDuration = 60`.

- [ ] **Step 1: Write the failing tests** (folder storage in a temporary `MEDIA_LOCAL_DIR`)

```ts
// tests/studio/media.test.ts
it('uploads through a signed slot and finalizes into variants under the restaurant key', async () => {
  // requestUpload as A's owner → put the PNG through storage at uploadKey → finalize
  // → MediaAsset with restaurantId A; storage has r/{A}/{hash}/webp-320.webp; the upload object is gone
});
it("refuses to finalize another restaurant's upload key", ...);
it('reuses the asset when the same file is uploaded twice to one library', ...);
it('refuses a file over 15 MB at the slot and at finalize, and leaves nothing in storage', ...);
it('refuses an HTML page uploaded as image/svg+xml, naming the reason', ...);
it('lets an owner upload but not rename or delete', ...);
it('refuses to delete an asset a draft or a revision uses, and lists where', ...);
it('deletes the files only when no other asset shares them', ...);
it('refreshes the draft hash of menus whose draft uses an asset when its alt text changes', ...);
```

```ts
// tests/publish/draft.test.ts and publish.test.ts
it('resolves a library image into the snapshot with its variants and alt texts', ...);
it('leaves an unknown asset unresolved, so publishing is blocked', ...);
it('records the assets a revision uses', ...);
it('copies assets into the target restaurant when a Super Admin duplicates across restaurants', async () => {
  // A's menu uses A's asset; duplicate into B; the copy's product media names a new asset of B with the same storageKey
  // archive and delete A's menu, delete A's asset: B's draft snapshot still resolves the same image URL
});
it('keeps shared assets shared on a cross-restaurant duplicate', ...);
```

Sweep: B's asset and upload key in every media definition; A's restaurant with B's asset id and B's upload key; the shared twins in `PLATFORM_ONLY`. `buildWorld` gives B an asset; `snapshotOfB` includes B's assets.

- [ ] **Step 2: Run `npm test -- tests/studio/media.test.ts tests/publish tests/studio/cross-tenant.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement** (migration for `assetIds`; audit names `media.uploaded`, `media.updated`, `media.deleted` and entity `MediaAsset` with labels; error messages for each `MediaRefusal` in the Studio messages).
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(media): uploads, the library's actions, images resolved at publish, and copies across restaurants`).

---

### Task 7: Library images, badges, dietary tags and calories on the public menu

**Files:**
- Modify: `src/ui/art/ProductVisual.tsx`, `src/ui/menu/ProductRow.tsx`, `src/ui/product/ProductDetail.tsx`, `src/server/data/menu-view.ts`, `src/lib/messages/{en,ar,ckb}.ts`
- Test: `tests/data/menu-view.test.ts`, `tests/e2e/menu.spec.ts`

**Interfaces:**
- Consumes: `MediaItem` image fields (Task 3); `DIETARY_TAGS`, `BADGES` (Task 1).
- Produces:
  - `MenuProductView` gains `badges: Badge[]`, `dietary: DietaryTag[]`, `calories: number | null`; `buildMenuView` sets each image's `alt` to `alts[locale] || alt`.
  - `ProductVisual`: an image with `srcset` renders `<picture>` with an AVIF `<source>` and a WebP `<img>` carrying `width`, `height`, `sizes`, `decoding="async"`, and `loading="lazy"` unless `priority` (then `fetchPriority="high"`). The product detail paints the placeholder as the frame's background; rows do not (it would grow the HTML).
  - Public messages `menu.badge.{NEW,POPULAR,RECOMMENDED}`, `menu.dietary.{…}`, `menu.calories` (`{count} kcal`).
  - Rows show badges as quiet labels; the product detail lists dietary tags and calories in the menu's numerals.

- [ ] **Step 1: Write the failing tests:** `buildMenuView` passes badges, dietary tags and calories and picks the Arabic alt on an Arabic page; `menu.spec.ts` on a temporary menu (`createTemporaryMenu`, extended to take a product with `badges: ['NEW']`, `dietary: ['VEGAN']`, `calories: 320` and a library image in its media; the helper stores a fixture PNG with `prepareAsset` and `storeAsset` in the development folder and creates the asset row): the row shows "New" (Arabic page: the Arabic label), the product page shows "Vegan" and "320 kcal", the image element has an AVIF source and `srcset`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test`, `npm run test:e2e -- --project=mobile tests/e2e/menu.spec.ts`, and `npm run perf` against the ATELIER table page.** Expected: PASS; the HTML document stays inside the first round trip (14,600 bytes), as `scripts/perf.ts` reports.
- [ ] **Step 5: Commit** (`feat(menu): library photos with modern formats, badges, dietary tags and calories`).

---

### Task 8: The menu workspace and the draft preview

**Files:**
- Move: `src/app/studio/layout.tsx`, `not-found.tsx`, `[...rest]/`, `(app)/`, `(auth)/` into `src/app/studio/(studio)/` (no URL changes; `_actions/` stays)
- Create: `src/app/studio/(preview)/preview/[menuId]/[locale]/layout.tsx` (a root layout), `page.tsx`; `src/app/studio/(studio)/(app)/menus/[id]/layout.tsx`, `preview/page.tsx`; `src/studio/workspace/tabs.ts`, `WorkspaceBar.tsx`, `PreviewFrames.tsx`; `src/server/studio/queries/preview.ts`
- Modify: `src/app/studio/(studio)/(app)/menus/[id]/page.tsx`, `src/server/studio/queries/menus.ts` (`getMenu`), `src/ui/AppProviders.tsx` and the components that fetch (`useSuggestions`, `useSearchIndex`, `track.ts`, `CartBar`), `src/lib/messages/*` (`preview.banner`), Studio messages
- Test: `tests/studio/preview.test.ts`, `tests/studio/workspace-tabs.test.ts`, `tests/e2e/studio-workspace.spec.ts`

**Interfaces:**
- Consumes: `loadDraftSnapshot`, `loadOverlay`, `toCatalog`, `buildMenuView`, `brandCss`, `fontVariablesFor`.
- Produces:
  - `getMenu` gains `permissions: Permission[]` (the actor's at the menu) and keeps `can`.
  - `WORKSPACE_TABS: readonly WorkspaceTab[]` with `interface WorkspaceTab { key: 'content' | 'prices' | 'availability' | 'brand' | 'settings' | 'qr' | 'data' | 'revisions' | 'preview'; path: string /* '' for Content, '/prices', … */; labelKey: string; needs: 'view' | readonly Permission[] /* any of */ }` and `visibleTabs(permissions: ReadonlySet<Permission>, built: ReadonlySet<WorkspaceTab['key']>): WorkspaceTab[]`. Needs: content `content.edit`; prices `content.prices` or `prices.bulk`; availability `content.availability`; brand `brand.edit`; settings `menu.settings`; qr `qr.manage`; data `import.run` or `export.run`; revisions and preview `view`. `BUILT_TABS` starts as `content` (the 2a page) and `preview`; each later task adds its key.
  - The workspace layout: back link, name, restaurant and client ID, status, unpublished-changes badge, public URL with copy and open, live revision number and date; a sticky `WorkspaceBar` with Preview and Publish (its issues dialog moves here from 2a's `MenuActions`; the menu's other 2a actions stay in its "More" menu); `RouteTabs` of `visibleTabs`.
  - Query `preview.draft({ menuId, locale })` (`'view'`) → `{ tenant: TenantInfo; view: MenuView }` from the draft snapshot with the live overlay (`TenantInfo.revisionId` is `'draft'`); a locale the menu does not offer is `NOT_FOUND`.
  - `AppProviders` takes `preview?: boolean`: no events, quotes, suggestions or search index are requested, add-to-cart is hidden, and a banner says `preview.banner`.
  - The preview root layout renders `<html lang dir data-theme>` with the public stylesheet, the draft's fonts and `brandCss`, and `robots: noindex`.
  - The Preview tab shows a 390 × 844 phone frame and a 1280 × 800 desktop frame (scaled to fit) of `/studio/preview/{menuId}/{locale}`, a button per enabled language, and Reload.

- [ ] **Step 1: Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md` and `layout.md`** on multiple root layouts and full-page loads between them.
- [ ] **Step 2: Write the failing tests:** `preview.draft` returns the draft's edited price (999) while `getCatalog` still returns 300, and a product marked sold out shows as sold out; `visibleTabs` for owner defaults is Content, Prices, Availability, Revisions and Preview (once all are built), and hides Brand for a designer whose policy revokes `brand.edit`; the sweep runs `preview.draft` with B's menu. `studio-workspace.spec.ts`: a Super Admin opens ATELIER's menu, sees the tabs and the bar, opens Preview and finds ATELIER's first product name inside the phone frame's document, whose `<meta name="robots">` says `noindex` and whose response's `cache-control` has `no-store`; a signed-out request for `/studio/preview/{id}/en` lands on sign-in; switching to Arabic reloads the frames right-to-left.
- [ ] **Step 3: Run, expect FAIL. Step 4: Move the Studio's root layout into `(studio)`, add the preview root layout and page, build the workspace layout and the Preview tab.**
- [ ] **Step 5: Run `npm test`, then the whole e2e suite** (the move must not change any Studio page). Expected: PASS.
- [ ] **Step 6: Commit** (`feat(studio): the menu workspace frame, publish bar and draft preview`).

---

### Task 9: Content: categories and products (actions and queries)

**Files:**
- Create: `src/server/studio/services/content.ts`, `src/server/studio/actions/content.ts`, `src/server/studio/queries/content.ts`
- Modify: `src/server/domain/audit-actions.ts`, Studio messages (`error` and `activity` keys only)
- Test: `tests/studio/content.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Consumes: `editDraft`, `canonicalSet`, `canonicalStrings`, `DIETARY_TAGS`, `BADGES` (Task 1); `updateWithVersion`; `suggestSlug`.
- Produces (all menu targets, all through `editDraft`):
  - Text inputs: `names = { en?: string; ar?: string; ckb?: string }` (trimmed, at most 120 characters), descriptions at most 1,000.
  - `content.createCategory({ menuId, names, slug? })` (`content.edit`) → `{ categoryId }` (slug from the English name, made unique in the menu with `-2`, `-3`, …; last in order).
  - `content.updateCategory({ menuId, categoryId, version, names, slug, isActive })` (`content.edit`; a taken slug is `INVALID` with `fields.slug`).
  - `content.deleteCategory({ menuId, categoryId, version })` (`content.edit`; `INVALID` while it has products).
  - `content.reorderCategories({ menuId, order: string[] })` (`content.edit`; `order` must be exactly the menu's category ids; sets `sortOrder` to the index; versions stay).
  - `content.createProduct({ menuId, categoryId, names, price })` (`content.edit`) → `{ productId }` (slug as for categories; last in its category).
  - `content.saveProduct(input: ProductSave)` (`content.edit`) → `{ version: number; variants: Array<{ id; version }>; groups: Array<{ id; version; options: Array<{ id; version }> }> }` with `ProductSave = { menuId; productId; version; slug; categoryId; names; descriptions; ingredients?: Partial<Record<Locale, string[]>>; price: number; isSignature; isFeatured; allergens: string[]; dietary: DietaryTag[]; badges: Badge[]; calories: number | null /* 0 to 20,000 */; media: Array<{ kind: 'asset'; assetId: string } | MediaItem>; variants: Array<{ id?: string; version?: number; names; priceDelta: number; isDefault: boolean }>; groups: Array<{ id?: string; version?: number; names; minSelect: number; maxSelect: number; options: Array<{ id?: string; version?: number; names; priceDelta: number; isSuggested: boolean }> }> }`. Product fields not in `ProductSave` (popularity, priority, cost, dayparts, slot, stock settings) and `ingredients` when absent are left as they are. Rules: with variants, exactly one is the default and no variant's price (base plus delta) is below zero; `0 ≤ minSelect ≤ maxSelect ≤ options.length` and `maxSelect ≥ 1`; child ids must be this product's (else `NOT_FOUND`); every changed row is saved with its own version; children missing from the input are deleted, except a variant a bundle uses (`INVALID`); `sortOrder` follows the input order; asset ids must be the restaurant's or shared (else `NOT_FOUND`, nothing written); a change to `price`, any `priceDelta`, or a new variant or option with a non-zero delta needs `content.prices` (`FORBIDDEN`). Audit `product.updated` with the changed fields (prices before and after).
  - `content.deleteProduct({ menuId, productId, version })` (`content.edit`; `INVALID` while a bundle contains it).
  - `content.moveProduct({ menuId, productId, categoryId, index })` (`content.edit`; renumbers both categories; versions stay).
  - Queries (`content.edit`): `content.tree({ menuId })` → `{ locales; defaultLocale; currency; numeralSystem; categories: Array<{ id; slug; version; names; isActive; missing: Locale[]; products: Array<{ id; slug; version; names; price; isAvailable; isHidden; isSignature; isFeatured; badges; thumbUrl: string | null; missing: Locale[] }> }> }`; `content.product({ menuId, productId })` → everything `ProductSave` holds plus `thumbUrl` per media entry and `missing` per text field.
  - Audit names `category.created`, `category.updated`, `category.deleted`, `category.reordered`, `product.created`, `product.updated`, `product.deleted`, `product.moved`; entity types `Category`, `Product`, `ProductVariant`, `ModifierGroup`, `ModifierOption`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/studio/content.test.ts
it('gives two categories called "Hot drinks" the slugs hot-drinks and hot-drinks-2', ...);
it('saves a product with sizes and option groups and keeps the draft hash current', async () => {
  // … saveProduct …
  expect((await menuRow()).draftHash).toBe(snapshotHash(await loadDraftSnapshot(prisma, menuId)));
});
it('refuses a stale save and names who changed the product', ...); // CONFLICT, fields.changedBy = 'Alpha Owner'
it('refuses a stale save after a bulk write moved the version', ...); // bump with a direct versioned update, then save → CONFLICT
it('refuses a price change without content.prices but saves the names', ...);
it('writes dietary tags, badges and allergens in canonical order', async () => {
  // save ['VEGAN', 'VEGETARIAN'], note draftHash; save ['VEGETARIAN', 'VEGAN'] → same draftHash
});
it("refuses another restaurant's asset in the media list and writes nothing", ...);
it('refuses a group whose minimum exceeds its options', ...); // fields['groups.0.minSelect']
it('refuses two default sizes, and a size priced below zero', ...);
it('deletes sizes left out of the save, but not one a bundle uses', ...);
it('refuses to delete a category with products', ...);
it('moves a product to another category at a position', ...);
it('reorders categories only with the complete list of ids', ...);
it('changes nothing guests see until publish', ...);
```

Sweep: every `content.*` definition with B's menu, and with A's menu and B's category, product, variant or asset id inside.

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): edit categories and products with sizes, options, tags and images`).

---

### Task 10: The Content tab

**Files:**
- Create: `src/app/studio/_actions/content.ts`, `src/studio/workspace/content/` (`CategoryTree.tsx`, `ProductList.tsx`, `ProductDrawer.tsx`, `TranslationFields.tsx`, `VariantsEditor.tsx`, `GroupsEditor.tsx`, `TagFields.tsx`), `src/studio/media/MediaPicker.tsx`, `tests/e2e/fixtures/lemon.png`
- Modify: `src/app/studio/(studio)/(app)/menus/[id]/page.tsx` (becomes Content), `src/studio/workspace/tabs.ts` (built: content), `package.json` (dnd-kit), Studio messages
- Test: `tests/e2e/studio-content.spec.ts`

**Interfaces:**
- Consumes: Task 9 actions and queries; `uploadMedia`, `media.list` (Task 6); `parsePriceInput`, `formatPriceInput` (Task 2).
- Produces:
  - Content page: the category tree (sortable with dnd-kit's pointer and keyboard sensors, plus Move up and Move down in each row's menu), per category its products with thumbnail, price, flags, badges and a marker for missing translations; Add category and Add product dialogs; inactive categories shown dimmed.
  - `ProductDrawer` (a Radix dialog as a side sheet, focus trapped, Escape closes after a discard confirmation when dirty): names and descriptions in the three languages side by side (Arabic and Sorani inputs `dir="rtl"`, `lang`, Arabic-script font), price (disabled without `content.prices`), sizes, option groups with minimum and maximum, images (`MediaPicker` over the restaurant's and shared libraries, or upload in place with progress and alt text per language), allergens (free chips), dietary tags, calories, badges, signature and featured switches; Save shows a conflict with the other person's name and a Reload button.
  - 2a's Live version and Issues sections leave the page (the bar and header carry them since Task 8).

- [ ] **Step 1: Write the failing e2e test** (`@desktop`, a temporary menu): add category "Cold drinks", add product "Lemonade" at 3.50; in the drawer fill the Arabic and Sorani names (the inputs are right-to-left), add size "Large" at +1.00, save; reorder categories with the keyboard (focus the handle, Space, ArrowUp, Space) and see the order after reload; upload `lemon.png` in the drawer and see its thumbnail in the list; the bar shows unpublished changes; a second browser context saves the same product first, and the first save shows the conflict with that person's name; axe passes on the tab and the drawer in `ar`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (install dnd-kit; use `impeccable` for the tree and the drawer). **Step 4: Run the spec and the Studio e2e suites.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): the Content tab with a sortable category tree and the product drawer`).

---

### Task 11: Availability

**Files:**
- Create: `src/server/studio/actions/availability.ts`, `src/server/studio/queries/availability.ts`, `src/app/studio/_actions/availability.ts`, `src/app/studio/(studio)/(app)/menus/[id]/availability/page.tsx`, `src/studio/workspace/AvailabilityBoard.tsx`
- Modify: `tabs.ts` (built: availability), audit actions, Studio messages
- Test: `tests/studio/availability.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Produces:
  - `availability.setProduct({ menuId, productId, isAvailable?: boolean, isHidden?: boolean })` and `availability.setOption({ menuId, optionId, isAvailable: boolean })` (`content.availability`): one `updateMany` on the row by id, no version change, no draft hash refresh (live fields are not in the snapshot), `expireLive(menuId)` after commit. Audit `product.availability_changed`, `option.availability_changed`.
  - `availability.board({ menuId })` (`content.availability`) → categories with products (`isAvailable`, `isHidden`) and their groups and options (`isAvailable`).
  - The tab: a banner that these changes are live at once, a Sold out and a Hidden switch per product, a Sold out switch per option, a filter for sold-out or hidden items; a switch updates at once and reverts with a message when the action fails.

- [ ] **Step 1: Write the failing tests:** marking a product sold out shows at once through `getCatalog(await getTenant(slug))` with no publish; hiding removes it from the public catalog; `Menu.draftHash` and the product's `version` are unchanged; an option marked sold out shows unavailable; the owner of A may, and the sweep refuses B's product and B's option inside A's menu.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): live sold-out and hidden switches`).

---

### Task 12: Prices and bulk price changes

**Files:**
- Create: `src/server/domain/bulk-prices.ts`, `src/server/studio/actions/prices.ts`, `src/server/studio/queries/prices.ts`, `src/app/studio/_actions/prices.ts`, `src/app/studio/(studio)/(app)/menus/[id]/prices/page.tsx`, `src/studio/workspace/PriceGrid.tsx`, `BulkPriceDialog.tsx`; migration `<timestamp>_menu_price_step`
- Modify: `prisma/schema.prisma` (`Menu.priceStep Int?`), `tabs.ts` (built: prices), audit actions, Studio messages
- Test: `tests/domain/bulk-prices.test.ts`, `tests/studio/prices.test.ts`, `tests/studio/cross-tenant.test.ts`, `tests/e2e/studio-prices.spec.ts`

**Interfaces:**
- Consumes: `roundToStep`, `defaultPriceStep`, `parsePriceInput` (Task 2); `editDraft`.
- Produces:
  - `type BulkOperation = { kind: 'set'; amount: number } | { kind: 'add'; amount: number /* minor units, may be negative */ } | { kind: 'percent'; basisPoints: number /* 750 is +7.5% */ }`.
  - `interface PriceRow { productId: string; variantId: string | null; oldPrice: number; newPrice: number; problem?: 'NOT_POSITIVE' }`.
  - `planBulkPrices(products: ReadonlyArray<{ id: string; basePrice: number; variants: ReadonlyArray<{ id: string; priceDelta: number }> }>, op: BulkOperation, o: { includeVariants: boolean; step: number }): { rows: PriceRow[]; products: Array<{ id: string; basePrice: number }>; variants: Array<{ id: string; priceDelta: number }> }` (refinement 7: the base is `op` applied, rounded unless `set`; with variants included each variant's own price (base plus delta) is `op` applied and its delta is that minus the new base; otherwise deltas stay; rows hold every base and variant price, old and new; only changed rows appear in `products` and `variants`).
  - `menuPriceStep(menu: { priceStep: number | null; currency: string }): number`.
  - `prices.set({ menuId, target: { kind: 'product' | 'variant'; id: string; version: number }, price: number })` (`content.prices`; a variant's price is its own price, stored as the delta from the base).
  - `prices.previewBulk({ menuId, selection: { productIds?: string[]; categoryId?: string }, operation: BulkOperation, includeVariants: boolean })` (query, `prices.bulk`) → `{ rows: Array<PriceRow & { name: string; variantName: string | null }>; step: number; draftHash: string }`.
  - `prices.applyBulk({ …same, expectedDraftHash: string })` (`prices.bulk`): recomputes in the transaction, `CONFLICT` when the draft hash moved since the preview, `INVALID` when any row has a problem, moves the version of every changed row. Audit `prices.bulk_changed` (operation and count); `price.changed` for `prices.set`.
  - `prices.grid({ menuId })` (query, `content.prices`) → categories with products (base price, version) and variants (own price, version).
  - The tab: TanStack table with a row per product and per size, inline editing (Enter saves, Escape cancels, a conflict reloads the row), a category filter, row selection, and the Bulk change dialog (operation, amount or percentage, include sizes, preview of every old and new price with problems, Apply).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/bulk-prices.test.ts
const usd = { includeVariants: false, step: 5 };
it('adds 7.5% and rounds to the step', () =>
  expect(plan([{ id: 'p', basePrice: 455, variants: [] }], { kind: 'percent', basisPoints: 750 }, usd).products).toEqual([{ id: 'p', basePrice: 490 }]));
it('rounds IQD to 250', () => expect(base(6000, { kind: 'percent', basisPoints: 1000 }, 250)).toBe(6500));
it('keeps 6,750 for +12.5% on 6,000 IQD', () => expect(base(6000, { kind: 'percent', basisPoints: 1250 }, 250)).toBe(6750));
it('moves sizes with the base when they are not included', ...); // 450 / +100, add 50 → base 500, delta 100
it('raises sizes by their own price when included', ...);         // 450 / +100, +10% → base 495 (step 5), size 605, delta 110
it('sets every included price to the typed amount as it is', ...); // set 499 → base 499, size 499, delta 0
it('flags a price that would fall to zero or below', ...);         // 450 − 500 → NOT_POSITIVE
```

```ts
// tests/studio/prices.test.ts
it('applies a bulk change in one transaction and moves every changed version', ...);
it('refuses an editor saved after the bulk change', ...); // saveProduct with the pre-bulk version → CONFLICT
it('refuses to apply when the draft changed after the preview', ...);
it('refuses the whole change when one price would be zero', ...);
it('stores a size price as its difference from the base', ...);
```

`studio-prices.spec.ts`: on a temporary menu, edit a price inline and see it after reload; select a category, add 10%, see the preview, apply, and see the new prices.

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (migration for `priceStep`; sweep entries). **Step 4: Run `npm test` and the spec.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): the Prices tab with inline editing and bulk changes rounded to the menu's step`).

---

### Task 13: The Settings tab and SEO

**Files:**
- Create: `src/app/studio/(studio)/(app)/menus/[id]/settings/page.tsx`, `src/studio/workspace/SettingsForm.tsx`
- Modify: `src/server/studio/actions/menus.ts` (`updateSettings`), `src/server/studio/queries/menus.ts` (`settings`), `src/server/publish/draft.ts` (`seoMap` reads `imageAssetId`), `src/app/[tenant]/[locale]/layout.tsx` (Open Graph image), `tabs.ts` (built: settings), audit actions, Studio messages
- Test: `tests/studio/menu-settings.test.ts`, `tests/server/seo.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Consumes: `canonicalSet`, `rescaleMinor`, `minorUnitDigits`, `editDraft`; `loadAssets`, `assetImage` (Task 6).
- Produces:
  - `Menu.seo` per language holds `{ title: string /* ≤ 70 */; description: string /* ≤ 200 */; imageAssetId?: string }`; the snapshot's `seo[locale].image` is resolved from it.
  - `menus.updateSettings({ menuId, version, name, locales, defaultLocale, currency, confirmCurrencyChange?: boolean, timezone, numeralSystem, seo, notes, priceStep: number | null })` (`menu.settings`, through `editDraft` and `updateWithVersion` on `Menu`): `locales` stored with `canonicalSet`; `defaultLocale` must be one of them (`INVALID`, `fields.defaultLocale`); a currency whose minor digits differ needs `confirmCurrencyChange` (`INVALID`, `fields.currency`) and then rescales `Product.basePrice` and `cost`, `ProductVariant.priceDelta` and `costDelta`, `ModifierOption.priceDelta` and `costDelta`, `Bundle.price` and `Menu.priceStep` with `rescaleMinor`, moving those rows' versions; SEO images must be the restaurant's or shared. Returns `{ version, rescaled: number }`. Audit `menu.settings_changed`.
  - `menus.settings({ menuId })` (query, `menu.settings`) → current values, the slug, former slugs, `defaultStep`, SEO images' thumbnails.
  - The public layout adds `openGraph.images` with the SEO image of the page's language when set (the generated default arrives in Task 14).
  - The tab: name; address (2a's slug dialog); languages and default; currency with a confirmation that shows an example ("6,000 USD becomes 6,000 IQD"); numerals; time zone; rounding step (placeholder: the currency default); SEO per enabled language with counters and an image picker; notes; conflict handling.

- [ ] **Step 1: Write the failing tests:** locales sent as `['ckb', 'en']` are stored `['en', 'ckb']`; a default language outside them is refused; USD to IQD without confirmation is refused and with it turns 450 into 5 and a size delta of 150 into 2; IQD to USD turns 6000 into 600000; an editor opened before the currency change is refused (`CONFLICT`); the SEO title and image appear in the draft snapshot and, after publish, in the page's metadata; another restaurant's image is `NOT_FOUND`; removing a language keeps its translations in the rows.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): menu settings with languages, currency, rounding step and SEO`).

---

### Task 14: The brand kit: data, fonts and what guests see

**Files:**
- Create: `src/server/studio/services/brand.ts`, `src/server/studio/actions/brand.ts`, `src/server/studio/queries/brand.ts`, `src/app/api/[tenant]/social-image/route.ts`; migration `<timestamp>_brand_kit`
- Modify: `prisma/schema.prisma`, `src/lib/font-pairs.ts`, `src/app/fonts.ts`, `src/app/globals.css`, `src/server/publish/draft.ts` (`brandView`, `brandRowFromSnapshot`), `src/server/studio/actions/menus.ts` (`createMenu` takes the restaurant logo), `src/server/studio/actions/restaurants.ts` (`logoAssetId`), `src/app/studio/(studio)/(app)/restaurants/RestaurantForm.tsx` (logo picker), `src/app/[tenant]/[locale]/layout.tsx`, `src/app/studio/(preview)/preview/[menuId]/[locale]/layout.tsx` (the draft's pair), `src/ui/menu/Header.tsx`, `src/ui/AppProviders.tsx`, `src/server/media/usage.ts`, `package.json` (fontsource faces)
- Test: `tests/studio/brand.test.ts`, `tests/lib/font-pairs.test.ts`, `tests/api/social-image.test.ts`, `tests/publish/draft.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Consumes: `paletteProblems`, `dominantColors`, `suggestPalettes`, `BRAND_PRESETS` (Task 2); `BrandImage`, `BrandFavicon` (Task 3); `faviconFiles`, `getStorage` (Tasks 4 and 5); `loadAssets`, `assetImage`, `assetUsage` (Task 6); `editDraft`.
- Produces:
  - Prisma: `BrandConfig` gains `logoAssetId String?`, `logoDarkAssetId String?`, `faviconAssetId String?`, `faviconFromLogo Boolean @default(false)`, `fontPairId String @default("classic")`, `version Int @default(1)`; `Restaurant` gains `logoAssetId String?`.
  - `FONT_PAIRS: Record<FontPairId, { label: string; display: string; text: string; arabic: string }>` (family names). Faces, all at weight 400 (sizes are the measured `latin` and `arabic` 400 files):

    | Pair | Display (Latin) | Text (Latin) | English total | Arabic script |
    |---|---|---|---|---|
    | classic | Bodoni Moda (the bundled file) | Hanken Grotesk | 40 KB | Noto Naskh Arabic, 51 KB |
    | cafe | Fraunces | DM Sans | 31 KB | Vazirmatn, 21 KB |
    | bakery | Playfair Display | Nunito Sans | 35 KB | Noto Naskh Arabic, 51 KB |
    | street | Anton | Inter | 41 KB | Noto Kufi Arabic, 43 KB |
    | fine | Cormorant Garamond | Jost | 32 KB | Noto Naskh Arabic, 51 KB |
    | modern | Space Grotesk | Inter | 36 KB | IBM Plex Sans Arabic, 42 KB |

    `classic` keeps its current faces untouched (the 2a font tests stay as they are). The others load with `next/font/local` from `node_modules/@fontsource/<family>/files/<family>-<subset>-400-normal.woff2`, `preload: false`, `display: 'swap'`. Packages: `@fontsource/{fraunces,dm-sans,vazirmatn,playfair-display,nunito-sans,anton,inter,noto-kufi-arabic,cormorant-garamond,jost,space-grotesk,ibm-plex-sans-arabic}@5.3.0`; dev `@fontsource/noto-naskh-arabic@5.3.0` and `@fontsource/hanken-grotesk@5.3.0`, read only by the coverage and budget test for the Google-hosted classic faces. Cairo was measured and is excluded: its Arabic file lacks ڕ ڵ ۆ ێ ە.
  - `fontVariablesFor(locale: Locale | null, pair: FontPairId = 'classic'): string` (the variables of the pair's faces for the locale's script only, plus the class `font-pair-{pair}`); `globals.css` sets `--font-display-stack` and `--font-text-stack` per pair class and script.
  - `brandView` in `draft.ts` emits `fontPairId` (not for classic), `railChoice` (motion `none` and a stored style other than plain), `logo`, `logoDark` (resolved `BrandImage`s; `rasterKey` is the `webp-640` key, or the largest WebP), and `favicon` (the uploaded favicon asset's, or with `faviconFromLogo` the logo's, `variants.favicon`).
  - `brandRowFromSnapshot(brand: BrandView, assetMap?: ReadonlyMap<string, string>)` → the `BrandConfig` fields (`railStyle = railChoice ?? railStyle`, `fontPairId ?? 'classic'`, asset ids through the map, `faviconFromLogo = favicon.assetId === logo.assetId`); `writeDraftFromSnapshot` uses it (so a duplicate keeps the rail choice when motion is off).
  - `brand.update({ menuId, version, theme: 'light' | 'dark', palette: Palette, logoAssetId: string | null, logoDarkAssetId: string | null, favicon: { kind: 'none' } | { kind: 'fromLogo' } | { kind: 'asset'; assetId: string }, fontPairId, railStyle, motionIntensity, logoText })` (`brand.edit`, through `editDraft`): the palette replaces `tokens[theme]`; blocking problems refuse with `INVALID`, `fields.palette` and the problems in the message's `fields` (`palette.text/bg = '3.10'`); assets must be the restaurant's or shared; `fromLogo` first makes sure the logo asset has `variants.favicon` (renders and stores the three PNGs, updates the asset's variants); returns `{ version, warnings: PaletteProblem[] }`. Audit `brand.updated`; entity `BrandConfig`.
  - `brand.get({ menuId })` (query, `brand.edit`) → the stored kit with logo and favicon thumbnails; `brand.suggestFromLogo({ menuId, assetId, theme })` (query, `brand.edit`) → three palettes from the asset's `webp-320` pixels (`sharp(...).raw()`).
  - `restaurants.update` accepts `logoAssetId` (the restaurant's own or shared asset); `createMenu` puts the restaurant's logo in the new brand kit; `assetUsage` covers the brand and restaurant columns.
  - Public pages: fonts by the brand's pair; `Header` shows the logo for the theme (`logoDark` on a dark theme when present, else `logo`) with `alt` = `logoText`, or the logo text; icons from `favicon` (32 px icon, 180 px apple icon), else today's accent mark.
  - `GET /api/{tenant}/social-image?rev={revisionId}&locale={locale}`: for the live revision only (another `rev` answers 302 to the live one); the language's SEO image answers 302 to its URL; otherwise a 1200 × 630 PNG of the theme's background with the logo (from `rasterKey`) fitted inside 600 × 300 at the centre, `cache-control` immutable; 404 without a logo. The layout's `openGraph.images` uses it when there is a logo or an SEO image.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/font-pairs.test.ts (fontkit on the fontsource files)
it.each(FONT_PAIR_IDS)('%s: the Arabic-script face has every Sorani letter', ...);
it.each(FONT_PAIR_IDS.filter((id) => id !== 'classic'))('%s: Latin faces under 45 KB, Arabic face under 70 KB', ...);
it('attaches only the pair faces of the page script', () => {
  expect(fontVariablesFor('en', 'cafe')).toContain('font-pair-cafe');
  expect(fontVariablesFor('en', 'cafe')).not.toMatch(/vazirmatn|naskh/i);
});
```

```ts
// tests/studio/brand.test.ts
it('refuses muted text below 4.5:1 on the surface and names the pair', ...);
it('saves a weak accent with a warning', ...);
it('generates the favicon from the logo at 32, 180 and 512 px', ...); // stored PNGs with those widths
it("refuses another restaurant's logo", ...);
it('suggests three palettes from a logo, each passing every pair', ...);
it('changes nothing guests see until publish, then shows the logo and the pair', ...);
it('keeps the rail choice when motion is off, in the draft and in a duplicate', ...);
it('starts a new menu with the restaurant logo', ...);
```

```ts
// tests/api/social-image.test.ts
it('draws a 1200 × 630 PNG of the logo on the theme background', ...); // corner pixel = palette bg
it('sends an old revision to the live one', ...);
it('is 404 for a menu without a logo or an SEO image', ...);
```

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (migration; install the faces; sweep entries for `brand.*`). **Step 4: Run `npm test`, `npm run build` and `npm run test:e2e -- tests/e2e/fonts.spec.ts`.** Expected: PASS (ATELIER's font downloads unchanged).
- [ ] **Step 5: Commit** (`feat(brand): logos, favicon, palettes with contrast rules, six font pairs and social images`).

---

### Task 15: The Brand tab

**Files:**
- Create: `src/app/studio/_actions/brand.ts`, `src/app/studio/(studio)/(app)/menus/[id]/brand/page.tsx`, `src/studio/workspace/brand/` (`BrandForm.tsx`, `PaletteEditor.tsx`, `ContrastBadge.tsx`, `PresetPicker.tsx`, `FontPairPicker.tsx`, `BrandSample.tsx`), `tests/e2e/fixtures/logo.png`
- Modify: `tabs.ts` (built: brand), Studio messages
- Test: `tests/e2e/studio-brand.spec.ts`

**Interfaces:**
- Consumes: Task 14 actions and queries; `paletteProblems`, `BRAND_PRESETS` (Task 2); `MediaPicker`, `uploadMedia`; `fontVariablesFor` and `FONT_PAIRS` (the Brand page attaches every pair's faces so each sample shows in its own type).
- Produces: logo (light and optional dark) and favicon choice (none, from logo, upload); presets (five, each light and dark); theme; the eight palette colours, each a hex field with a colour input, and beside each checked pair its ratio and a pass, warn or fail mark (Save is disabled while a pair fails, with the reason); "Suggest from logo" showing three palettes to apply; font pairs with a Latin and an Arabic-script sample; rail style and motion; logo text; `BrandSample` (header, rail labels, two product rows, a price and a button) drawn live from the unsaved values; Save with conflict handling and the warnings listed.

- [ ] **Step 1: Write the failing e2e test** (`@desktop`, temporary menu): apply the Coffee light preset; typing `#999999` as text disables Save and names "Text on background"; upload `logo.png`, ask for suggestions, apply the first; choose the `cafe` pair; save; the bar shows unpublished changes; publish; the public page has `data-theme="light"`, `--bg` equal to the saved background, the logo image in the header and only Fraunces and DM Sans downloaded on `/en`; axe passes on the tab in `ar`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (`impeccable`). **Step 4: Run the spec.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): the Brand tab with live contrast checks and a live sample`).

---

### Task 16: Revisions: rollback, restore to draft and scheduled publishing

**Files:**
- Create: `src/server/publish/revisions.ts`, `src/server/domain/schedule-time.ts`, `src/server/studio/actions/revisions.ts`, `src/server/studio/queries/revisions.ts`, `src/app/api/cron/publish/route.ts`
- Modify: `src/server/publish/draft.ts` (`restoreDraftFromSnapshot`), `src/server/publish/publish.ts`, `src/server/studio/actions/menus.ts` (`publish` returns the pending schedule), `src/server/studio/services/overview.ts`, `src/server/studio/queries/menus.ts` (`pendingSchedule`), `src/server/http/hosts.ts`, `vercel.json`, `prisma/schema.prisma` (`@@index([goLiveAt])` on `MenuRevision`; migration), audit actions
- Test: `tests/publish/revisions.test.ts`, `tests/domain/schedule-time.test.ts`, `tests/api/cron.test.ts`, `tests/http/hosts.test.ts`, `tests/server/vercel-config.test.ts`, `tests/studio/overview.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Consumes: `loadDraftSnapshot`, `loadOverlay`, `brandRowFromSnapshot`, `draftMediaFromSnapshot`, `snapshotAssetIds`, `expireMenu`, `cronEnv`.
- Produces:
  - `restoreDraftFromSnapshot(tx: AnyDb | ScopedTx (overloads), menuId: string, snapshot: MenuSnapshot): Promise<void>` (2a follow-ups 1 and 3): reads the live switches and versions of the current rows, deletes the draft catalog children first, recreates every row with the snapshot's own ids, carries over `isAvailable`, `isHidden` and `stockCount` (options: `isAvailable`) of ids that existed, sets every version to the old one plus one (new rows 1), writes media with `draftMediaFromSnapshot`, the brand with `brandRowFromSnapshot`, and the menu's `currency`, `defaultLocale`, `locales`, `timezone`, `numeralSystem`, `engineConfig` and `seo` (with image asset ids) from `snapshot.menu`; leaves tables, name, slug, notes and `priceStep`; refreshes the draft hash.
  - `class RevisionError extends Error { code: 'ARCHIVED' | 'NOT_FOUND' | 'NOT_LIVE_BEFORE' | 'ALREADY_LIVE' | 'PENDING_EXISTS' | 'TOO_SOON' | 'TOO_FAR'; pending?: { number: number; goLiveAt: Date } }`.
  - `rollbackMenu(tx, { menuId, revisionId }): Promise<{ number: number }>` (takes the menu row like `publishMenu`; the revision must be the menu's, have `wentLiveAt` and not be live; sets `liveRevisionId` and `liveHash`; copies nothing).
  - `scheduleRevision(tx, { menuId, actorId, goLiveAt: Date, note?: string, replacePending: boolean, now: Date }): Promise<PublishOutcome>` (`goLiveAt` at least 60 s and at most 366 days after `now`; one pending revision per menu (a second one without `replacePending` throws `PENDING_EXISTS`; with it the first gets `cancelledAt`); the draft is validated as for a publish; creates revision `max + 1` with `goLiveAt`, `snapshotHash` and `assetIds`, `wentLiveAt` null; the live pointer, `liveHash` and status stay).
  - `cancelSchedule(tx, { menuId, revisionId, now })`.
  - `activateDueRevisions(prisma: PrismaClient, now: Date): Promise<{ activated: number; cancelled: number }>`: up to 100 revisions with `goLiveAt ≤ now`, `wentLiveAt` and `cancelledAt` null, oldest first, each in its own transaction that takes the menu row, re-reads the revision and skips it if it is no longer pending; an archived menu's revision is cancelled; otherwise `liveRevisionId`, `liveHash`, `wentLiveAt = now`, DRAFT becomes PUBLISHED (SUSPENDED stays); an audit row with `actorId` null, `menu.schedule_went_live` or `menu.schedule_cancelled`; `expireMenu` after each commit.
  - `zonedLocalToUtc(local: string /* 'YYYY-MM-DDTHH:mm' */, timeZone: string): Date` (a time in a daylight-saving gap moves forward to the first valid minute; an ambiguous time takes the earlier instant) and `formatInZone(date: Date, timeZone: string, locale: Locale): string`.
  - Actions: `revisions.rollback({ menuId, revisionId })` (`publish.rollback`; audit `menu.rolled_back`; `expireMenu`); `revisions.restore({ menuId, revisionId, expectedDraftHash })` (`publish.rollback`; `CONFLICT` when the draft hash moved; audit `menu.restored_to_draft`); `revisions.schedule({ menuId, goLiveAt: string /* ISO instant */, note?, replacePending?: boolean })` (`publish.schedule`; `PENDING_EXISTS` → `CONFLICT` with `fields.pendingNumber` and `fields.pendingAt`; `TOO_SOON`/`TOO_FAR` → `INVALID` with `fields.goLiveAt`; blocked → `INVALID` with issues; audit `menu.publish_scheduled`); `revisions.cancelSchedule({ menuId, revisionId })` (`publish.schedule`; audit `menu.schedule_cancelled`). `menus.publish` returns `pendingSchedule: { number; goLiveAt } | null`.
  - Queries: `revisions.list({ menuId, page })` (`'view'`) → `{ rows: Array<{ id; number; state: 'live' | 'past' | 'scheduled' | 'cancelled'; createdAt; createdBy: string | null; note; goLiveAt; wentLiveAt; cancelledAt }>; pending; total; timezone }`; `revisions.view({ menuId, revisionId, locale })` (`'view'`) → `{ tenant; view }` of that revision (for the preview page in Task 17).
  - `overview.get` gains `scheduled: Array<{ menuId; menuName; restaurantName; number; goLiveAt }>` (the next 10 within scope); `getMenu` gains `pendingSchedule`.
  - `GET /api/cron/publish`: `Authorization: Bearer ${CRON_SECRET}` compared with `timingSafeEqual` (401 otherwise, 503 when no secret is configured); answers `{ activated, cancelled }`, `cache-control: no-store`; exports `maxDuration = 60`. `routeHost` lets `/api/cron/*` through on every host. `vercel.json` gains `"crons": [{ "path": "/api/cron/publish", "schedule": "* * * * *" }]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/publish/revisions.test.ts
it('rolls back by moving the live revision and copying nothing', ...); // revision count unchanged; guests get r1's price
it('refuses to roll back to a revision that never went live', ...);
it('restores a revision into the draft with its own ids, the live switches and its settings', async () => {
  // r1 published; then: price changed, a product added, currency settings and SEO changed, a product marked sold out
  await restore(r1);
  const draft = await loadDraftSnapshot(prisma, menuId);
  expect(draft.catalog.products.map((p) => p.id)).toEqual(r1Snapshot.catalog.products.map((p) => p.id));
  expect(snapshotHash(draft)).toBe(r1.snapshotHash);
  expect(await soldOut(productId)).toBe(true);
});
it('restores the rail choice, the logo text, the font pair and the logos', ...);
it('refuses an editor opened before the restore', ...); // saveProduct with the old version → CONFLICT
it('schedules one revision and refuses a second unless it replaces the first', ...);
it('keeps the pending schedule when publishing now', ...);
it('makes a due revision live and leaves a future one pending', ...);
it('cancels a due revision of an archived menu', ...);
it('activates a due revision once when two cron runs overlap', ...); // Promise.all → one wentLiveAt, one audit row
```

```ts
// tests/domain/schedule-time.test.ts
expect(zonedLocalToUtc('2026-11-01T09:00', 'Asia/Baghdad').toISOString()).toBe('2026-11-01T06:00:00.000Z');
expect(zonedLocalToUtc('2027-03-28T02:30', 'Europe/Berlin').toISOString()).toBe('2027-03-28T01:00:00.000Z'); // gap → 03:00 CEST
expect(zonedLocalToUtc('2026-10-25T02:30', 'Europe/Berlin').toISOString()).toBe('2026-10-25T00:30:00.000Z'); // earlier of two
```

Also: the schedule action refuses a time 30 s ahead (`TOO_SOON`) and one in the past; the cron route answers 401 without or with a wrong secret and 200 with the right one; `routeHost` passes `/api/cron/publish` on the Studio host and on an unknown host in production; `vercel.json` has the cron; the overview lists a pending schedule only within the designer's scope; the sweep covers every `revisions.*` definition with B's menu and with A's menu and B's revision id (`buildWorld` records B's published revision, and gives B a pending scheduled one so `cancelSchedule` has a target).

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(publish): rollback, restore to draft with stable ids, and scheduled publishing by cron`).

---

### Task 17: The Revisions tab, scheduling in the bar, and Overview

**Files:**
- Create: `src/app/studio/_actions/revisions.ts`, `src/app/studio/(studio)/(app)/menus/[id]/revisions/page.tsx`, `src/studio/workspace/RevisionsTable.tsx`, `ScheduleDialog.tsx`
- Modify: `WorkspaceBar.tsx` (Publish menu: "Schedule…"), the preview page (`?revision=`), `src/app/studio/(studio)/(app)/page.tsx` (Overview: upcoming publishes), `tabs.ts` (built: revisions), Studio messages, `playwright.config.ts` (`CRON_SECRET` for the web server)
- Test: `tests/e2e/studio-revisions.spec.ts`

**Interfaces:**
- Consumes: Task 16 actions and queries; `zonedLocalToUtc`, `formatInZone`.
- Produces: the history (number, state, who, when, note) with Preview, Roll back and Restore to draft per row (each confirmed; restore explains that unpublished changes are discarded and sends `expectedDraftHash`); the pending schedule with its time in the menu's time zone and Cancel; the Schedule dialog (date and time in the menu's time zone, shown by name, a note; a pending schedule asks to replace it); after Publish now with a schedule pending, the toast says the schedule stays; the Overview panel of upcoming publishes; the preview page shows a past revision with `?revision={id}`.

- [ ] **Step 1: Write the failing e2e test** (`@desktop`, temporary menu published as r1): change a price and publish (r2); roll back to r1 and see r1's price on the public page at once; restore r2 into the draft, see unpublished changes, publish (r3) and see r2's price; schedule a publish for tomorrow 09:00 menu time, see it in the tab and on Overview, cancel it; schedule again, move its `goLiveAt` into the past through the e2e database helper, call `/api/cron/publish` with the test secret and see the new price publicly.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (`impeccable`). **Step 4: Run the spec.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): the Revisions tab, scheduled publishing and upcoming publishes on Overview`).

---

### Task 18: QR codes

**Files:**
- Create: `src/server/domain/qr.ts`, `src/server/qr/render.ts`, `src/server/studio/services/qr.ts`, `src/server/studio/actions/qr.ts`, `src/server/studio/queries/qr.ts`, `src/app/studio/_actions/qr.ts`, `src/app/studio/(studio)/(app)/menus/[id]/qr/page.tsx`, `src/studio/workspace/QrCodes.tsx`; migration `<timestamp>_qr_codes`
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (`QrCode` menu-scoped), `src/server/http/schemas.ts`, `src/server/data/events.ts`, `src/ui/analytics/track.ts`, `tabs.ts` (built: qr), `package.json` (fflate; jsqr dev; fontkit to dependencies), audit actions, Studio messages
- Test: `tests/domain/qr.test.ts`, `tests/qr/render.test.ts`, `tests/studio/qr.test.ts`, `tests/api/routes.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Produces:
  - Prisma `QrCode { id; menuId; label String; tableNumber Int?; style Json @default("{}"); version Int @default(1); createdAt; menu Menu @relation(onDelete: Cascade); @@unique([menuId, tableNumber]); @@index([menuId]) }`, in `MENU_SCOPED_MODELS`.
  - `interface QrStyle { foreground: string; background: string; logo: boolean; frameText: string }` (default black on white, no logo, no frame), `parseQrStyle(json: unknown): QrStyle`, `qrStyleProblem(style: QrStyle): null | 'LOW_CONTRAST' | 'INVERTED' | 'FRAME_TOO_LONG'` (contrast at least 4.5, the foreground darker than the background, frame text at most 40 characters).
  - `qrTargetUrl(origin: string, slug: string, code: { id: string; tableNumber: number | null }): string`.
  - `qrSvg(modules: { size: number; get(x: number, y: number): boolean }, style: QrStyle, extras: { logo?: { dataUri: string; width: number; height: number }; frame?: { path: string; width: number; height: number } }): string` (quiet zone of four modules, the modules as one path, the logo centred on a background-coloured pad no wider than 20% of the code, the frame text centred below).
  - `renderQr(args: { url: string; style: QrStyle; logo: Uint8Array | null }): Promise<string>` (`QRCode.create(url, { errorCorrectionLevel: 'H' })`); `frameTextPath(text: string, sizePx: number): { path: string; width: number; height: number }` (fontkit layout with the Studio's Noto Sans Arabic file for Arabic-script text, Hanken Grotesk otherwise, right to left when the text is Arabic-script); `qrPng(svg: string, size: 512 | 1024 | 2048): Promise<Uint8Array>`; `qrZip(files: Array<{ name: string; body: Uint8Array }>): Uint8Array`.
  - Actions (`qr.manage`): `qr.create({ menuId, label, tableNumber?: number })` (creates the table row `Table {n}` when missing), `qr.createForTables({ menuId, from, to })` (1 to 999, at most 200 at once, skips tables that have a code), `qr.update({ menuId, qrCodeId, version, label, style })` (a style problem is `INVALID`), `qr.delete({ menuId, qrCodeId })`, `qr.download({ menuId, qrCodeId, format: 'svg' | 'png', size?: 512 | 1024 | 2048 })` → `{ url }`, `qr.downloadTables({ menuId })` → `{ url }` (ZIP of an SVG and a 1024 px PNG per table code and `codes.csv`; file names `{slug}-table-{n}.svg`). Downloads go to `exportKey` and a 300 s signed link. The logo is the brand's (`rasterKey`). Audit `qr.created`, `qr.updated`, `qr.deleted`; entity `QrCode`.
  - `qr.list({ menuId })` (query, `qr.manage`) → codes with style, target URL, inline SVG and `scans30d` (`MENU_VIEW` events with the code's id in 30 days).
  - Scans: the events request accepts `qrCodeId` (≤ 64 characters) on `MENU_VIEW`; `recordEvents` keeps it, with `source: 'qr'`, only for a code of that menu; `track.ts` reads `qr` from the address on the first menu view, sends it, then removes it with `history.replaceState`, keeping the other parameters.
  - The tab: codes for the menu and for tables, the preview, style controls with the contrast check, Download SVG or PNG 512/1024/2048, Download all table codes, scans per code.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/qr/render.test.ts (spec 16: decoded by jsqr for every style including the logo)
it.each([
  ['default', DEFAULT_STYLE, null], ['brand colours', { ...DEFAULT_STYLE, foreground: '#1B1A19', background: '#F7F5F1' }, null],
  ['logo', { ...DEFAULT_STYLE, logo: true }, LOGO_PNG], ['Latin frame', { ...DEFAULT_STYLE, frameText: 'Scan for the menu' }, null],
  ['Sorani frame', { ...DEFAULT_STYLE, frameText: 'سکان بکە بۆ مینیو' }, null], ['logo and frame', { ...DEFAULT_STYLE, logo: true, frameText: 'Menu' }, LOGO_PNG],
])('%s decodes to its URL at 512 px', async (_, style, logo) => {
  const png = await qrPng(await renderQr({ url: URL, style, logo }), 512);
  expect(decode(png)).toBe(URL);
});
it('keeps the logo within 20% of the code width', ...);
it('shapes Arabic frame text (joined forms differ from isolated ones)', ...);
it('zips an SVG and a PNG per table code with an index', ...);
```

`tests/domain/qr.test.ts`: both URL forms; `#777777` on white is `LOW_CONTRAST`, white on black `INVERTED`, a 41-character frame `FRAME_TOO_LONG`. `tests/studio/qr.test.ts`: table codes 1 to 5 create the tables; a second run skips them; the PNG behind a download link is 1024 px wide; a scan with the code's id is counted, one with another menu's code id records no `qrCodeId`; after a slug change the code's URL names the new slug and the old URL still redirects (`resolvePublicMenu`). Sweep: B's menu, and A's menu with B's code id.

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test` and `npm run test:e2e -- tests/e2e/public-urls.spec.ts`** (the `qr` parameter survives the language redirect). Expected: PASS.
- [ ] **Step 5: Commit** (`feat(qr): styled QR codes with logo and frame text, downloads, table ZIPs and scan counts`).

---

### Task 19: Import and export

**Files:**
- Create: `src/server/domain/import-sheet.ts`, `src/server/sheets/read.ts`, `src/server/sheets/write.ts`, `src/server/studio/services/imports.ts`, `src/server/studio/actions/imports.ts`, `src/server/studio/queries/imports.ts`, `src/app/studio/_actions/imports.ts`, `src/app/studio/(studio)/(app)/menus/[id]/data/page.tsx`, `src/studio/workspace/ImportExport.tsx`; migration `<timestamp>_import_jobs`
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts` (`ImportJob` menu-scoped), `tabs.ts` (built: data), `package.json` (exceljs, papaparse), audit actions, Studio messages
- Test: `tests/domain/import-sheet.test.ts`, `tests/sheets/read-write.test.ts`, `tests/studio/imports.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Produces:
  - Prisma `enum ImportStatus { PARSED APPLIED DISCARDED FAILED }`, `ImportJob { id; menuId; fileName; status ImportStatus @default(PARSED); preview Json; rowCount Int; draftHash String; hideMissing Boolean @default(false); createdById String?; appliedAt DateTime?; createdAt; @@index([menuId, createdAt]) }`, menu-scoped.
  - `SHEET_COLUMNS` (the 20 names, in order), `REQUIRED_COLUMNS = ['category_slug', 'name_en', 'price']`.
  - `readHeaders(headers: string[]): { ok: true; columns: Map<SheetColumn, number> } | { ok: false; unknown: string[]; missing: SheetColumn[]; duplicate: string[] }` (BOM and spaces trimmed, lower case, spaces and hyphens become `_`).
  - `parseSheetRow(cells: string[], columns: Map<SheetColumn, number>, ctx: { currency: string; rowNumber: number }): { ok: true; row: SheetRow } | { ok: false; errors: Array<{ column: SheetColumn; reason: string }> }` (`SheetRow` holds only the present columns; a leading `'` before `=`, `+`, `-` or `@` is removed; booleans `true/false/yes/no/1/0`, any case; lists split on `|`, trimmed; badges and dietary tags upper-cased with spaces as `_` and checked against the lists; price through `parsePriceInput`; calories 0 to 20,000; sort an integer).
  - `diffSheet(rows: Array<{ rowNumber: number; row: SheetRow } | { rowNumber: number; errors }>, draft: ImportDraft, o: { hideMissing: boolean }): ImportPreview` with `ImportDraft` the menu's categories and products (ids, slugs, names, descriptions, prices, flags, tags, calories, `isAvailable`) and `ImportPreview = { rows: Array<{ rowNumber; status: 'new' | 'changed' | 'unchanged' | 'invalid'; productId: string | null; productSlug: string; name: string; changes?: Array<{ field: string; before: unknown; after: unknown; live: boolean }>; errors?: Array<{ column; reason }> }>; newCategories: Array<{ slug; names }>; missing: Array<{ productId; slug; name }>; summary: { new; changed; unchanged; invalid; hidden } }`. Matching: `product_slug` if present (a slug not in the menu is a new product with it), else the English name within `category_slug` (trimmed, case-insensitive); a second row for one product, or one new slug twice, is invalid; a new category takes its names from the row's `category_*` columns.
  - `sheetRowsFromDraft(draft: ImportDraft): string[][]` (the header row, then a row per product in category and product order; prices with `formatPriceInput`; lists joined with `|`; a cell starting with `=`, `+`, `-` or `@` gets a leading `'`).
  - `readSheet(bytes: Uint8Array): Promise<{ headers: string[]; rows: string[][] }>` (XLSX by its zip signature, first worksheet, every cell as its displayed text; otherwise CSV: UTF-8 with or without BOM, refused as `ENCODING` when the bytes are not valid UTF-8, delimiter detected among `,`, `;` and tab; `TOO_MANY_ROWS` beyond 2,000 data rows) and `writeCsv(rows: string[][]): Uint8Array` (UTF-8 with BOM, CRLF, RFC 4180 quoting), `writeXlsx(rows: string[][]): Promise<Uint8Array>` (every column formatted as text, bold header).
  - Actions (`import.run`): `import.requestUpload({ menuId, fileName, bytes })` (CSV or XLSX by name, at most 5 MB) → presigned PUT to `importKey`; `import.parse({ menuId, uploadKey, fileName, hideMissing })` → `{ importJobId, preview }` (reads at most 5 MB, deletes the upload, stores the job with the menu's `draftHash`; header or file problems answer `INVALID` naming the columns or the reason); `import.apply({ menuId, importJobId })` (the job must be PARSED and the draft hash unchanged, else `CONFLICT`; writes new categories and products and changed fields through `editDraft`, moving the versions of changed rows; the live changes (`available`, hidden for missing products) only with `content.availability` (else left out and reported), then `expireLive`; status APPLIED; audit `menu.imported` with the summary); `import.discard({ menuId, importJobId })`. `export.download({ menuId, format: 'csv' | 'xlsx' })` (`export.run`) → `{ url }` of `{slug}-menu.csv` or `.xlsx` under `exportKey`; audit `menu.exported`. Entity `ImportJob`.
  - `import.job({ menuId, importJobId })` (query, `import.run`).
  - The tab: Export (CSV, Excel), a template (the header row only), Import (file drop or picker, "hide products not in the sheet", progress), the preview with status filters, each changed field old and new, invalid reasons, a "Live now" list and the missing products; Apply and Discard.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/import-sheet.test.ts
it('matches by product_slug, then by English name within the category', ...);
it('classifies new, changed (field by field), unchanged and invalid rows', ...);
it.each([['6,000', 'IQD', 6000], ['٦٠٠٠', 'IQD', 6000], ['4,50', 'USD', 450]])('reads the price %s %s', ...);
it('removes the export escape from a name that starts with =', ...);
it('accepts headers in any case and with spaces, and names unknown and missing ones', ...);
it('refuses an unknown badge with its value and row', ...);
it('leaves a column the sheet lacks unchanged', ...);
it('lists products missing from the sheet and hides them only when asked', ...);
```

```ts
// tests/sheets/read-write.test.ts
it('reads a CSV with and without BOM, and with semicolons', ...);
it('refuses a Windows-1256 CSV and says to save it as CSV UTF-8', ...);
it('refuses more than 2,000 rows', ...);
it('reads the first worksheet of an XLSX, numbers and text alike', ...);
it('round-trips Arabic, Sorani and formula-like text through CSV and XLSX', ...);
```

```ts
// tests/studio/imports.test.ts
it.each(['csv', 'xlsx'])('exports the ATELIER draft as %s and imports it back with nothing changed', ...); // spec 13.3
it('applies an import in one transaction and shows guests nothing until publish', ...);
it('refuses to apply a preview after the draft changed', ...);
it('refuses an editor opened before the import', ...); // CONFLICT on the changed product
it('applies the available column live only with content.availability', ...);
it("refuses another menu's upload key", ...);
```

Sweep: B's menu, and A's menu with B's job id or upload key.

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): spreadsheet import with a preview and export in the same format`).

---

### Task 20: The media library

**Files:**
- Create: `src/app/studio/(studio)/(app)/media/page.tsx`, `src/app/studio/(studio)/(app)/restaurants/[id]/media/page.tsx`, `src/studio/media/` (`MediaLibrary.tsx`, `MediaGrid.tsx`, `MediaDetails.tsx`, `DropZone.tsx`), `tests/e2e/fixtures/evil.svg`, `tests/e2e/fixtures/anim.gif`
- Modify: `src/studio/nav.ts` (`media`), `src/app/studio/(studio)/(app)/restaurants/[id]/layout.tsx` (Media tab), `src/server/studio/services/overview.ts` (`storageBytes`), Studio messages
- Test: `tests/studio/nav.test.ts`, `tests/studio/overview.test.ts`, `tests/e2e/studio-media.spec.ts`

**Interfaces:**
- Consumes: Task 6 actions and queries, `uploadMedia`.
- Produces: `NavKey` gains `media` (`/studio/media`; Super Admins and designers, refinement 20); the page lists the restaurants the person can manage plus the shared library (editable by Super Admins, read-only to designers); the restaurant Media tab (`media.manage`) shows that library; both have folders, tags, search, a grid with thumbnails, a drop zone for several files with progress and a per-file reason on refusal, and a details panel (preview, type, size, dimensions, alt per language, folder, tags, where used with links, Delete, refused while used); `overview.get` gains `storageBytes` (the sum of `storedBytes` within scope), shown on Overview and on the restaurant Media tab.

- [ ] **Step 1: Write the failing tests:** `visibleNav` shows Media to a Super Admin and a designer and not to an owner; the overview's `storageBytes` counts only the designer's restaurants; `studio-media.spec.ts` (`@desktop`): a designer drops two PNGs into ATELIER's library, sets an Arabic alt text, moves one to the folder "Drinks" and filters by it; `evil.svg` is stored and the file served has no `<script>`; `anim.gif` is refused with the type message; deleting an image a product uses is refused and the usage links to the product's menu.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** (`impeccable`). **Step 4: Run `npm test` and the spec.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(studio): the media library with folders, tags, usage and storage used`).

---

### Task 21: Two new demo restaurants

**Files:**
- Create: `prisma/seed/riverlight.ts`, `prisma/seed/hot-brick.ts`
- Modify: `prisma/seed.ts`, `prisma/seed/apply.ts` (brand `fontPairId`), `prisma/seed/atelier.ts` (the `SeedData` brand type gains `fontPairId`), `tests/e2e/fonts.spec.ts`, `README.md` (demo menus)
- Test: `tests/seed/demo-menus.test.ts`, `tests/e2e/fonts.spec.ts`, `tests/e2e/demo-menus.spec.ts`

**Interfaces:**
- Consumes: `SeedData`, `seedMenu`, `assertSeedValid`, `publishMenu`; `BRAND_PRESETS`; `FONT_PAIRS`.
- Produces:
  - **Riverlight Coffee** (fictional; restaurant type CAFE, Erbil, Iraq), menu `riverlight`, USD, languages `en`, `ar`, `ckb`, default `en`: about 12 products in three categories (espresso bar, slow coffee and tea, bakery), sizes on the milk drinks, dietary tags and badges where true; brand: the Coffee light preset, theme light, pair `cafe`, rail `drum`, motion subtle.
  - **Hot Brick Burgers** (fictional; FAST_FOOD, Sulaymaniyah, Iraq), menu `hot-brick`, IQD (prices multiples of 250, such as 9,000), languages `ckb`, `ar`, `en`, default `ckb`: about 12 products (burgers, sides, drinks) with an extras group (cheese +1,000, patty +3,000) and fries sizes; brand: the Fast food dark preset, theme dark, pair `street`, rail `flap`, motion expressive.
  - Product media are `art` entries (no binary files in the repository). Arabic and Sorani texts are machine-drafted; each file's header says so, as `atelier.ts` does.
  - `prisma/seed.ts` seeds ATELIER, then the two, each under its own restaurant found or created by name and guarded by `checkSlugIsOurs`, each published (note `Seed`).

- [ ] **Step 1: Write the failing tests:** each seed passes `assertSeedValid`, has 10 to 14 products with every name in all three languages, publishes with no blocking issue, has a palette with no blocking pair, and (Hot Brick) only multiples of 250; `fonts.spec.ts`: `/riverlight/en` downloads only Fraunces and DM Sans under 45 KB, `/riverlight/ar` only Vazirmatn under 70 KB, `/hot-brick/en` only Anton and Inter, `/hot-brick/ckb` only Noto Kufi Arabic; `demo-menus.spec.ts`: `/riverlight` lands on `/riverlight/en` with `data-theme="light"`; `/hot-brick` with `Accept-Language: ckb` lands on `/hot-brick/ckb` (and with `fr`, on its default, also `ckb`) with `data-theme="dark"` and prices in IQD.
- [ ] **Step 2: Run, expect FAIL. Step 3: Write the data and the seed changes. Step 4: Run `npm run db:seed`, `npm test` and the two specs.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(seed): Riverlight Coffee and Hot Brick Burgers demo menus`).

---

### Task 22: End-to-end flows and accessibility

**Files:**
- Create: `tests/e2e/studio-content-flow.spec.ts`, `tests/e2e/fixtures/e2e-grill.csv`
- Modify: `tests/e2e/studio-owner.spec.ts`, `tests/e2e/studio-a11y.spec.ts`, `tests/e2e/helpers/studio.ts`

**Interfaces:**
- Consumes: everything above; the Super Admin storage state and TOTP secret from 2a's setup project.

- [ ] **Step 1: Write `studio-content-flow.spec.ts`** (spec 16): as Super Admin create restaurant "E2E Grill" (Erbil, Fast food) and menu `e2e-grill` (IQD, three languages); import `e2e-grill.csv` (12 rows with Arabic and Sorani names) and apply; on Brand apply the Fast food dark preset and the `street` pair; publish; open `/e2e-grill` and see "Smash burger" at 9,000 IQD; on Prices change it to 9,500 and publish; the same URL shows 9,500; on QR codes create table codes 1 to 3, download table 1's PNG, decode it with jsqr and open the decoded URL: it lands on `/e2e-grill/en/t/1` without `qr` in the address and the QR tab counts one scan; change the slug, open the decoded URL again and land on the new slug. Clean up in `afterAll`.
- [ ] **Step 2: Extend `studio-owner.spec.ts`:** the owner sees Content, Prices, Availability, Revisions and Preview and no Brand, Settings, QR codes or Import and export; marks an item sold out and the public page shows it sold out after a reload with no publish; Rollback, Restore and Schedule are absent on Revisions.
- [ ] **Step 3: Extend `studio-a11y.spec.ts`:** axe on every workspace tab, the product drawer, the Schedule dialog and the Media page in `en`, `ar` and `ckb` (`dir="rtl"` for the last two); the category tree reorders with the keyboard; the drawer traps focus and returns it to the product row on close.
- [ ] **Step 4: Run `npm run db:seed && npm run test:e2e`.** Expected: every public and Studio spec PASSES.
- [ ] **Step 5: Commit** (`test(e2e): spreadsheet to published menu, owner live changes, and the workspace in three languages`).

---

### Task 23: Production setup for R2 and the cron, and the README

**Files:**
- Modify: `docs/deploy/production.md`, `README.md`, `.env.example`
- Test: `tests/server/production-env.test.ts` (from Task 4), `tests/server/vercel-config.test.ts` (from Task 16)

- [ ] **Step 1: Extend `docs/deploy/production.md`** for the user to follow (they create every account and enter every secret): an R2 bucket; an API token limited to that bucket with object read and write; the custom domain `media.buzzify.me` on the bucket (R2 custom domains need the `buzzify.me` zone on Cloudflare: if its DNS is elsewhere, decide before this step); CORS on the bucket allowing `PUT` and `GET` from `https://studio.buzzify.me` with the `content-type` and `content-length` headers; lifecycle rules deleting `uploads/`, `imports/` and `exports/` after one day; the variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `MEDIA_PUBLIC_URL=https://media.buzzify.me` and `CRON_SECRET` (`openssl rand -base64 32`); Vercel Cron (Pro plan, every minute, from `vercel.json`) and how to see its runs; a check after deploy (upload a photo of about 15 MB and see it finalize within the 60 s limit, publish, open the public menu, schedule a publish two minutes ahead and watch it go live).
- [ ] **Step 2: Update the README:** what the workspace does now; media in development (`.data/media`, the dev media route); the import format with an example row; the two new demo menus; the cron route and how to trigger it locally; the machine-drafted translation notice covering the new Studio strings and the demo menus.
- [ ] **Step 3: Run `npm run typecheck && npm run lint && npm test && npm run build`.** Expected: PASS; the build needs no production secret.
- [ ] **Step 4: Commit** (`docs: R2, cron and the content workspace in the deployment guide and README`).

---

### Task 24: Final verification and performance check

**Files:**
- Create: `docs/perf/baseline-<date>-studio-core-2b.md`

- [ ] **Step 1:** `npm run db:up && npm run db:seed && npm test && npm run test:e2e && npm run test:load`. Expected: all PASS. Paste the summary lines into the commit message.
- [ ] **Step 2:** Stop the dev server, `npm run build && npm run start`, then `npm run perf` for `/atelier/en`, `/atelier/en/t/04`, `/riverlight/en` and `/hot-brick/ckb`. Record LCP, initial script, CSS bytes, font bytes and whether the HTML document fits the first round trip, against `docs/perf/baseline-2026-10-17-studio-core-2a.md`. The font pairs add `@font-face` rules to the public stylesheet: if the menu's CSS grows enough to cost a round trip, report it with the numbers (do not change the design in this task).
- [ ] **Step 3:** Time `prepareAsset` on a 15 MB, 6000 × 4000 JPEG on this machine and record it (spec 18: `sharp` against the function limit; the finalize routes allow 60 s). If it takes more than 20 s, say so in the baseline.
- [ ] **Step 4:** Search `.next/static/chunks` loaded by `/atelier/en` for `studio/ui`, `better-auth`, `@aws-sdk`, `exceljs`, `papaparse`, `dnd-kit` and `sharp`. Expected: no match.
- [ ] **Step 5: Commit** (`docs(perf): baseline after Studio Core 2b`).

Deployment itself is the user's step, following the guide; done means the section 16 flow also works on the deployed site (spec 17).

---

## Self-review notes

- **Spec coverage (section 17, 2b):** Content (Tasks 9, 10), Prices and bulk prices (12), Availability (11), Settings and SEO (13), Revisions with rollback, restore and scheduling (16, 17), Preview (8, 17), media on R2 with variants and the library (4, 5, 6, 20), brand kit with logo, favicon, palette, contrast, suggestions, presets, fonts, theme and rail (14, 15), QR codes with styles, downloads, ZIP and scan counts (18), import and export (19), the two demo restaurants (21), the load seed (2a; refinement 1). Product fields on the public menu (7). Section 16's tests: QR decoding (18), import parsing and preview (19), bulk rounding (12), palette contrast and suggestion (2), scheduling and rollback (16), the end-to-end flow (22). Brand and QR codes are tabs in spec 10.3/10.4 though section 17's list omits them; they are built (Tasks 15, 18).
- **2a follow-up preconditions:** 1 restore keeps ids (16); 2 draft-hash invariant (1, global constraint, 6, 14); 3 round-trip losses: rail choice, logo text, settings (3, 14, 16); 4 `studioRoute` Origin rule (1); 5 no dotted paths (1); 6 sweep fixtures and the comment (1, every task); 7 media copy on cross-restaurant duplicate (6); 8 canonical order of set-like lists (1, 9, 13).
- **Names used across tasks:** `editDraft`, `canonicalSet`, `canonicalStrings`, `paletteProblems`, `parsePriceInput`, `formatPriceInput`, `rescaleMinor`, `roundToStep`, `defaultPriceStep`, `FontPairId`, `BrandImage`, `BrandFavicon`, `snapshotAssetIds`, `getStorage`, `assetKey`, `uploadKey`, `importKey`, `exportKey`, `IMMUTABLE_CACHE`, `prepareAsset`, `storeAsset`, `faviconFiles`, `resolveDraftMedia`, `draftMediaFromSnapshot`, `copyAssetsForMenu`, `assetUsage`, `uploadMedia`, `WORKSPACE_TABS`, `visibleTabs`, `brandRowFromSnapshot`, `restoreDraftFromSnapshot`, `rollbackMenu`, `scheduleRevision`, `cancelSchedule`, `activateDueRevisions`, `zonedLocalToUtc`, `planBulkPrices`, `renderQr`, `qrPng`, `readSheet`, `diffSheet`.
