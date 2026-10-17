# Project 1: Plans and entitlements

Status: draft for the user's approval
Date: 2026-10-18
Base: `main` at 6fd2227
Branch: `worktree-plans-and-entitlements`
Part of: the roadmap in `2026-10-18-product-roadmap.md` (project 1 of 6)

## 1. Intent

Buzzify sells digital menus to restaurants and wants to sell them in tiers: a cheaper plan with a good menu, and
dearer plans that unlock the features that make Buzzify stand out (the user's words: "templates to be selected,
backgrounds to be uploaded, motion graphic, 3D model, style, control on everything ... make these as privileges").

This project builds the machinery for that, and gates the features that exist today:

- three **plans** (Basic, Pro, Premium) whose contents the platform owner can change from the Studio;
- a restaurant's **plan**, set by the platform owner, with optional **extras** for that one restaurant (a feature
  switched on or off, a limit raised or lowered);
- one **platform owner**: the user, the only person who sells. No one else (no other Super Admin, designer or staff
  member) can change a plan or a restaurant's plan (section 2.1);
- one **entitlement check** that every current and future feature asks: "may this restaurant use feature X?";
- **locked features shown with an upgrade hint** in the Studio, never an error;
- a **guest menu that respects the plan**: a feature the plan does not include never shows to guests, and a downgrade
  never breaks a published menu.

The user chose to skip the brainstorming questions and asked for a proposal. Everything below that is not quoted from
them is a proposal for their approval; the main calls are listed in section 13 so they can check them.

## 2. Two separate questions

The Studio already answers **"may this person do this?"** with permissions (`src/server/domain/permissions.ts`:
roles, the client's policy, `effectivePermissions`; checked by `defineAction` and `defineQuery`). This project adds
**"has this restaurant got this?"**: entitlements. They stay separate:

| | Permissions (exist) | Entitlements (new) |
|---|---|---|
| About | a person in a restaurant | the restaurant |
| Decided by | role defaults and the client's policy | the restaurant's plan and its extras |
| Changed by | Super Admin on the People tab | the platform owner only, on the new Plan tab |
| Refusal | `FORBIDDEN` (the control is hidden) | `UPGRADE_REQUIRED` (the control shows, locked, with a hint) |
| Applies to guests | no | yes |

A Studio action runs only when both hold. The permission is checked first, so someone who may not use a tool never
sees an upgrade hint for it. Entitlements are about the restaurant, so they apply to Super Admins too, the platform
owner included: designing a Basic restaurant's menu, nobody can switch on a Pro feature for it. The platform owner's
hint offers "Change plan" instead of the WhatsApp button, and one click takes them to the Plan tab.

### 2.1 The platform owner

The user's words: "I want to sell by myself, I don't want anyone else on my behalf." When asked, they chose: only they
change plans (no employee, designer or other admin), and the upgrade button reaches their own WhatsApp.

- Exactly one account is the **platform owner**. It is a Super Admin (with two-factor, as every Super Admin).
- Only the platform owner may: set a restaurant's plan, extras and note; edit the plans (names, features, limits); set
  the WhatsApp number the upgrade button opens. Every other Super Admin sees all of it, read-only.
- Who it is: the migration makes the **first Super Admin ever created** the platform owner. On the live site that is
  the account the user made in step 7 of `docs/deploy/production.md`. On a new database, `npm run studio:create-admin`
  makes the first Super Admin the owner; the dev seed makes `admin@buzzify.test` the owner.
- The database holds at most one owner (a unique index on the flag when it is true).
- Nobody else can take it over through the Studio: no one but the platform owner may deactivate the platform owner,
  change their email, or take away their Super Admin status.
- Moving it to another account has no Studio screen. A terminal script (`npm run studio:set-platform-owner`, run like
  `studio:create-admin`) moves it, for a handover or for recovery if the account is lost.

## 3. Goals, non-goals, anti-goals

Goals:

- One resolver for entitlements, pure and tested, used by the Studio framework, the guest menu and every later project.
- Plans whose names, features and limits the platform owner edits in the Studio without a developer.
- Per-restaurant extras, so a deal ("Basic, plus the 3D dishes") needs no new plan.
- Locked features visible in the Studio with a clear upgrade hint in English, Arabic and Sorani.
- Downgrades that lose nothing: stored choices stay, guests see a fallback at once, and upgrading again restores them.
- Named keys for the features Projects 2 to 6 will add, with the plan each is meant for.

Non-goals (this project):

- Online payment, invoices, prices in the app, renewals, trials that end on a date. Billing stays offline; a note
  field on the Plan tab records it.
- Changing who may do what. Permissions, roles and policies stay as they are.
- Adding or removing plans. There are always three; their names and contents are editable.
- Building any feature of Projects 2 to 6. Only their keys are reserved.

Anti-goals (a failure even if everything else works):

- A guest sees an error, a broken page or an empty space where a locked feature was.
- An owner or designer sees "You do not have permission" or "Something went wrong" for something their plan lacks.
- A plan change alters a published menu's revision or hash, or makes anyone republish.
- Entitlement checks written ad hoc in components instead of asking the one resolver.

## 4. The plans

### 4.1 Features that exist today

A switch is on (✓) or off (–) in each plan. Each row says what guests and the Studio get when it is off.

| Key | What it unlocks | When it is off | Basic | Pro | Premium |
|---|---|---|---|---|---|
| `design.fontPairs` | all six font pairs | Classic and Modern only | – | ✓ | ✓ |
| `design.railStyles` | the animated category rails: drum, flap, deck | the plain rail | – | ✓ | ✓ |
| `design.expressiveMotion` | the expressive motion level | subtle motion (none stays available) | – | ✓ | ✓ |
| `qr.branded` | QR codes in brand colours, with the logo | black on white, no logo (frame text stays) | – | ✓ | ✓ |
| `publish.scheduling` | scheduled publishing | publish now only | – | ✓ | ✓ |
| `selling.smart` | upgrade offers, pairings and bundles shown to guests | none are shown | – | ✓ | ✓ |
| `immersive.explore` | Explore mode | the menu only | – | – | ✓ |
| `immersive.stage` | every 3D dish outside Explore: on product pages, in the signature dish at the top of the menu, and in the melting-dish (grains) rail | the 2D dish art the stage already shows on devices without WebGL; the closest rail allowed | – | – | ✓ |

Explore draws its own 3D scene, which belongs to `immersive.explore`: a restaurant given Explore without the stage (an
extra can do that) gets the whole of Explore.

Limits are numbers; "no limit" is a value too.

| Key | What it limits | Basic | Pro | Premium |
|---|---|---|---|---|
| `limits.menus` | menus a restaurant can have (any status) | 1 | 3 | no limit |
| `limits.storageMb` | the restaurant's media library | 500 MB | 2 GB | 10 GB |

Every plan keeps: unlimited products and categories, all three languages, the brand colours and logo, QR codes and
table codes, spreadsheet import and export, bulk prices, availability, revisions and rollback, the Studio preview, and
the signature dish (drawn in 2D without `immersive.stage`). Section 13 says why these stay open.

### 4.2 Keys reserved for later projects

Each later project asks for its key; the plan shown is where it starts, and the platform owner can move it. Until a
feature is built its switch does nothing.

| Project | Key | Feature | Starts in |
|---|---|---|---|
| 2 | `design.premiumTemplates` | templates beyond the standard ones | Pro |
| 2 | `design.backgroundImage` | an uploaded background image | Pro |
| 2 | `design.backgroundVideo` | an uploaded background video | Premium |
| 2 | `design.motionPresets` | motion presets | Pro |
| 3 | `guest.moodPicker` | "What are you in the mood for" | Pro |
| 3 | `guest.livingPhotos` | living photos (tilt parallax, steam, sheen) | Premium |
| 3 | `guest.stories` | restaurant stories | Pro |
| 3 | `guest.occasionMoods` | time-of-day and occasion moods (Ramadan, Newroz, Eid) | Pro |
| 3 | `guest.drinkMatch` | drink-and-dish match | Pro |
| 4 | `immersive.models3d` | uploaded 3D models (GLB) per dish | Premium |
| 4 | `immersive.ar` | AR on the table | Premium |
| 5 | `ordering.tableBasket` | order together at the table | Premium |
| 6 | `table.callWaiter` | call the waiter, ask for the bill | Pro |
| 6 | `loyalty.stampCard` | the loyalty stamp card | Pro |
| 6 | `share.dishCards` | shareable dish cards | Pro |
| 6 | `display.tvBoard` | the TV / menu-board mode | Premium |
| 6 | `selling.limitedDrops` | limited-time drops with countdowns | Pro |
| 6 | `design.seasonalParticles` | seasonal particle effects | Pro |
| 6 | `contact.whatsapp` | the WhatsApp order or reservation button | Basic |

A later project may add keys of its own; these are the starting list, not a ceiling.

### 4.3 Plan names

English Basic, Pro, Premium; Arabic الأساسية، الاحترافية، المميزة; Sorani to be written with the other Sorani
strings. The platform owner can rename each plan in each language. The internal keys (`BASIC`, `PRO`, `PREMIUM`) never
change.

## 5. Data

- `enum PlanTier { BASIC PRO PREMIUM }`.
- `Restaurant.plan PlanTier @default(BASIC)`.
- `Restaurant.planExtras Json @default("{}")`: `{ features?: { [key]: boolean }, limits?: { [key]: number | null } }`,
  the changes from the plan for this one restaurant. A key absent means "as the plan says".
- `Restaurant.planNote String @default("")`: the platform owner's note (what was agreed, paid until when). Only Super
  Admins see it; only the platform owner changes it.
- `User.isPlatformOwner Boolean @default(false)`, true on at most one account (section 2.1).
- Platform setting `plans` (a row in `PlatformSetting`, read with the other settings): for each tier, its names by
  language, `features: { [key]: boolean }` and `limits: { [key]: number | null }`. A key it does not hold takes the
  default from the code catalog (section 4), so a feature that ships later starts where section 4.2 says.
- Platform setting `upgradeWhatsApp`: the platform owner's own WhatsApp number, which the upgrade button opens. Until
  it is set, the hint shows its text without the button.
- The migration sets **every existing restaurant to Premium**, so nothing any guest sees today changes. New
  restaurants get the plan chosen when they are created (Basic is preselected).
- Stored JSON is untrusted, as `parsePolicy` treats the permission policy: unknown keys are dropped, malformed parts
  read as "as the plan says", a limit must be a whole number from 0 up (or null for no limit).

## 6. The resolver

A pure module, `src/server/domain/entitlements.ts`, next to `permissions.ts` and in its style:

- the catalog: every key, its area (Design, 3D, Publishing, Selling, Limits, Coming later), whether it is a switch or
  a limit, whether it is live or reserved (with its project), and its default in each plan;
- `parsePlans(json)` and `parseExtras(json)` for the stored JSON;
- `effectiveEntitlements({ plan, plans, extras })`: the restaurant's switches and limits, the plan's values with the
  extras laid over them (an extra wins);
- `allows(entitlements, key)`, `limitOf(entitlements, key)`, and `lowestPlanWith(plans, key)` for the hint ("Part of
  Pro");
- the fallbacks of section 4.1, one function per kind of choice, used by the guest menu, the preview and the Studio
  alike: the rail style (grains needs `immersive.stage`; drum, flap and deck need `design.railStyles`; a style not
  allowed becomes deck when the animated rails are allowed, else plain), the font pair, the motion level, the QR
  style.

Nothing else decides what a restaurant has.

## 7. The Studio framework

- `Access` (what `resolveAccess` returns) gains the restaurant's `entitlements`; `locate()` reads `plan` and
  `planExtras` with `permissionPolicy`. Platform and self targets have none.
- `defineAction` and `defineQuery` take an optional `feature` key. After the permission check, a target whose
  restaurant lacks it is refused with a new code, `UPGRADE_REQUIRED`, whose failure carries the feature and the lowest
  plan that includes it. `checkDefinition` refuses an unknown key, and a feature on a platform or self target.
- A handler whose need depends on its input (the brand save choosing a font pair) reads `ctx.entitlements` and throws
  the same refusal through one helper.
- **A locked choice may be kept, never newly made.** After a downgrade, saving the Brand tab with the drum rail it
  already had (to change a colour, say) is accepted; choosing drum anew is refused. The comparison is with what is
  stored.
- A new permission key, `plans.manage`, held by the platform owner and no one else: never grantable by a client
  policy, and left out of what `effectivePermissions` gives every other Super Admin. It covers a restaurant's plan,
  extras and note, the plans themselves and the WhatsApp number.
- The actor carries `isPlatformOwner`. The People actions refuse, for anyone but the platform owner, to deactivate the
  platform owner, change their email or take away their Super Admin status.
- New menus start with the best rail the plan allows (grains, else deck, else plain), so a Basic restaurant never
  opens a brand kit full of locked choices it did not make.
- Copies follow the same two rules:
  - **Duplicating a menu** makes a new menu, so its brand starts within the plan of the restaurant it lands in: a
    locked font pair becomes Classic, a locked rail the best allowed, expressive motion subtle. Duplicating into another
    restaurant (a Super Admin's move) checks that restaurant's plan and menu limit, not the source's.
  - **Restoring a revision to the draft, and rolling back**, bring back what that revision held, as a kept choice: guests
    see the fallbacks and the Brand tab marks them.
  - **Applying one QR code's style to others** is a new choice for those codes, so a branded style is refused on a plan
    without `qr.branded`.

## 8. The Studio screens

### 8.1 The Plan tab (new, on each restaurant)

Everyone who can open the restaurant sees it. It shows the plan's name; what is included, grouped by area, each
feature with a tick or a lock and "In Pro" or "In Premium"; usage against the limits ("Menus: 1 of 1", "Media: 320 MB
of 500 MB"); and the upgrade hint of 8.3.

The platform owner also gets the controls: the plan (three choices), each feature's extra ("As the plan", "On", "Off"),
each limit's extra (a number, no limit, or as the plan), and the note. Before a save that takes something away, a
confirmation lists what guests will stop seeing and which limits the restaurant will be over. Every save is in the
audit log with what changed.

### 8.2 Settings: Plans (the platform owner; other Super Admins read it)

The plans side by side: each plan's name in three languages; every feature as a switch per plan, the reserved ones
under "Coming later" marked "not built yet"; every limit as a number or no limit; the WhatsApp number. Saving changes
every restaurant on those plans at once; it is in the audit log.

### 8.3 Locks where the features are

One upgrade hint component everywhere: a lock, "Part of Pro", and a WhatsApp button that opens a chat with the
platform owner's number, with a ready message naming the restaurant, the feature and the plan. Owners, designers and
other Super Admins all get that button; the platform owner gets "Change plan" instead.

- **Brand:** locked font pairs, rail styles and the expressive level show with a lock and cannot be chosen. A stored
  choice the plan no longer includes is marked "Guests see Plain until the plan includes Drum".
- **QR codes:** colours and the logo switch are locked; frame text stays.
- **Revisions:** "Schedule" shows the hint; publishing now works as before.
- **Menus:** at the limit, "New menu" and "Duplicate" show "Your plan includes 1 menu" and the hint.
- **Media:** the storage meter shows the limit; an upload that would pass it is refused with the hint; deleting
  always works.
- **Preview:** shows exactly what guests get, with a note listing what the plan hides from them.
- **Restaurants list:** a Plan column and a plan filter. **New restaurant:** a plan choice.

### 8.4 Languages

Every new string in English, Arabic and Sorani, as the rest of the Studio.

## 9. The guest menu

- **Entitlements are never part of a snapshot.** Publishing, revisions and hashes do not change, and no plan change
  needs a republish.
- `findPublicMenu` already reads the menu's and the restaurant's status live; it now reads the restaurant's plan and
  extras live too, and the menu guests get carries its brand with the fallbacks of section 6 applied and the guest
  features it may show (Explore, the 3D stage, smart selling).
- **Explore:** the mode switch is not shown; `/explore` answers a temporary redirect to the menu's home with the query
  kept, so old links and bookmarks keep working.
- **3D stage:** product pages and the signature dish show the 2D dish art the stage already falls back to on devices
  without WebGL; `?stage=on` cannot force it.
- **Rail:** `?rail=` previews only styles the plan allows.
- **Smart selling:** the catalog guests are served drops the upsell rules, pairing rules and bundles, so no
  suggestions appear and a bundle already in a guest's cart is shown as "This set is no longer offered", as today when
  a bundle is removed.
- **Caching:** changing a restaurant's plan or extras expires every address of its menus, as a status change does;
  saving the plans expires every menu's cached address at once (one tag they all carry).
- The Studio preview and the table pages use the same path, so they show the same thing.

## 10. Downgrades

- Nothing is deleted or rewritten: brand choices, QR styles, menus, media, rules and schedules stay as they are.
- Guests see the fallbacks at once, on the same address.
- Upgrading again brings the stored choices back by itself.
- Publishing is never blocked by the plan: a draft holding locked choices publishes, and guests see the fallbacks.
- Over the menu limit: every menu stays published and editable; no new menu or duplicate until under it.
- Over the storage limit: nothing is deleted; uploads wait until the library is under it.
- Publishes scheduled before the downgrade still go live; new ones cannot be made; existing ones can be cancelled.
- QR codes download plain after a downgrade, and printed codes keep working (they are only addresses).

## 11. Demo data

A fresh seed puts ATELIER on Premium, Riverlight Coffee on Pro and Hot Brick Burgers on Basic, so the three plans can be
seen side by side; the 1,000-menu load seed spreads its restaurants across the three. The seed sets a plan only on a
restaurant it creates. Production is not touched: the migration puts its restaurants (the demos included) on Premium,
and the user moves any of them on the Plan tab when they want to.

## 12. Testing

- The resolver: defaults, stored plans, extras, malformed and unknown keys, no-limit values, `lowestPlanWith`, each
  fallback.
- The framework: `feature` on actions and queries, `UPGRADE_REQUIRED` after `FORBIDDEN`, `checkDefinition` refusing
  unknown keys and platform targets.
- Each gated action: refused when locked, a kept choice accepted, each limit at and over its value.
- The guest menu: fallbacks, the Explore redirect, the stage off, smart selling off, the cache expired on a plan
  change.
- The migration: existing restaurants on Premium.
- The platform owner: only they hold `plans.manage`; another Super Admin is refused every plan action and cannot
  deactivate the owner, change their email or remove their Super Admin status; the migration and `create-admin` pick
  the first Super Admin; at most one owner.
- End to end: the platform owner moves ATELIER to Basic; guests see the plain rail and no Explore, `/explore` redirects,
  the Brand tab shows the locks; moving it back restores everything.
- The full suite stays green.

## 13. Calls made without the user (please check)

1. **Three plans**, named Basic, Pro, Premium, with the contents of section 4. The user may change names and contents
   later from Settings without a developer.
2. **Existing restaurants move to Premium**, so no live menu changes on the day this ships.
3. **Kept open in every plan:** import and export (it is how Buzzify loads a client's menu, and export is the
   restaurant's own data), rollback (a safety net), all three languages (a core promise in Iraq), bulk prices and
   availability (daily work).
4. **Premium is the 3D plan** (Explore, the 3D dish, the melting-dish rail); **Pro is the design and selling plan**
   (fonts, rails, motion, branded QR, scheduling, smart selling).
5. **Limits:** 1 / 3 / unlimited menus; 500 MB / 2 GB / 10 GB of media.
6. **The WhatsApp button (Project 6) starts in Basic**, because restaurants here live on WhatsApp.
7. **No payment in the app**; the platform owner sets plans by hand and records deals in the note.
8. **The platform owner is the first Super Admin ever created**, and moving it needs the terminal script. (That only
   the user changes plans, and that the upgrade button opens their own WhatsApp, are the user's decisions.)
9. **Super Admins follow the restaurant's plan too**; the platform owner gets a shortcut to change it.
10. **Scheduled publishes made before a downgrade still happen.**
11. **The 3D stage key covers every 3D dish outside Explore**, the signature dish at the top of the menu included, so
    Basic and Pro menus open on 2D dish art and the 3D look stays Premium's.
12. **A duplicated menu starts within its new restaurant's plan**; a restored or rolled-back revision keeps what it had.
13. **The live demo restaurants stay on Premium** after the migration; the seed's spread applies to fresh databases.

## 14. Left to the builder

The layout of the Plan tab and the Plans settings within the Studio's existing components; how the plans setting is
cached; how the plan form detects a concurrent change; the exact wording of the hints (in the Studio's voice); the
order of the work.
