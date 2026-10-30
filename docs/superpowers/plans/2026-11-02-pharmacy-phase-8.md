# Pharmacy phase 8 (launch readiness): plan

Spec: `docs/superpowers/specs/2026-10-27-pharmacy-design.md` section 12 row 8 ("security, load, restore, UAT with a real pharmacy; all criteria of phases 0 to 7 green in CI; a trial restore succeeds; a load test with two devices"), sections 13 and 14 (risks), 15 (owner decisions).

Phase 8 builds nothing new for users. It proves what can be proved on a laptop and lists, without softening, what needs real infrastructure. Brainstorm result (short): the only product code change allowed is a small, safe fix for a finding; everything else is tests, drills and documents.

## Tasks

| # | Deliverable | Where |
|---|---|---|
| 1 | Security review of the whole pharmacy surface, an automated sweep with a mutation check, small safe fixes | `docs/pharmacy/security-review.md`, `tests/pharmacy/security-sweep.test.ts` |
| 2 | Concurrency and load run: tills selling the same stock plus a shift close, checked by independent SQL | `tests/load/pharmacy-concurrency.load.ts`, `docs/pharmacy/load-test.md` |
| 3 | Backup and restore drill on scratch databases only | `tests/load/pharmacy-restore-drill.load.ts`, `docs/pharmacy/restore-drill.md` |
| 4 | UAT kit, English and Arabic, with sign-off sheet and seed-data note | `docs/pharmacy/uat/` |
| 5 | Launch checklist (CI criteria for phases 0 to 7) and migration review table | `docs/pharmacy/launch-checklist.md` |

## Rulings

Each ruling says what was chosen and what it costs if the owner decides otherwise.

- **R8-1 The sweep reads definitions, it does not call them.** It enumerates every `ph.*` action and query by the same glob the isolation test uses, checks each carries a pharmacy permission, no Studio or till permission, a `ph` target and `restaurantId` in its input, and appears in the isolation registry by name. The registry's behaviour (other business, other branch) stays in `isolation.test.ts`. Cost if wrong: a definition could be in the registry by name yet have a weak case; the isolation test, not this one, is what would catch that.
- **R8-2 Routes are listed by hand with required guard tokens.** A new `route.ts` under the pharmacy folders fails until someone adds it with its guards. Cost if wrong: a token can be present in a comment and satisfy the check; the table is a tripwire for forgetting, not a proof of correctness (the route's own tests are the proof).
- **R8-3 The load run uses the real sale action in one Node process with one connection pool.** Tills are separate people with separate shifts, but not separate processes, and the network and the browser are not in the path. Cost if wrong: latencies are optimistic against Neon (add round trips); correctness (no oversell, no double sale) does not depend on this, it is decided by row locks in Postgres.
- **R8-4 The restore drill falls back to a logical copy when `pg_dump` is not installed.** This machine has no `pg_dump` or `pg_restore` (the embedded server ships only the server). The drill uses them when `PG_BIN` or the PATH has them and says which mode ran. Cost if wrong: the dump file format and `pg_restore` were not exercised here; run the same file on a machine with the client tools (it takes one environment variable) before relying on it.
- **R8-5 The drill never touches a shared database.** It creates two uniquely named scratch databases, refuses the shared ports, never uses `DROP ... FORCE`, and drops only the two names it made. Cost if wrong: none for data; a crashed run can leave a `drill_*` database behind, which the next run's last line reports and which is safe to drop by hand.
- **R8-6 A Neon point-in-time restore is not exercised.** It needs the owner's Neon project. Listed under "not verified".
- **R8-7 UAT scripts use a seed-data note, never production data.** Cost if wrong: a pharmacy that wants to rehearse with its own catalogue must import it into a trial business, not into the scripts.
- **R8-8 The catalog export refuses a cross-site request** (`Sec-Fetch-Site`), as the report export already did. Small, safe, covered by the sweep and by a behaviour test. Cost if wrong: a browser that sends no `Sec-Fetch-Site` header (old ones) is still served on the session alone, exactly as before.
- **R8-9 Everything else found is an open item with a severity, not a fix.** Cost if wrong: the owner may want some of them fixed before launch; each is written so it can be scheduled alone.
