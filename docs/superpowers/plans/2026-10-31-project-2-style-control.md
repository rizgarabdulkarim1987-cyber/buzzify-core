# Project 2 finish: plan

Spec: `docs/superpowers/specs/2026-10-31-project-2-style-control-design.md`. Test first, one slice at a time; each slice
ends green on `tsc`, `eslint` and its tests.

1. **Motion presets (pure).** `src/lib/templates/motion-presets.ts`; `DesignOverrides.motionPreset`; `parseOverrides`
   keeps a known id; `resolveDesign` puts the preset over the template scene and the hand-set `scene` over the preset.
   Tests: `tests/lib/motion-presets.test.ts`.
2. **Premium templates (pure).** `src/lib/templates/premium.ts`. Tests: `tests/domain/style-control-locks.test.ts`.
3. **Plan rules.** `premiumTemplateLock`, `motionPresetLock`; `clampBrandView` gives guests the template's own motion
   when a stored preset is locked; `hiddenFromGuests` names it; `updateDesign` and `applyDesign` refuse a new locked
   choice (`UPGRADE_REQUIRED`) and keep a stored one. The three features become `live`.
4. **Background image.** `SceneMedia` kind `image`; `IMAGE` becomes a scene kind; `sceneMediaOf`, `parseSceneMedia`,
   `menuDesignSchema`; `SCENE_FEATURES.image`. Tests: `tests/lib/background-image.test.ts`, `scene-files.test.ts`.
5. **Guest rendering.** `scenePlan` returns `image` in every mode; `ImageScene`; `SceneLayer`.
   Tests: `tests/ui/scene-signal.test.ts`.
6. **Studio.** Picker lists pictures; Customize gets the preset row; the Gallery marks premium templates; messages in
   `en`, `ar` and `ckb`. Tests: `tests/studio/gallery.test.ts`.
7. **Verify and review.** Full test run, typecheck, lint of what changed, a look at the Design tab in the browser, and a
   whole-branch review. Nothing is pushed or merged; the user decides.
