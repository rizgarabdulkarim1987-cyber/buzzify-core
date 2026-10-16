# Bundled fonts

`bodoni-moda-latin-opsz-400.woff2` is **Bodoni Moda**, the display face.

- Source: Google Fonts, the `latin` subset of
  `https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,400`
- What differs from the stock file: the weight is pinned to 400 (the interface sets everything in the regular
  weight) and the optical-size axis (`opsz`, 6-96) is kept, which the large display type depends on. The
  full-range file that `next/font/google` requests is 46 KB; this one is 27 KB.
- License: SIL Open Font License 1.1, Copyright 2020 The Bodoni Moda Project Authors
  (https://github.com/indestructible-type/Bodoni). The license permits bundling and redistribution.

The text faces (Hanken Grotesk, Noto Naskh Arabic) still come from `next/font/google` in `../fonts.ts`.
