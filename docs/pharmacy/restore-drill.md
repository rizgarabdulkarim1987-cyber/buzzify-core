# Pharmacy backup and restore drill (phase 8)

Spec row 8: "a trial restore succeeds". This drill proves that a seeded pharmacy database can be copied into a NEW database and that every table and every ledger total comes out identical. It does **not** prove a Neon restore.

## NOT exercised

- **A Neon point-in-time restore (or branch restore) was NOT exercised.** It needs the owner's Neon project and is the restore that production would actually use. Until it is done once on a Neon branch, "restore works" is unproven for production.
- **`pg_dump` and `pg_restore` did not run on the machine of this drill** (the embedded server ships no client tools). The run used the logical copy fallback. The dump file format, `pg_restore` ordering and Neon's own tooling are therefore untested here. The drill file uses the real tools automatically when `PG_BIN` (a folder) or the PATH has them; run it once on a machine that does and record the `mode` it prints.
- Restoring roles, extensions and grants: the drill's databases are created by the same superuser; Neon roles were not tested. Extension `pg_trgm` comes with the migrations.
- The application was not started against the restored database (checks are SQL on the restored data).

## How to run

```sh
BUZZIFY_DB_PORT=54503 npx vitest run --config vitest.load.config.ts tests/load/pharmacy-restore-drill.load.ts
# optional, to use the real tools:  PG_BIN="C:\path\to\postgresql\bin"
```

Safe by construction (all enforced in the file, `tests/load/pharmacy-restore-drill.load.ts`):

- It only connects to the server named by `BUZZIFY_DB_PORT` (must be set explicitly), only on 127.0.0.1, and refuses the shared ports 54329, 54349, 54381 and 54391.
- It reads no `DATABASE_URL` from `.env`; the application client is pointed at the scratch source database and nothing else, so Neon and production cannot be reached.
- It creates `drill_src_<time>_<random>` and `drill_dst_<time>_<random>`, refuses to start if either name exists, and at the end drops exactly those two names (a plain `DROP DATABASE`, never `FORCE`, never a name that does not match the pattern or was not created in this run). The last line it prints (`DRILL-CLEANUP`) lists any `drill_*` database still on the server; after the run it was empty.
- The shared test and development databases are neither read nor written (the vitest global setup still runs `prisma migrate deploy` on the test database as it does for every test run; that is the existing behaviour, not the drill's).

## Steps and what is checked

1. Create the source scratch database and run `prisma migrate deploy` on it (78 migrations).
2. Seed it through the REAL actions: a pharmacy with two branches, stock (1000 tablets per branch), a customer with a credit limit, a cash sale of 5 tablets (500 IQD), a credit sale of 3000 IQD, and a customer card payment of 1200 IQD.
3. Dump and restore into a NEW empty database: `pg_dump -Fc` then `pg_restore --no-owner --exit-on-error` when both exist; otherwise migrate the new database, empty the rows the migrations seed, and copy every table's rows as JSON with foreign keys and triggers off (`session_replication_role = replica`) as a restore does.
4. Compare: same list of tables (138); for every table the row count and an md5 of all rows (as text, sorted) are equal; then on the RESTORED database by SQL: sum of balances equals sum of movement deltas per bucket and per batch-branch (zero mismatched rows), customer balance 1800 (3000 owed, 1200 paid), cash total 500, two completed sales totalling 3500, all equal to the source's figures.
5. Drop both scratch databases and print what is left.

## Result (2026-11-02, port 54503)

| Item | Result |
|---|---|
| Mode | logical copy (no `pg_dump`/`pg_restore` installed) |
| Tables compared | 138 (27 non-empty, 93 rows in all) |
| Tables with different rows or checksum | none |
| Stock balances (available) | 1965 in source and restored; ledger deltas 1965; mismatched balance rows 0 |
| Customer balance | 1800 in both |
| Cash movements | 1 row, 500, in both |
| Completed sales | 2, total 3500, in both |
| Scratch databases left after the run | none |

The drill passed on the first complete run (an earlier attempt failed because the migrations seed rows in the new database; fixed by emptying them before the copy, in the new scratch database only).

## What a real restore needs on top of this

1. A recent backup: Neon point-in-time restore window checked, or a scheduled `pg_dump` stored off the machine (nothing is scheduled today).
2. Restore into a NEW Neon branch or database, never over production; point a staging build's `DATABASE_URL` at it and run the sweep, the acceptance suites that need no seed, and a hand check of one pharmacy's stock and customer balances against the pre-incident figures.
3. Record how long it took (the recovery time) and the age of the data restored (the recovery point).
4. Run this drill with the real client tools and keep its `mode` line.

Negative check not done: the comparison was not run against a deliberately corrupted copy to see it fail (the checksum compares every row's text, so a changed cell would differ, but this was not demonstrated).
