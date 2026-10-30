# Pharmacy concurrency and load run (phase 8)

Spec row 8: "a load test with two devices". The earlier load test (`tests/load/pharmacy-search.load.ts`) covers search at 50,000 products with two clients (p95 under 150 ms locally). It does not sell. This run does.

## How to run

```sh
BUZZIFY_DB_PORT=54503 npx vitest run --config vitest.load.config.ts tests/load/pharmacy-concurrency.load.ts
```

(`npm run test:load` runs every load file; run this one alone, they share one test database.) The file prints one `PHARMACY-LOAD {json}` line per scenario and `PHARMACY-LOAD-CHECK {json}` lines for the independent checks. It uses the private database on port 54503 only, wipes and rebuilds that database's test data like every pharmacy test, and needs no other service.

## What it does

Each "till" is a different person with their own open shift, selling through the real `ph.sales.create` action (the same code path as the screen: permission, shift lock, FEFO allocation, stock movement, payment, cash movement, audit). One batch holds 60 tablets; a sale is one tablet for 100 IQD in cash; every till sells until it is told there is no stock.

1. **Two tills plus a shift close.** Tills A and B sell one at a time, concurrently. A third till sells 6, then closes its shift (while A and B are still selling), then tries to sell and must be refused.
2. **Eight at once.** Tills A and B each keep four sales in flight against the same 60 tablets.
3. **Close with sales in flight.** One till keeps four sales in flight; 25 ms in, the same person closes the shift.

After each scenario a SECOND connection (plain `pg`, not the application's client) checks, by SQL:

- no stock balance row has a negative bucket, and the balance equals 60 minus the sales;
- the number of `SALE` stock movements, the units they moved, the completed sales, the payments and the distinct sale numbers each equal the number of sales the tills were told succeeded;
- for a closed shift: its `expectedMinor` equals the sum of the cash rows written for it, and equals (sales it made x 100).

## Results (local, 2026-11-02, Node 24, embedded PostgreSQL on 127.0.0.1:54503)

Latency is the time of the whole action call as the till saw it (framework, scoped transaction, audit), in milliseconds. Figures from the final run; three earlier runs of the same file gave p95 values of 49 to 144 ms and the same outcomes.

| Scenario | Sales tried | Succeeded | Refused for no stock | Other errors | p50 | p95 | p99 | max | Wall |
|---|---|---|---|---|---|---|---|---|---|
| Two tills + close | 62 | 60 (A 28, B 26, C 6) | 2 | 0 | 21 | 52 | 123 | 123 | 734 ms |
| Two tills x 4 in flight | 68 | 60 (33 and 27) | 8 | 0 | 78 | 127 | 205 | 205 | 642 ms |
| Close with 4 in flight | 64 | 60 | 3 (+1 refused after the close) | 0 | 34 | 40 | 48 | 48 | n/a |

The close itself: 15 ms in the first scenario; 514 ms in the third (see observations).

Independent SQL checks, all three scenarios:

| Check | Result |
|---|---|
| Balance available at the end | 0 (never negative; zero negative-bucket rows) |
| `SALE` movements = units sold = completed sales = payments = distinct sale numbers | 60 = 60 = 60 = 60 = 60 |
| Oversell | none: 60 successes on 60 tablets |
| Double sale (same sale counted twice) | none: 60 distinct sale numbers for 60 sales |
| Closed shift, scenario 1 | status CLOSED, expected 600 = cash rows 600 (6 sales x 100) |
| Closed shift, scenario 3 | status CLOSED, expected 6000 = cash rows 6000 (60 sales x 100) |
| Sale attempted after the close | refused (CONFLICT) |

## Observations

- Postgres decided every race with row locks: exactly N of N+k attempts succeed, the rest get `INSUFFICIENT_STOCK`. There was no deadlock error and no unexpected error code in any run.
- **Close under a saturating till is slow to be answered.** In scenario 3 the close was requested 25 ms after four sales loops began and answered about 0.5 to 0.7 s later, after all 60 sales had landed, so the sale-versus-close interleaving that mattered (some sales before the close, the rest refused) did not happen: all sales won. The invariant held (expected = cash rows = sales), and a sale after the close was refused, but **the case where a close lands in the middle of a stream of sales was not produced** by this run. Cause not isolated (connection-pool queueing behind four loops, or lock-queue order). Severity Low: a real till sells one customer at a time.
- Wall times of 0.6 to 0.7 s for 60 sales across two tills is about 90 sales/s locally. On Neon each query adds a network round trip and `ph.sales.create` runs about 29 queries plus 5 per allocation (README), so expect several times these latencies.

## Limits (what this does NOT show)

- The tills share one Node process and one connection pool: this is concurrent transactions against Postgres, not two machines. No browser, no network, no printer, no scanner.
- The database is the private embedded server, not Neon (pooler, latency, `max_connections`, serverless cold starts).
- 60 units and about 200 sales is a correctness run, not a capacity test: nothing here says how many tills one Neon plan carries. The search load run remains the only throughput figure.
- Only cash sales of one product. Mixed payments, credit sales, returns and transfers under concurrency are covered by their own tests (acceptance phases 3, 6 and 7) but not by this run.
