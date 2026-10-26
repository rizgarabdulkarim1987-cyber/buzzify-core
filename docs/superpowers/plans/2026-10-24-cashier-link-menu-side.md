# Menu side of the Cashier link: Implementation Plan

> Contract of record: `C:\Users\pc\Documents\GitHub\buzzify-restaurant\docs\superpowers\specs\2026-10-24-menu-cashier-link-contract.md` (revision 1). Menu facts and the corrections sent to the contract author: `docs/superpowers/specs/2026-10-24-cashier-link-menu-side.md`. Test numbers T1..T55 below are the contract's section 12.

**Goal:** Buzzify Menu serves its published catalog to a paired Buzzify Cashier, accepts a cashier-priced guest order through the table QR page and shows its status, takes sold-out toggles and product imports from the cashier, and tells the cashier when the catalog changes. A restaurant without a link behaves exactly as today.

**Architecture:** new `CashierLink` family of tables (migration written, not applied to any shared DB). Pure domain first (`src/server/domain/link/*`: signing, catalog serializer, pairing code, URL guard, order forwarding shape), then server (`src/server/link/*`: link repo, verified-route wrapper, cashier client, outbox), then routes (`/api/link/v1/*`, `/api/{tenant}/orders`, `/api/cron/link-events`, page `/{slug}/{locale}/o/{token}`), then Studio (pairing, status, unlink). No Core calls. Money stays integer IQD.

**Rules for every task:** tests first (red, then green); en/ar/ckb parity for every new string; no `git add -A`; commit with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; own dev DB `BUZZIFY_DB_PORT=54361` only, never 54329 or 54349; no push.

## Tasks

### Task 1: Signing (T1-T4, T6 part)
Files: `src/server/domain/link/signing.ts`, `tests/link/signing.test.ts`.
- `canonicalRequest(method, pathWithQuery, timestamp, bodyBytes)`, `signRequest(secret, ...)`, `verifyRequest({secret, headers, method, pathWithQuery, body, now})` returning `{ok:true}` or `{ok:false, status, code}` in the contract's order (header shape, 300 s skew, signature compare constant-time).
- Tests: both contract vectors reproduce exactly; flipping body byte/method/path/timestamp fails; 301 s stale; malformed headers.

### Task 2: Secrets, pairing code, URL guard (T7 part, T8)
Files: `src/server/domain/link/secret.ts` (AES-256-GCM `encryptSecret/decryptSecret`, `newLinkSecret()` = `bzl_`+base64url(32)), `pairing-code.ts` (10 chars of the contract alphabet, `ABCDE-FGHJK` display, `bzl1.` link code encode/decode, SHA-256 hash), `base-url.ts` (`checkCashierBaseUrl`: https, dev loopback, no credentials/path, refuses private, link-local, metadata, IPv6 literals in production), `tests/link/*.test.ts`.
- Tests: round trip, wrong key fails, tampered ciphertext fails; code alphabet and format; SSRF cases of T8 (169.254.169.254, 10.0.0.5, user:pw@host, path).

### Task 3: Catalog serializer (T13-T16 pure part)
Files: `src/server/domain/link/catalog-feed.ts`, `tests/link/catalog-feed.test.ts`.
- `buildCatalogFeed({catalog, menu, revision, overlay, publicBaseUrl, menuPlanActive})` -> contract `catalogResponse` (no hidden products, no inactive categories, `SOLD_OUT`, variants, groups, options with `available`; never `cost`, `stockCount`, media) and `catalogEtag(snapshotHash, overlay)`; refuses non-IQD (`currencyMismatch`) and over the maxima (`catalogTooLarge`).
- Tests: shape, omissions (deep scan for forbidden keys), ETag changes on sold-out toggle and is stable otherwise, size guards.

### Task 4: Schema and migration
Files: `prisma/schema.prisma`, `prisma/migrations/<ts>_cashier_link/migration.sql`, `tests/link/schema.test.ts`.
- Enums `CashierLinkStatus (ACTIVE, REVOKED)`, `LinkEventType (CATALOG_CHANGED, LINK_REVOKED, PLAN_CHANGED)`.
- `CashierLink` (id, restaurantId, menuId, status, secretCiphertext, cashierBaseUrl, cashierBusinessRef, cashierBusinessName, coreBusinessId?, menuPlanActive snapshot not stored, pairedAt, revokedAt, lastSeenAt; partial unique index: one ACTIVE link per menu and per restaurant).
- `CashierPairingCode` (id, restaurantId, menuId, codeHash unique, expiresAt, usedAt, attempts, createdById).
- `LinkRateLimit` (key, windowStart, count) and `CashierLinkEvent` outbox (id, linkId, eventId uuid unique, type, occurredAt, attempts, nextAttemptAt, deliveredAt, lastError).
- `CashierImportBatch` (linkId, batchKey unique, result Json) for idempotent imports.
- Migration SQL written by `prisma migrate diff`, applied only to the worktree DB. Tests check the constraints on the worktree DB.

### Task 5: Link repository and rate limit (T4, T5, T10)
Files: `src/server/link/repo.ts`, `src/server/link/rate-limit.ts`, `src/server/link/verify.ts` (the signed-route wrapper: load link, decrypt, verify, DB rate limit 600/min, update `lastSeenAt`), tests.
- Wrapper returns problem JSON `{error:{code,message}}` with `x-link-contract: 1` and `cache-control: no-store`; unknown link 401, revoked 403; 429 with `retry-after`.

### Task 6: Pair endpoint (T7-T11, T6)
Files: `src/server/link/pair.ts`, `src/app/api/link/v1/pair/route.ts`, `health/route.ts`, tests.
- Transaction: code valid/unused/unexpired, attempt counting (5 wrong burn), menu active and published and IQD, no other ACTIVE link, base URL guard, businessMismatch rule; create link; call cashier `/health` (1.5 s) and roll back on failure (`cashierUnreachable`); return the secret once. Secret never in a response afterwards, in logs or in audit rows (test greps).

### Task 7: Catalog, availability, import, unlink endpoints (T13-T16, T46-T50)
Files: `src/server/link/catalog.ts`, `availability.ts`, `import.ts`, routes under `src/app/api/link/v1/{catalog,products/[id]/availability,import,unlink}/route.ts`, tests.
- Catalog: live revision + live overlay via existing `getCatalog` pieces; `ETag`/304; `noLiveRevision` 409; `menuPlanActive` as defined in the contract (restaurant ACTIVE and a live `menu` Subscription, or no `menu` Subscription row).
- Availability: existing sold-out service, no publish, idempotent, audit actor `cashier-link:<linkId>`, guest cache expiry.
- Import: draft rows through the existing draft services, category reuse by case-insensitive name, all-or-nothing, idempotent per `batchKey`.
- Unlink: REVOKED, idempotent, cache expiry, no further events.

### Task 8: Cashier client and outbox (T52)
Files: `src/server/link/cashier-client.ts` (signed fetch to the stored base URL, 5 s timeout, no redirects, response size cap), `outbox.ts` (enqueue in the same transaction as publish, scheduled go-live, sold-out/hidden change and option sold-out; immediate attempt after commit; retry from `/api/cron/link-events` every minute with backoff; `eventId` stable across retries), `src/app/api/cron/link-events/route.ts`, tests.
- Failure never blocks the Studio action; test with a cashier stub that is down.

### Task 9: Env, flags, docs
Files: `src/server/env.ts` (`LINK_ENCRYPTION_KEY` optional, 32-byte base64, checked in the production check; absent means linking answers `linkingDisabled`), `.env.example`, `docs/deploy/*.md` (cron line for `/api/cron/link-events`), tests for env parsing.

### Task 10: Guest orders through the menu (T36-T40, T42, T43)
Files: `src/server/link/orders.ts`, `src/app/api/[tenant]/orders/route.ts` and `[requestId]/route.ts`, `src/app/[tenant]/[locale]/o/[token]/page.tsx` (+ locale-less route like `/t/{n}`), `src/ui/cart/*` link-order mode (plain prices, 30 lines, qty 20, note 300, `clientKey`, status panel, polling 5 s, `priceChanged` confirm), messages en/ar/ckb.
- Server route uses `handleTenantRequest` (5 per 10 minutes per IP), checks the tenant's menu has an ACTIVE link, forwards exactly `orderRequest` (ids only), maps cashier errors to guest codes, 3 s micro-cache for status, unknown status renders as waiting.
- Table token moves out of the URL after first load; not in analytics or logs.
- Cashier down: read-only menu, no order button.

### Task 11: Studio: connect, status, unlink
Files: permission `cashier.link` (OWNER default, Super Admin; never DESIGNER), `src/server/studio/services/cashier-link.ts`, actions, page `Connect a cashier` under the restaurant settings, messages en/ar/ckb, audit actions, enforcement test stays green.
- Create pairing code (15 minutes, single use, shown once as the `bzl1.` link code), show link status (cashier name, last seen, last event), unlink with confirmation (sends `link.revoked`).

### Task 12: Isolation and verification (T54)
- Existing suites stay green with no link rows; a test loads a menu-only restaurant's public pages, quote, and Studio screens and asserts no link code runs (no extra queries on the public path except one nullable relation read in the tenant lookup, which is cached with the slug).
- `npm run lint`, `npm run typecheck`, `npm test` (worktree DB), then browser check of `/o/<token>` in the three languages and RTL.

## Order and commits
Tasks 1-3 (pure) first, one commit each; 4 (migration) next; 5-9 (server); 10-11 (UI); 12 last. Each task ends with its tests green and its own commit.

## Not in this plan
Promotions/bundles in link orders (contract non-goal), Core calls, several menus per cashier, customer payment, webhook-free polling changes on the cashier side.
