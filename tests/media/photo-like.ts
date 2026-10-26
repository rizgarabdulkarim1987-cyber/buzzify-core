import sharp from 'sharp';

/** A small deterministic generator, so a test's image is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

/**
 * A PNG that encoders treat like a photo: a smooth two-colour gradient, a few large shaded shapes, many small ones for
 * the texture food has (crumbs, grains, sauce), fine grain, and a little softness. Real photos are never committed; this
 * stands in for them in tests.
 */
export async function photoLike(width: number, height: number, seed = 7): Promise<Buffer> {
  const next = random(seed);
  const raw = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const i = (y * width + x) * 3;
      raw[i] = 30 + 180 * t;
      raw[i + 1] = 40 + 90 * (1 - t);
      raw[i + 2] = 120 - 80 * t;
    }
  }
  const side = Math.min(width, height);
  const shape = (scale: number) => {
    const cx = next() * width;
    const cy = next() * height;
    const r = Math.max(1.5, scale * side);
    const color = [next() * 255, next() * 255, next() * 255];
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(height, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(width, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= r) continue;
        const shade = 0.6 + 0.4 * (1 - d / r);
        const i = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) raw[i + c] = color[c]! * shade;
      }
    }
  };
  for (let n = 0; n < 14; n++) shape(0.05 + next() * 0.2);
  for (let n = Math.round((width * height) / 900); n > 0; n--) shape(0.002 + next() * 0.01);

  const bytes = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(raw[i]! + (next() - 0.5) * 6)));
  // A camera's lens and demosaicing soften what reaches the file a little.
  return sharp(bytes, { raw: { width, height, channels: 3 } }).blur(0.6).png().toBuffer();
}
