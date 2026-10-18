# Smart Image Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every uploaded photo is stored and served at the smallest size a person cannot tell from the source, and its original is kept at most 2560 px on its long side.

**Architecture:** A pure similarity score (SSIM on luminance, plus alpha when there is one) and a quality search sit beside the existing pipeline in `src/server/media/`. `prepareRaster` asks the search for each format's quality instead of using fixed numbers. Nothing outside `src/server/media/` changes: keys, hashes, `AssetVariants` and what guests are sent keep their shape.

**Tech Stack:** sharp 0.35.5 (mozjpeg, AVIF, WebP, PNG palette), TypeScript 5.9, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-18-image-compression-design.md`

**Base:** `main` at 6fd2227, on its own branch and pull request (`image-compression`), separate from the plans work.

## Global Constraints

- No new dependencies: sharp already ships mozjpeg, AVIF, WebP and PNG quantization.
- The original: long side at most **2560 px**, never enlarged, aspect ratio exact; JPEG through `mozjpeg: true`; PNG lossless at `compressionLevel: 9, adaptiveFiltering: true, effort: 10`, or a palette only when it passes the threshold.
- Variants stay AVIF and WebP at 320, 640, 1080 and 1600 px, never wider than the photo (unchanged).
- Quality bounds per format (floor, ceiling): JPEG 60–92, WebP 55–92, AVIF 35–75. The ceilings may be above today's fixed values (JPEG 90, WebP 75, AVIF 55): the promise is the quality, not a smaller file every time.
- Starting threshold `VISUALLY_LOSSLESS = 0.99` (mean SSIM on luminance, and on alpha when present). Task 1 calibrates it on real photos and may move it; the value and the evidence are written in a comment above the constant.
- Processing time: one upload of the largest photo allowed stays well inside the finish route's `maxDuration` of 60 s. Target: a 12 MP phone photo in under 10 s on the build machine.
- SVG and ICO processing, the placeholder, the content hash (of the bytes as uploaded) and storage keys do not change. Photos already stored are not touched.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed to `main`.

## Review Focus

1. **A PNG logo with transparency:** stays transparent (alpha kept), and a palette never shows banding at the edges. (Task 3)
2. **A photo smaller than 320 px or smaller than 2560 px:** never enlarged; one variant pair at its own width, as today. (Task 3)
3. **A very detailed photo (noise, text on a menu board):** the search ends at the ceiling rather than going below the threshold. (Task 2)
4. **A tall photo (portrait, 3024 × 4032):** the 2560 cap applies to the long side, so it becomes 1920 × 2560, not 2560 wide. (Task 3)
5. **Time on the host:** a 50 MP photo (the input limit) still finishes inside 60 s; the search size is bounded, not proportional to the photo. (Task 3)

## Spec refinements

1. **`width` and `height` of an asset become the stored original's size** (after the 2560 cap), so the Studio's download and the numbers agree. The aspect ratio is unchanged, so layouts are unaffected.
2. **The search runs once per format** on the 1080 px rendition (or the photo's own width when smaller) and its quality is used for every width of that format; Task 1's calibration checks that each width still passes.
3. **Tests use synthetic photo-like images** made in the test (gradients, shapes, fine noise). Real photos are used only to calibrate, from a folder outside the repository, through `npm run media:calibrate`; none is committed.

## File structure

```
src/server/media/similarity.ts   luma/alpha planes of an image and their mean SSIM
src/server/media/compress.ts     quality bounds, the threshold and the quality search
src/server/media/process.ts      prepareRaster uses them; the original is capped at 2560 px
scripts/media-calibrate.ts       prints old and new sizes and scores for a folder of photos
tests/media/similarity.test.ts, tests/media/compress.test.ts, tests/media/process.test.ts, tests/media/photo-like.ts
```

---

### Task 1: The similarity score and the calibration script

**Files:**
- Create: `src/server/media/similarity.ts`, `scripts/media-calibrate.ts`, `tests/media/similarity.test.ts`, `tests/media/photo-like.ts`
- Modify: `package.json` (script `"media:calibrate": "tsx scripts/media-calibrate.ts"`, the runner the other scripts use)

**Interfaces:**
- Produces:
  - `interface Plane { data: Uint8Array; width: number; height: number }`
  - `planesOf(image: Uint8Array | Buffer, width: number): Promise<{ luma: Plane; alpha: Plane | null }>`: the image decoded, upright, resized to `width` (kept aspect), as a greyscale plane and, when the image has alpha, its alpha plane.
  - `ssim(a: Plane, b: Plane): number`: mean SSIM over 8 × 8 windows with a stride of 4, constants `C1 = (0.01 * 255)^2`, `C2 = (0.03 * 255)^2`; throws when the sizes differ.
  - `similarity(source: Uint8Array | Buffer, candidate: Uint8Array | Buffer, width: number): Promise<number>`: the lower of the luma score and the alpha score (alpha only when the source has it).
  - Test helper `photoLike(width: number, height: number, seed?: number): Promise<Buffer>` (PNG): a deterministic gradient with coloured shapes and fine noise, so encoders behave as on a photo.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/media/similarity.test.ts
it('scores an image against itself as 1', async () => {
  const photo = await photoLike(640, 480);
  expect(await similarity(photo, photo, 640)).toBeCloseTo(1, 6);
});
it('scores a heavily blurred copy below 0.9', async () => {
  const photo = await photoLike(640, 480);
  const blurred = await sharp(photo).blur(6).png().toBuffer();
  expect(await similarity(photo, blurred, 640)).toBeLessThan(0.9);
});
it('scores a JPEG at quality 95 above 0.98', async () => {
  const photo = await photoLike(640, 480);
  expect(await similarity(photo, await sharp(photo).jpeg({ quality: 95 }).toBuffer(), 640)).toBeGreaterThan(0.98);
});
it('counts the alpha channel: a logo whose transparency is lost scores low', async () => {
  const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 200, height: 100, channels: 4, background: '#c8261c' } }).png().toBuffer(), left: 100, top: 50 }])
    .png().toBuffer();
  const flattened = await sharp(logo).flatten({ background: '#ffffff' }).ensureAlpha(1).png().toBuffer();
  expect(await similarity(logo, flattened, 400)).toBeLessThan(0.9);
});
it('refuses planes of different sizes', () => {
  expect(() => ssim({ data: new Uint8Array(4), width: 2, height: 2 }, { data: new Uint8Array(9), width: 3, height: 3 })).toThrow();
});
```

- [ ] **Step 2: Run `npx vitest run tests/media/similarity.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement `similarity.ts` and `photo-like.ts`.** Decode with `sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate().resize({ width })`, then `.extractChannel` / `.greyscale().raw()` for the planes.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Write `scripts/media-calibrate.ts`.** Usage `npm run media:calibrate -- <folder>`: for each JPEG, PNG, WebP or AVIF in the folder, print the file, its size, today's settings' output size (original at full size and quality 90/90/70 by format, AVIF 55 and WebP 75 at each width), and, once Task 3 exists, the new output size and each file's score. It reads files only from the folder given and writes nothing.
- [ ] **Step 6: Calibrate.** Ask the user for three to five real dish photos as they would upload them (taken on a phone), put them in the scratchpad directory, never in the repository, and run the script on them. Compare each format at the candidate threshold by eye at 100 % against the source; lower or raise `VISUALLY_LOSSLESS` to the lowest value where no difference is visible, and write the photos' description (not the photos), the threshold and the sizes in the comment above the constant in Task 2.
- [ ] **Step 7: Commit** (`feat(media): an image similarity score and a calibration script`).

---

### Task 2: The quality search

**Files:**
- Create: `src/server/media/compress.ts`, `tests/media/compress.test.ts`

**Interfaces:**
- Consumes: `similarity` (Task 1).
- Produces:
  - `const VISUALLY_LOSSLESS: number` (0.99 until calibrated; the comment holds the evidence).
  - `const QUALITY: Record<'jpeg' | 'webp' | 'avif', { floor: number; ceiling: number }>` with the Global Constraints' values.
  - `searchQuality(args: { source: Buffer; width: number; bounds: { floor: number; ceiling: number }; encode: (quality: number) => Promise<Buffer>; threshold?: number; maxTries?: number }): Promise<{ quality: number; body: Buffer; score: number }>`: binary search over whole qualities between `floor` and `ceiling` for the lowest whose output scores at least `threshold` (default `VISUALLY_LOSSLESS`) against `source` at `width`; at most `maxTries` encodes (default 5); when even the ceiling scores below, the ceiling's output is returned.

- [ ] **Step 1: Write the failing tests**

```ts
it('finds the lowest passing WebP quality on a photo-like image', async () => {
  const source = await photoLike(1080, 720);
  const encode = (q: number) => sharp(source).webp({ quality: q }).toBuffer();
  const found = await searchQuality({ source, width: 1080, bounds: QUALITY.webp, encode });
  expect(found.score).toBeGreaterThanOrEqual(VISUALLY_LOSSLESS);
  if (found.quality > QUALITY.webp.floor) {
    expect(await similarity(source, await encode(found.quality - 3), 1080)).toBeLessThan(VISUALLY_LOSSLESS);
  }
});
it('stops at the ceiling for noise it can never pass', async () => { /* random pixels, threshold 0.9999 → quality === ceiling */ });
it('never encodes more than maxTries times', async () => { /* count calls to encode, maxTries 4 → ≤ 4 */ });
it('returns the floor when even the floor passes', async () => { /* a flat colour image → quality === floor */ });
```

- [ ] **Step 2: Run `npx vitest run tests/media/compress.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `compress.ts`.**
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(media): search each image's lowest quality that still looks the same`).

---

### Task 3: Upload processing uses the search; the original is capped at 2560 px

**Files:**
- Modify: `src/server/media/process.ts` (`prepareRaster`, `reencode`; new `const ORIGINAL_MAX_SIDE = 2560`)
- Test: `tests/media/process.test.ts`

**Interfaces:**
- Consumes: `searchQuality`, `QUALITY`, `VISUALLY_LOSSLESS` (Task 2), `similarity` (Task 1).
- Produces: `prepareAsset` with the same signature and result shape; `asset.width`/`asset.height` are the stored original's size (Spec refinement 1).

- [ ] **Step 1: Write the failing tests** (added to `tests/media/process.test.ts`; existing cases stay)

```ts
it('caps the original at 2560 px on its long side, keeping the aspect ratio', async () => {
  const asset = prepared(await prepareAsset(await photoLike(4000, 3000)));
  const meta = await sharp(fileOf(asset, 'original').body).metadata();
  expect([meta.width, meta.height]).toEqual([2560, 1920]);
  expect([asset.width, asset.height]).toEqual([2560, 1920]);
});
it('caps a portrait photo by its height', async () => { /* 3024 × 4032 → 1920 × 2560 */ });
it('never enlarges a photo under 2560 px', async () => { /* 1200 × 800 original stays 1200 × 800 */ });
it('keeps every variant visually the same as its source', async () => {
  const source = await photoLike(2400, 1600);
  const asset = prepared(await prepareAsset(source));
  for (const file of asset.files.filter((f) => f.variant !== 'original')) {
    const width = Number(file.variant.split('-')[1]);
    expect(await similarity(source, file.body, width)).toBeGreaterThanOrEqual(VISUALLY_LOSSLESS - 0.005);
  }
});
it('keeps a PNG logo transparent', async () => { /* original's corner pixel alpha is 0 and hasAlpha */ });
it('stores fewer bytes than the fixed settings did for a photo-like image', async () => {
  const source = await photoLike(2400, 1600);
  const now = prepared(await prepareAsset(source)).files.reduce((sum, f) => sum + f.body.length, 0);
  const before = await legacyBytes(source); // the old settings, written out in the test: full-size JPEG 90, AVIF 55 effort 4, WebP 75 at each width
  console.info(`stored bytes: ${before} before, ${now} now`);
  expect(now).toBeLessThan(before);
});
it('processes a 12 MP photo in under 10 s', async () => { /* time prepareAsset(photoLike(4000, 3000)) */ }, 30_000);
```

- [ ] **Step 2: Run `npx vitest run tests/media/process.test.ts`.** Expected: the new cases FAIL.
- [ ] **Step 3: Change `prepareRaster`.** The upright source is resized with `fit: 'inside', withoutEnlargement: true` to 2560 × 2560 for the original; the original's format keeps its encoder (JPEG `mozjpeg: true` with a searched quality; WebP and AVIF searched; PNG lossless at the strongest settings, then a `palette: true` candidate kept only when it is smaller and scores at least `VISUALLY_LOSSLESS`). For the variants, search AVIF (`effort: 4`) and WebP once each on the 1080 px rendition (or the photo's width when smaller) and encode every width with the found quality. Width and height are taken from the stored original.
- [ ] **Step 4: Run `npx vitest run tests/media` and then `npm test`.** Expected: PASS, the size line printed, the time case under its limit.
- [ ] **Step 5: Run `npm run media:calibrate -- <the scratchpad photos>`.** Expected: every new file scores at least the threshold and the totals are lower than today's for typical photos; note the numbers in the PR description.
- [ ] **Step 6: Commit** (`feat(media): store each photo at its lowest quality that looks the same, and the original at most 2560 px`).

---

### Task 4: Verify and hand over

- [ ] **Step 1: Run `npm run lint && npm run typecheck && npm test`, then the Hostinger build without its database steps: `BUILD_TARGET=standalone npx next build --webpack`.** Expected: all pass.
- [ ] **Step 2: Upload a real photo through the Studio on the dev server** (Media tab of a demo restaurant) and check that it appears, that the guest menu shows it, and how long the upload took.
- [ ] **Step 3: Whole-branch review** with a fresh reviewer, fix what it finds, then open the pull request to `main` and tell the user, in Arabic, what changed and how to merge.
