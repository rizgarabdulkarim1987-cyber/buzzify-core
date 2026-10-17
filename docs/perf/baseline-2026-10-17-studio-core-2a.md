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

**Since fixed:** both pages are back at main's figures, with less initial script than main. See
[After the fix](#after-the-fix) at the end; the figures in between are the original measurement, kept as it was.

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

## After the fix

Measured the same way on the same day: production builds with `next start`, Lighthouse 13.5.0 mobile through
`npm run perf`, five rounds, the builds alternated within each round. Main was rebuilt from `b395311` in a temporary
directory with its own database, as above.

- **main**: `b395311`
- **before**: `studio-core` as measured above (`9713b71`, the code of `bac4e43`)
- **after**: this change

### What changed

1. **Only the menu's home and product pages name their translations.** The layout's metadata now gives every page
   the canonical link alone (the menu's home in that language, `menuCanonical` in `src/server/seo.ts`); the home page
   and the product page add the `hreflang` alternates (`menuAlternates`). The table's entry page, the cart and
   explore keep only the canonical, which already pointed at the menu's home. Paused and missing menus keep
   `noindex`.
2. **The 404 page has no client code.** Next renders `not-found.tsx` with every page of the menu (it travels in the
   page's payload, ready for a `notFound()`), so its imports were part of every menu page's first scripts: the 2a
   `BackToMenu` client component and, on main as well, `next/link`. The page is now an async server component with
   a plain anchor. The proxy hands the requested path to the page in the `x-buzzify-path` request header (always
   overwritten, no database), and `backToMenuHref` in `src/server/public-page.tsx` turns it into the link: the
   menu's home in that language for a live menu, `/{slug}` when the menu did not render in that language (the entry
   address picks one), `/` with no usable slug. `BackToMenu` and `useOptionalApp` are gone.
3. **The paused-menu line left the browser's message catalog.** `menu.unavailable` had been added to
   `src/lib/messages`, which ships to the browser with every menu page in all three languages, but only the server
   renders it. The three lines now live in `src/ui/MenuUnavailable.tsx`.
4. **Turbopack merges small chunks** (`experimental.turbopackChunking.minChunkSize: 200_000` in `next.config.ts`;
   the default is 50,000 unminified bytes). This is what removes the second step; see below.

### What the extra script step was

The scripts `/atelier/en` requests before its largest paint, in request order, with the bytes Lighthouse recorded:

| main (10 files, 169.3 KB) | before (11 files, 170.4 KB) | after (7 files, 163.1 KB) |
|---|---|---|
| `0om590q` 4,137 | `0om590q` 4,137 | `3dxl5-q` 19,938 (`0om590q`, `0s2cptn` and `2hoi73v` merged) |
| `0s2cptn` 8,711 | `0s2cptn` 8,711 | `2x0in0h` 36,063 |
| `2gzg1e_` 72,346 (React DOM) | `2gzg1e_` 72,346 | `2gzg1e_` 72,346 |
| `0v2azvi` 44,493 (Next's client) | `2x0in0h` 36,063 and `2hoi73v` 9,142 (the same code in two files) | `turbopack` 4,787 |
| `turbopack` 4,787 | `turbopack` 4,787 | `42onvq6` 3,910 |
| `42onvq6` 3,910 | `42onvq6` 3,910 | `0ff5rmq` 10,247 (the menu's shell) |
| `3qkwvl0` 10,198 (the menu's shell) | `0b2y09e` 10,314 | `2z0g20s` 19,739 (the menu, two chunks merged) |
| `2n5qehe` 3,703 (`next/link`, for the 404 page) | `0jl_g_j` 3,863 (`next/link` and `BackToMenu`) | |
| `2om1fpk` 8,670 | `0c60on1` 8,909 | |
| `0jofwmt` 12,414 | `2e4twi5` 12,285 | |

Two things changed between main and before. `BackToMenu` joined the `next/link` chunk (160 bytes), and Next's
client code, one file on main, became two. The second comes from the Studio: a build of this branch with the
Studio's routes removed, on default settings, has one file there again. Turbopack groups modules by the routes that
use them, and the Studio's routes share part of the framework, so that part became a file of its own: one more
request at the head of every page's queue. Nothing else from 2a reached the menu's scripts (`withPublicMenu`,
`MenuUnavailable`, `permanentRedirect` and the metadata helpers are server code), apart from the paused-menu line in
the message catalog (change 3).

Lighthouse's simulated LCP waits for every script requested before the paint, so the number and order of those
requests decides how many round trips it takes. Taken one at a time, on changes 1 and 2:

| Build | Initial scripts | `/atelier/en` LCP | `/t/04` LCP |
|---|---|---|---|
| Default chunking (no `next/link`, no `BackToMenu`; one run each) | 10 files, 166.6 KB | 2.646 s | 2.651 s |
| `minChunkSize: 200_000` (kept; two runs each) | 7 files, 163.2 KB | 2.501, 2.488 s | 2.491, 2.492 s |
| `minChunkSize: 1_000_000, maxMergeChunkSize: 2_000_000` (two runs each) | 5 files, 161.0 KB | 2.359, 2.361 s | 2.360, 2.368 s |
| main, alternated with the above | 10 files, 169.3 KB | 2.49 to 2.50 s | 2.49 to 2.50 s |

So the 404 link was not the second step: without it the page still painted 150 ms after main, with less script than
main. Merging the split framework file back is what recovers it. (`minChunkSize: 100_000` gave 9 files, one of them
683 bytes, and was not measured; `priorityRoutes`, `clusters`, `requestCost` and `maxMergeChunkSize` on their own
left the files as they were.)

Merging changes how code is grouped, not what a page loads: every route's first-load JavaScript is the same size or
smaller after it (the build's `route-bundle-stats.json`: the menu 552,272 to 543,358 unminified bytes, each Studio
page about 0.1 % smaller), in fewer files (the menu 11 to 7, the Studio's pages from 10 to 18 down to 7 to 11). What
it can cost is reuse across navigations, as larger shared files are less likely to be cached already.

The public menu's chunks were searched again for the Studio's markers (as in "Studio code in the public menu's
chunks" above, over the after build and its Lighthouse runs): none found, and the only chunk the Studio's routes and
the menu share is still `42onvq6nokjl2.js`. `BackToMenu`'s slug pattern is in no chunk.

### Result

| Goal | main | before | after |
|---|---|---|---|
| LCP under 2.5 s (`/atelier/en`) | 2.496 s | 2.643 s | **2.496 s**, met by 4 ms (main's figure) |
| LCP under 2.5 s (`/atelier/en/t/04`) | 2.490 s | 2.788 s | **2.488 s**, met by 12 ms (main's figure) |
| Initial script about 120 KB | 169.3 KB | 170.4 KB | **163.1 KB**, not met (6.2 KB below main) |

### `/atelier/en`

| Metric | main | before | after |
|---|---|---|---|
| Largest Contentful Paint | 2.496 s | 2.643 s | 2.496 s |
| First Contentful Paint | 1.208 s | 1.210 s | 1.209 s |
| Total Blocking Time | 2849 ms | 2622 ms | 2825 ms |
| Cumulative Layout Shift | 0.000 | 0.000 | 0.000 |
| Performance score | 68 | 67 | 68 |
| Initial script | 169.3 KB, 10 files | 170.4 KB, 11 files | 163.1 KB, 7 files |
| All script | 462.6 KB | 463.7 KB | 455.6 KB |
| HTML document | 14,420 bytes | 14,569 bytes | 14,443 bytes |
| Total transfer | 527.7 KB | 528.9 KB | 520.7 KB |

LCP per run, ms: main 2549, 2487, 2498, 2496, 2488; before 2714, 2643, 2651, 906, 2640; after 2498, 2489, 2493,
2500, 2496. The 906 ms run of before is a simulation outlier (its trace held only 8 of the 11 scripts before the
paint; FCP 756 ms) and does not move the median.

### `/atelier/en/t/04`

| Metric | main | before | after |
|---|---|---|---|
| Largest Contentful Paint | 2.490 s | 2.788 s | 2.488 s |
| First Contentful Paint | 1.207 s | 1.359 s | 1.207 s |
| Total Blocking Time | 2836 ms | 2687 ms | 2845 ms |
| Performance score | 68 | 66 | 68 |
| Initial script | 169.3 KB, 10 files | 170.4 KB, 11 files | 163.1 KB, 7 files |
| HTML document | 14,543 bytes | 14,695 bytes | 14,504 bytes |
| Total transfer | 527.8 KB | 529.1 KB | 520.8 KB |

LCP per run, ms: main 2490, 2483, 2496, 2488, 2493; before 2787, 2826, 2788, 2798, 2786; after 2487, 2492, 2490,
2486, 2488. The document is back inside the first round trip, with 96 bytes to spare (main has 57).

Server response times stayed within a few milliseconds: `/atelier/en` 12 to 15 ms on main, 15 to 19 before and 14 to
20 after (the 404 page now resolves the menu from the data cache once more per page); `/t/04` 43 to 48 ms on main
and 44 to 46 ms after, apart from two 150 ms outliers after (and two before) that did not move those runs' LCP.

### What is left

- **Both LCP figures sit just under the line**, as on main: 4 and 12 ms. The stronger merge in the table above
  (`minChunkSize: 1_000_000, maxMergeChunkSize: 2_000_000`), run as a fourth build in the same five alternating
  rounds on the final code, gave 2.358 s and 2.362 s (runs 2373, 2358, 2357, 2372, 2357 and 2362, 2367, 2362, 2357,
  2366) with 161.0 KB in 5 files: about 135 ms of margin. It puts all of Next's client code in one 432 KB file
  (126 KB compressed) and merges the Studio's chunks harder too; first-load sizes stay the same, and reuse across
  navigations is what it may cost. Not adopted here: a decision to make with navigation measured as well.
- **`/t/04`'s document has 96 bytes of headroom.** `npm run perf` now prints the document's transfer size against
  the 14,600 bytes of the first round trip, so the next regression shows in its report.
- **The 404 link reads the path from the proxy.** On the few paths the proxy skips (those with a dot), the header is
  absent and the link goes to `/`.
- `turbopackChunking` is an experimental Next option; re-measure after upgrading Next.
