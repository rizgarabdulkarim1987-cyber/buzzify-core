# Performance baseline 2026-10-17: customer menu after Studio Core 2a

Lighthouse 13.5.0, default mobile profile (simulated slow 4G, 4x CPU slowdown), production builds served locally
with `next start`. Each figure is the median of five runs. The two builds were measured alternately (main, branch,
main, branch, ...) on the same machine in the same hour, so machine load affects both equally.

- **main**: `b395311` (the category rail baseline, the code before Studio Core 2a)
- **this change**: `studio-core` at `bac4e43` (the Studio, snapshot publishing, permanent URLs and accounts)

The public menu's code did not change on purpose in this milestone, but its read path did: pages now resolve their
menu through `withPublicMenu` and the cached snapshot read in `src/server/data/public-menu.ts`, `generateMetadata`
adds canonical and language links, and the 404 page has a new back link component.

## Result

**Worse than before, beyond run-to-run noise.** Largest Contentful Paint rose by 150 ms on `/atelier/en` and by
287 ms on `/atelier/en/t/04`; the initial script rose by 1.1 KB. Both are repeatable (the five runs of each build
span 25 ms or less) and both are exact multiples of one simulated round trip (150 ms on this profile). Causes are
below. No product code was changed in this task.

| Goal | main (today) | This change | Verdict |
|---|---|---|---|
| LCP under 2.5 s (`/atelier/en`) | 2.50 s (runs 2.49 to 2.51 s) | 2.65 s (runs 2.64 to 2.66 s) | **Not met**, and 150 ms further from the line than before. |
| LCP under 2.5 s (`/atelier/en?stage=off`) | 2.50 s (runs 2.49 to 2.51 s) | 2.65 s (runs 2.64 to 2.66 s) | **Not met**, as before, by 150 ms more. |
| LCP under 2.5 s (`/atelier/en/t/04`, ATELIER's deck) | 2.50 s (runs 2.49 to 2.51 s) | 2.79 s (runs 2.79 to 2.81 s) | **Not met.** The rail baseline's "met, narrowly" at this address is lost. |
| Initial script about 120 KB | 169.3 KB | 170.4 KB | **Not met**, as before. The framework alone is about 139 KB. |

Main today reproduces the rail baseline (`baseline-2026-10-16-rails.md`: 2.49 s, 169.3 KB and a 14,487-byte
document at `/t/04`) to within 10 ms, the same initial script and 11 bytes, so the difference below is the branch,
not the machine. (`baseline-2026-10-16.md` measured `/atelier/en` before the rail styles: 2.51 s and 166 KB.)

## `/atelier/en` (the default; the 3D stage loads after the page is idle where the device qualifies)

| Metric | main | This change |
|---|---|---|
| Largest Contentful Paint | 2.50 s | 2.65 s |
| First Contentful Paint | 1.21 s | 1.21 s |
| Total Blocking Time | 3514 ms | 3514 ms |
| Cumulative Layout Shift | 0.000 | 0.000 |
| Performance score | 67 | 66 |
| Initial script | 169.3 KB | 170.4 KB |
| Script loaded after the largest paint | 293.3 KB | 293.3 KB |
| All script | 462.6 KB | 463.7 KB |
| Fonts | 39.8 KB | 39.8 KB |
| HTML document | 14,376 bytes | 14,540 bytes |
| Total transfer | 527.6 KB | 528.9 KB |

LCP per run, ms: main 2492, 2508, 2488, 2501, 2507; this change 2661, 2658, 2652, 2636, 2648. A first batch of five
runs of this change alone, taken before the alternating ones, gave 2649, 2652, 2649, 2648, 2646 (median 2.649 s).

## `/atelier/en?stage=off`

| Metric | main | This change |
|---|---|---|
| Largest Contentful Paint | 2.50 s | 2.65 s |
| First Contentful Paint | 1.21 s | 1.21 s |
| Total Blocking Time | 163 ms | 95 ms |
| Performance score | 95 | 96 |
| Initial script | 169.3 KB | 170.4 KB |
| Script loaded after the largest paint | 44.4 KB | 44.4 KB |
| All script | 213.7 KB | 214.7 KB |
| HTML document | 14,387 bytes | 14,551 bytes |
| Total transfer | 278.7 KB | 280.0 KB |

LCP per run, ms: main 2502, 2509, 2500, 2487, 2506; this change 2656, 2659, 2635, 2651, 2647.

## `/atelier/en/t/04` (the table entry address, where the rail deck shows)

| Metric | main | This change |
|---|---|---|
| Largest Contentful Paint | 2.50 s | 2.79 s |
| First Contentful Paint | 1.21 s | 1.36 s |
| Total Blocking Time | 3516 ms | 3525 ms |
| Cumulative Layout Shift | 0.051 | 0.051 |
| Performance score | 67 | 65 |
| Initial script | 169.3 KB | 170.4 KB |
| HTML document | 14,498 bytes | 14,671 bytes |
| Total transfer | 527.8 KB | 529.0 KB |

LCP per run, ms: main 2504, 2502, 2505, 2490, 2491; this change 2795, 2788, 2789, 2806, 2786. First batch of this
change alone: 2790, 2791, 2796, 2806, 2798.

## What the difference is

Two separate steps of one round trip (150 ms) each. Both were isolated with a small local proxy in front of the
servers that rewrites only the HTML document (three runs per case, all figures LCP / FCP, the document size is the
transfer size Lighthouse recorded):

| Case | `/atelier/en` | `/atelier/en/t/04` |
|---|---|---|
| main, document passed through | 2.50 s / 1.21 s (14,138 B) | 2.50 s / 1.21 s (14,303 B) |
| main, document padded to the branch's size | 2.50 s / 1.21 s (14,541 B) | 2.65 s / 1.36 s (14,671 B) |
| branch, document passed through | 2.66 s / 1.21 s (14,328 B) | 2.65 s / 1.21 s (14,476 B) |
| branch, canonical and language links removed | 2.65 s / 1.21 s (14,274 B) | 2.65 s / 1.21 s (14,420 B) |

(The proxy compresses a little better than Next does, so its documents are about 200 bytes smaller than the direct
ones in the tables above; within the proxy cases the comparison holds.)

1. **The document crossed the first TCP window at `/t/04` (+150 ms to FCP and LCP there).** The document grew
   by 844 bytes raw, about 170 compressed (14,498 to 14,671 bytes at `/t/04`; 14,376 to 14,540 at `/atelier/en`),
   past the 14,600 a new connection delivers in its first round trip (10 segments of 1,460 bytes), the limit
   described in `baseline-2026-10-16-rails.md`. About two thirds of the growth is the branch's `generateMetadata`
   adding `<link rel="canonical">` and three `<link rel="alternate" hreflang>` tags (from `menuAlternates`), which
   appear in the head and again in the page's React Server Components payload (compressing both pages with and
   without them: about 54 bytes in the head, 69 in the payload, of the 190 the page grew); the rest is the extra
   chunk's script tag and its references. Padding main's document to the same size, with the
   scripts untouched, reproduces it (2.65 s, FCP 1.36 s); the same padding on `/atelier/en` (14,541) does not,
   because that document is still under the line. **`/atelier/en` has 60 bytes of headroom** (14,540 of 14,600).
2. **A further +150 ms to LCP on every menu page, independent of the document.** Removing the added links, or
   padding main to the branch's size, does not move it. What differs is the script side: the menu's initial
   JavaScript is 11 chunks instead of 10 and 1.1 KB larger (170.4 against 169.3 KB; the CSS grew 37 bytes). The
   new `BackToMenu` client component (`src/ui/BackToMenu.tsx`, used by `[tenant]/[locale]/not-found.tsx`, with
   `useOptionalApp` added to `AppProviders`) sits in one of the chunks the menu loads first: its slug pattern is
   found in the chunk `0jl_g_jwrt1pe.js`, which `/atelier/en` requests before the largest paint. In a throwaway
   copy of the branch with the 404 page's link written as a plain anchor, the initial script fell to 166.6 KB
   (below main's 169.3 KB) and the script requests to main's number, but the LCP came back only in one of three
   runs (2.50, 2.64, 2.64 s; `/t/04` stayed at 2.79 s, its document being 14,643 bytes). So `BackToMenu` is the
   largest identifiable contributor to the script change, but the experiment does not show it to be the whole
   cause: the simulation is on a threshold there, and which side a run lands on is decided by small differences
   in request order.

Not responsible: the snapshot read path, `cache.ts` and `withPublicMenu` run on the server and add no client code,
and the server's response time is unchanged (observed, per run: `/atelier/en` 14 to 23 ms on main and 13 to 18 ms
on the branch; `/t/04` 41 to 47 ms on both, apart from one 150 ms outlier on main).

Options, none done here (product decisions): keep the table-entry (`/t/NN`) and other non-menu pages to the
canonical link only, or trim about 75 bytes elsewhere in that document; write the 404 page's link without a client
component; and add the document size check that `baseline-2026-10-16-rails.md` suggests (fail when the compressed
document passes about 14,000 bytes), which would have caught the first of these.

## Studio code in the public menu's chunks

Method: the script and stylesheet URLs `/atelier/en` requests were collected from the HTML of six public pages
(`/atelier/en`, `/ar`, `/ckb`, `/en/t/04`, `/en/cart`, `/en/explore`) and from every `/_next/static` request
recorded in the twenty Lighthouse runs of `/atelier/en` and `/atelier/en?stage=off` (so the 3D stage and the product
sheet that loads after the page are included): 22 files. The chunks named in the five public routes' client
reference manifests (13 files) were checked as well. Each file was searched for strings that survive minification:
`better-auth`, `two-factor`, `studio/ui`, `src/studio`, `@tanstack/react-table`, `getCoreRowModel`, `cmdk-`,
`radix-ui`, `data-radix`, `radix-`, the Studio message keys `jump.shortcut` and `common.jumpTo`, the Studio CSS
token `--s-bg` and the route prefix `/studio/`.

Result: **no match in any chunk the public menu loads.** As a control, the same search over all 59 client chunks
finds `getCoreRowModel`, `cmdk-`, `radix-ui`, `data-radix`, `jump.shortcut`, `--s-bg`, `two-factor` and `/studio/`,
all in chunks that only the Studio's routes name. The one chunk both name (`42onvq6nokjl2.js`, 3.9 KB, shared
framework code) contains none of the markers. `better-auth` appears nowhere under `.next/static` (it is server code;
under `.next/server` it appears in 41 files), and `studio/ui` appears nowhere either: Turbopack drops module paths
from minified chunks, so these two strings cannot show a Studio module by themselves; the message keys, CSS token and
library markers above can. ESLint also rejects Studio imports from the public menu's routes and components.

## Reproduce

```bash
npm run build
npm run start
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run perf -- http://127.0.0.1:3100/atelier/en menu
```

To compare with main on the same machine, extract main (`git archive main`) into another directory, give it its own
database and port, build it there, and alternate the runs. Results vary by machine and by what else the machine is
doing; compare medians of alternating runs. A production build cannot run while `npm run dev` is serving port 3100.
