# Pharmacy security review (phase 8)

Date: 2026-11-02. Scope: everything under `src/server/pharmacy`, `src/app/pharmacy`, `src/app/api/pharmacy`, the pharmacy parts of the framework (`src/server/studio/framework`), exports, print HTML, AI paths. Method: a systematic read of every definition and route, plus an automated sweep (`tests/pharmacy/security-sweep.test.ts`) that now fails when one is left ungated. This is a code review done on a laptop: **no penetration test, no production configuration review, no dependency audit was done** (see "Not verified").

## 1. Surface counted

| Kind | Count | Gate |
|---|---|---|
| Actions (`defineAction`) | 84 | each names a pharmacy permission in `ph`; the framework refuses a definition that names a Studio permission, a till permission, a feature, or an unknown `ph` key at load time |
| Queries (`defineQuery`) | 77 | same |
| Route handlers | 7 | table in the sweep, each with its guard tokens |
| Server Action wrappers (`src/app/pharmacy/_actions`) | 20 files | enforcement rules 1 to 3 (`tests/studio/enforcement.test.ts`) say they only forward to `invokePh*` |

Permissions in use (definitions per key, from the source): `purchase.manage` 59, `catalog.view` 31, `report.view` 12, `shift.use` 9, `transfer.manage` 8, `customer.manage` 7, `stock.count` 6, `stock.adjust` 6, `rx.dispense` 5, `ai.use` 4, `settings.manage` 3, `price.change` 3, `catalog.manage` 3, `return.approve` 2, `import.apply` 2, `rx.attachment.view` 1. Three writes are gated only by `catalog.view` and judged by their service: `ph.shifts.close` (the owner of the shift, or `report.view` with a reason), `ph.receipts.reprint` (writes a reprint row with a reason), `ph.assistant.ask` (the question is the person's own, spends the business's AI budget, open while read-only by design and now spending nothing in that state).

## 2. Pass by topic

### 2.1 Permission and tenant scope: PASS

- Every definition resolves the person's identity in the named pharmacy only (`resolvePhAccess`): a stranger, a person of another business, a deactivated user, an expired or lapsed subscription and the application kill switch are refused before the handler runs. A Super Admin has no pharmacy role without a live support grant, and must have two-factor enrolled.
- Branch confinement: models with a required `branchId` are reached only through `ctx.scoped` (the branch-scoped client), enforcement rule 8 forbids a pharmacy file from using any other base client, and only `src/server/pharmacy/stock.ts` may write the stock tables.
- Sweep: all 161 definitions carry a `ph` key, target `kind: 'ph'`, require `restaurantId` in their input, and are in the isolation registry (`tests/pharmacy/isolation.test.ts`, which runs each one with another business's ids and, for branch-scoped ones, another branch's).
- Writes that stay open while a pharmacy is read-only: exactly one (`ph.assistant.ask`); pinned by the sweep.

### 2.2 Input validation: PASS with notes

- Every input is a Zod schema; ids are bounded strings, money is `BigInt` minor units with a currency, quantities are integers. Raw SQL appears only as tagged templates (parameterised). The two `Prisma.raw(col)` uses (`reports-ledger.ts`, `reports-margin.ts`) receive string literals from inside the same file, never request data.
- Free text is length-capped. Import files: 5 MB, 10,000 rows. Prescription files: 5 MB, type decided by magic bytes (JPEG, PNG, WebP, PDF) not by the name or the declared type. Intake files: same sniffing, and a cap on the multipart body BEFORE parsing (`readBytes` with a limit).
- Note (Low): the import preview route reads the multipart form with its own limit and does not use `studioRoute`; it checks `sameOrigin` itself and runs through `invokePh` (identity and place from the session and the signed cookie, never the request).

### 2.3 Rate and abuse limits: GAP (Medium, open)

- There is no per-person or per-business request rate limit on the pharmacy actions and routes. What bounds abuse today: authentication, the permission, body caps, the AI monthly budget with reservations (`PhAiUsageMonth`), per-batch file counts, idempotency keys, and the 2-minute transaction ceiling. A signed-in but malicious cashier can still hammer search or sales.
- The framework has a rate-limit table used by auth, PIN sign-in and public actions (`src/server/http/rate-limit.ts`); extending it to `invokePh` (for example 600 reads and 120 writes per minute per person) is a small change, but the numbers need the owner's view of a busy till, so it was **not** added without a load profile.

### 2.4 File upload and attachment route: PASS

- Upload: POST through `studioRoute` (session, `ph` permission, same-origin, JSON error shapes), body cut off at the cap before parsing, type by magic bytes, stored in a private bucket under a server-made key (never the client's file name), sha256 recorded.
- Download of a prescription file (`/api/pharmacy/rx-attachments/[id]`): refuses a request marked cross-site by `Sec-Fetch-Site` or `Origin`, reads the session itself, runs `ph.rx.attachment.read` for that person on EVERY read (`rx.attachment.view`, business and branch confinement, support actors refused, read audited by count), and answers `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and `Content-Security-Policy: default-src 'none'; sandbox` so an active PDF cannot run. Every failure is a bare JSON error.
- Intake file links are signed and short-lived (five minutes at most); the development stand-in route answers 404 in production.
- Note (Low): the `/api/pharmacy/*` paths get the global security headers (nosniff, referrer policy, HSTS, base CSP) but not the `X-Frame-Options: SAMEORIGIN` that `/pharmacy/*` pages get (`next.config.ts`). The two JSON/file routes set their own restrictive headers; a framed JSON response is harmless, a framed PDF is covered by `sandbox`. Adding `/api/pharmacy/:path*` to `STUDIO_HEADERS` is a one-line change if wanted.

### 2.5 XSS and injection in print HTML: PASS

- The receipt is built from the stored sale by `renderReceiptHtml`; every dynamic value goes through `escapeHtml` (`& < > " '`) and numbers/codes through `<bdi dir="ltr">` after the same escape. No script, no external asset.
- It is shown in an `<iframe sandbox="allow-same-origin allow-modals" srcDoc>`: no `allow-scripts`, so even a missed escape could not run script. `allow-modals` is there for the print dialog.
- Labels and the other print layouts are React-rendered (escaped by React). No `dangerouslySetInnerHTML` exists under `src/app/pharmacy`.

### 2.6 CSV and XLSX formula injection: PASS

- Product export, report exports and the chain dashboard export write every text cell through `escapeCell` (a leading quote for `= + - @`, their full-width forms, after leading white space, and for a leading tab/CR/LF); numbers are written as numbers. The import takes exactly that quote off again. Tests: `tests/pharmacy/report-exports*.test.ts`, the export-sheet tests.
- Known, accepted (see README, R6-9b): Excel shows a text-number as text.

### 2.7 IDOR across businesses and branches: PASS

- The ids in an input are never trusted: the place is resolved from the session and the signed cookie for pages; for a hand-made input naming business B, the framework refuses a stranger and the handler's scoped client finds nothing of B's. The isolation suite proves this for each definition (refusal, no change to B's data). The attachment route repeats it for files.

### 2.8 Secrets in logs and audit: PASS

- Audit `changes` pass `assertAuditSafe`: any key matching patient, customer, prescription, doctor, national id, phone, address, birth, attachment, prescriber, licence, or free-text names (reason, note, question, answer, text, message) makes the action FAIL in development rather than log. Audit rows carry ids, amounts, versions and booleans such as `hasReason`.
- The only `console.error` calls under `src/server/pharmacy` print ids, error names and codes, never bodies, prompts, file contents or tokens. The AI price variables error prints the validation message only.
- Not covered: infrastructure logs (Hostinger, Neon) were not reviewed.

### 2.9 AI prompt injection: PASS with a caveat

- Assistant: the question and every tool table go to the model inside `<untrusted_data>` blocks with angle brackets escaped, phone numbers redacted, lengths capped, and a fixed system prompt saying to treat them as data. Numbers in the answer come from tools; a grounding check rejects a figure the tools did not return; proposals are never executed by the model (a person confirms).
- Invoice intake: the instruction text is fixed and says the invoice is data; output is schema-validated; nothing is approved without a person; the approval is a normal permissioned action.
- Caveat: only a mock model has ever run (README). Real-model behaviour against adversarial invoices and questions is **not verified**.

### 2.10 Session and support-actor access: PASS

- A Super Admin without a grant is refused like a stranger; with a grant they read only what its scopes map to (`catalog.read`, `sales.read`), every read writes a `support.read` audit row first and fails if it cannot, cost/profit and prescription files are never covered, a grant lasts 72 hours at most, and revoking works while read-only. Tests: `support.test.ts`, `support-grant.test.ts`, `rx-attachment-gate.test.ts`.
- The place cookie is HMAC-signed with the auth secret, bound to the user id, HttpOnly, SameSite=Lax, path `/pharmacy`, Secure outside development and test. A forged or other person's cookie is ignored.

### 2.11 CSRF on route handlers: PASS (one gap fixed)

| Route | Method | Check |
|---|---|---|
| `/api/pharmacy/intake/files` | POST | `studioRoute`: same-origin (Origin must match, or a JSON body) |
| `/api/pharmacy/rx-attachments` | POST | `studioRoute` |
| `/api/pharmacy/rx-attachments/[id]` | GET | `Sec-Fetch-Site` / `Origin` |
| `/pharmacy/catalog/import/preview` | POST | `sameOrigin` |
| `/pharmacy/select/choose` | POST | `sameOrigin`, changes only a signed cookie |
| `/pharmacy/reports/export` | GET | `Sec-Fetch-Site` |
| `/pharmacy/catalog/export` | GET | **was missing; fixed** (finding F-1) |

Server Actions rely on Next.js's own Origin check plus SameSite=Lax cookies.

### 2.12 Headers on private routes: PASS with the note in 2.4

`/pharmacy/*`: `X-Frame-Options: SAMEORIGIN`, CSP with `frame-ancestors 'self'`, `form-action 'self'`, `object-src 'none'`, nosniff, HSTS, referrer policy, a camera/microphone/geolocation/payment lockout. File and JSON routes set `no-store`; the sweep asserts every pharmacy route handler does (or delegates to a helper that does).

## 3. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-1 | Low | `GET /pharmacy/catalog/export` had no cross-site check, unlike the report export. A page on another site could make a signed-in user's browser download (and audit) a catalog export. The attacker cannot read the file (no CORS), so it is a nuisance and an audit-noise issue. | **Fixed** with RED then GREEN: sweep failed on the missing token; route now answers 403 for `Sec-Fetch-Site: cross-site`; behaviour test added. |
| F-2 | Medium | No rate limiting on pharmacy actions or routes (2.3). | Open |
| F-3 | Low | `/api/pharmacy/*` lacks `X-Frame-Options` (2.4). | Open |
| F-4 | Medium | The Hostinger preview build runs `prisma migrate deploy` against production Neon (see `launch-checklist.md`); a merge is a production migration. | Open (process) |
| F-5 | Medium | AI behaviour has only been run against a mock; prompt-injection resistance of a real model is unmeasured. | Open |
| F-6 | Low | A cashier-level user can reprint any receipt of the branch and an accountant can close another person's drawer, per the permission matrix (owner rulings, README). | Accepted, owner decision |
| F-7 | Low | Server Actions are covered by the framework Origin check only; no extra token. | Accepted |
| F-8 | Info | `ph.shifts.close`, `ph.receipts.reprint`, `ph.assistant.ask` are gated by `catalog.view` plus service rules rather than a dedicated permission. Intentional and documented. | Accepted |
| F-9 | Low | Row-level security is not in place (spike deferred, +137% p95). Isolation is application-level, proven by the isolation suite; a bug in the scoped client would not be caught by the database. | Accepted, owner decision (README) |

## 4. The automated sweep

`tests/pharmacy/security-sweep.test.ts` (no database needed beyond the vitest global setup):

1. Enumerates all pharmacy actions and queries from the folders by glob and fails if any definition: has no known `ph` permission; also names a Studio or till permission; does not target `kind: 'ph'`; does not require `restaurantId`; is a write left open while read-only without being on the reviewed list; or is missing from the isolation registry's source.
2. Fails if the registry names a definition that does not exist.
3. Enumerates every `route.ts` under the pharmacy folders and fails if one is unlisted, missing, lost a required guard token, or sets no `no-store`.
4. Mutation check: each checker is first run on deliberately bad samples (no `ph`, an invented permission, a Studio permission, a till permission, a wrong target, an input without the place, a write open while read-only, a definition absent from the registry, an unlisted route, a route that lost its guard) and must flag each.

Limit: it proves a gate EXISTS, not that the gate is the right one; the isolation and permission suites prove behaviour.

## 5. Not verified

- No dynamic scan or penetration test, no fuzzing of upload parsers (PDF/image/XLSX libraries) beyond size and type checks.
- Dependency vulnerabilities (`npm audit`) were not run.
- Production configuration: environment variables, secrets storage, bucket policy and CORS on the private R2 bucket (not created yet), Neon roles, Hostinger headers/TLS, WAF.
- Real-model prompt-injection behaviour.
- Browser-level checks of the headers on a deployed host (verified in source only).
