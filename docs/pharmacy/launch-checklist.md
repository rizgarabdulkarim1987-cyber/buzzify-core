# Pharmacy launch checklist (phases 0 to 7)

Spec row 8: "all criteria of phases 0 to 7 green in CI". This is the list of those criteria, the command that shows each, and what was last seen. Dated 2026-11-02, branch `claude/pharmacy-phases-2-8-59b2e1` at `a70254fb` plus the documents of this commit, on the private database (port 54503). **"Last result" means a local run on one machine, not a CI run**; no CI service was run. Every vitest command takes `BUZZIFY_DB_PORT=<private port>`; run one test file at a time.

## READ FIRST: merging is deploying, on PRODUCTION Neon

The Hostinger preview build runs `prisma migrate deploy` against the **production Neon database**. This is the case the owner reported; this review could not see the Hostinger or Neon settings, so confirm it before any build. The scripts agree with it: `build:host` and `vercel-build` (`package.json` lines 36 and 37) both run `prisma migrate deploy` before `next build`. So **any build of this branch, including a preview or a draft build, applies the 37 pharmacy migrations (and 6 other ones) to production**, unattended. Do not point a preview build at this branch until: the slug check, the Neon `pg_trgm`/ctype check, a Neon branch dry run and a backup are done (README, "Before merging or deploying"), or the preview has its own `DATABASE_URL`/`DIRECT_DATABASE_URL`. A failed migration leaves production in the failed state and breaks every later build, FOOD included, until `prisma migrate resolve` is run.

## A. Gates run in this review

| Criterion | Evidence command | Last result | Status |
|---|---|---|---|
| Types compile | `npm run typecheck` | no errors | PASS |
| Lint clean on source and tests | `npx eslint src tests` | 0 errors, 1 warning (`tests/pos/delivery-money.test.ts`, unused import, not pharmacy) | PASS |
| Every pharmacy action, query and route is gated (phase 8) | `npx vitest run tests/pharmacy/security-sweep.test.ts` | 19 passed | PASS |
| Migrations are additive (the hash-pinned exemptions hold) | `npx vitest run tests/pharmacy/migration-additive.test.ts` | 12 passed | PASS |
| Tenant registry covers every `Ph*` model | `npx vitest run tests/data/tenant-registry.test.ts` | 9 passed | PASS |
| Audit never carries patient fields | `npx vitest run tests/pharmacy/audit-fields.test.ts` | 7 passed | PASS |
| Studio enforcement rules | `npx vitest run tests/studio/enforcement.test.ts` | 77 passed, 1 failed: rule 4 "route handlers are built with studioRoute" (the known failure, the ai-import route), not a pharmacy file | KNOWN FAIL, not pharmacy |
| Isolation of every `ph.*` definition (business and branch) | `npx vitest run tests/pharmacy/isolation.test.ts` | 614 passed (about 80 s) | PASS |

## B. Acceptance criteria by phase (spec section 12)

| Phase | Criterion | Evidence | Last result | Status |
|---|---|---|---|---|
| 0 | A Super Admin creates a pharmacy and two branches and invites an owner; client and branch isolation and grants hold; menu and cashier golden test green | `npx vitest run tests/pharmacy/acceptance-phase-0-1.test.ts`; `tests/pharmacy/golden-food.test.ts`; `tests/pharmacy/support-grant.test.ts` | acceptance 0-1: 6 passed. Golden and grant files NOT re-run in this review | PASS (acceptance), golden/grant not re-run |
| 1 | No duplicate product, strength/form/pack may differ; barcode keeps zeros; 5,000-row import preview under the agreed time | same acceptance file; `tests/pharmacy/import-products.test.ts` | acceptance: passed. Import file not re-run | PASS (acceptance) |
| 2 | No negative stock (CHECK); correction by reversal; 90-day expiry alert equals the query; count with variance and approval | `npx vitest run tests/pharmacy/acceptance-phase-2.test.ts` | 9 passed | PASS |
| 3 | Scan, sell, printed receipt, shift report; N parallel sales of the last unit give one; resend gives one payment; print failure keeps the sale | `npx vitest run tests/pharmacy/acceptance-phase-3.test.ts` (also the phase 8 load run: `docs/pharmacy/load-test.md`) | 8 passed; load run 60 of 60 with no oversell | PASS |
| 4 | Ordered, received and invoiced quantities can differ; supplier statement equals the records | `npx vitest run tests/pharmacy/acceptance-phase-4.test.ts` | 1 passed (a single long scenario) | PASS |
| 5 | 50 invoices: no guessed field, draft only, duplicates found, outage allows manual entry, budget stops spending | `npx vitest run tests/pharmacy/acceptance-phase-5.test.ts` | 17 passed (39 s), **synthetic invoices and a scripted model only** | PASS on synthetic; **real-paper criterion NOT met** (`intake-uat.md`) |
| 6 | In-transit stock shows and is not sold; sum of branches equals each branch's sum | `npx vitest run tests/pharmacy/acceptance-phase-6.test.ts` | 22 passed | PASS |
| 7 | No invented figures; no permission bypass; prescription file unreadable without `rx.attachment.view` | `npx vitest run tests/pharmacy/acceptance-phase-7.test.ts` | 38 passed, **mock model only** | PASS on mock; real-model behaviour NOT verified |

Not re-run in this review (they exist and the controller's full suite covers them): the other 100-odd files in `tests/pharmacy`, `tests/studio/messages.test.ts` (string parity en/ar/ckb), the Playwright specs `tests/e2e/pharmacy-*.spec.ts` (need a browser and a dev server, `--workers=1`), `tests/pharmacy/transfers-perf.test.ts`, and the search load run.

## C. Phase 8 criteria

| Criterion | Evidence | Last result | Status |
|---|---|---|---|
| Security review | `docs/pharmacy/security-review.md`, the sweep | done; 1 fixed (F-1), open items F-2 to F-5 | DONE with open items |
| Load test with two devices | `docs/pharmacy/load-test.md`, `tests/load/pharmacy-concurrency.load.ts` | 3 scenarios, no oversell or double sale | DONE locally; NOT on Neon |
| Trial restore succeeds | `docs/pharmacy/restore-drill.md`, `tests/load/pharmacy-restore-drill.load.ts` | 138 tables identical, ledger totals equal | DONE on scratch databases; **Neon point-in-time restore NOT exercised** |
| UAT with a real pharmacy | `docs/pharmacy/uat/` | kit written, **not run** | OPEN |
| All of phases 0 to 7 green in CI | this file | no CI run; local runs above | OPEN until the full suite runs after merging main |

## D. Migration review (all folders in `main..HEAD`: 43)

Verdict key: ADD = only new tables, columns with defaults, indexes, enum values, rows of `Application`/settings. Checked with `git diff --name-only main..HEAD -- prisma/migrations`, a read of each file, and `migration-additive.test.ts`. No migration sets `lock_timeout`, and none uses `CREATE INDEX CONCURRENTLY`; every foreign key and index is taken inside the migration transaction.

| Migration | Pharmacy? | Verdict | Notes |
|---|---|---|---|
| 20261026203406_user_appearance | no | ADD | column on a user table |
| 20261026205851_announcements | no | ADD | new table |
| 20261026300000_complaint_suggestion | no | ADD | `ALTER TYPE ... ADD VALUE`; `Menu.feedbackEnabled` default true (the last pre-pharmacy migration) |
| 20261027100000_ai_menu_import | no | ADD | `ALTER TYPE "PosAiFeature" ADD VALUE` |
| 20261027100000_pharmacy_foundation | yes | ADD | `Restaurant.sector` default FOOD (takes a lock on `Restaurant`); five tables; one `Application` row, status DISABLED |
| 20261027110000_import_job_photos | no | ADD | column |
| 20261027110000_pharmacy_catalog | yes | ADD | nine tables |
| 20261027120000_import_job_translations | no | ADD | column |
| 20261027120000_pharmacy_barcode_unique | yes | ADD | unique index |
| 20261027130000_pharmacy_price_open_unique | yes | ADD | partial unique index |
| 20261027140000_pharmacy_search_indexes | yes | ADD | **`CREATE EXTENSION pg_trgm`**, GIN index; fails on production if the extension cannot be created; leaves `migrate deploy` failed |
| 20261027150000_pharmacy_search_text_required | yes | ADD | column constraint on an empty table |
| 20261027160000_pharmacy_stock | yes | ADD | eight tables, CHECKs, append-only trigger |
| 20261027170000_pharmacy_receipt_fields | yes | ADD | columns with defaults |
| 20261027180000_pharmacy_batch_identity_unique | yes | ADD | unique index |
| 20261027190000_pharmacy_movement_client_key | yes | ADD | partial unique index |
| 20261027200000_pharmacy_count_counted_at | yes | ADD | nullable column |
| 20261028100000_pharmacy_sales | yes | ADD | nine tables |
| 20261028110000_pharmacy_sales_integrity | yes | ADD | constraints on new tables |
| 20261028120000_pharmacy_sale_payload_hash | yes | ADD | column |
| 20261028130000_pharmacy_shift_closed_guard | yes | ADD | trigger |
| 20261028140000_pharmacy_return_payload_hash | yes | ADD | column |
| 20261028150000_pharmacy_sale_hold_payload | yes | ADD | column |
| 20261028160000_pharmacy_receipt_reprint_key | yes | ADD | columns, key |
| 20261028161000_pharmacy_receipt_reprint_reason | yes | ADD | column |
| 20261028170000_pharmacy_shift_closed_by | yes | ADD | column |
| 20261028171000_pharmacy_settings_timezone | yes | ADD | columns on `PhSettings` |
| 20261029100000_pharmacy_purchasing | yes | ADD | eleven tables |
| 20261029110000_pharmacy_purchasing_receipt_supplier_link | yes | ADD | nullable columns |
| 20261029120000_pharmacy_supplier_payload_hash | yes | ADD | column |
| 20261029130000_pharmacy_credit_allocation_replay | yes | ADD | column |
| 20261030100000_pharmacy_intake | yes | ADD | five tables |
| 20261030110000_pharmacy_intake_fixes | yes | ADD | table, columns |
| 20261030120000_pharmacy_intake_row_match | yes | ADD | columns |
| 20261031100000_pharmacy_transfers | yes | ADD | two tables |
| 20261031100100_pharmacy_sales_report_index | yes | ADD | index |
| **20261031110000_pharmacy_transfers_fixes** | yes | **EXEMPT (hash-pinned)** | **11 DROP statements**: drops constraints, a column and an enum of the two transfer tables, and re-adds them. The migration starts by stopping if either table has a row. Exemption pinned to the file's sha256 in `migration-additive.test.ts`; any edit loses it. Safe only while those tables are empty, which holds for any database that never ran the earlier transfer migration with data. **Owner choice: squash it into `20261031100000` before the first deploy.** |
| 20261031120000_pharmacy_transfers_override | yes | ADD | column |
| 20261031130000_pharmacy_report_indexes | yes | ADD | indexes |
| 20261031140000_pharmacy_transfer_line_request_index | yes | ADD | index |
| 20261101100000_pharmacy_phase7 | yes | ADD | seven tables; adds columns with defaults to `PhSettings` (existing table, new columns only); `ALTER TYPE ... ADD VALUE` for `PhCashMovementType` (`CUSTOMER_PAYMENT`) and `PhPaymentMethod` (`CREDIT`) |
| **20261101100100_pharmacy_cash_movement_customer_payment** | yes | **EXEMPT (hash-pinned), CHECK DROP/ADD** | one statement drops and re-adds `PhCashMovement_amount_sign`, widened by one type. A drop/add of a CHECK on `PhCashMovement` re-validates existing rows (a full scan under lock) and there is a moment in the statement with no CHECK; inside one transaction it is atomic. **Owner choice: squash with the phase 7 migration before the first deploy.** |
| 20261101100200_pharmacy_return_credit | yes | ADD | columns |

Flags summary: two hash-pinned exemptions (`...110000_pharmacy_transfers_fixes`, `...100100_pharmacy_cash_movement_customer_payment`); the only CHECK DROP/ADD is in the second (the first drops and re-adds several CHECKs and foreign keys of the empty transfer tables); no migration drops, renames, truncates or updates data outside those; three `ALTER TYPE ... ADD VALUE` (complaint, AI feature, phase 7 twice) which Postgres runs outside any use of the new value in the same transaction.

## E. Before launch, in order (from the README, restated)

1. Make sure no build points at production before the following are done (see the box at the top).
2. Slug check: no production menu uses the slug `pharmacy`.
3. On a Neon branch of production: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, check the database ctype is UTF-8, run the whole `migrate deploy` there (never done: the owner's Neon preview branch was not available).
4. Backup of production and a Neon restore exercise (not done; see `restore-drill.md`).
5. Decide the two squashes; consider `SET lock_timeout` at the top of the foundation migration.
6. Enable the application (`Application(pharmacy)` ACTIVE) before starting subscriptions.
7. Private intake bucket and its four `PH_INTAKE_R2_*` variables, `AI_PRICE_*` matching the model, plan AI budget; native review of ar and ckb strings.
8. UAT with the first pharmacy (`docs/pharmacy/uat/`), owner questions in the sign-off sheet.
