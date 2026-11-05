# Project 2 finish: premium templates, background image, motion presets

Status: building (the user said "continue without questions" on 2026-10-31 and went to sleep; every choice below is
Claude's call, marked **[call]**, to be checked when the user is back)
Date: 2026-10-31
Builds on: `2026-10-18-product-roadmap.md` (project 2), `2026-10-18-plans-and-entitlements-design.md`,
`2026-10-18-template-studio-stage-2-scene-files-design.md`

## 1. Intent

Project 2 of the roadmap promised templates, uploaded backgrounds and motion control, sold as privileges. Template
Studio (30+ presets, Design tab), scene files (model, video, Lottie) and menu motions are built and live. Three plan
features are still `reserved` and show "Not built yet" in Settings > Plans:

| Feature key | Plan | What it must do |
|---|---|---|
| `design.backgroundImage` | PRO | A picture from the library as a template menu's background |
| `design.motionPresets` | PRO | One-click named bundles of the scene's motion settings |
| `design.premiumTemplates` | PRO | A set of showpiece templates that Basic cannot newly choose |

Goal: after this, none of the three is `reserved`; each works end to end (Studio choice, published snapshot, guest
menu) and respects the plan rules already in force.

## 2. Non-goals and anti-goals

- No new templates, no change to any template's look. Anti-goal: breaking or restyling any published menu.
- No new database table or migration (a picture is already a library `IMAGE` asset). **[call]**
- Nothing for projects 3 to 6.
- A downgrade never rewrites stored choices and never breaks a published menu (the rule of project 1): a locked
  choice may be kept, never newly made.

## 3. Design

### 3.1 Background image (`design.backgroundImage`)

- `SceneMedia` gains `{ kind: 'image', assetId, url, width, height, srcset, placeholder }`, resolved at publish like
  the other kinds (same strict URL checks in `design-schema.ts` and `parseSceneMedia`).
- The library's `IMAGE` kind becomes selectable as a scene file in the Design tab's scene picker (it lists pictures
  under a new "Picture" group). `SCENE_FEATURES.image = 'design.backgroundImage'`; `allowedSceneKinds`,
  `sceneChoiceLock`, `clampBrandView` and `hiddenFromGuests` then lock it with no extra code.
- The guest menu draws it in `SceneLayer` as a covering, non-moving picture under the same veil (`overlay`,
  `brightness`, `blur`, `opacity`) as other scene files, with the blurred placeholder first. It does not drift (built
  without it: a still picture needs no idle page, no WebGL and no exception for reduced motion or data saver). **[call]**
- A picture that fails to load gives way to the template's poster.
- SVG and ICON stay out: a background must be a raster. **[call]**
- `IMAGE` joins the library's scene kinds, so a photo is now listed in both families (the one overlap, noted in
  `src/server/media/kinds.ts`); a vector graphic is still refused as a background. **[call]**

### 3.2 Motion presets (`design.motionPresets`)

- A preset is a named set of the scene settings that mean "how much it moves": `intensity`, `speed`, `ambient`,
  `tap`, `scroll`. Four, in `src/lib/templates/motion-presets.ts`: `still` (nothing moves), `calm`, `lively`,
  `showtime`. **[call]**
- Stored as `DesignOverrides.motionPreset?: MotionPresetId`. Resolution order: template scene, then the preset, then
  the business's own `scene` overrides (a hand-set slider still wins). Brightness, blur, opacity and overlay are not
  part of a preset.
- Plans: `still` is for every plan (turning motion off is never sold). Others need `design.motionPresets`. A stored
  locked preset is ignored by guests on a plan without the feature (the template's own motion plays) and may be kept
  in the draft. **[call]**
- Studio: a row of four buttons at the top of the scene section of Customize, with a lock mark on locked ones.

### 3.3 Premium templates (`design.premiumTemplates`)

- `PREMIUM_TEMPLATE_IDS` in `src/lib/templates/premium.ts`: the presets tagged `cinematic` that come after the first
  thirty, which stay free because they were sold before this feature. Derived from the tags, with tests that the first
  thirty and every business type keep free templates. **[call]** (Changed from the first draft's "fixed list".)
- Basic cannot newly choose one (save refused with the same upgrade lock as other plan locks; the Gallery shows a
  lock mark and the upgrade hint). A menu already on one keeps it and keeps publishing; guests are unaffected.
- Not retroactive for any current menu: nothing stored changes.

### 3.4 Plans screen

The three features become `live`; their "Not built yet" badges go. Default tier placement stays as reserved.

## 4. Constraints

- Pure logic (presets, premium set, locks, resolve) first and tested; UI after.
- Studio strings in all three languages (`en`, `ar`, `ckb`).
- No motion changes in the cashier (separate rule); this touches the guest menu and the Studio only.

## 5. Left to the builder

File names, component structure, exact preset numbers within the ranges of `SceneSettings`, copy of the three
Studio strings.
