# Pharmacy RLS spike (Task 13): result

Date: 2026-10-27. Time-boxed spike, report only. Script: `scripts/spikes/rls-spike.ts` (THROWAWAY; deleted in Task 25
since the decision is DEFER; recover it from git at commit `7d25a6d` to re-run the spike).

## Decision: DEFER

Row-level security stays out of the pharmacy tables for this plan. Tenant isolation remains `ctx.scoped` (the
restaurant- and branch-scoped Prisma client from `src/server/data/tenant-db.ts`) plus the enforcement tests.

Measured reason: the product search, the hottest pharmacy read, misses the 10% budget by a wide margin.

- The policy alone costs **+137% p95** on an indexed product search (3.16 ms vs 1.33 ms, both inside a `SET LOCAL`
  transaction; run 2: +139%). The cause is structural, not noise: under RLS the planner may not evaluate a non-`LEAKPROOF` user
  predicate before the policy's predicate, and `lower(text)` and `textlike` (`LIKE`) are not leakproof. The index is then
  used only for `restaurant_id`, and every row of the business is fetched and filtered (plans below). The cost grows with
  catalogue size. `ILIKE` and the `pg_trgm` operators that Task 21 plans for are not leakproof either, so trigram search
  would hit the same wall. Marking a function `LEAKPROOF` needs a real superuser, which Neon does not give.
- The transaction that `SET LOCAL` needs costs **+121% to +157% p95** on its own, for searches and inserts alike (one
  statement becomes `BEGIN`, `set_config`, the statement, `COMMIT`). Measured on loopback (about 0.1 ms per round trip);
  on Neon each extra round trip costs the network latency between the function and the database, so the real penalty is
  larger (NOT MEASURED).

The safety properties all held (fail closed, no leak across pooled connections, migrations unaffected), so RLS is
viable as a pattern. It is the cost on search that rules it out now.

## Method

- Database: the private worktree Postgres only (`127.0.0.1:54381`, PostgreSQL 18.4, embedded, Windows). The script
  refuses to run unless both `DATABASE_URL` and `DIRECT_DATABASE_URL` resolve (through `pg`'s own parser,
  `scripts/database-target.ts`) to a loopback host on port 54381.
- Scratch objects only, created and dropped by the script: schema `rls_spike` with two identical tables
  (`product_plain`, `product_rls`) and the login role `rls_spike_owner`. The run ends by checking that 0 schemas and 0
  roles are left (both runs: `{"schemas":0,"roles":0}`). No real table, `prisma/schema.prisma` or migration was touched.
- App path: `PrismaClient` with `new PrismaPg({ connectionString })`, exactly as `createPrisma` in
  `src/server/data/prisma.ts` builds it, connected as `rls_spike_owner`. Queries are `$queryRaw` / `$executeRaw`, since
  scratch tables have no model. Interactive `$transaction` with `set_config('app.restaurant_id', $1, true)` (the
  function form of `SET LOCAL`, which takes a bind parameter). Prisma's query log for one such transaction shows `set_config`, the statement and `COMMIT`; the adapter's `BEGIN` is not logged but must precede them for `SET LOCAL` to take effect.
- Role choice: the app role **owns** the tables and is `NOSUPERUSER NOBYPASSRLS`; the table has `ENABLE` and
  **`FORCE ROW LEVEL SECURITY`**. That is the production shape most likely to apply (the app and `migrate deploy`
  probably connect as the same Neon role, which owns the tables). The local `postgres` user is a superuser and bypasses
  RLS even with `FORCE`, so it was used only to create and seed.
- Policy (same for `USING` and `WITH CHECK`):
  `restaurant_id = NULLIF(current_setting('app.restaurant_id', true), '')`.
  `missing_ok = true` because without it an unset setting raises `unrecognized configuration parameter` on a fresh
  connection but returns `''` on a reused one, which is inconsistent. `NULLIF` because after one `SET LOCAL` the
  placeholder reads `''`, not NULL, for the rest of the session; `NULLIF` turns both unset states into NULL, and
  `col = NULL` matches nothing.
- Data: 20 businesses x 5,000 products per table (100,000 rows each), index
  `(restaurant_id, lower(name) text_pattern_ops)`, `ANALYZE` after seeding.
- Search: `WHERE restaurant_id = $1 AND lower(name) LIKE 'product xx%' ORDER BY lower(name) LIMIT 20`
  (about 20 matches out of 5,000). Insert: one row.
- Timing: 100 warm-up then 1,000 measured iterations per variant; every iteration runs each variant once, in rotating
  order, so drift and caching affect all variants alike. Wall time around the Prisma call, sequential, one client
  (default pool).
- Pooled reuse: no PgBouncer on this machine (`where pgbouncer` finds nothing) and Neon was not contacted. Reuse was
  simulated with a `PrismaPg` pool of `max: 2` shared by 8 concurrent interleaved transactions.

## Numbers

Two full runs; run 1 is quoted above, run 2 in brackets. Milliseconds, p95 (p50 in run 1).

### 1,000 indexed searches

| Variant | p95 run 1 | p50 run 1 | p95 run 2 |
|---|---|---|---|
| A. Plain table, no transaction (today's `ctx.scoped`) | 0.603 | 0.388 | 0.507 |
| B. Plain table in a transaction with `SET LOCAL` | 1.334 | 0.940 | 1.184 |
| C. RLS table, `SET LOCAL`, explicit `restaurant_id` filter kept | 3.157 | 2.165 | 2.827 |
| D. RLS table, `SET LOCAL`, policy only | 3.099 | 2.141 | 2.760 |

Overhead of C: **+137% vs B** (policy alone; run 2: +139%), **+424% vs A** (full adoption; run 2: +458%). Budget 10%.

### 1,000 inserts

| Variant | p95 run 1 | p50 run 1 | p95 run 2 |
|---|---|---|---|
| A. Plain table, no transaction | 0.430 | 0.323 | 0.446 |
| B. Plain table in a transaction with `SET LOCAL` | 1.106 | 0.840 | 1.148 |
| C. RLS table, `SET LOCAL` | 1.109 | 0.854 | 1.199 |

Overhead of C: **+0.3% vs B** (run 2: +4.4%, within budget: the `WITH CHECK` costs nothing measurable),
**+158% vs A** (run 2: +169%: the transaction).

### Why search loses the index (EXPLAIN, `restaurant_id = 'spike-biz-03'`, prefix `product a1`)

- Plain: `Index Scan using product_plain_search`, `Index Cond: restaurant_id = ... AND lower(name) ~>=~ 'product a1'
  AND lower(name) ~<~ 'product a2'`. Reads about 20 index entries.
- RLS: `Bitmap Index Scan on product_rls_search`, `Index Cond: restaurant_id = ...` only; then
  `Filter: lower(name) ~~ 'product a1%'` over all 5,000 rows of the business.
- `pg_proc.proleakproof`: `texteq` true, `text_pattern_ge` / `text_pattern_lt` true, `lower(text)` false,
  `textlike` false, `texticlike` false, `textregexeq` false.

### Fail closed (app role, outside any transaction)

| Check | Result |
|---|---|
| Fresh connection, no setting, `SELECT count(*)` | 0 rows |
| Reused connection after a committed `SET LOCAL` (setting now reads `""`) | 0 rows |
| `UPDATE` / `DELETE` of every row with no setting | 0 rows affected each |
| `INSERT` with no setting | refused: `new row violates row-level security policy` |
| Setting = business A, `INSERT` for business B | refused, same error |
| `current_setting('app.restaurant_id')` (no `missing_ok`) on a fresh connection | error: unrecognized configuration parameter |
| Same role, table with `NO FORCE ROW LEVEL SECURITY`, no setting | **101,100 rows (all)**: `FORCE` is load-bearing for an owner role |
| Superuser, table with `FORCE`, no setting | **101,100 rows (all)**: the app must never connect as a superuser or a `BYPASSRLS` role |
| Session-level `set_config(..., false)` then the next query on the same connection | 5,055 rows of the previous business: only `SET LOCAL` is safe |

Inside a transaction with the setting: 5,055 rows (that business only).

### Pooled reuse: 200 interleaved transactions, two businesses

Pool `max: 2`, 8 transactions in flight, each with a 0 to 2 ms sleep between `SET LOCAL` and the read, alternating
businesses 07 and 08; each transaction reads every visible row with `pg_backend_pid()` and
`current_setting('app.restaurant_id', true)`, and after each one a query outside any transaction runs on the same pool.

| Measure | Result |
|---|---|
| Distinct backend connections used | 2 (the pool's maximum, reused across all 200 transactions) |
| Rows checked inside transactions | 1,011,000 |
| Rows of the other business seen | **0** |
| Transactions whose setting was not their own | **0** |
| Rows seen by the follow-up query outside a transaction | **0** |
| Contrast: session-level set on a pool of 1, every 4th request "forgets" to set | 5 of 20 requests read the previous business's rows |

### Migrations

- `prisma migrate deploy` with the forced-RLS scratch table present: `No pending migrations to apply.` (exit 0). It runs
  as the `DIRECT_DATABASE_URL` user, here the superuser `postgres`, which bypasses RLS; locally that proves only that RLS
  on a table does not disturb Prisma's migration bookkeeping (`_prisma_migrations` has no RLS).
- The part that matters for Neon, run as the forced owner role with no setting:
  - DDL (`ALTER TABLE ... ADD COLUMN ... DEFAULT false`): ok. RLS never applies to DDL.
  - A backfill `UPDATE` of every row: **0 rows affected, silently**.
  - A seed `INSERT` (like the `Application` row of Task 10): **refused** by `WITH CHECK`, so the migration fails loudly.
  So a future migration that writes rows into a forced-RLS `Ph*` table must set the GUC per business or run as a
  separate `BYPASSRLS` role. Task 1's guard already refuses `UPDATE`/`DELETE` in this plan's migrations; seed `INSERT`s
  would break.

## Caveats and what was NOT MEASURED

- **Neon pooler: NOT MEASURED.** Neon's pooled endpoint is PgBouncer in transaction mode. `SET LOCAL` is
  transaction-scoped, so by design it cannot outlive the transaction on a server connection that PgBouncer hands to the
  next client, and the local pool test agrees. To confirm, re-run the leak section of the script against a **Neon
  branch** (never the production branch), with `DATABASE_URL` = the branch's pooled URL and `DIRECT_DATABASE_URL` = its
  direct URL, after relaxing the script's port guard for that run only. Also measure there: the search and insert p95
  (the network round trips will dominate), and whether the interactive transaction pins a pooler connection for its
  length.
- **Neon role attributes: NOT MEASURED.** Before any adoption, run on the branch as the app user:
  `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` and check table ownership. If the
  app role has `BYPASSRLS`, RLS does nothing for it and a separate non-owner app role is required.
- Local timing is loopback on Windows with an embedded Postgres; absolute numbers are small and noisy, the ratios are the
  finding. Two runs agree to within about 10%.
- A leakproof-friendly search (a stored lowercased column searched by `~>=~` / `~<~` range, whose operators are
  leakproof) might keep the index under RLS. Not tried (time box); it would not help `pg_trgm` similarity search.
- `prisma migrate dev` / `migrate diff` do not model policies; RLS would live only in hand-written migration SQL, and
  drift detection would not see a dropped policy. Not measured.

## If this is revisited: the pattern a follow-up task would use per `Ph*` table

Only after the search cost is solved (leakproof search shape, or a measured Neon run within budget).

1. In the migration that creates each `Ph*` table with a required `restaurantId` (Task 1's guard allows these
   statements; they are additive):
   ```sql
   ALTER TABLE "PhX" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "PhX" FORCE ROW LEVEL SECURITY;
   CREATE POLICY tenant ON "PhX"
     USING ("restaurantId" = NULLIF(current_setting('app.restaurant_id', true), ''))
     WITH CHECK ("restaurantId" = NULLIF(current_setting('app.restaurant_id', true), ''));
   ```
   Branch scope stays in `ctx.scoped` (a second GUC for branch lists is possible but was not measured).
2. The framework's pharmacy action and query runners (`src/server/studio/framework/{action,query}.ts`, `ph` target)
   open every pharmacy unit of work as `prisma.$transaction(async (tx) => { await tx.$executeRaw\`SELECT
   set_config('app.restaurant_id', ${restaurantId}, true)\`; ... })` and build `ctx.scoped` on that `tx`. `ctx.scoped`
   keeps its explicit filters as the first line of defence; RLS becomes the second.
3. Cost to the existing design: every pharmacy read becomes an interactive transaction (3 extra statements, a pinned
   connection for its length, Prisma's interactive-transaction timeout applies to reads); `set_config` is raw SQL, so it
   needs one more `no-restricted-properties` exemption in the framework; tests and seeds that write `Ph*` rows with the
   base client must set the GUC or connect as `BYPASSRLS`; support-access reads (Task 11) set the GUC to the granted
   business; cross-business platform jobs (billing, retention) need a `BYPASSRLS` role and connection string of their
   own; migrations that write `Ph*` rows need the same.
