# Project 4 plan: a 3D model per dish, and AR

Spec: `docs/superpowers/specs/2026-10-31-project-4-dish-models-ar-design.md`. Test-first in each task; commit after each.

1. **Media model.** `src/lib/media.ts`: `model3d` gets an optional poster and an `assetId`; `DraftMediaItem` gains
   `{ kind: 'model', assetId }`. Tests in `tests/lib`.
2. **Resolve and restore.** `src/server/media/resolve.ts`: `modelAssetIds`, `resolveDraftMedia` takes the loaded models,
   `draftMediaFromSnapshot` maps a `model3d` with an asset id back. Publish (`publish/draft.ts`) and the till catalog load the models.
   Tests: round trip, a foreign model stays unresolved and publish refuses it.
3. **Save and plan lock.** `studio/services/content.ts`: a model entry must be a library model of this restaurant (kind `MODEL`), at
   most one per dish; a new one needs `immersive.models3d`, a stored one is kept. Tests in `tests/studio`.
4. **Entitlements and guest view.** `immersive.ar` live; `menu-view` exposes `model` per product and `ar` per menu by plan.
5. **Studio field.** The dish editor's 3D model picker, its query data (model name) and the three-language messages.
6. **Guest viewer.** `@google/model-viewer` dependency, a lazy viewer on the dish page, the AR button, guest messages.
7. **Verify.** Type check, the full suite compared with the known failures, a browser check, `graphify update .`.
