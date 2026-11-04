# Move to buzzify.tech with one host per product — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the app from `buzzify.tech`, with a separate, hard-to-guess host for each product (Menu and Cashier share one host; Pharmacy has its own) and for the super admin, and send the old `buzzify-menu.online` hosts to the new ones.

**Architecture:** `routeHost` (src/server/http/hosts.ts) today knows two hosts: the public menu host and one Studio host that serves `/studio`, `/pos`, `/pharmacy`. It becomes a list of *surfaces*, each host serving only the path prefixes of its own product. Sessions stay host-only (no cross-subdomain cookie), so the public menu host never receives a Studio session. On the VPS one reverse proxy with a wildcard certificate forwards every `*.buzzify.tech` name to the same Node process.

**Tech Stack:** Next.js (src/proxy.ts), zod env (src/server/env.ts), better-auth (src/server/studio/auth/auth.ts), vitest, nginx or Caddy on the VPS.

**Spec:** none written; the decisions below come from the conversation of 2026-11-04 and replace a spec.

## Global Constraints

- Main domain: `buzzify.tech`. **Every surface, the public menu included, has its own subdomain.** Public menus live at `https://menu.buzzify.tech/<menu-address>` (`PUBLIC_MENU_HOST=menu.buzzify.tech`); this name is public on purpose, since guests scan it from a QR, so it is short and readable. The apex `buzzify.tech` and `www.buzzify.tech` serve no menu and no app: they redirect to `PUBLIC_ROOT_REDIRECT` (the company page).
- No customers yet, so the old domain only needs a permanent redirect (301), not a long parallel period.
- Host names for the owner products and the super admin come from env only. **Never write the super admin host in the repository, docs or tests** (use `core.example.test` in tests).
- Sessions stay host-only: `advanced.cookiePrefix: 'studio'` and no `crossSubDomainCookies`. The public host must never receive a Studio session.
- Production answers 404 for any host that is not configured (the existing rule), so the server's raw IP or another name reaches nothing.
- Every new page response from a non-public host sends `X-Robots-Tag: noindex`.
- Pictures stay on `https://media.buzzify.me` (Cloudflare R2, bucket `buzzify-media`). `MEDIA_PUBLIC_URL` does not change and no `media.buzzify.tech` is created: saved pictures hold full `media.buzzify.me` addresses. `buzzify.me` must stay registered. Only the R2 CORS allowed origins change, to the studio host (Task 6).
- Do not change `/api/cron/*`: it keeps answering on any host and checks its own secret.
- Env names stay backward compatible: `PUBLIC_MENU_HOST`, `STUDIO_HOST`, `PUBLIC_MENU_ORIGIN`, `BETTER_AUTH_URL` keep their meaning. New optional names: `PHARMACY_HOST`, `CORE_HOST`, `LEGACY_HOSTS`.
- Retail is a separate app in its own private repository. This repository gets **no** `RETAIL_HOST` and no retail routes. The retail host is handled only by the VPS reverse proxy (Task 6): it forwards that host to the retail app's own port. This app answers 404 for the retail host name if a request ever reaches it (production's "unknown host" rule already does this).

## Review Focus

- A request to `/studio` or `/pos` on the pharmacy host: 404, not served.
- A request to `/pos` on the public apex host: 404 (already true; keep it).
- The super admin host serving `/studio/platform` while the menu owner host answers 404 for `/studio/platform`.
- `LEGACY_HOSTS` redirect keeps the path and query (`/atelier?lang=ar` stays intact).
- A signed-in studio session cookie is not accepted on the pharmacy host (host-only cookies).
- One studio host for Menu and Cashier: after sign-in a Menu-only restaurant sees no cashier entry and `/pos` is refused; a Cashier-only restaurant sees no menu entry and `/studio` menu pages are refused; a restaurant with both sees both, with one sign-in. Tests in `tests/studio/auth-hosts.test.ts` use the existing per-product subscription check; if the navigation does not already hide the unsubscribed product, Task 4 adds that.
- Password-reset and email links use the host of the product the user signed in on, not always `BETTER_AUTH_URL`.

---

### Task 1: Spike — can better-auth serve several hosts?

**Files:**
- Read: `src/server/studio/auth/auth.ts:140-230`, installed `better-auth` version in `package.json`
- Create: `docs/superpowers/plans/notes/2026-11-04-better-auth-hosts.md` (the finding, five lines)

**Interfaces:**
- Produces: a written answer to "does the installed better-auth accept a per-request base URL or an allow-list of hosts (`baseURL: { allowedHosts }` or similar)?" Tasks 4 depends on it.

- [ ] **Step 1:** Read the installed better-auth docs/types for `baseURL` and `trustedOrigins`; record which option allows more than one host and the minimum version.
- [ ] **Step 2:** Write a vitest in `tests/studio/auth-hosts.test.ts` that builds auth with two hosts and signs in through each; run it and record pass/fail in the note.
- [ ] **Step 3:** If no multi-host option exists, record the fallback: one auth instance per host created lazily from the request host (same secret, same database, different `baseURL`).
- [ ] **Step 4:** Commit the note.

### Task 2: Host surfaces in `routeHost`

**Files:**
- Modify: `src/server/http/hosts.ts`
- Test: `tests/http/hosts.test.ts`

**Interfaces:**
- Produces: `HostConfig` gains `pharmacyHost: string | null`, `coreHost: string | null`, `legacyHosts: string[]`; `studioHost` stays the menu-owner host. `routeHost(req, cfg): HostDecision` signature is unchanged.

- [ ] **Step 1: Write failing tests** in `tests/http/hosts.test.ts`:
  - `studio host serves /studio, /pos, /api/auth, /api/studio, /api/pos and /_next, and 404s /pharmacy once pharmacyHost is set`
  - `pharmacy host serves /pharmacy, /api/auth, /_next only`
  - `core host serves /studio including /studio/platform; studio host 404s /studio/platform once coreHost is set` (the list of super-admin-only prefixes comes from Task 2 step 3)
  - `/` on pos, pharmacy and core hosts redirects to their own landing path
  - `legacy host redirects to the same path and query on the public host`: `buzzify-menu.online/atelier?lang=ar` → `https://menu.buzzify.tech/atelier?lang=ar`; `studio.buzzify-menu.online/studio` → the studio host
  - `apex and www of the main domain redirect to rootRedirect for every path` (add `apexHost: string | null` to `HostConfig`, from `APEX_HOST=buzzify.tech`; the existing `www.` rule for the public host stays)
  - `unknown host in production with hosts configured answers notFound`
- [ ] **Step 2:** Run `npx vitest run tests/http/hosts.test.ts`; expect the new cases to FAIL.
- [ ] **Step 3:** List the super-admin-only route prefixes by reading `src/app/studio/(studio)/(app)/` (`platform`, `restaurants`, `pharmacies`, `billing`, `people` are candidates) and the role checks beside them; put the confirmed list in a `CORE_ONLY` constant next to `STUDIO_ONLY`.
- [ ] **Step 4:** Implement: replace the two `isHost` branches by a table `{ host, serves: string[], landing: string }` per surface; keep `within`, `normalizeHost`, `isHost`; legacy hosts are checked first and return `redirect` with the full path and search.
- [ ] **Step 5:** Run the file again; expect PASS. Run `npx vitest run tests/http`.
- [ ] **Step 6:** Commit `feat(hosts): one host per product, legacy hosts redirect`.

### Task 3: Env settings and the production check

**Files:**
- Modify: `src/server/env.ts` (host schema near line 55, `hostEnv` near 76, `check-env` rules near 286 and 365-416)
- Test: `tests/server/env.test.ts`, `tests/server/production-env.test.ts`, `tests/server/check-env-script.test.ts`

**Interfaces:**
- Consumes: the `HostConfig` fields from Task 2.
- Produces: `hostEnv()` returns `pharmacyHost`, `coreHost`, `legacyHosts` (comma-separated `LEGACY_HOSTS`, trimmed, lower-cased). `src/proxy.ts` passes them to `routeHost`.

- [ ] **Step 1: Write failing tests:** `PHARMACY_HOST` and `CORE_HOST` are optional; `LEGACY_HOSTS="a.com, b.com"` parses to `['a.com','b.com']`; production check reports when two hosts are equal (`PHARMACY_HOST` equal to `STUDIO_HOST`), reusing the existing "must differ" wording.
- [ ] **Step 2:** Run the three env test files; expect FAIL on the new cases.
- [ ] **Step 3:** Implement the schema, `hostEnv()` and the equal-host check; update `src/proxy.ts` to forward the new fields.
- [ ] **Step 4:** Run `npx vitest run tests/server tests/http`; expect PASS.
- [ ] **Step 5:** Commit `feat(env): PHARMACY_HOST, CORE_HOST, LEGACY_HOSTS`.

### Task 4: Sign-in on each host

**Files:**
- Modify: `src/server/studio/auth/auth.ts` (`baseURL` line 148, reset link line 163, `trustedOrigins` line 202)
- Test: `tests/studio/auth-hosts.test.ts` (from Task 1)

**Interfaces:**
- Consumes: Task 1's finding (multi-host option or lazy per-host instance) and Task 3's host list.
- Produces: `trustedOrigins` contains `https://` + every configured product host; the reset link uses the origin of the host the request came from.

- [ ] **Step 1:** Extend `tests/studio/auth-hosts.test.ts`: `sign-in on the studio host sets a cookie that the pharmacy host does not accept`; `a Menu-only restaurant is refused on /pos and a Cashier-only one on the menu pages`; `the reset link host matches the request host`; `an origin that is not configured is rejected`.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Implement per Task 1's finding; keep `cookiePrefix: 'studio'` and host-only cookies.
- [ ] **Step 4:** Run `npx vitest run tests/studio/auth.test.ts tests/studio/auth-hosts.test.ts`; expect PASS.
- [ ] **Step 5:** Commit `feat(auth): sign in on every product host, cookies stay host-only`.

### Task 5: Noindex on non-public hosts

**Files:**
- Modify: `src/proxy.ts`
- Test: `tests/http/proxy.test.ts`

- [ ] **Step 1:** Failing test: a `next` response for pos, pharmacy, studio and core hosts has `X-Robots-Tag: noindex, nofollow`; the public host's does not.
- [ ] **Step 2:** Run it; expect FAIL. **Step 3:** Set the header in the `next` case when the host is not the public host. **Step 4:** Run `npx vitest run tests/http`; expect PASS.
- [ ] **Step 5:** Commit `feat(proxy): noindex on private hosts`.

### Task 6: Replace the Hostinger shared-hosting doc with the VPS one

**Files:**
- Create: `docs/deploy/vps.md`
- Modify: `docs/deploy/hostinger.md` (top note: superseded by `vps.md` for the live site), `docs/deploy/production.md` where it names `buzzify.me` hosts

**Interfaces:** none (documentation task, but every command is run once by the executor before it is written down).

- [ ] **Step 1:** Write the VPS runbook with these sections, each with exact commands: DNS (`A` for `@` and `*` to the server IP; `www` redirect); wildcard certificate (Caddy with a DNS-provider plugin, or `certbot --manual --preferred-challenges dns -d buzzify.tech -d '*.buzzify.tech'`); reverse proxy forwarding every host to the Node port with `Host` and `X-Forwarded-Proto` preserved; process manager (pm2 or systemd) with the env file outside the repository; a second proxy block that forwards the retail host (`<RETAIL_HOST>`) to the retail app's own port, with its own process and env file (the retail repository keeps its own deploy; sessions are separate because cookies are host-only); the deploy command `git pull && npm ci && npm run build:host && restart`; the firewall rule that limits the core host to the owner's IP or VPN (optional).
- [ ] **Step 2:** Add the env table with the new hosts as placeholders (`<CORE_HOST>`, never the real name).
- [ ] **Step 3:** Add the third-party changes: Resend verifies `buzzify.tech` (DKIM/SPF/DMARC records) and `EMAIL_FROM` moves; R2 CORS allows the studio and pos origins; both cron URLs move to the core or studio host; `PUBLIC_ROOT_REDIRECT` stays or moves to the company site.
- [ ] **Step 4:** Commit `docs(deploy): VPS runbook for buzzify.tech`.

### Task 7: Cutover and rollback (run by the owner, executor assists)

**Files:** none changed in the repository.

- [ ] **Step 1:** Take a Neon snapshot of `production` (rollback point).
- [ ] **Step 2:** Do the Task 6 DNS and certificate steps; set the env with the **new hosts and `LEGACY_HOSTS=buzzify-menu.online,studio.buzzify-menu.online`**; build and start.
- [ ] **Step 3:** Verify, with expected results:
  - `https://menu.buzzify.tech/atelier` → the demo menu (200)
  - `https://buzzify.tech/atelier` and `https://buzzify.tech/studio` → redirect to `PUBLIC_ROOT_REDIRECT`, never a menu or an app page
  - `https://menu.buzzify.tech/studio` → 404; `https://<STUDIO_HOST>/studio` → sign-in page
  - `https://<STUDIO_HOST>/pos` → cashier screen for a restaurant with Cashier, refused for a Menu-only one; `https://<PHARMACY_HOST>/studio` → 404
  - `https://<CORE_HOST>/studio/platform` → opens after sign-in and 2FA; the same path on the studio host → 404
  - `https://buzzify-menu.online/atelier` → 301 to `https://buzzify.tech/atelier`
  - a raw `https://<server-ip>` and an unconfigured name → 404
  - a password-reset email arrives from `@buzzify.tech` with a link on the right host
  - a 15 MB photo uploads; a publish scheduled two minutes ahead goes live (cron)
- [ ] **Step 4:** Rollback if a check fails: restore the previous env values and restart; the old hosts are still in DNS until step 5.
- [ ] **Step 5:** Only after every check passes: leave the old domain renewed and redirecting; do not delete it.
