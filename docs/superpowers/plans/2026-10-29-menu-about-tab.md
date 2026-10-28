# Menu About Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A restaurant page inside the menu (code name `about`, guest title chosen by the restaurant, "Explore" by default) with cover, story, offers, hours and contact, gallery, written in Studio in every menu language.

**Architecture:** New tables `MenuAbout` and `AboutOffer`, read per request (not in the published snapshot) like the intro. The header gets one entry beside `GuestTools` when `tenant.extras.about` is on. The page is `/{slug}/{locale}/about`. The story is stored as a small safe block list, never HTML.

**Tech Stack:** as in `2026-10-29-menu-intro.md`. **Depends on that plan's Tasks 1 and 2** (feature key `menu.about`, `Menu.aboutEnabled`, `TenantInfo.extras`, the `src/server/domain/intro.ts` style of pure rules, the migration conventions). Build the intro plan's Tasks 1-2 first.

**Spec:** `docs/superpowers/specs/2026-10-29-menu-about-tab-design.md`.

## Global Constraints

- Same test, audit, cross-tenant, message-parity, tenant-registry and commit rules as the intro plan's Global Constraints (copy them in force: they apply here unchanged).
- The 3D Explore keeps its name, route and entitlement; this page's route is `/about`, its Studio tab key `about`, its entitlement `menu.about`.
- Guest title: `MenuAbout.titles` `{en?,ar?,ckb?}`; empty falls back to the guest message `about.title` ("Explore", "استكشف", "گەڕان").
- Story blocks: `{ type: 'heading' | 'paragraph' | 'list'; text: string | string[] }`, at most 40 blocks, 2000 characters per block; links only as `{ text, href }` inline with `https://` or `/` targets. Rendered by components, never `dangerouslySetInnerHTML`.
- An offer outside its validity window, in the menu's `timezone`, is never shown; its optional link targets a product or category of this menu only.
- The page and its entry are absent (not empty) when `extras.about` is false or nothing is filled in.

## Review Focus

- Story text with `<script>`, markdown, very long unbroken words, Arabic and Kurdish with Latin digits: rendered as plain text, wrapped, no overflow at 375 px.
- An offer that targets a product later deleted or hidden: the link drops, the card stays.
- Hours stored in `Restaurant.workingHours` empty, partly filled, or with overnight ranges ("18:00-02:00"): shown correctly or omitted, never "NaN".
- Two languages filled, a third empty: the page shows the default language's text for the missing one, never blank.
- A gallery photo that belongs to another restaurant or is a video: refused on save and skipped on render.
- Turning the tab on without any content: refused with a clear message or hidden (decide in Task 3 and test it).

---

### Task 1: Data model and rules

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts`, `tests/helpers/db.ts`
- Create: `prisma/migrations/20261029110000_menu_about/migration.sql`, `src/server/domain/about.ts`
- Test: `tests/domain/about.test.ts`, `tests/data/tenant-registry.test.ts`

**Interfaces:**
- Produces: `MenuAbout { menuId @unique, titles Json, coverAssetId String?, story Json (locale to blocks), galleryAssetIds String[], showHours Boolean @default(true), showContact Boolean @default(true) }`; `AboutOffer { id, menuId, titles Json, bodies Json, imageAssetId String?, label Json ({en?,ar?,ckb?}), startsAt DateTime?, endsAt DateTime?, sortOrder Int, active Boolean @default(true), productId String?, categoryId String? }`; in `about.ts`: `cleanStory(blocks: unknown): StoryBlock[]` (throws on invalid), `offersLiveFor(offers, now, timeZone)`, `aboutIsEmpty(about, offers)`, `hoursView(workingHours, locale)`.

- [ ] **Step 1: Write failing tests** `tests/domain/about.test.ts`: `cleanStory accepts headings, paragraphs and lists and rejects html-looking block types, 41 blocks and 2001 characters`; `cleanStory refuses a link that is not https or a path`; `offersLiveFor respects start and end in the menu's time zone and the active flag`; `aboutIsEmpty is true with no story, offers or gallery`; `hoursView formats overnight ranges and returns null for an empty week`.
- [ ] **Step 2: Run** `npx vitest run tests/domain/about.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema (both tables menu-scoped, cascade on menu delete), the migration, the registry and `resetTestData` entries, and `about.ts`; `npm run db:generate`.
- [ ] **Step 4: Run** the domain test and `tests/data/tenant-registry.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): about tables and rules`.

### Task 2: Studio actions and queries

**Files:**
- Create: `src/server/studio/actions/about.ts`, `src/server/studio/queries/about.ts`, `src/server/studio/services/about.ts`, `src/app/studio/_actions/about.ts`
- Modify: `src/server/domain/audit-actions.ts`, `tests/studio/cross-tenant.test.ts`, catalogs
- Test: `tests/studio/about.test.ts`

**Interfaces:**
- Produces (`content.edit`, menu target): `menus.setAboutEnabled`, `menus.saveAbout({menuId, titles, coverAssetId|null, story, galleryAssetIds, showHours, showContact})`, `menus.saveAboutOffer({menuId, offerId?, titles, bodies, imageAssetId|null, label, startsAt, endsAt, active, productId|null, categoryId|null})`, `menus.reorderAboutOffers`, `menus.deleteAboutOffer`; query `menus.about({menuId})`. Audit `menu.about_changed`, `menu.about_offer_changed`, entities `MenuAbout`, `AboutOffer`. Each write calls `expireMenu` after commit.
- Consumes: `cleanStory`, `loadAssets` (IMAGE only), the menu's own product and category ids.

- [ ] **Step 1: Failing tests:** `saves the page and the owner sees it back`; `refuses another restaurant's cover, gallery photo or offer target`; `refuses a video in the gallery`; `refuses invalid story blocks`; `refuses an offer that ends before it starts`; `turning it on with nothing filled in is refused` (as decided in Review Focus); `needs the plan feature`; `offers reorder and delete`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, register every definition in the cross-tenant sweep, add audit labels in the three Studio catalogs.
- [ ] **Step 4: Run** `tests/studio/about.test.ts tests/studio/cross-tenant.test.ts tests/studio/activity.test.ts tests/studio/messages.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): about page and offers actions`.

### Task 3: Public data, route and the header entry

**Files:**
- Create: `src/server/data/about.ts` (`loadAbout(route)`), `src/app/[tenant]/[locale]/about/page.tsx`
- Modify: `src/ui/guest/GuestTools.tsx`, `src/lib/messages/{en,ar,ckb}.ts` (`about.title`, `about.offers`, `about.hours`, `about.contact`, `about.gallery`, `about.until`, `about.empty`, weekday names if missing)
- Test: `tests/data/about.test.ts`, `tests/ui/guest-tools.test.ts`

**Interfaces:**
- Produces: `loadAbout(route): Promise<AboutView | null>` with `{ title, cover: ImageItem | null, story: StoryBlock[], offers: { title, body, image, label, until: Date | null, href }[], hours | null, address, contacts, gallery: ImageItem[] }`, per request, text resolved with `resolveText(map, field, locale, defaultLocale)`; the page returns the neutral not-found when `extras.about` is off or `aboutIsEmpty`. `GuestTools` renders an `AboutLink` (title from `AboutView`/tenant extras: the page title is part of `TenantInfo.extras.aboutTitle: Record<locale,string>` so the header needs no extra query; add it in Intro Task 1's `extras` shape).

- [ ] **Step 1: Failing tests:** `loadAbout resolves missing languages from the default`; `drops expired and not-yet-started offers`; `drops an offer link to a hidden or deleted product`; `returns null when off or empty`; `GuestTools shows the About link only when extras.about is on, with the restaurant's title or the default`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the loader, route (via `withPublicMenu(params, '/about', search, ...)`), and the link in `GuestTools` (both menus mount it, so one edit covers every style).
- [ ] **Step 4: Run** the new tests, `tests/lib/messages.test.ts`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(menu): about route and header entry`.

### Task 4: The page UI

**Files:**
- Create: `src/ui/about/AboutPage.tsx`, `src/ui/about/StoryBlocks.tsx`, `src/ui/about/OfferCard.tsx`, `src/ui/about/HoursTable.tsx`
- Test: `tests/ui/about.test.ts`

**Interfaces:**
- Consumes: `AboutView`, the menu's header and `CartBar` so the page feels part of the menu (use the shell `MenuApp` uses; the builder reads `src/ui/menu/MenuApp.tsx`).
- Produces: `AboutPage({ view })`: cover, story, offers as cards (label chip, "until <date>" when it ends, link into the product sheet through `/p/{slug}`), hours (today highlighted in the menu's time zone), address and contact buttons, gallery.

- [ ] **Step 1: Failing tests (static markup):** `renders story text escaped`; `renders no section for an empty part`; `renders an offer's until date in the visitor's numerals`; `marks today in the hours table`; `dir=rtl for ar and ckb`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with project tokens; verify in the browser pane at 375 px in en and ar with long text.
- [ ] **Step 4: Run** `tests/ui/about.test.ts`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(menu): about page`.

### Task 5: Studio "About" tab

**Files:**
- Create: `src/app/studio/(studio)/(app)/menus/[id]/about/page.tsx`, `src/studio/workspace/about/AboutForm.tsx`, `src/studio/workspace/about/OfferList.tsx`, `src/studio/workspace/about/StoryEditor.tsx`
- Modify: `src/studio/workspace/tabs.ts` (`'about'`, `workspace.tab.about`, `needs: ['content.edit']`), catalogs
- Test: `tests/studio/workspace-tabs.test.ts`, `tests/studio/messages.test.ts`

**Interfaces:**
- Produces: the form with a language switcher per field, the title field per language ("leave empty for Explore"), cover and gallery with `MediaPicker`, the story editor (add heading, paragraph, list; reorder; remove), the offer list with the same patterns as the intro advert list, and a preview using `AboutPage`.

- [ ] **Step 1: Failing tests:** tab registered and labelled in three catalogs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, typecheck, lint; browser pane: fill the page in two languages, switch on, open the menu, tap the header entry, see it; switch the title to "عنّا" and see it change after save.
- [ ] **Step 5: Commit** `feat(studio): about tab`.

### Task 6: Whole-feature checks

- [ ] Full suite into the scratchpad file, tail read (only the known ai-import failure allowed); `graphify update .`.
