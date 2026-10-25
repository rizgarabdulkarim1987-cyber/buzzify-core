# Cashier phase 9: the optional Buzzify AI package (inside Core)

> Steps use checkbox syntax. Executed inline, TDD per task. Nothing is pushed; the migration is committed locally only.

**Goal:** Port cashier plan 11 (`buzzify-restaurant/docs/superpowers/plans/2026-10-24-cashier-11-ai.md`) into Core as a till add-on. A restaurant whose AI package is switched on (by the Super Admin) gets, for OWNER and MANAGER: **Ask Buzzify AI** (answers only through ten narrow read tools), a **morning summary** (day / week / month), **alerts** worth reviewing (cash differences, discounts, cancellations, refunds) with low stock, **AI supply entry** (invoice photo, PDF or text becomes a draft a person checks and saves), and **suggested complaint categories**. With the package off none of it renders, every AI action answers `aiDisabled` before reading anything, and the till behaves exactly as in phase 8. If the provider fails, nothing else is affected.

**Behaviour source:** the old plan 11 (rulings kept unless changed below). **Pattern source:** phases 7 and 8.

## Core-specific rulings (what changes in the port)

1. **Names and tables.** `PosAiPackage` (one row per restaurant: `enabled`, `monthlyLimit`, `syncedAt`), `PosAiUsageMonth (restaurantId, month)`, `PosAiCall` (metadata only), `PosAiSummary` (cache). All carry `restaurantId` and are listed in `RESTAURANT_SCOPED_MODELS`. `PosComplaint` gains `aiCategory`, `aiSummary`, `languageGuess`, `aiLabeledAt` (nullable suggestions; the customer's own `category` is never changed). One migration `20261026200000_pos_ai_package`, **later than phase 8's `20261026100000`, committed locally only**.
2. **The switch.** There is no Core sync in v1: the **Super Admin** sets it from `/studio/cashier` through `pos.setAiPackage` (`platform.settings`, platform target, audit `pos.ai.package` filed under the restaurant). It replaces the old operator script. Payment is arranged by hand. AI also needs the live `cashier` subscription: every AI definition is a normal till definition (no `allowLapsed`), so a lapsed subscription already blocks it.
3. **Order of checks.** The Studio framework checks the till permission before `run`, so a CASHIER gets `FORBIDDEN` even with the package off (old plan: `aiDisabled` first). Inside `run`, `requireAi` is the first statement: it reads only `PosAiPackage` and throws `AiNotEnabledError` before any other read or provider call. The permission matrix is not a secret, so this changes nothing about what leaks.
4. **Failures are data.** AI definitions catch AI errors and return `{ ok: false, code }` (codes: `aiDisabled`, `aiLimit`, `aiUnavailable`, `aiRefused`, `ungrounded`, `unreadable`, `tooLarge`, `invalid`, `failed`). Unexpected errors are logged by name only (never the message, which could carry content) and answer `failed`. The framework's own `FORBIDDEN`/`INVALID` still apply to the shell.
5. **Permissions, no new ones.** Ask, summary, alerts need `report.view`; supply entry `purchase.manage`; complaint labels `complaint.manage` (+`complaint.view` to see them); the owner's package page needs `settings.manage`. So OWNER/MANAGER get every feature, CASHIER and KITCHEN none. The AI acts with the caller's own permissions: tools are filtered by role (`toolsFor`).
6. **Tools wrap phase 8 services, they do not change them.** `readDailyReport`, `readRangeReport`, `listItems`, `listLowStock`, `listSuppliers`, `listPurchaseInvoices`, `listComplaints`, `countNewComplaints` take `(db, restaurantId, …)`. The two `find*ByName` tools filter the already-bounded lists in memory by `nameKey`. Shapes drop ids, supplier phone/notes, free staff text (cancel reasons), and `lastCost` without `purchase.manage`; complaint excerpts go through `redactPhones`.
7. **Provider.** `@anthropic-ai/sdk` pinned exactly. `AI_PROVIDER=anthropic|fake`, key only in `src/server/ai/provider/anthropic.ts` (+ `index.ts`), never `NEXT_PUBLIC_*`. Models from env with defaults `claude-opus-5-5` (ask, extract; effort `medium`), `claude-haiku-5-5` (phrase, classify; effort `low`). No sampling params, no forced `tool_choice` (always `auto` + `strict: true`), no thinking config (always-on models). Opus requests carry `betas: ['server-side-fallback-2026-07-01']` + `fallbacks: 'default'`; a `refusal` becomes `AiRefusedError`. Tests never call a real provider (`FakeProvider`, refused in production).
8. **Screens (no edits to phase 8 files).** A new till area `/pos/ai` with tabs Ask / Summary / Alerts / Supply / Complaints, plus `/pos/ai/package` (owner's page, visible even when off). Supply entry is its own review form in the AI area that saves through the **unchanged** `pos.createPurchase` action with a client key; complaint labels are shown on `/pos/ai/complaints`, so `complaints.ts`, `PurchaseForm.tsx` and the phase 8 pages stay untouched. The till nav gets one entry `ai` (`report.view`, shown only while the package is on). The file upload route is `POST /api/pos/ai/supply-extract` (multipart, 6 MB cap before the body is read, session via the same till actor as other till routes).
9. **No `OP_KINDS` change.** Every AI action is online only and not queueable; the service worker already never caches HTML or API answers.
10. **Messages** in `src/studio/messages/pos-ai/{ar,ckb,en}.ts`, spread into the three trees. Alerts say "worth reviewing" (تستحق المراجعة / شایەنی پێداچوونەوەیە); the words fraud/theft are never used (tested over the trees).
11. **Audit names** (3-language labels): `pos.ai.package`, `pos.ai.complaint.label`. AI calls themselves are metadata rows in `PosAiCall`, not audit rows.

## Constraints

Own DB port 54461 (not 54329/54397/54411); no push/PR/merge/production; ar/ckb/en trees identical; RTL logical CSS; 48px targets; AI text `dir="auto"`, numbers LTR; every new definition in the `TILL` list of `tests/studio/cross-tenant.test.ts` (`pos.setAiPackage` in `PLATFORM_ONLY`); integer IQD; LF endings; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Tasks

1. **Schema + package switch**: models, migration, tenant registry, `tests/helpers/db.ts` reset, audit labels, `requireAi`, errors, visibility, `baghdadMonthOf`, `pos.setAiPackage` + overview data, package page.
2. **Gateway**: provider types, fake, Anthropic mapping, usage counter (atomic reservation), `runAi`, error codes.
3. **Grounding / untrusted / prompts** (pure).
4. **Tool registry** over the phase 8 services.
5. **Ask** action + page.
6. **Alerts** (rules engine + low stock) + page.
7. **Summary** (facts, cache, template) + page.
8. **Supply entry** (service, route, review form).
9. **Complaint labels** (narrow service, classifier, page).
10. Cross-tenant lists, isolation, full vitest/tsc/eslint, browser check (ar, ckb, en, 375px), independent review + fixes, CRLF check, commit.

## Review focus

Package off → nothing renders and nothing is read; cashier cannot reach costs or AI; a number not in any tool result is rejected; prompt injection through invoice/complaint text yields only a draft / labels; phone numbers never reach the provider or the audit; usage limit holds under concurrency; double Save is one invoice; cross-tenant for every table; menu-only restaurants run no AI code.

## As built (differences from the plan above)

- **Alerts use no model.** `findUnusualOperations` is a fixed rules engine over the day's report; the screens turn each alert into a calm sentence ("worth reviewing"). It spends no request, so the cached-phrasing table is used by the summary only.
- **The summary is facts first.** `pos.aiSummary` returns the figures of the finished period and the text kept for the same figures; `pos.aiPhraseSummary` is the one request that writes the text, checked for numbers the figures do not hold and kept in `PosAiSummary` until the figures change.
- **Permission is checked before the package.** The framework checks the till permission before `run`, so a cashier gets FORBIDDEN whether or not the package is on; once allowed, a package that is off answers `{ ok: false, code: 'aiDisabled' }`, and every AI failure is returned as data (never an exception message).
- **Supply entry has its own upload route** (`POST /api/pos/ai/supply-extract`, cut off at 6 MB before parsing) that runs `pos.aiSupplyExtract`; it returns a draft only. Saving goes through the unchanged `pos.createPurchase` from the review form, with a client key.
- **Complaint labels** are written by `pos.aiLabelComplaints` (the model sees only handles and phone-free text; the audit row holds a count). The guest's own text, category and contact are never touched.
- **No Playwright e2e** for this phase: the behaviour is covered by vitest (services, definitions, upload reader, messages) and by a check in the built-in browser in the three languages at 375 px.
- The Super Admin switch lives on `/studio/cashier` (a new AI column on `pos.overview`) and calls `pos.setAiPackage`.
