# Template Studio, stage 2: scene files

Status: building (the user said "ابدأ دون أسئلة" (start without questions) and asked for every choice to be written
here; everything not quoted from the brief is Claude's call and is marked **[call]**)
Date: 2026-10-18
Builds on: `2026-10-18-template-studio-design.md` (stage 2 of its stages table), and the media library of
`2026-10-16-studio-core-design.md` (spec 11)
Brief: the main session's stage-2 task: "an asset library for scene media (GLB models, short videos, Lottie animations)
that template presets and businesses can use as their background scene"

## 1. Intent

Stage 1 gave every template a background drawn in code: a still poster, a CSS motion version and a three.js scene. A
business could tune it but not bring its own. Stage 2 lets a business, or the platform for everyone, put its own
moving background behind the menu: a 3D model, a short video or a Lottie animation. The menu must stay what stage 1
promised guests: products and prices first, readable text, fast on an ordinary phone, nothing that runs code from an
uploaded file.

From the brief, as requirements:

- Files are judged by their bytes, never by their names, with a size limit per kind.
- A restaurant's files belong to it; shared files are the platform's, and only a Super Admin manages them.
- No upload can run a script: Lottie is data only (expressions and scripts refused); a GLB is parsed and checked, and
  may not point at anything outside itself.
- A business picks a file as its scene in the Design tab's Motion panel. The scene layer plays it, keeping the stage-1
  fallbacks: reduced motion gets a still, no WebGL gets the template's motion background, and a failed load does too.
- A file used by any published revision cannot be deleted (as `assetUsage` already does for pictures).

## 2. Scope

**[call]** The stages table lists more under stage 2 than the brief asks for. This build covers the library, choosing a
file as the menu's background, and placing a model; the rest waits for its own design.

| In this build | Later |
|---|---|
| Three new library kinds: `MODEL` (GLB), `VIDEO` (MP4), `LOTTIE` (JSON) | Assigning a file to one category or product |
| Checks from the bytes, limits per kind, the shared library | Decorative vs interactive models, a list of tap reactions |
| A scene file per menu, chosen in the Motion panel | Scroll start and end points |
| Model framing: size, horizontal and vertical position, turn | Lighting controls (the stage-1 studio light stays) |
| Saved designs carry their scene file (how platform templates use one) | Background photos (pictures are already in the library; a photo backdrop is a small follow-up) |
| Usage, delete protection, restore, duplicate into another restaurant | WebM, dotLottie (`.lottie`), glTF with separate files |

"Template presets can use them": presets live in code and cannot name a database row. A platform template that uses a
file is a shared saved design (`DesignTemplate` with no restaurant) whose overrides name a shared file. **[call]**

## 3. The files

### 3.1 Kinds and limits **[call]**

| Kind | Accepted | Limit | Other checks |
|---|---|---|---|
| `MODEL` | GLB (binary glTF 2.0) | 10 MB | below, 3.2 |
| `VIDEO` | MP4 with H.264 video (`avc1`/`avc3`) | 20 MB | at most 30 s, at most 1920 px on its longest side, a poster frame |
| `LOTTIE` | Lottie JSON | 2 MB | below, 3.3 |
| `IMAGE`, `SVG`, `ICON` | unchanged | 15 MB | unchanged |

Why these: a background must load on mobile data. H.264 MP4 is the one format every phone plays; WebM and HEVC are not
universal. A 4K phone recording is refused with "export it at 1080p".

The type is sniffed from the first bytes: `glTF` magic for GLB; an `ftyp` box with an MP4 brand (and not an AVIF one)
for video; a JSON object for Lottie. The browser's declared type only picks the upload slot's size limit; the bytes
decide the kind, and the kind's limit is checked again after sniffing.

### 3.2 GLB checks

The file is parsed on the server, never executed:

- Header: magic `glTF`, version 2, length equal to the file; a JSON chunk first, at most one BIN chunk; every chunk
  inside the file.
- No `uri` anywhere in the JSON: buffers and images must live in the file. This refuses external links and `data:` URIs
  alike. **[call]** (stricter than "no external URIs", and simpler to be sure of)
- Buffer 0 is the BIN chunk. Another buffer is allowed only as an `EXT_meshopt_compression` fallback (no data of its
  own). Every buffer view, and every meshopt view, lies inside the BIN chunk.
- `extensionsRequired` only from what the guest loader handles: `KHR_mesh_quantization`, `EXT_meshopt_compression`,
  `KHR_texture_transform`, `EXT_texture_webp`, `KHR_materials_*`. Draco and KTX2 need decoders the menu does not ship,
  so they are refused.
- Embedded images: PNG, JPEG or WebP by their bytes (matching the declared `mimeType`), at most 4096 px a side and 32
  million pixels in all.
- Size of the scene: at most 300,000 triangles (counted per node that draws a mesh), 2,000 nodes, 64 materials,
  32 textures, 32 animations. **[call]** A background must draw on a phone at 60 fps beside the menu.

The GLB is stored exactly as uploaded.

### 3.3 Lottie checks

- Strict UTF-8, `JSON.parse`, an object with `v`, `fr` (1 to 120), `ip`, `op`, `w` and `h` (1 to 4096) and `layers`.
  At most 60 s long. At most 64 levels deep and 2,000 layers.
- Expressions refused: any string under a key `x` (where Lottie keeps expressions) refuses the file.
- Layer types: precomposition, solid, image, null, shape, text. Audio, video and camera layers are refused.
- Image assets must be embedded (`e: 1`, a base64 `data:image/png|jpeg|webp` URI, no base path) and pass the image
  checks. Fonts may not name a file or a web font service (`fPath`, `fOrigin` `p`, `g` or `t`).
- Layer `ln` and `cl` (they become element ids and classes in the page) are removed. **[call]**
- What is stored is the checked JSON, written again without whitespace; the hash for de-duplication is of the upload.

The guest player is lottie-web's light build (`lottie_light`), which has no expression engine at all, so an expression
that got past the check would still not run. **[call]**

### 3.4 Video poster

A video needs a still for reduced motion, data saver and the moment before it plays. The server cannot decode H.264, so
the Studio takes a frame in the browser (10% in, at most 1 s) and uploads it beside the video; the server checks it as
an image and makes its WebP and AVIF widths and its blurred placeholder. A video without a poster is refused. **[call]**

### 3.5 Storage and model

- `MediaKind` gains `MODEL`, `VIDEO`, `LOTTIE`. `MediaAsset` gains `durationMs Int?` and `meta Json @default("{}")`
  (model: triangles, textures, animations; video: codec, audio; Lottie: frame rate, layers).
- Files: `original.glb` (`model/gltf-binary`), `original.mp4` (`video/mp4`), `original.json` (`application/json`), and
  the poster's `poster-webp-{w}` / `poster-avif-{w}`, all under the asset's folder, cached forever as today.
  `AssetVariants` gains `poster`.
- Pickers for pictures (product photos, logos, favicon, SEO image) list and accept only pictures; the scene picker lists
  and accepts only scene kinds. `loadAssets` takes the kinds it may return. **[call]**
- A browser fetches GLB and Lottie files with `fetch`, so the R2 bucket needs a CORS rule allowing `GET` from the menu
  and Studio origins (README). Videos load in a `<video>` without CORS.

## 4. Choosing a scene file

### 4.1 Overrides and the resolved design

- `DesignOverrides.sceneAsset?: { assetId: string; framing?: Partial<ModelFraming> }`
- `ModelFraming`: `scale` 0.5 to 2 (default 1), `x` and `y` -1 to 1 (default 0), `turn` -180 to 180 degrees (default 0).
- `MenuDesign.media?`, frozen at publish like the rest of the design:
  - `{ kind: 'model', assetId, url, framing }`
  - `{ kind: 'video', assetId, url, width, height, poster: { url, srcset, placeholder } }`
  - `{ kind: 'lottie', assetId, url, width, height }`

The scene file is part of the look, like colours and layout: changing template or resetting the look removes it, and
"Save as custom" keeps it. **[call]** The file stays in the library, one click away.

### 4.2 Rules

- Saving a design checks that the file is the restaurant's own or shared, and of a scene kind; anything else is
  `NOT_FOUND`, so another restaurant's id reveals nothing.
- A shared saved design may name only a shared file (a Super Admin saving one from a menu with the restaurant's own
  file is told so). **[call]**
- Publishing resolves the file into `MenuDesign.media` and lists it in `MenuRevision.assetIds`. A file that is somehow
  gone when publishing is left out and the menu shows its template's own scene. **[call]** Deleting a file in use is
  already refused, so this is a corner, not a path.
- Restoring a revision writes the stored overrides back; duplicating a menu into another restaurant copies the file
  like a photo and renames it in the overrides.
- Usage (and delete protection) gains two places: brand kits whose design names the file, and saved designs that name
  it. Revisions are covered by `assetIds` as today.

## 5. Playing it

What a guest sees, by the mode the business chose and the file's kind:

| Mode chosen | Model | Video | Lottie |
|---|---|---|---|
| Static | template poster | the video's poster | template poster |
| Motion | template motion | the video | the animation |
| 3D | the model | the video | the animation |

Then, whatever was chosen:

- Reduced motion: the still (template poster, or the video's poster). No video or Lottie code loads.
- Model without WebGL (the stage-1 device check fails): template motion.
- Video with data saver: its poster. **[call]** (a video is the heaviest thing on the page)
- Any failure (a file that does not load or parse, a video error, a lost WebGL context, a thrown error):
  template motion. `?scene=fail` keeps forcing it.

The template's poster is always painted first; the file is drawn over it once the page is idle, like the 3D scene.

- Model: in the scene's one canvas instead of the template's code scene. Fitted to the view, then framed. Ambient: a
  slow turn and the file's own animations; scroll turns it both ways; a tap gives a small spin at once; a fine pointer
  leans the camera as in stage 1. Speed and intensity scale all of it.
- Video: muted, looped, inline, never with controls. Speed sets the playback rate. Ambient off holds it still.
- Lottie: SVG renderer, covering the screen. Ambient loops it; with ambient off and scroll on, its frame follows scroll
  progress; with both off it holds still. **[call]**
- Everything pauses while the page is hidden or a product sheet covers it. Taps on controls never reach the scene; the
  layer never takes pointer events. Brightness, blur, opacity and the veil apply as in stage 1.

## 6. Studio

- The Media page shows the new kinds: a poster with a duration badge for a video, an icon tile with a kind badge for a
  model or Lottie, and their facts in the details panel (duration, size in pixels, triangles, file size). The drop zone
  takes `.glb`, `.mp4` and `.json`. Usage lists the new places.
- The Design tab's Motion panel gains "Background file": the template's own scene, or the chosen file with Change and
  Use template scene. Change opens a picker of scene files (the restaurant's and the shared ones, filtered by kind) that
  can also upload. Picking a model sets the mode to 3D; picking a video or Lottie sets Motion when the mode was Static.
  **[call]** A model shows four framing sliders. A short hint per kind says when guests see it.
- The live preview gets the chosen file at once (the Design tab sends it with the overrides).

## 7. Testing

- Unit: sniffing; the GLB, MP4 and Lottie checks on files built in the tests (good files and one refusal per rule);
  the scene plan of section 5 as a pure function; overrides parsing and the snapshot schema.
- Database: uploads of each kind; limits per kind; a video without a poster; the shared library only for Super Admins;
  choosing another restaurant's file; usage and delete protection through a draft, a saved design and a revision;
  publish freezing the file; restore; duplicate into another restaurant.
- The cross-tenant sweep gains entries for the scene choice and the scene listing.
- Browser: a demo menu with a model, a video and a Lottie file, each with reduced motion, no WebGL (model) and
  `?scene=fail`.

## 8. Builder's choices

Left to the builder: component and file names, the icon set for tiles, the exact Studio wording in English, Arabic and
Sorani, how the pure checks are split into modules, and the fixture files the tests build.
