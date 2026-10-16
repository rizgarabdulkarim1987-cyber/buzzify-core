# Performance baseline 2026-10-16: category rail motion styles

Lighthouse 13.5.0, default mobile profile (simulated slow 4G, 4x CPU slowdown), production builds served
locally with `next start`, measured at `/atelier/en/t/04`. ATELIER's rail style is the fanned deck; `?rail=grains`
previews the grain dishes. Deck and grains runs were interleaved; each figure is the median of three runs (five
for the deck with this change).

- **da57715**: the five rail styles, with the dish drawings inline in the page (before this change)
- **this change**: the dish drawings come from one cached SVG file instead of the page's HTML

## Goals

| Goal | da57715 | This change | Verdict |
|---|---|---|---|
| LCP under 2.5 s, deck (ATELIER's style) | 2.65 s | 2.49 s (runs 2.49 to 2.50 s) | **Met, narrowly.** 4 of 5 runs under 2.5 s. |
| LCP under 2.5 s, `?rail=grains` preview | 2.66 s | 2.52 s | **Not met** on the preview (see below). |
| Initial script about 120 KB | 170 KB | 169 KB | **Not met.** The framework alone is about 139 KB. |

The previous baseline (`baseline-2026-10-16.md`, before the rail styles, at `/atelier/en`) had LCP 2.51 s,
initial script 166 KB and an HTML document of 13.5 KB.

## Deck, `/atelier/en/t/04`

| Metric | da57715 | This change |
|---|---|---|
| Largest Contentful Paint | 2.65 s | 2.49 s |
| First Contentful Paint | 1.36 s | 1.21 s |
| Total Blocking Time | 3969 ms | 3770 ms |
| Cumulative Layout Shift | 0.051 | 0.022 |
| Performance score | 66 | 67 |
| HTML document | 14,770 bytes | 14,487 bytes |
| Initial script | 169.7 KB | 169.3 KB |
| Script loaded after the largest paint | 293 KB | 293 KB |
| Fonts | 40 KB | 40 KB |
| Total transfer | 528 KB | 528 KB |

LCP per run, ms: da57715 2648, 2647, 2656; this change 2494, 2497, 2502, 2492, 2489.

## `?rail=grains` preview

| Metric | da57715 | This change |
|---|---|---|
| Largest Contentful Paint | 2.66 s | 2.52 s |
| First Contentful Paint | 1.36 s | 1.21 s |
| Cumulative Layout Shift | 0.022 | 0.022 |
| Initial script | 169.7 KB | 169.3 KB |

LCP per run, ms: da57715 2658, 2670, 2657; this change 2516, 2526, 2514.

The preview is not what a guest of a grains restaurant gets: the server renders the restaurant's own style (the
deck) and the page switches to grains after hydration. A restaurant whose setting is grains gets the grain rail
rendered on the server, with no switch.

## What the rail styles cost, and the fix

**The HTML document crossed the first TCP window.** A new connection delivers about 14,600 bytes (10 segments of
1,460 bytes) in its first round trip, in Lighthouse's simulation as on a real phone. The deck's markup adds about
1,040 compressed bytes to the page, 387 of them the five inline dish drawings, which took the document from
13.5 KB to 14,770 bytes. The rest of the document then needed a second round trip: 150 ms on the slow-4G profile,
added to both FCP and LCP.

An experiment confirmed it: with the drawings left out of the HTML, the document was 14,388 bytes and LCP fell to
2.50 s, FCP to 1.21 s.

The fix keeps the drawings but moves them out of the page. `src/ui/menu/rail/dishes.svg` holds them as symbols,
imported so that Next serves it under `/_next/static/media/` with a content hash and a one-year immutable cache.
Each icon is now `<svg><use href="…dishes.svg#cup"></use></svg>`, with the same size, stroke and colour as before.
The sprite is an 881-byte request made while the scripts download, so it is not on the path to the largest paint.

## Tried and not kept: loading only the chosen rail's code

All five rail components ship in the menu's initial JavaScript. Loading each style with `next/dynamic` was
measured two ways:

- **With a Suspense boundary around the rail**: the server streams the rail after the rest of the page and adds
  React's inline reveal script. The document grew to 15.0 KB, CLS rose from 0.051 to 0.127, LCP stayed at 2.65 s.
- **Without a boundary of its own**: initial script went from 169.7 KB to 169.1 KB and LCP from 2.648 s to
  2.644 s. The deck is the largest rail, and its own 2.6 KB chunk (with the shared swipe hook and the icons) almost
  cancels the 3.3 KB that the other four styles cost. The `?rail=grains` preview got slower (2.71 s), because the
  server preloads the deck's chunk and the previewed one loads after it, and hydration of the whole menu waits
  for the rail's chunk.

The other four styles together are about 3.3 KB compressed; splitting them off is not worth a request and a
hydration dependency.

## What is left

- **The document has 113 bytes of headroom.** Anything that adds to the menu page's HTML (another category, a
  longer description, a new product) can push it past the first window again and cost 150 ms. The largest parts
  are the product list (about 4.3 KB compressed), the React Server Components payload (about 6.3 KB), and the
  inline product illustrations (about 1.8 KB each before compression). A check that fails when the compressed
  document passes about 14,000 bytes (the response headers take about 510) would catch the next regression.
- **Initial script** is unchanged by the rail styles in any way that matters (169 KB against 166 KB before). The
  framework floor described in `baseline-2026-10-16.md` still rules out 120 KB on this stack.
- **LCP is 6 ms under the line.** Another machine or a busy one can land either side; compare medians.
- **TBT** stays high because headless Chrome starts the 3D stage with software WebGL after load, as before.

## Reproduce

```bash
npm run build
npm run start
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" npm run perf -- http://127.0.0.1:3100/atelier/en/t/04 rails
```

Run it several times and compare medians. A production build cannot run while `npm run dev` is serving port 3100.
