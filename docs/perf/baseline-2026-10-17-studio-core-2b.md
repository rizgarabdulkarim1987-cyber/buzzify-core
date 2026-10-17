# Performance baseline 2026-10-17: customer menu after Studio Core 2b

Lighthouse 13.5.0, default mobile profile (simulated slow 4G, 4x CPU slowdown), production builds (`next build`, Turbopack)
served locally with `next start`. Each figure is the median of five runs; the two builds were measured alternately
(base, branch, base, branch, ...) in the same half hour, reading the same database.

- **base**: `b134e20` (main when 2b began: Studio Core 2a with its performance fix)
- **this change**: `studio-core-2b` at `0511226` (the content workspace, media, brand kit with font pairs, QR codes,
  import and export, revisions and scheduling, two new demo menus; main's Hostinger build merged in)

**The browser differs from 2a's baseline.** Playwright's `chrome.exe` could not be started by Lighthouse on this machine
(`spawn UNKNOWN`), so these runs use Playwright's headless shell of the same Chromium build (`chromium_headless_shell-1248`).
Its absolute figures are not comparable with `baseline-2026-10-17-studio-core-2a.md` (LCP about 0.5 s lower, and a Total
Blocking Time in the minutes, from the 3D stage's frame loop without a GPU): read the base and branch columns against
each other, not against the 2a document.

## Result

**One regression, on the table page.** `/atelier/en` is unchanged (LCP 1958 ms against 1957 ms). `/atelier/en/t/04`,
the page a table's QR code opens, paints 150 ms later (one simulated round trip): its HTML document is now
**14,618 bytes**, 18 bytes past the 14,600 a new connection delivers in its first round trip (base: 14,493). Initial
script grew by 2.7 KB, CSS by 1.5 KB; fonts are unchanged on ATELIER. Nothing in the product was changed in this task.

| Goal | base | This change | Verdict |
|---|---|---|---|
| HTML document within the first round trip (`/atelier/en`) | 14,436 to 14,490 bytes | 14,490 bytes | Met, 110 bytes to spare. |
| HTML document within the first round trip (`/atelier/en/t/04`) | 14,493 bytes | **14,618 bytes** | **Not met**: costs one round trip (FCP and LCP +150 ms). |
| No Studio code on the public menu | met | met | Every script `/atelier/en` loads in its first 10 s: no `studio/ui`, `better-auth`, `@aws-sdk`, `exceljs`, `papaparse`, `dnd-kit`, `sharp`, `fontkit`, `fflate` or `qrcode` (the search does find `dnd-kit` in a Studio chunk, so the names survive minification). |
| Fonts under 45 KB in English, under 70 KB in Arabic script | met | met | ATELIER 39.8 KB; Riverlight (`cafe`) 32.0 KB in English; Hot Brick (`street`) 43.2 KB in Sorani. |

## `/atelier/en`

| Metric | base | This change |
|---|---|---|
| Largest Contentful Paint | 1957 ms | 1958 ms |
| First Contentful Paint | 1210 ms | 1210 ms |
| Cumulative Layout Shift | 0.000 | 0.000 |
| Performance score | 67 | 67 |
| Initial script | 163.1 KB | 165.8 KB |
| All script | 455.6 KB | 458.8 KB |
| CSS (transferred) | 10,449 bytes | 11,977 bytes |
| Fonts | 39.8 KB | 39.8 KB |
| HTML document | 14,436 to 14,490 bytes | 14,490 bytes |
| Total transfer | 520.7 KB | 525.4 KB |

LCP per run, ms: base 2035, 1955, 1958, 1810, 1957; this change 1957, 1956, 2514, 1958, 1958.

## `/atelier/en/t/04` (the table page a QR code opens)

| Metric | base | This change |
|---|---|---|
| Largest Contentful Paint | 2255 ms | 2405 ms |
| First Contentful Paint | 1207 ms | 1358 ms |
| Cumulative Layout Shift | 0.022 | 0.022 |
| Performance score | 66 | 65 |
| Initial script | 163.1 KB | 165.8 KB |
| CSS (transferred) | 10,449 bytes | 11,977 bytes |
| Fonts | 39.8 KB | 39.8 KB |
| HTML document | 14,493 bytes | 14,618 bytes |

LCP per run, ms: base 2255, 2254, 2256, 2255, 1955; this change 2404, 2106, 2405, 2659, 2405. The 150 ms step in both FCP
and LCP is the second round trip for the document.

## The two new demo menus (this change only)

| Metric | `/riverlight/en` | `/hot-brick/ckb` |
|---|---|---|
| Largest Contentful Paint | 1807 ms (runs 1807, 1805, 2255, 2363, 1805) | 2503 ms (runs 2499, 2504, 2509, 2262, 2503) |
| First Contentful Paint | 1208 ms | 1358 ms |
| Cumulative Layout Shift | 0.000 | 0.039 |
| Fonts | 32.0 KB (Fraunces, DM Sans) | 43.2 KB (Noto Kufi Arabic) |
| HTML document | 10,618 bytes | 11,540 bytes |

## Where the bytes came from

- **A second stylesheet.** The base links one stylesheet; this change links two on every public page: the main one
  (37,945 bytes, 8,290 gzipped) and one with the font faces (11,312 bytes, 2,962 gzipped, 34 `@font-face` rules). The
  `@font-face` rules of all six font pairs are in it, whichever pair the menu uses, because `src/app/fonts.ts` declares
  every face. Each rule only downloads its font when text uses it, so font bytes did not grow; the cost is the rules
  themselves and a second render-blocking request. On `/atelier/en` it does not show in LCP.
- **The document on `/t/04`.** The extra `<link rel="stylesheet">` (about 90 bytes), the `font-pair-<id>` class on
  `<html>` and the brand fields the page's payload now carries add 125 bytes after compression, which is enough to cross
  14,600 on the table page (it had 107 bytes to spare). `/atelier/en` still fits, with 110 bytes to spare.

Ways to win the round trip back, for a follow-up (none applied here): load each pair's faces only with its menus (one
font module per pair, so a page's CSS holds its own pair alone), which also removes the second stylesheet; or trim the
table page's payload. Either needs a re-measurement.

## Picture processing (spec 18)

`prepareAsset` on a 6000 × 4000 JPEG of 14,615,534 bytes (photo-like gradients with grain, quality 95, just under the
15 MB limit), three runs on this machine: **1717, 1744 and 1723 ms**, for the original and every WebP and AVIF rendition.
The finalize routes allow 60 s, so there is ample room even on a slower function instance.

## Checks run for this baseline

- `npm test`: 134 files, 1878 tests, all passed.
- `npm run test:load`: 20 tests, all passed.
- `npm run test:e2e` (against this worktree's own dev server on port 3110): 226 passed; the 5 failures are the
  `public-urls.spec.ts` "search engines" tests, which expect canonical links on `http://127.0.0.1:3100` (the port the
  standard configuration serves on) and received the same links on `:3110`.
- `npm run build` (Turbopack) and `BUILD_TARGET=standalone next build --webpack` (Hostinger's build): both pass without
  any production secret; the standalone output contains the two fonts the QR renderer reads.
