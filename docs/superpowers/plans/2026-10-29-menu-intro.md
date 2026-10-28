# Menu Intro Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public intro page `/{slug}/intro` (background photo or video, logo, language buttons, adverts, contact icons, feedback) shown before the menu when the restaurant switches it on; choosing a language goes straight to the menu.

**Architecture:** New tables `MenuIntro` (one per menu), `IntroAdvert` (per menu), `PlatformAdvert` and `PlatformIntro` (platform-wide, global). Public pages read them per request (not from the published snapshot); only the on/off gate rides in `TenantInfo` next to `feedbackEnabled` (cached with the slug resolution, expired by `expireMenu` on every Studio write). The language choice is remembered in a cookie written by the intro's language links; `/{slug}` reads it.

**Tech Stack:** Next.js route handlers and server components, Prisma 7 (hand-written SQL migration), the Studio `defineAction`/`defineQuery` framework, the media library (`MediaPicker`, `ScenePicker`, `loadAssets`, `assetImage`, `sceneMediaOf`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-menu-intro-design.md` (the intro). Other plans that build on this one: `2026-10-29-menu-about-tab.md`, `2026-10-29-menu-wheel-of-fortune.md` (they reuse Task 1 and Task 2 here).

## Global Constraints

- Tests: `BUZZIFY_DB_PORT=54351 npx vitest run <file>` (start the DB with `npm run db:up` under the same port; never `prisma migrate deploy` by hand; `npm run db:generate` after a schema change).
- Every Studio action and query is a file under `src/server/studio/actions|queries/*.ts` and needs an entry in `tests/studio/cross-tenant.test.ts`; every audit `action: 'x.y'` (a-z and `_`, one dot) and `entityType: 'Name'` is listed in `src/server/domain/audit-actions.ts` with `activity.action.*` / `activity.entity.*` labels in en, ar, ckb; every new permission has `permission.<key>`.
- Studio words go in `src/studio/messages/{en,ar,ckb}.ts` (or an area sub-folder); guest words in `src/lib/messages/{en,ar,ckb}.ts` (parity tests enforce both). No empty strings, same placeholders.
- New models are classified exactly once in `src/server/data/tenant-db.ts` (a required `menuId` means `MENU_SCOPED_MODELS`; platform tables `GLOBAL_MODELS`) and added to `resetTestData` in `tests/helpers/db.ts`.
- Plans: the feature key is `menu.intro`; the Super Admin switches it off per restaurant through the existing per-restaurant `planExtras` override.
- A table QR (`/{slug}/t/{table}`) never goes through the intro. No sound on video, no autoplay when the visitor asks for reduced data or reduced motion (the poster shows instead).
- Right-to-left: the layout mirrors for ar and ckb. No motion added to the cashier.
- Time zone for adverts' start and end: the menu's own `timezone`.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A menu with the intro on and a visitor whose browser blocks cookies: the language links still work (links carry the language in the address); the visitor just sees the intro again next time.
- A video that is missing, still processing, or has no poster: the page falls back to the photo, then to the brand colour; the language buttons are never delayed or hidden.
- An advert whose image asset belongs to another restaurant, was deleted, or whose link is `javascript:`: it never renders (asset ownership is checked, links must be `https://` or a `/` path, see `isSafeMediaUrl`).
- Zero adverts, one advert, twenty adverts, an advert with no link, one that ends in the past, one whose window has not opened: only live ones show; the layout holds with none.
- A restaurant with one language only: the intro shows no language buttons and a single "Enter" button.
- A menu that is suspended, archived, or on a former slug: `/{slug}` and `/{slug}/intro` behave as the menu does today (404 / neutral page / permanent redirect).
- A cached `/{slug}` that sends a new visitor to the intro after the restaurant switched it off: the switch takes effect after `expireMenu`, and the intro route itself re-checks the gate (it redirects to the menu when off).

---

### Task 1: Feature key, gate flag and area

**Files:**
- Modify: `src/server/domain/entitlements.ts`, `src/server/domain/plan-choices.ts`, `src/server/data/tenant.ts`, `src/server/data/public-menu.ts` (`cachedSlugResolution` key version `'5'` to `'6'`), `src/ui/AppProviders.tsx`, `src/app/[tenant]/[locale]/layout.tsx`, `src/studio/messages/{en,ar,ckb}.ts`
- Test: `tests/domain/entitlements.test.ts` (edit the counts), `tests/data/public-menu.test.ts`, `tests/data/guest-plans.test.ts`

**Interfaces:**
- Produces: feature keys `menu.intro`, `menu.about`, `menu.wheel` (all three added here so the other plans only use them), a `FeatureArea` value `'menu'`, `GuestFeatures.intro | about | wheel: boolean`, and `TenantInfo.extras: { intro: boolean; about: boolean; wheel: boolean; aboutTitle: Record<'en'|'ar'|'ckb', string> }` (each switch is the per-menu flag AND the plan allows it; `aboutTitle` is `MenuAbout.titles`, empty strings when unset, read with the same cached slug resolution so the header needs no extra query; the table `MenuAbout` arrives in the About plan, so until then `aboutTitle` is all empty strings). `TenantClientInfo.extras` mirrors it.

- [ ] **Step 1: Write the failing tests.** In `tests/domain/entitlements.test.ts` update the live/reserved counts and the "starts each live feature" tier lists to include `menu.intro`, `menu.about`, `menu.wheel` starting at PRO. In `tests/data/public-menu.test.ts` add `it('carries the extras gate, false until the menu switches them on and the plan allows them')` using the existing menu fixture and `prisma().menu.update({ data: { introEnabled: true } })` (column added in Task 2; mark the test with the migration done first, i.e. write it in Task 2 Step 1 if the column is missing).
- [ ] **Step 2: Run to see them fail** (counts differ). Expected: FAIL on the count assertions.
- [ ] **Step 3: Implement.** Add `'menu'` to `FeatureArea` and the three entries (status `'live'`, `project: 1`, `startsIn: 'PRO'`) after the existing live ones, keeping live entries first. Extend `GuestFeatures` and `guestFeatures()`. Add `plans.area.menu` (if areas are labelled) and `plans.feature.menu.intro|about|wheel` in the three Studio catalogs. `TenantInfo.extras` is computed in `tenantInfo()`; its three switches are `Menu.introEnabled`, `Menu.aboutEnabled`, `Menu.wheelEnabled` (Task 2) combined with `guestFeatures`. Thread `extras` through `TenantClientInfo` and the layout.
- [ ] **Step 4: Run** `tests/domain/entitlements.test.ts tests/data/guest-plans.test.ts tests/studio/messages.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): feature keys and gate flags for intro, about and wheel`.

### Task 2: Data model

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/data/tenant-db.ts`, `tests/helpers/db.ts`
- Create: `prisma/migrations/20261029100000_menu_intro/migration.sql`
- Test: `tests/data/tenant-registry.test.ts` (existing; must pass), `tests/studio/intro.test.ts` (created in Task 3)

**Interfaces:**
- Produces: `Menu.introEnabled | aboutEnabled | wheelEnabled Boolean @default(false)`; `MenuIntro { menuId @unique, backgroundAssetId String?, backgroundKind 'IMAGE'|'VIDEO', overlay Int @default(50) (0 to 100), showLogo Boolean @default(true), showContact Boolean @default(true), updatedAt }`; `IntroAdvert { id, menuId, imageAssetId, alts Json ({en?,ar?,ckb?}), href String @default(""), startsAt DateTime?, endsAt DateTime?, sortOrder Int, active Boolean @default(true) }`; `PlatformAdvert { id, imageAssetId, alts Json, href, startsAt, endsAt, sortOrder, active, restaurantIds String[] (empty means every restaurant) }`; `PlatformIntro { id 'singleton', backgroundAssetId String?, backgroundKind }`. `introLiveFor(adverts, now)` pure function in `src/server/domain/intro.ts`.

- [ ] **Step 1: Write the failing test** `tests/domain/intro.test.ts`: `introLiveFor` keeps active adverts inside their window, in `sortOrder`, drops ended, not-yet-started and inactive ones, treats null bounds as open, and `safeHref('javascript:alert(1)')` is `''` while `https://x.y` and `/menu` pass.
- [ ] **Step 2: Run** `npx vitest run tests/domain/intro.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/server/domain/intro.ts` (`introLiveFor`, `safeHref`, constants), the schema and the hand-written migration (tables, `Menu` columns, FKs with `ON DELETE CASCADE` for menu-owned rows, an index on `IntroAdvert(menuId, sortOrder)`). Classify `MenuIntro` and `IntroAdvert` in `MENU_SCOPED_MODELS`, `PlatformAdvert` and `PlatformIntro` in `GLOBAL_MODELS`; add all four to `resetTestData`. Run `npm run db:generate`.
- [ ] **Step 4: Run** `tests/domain/intro.test.ts tests/data/tenant-registry.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): intro tables and live-advert rules`.

### Task 3: Studio actions and queries (restaurant side)

**Files:**
- Create: `src/server/studio/actions/intro.ts`, `src/server/studio/queries/intro.ts`, `src/server/studio/services/intro.ts`, `src/app/studio/_actions/intro.ts`
- Modify: `src/server/domain/audit-actions.ts`, `tests/studio/cross-tenant.test.ts`, catalogs for `activity.*`
- Test: `tests/studio/intro.test.ts`

**Interfaces:**
- Produces (all `permission: 'content.edit'`, `target: { kind: 'menu', menuId }`): actions `menus.setIntroEnabled({menuId, enabled})`, `menus.saveIntro({menuId, backgroundAssetId: string|null, overlay: 0..100, showLogo, showContact})`, `menus.saveIntroAdvert({menuId, advertId?, imageAssetId, alts, href, startsAt, endsAt, active})`, `menus.reorderIntroAdverts({menuId, ids})`, `menus.deleteIntroAdvert({menuId, advertId})`; query `menus.intro({menuId})` returning the intro, the adverts and the platform adverts that apply (read-only, marked `platform: true`). Each write ends with `ctx.afterCommit(() => expireMenu(slugs, menuId))` and `ctx.audit` (`menu.intro_changed`, `menu.intro_advert_changed`, entity types `MenuIntro`, `IntroAdvert`).
- Consumes: `menuSlugs`, `expireMenu`, `loadAssets` to verify that an asset id belongs to this restaurant or the shared library, and a VIDEO asset has a poster.

- [ ] **Step 1: Write failing tests** in `tests/studio/intro.test.ts` (fixture style of `tests/studio/feedback.test.ts`): `saves the intro and turns it on for the owner`; `refuses another restaurant's asset as background or advert` (code `NOT_FOUND` or the framework's cross-tenant refusal, check `cross-tenant.test.ts` conventions); `refuses an href that is not https or a path`; `refuses overlay outside 0 to 100`; `orders adverts and deletes one`; `a platform advert is listed for its restaurants and never editable here`; `turning it on needs the plan feature` (a BASIC restaurant gets the plan refusal `ctx.plan` gives).
- [ ] **Step 2: Run.** Expected: FAIL (definitions missing).
- [ ] **Step 3: Implement** the service, actions, query and the `'use server'` wrappers; add audit names and labels in en, ar, ckb; add each definition to `tests/studio/cross-tenant.test.ts` with a case naming restaurant B's menu or asset.
- [ ] **Step 4: Run** `tests/studio/intro.test.ts tests/studio/cross-tenant.test.ts tests/studio/activity.test.ts tests/studio/messages.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): intro and adverts actions`.

### Task 4: Super Admin side

**Files:**
- Create: `src/server/studio/actions/platform-intro.ts`, `src/server/studio/queries/platform-intro.ts`, `src/app/studio/_actions/platform-intro.ts`
- Test: `tests/studio/platform-intro.test.ts`, `tests/studio/cross-tenant.test.ts` (PLATFORM_ONLY table)

**Interfaces:**
- Produces (`permission: 'platform.settings'`, platform target): `platform.saveIntroDefault({backgroundAssetId|null})` (a shared-library asset only), `platform.savePlatformAdvert({advertId?, imageAssetId, alts, href, startsAt, endsAt, active, restaurantIds})`, `platform.reorderPlatformAdverts({ids})`, `platform.deletePlatformAdvert({advertId})`, query `platform.introAdverts()`. Platform writes call `expirePlans()`-style invalidation for every affected slug: use `expireMenu` for each menu of each restaurant (empty `restaurantIds` means all live menus: expire the `plans` tag instead, since slug resolution is tagged with it).

- [ ] **Step 1: Failing tests:** a non-Super Admin is refused (`FORBIDDEN`); the default background must be a shared asset; a platform advert targeting two restaurants shows in both restaurants' `menus.intro` and in no third; deleting removes it from all.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and register in the sweep's `PLATFORM_ONLY` table plus audit names (`platform.intro_changed`, entity `PlatformAdvert`).
- [ ] **Step 4: Run** the four test files of Task 3 plus `tests/studio/platform-intro.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): platform intro default and adverts`.

### Task 5: Public data, routing and language memory

**Files:**
- Create: `src/server/data/intro.ts` (`loadIntro(route)`), `src/app/[tenant]/[locale]/intro/page.tsx` is NOT used; the intro lives at `src/app/[tenant]/intro/page.tsx` (language-less, outside `[locale]`), `src/server/http/language-memory.ts`
- Modify: `src/server/http/menu-entry.ts`, `src/app/[tenant]/route.ts`, `src/server/public-page.tsx`
- Test: `tests/api/public-routes.test.ts` (extend), `tests/data/intro.test.ts`

**Interfaces:**
- Produces: `loadIntro(tenant, now): Promise<IntroView | null>` where `IntroView = { background: { kind: 'image'|'video'; url; poster?; width; height } | null; overlay: number; logo; showContact; contacts: { kind: 'instagram'|'facebook'|'tiktok'|'website'|'map'|'phone'|'whatsapp'; href }[]; adverts: { image: ImageItem; alt by locale; href }[]; locales: string[]; defaultLocale: string }`. Contacts come live from `Restaurant` (phone, whatsapp, mapUrl, socialLinks); each only when filled and safe. Cookie helpers: `languageCookie(slug) = 'bz_lang_' + slug` (value a locale code, `SameSite=Lax`, one year, `Path=/{slug}`), `readLanguage(request, slug, offered)`.
- `redirectToMenu` change: when `subpath === ''` (the plain `/{slug}`), the menu's `extras.intro` is on and there is no valid language cookie, answer 307 to `/{slug}/intro` (with the query string kept); with a cookie, redirect to that locale. The table route (`/t/{table}`) is unchanged.

- [ ] **Step 1: Write failing tests** in `tests/api/public-routes.test.ts`: `sends a new visitor to the intro when it is on`; `sends a visitor with a language cookie straight to that language`; `never sends a table link to the intro`; `leaves menus with the intro off as they are`; `answers 404 for a missing menu on /intro and redirects a former slug`. In `tests/data/intro.test.ts`: `loadIntro drops adverts outside their window in the menu's time zone`, `drops an advert whose asset is another restaurant's`, `omits a contact that is empty or unsafe`, `falls back to the platform default background, then to none`, `shows platform adverts only to their restaurants`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `language-memory.ts`, the redirect rules, `loadIntro` (assets through `loadAssets(..., ['IMAGE','VIDEO'])`, `assetImage`, `sceneMediaOf`), and a route under `src/app/[tenant]/intro/page.tsx` that uses `resolvePublicRoute` pieces: since `withPublicMenu` expects a locale, add `resolvePublicRouteNoLocale` returning the tenant and negotiated default locale for the 404/redirect/unavailable states. When `extras.intro` is false the page redirects to the menu.
- [ ] **Step 4: Run** the two files plus `tests/api/routes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(menu): intro route, live intro data and language memory`.

### Task 6: The intro page UI

**Files:**
- Create: `src/ui/intro/IntroPage.tsx`, `src/ui/intro/IntroBackground.tsx`, `src/ui/intro/AdvertSlider.tsx`, `src/ui/intro/LanguageButtons.tsx`, `src/ui/intro/ContactIcons.tsx`
- Modify: `src/app/[tenant]/intro/page.tsx`, `src/lib/messages/{en,ar,ckb}.ts` (`intro.enter`, `intro.contact.*`, `intro.advert`)
- Test: `tests/ui/intro.test.ts` (render to static markup, the way `tests/ui/*` do)

**Interfaces:**
- Consumes: `IntroView` (Task 5), `FeedbackButton` from `src/ui/guest/FeedbackButton.tsx` (it needs the app providers: wrap the page in `AppProviders` with the default locale), `Popup`.
- Produces: `IntroPage({ view, tenant })`. Language links are real `<a href="/{slug}/{code}">` elements (work without JavaScript); a small client handler writes the cookie before navigating. The first language is the menu's default and sits alone on its row, the rest in pairs, as in the reference; one language gives a single "Enter" link. Adverts render as full-width cards with the advert's alt text for the visitor's language; one shows still, several slide with scroll-snap (no autoplay timer needed); a linked card is an `<a rel="noopener noreferrer">`. Video: `<video muted loop playsinline poster>` started only when `prefers-reduced-motion` is not set and `navigator.connection.saveData` is not true; otherwise the poster image.

- [ ] **Step 1: Failing tests** (static markup): `renders a link per language with the menu's default first`; `a single language renders one Enter link`; `renders the photo background and no video tag when the background is an image`; `renders a poster and a video tag for a video background`; `omits contact icons that have no value and renders none when showContact is false`; `shows no advert section with zero live adverts`; `mirrors with dir=rtl for ar and ckb`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the components with the project's tokens; a dark gradient whose strength is `overlay`; text and buttons stay readable on any photo (contrast of the button labels checked against the button fill, not the photo).
- [ ] **Step 4: Run** `tests/ui/intro.test.ts tests/lib/messages.test.ts` and `npm run typecheck && npm run lint`. Expected: PASS. Then open `/{slug}/intro` in the browser pane at phone width (375x812) in en and ar, with and without adverts, with a video background; screenshot for the review.
- [ ] **Step 5: Commit** `feat(menu): intro page`.

### Task 7: Studio "Intro" page

**Files:**
- Create: `src/app/studio/(studio)/(app)/menus/[id]/intro/page.tsx`, `src/studio/workspace/intro/IntroForm.tsx`, `src/studio/workspace/intro/AdvertList.tsx`, `src/app/studio/(studio)/(app)/platform/intro/page.tsx` (Super Admin), `src/studio/workspace/intro/PlatformIntro.tsx`
- Modify: `src/studio/workspace/tabs.ts` (`WorkspaceTabKey` `'intro'`, `labelKey: 'workspace.tab.intro'`, `needs: ['content.edit']`, add to `BUILT_TABS`), the platform navigation, catalogs
- Test: `tests/studio/workspace-tabs.test.ts` (edit), `tests/studio/messages.test.ts`

**Interfaces:**
- Consumes: Task 3 and 4 wrappers, `MediaPicker`, `uploadMedia(file, {restaurantId}, {folder: 'intro'})`, `ScenePicker` with `allowed: ['video']` for the video background (gated by the existing plan check `sceneFeature`), `Switch`, `Field`, `toast`.
- Produces: the form (on/off switch, background picker photo or video, overlay slider, logo and contact switches, a live preview using `IntroPage`), the advert list (add, edit alt text per language, link, dates, drag order, active switch, platform adverts shown read-only with a badge), and the Super Admin page.

- [ ] **Step 1: Failing tests:** the tab registers with its permission and label in all three catalogs (`workspace-tabs.test.ts`, `messages.test.ts`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the screens; saving shows `toast.success`, a refusal shows `describeFailure`; the preview is the real component at phone width.
- [ ] **Step 4: Run** `tests/studio/workspace-tabs.test.ts tests/studio/messages.test.ts`, typecheck, lint. In the browser pane: switch on, pick a photo, add two adverts, reorder, open `/{slug}` in a private window and see the intro; choose Arabic, land on the menu, reload `/{slug}` and land on the menu directly (cookie).
- [ ] **Step 5: Commit** `feat(studio): intro tab and platform intro page`.

### Task 8: Whole-feature checks

- [ ] **Step 1:** Run the full suite redirecting output to a file in the scratchpad directory (not the repo): `BUZZIFY_DB_PORT=54351 npm test > <scratchpad>/suite.txt 2>&1`, read the tail. Expected: only the known ai-import enforcement failure.
- [ ] **Step 2:** Update `graphify` (`graphify update .`) and the memory file `cashier-batches-progress.md` or a new project memory for this feature.
