# Explore: the menu as a film you scrub

Status: built at the user's direction ("dig deep ... create the most creative one full of motion and 3d").
Builds on: the engine, data, cart and product sheet (unchanged), and the 3D stage from
`2026-10-15-immersive-slice-design.md`.
Fulfils: brief section 3C (Explore Mode: signature products, interactive 3D, storytelling, premium
recommendations, switch modes without losing the cart).

## 1. Why

The Quick Menu, however well lit, is still a list of rows with a sheet, which is what every
restaurant has. Explore replaces the list with one staged experience: a dark set where the house's
star dishes glide past a fixed camera as the guest scrubs with a thumb. The Quick Menu stays one tap
away for guests who just want to order.

## 2. Research that shaped it

- Scroll-driven 3D sites keep one fixed canvas and map a single scroll progress to camera and object
  state, computed from absolute progress rather than accumulated deltas (Codrops, Builder.io,
  three.js forum). One canvas, several models, not several canvases.
- Realistic scanned food models are paid assets; CC0 ones are rare. So the experience must carry its
  quality through staging, light, materials and motion, and accept real GLB models later.
- Full-screen shader backgrounds cost per pixel for as long as the page is open; keep them to cheap
  gradients and a baked grain, and cap pixel ratio.
- Exploded views and "what's inside" interactions are the strongest food-specific 3D idea that does
  not need photoreal meshes: the layers are the story.

## 3. The experience

- One scene per category, led by the house signature of that category: Flat White, Croissant,
  Atelier Burger, Mille-feuille, Yuzu Lemonade. Scenes come from data (`isSignature`), not code.
- Layers of the page, back to front: a lit background whose glow takes the dish's colour, the dish
  name set huge behind the object, one fixed WebGL canvas, then the controls.
- Scrolling glides the objects across the set (x offset, a slight turn, scale) and fans their layers
  out a little in transit, so they assemble as they arrive. Scroll snaps to each scene.
- "What's inside" separates the layers with a spring and names each ingredient on a hairline.
- Ingredient chips (Premium cheese, Double patty, Bacon) change the model live: the layer drops in.
- "Add to order" uses the existing cart. "Customise" opens the existing product sheet.
- A thin chapter rail on the edge shows where you are and jumps to a scene. The next dish peeks in
  from the edge; there is no scroll label.
- Steam over the coffee, bubbles in the lemonade, drifting dust in the light, sparks on add.
- The header toggles between Explore and the full menu; the cart is shared.

## 4. Models

Procedural, built from code. Five dishes: burger (existing, with detail pass), cup (existing, with
gilded rims and latte art), glass of lemonade (glass, liquid, ice, lemon), croissant (ridged
crescent), mille-feuille (puff, cream, striped icing). Honest limit: stylized product renders, not
photographs. Anything without a model keeps its illustration. Real `.glb` files can replace a model
later through the media list.

## 5. Rendering

- A studio built from emissive softboxes through `PMREMGenerator` (no network), soft shadow map for
  the key light, Khronos neutral tone mapping for true food colours.
- Vertex-colour painting with value noise instead of flat colours; crumb faces, grill marks,
  mottled crust, veined lettuce; porcelain with clearcoat; brass details.
- One canvas draws every scene; only models within 1.6 scenes of the camera are drawn.

## 6. Data change

`art` media items may carry an optional `model` (`cup`, `burger`, `glass`, `croissant`,
`millefeuille`), validated, so two products with `art: "pastry"` can have different models. The seed
marks Yuzu Lemonade as a signature (cold drinks, lunch and dinner).

## 7. Fallback, performance, accessibility

- Same device gate as the stage (WebGL, no data saver, memory and cores). Without 3D, each scene
  shows its illustration on the same set with the same layout and snap, so nothing is missing.
- `prefers-reduced-motion`: no glide, no fan, no steam or bubbles; scenes stack and snap; the model is
  still and can be turned by hand.
- The page stays a real document: one heading per scene, real buttons, native scrolling, keyboard
  scrolling works. Decorative layers are `aria-hidden`.
- Pixel ratio capped at 1.75, on-demand rendering, loop stops when the tab is hidden.

## 8. Tests

- Vitest: choreography (scene state from progress is continuous, symmetric and bounded), scene
  builder (one scene per category from signatures, in category order), model parsing, new
  geometry, `drinkStyle`.
- Playwright: Explore loads with one scene per category, rail jumps, "What's inside" labels appear,
  an ingredient chip changes the layer list, Add updates the cart bar, the toggle keeps the cart,
  reduced motion has no glide, axe clean in English and Arabic, fallback with `?stage=off`.

## 9. Risks

| Risk | Handling |
|---|---|
| Procedural models still read as primitive | Lean on staging, light and motion; honest note; GLB path next |
| Weight of three plus five models | Lazy chunk, device gate, illustration fallback |
| Taste mismatch a third time | The user reviews it live; the concept is one idea, not many |
