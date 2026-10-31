# Project 4: a 3D model per dish, and AR on the table

Roadmap project 4 (plans spec 4.2: `immersive.ar`, Premium; scene-files spec: "when project 4 adds models per dish, it can reuse
`immersive.models3d`"). The user asked for the whole roadmap in order with no questions; every decision of mine is marked **[call]**.

## Intent

A restaurant uploads a GLB of a dish to its library, picks it on the dish, and guests can turn the dish around on their phone
and, on a phone that supports it, put it on their table in AR. The point is to sell: guests see the size and the look of the
dish before they order.

## Goals

- A dish may carry one library model (`MediaAsset` of kind `MODEL`). Picking it is part of the dish's media, so it is saved,
  published, restored, duplicated and rolled back the way the dish's photos are.
- Guests with the plan feature `immersive.models3d` get a "View in 3D" button on the dish page that opens a viewer they can
  turn and zoom. Guests on a plan with `immersive.ar` also get a "See it on your table" button where the device supports AR.
- Plan lock as in projects 2 and 3: a new model choice is refused with `UPGRADE_REQUIRED`; a stored choice is kept and simply
  not shown to guests when the plan lacks the feature; removing a model is never gated.
- The viewer costs nothing for a menu with no models: the viewer code is loaded only when a guest opens one.

## Non-goals

- Making models. The restaurant uploads a GLB; the upload limits that already exist for models apply (size, triangles).
- A USDZ upload. iOS Quick Look gets the model from the viewer library, which converts the GLB on the device. **[call]**
- Several models per dish, model variants per size, animations authored in the Studio.
- Replacing the existing 3D stage (`immersive.stage`, the procedural dishes): a dish with a stage keeps it; the library model is a
  separate, additional view. **[call]**

## Anti-goals

- A downgrade must never delete or rewrite the restaurant's model choice, nor change a published revision or its hash.
- A model of another restaurant must never be pickable or shown.
- Nothing heavy may load on a menu that has no models, nor on page load of one that has: only after the guest taps the button.

## Design

- **Data.** No schema change. A dish's `media` gets a new draft entry `{ kind: 'model', assetId }` (library model chosen) next to
  `{ kind: 'asset', assetId }` (photo). Publishing resolves it into the existing `model3d` item, now
  `{ kind: 'model3d', url, poster?, assetId? }`: the poster becomes optional (a GLB has none; the viewer draws its own).
  Restoring a snapshot turns a `model3d` with an `assetId` back into `{ kind: 'model', assetId }`. At most one model per dish.
- **Studio.** The dish editor gets a "3D model" field: pick a model from the library (models only), see its name, remove it.
  A locked plan shows the same upgrade hint as the other locked controls and keeps a stored choice.
- **Guest.** `buildMenuView` exposes `model: { url, assetId } | null` on a product only when the plan allows
  `immersive.models3d`, and `ar: boolean` on the menu when it allows `immersive.ar`. The dish page shows the buttons; the viewer is
  `@google/model-viewer` (it handles WebXR, Android Scene Viewer and iOS Quick Look) loaded with a dynamic import on first tap. **[call]**
- **Entitlements.** `immersive.ar` goes live (project 4). `immersive.models3d` keeps its key and its Premium start; its description
  now covers per-dish models.

## Left to the builder

Exact wording of the three-language messages, the viewer's look (it follows the template's tokens), and the loading state.

## Verification

Unit tests for the media resolve and restore round trip, the plan lock and downgrade, the cross-tenant refusal and the menu view
gating; a type check; the browser check of the Studio field and the guest viewer on a published menu with a model.
