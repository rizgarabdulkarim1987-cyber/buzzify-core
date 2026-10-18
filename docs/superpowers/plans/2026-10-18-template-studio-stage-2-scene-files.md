# Template Studio Stage 2 (Scene Files) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business (or the platform, through shared saved designs) use a GLB model, an MP4 video or a Lottie animation from the media library as its template menu's background.

**Architecture:** The existing media library (`MediaAsset`, `src/server/media/*`, `src/server/studio/services/media.ts`) gains three kinds checked by pure byte parsers. The design overrides name the chosen file; publishing resolves it into `MenuDesign.media` and `MenuRevision.assetIds`. The scene layer (`src/ui/scenes`) plays it above the template's poster, falling back to the stage-1 layers.

**Tech Stack:** Next.js 16, React 19, Prisma 7 (PostgreSQL), sharp, three.js 0.186 with React Three Fiber 9 (`GLTFLoader` + `MeshoptDecoder`), lottie-web 5.13.0 (`build/player/lottie_light`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-template-studio-stage-2-scene-files-design.md`

## Global Constraints

- Limits: `MODEL` 10 MB, `VIDEO` 20 MB, `LOTTIE` 2 MB, pictures 15 MB (unchanged). The largest upload slot is 20 MB.
- Video: MP4, H.264 (`avc1`/`avc3`) only, at most 30 s, at most 1920 px on the longest side, a poster required.
- GLB: glTF 2.0 binary, no `uri` anywhere, buffer 0 is the BIN chunk, extra buffers only as meshopt fallbacks; required extensions only `KHR_mesh_quantization`, `EXT_meshopt_compression`, `KHR_texture_transform`, `EXT_texture_webp`, `KHR_materials_*`; images PNG/JPEG/WebP ≤ 4096 px a side and ≤ 32,000,000 px in all; ≤ 300,000 triangles, ≤ 2,000 nodes, ≤ 64 materials, ≤ 32 textures, ≤ 32 animations.
- Lottie: strict UTF-8 JSON object; `fr` 1–120; `w`,`h` 1–4096; ≤ 60 s; depth ≤ 64; ≤ 2,000 layers; any string under key `x` refused; layer `ty` only 0–5; image assets embedded base64 PNG/JPEG/WebP; fonts without `fPath` or `fOrigin` `p`/`g`/`t`; `ln` and `cl` removed; stored minified.
- Framing: `scale` 0.5–2 (1), `x` −1–1 (0), `y` −1–1 (0), `turn` −180–180 (0).
- Studio copy in English, Arabic and Sorani (`src/studio/messages/{en,ar,ckb}.ts`); `tests/studio/messages.test.ts` requires the same keys in all three.
- Never touch real businesses in the dev database (zhamitos); verification uses this worktree's own database (`BUZZIFY_DB_PORT=54349`) and the demo menus.
- Lint with `npx eslint src tests scripts prisma eslint.config.mjs` (not `.`).

## Review Focus

1. A real exporter's GLB with `EXT_meshopt_compression` and a fallback buffer is accepted (Task 2 test `accepts a meshopt file with a fallback buffer`).
2. A phone MP4 with an audio track and `moov` after `mdat` is accepted and played muted (Task 3 test `accepts moov after mdat with a sound track`).
3. A fragmented MP4 (a browser recorder's) whose `mvhd` duration is 0 gets its duration from its fragments, and is refused past 30 s (Task 3 tests).
4. A product photo, logo or SEO image given a `VIDEO`/`MODEL`/`LOTTIE` id is refused `NOT_FOUND` (Task 5 test `pictures never take a scene file`).
5. A pretty-printed Lottie with a BOM is accepted; a numeric `x` is not an expression (Task 4 tests).

---

### Task 1: Kinds, sniffing and limits

**Files:**
- Modify: `src/server/domain/media-type.ts`
- Test: `tests/domain/media-type.test.ts`

**Interfaces:**
- Produces: `MEDIA_MIMES` adds `'model/gltf-binary' | 'video/mp4' | 'application/json'`; `PICTURE_MIMES`, `SCENE_MIMES`; `maxBytesFor(mime: MediaMime): number`; `UPLOAD_MAX_BYTES = 20 MB`; `sniffMediaType(head)` returns the new mimes; `declaredMime` maps `model/gltf+binary`, `application/octet-stream` → null (the Studio names `.glb` itself); `checkUploadRequest` uses `maxBytesFor`. `MEDIA_MAX_BYTES` stays the picture limit.

- [ ] Tests: `sniffs a GLB by its magic`, `sniffs MP4 brands isom/mp42/avc1 but keeps AVIF as AVIF`, `sniffs a JSON object (after a BOM and whitespace) as application/json`, `refuses a JSON array`, `limits per kind: 10/20/2/15 MB`. Run `npx vitest run tests/domain/media-type.test.ts` → fail; implement; pass.

### Task 2: GLB check

**Files:**
- Create: `src/server/media/glb.ts`, `tests/helpers/scene-files.ts`
- Test: `tests/media/glb.test.ts`

**Interfaces:**
- Produces: `checkGlb(bytes: Uint8Array): Promise<{ ok: true; meta: ModelMeta } | { ok: false; reason: 'MODEL_INVALID' | 'MODEL_EXTERNAL' | 'MODEL_EXTENSION' | 'MODEL_TOO_COMPLEX'; detail: string }>`; `ModelMeta = { triangles: number; nodes: number; materials: number; textures: number; animations: number }`.
- Produces (tests): `buildGlb(options?: { json?: (gltf) => void; image?: Uint8Array; meshopt?: boolean; extraBin?: number }): Uint8Array` builds a valid one-triangle GLB (with an optional embedded PNG made by sharp).

- [ ] Tests: accepts the built GLB and reports its meta; `accepts a meshopt file with a fallback buffer`; refuses: bad magic, version 1, length mismatch, chunk past the end, any `uri` (buffer, image, inside an extension), a `data:` URI, buffer view past BIN, `KHR_draco_mesh_compression` required, an image whose bytes are not its `mimeType`, a 5000 px image, 300,001 triangles, 2,001 nodes. Implement (JSON parsed once; images checked with `sniffMediaType` + `sharp().metadata()`); pass.

### Task 3: MP4 check

**Files:**
- Create: `src/server/media/mp4.ts`
- Modify: `tests/helpers/scene-files.ts` (add `buildMp4`)
- Test: `tests/media/mp4.test.ts`

**Interfaces:**
- Produces: `readMp4(bytes: Uint8Array): { ok: true; info: VideoInfo } | { ok: false; reason: 'VIDEO_INVALID' | 'VIDEO_CODEC' | 'VIDEO_DIMENSIONS' | 'VIDEO_DURATION' }`; `VideoInfo = { durationMs: number; width: number; height: number; codec: 'avc1' | 'avc3'; hasAudio: boolean }`.
- Produces (tests): `buildMp4(options?: { codec?: string; width?: number; height?: number; durationMs?: number; sound?: boolean; moovLast?: boolean; fragmented?: { fragments: number; msEach: number } }): Uint8Array` with boxes `ftyp moov(mvhd trak(tkhd mdia(mdhd hdlr minf(stbl(stsd)))) [mvex]) [moof(traf(tfhd tfdt trun))] mdat`.

- [ ] Tests: reads duration, size, codec; `accepts moov after mdat with a sound track` (hasAudio true); 64-bit box sizes; fragmented duration from `trun` sample durations (with `tfhd` default duration too); refuses `hvc1`, 3840×2160, 30,001 ms, no video track, a box past the end, no `moov`. Implement (walk boxes within bounds; `mvhd` v0/v1; `tkhd` 16.16 size; fragments by track timescale from `mdhd`); pass.

### Task 4: Lottie check

**Files:**
- Create: `src/server/media/lottie.ts`
- Test: `tests/media/lottie.test.ts`

**Interfaces:**
- Produces: `checkLottie(bytes: Uint8Array): Promise<{ ok: true; json: string; info: LottieInfo } | { ok: false; reason: 'LOTTIE_INVALID' | 'LOTTIE_EXPRESSION' | 'LOTTIE_EXTERNAL' | 'LOTTIE_TOO_COMPLEX' }>`; `LottieInfo = { width: number; height: number; frameRate: number; durationMs: number; layers: number }`.

- [ ] Tests: accepts a minimal shape animation, and the same pretty-printed with a BOM; a numeric `x` passes; refuses: invalid UTF-8, not an object, missing `layers`, `fr` 0, `w` 5000, 61 s, an expression in `ks.p.x`, an audio layer (`ty: 6`), an image asset by path, an image asset whose data is not an image, a font with `fPath`, depth 65; strips `ln`/`cl` and minifies. Implement; pass.

### Task 5: Library: migration, upload, listing, pictures-only pickers

**Files:**
- Create: `prisma/migrations/<timestamp>_scene_files/migration.sql` (via `prisma migrate dev --create-only`)
- Modify: `prisma/schema.prisma` (`MediaKind` + `MODEL VIDEO LOTTIE`; `MediaAsset.durationMs Int?`, `meta Json @default("{}")`), `src/server/media/process.ts`, `src/server/media/resolve.ts`, `src/server/media/copy.ts`, `src/server/studio/services/media.ts`, `src/server/studio/queries/media.ts`, `src/app/api/studio/media/finalize*/route.ts`, every `loadAssets` caller (`content.ts`, `brand.ts`, `draft.ts`, SEO)
- Test: `tests/media/process.test.ts`, `tests/studio/media.test.ts`

**Interfaces:**
- Produces: `prepareAsset(bytes, poster?: Uint8Array)` returns `PreparedAsset` with `kind` of all six, `durationMs`, `meta`; refusals gain `POSTER` and the Task 2–4 reasons; `AssetVariants.poster?: { avif: Record<string,string>; webp: Record<string,string> }`; finalize input `posterKey?: string`; `PICTURE_KINDS`, `SCENE_KINDS` (in `src/server/media/kinds.ts`); `loadAssets(db, restaurantId, ids, kinds = PICTURE_KINDS)`; `listLibrary` input `kinds?: 'pictures' | 'scene' | 'all'` (default `'pictures'`); `MediaRow` gains `durationMs`, `meta`, `posterUrl` and `thumbUrl` `''` for models and Lottie.

- [ ] Tests: finalize of a GLB, a Lottie, a video with poster (poster widths and placeholder stored); a video without poster refused `POSTER`; a 12 MB GLB refused `SIZE`; the same file twice deduplicated; `pictures never take a scene file` (product media, logo, SEO image with a video id → `NOT_FOUND`); listing defaults to pictures, `scene` lists only scene kinds, `all` both; delete removes poster files. Migrate (`npx prisma migrate dev --name scene_files` on port 54349); implement; pass.

### Task 6: Choosing, publishing, usage

**Files:**
- Modify: `src/lib/templates/types.ts`, `src/lib/templates/resolve.ts` (`parseOverrides`), `src/server/domain/design-schema.ts`, `src/server/studio/services/design.ts`, `src/server/publish/draft.ts`, `src/server/domain/snapshot.ts` (`snapshotAssetIds`), `src/server/media/usage.ts`, `src/server/media/scene.ts` (new: `sceneMediaOf`)
- Test: `tests/studio/design.test.ts`, `tests/domain/snapshot.test.ts`, `tests/publish/draft.test.ts`, `tests/studio/media.test.ts`, `tests/studio/cross-tenant.test.ts`

**Interfaces:**
- Produces: `ModelFraming`, `SceneAssetChoice { assetId; framing?: Partial<ModelFraming> }`, `SceneMedia` (spec 4.1), `DesignOverrides.sceneAsset?`, `MenuDesign.media?`, `FRAMING_RANGES`; `sceneMediaOf(asset: ResolvableAsset, mediaUrl, framing?: Partial<ModelFraming>): SceneMedia | null`; `AssetUsage.drafts[].where` adds `'scene' | 'savedDesign'`; `DesignView.sceneMedia: SceneMedia | null`.

- [ ] Tests: `parseOverrides` keeps a valid choice and clamps framing, drops a bad id; update with own/shared file ok, another restaurant's or a picture → `NOT_FOUND`; changing template and reset drop it, saving a design keeps it, a shared saved design with a restaurant file → `INVALID`; draft snapshot has `design.media`; snapshot schema refuses an `http:` URL; `snapshotAssetIds` includes it; restore writes the choice back; duplicate into another restaurant copies and renames it; usage lists the brand kit and the saved design, and delete is refused while a draft, saved design or revision uses it; cross-tenant entries for `design.update` ("B's scene file") and `media.list` with `kinds: 'scene'`. Implement; pass.

### Task 7: Playback

**Files:**
- Modify: `package.json` (`lottie-web` 5.13.0), `src/ui/scenes/signal.ts` (`scenePlan`), `src/ui/scenes/SceneLayer.tsx`, `src/ui/scenes/three/SceneCanvas.tsx`, `src/ui/scenes/scenes.css`
- Create: `src/ui/scenes/media/VideoScene.tsx`, `src/ui/scenes/media/LottieScene.tsx`, `src/ui/scenes/three/AssetModel.tsx`, `src/types/lottie-light.d.ts` if the build has no types
- Test: `tests/ui/scene-signal.test.ts`

**Interfaces:**
- Produces: `scenePlan(requested: VisualMode, media: SceneMedia['kind'] | null, env: SceneEnvironment & { failed: boolean }): 'poster' | 'motion' | '3d' | 'model' | 'video' | 'videoStill' | 'lottie'` implementing the spec 5 table and fallbacks.

- [ ] Tests: every row of spec 5's table; reduced motion → `poster` or `videoStill`; model without WebGL → `motion`; video with data saver → `videoStill`; `failed` → `motion`. Implement the function, then the components (model replaces the code scene in the one canvas; video and Lottie mount after idle; all pause with `paused`; errors call `onFail`); pass. Check `lottie_light` has no `eval`/`new Function`.

### Task 8: Studio

**Files:**
- Modify: `src/studio/media/{upload.ts,DropZone.tsx,MediaGrid.tsx,MediaDetails.tsx,MediaLibrary.tsx}`, `src/studio/workspace/design/{Customizer.tsx,DesignStudio.tsx}`, `src/ui/template/PreviewDesign.tsx` (`DesignMessage.media`), `src/app/studio/_actions/media.ts`, `src/studio/messages/{en,ar,ckb}.ts`
- Create: `src/studio/media/poster.ts` (`posterFrame(file: File): Promise<Blob>`), `src/studio/workspace/design/ScenePicker.tsx`

- [ ] Typecheck and the messages test pass; the Media page uploads each kind; the Motion panel picks, frames and removes a file and the preview follows at once (verified in Task 9).

### Task 9: Verify and document

**Files:**
- Create: `scripts/scene-fixtures.ts` (writes a sample GLB and Lottie to `.data/scene-fixtures/`)
- Modify: `README.md` (Template Studio: "Scene files"; Security notes; R2 CORS)

- [ ] Own database up and seeded; dev server on 3130; on `maison-demo` (demo only): a model, a video (recorded in the browser with `MediaRecorder`), a Lottie; each with reduced motion, no WebGL (model), `?scene=fail`; screenshots. Then `npm run typecheck`, the lint command above, `npm test` (with `BUZZIFY_DB_PORT=54349`) all pass.
