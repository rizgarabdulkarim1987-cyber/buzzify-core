# Super Admin Project Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Super Admin lands on a centred set of project icons and works inside a closed space per project (Menu and Cashier, Pharmacy, plus a small Platform entry), with no data of one project visible in another.

**Architecture:** A registry (`src/studio/spaces.ts`) names the spaces and resolves a space from the URL path alone. Menu and Cashier keeps every existing path (no mass move); Pharmacy lives under `/studio/pharmacy`, Platform under `/studio/team`. Separation is done in the queries and actions by business sector (`FOOD` / `PHARMACY`), never by hiding rows in the UI. Owners and designers keep the current shell untouched.

**Tech Stack:** Next.js App Router (server components), Prisma, zod `defineQuery`/`defineAction` framework in `src/server/studio/framework`, vitest (DB tests use `requireTestDb`, see `tests/studio/overview.test.ts`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-31-super-admin-project-hub-design.md`

## Global Constraints

- Super Admins only: `actor.isSuperAdmin`. Owners, designers, `/pos`, `/pharmacy` behave exactly as today.
- Two big hub icons, centred on both axes: **Menu and Cashier** and **Pharmacy**. **Platform** is a small entry in a corner of the hub, not a third big icon.
- A pharmacy is still a `Restaurant` row with `sector = PHARMACY`. No second database, no schema split.
- A space is known from the URL path alone (no cookie). Menu and Cashier keeps today's paths; Pharmacy is `/studio/pharmacy/...`; Platform is `/studio/team/...`.
- Every page a Super Admin reaches today belongs to exactly one of the three spaces.
- The Super Admin's own account page (`ACCOUNT_PATH`) stays reachable from every space.
- English, Arabic (`ar`) and Sorani (`ckb`) strings for every new label (`src/studio/messages`), right-to-left safe (logical `start`/`end` classes as the existing code does).
- No motion added in the Studio beyond what exists. Use existing tokens and `src/studio/ui/*` components.
- Commit only when the user asks; the commit steps below are for the executor once they do.

## Review Focus

- A user with businesses in both sectors appears in both People lists, each showing only that space's businesses.
- An action given an id of the other sector (e.g. delete a pharmacy from the Food space) is refused, not just hidden.
- An old URL for a pharmacy (`/studio/restaurants/<pharmacyId>`) lands on its Pharmacy-space page; for a food business it stays.
- Audit rows with no business appear in no space's Activity.
- A Super Admin who is also an owner still gets the hub at `/studio`; an owner-only person still gets `landingPath`.

---

### Task 1: Space registry, path resolver, business paths

**Files:**
- Create: `src/studio/spaces.ts`
- Test: `tests/studio/spaces.test.ts`

**Interfaces:**
- Produces:
  - `type SpaceId = 'food' | 'pharmacy' | 'platform'`
  - `interface Space { id: SpaceId; nameKey: string; icon: 'food' | 'pharmacy' | 'platform'; home: string; sectors: readonly BusinessSector[]; prefix: string | null; big: boolean }`
  - `SPACES: readonly Space[]` (food: home `/studio/overview`, sectors `['FOOD']`, prefix `null` (the default); pharmacy: home `/studio/pharmacy`, `['PHARMACY']`, prefix `/studio/pharmacy`; platform: home `/studio/team`, `[]`, prefix `/studio/team`, `big: false`)
  - `spaceOfPath(pathname: string): SpaceId` (prefix match on whole segments; anything else under `/studio` is `food`)
  - `businessPath(sector: BusinessSector, id: string, tab?: string): string` (`/studio/restaurants/<id>[/<tab>]` for FOOD, `/studio/pharmacy/<id>[/<tab>]` for PHARMACY)
  - `sectorOfSpace(space: SpaceId): BusinessSector | null`

- [ ] **Step 1: Write the failing test** `tests/studio/spaces.test.ts`: `spaceOfPath('/studio/pharmacy')`, `'/studio/pharmacy/abc/billing'` → `'pharmacy'`; `'/studio/team/people'` → `'platform'`; `'/studio/restaurants'`, `'/studio/menus/1'`, `'/studio/platform/intro'`, `'/studio/pharmacies'` → `'food'`; `'/studio/pharmacyx'` → `'food'` (whole segments). `businessPath('PHARMACY','p1','billing') === '/studio/pharmacy/p1/billing'`; `businessPath('FOOD','r1') === '/studio/restaurants/r1'`. A test registry with a fourth entry produces a fourth item from `bigSpaces(registry)` (pass the registry as an optional argument to `spaceOfPath` and `bigSpaces`, default `SPACES`).
- [ ] **Step 2: Run** `npx vitest run tests/studio/spaces.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/studio/spaces.ts` with the interfaces above plus `bigSpaces(spaces = SPACES): Space[]` (those with `big: true`).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/studio/spaces.ts tests/studio/spaces.test.ts && git commit -m "feat(studio): space registry and path resolver"`

---

### Task 2: Hub page, space shell and per-space navigation

**Files:**
- Modify: `src/studio/nav.ts` (add `spaceNav(space: SpaceId): NavItem[]`; keep `NAV_ITEMS`/`visibleNav` for non-Super-Admins unchanged), `src/studio/shell/Sidebar.tsx` (accept `space` and render a "All projects" link to `/studio` plus the space name above the list)
- Modify: `src/app/studio/(studio)/(app)/layout.tsx` (a Super Admin gets the space-aware shell; resolve the space from the pathname via a request header or by moving the shell into per-space layouts, executor's choice, see note)
- Modify: `src/app/studio/(studio)/(app)/page.tsx` (for a Super Admin render the hub; for everyone else the current Overview unchanged)
- Create: `src/app/studio/(studio)/(app)/overview/page.tsx` (today's Overview body, moved out of `page.tsx` into a shared `OverviewBody` so both routes use it)
- Create: `src/studio/shell/ProjectHub.tsx` (server component: the centred icons), message keys `hub.*` in `src/studio/messages/{en,ar,ckb}`
- Test: `tests/studio/nav.test.ts` (extend), `tests/studio/hub.test.tsx` (new, DOM)

**Interfaces:**
- Consumes: `SPACES`, `bigSpaces`, `spaceOfPath` (Task 1).
- Produces: `spaceNav(space: SpaceId): NavItem[]`. Food items (all existing keys, unchanged hrefs except overview → `/studio/overview`): overview, restaurants, billing, cashierOverview, menus, media, motion, people, announcements, platformIntro, activity, settings. Pharmacy items (hrefs under `/studio/pharmacy`): overview `/studio/pharmacy/overview`, pharmacies `/studio/pharmacy`, billing, people, announcements, activity, settings. Platform items (under `/studio/team`): team `/studio/team`, settings `/studio/team/settings`. New `NavKey`s: `pharmacyOverview`, `pharmacyBilling`, `pharmacyPeople`, `pharmacyAnnouncements`, `pharmacyActivity`, `pharmacySettings`, `team`, `teamSettings`.

Note on space resolution in the shell: the current `(app)/layout.tsx` is one layout for all pages. Simplest is route groups: `(app)/(food)/...` can't change URLs, so instead have the layout read the path from a header the proxy sets (`src/proxy.ts` already sees every request) and call `spaceOfPath`. If that proves awkward, wrap each space's pages in its own layout file that passes `space` to a shared `SpaceShell`.

- [ ] **Step 1: Write failing tests.** In `tests/studio/nav.test.ts`: `spaceNav('food')` contains no key starting with `pharmacy` and not `team`; `spaceNav('pharmacy')` contains no `cashierOverview`, `menus`, `restaurants`; every href of `spaceNav('pharmacy')` satisfies `spaceOfPath(href) === 'pharmacy'`; every href of `spaceNav('platform')` resolves to `'platform'`; `visibleNav` for an owner and for a designer is unchanged (existing assertions stay). In `tests/studio/hub.test.tsx`: rendering `ProjectHub` shows exactly two large links (names Menu and Cashier / Pharmacy, hrefs `/studio/overview` and `/studio/pharmacy`) and one small Platform link (`/studio/team`); the container has `min-h-dvh`, `items-center`, `justify-center` classes.
- [ ] **Step 2: Run** `npx vitest run tests/studio/nav.test.ts tests/studio/hub.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `spaceNav`, `ProjectHub`, the Super-Admin branch of `page.tsx`, `overview/page.tsx`, the Sidebar back link and space title, and the translations in all three languages.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 5: Verify in the browser** (preview server from `.claude/launch.json`): sign in as a Super Admin, `/studio` shows the icons centred at 375 px and 1280 px, in English and Arabic (RTL); clicking Menu and Cashier opens `/studio/overview` with the Food sidebar only. Take screenshots.
- [ ] **Step 6: Commit** `feat(studio): super admin project hub and per-space navigation`

---

### Task 3: Sector scoping of reads

**Files:**
- Modify: `src/server/studio/queries/restaurants.ts` (`listRestaurants`: add `space` input that forces the sector), `queries/billing.ts` (`billingRestaurants`: where `sector` of the space; `billingOverview`: only the applications of the space), `queries/people.ts` (`listPeople`, `listInvitations`: memberships/invites whose restaurant has the space's sector), `services/activity.ts` + `queries/activity.ts` (`listActivity`: rows whose `restaurantId` belongs to a business of the sector; rows with no business excluded), `services/overview.ts` (`loadOverview`: sector-limited counts), `services/search.ts` + `queries/search.ts` (`jump`, `searchRestaurants`, `searchPeople`), `queries/pharmacies.ts` (unchanged semantics), `queries/pos.ts` (cashier overview already `FOOD`)
- Create: `src/server/studio/services/space-scope.ts` — `sectorWhere(space: 'food' | 'pharmacy'): { sector: BusinessSector }` and `assertSameSector(db, restaurantId, space): Promise<void>` (throws `StudioError('NOT_FOUND')`)
- Test: `tests/studio/space-scope.test.ts`

**Interfaces:**
- Consumes: `SpaceId` (Task 1).
- Produces: every listed query accepts an optional `space: z.enum(['food','pharmacy']).default('food')` input field. Non-Super-Admin callers cannot pass anything but their current behaviour: when `ctx.scope.kind !== 'all'` the field is ignored.

- [ ] **Step 1: Write failing tests** `tests/studio/space-scope.test.ts` (seed one FOOD and one PHARMACY business, each with a member, an invitation, an audit row; plus an audit row with no business; plus one user belonging to both). For a Super Admin: `listRestaurants` with `space:'pharmacy'` returns only the pharmacy and with `'food'` only the food business; `billingRestaurants` likewise; `listPeople` with `space:'pharmacy'` returns the pharmacy member, the both-sector user (with only the pharmacy membership in `memberships`) and not the food-only member; `listActivity` for each space returns only its own rows and never the business-less row; `jump` and `searchRestaurants` for `space:'food'` never return the pharmacy; `overview` counts for `food` exclude the pharmacy.
- [ ] **Step 2: Run** `npx vitest run tests/studio/space-scope.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `space-scope.ts` and thread `space` through each query listed. Reuse `sectorWhere`; do not copy the literal `'FOOD'`.
- [ ] **Step 4: Run** the new test, then `npx vitest run tests/studio` — Expected: PASS (existing studio tests unchanged because `space` defaults to `'food'`; where an existing test seeds a pharmacy and expects it in a shared list, update that test to ask for `space:'pharmacy'`).
- [ ] **Step 5: Commit** `feat(studio): sector-scoped reads per space`

---

### Task 4: Sector guard on writes

**Files:**
- Modify: `src/server/studio/actions/restaurants.ts` (create / update / status / delete / branches / plan), `actions/billing` and `actions/people.ts` (invite, role changes), `actions/support-access.ts`
- Test: `tests/studio/space-actions.test.ts`

**Interfaces:**
- Consumes: `assertSameSector` (Task 3).
- Produces: each action accepts the optional `space` field the pages send; when present and the target business is of the other sector, the action fails with `NOT_FOUND` and writes nothing. `createRestaurant` with `space:'food'` ignores any `sector` input and creates FOOD; with `space:'pharmacy'` creates PHARMACY (so the form has no sector switch).

- [ ] **Step 1: Write failing tests**: as a Super Admin, deleting a pharmacy with `space:'food'` returns `NOT_FOUND` and the row still exists; changing a food business's status with `space:'pharmacy'` is refused; `createRestaurant` with `space:'food'` and `sector:'PHARMACY'` creates a FOOD business; an invitation to a pharmacy sent with `space:'food'` is refused.
- [ ] **Step 2: Run** `npx vitest run tests/studio/space-actions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the guard at the top of each action's `run`.
- [ ] **Step 4: Run** `npx vitest run tests/studio tests/pharmacy` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): refuse cross-sector writes`

---

### Task 5: Pharmacy space pages

**Files:**
- Create under `src/app/studio/(studio)/(app)/pharmacy/`: `layout.tsx` (guard: Super Admin only, else not-found), `overview/page.tsx` (pharmacies by status), `page.tsx` (list, from today's `pharmacies/page.tsx`), `new/page.tsx` (create form fixed to PHARMACY), `[id]/layout.tsx` + `[id]/page.tsx` + tabs `branches`, `billing`, `people`, `activity` (mount the existing tab components from `restaurants/[id]/*` with a `base` prop instead of the hardcoded `/studio/restaurants/${id}`), `billing/page.tsx`, `people/page.tsx`, `announcements/page.tsx`, `activity/page.tsx`, `settings/page.tsx` (pharmacy plans via `appPlansList` + the pharmacy product prices from `billingOverview` with `space:'pharmacy'`), `support/page.tsx` only if a support-grants list page already exists elsewhere (otherwise list it in Done notes, do not build)
- Modify: `restaurants/[id]/layout.tsx`, `RestaurantActions.tsx`, `restaurants/RestaurantForm.tsx` (take `base`/`listPath`/`space` props; drop the sector switch and the `?sector=` handling in `restaurants/new/page.tsx` and `src/studio/sector-param.ts`), delete `pharmacies/page.tsx`
- Test: `tests/studio/pharmacy-space.test.tsx`

**Interfaces:**
- Consumes: `businessPath`, `spaceNav('pharmacy')`, `space` inputs from Tasks 1–4.
- Produces: shared components accept `base: string` (e.g. `/studio/pharmacy/<id>`) and `listPath: string`.

- [ ] **Step 1: Write failing tests**: the pharmacy detail layout built for `base='/studio/pharmacy/p1'` has tab hrefs all under that base and no `menus`, `plan`, `feedback`, `media` tab and no till/POS link; the create form for the pharmacy space renders no sector control and submits `sector` PHARMACY; the Pharmacy overview shows counts only of PHARMACY businesses.
- [ ] **Step 2: Run** `npx vitest run tests/studio/pharmacy-space.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the routes and the `base` props. Search the pharmacy pages for any till, POS or cashier text or link (`grep -rni "pos\b\|cashier" src/app/studio/(studio)/(app)/pharmacy`) and remove it.
- [ ] **Step 4: Run** the new test and `npx tsc --noEmit` — Expected: PASS, no type errors.
- [ ] **Step 5: Verify in the browser**: Pharmacy icon → overview; create a pharmacy; open it; every link stays under `/studio/pharmacy`; the Food space lists no pharmacy. Screenshots.
- [ ] **Step 6: Commit** `feat(studio): pharmacy space`

---

### Task 6: Food-space cleanup and announcements per space

**Files:**
- Modify: Food pages that listed or linked pharmacies: `restaurants/page.tsx`, `restaurants/RestaurantsTable.tsx`, `RestaurantFilters.tsx` (remove the sector filter and `SectorBadge` use), `restaurants/new/page.tsx` (FOOD only), `cashier/page.tsx`, `menus/*`, `page.tsx` overview, `settings/billing/page.tsx` and `BillingSettings` (products `menu` and `cashier` only), `settings/plans` (menu plans), `settings/ai`
- Modify: `prisma/schema.prisma` (`Announcement.space String @default("food")`), create `prisma/migrations/20261031120000_announcement_space/migration.sql`; `queries/announcements.ts` (`listAnnouncements` takes `space`; `activeAnnouncements` unchanged for non-Super-Admins), `actions` that create an announcement take `space`
- Modify: the 27 hardcoded `/studio/restaurants/...` links found by `grep -rn "studio/restaurants" src` — those that can point at a pharmacy (activity rows, JumpTo, billing links, `MediaDetails`) use `businessPath(sector, id, tab)`
- Test: `tests/studio/announcements.test.ts` (extend), `tests/studio/food-space.test.tsx`

- [ ] **Step 1: Write failing tests**: Food-space restaurants list/page has no sector filter or pharmacy row; `listAnnouncements({space:'pharmacy'})` omits food announcements and the reverse; an announcement created in the pharmacy space has `space='pharmacy'`; an activity row naming a pharmacy links to `/studio/pharmacy/<id>`; JumpTo from the Food space never shows a pharmacy.
- [ ] **Step 2: Run** `npx vitest run tests/studio/announcements.test.ts tests/studio/food-space.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the changes and run `npx prisma migrate dev --name announcement_space` (or write the SQL migration by hand) and `npx prisma generate`.
- [ ] **Step 4: Run** `npx vitest run tests/studio` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): food space cleanup and per-space announcements`

---

### Task 7: Platform space

**Files:**
- Create under `src/app/studio/(studio)/(app)/team/`: `layout.tsx` (Super Admin guard), `page.tsx` (Super Admin accounts and their invitations: `listPeople` / `listInvitations` with the platform-staff filter), `settings/page.tsx` (today's general settings form: reserved addresses and email sender name)
- Modify: `settings/tabs.ts` and `settings/page.tsx` (the general tab leaves the Food space; the Food settings keep Plans, Billing, AI), `queries/people.ts` (a `staff: true` filter: `isSuperAdmin` users and invitations that create Super Admins)
- Test: `tests/studio/team-space.test.ts`

- [ ] **Step 1: Write failing tests**: `listPeople({staff:true})` returns only Super Admin accounts; the Food and Pharmacy People lists never return a Super Admin who has no membership in that sector's businesses; `spaceNav('platform')` has exactly `team` and `teamSettings`.
- [ ] **Step 2: Run** `npx vitest run tests/studio/team-space.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** The Super Admin's own account page stays in the sidebar user menu of every space (already `ACCOUNT_PATH`).
- [ ] **Step 4: Run** `npx vitest run tests/studio` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): platform space for the team and platform settings`

---

### Task 8: Old URLs for Super Admins

**Files:**
- Modify: `src/app/studio/(studio)/(app)/restaurants/[id]/layout.tsx` (a Super Admin opening a PHARMACY business here is redirected to `businessPath('PHARMACY', id, <same tab>)`), `pharmacies/` (permanent redirect to `/studio/pharmacy`), shared list pages `billing`, `people`, `activity`, `announcements`, `settings` (unchanged for Food; they already are the Food pages)
- Test: `tests/studio/space-redirects.test.ts`

- [ ] **Step 1: Write failing tests**: a Super Admin requesting the restaurant detail for a pharmacy id gets a redirect to `/studio/pharmacy/<id>` (and keeps a `/billing` tab suffix); for a food id no redirect; an owner requesting their own restaurant is never redirected; `/studio/pharmacies` redirects to `/studio/pharmacy`.
- [ ] **Step 2: Run** `npx vitest run tests/studio/space-redirects.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the redirects.
- [ ] **Step 4: Run** `npx vitest run tests/studio tests/pharmacy tests/api` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(studio): old URLs land in the right space`

---

### Task 9: End-to-end check and regression

**Files:**
- Create: `tests/e2e/super-admin-hub.spec.ts` (follow `tests/e2e/helpers/studio.ts`)

- [ ] **Step 1: Write the spec**: sign in as a Super Admin → the two icons are centred (bounding box centre within 4 px of the viewport centre) and Platform is small; open Pharmacy → create a pharmacy → the Food space lists no pharmacy and the Pharmacy space no food business; sign in as an owner → the old shell, no hub.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/super-admin-hub.spec.ts` — Expected: PASS.
- [ ] **Step 3: Run the whole suite** `npx vitest run` and `npx tsc --noEmit` and `npx eslint src` — Expected: no new failures (record the 15 pre-existing failures from `main` as the baseline, do not count them).
- [ ] **Step 4: Run** `graphify update .`

---

## Self-review notes

- Spec coverage: hub and centring (Task 2), closed spaces (2, 5, 7), per-space settings/billing/people/activity/announcements (3, 5, 6, 7), pharmacy out of Restaurants and cashier out of pharmacy (5, 6), cross-sector writes (4), old URLs (8), future project is one registry entry (1, tested), owners unchanged (2, 8, 9), Platform small entry (2, 7).
- The spec proposed `/studio/food`; this plan keeps existing Food paths instead (spec allowed other names as long as the space is known from the path) to avoid rewriting 111 hardcoded links and 800 test references.
- Calls the executor must make and report: how the shell learns the current space (header from `src/proxy.ts` vs per-space layouts, Task 2), whether a support-grants list page exists (Task 5), and the exact message keys.
