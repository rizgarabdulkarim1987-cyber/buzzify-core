# Performance baseline 2026-10-15 (menu-3d-on)

Measured with Lighthouse 13.5.0 against `http://127.0.0.1:3101/atelier/en/t/04?stage=on` using the default mobile profile
(simulated slow 4G, 4x CPU slowdown), production build, local server.

| Metric | Value |
|---|---|
| Performance score | 60 |
| Largest Contentful Paint | 3.61 s |
| First Contentful Paint | 0.91 s |
| Total Blocking Time | 3726 ms |
| Cumulative Layout Shift | 0.024 |
| Script transfer size | 467 KB (14 requests) |
| Total transfer size | 664 KB |

**LCP target (under 2.5 s): not met.**

Numbers vary by machine. Re-run with `npm run build && npm run start` in one terminal and `npm run perf` in another.
