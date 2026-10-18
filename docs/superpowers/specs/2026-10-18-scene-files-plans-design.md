# Scene files and plans

Status: approved design, not built yet
Date: 2026-10-18
Builds on: `2026-10-18-template-studio-stage-2-scene-files-design.md` (scene files) and
`2026-10-18-plans-and-entitlements-design.md` (plans, the resolver, kept choices)

Everything the user decided is marked **[user]**. Everything else is Claude's call and is marked **[call]**.

## 1. Intent

Stage 2 lets a business put its own 3D model, video or Lottie animation behind its template menu. Nothing checks the
restaurant's plan, so a Basic restaurant can show guests a background video. Meanwhile the plans list background video
and 3D models as Premium features that are "not built yet".

This build connects the two. What a business may choose as its background file, and what guests see, follows the
restaurant's plan. It uses the rules the Brand tab already follows for font pairs, rails and motion:

- guests on a plan without a feature get the fallback;
- a locked choice may be kept, but never newly made;
- nothing stored is rewritten, so moving back up a plan brings everything back.

## 2. Goals and non-goals

Goals:

- Each scene file kind has a feature key. The three keys are live on the Plans screens.
- Guests never see a file whose feature the plan lacks.
- A save never newly chooses such a file.
- The Studio shows what is locked and how to get it, in the same way the Brand tab does.

Non-goals:

- Locking uploads. Every plan keeps as many media files as it needs (plans spec 4.1), so any restaurant may still
  upload a GLB, MP4 or Lottie file to its library. **[call]**
- Background photos. `design.backgroundImage` stays reserved, because photo backdrops are not built.
- 3D models per dish (roadmap project 4).

Anti-goal: a downgrade must never delete or rewrite a restaurant's file choice, and never change a published revision
or its hash.

## 3. Feature keys **[user]**

| File kind (`MediaKind` / `SceneMedia.kind`) | Feature | Starts in |
|---|---|---|
| `MODEL` / `model` (GLB) | `immersive.models3d` | Premium |
| `VIDEO` / `video` (MP4) | `design.backgroundVideo` | Premium |
| `LOTTIE` / `lottie` (Lottie JSON) | `design.backgroundAnimation` (new) | Pro |

Catalog changes in `src/server/domain/entitlements.ts`:

- `design.backgroundAnimation` is new: area `design`, project 2, status `live`, starts in `PRO`.
- `design.backgroundVideo` and `immersive.models3d` become `live`.
- The live block keeps its order and gains the three keys after `design.menuMotions`:
  `design.backgroundAnimation`, `design.backgroundVideo`, `immersive.models3d`.
- `immersive.models3d` moves to project 2, since this project builds it. Its name already reads generally ("Your own
  3D models"). When project 4 adds models per dish, it can reuse this key. **[call]**
- The Plans screens list each key with a name in English, Arabic and Sorani, under
  `plans.feature.design.backgroundAnimation`. The Sorani is machine-drafted, like the other Sorani strings.

Shared files from the platform library follow the same rules: a shared video is still a background video. **[call]**

## 4. Rules **[user]**

### 4.1 What guests see

A guest whose restaurant's plan lacks the file's feature gets the menu without the file. That is the template's own
scene, in the mode the business chose, as when the file fails to load (stage-2 spec, section 5).

- The check is applied when the menu is served, in `clampBrandView`, which removes `design.media` when its kind's
  feature is missing. The public menu and the Studio's Preview tab use it already through `tenantInfo`. **[call]**
- The plan is read live, as for brand choices, so a change of plan reaches guests without a publish.
- The stored revision, its snapshot and its hash never change.

### 4.2 Saving

`updateDesign` refuses a save that **newly** chooses a file whose kind the plan locks. It throws `UPGRADE_REQUIRED`
with the feature and the lowest plan that includes it, through `requireFeature`.

- **New** means that the chosen `assetId` differs from the one stored in the brand kit's design.
- The same file is a kept choice, whatever the plan. A save that changes colours or the model's framing, and leaves
  the file as it was, is accepted. **[call]**
- Another restaurant's file, a picture, or a missing file still answers `NOT_FOUND` first, so a foreign id reveals
  nothing.

### 4.3 Copies and other ways a file arrives **[call]**

| Path | What happens to a file the plan locks |
|---|---|
| Applying a saved design (the restaurant's own or a shared one) | Applied without the file. `applyDesign` already drops a file the restaurant may not use; this is a new choice. |
| Duplicating a menu (into the same or another restaurant) | The copy's design drops the file, following the destination's plan, as `clampBrandChoices` does for brand choices. The file itself is still copied into the library, as today. |
| Restoring a revision to the draft, rolling back | Kept: the stored overrides come back as they were; guests see the fallback. |
| Changing the template, resetting the look | Unchanged: the file goes with the look, as in stage 2. |
| "Save as custom" | The saved design keeps the file. Applying it later on a plan that locks it drops the file. |

## 5. The Studio **[user]**

### 5.1 The picker ("Background files")

- Every scene file is listed: the restaurant's and the shared ones. A file whose kind the plan locks is dimmed, carries
  a lock, and cannot be chosen.
- A filter chip for a locked kind shows a lock too. **[call]**
- Under the grid, there is one `UpgradeHint` for each locked feature, in catalog order. Each hint says "Part of
  {plan}" and has the WhatsApp button, or "Change plan" for the platform owner.
- Upload stays available, and a file of a locked kind appears locked once it is uploaded. **[call]**
- On Basic all three kinds are locked. "Choose a file" still opens the picker, so the business sees what the higher
  plans include. **[call]**

### 5.2 The "Background file" panel, with a kept locked file

- The file stays shown, with Change and "Use template scene".
- A line says that guests see the template's scene until the plan includes the feature, and an `UpgradeHint` follows.
- The framing sliders stay usable.

### 5.3 Previews

- The Design tab's live preview plays the stored file, even when it is locked. It shows what is on screen, as the
  Brand tab's sample does.
- The Preview tab shows what guests get. Its plan note (`hiddenFromGuests`) lists the file's feature when the draft's
  design has a file the plan locks. The feature comes right after the brand choices, before Explore, because it is
  part of the look. **[call]**

### 5.4 What the Design tab reads **[call]**

`design.get` adds a plan view to `DesignView`:

- the scene kinds the plan allows;
- the feature of the stored file when the plan locks it, else `null`;
- the `UpgradeInfo` that the hints need (as `brand.get` returns it).

## 6. Pure functions **[call]**

In `src/server/domain/plan-choices.ts`, next to their brand counterparts:

- `sceneFeature(kind: 'model' | 'video' | 'lottie'): FeatureKey`
- `allowedSceneKinds(entitlements)`: the kinds the plan allows, in the order `model`, `video`, `lottie`.
- `sceneChoiceLock(next, stored, entitlements)`: the feature a save needs, or `null`. `next` is the chosen asset id and
  its kind, or nothing. `stored` is the stored asset id, or nothing.
- `clampBrandView` drops `design.media` that the plan locks. It never changes the view it is given.
- `hiddenFromGuests` lists the stored file's feature, as section 5.3 says.

## 7. Testing

- **Unit** (`tests/domain/entitlements.test.ts`, `tests/domain/plan-choices.test.ts`):
  - the catalog: twelve live features, in order, and the new key's default plans;
  - `sceneFeature` for each kind;
  - `allowedSceneKinds` on Basic, Pro and Premium;
  - `sceneChoiceLock` for a kept file, a newly chosen locked file, an allowed file and no file;
  - `clampBrandView` for each kind on each plan, without changing its input;
  - `hiddenFromGuests` with a locked file and with an allowed one.
- **Database** (`tests/studio/scene-files.test.ts`, on a restaurant moved to Pro or Basic):
  - choosing a video or model is refused with `UPGRADE_REQUIRED`, its feature and `PREMIUM`;
  - choosing a Lottie file is accepted on Pro and refused on Basic;
  - a stored video survives a save that changes colours and framing after a downgrade;
  - choosing another locked file is refused;
  - applying a shared design with a video on Pro drops the file;
  - duplicating into a Pro restaurant drops it;
  - `design.get` reports the allowed kinds and the locked feature;
  - `preview.planNote` lists `design.backgroundVideo`;
  - the published menu's `tenantInfo` on Pro has no `design.media`, and on Premium it has one.
- **Browser** (`tests/e2e/scene-files-stage.spec.ts`): guest behaviour changes on lower plans, so the suite gains a
  video menu under a throwaway restaurant on Pro. That menu shows the template's own scene and loads no `<video>`.
  The existing menus stay on the Premium default.
- **Studio by hand**: the locked picker and panel are checked in the browser (on Pro: the video and model tiles are
  locked, Lottie can be chosen).

## 8. Documents to update

- The plans spec, section 4: the three keys are no longer listed as reserved, and the new key is in the live table.
- The stage-2 spec gains a pointer to this one.

## 9. Left to the builder

- Function and prop names beyond section 6.
- The Studio wording in English, Arabic and Sorani (for example, reusing `brand.lockedChoice` for the panel's line).
- How the e2e helper creates the Pro restaurant.
- How the plan view is threaded from the query into `DesignStudio`, `Customizer` and `ScenePicker`.
