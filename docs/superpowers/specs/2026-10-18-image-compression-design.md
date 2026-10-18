# Smart image compression on upload

Status: approved by the user (2026-10-18)
Base: `main` at 6fd2227
Code: `src/server/media/process.ts` and its tests (`tests/media/process.test.ts`)

## 1. Intent

The user's words: "I also want images compressed on upload to the lowest size that does not change the image's
quality." Smaller photos make the menu open faster on guests' phones (often on mobile data) and take less storage.

## 2. What happens today

`prepareRaster` makes, for each uploaded JPEG, PNG, WebP or AVIF:

- the **original**, upright and without metadata, at its full size (up to 10,000 px a side), re-encoded in its own
  format (JPEG quality 90, PNG with default settings, WebP 90, AVIF 70);
- **variants** in AVIF (quality 55, effort 4) and WebP (quality 75) at 320, 640, 1080 and 1600 px wide, never wider
  than the photo.

Guests download only the variants. The original is used for favicons and the Studio's download. Every photo gets the
same fixed quality, whatever it shows.

## 3. What changes

1. **Each file gets its own quality.** For the variants and the original, the encoder's quality is searched per photo:
   the lowest quality whose result a person cannot tell from the source (the upright photo at that size). A plain
   photo ends up much smaller; a detailed one keeps a higher quality. "Cannot tell" is measured with a perceptual
   similarity score (SSIM on luminance at least; the builder may add colour) against a threshold the builder
   calibrates on real menu photos and writes down in the code with the numbers that support it.
2. **The original is kept at most 2560 px on its long side** (never enlarged; the aspect ratio stays exact), which is
   more than any screen shows and enough for an A4 print. It keeps its own format: JPEG through mozjpeg with a searched
   quality; PNG losslessly at the strongest compression (a palette only when it passes the same similarity check);
   WebP and AVIF with a searched quality.
3. **Bounds.** Each format has a quality floor (never below it, whatever the score says) and a ceiling. The search
   tries a handful of qualities per file; it may search once per format at one width and use the result for the
   others when that measures the same. The ceiling may be above today's fixed quality: a very detailed photo may need
   it, and the promise is the quality, not a smaller file in every case.
4. **Time.** Processing runs inside the upload's finish request (`maxDuration` 60 s). The whole of one upload, at the
   largest photo allowed, stays well inside that; the builder measures it on the build machine and sets the search
   size so a typical phone photo takes a few seconds.

## 4. Not changing

- Photos already uploaded stay as they are (no batch re-compression).
- SVGs and icons are processed as today.
- Storage keys, the content hash (of the bytes as uploaded) and deduplication stay as they are.
- What guests are sent (the AVIF and WebP `srcset`) keeps its shape; only the bytes get smaller.

## 5. Tests

- The similarity score: identical images score 1; a visibly damaged image scores below the threshold.
- A photo's variants pass the threshold against their source; the original is at most 2560 px with the same aspect
  ratio; a PNG with transparency keeps it; a photo below 2560 px is not enlarged.
- On a synthetic photo-like image made in the test, the stored bytes in total are smaller than today's settings
  produce; the test prints both. Real photos (from the user) are used only to calibrate the threshold, outside the
  repository.
- The full suite stays green.
