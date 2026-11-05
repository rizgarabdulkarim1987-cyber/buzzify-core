# Super Admin project hub: one icon per project, one closed space per icon

Date: 2026-10-31. Status: draft for approval. Scope: Super Admins only.

## Why

Today a Super Admin signs in to `/studio` and gets one sidebar that mixes everything: restaurants, menus, styles, media,
motion, the cashier overview, pharmacies, billing, people, announcements, activity and settings
(`src/studio/nav.ts`, `NAV_ITEMS`). Pharmacies are listed twice: on their own page (`/studio/pharmacies`) and again in
Restaurants (`/studio/restaurants`, which opens the same detail page and the same create form with `?sector=PHARMACY`).
Billing, People, Activity and Settings show every project's data together.

The owner wants the projects not to mix in the Super Admin's UI, and the pharmacy fully separate from the cashier and the
rest. Each project becomes an icon; the Super Admin enters a project through its icon and stays inside that project's own
space until they come back to the icons.

## What the owner decided

- The first screen a Super Admin sees after signing in is a set of project icons, **centred on the screen**.
- **Two icons today:**
  1. **Menu and Cashier**: one icon, because the two are tied together.
  2. **Pharmacy**: its own icon, separate from the cashier and from everything else.
- Each icon opens a **closed space**: its own navigation, pages and **its own settings**. Settings for creating a pharmacy
  live inside the Pharmacy space; settings for creating a cashier or a menu live inside the Menu and Cashier space. The same
  holds for the things that were shared (billing, people, announcements, activity): each space has its own, limited to that
  project.
- Pharmacies disappear from Restaurants, and the cashier disappears from the pharmacy's pages.
- **Future projects** ("the remaining projects") get the same treatment: a new icon and a new closed space, without
  touching the others.
- This applies to **Super Admins only**. Owners and designers keep signing in and navigating exactly as today.
- A Super Admin's own account (name, language, two-factor, sign out) stays reachable from every space.

## Goals

- A Super Admin can name, at any moment, which project they are in, and never sees a row, count, link or setting of another.
- Adding a project later is one registration (icon, name, space), not edits across the other spaces.
- No loss of function: every page a Super Admin can reach today is reachable in exactly one space.

## Non-goals

- No change for owners, designers, the cashier staff, or the pharmacy staff apps (`/pos`, `/pharmacy`).
- No change to the data model's sharing: a pharmacy is still a business row with `sector = PHARMACY`
  (`prisma/schema.prisma`); the separation is in the Studio's screens and queries, not a second database.
- No redesign of the pages themselves (tables, forms, tabs keep their look). Only where they live and what they list.
- No new roles or permissions.

## Anti-goals (failure even if it technically works)

- Two icons that open the same sidebar with items hidden by a flag: the spaces must be separate, not filtered views of one
  shell.
- A pharmacy still appearing in a Menu and Cashier list, count, search result, activity row or billing row, or the reverse.
- A Super Admin who has to guess a URL to reach a page that used to be in the sidebar.

## The experience

1. **Sign in** as a Super Admin, with two-factor as now. The landing page `/studio` shows the hub: the project icons in the
   middle of the screen (both axes), each with its name beneath. Keyboard reachable, readable in English, Arabic and
   Sorani, right-to-left aware.
2. **Click an icon** and the Super Admin lands on that project's overview inside its space. The space has its own sidebar
   listing only that project's pages, a header that names the project, and one control to go back to the icons.
3. **Menu and Cashier space** holds what is Food-sector and till related: overview, restaurants (Food only), menus, styles,
   media, motion, cashier overview, billing, people, announcements, platform intro, activity and settings (the plans, billing
   and AI settings that concern menus and the till).
4. **Pharmacy space** holds: overview, pharmacies (list, create, detail), billing for the pharmacy subscription, people,
   announcements, activity, support-access grants, and settings (pharmacy plans and settings).
5. A Super Admin who types an old URL (`/studio/restaurants`, `/studio/billing`, ...) is redirected to the right page in the
   right space; a pharmacy detail opened through an old restaurant URL redirects into the Pharmacy space.

## How it is built (calls the builder should follow, marked as my calls unless the owner said them)

- **My call, a space is decided by the URL alone, not by a cookie.** Deep links, the browser's back button and highlighting
  the current item all keep working. Proposed prefixes: `/studio/food/...` for Menu and Cashier (named after the existing
  `FOOD` sector) and `/studio/pharmacy/...` for Pharmacy. The builder may pick other names if the plan finds a cheaper
  route layout, provided a space is still known from the path. `/pharmacy` stays the pharmacy staff app and is not touched.
- **My call, one registry of projects.** A single list (id, name key, icon, sector or sectors it owns, home path, nav items)
  drives the hub, each space's sidebar, and the redirects. Adding a project means adding one entry. `src/studio/nav.ts`
  becomes per-space nav lists plus this registry.
- **My call, data is split by sector in the queries**, not by hiding rows in the UI. Lists, counts, search, activity,
  billing and people for the Food space read `sector = FOOD`; for the Pharmacy space `sector = PHARMACY`. Menus queries
  already filter `FOOD` (`src/server/studio/queries/menus.ts`); Restaurants, overview, billing, activity, people and search
  need the same, and `restaurants/new` must be per space (no `?sector=` switch inside one form).
- **My call, the hub is Super Admin only**: the layout checks `actor.isSuperAdmin`. Everyone else keeps the current shell and
  `landingPath` logic (`src/studio/nav.ts`).
- **Left to the builder:** exact URL names, the icon artwork (use the project's existing icon set and tokens), the
  transition into a space, which settings tabs belong to which space (`settings/tabs.ts` today: general, plans, billing, AI),
  and test layout.

## More calls made after the builder check (all mine, for the owner to check)

- **People:** a person appears in a space when they hold a membership in a business of that space's sector. Someone with
  businesses in both sectors appears in both, each showing only that space's businesses. Filtering is by a join through the
  business; no schema change is planned. If the plan finds a table with no business to join through, it reports back.
- **Billing and Activity:** the same join through the business. Rows with no business (platform-level events) are not shown
  in either space.
- **Actions, not only reads:** every create, update, delete and plan change inside a space rejects an id whose business is of
  the other sector. The tests cover one write per space, not only lists.
- **Old URLs:** `/studio/restaurants/[id]` redirects by looking up the business's sector (Super Admins only; owners and
  designers keep the old routes unchanged, so the old routes serve both audiences). The shared list pages
  (`/studio/billing`, `/studio/people`, `/studio/activity`, `/studio/settings`) redirect a Super Admin to the Menu and Cashier
  space, which is where they were mostly used; the Pharmacy space has its own.
- **Cashier in the pharmacy:** the pharmacy detail page must show no till or POS section. Anything of that kind found there is
  removed from the Pharmacy space, not hidden by a flag.
- **Announcements and platform intro:** each space lists only its own. Whether that needs a project field on announcements is
  for the plan to check in the schema; if it does, a nullable column defaulting to Menu and Cashier is acceptable.
- **A Super Admin who is also an owner or designer** still gets the hub at `/studio`.

## Platform entry (decided by the owner)

- The Buzzify team's own accounts (Super Admin invitations, the platform staff list) and any setting about the whole
  platform rather than one project live behind a **small "Platform" entry in a corner of the hub**, not a third large icon.
  It opens its own closed space, listing only those pages. It is in the registry as a non-project entry that the hub draws
  small. The Super Admin's own account page stays reachable from every space.
- Every page a Super Admin can reach today now belongs to exactly one of: Menu and Cashier, Pharmacy, Platform.

## Done means

- A Super Admin signing in sees the centred icons and nothing else of the old sidebar.
- In the Pharmacy space no Food business, menu, till, or Food billing row appears anywhere (lists, counts, search, activity),
  and in the Menu and Cashier space no pharmacy does. A test per space seeds one business of each sector and proves it.
- Old URLs redirect; owners and designers see no change.
- Adding a third project in a test registry produces a third icon and a closed space with no edit to the other two.
