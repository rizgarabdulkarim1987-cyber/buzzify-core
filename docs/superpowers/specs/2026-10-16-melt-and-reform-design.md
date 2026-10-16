# Explore, direction 2: melt and reform

Status: chosen by the user from four animated sketches ("Build direction 2: melt and reform").
Replaces the side-to-side glide of `2026-10-16-explore-experience-design.md`; everything else in
Explore (scenes from signatures, panel, chips, What is inside, cart, sheet, rail, RTL) stays.

## 1. The idea

There is one stage, one plinth, one dish at a time. Scrolling does not slide dishes past each
other: the dish in front of you dissolves into thousands of grains that swirl around the plinth
and settle into the shape and colours of the next dish. Scrub slowly and you can watch a burger
melt and become a mille-feuille. At rest the dish is the solid, lit 3D model.

## 2. How it behaves

| Moment | What happens |
|---|---|
| First load | Grains rise from the plinth like smoke and assemble into the first dish, then the solid model takes over. Once per visit. |
| At rest | The solid model, turning slowly; drag to turn it, What is inside pulls it apart. |
| Scrolling | The solid swaps for grains sampled from its own surface (same shape, same colours, so the swap is not seen), which melt: the top of the dish goes first, grains sag, thin to fine gold dust and rise into a slender vortex (three helical arms that turn with the scroll), then settle into the next dish from the bottom up. |
| Settle | At the next scene the grains hand back to the solid model. |
| Type | The giant name melts too: its letters drift and blur out while the next name's letters condense in. |
| Plinth | Stays put and eases its size between dishes. |

Scroll still snaps to scenes. Progress between two scenes is the melt's progress, so the guest
controls its speed with a thumb.

## 3. Technique

- Each dish's layers are merged in model space and sampled with three's `MeshSurfaceSampler`:
  about 30,000 points with position, normal and the painted vertex colour (the coffee's crema and
  the drink colours come from the product tone). Samples are cached per dish and selection.
- One `Points` object with a small custom shader holds "from" and "to" attributes. Each grain has
  a deterministic seed for its delay, arm, column radius and lift. Grains travel in cylindrical
  coordinates (at least one full turn, always the same way), so the flight reads as a vortex
  rather than a heap. The intro clock starts only after the canvas has drawn and faded in.
  Height decides when it leaves
  (top first) and when it lands (bottom first). Normals give the grains light and shade so the
  cloud still reads as a 3D form.
- No textures, no network. Sampling happens lazily for the current and next dish.

## 4. Accessibility, fallback, performance

- `prefers-reduced-motion`: no grains, no intro; the dish crossfades to the next one.
- No WebGL or a weak device: the illustrations crossfade in the same place.
- The canvas draws on demand: full rate while scrolling or melting, about 30 frames a second at
  rest, nothing when the tab is hidden. Pixel ratio capped at 1.75.
- Everything in the DOM (headings, buttons, rail, cart) is unchanged and tested as before.

## 5. Tests

- Vitest: the morph mapping (which two dishes, how far, rest and transit), grain sampling (count,
  finite positions, colours in range, deterministic, size of the cloud matches the dish).
- Playwright: Explore still works end to end (existing suite), scenes report the morph state,
  reduced motion and fallback do not draw grains, axe clean.
- Honest limit: motion quality cannot be judged by tests; frames are captured and reviewed.
