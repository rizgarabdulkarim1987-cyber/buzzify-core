/** Small numeric helpers shared by the motions. Nothing here allocates per call. */

export const TAU = Math.PI * 2;
export const clamp = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
/** `x` mapped from [a, b] to [c, d], clamped. */
export const remap = (x: number, a: number, b: number, c: number, d: number) => lerp(c, d, invLerp(a, b, x));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
};
export const fract = (x: number) => x - Math.floor(x);

export const easeOutCubic = (x: number) => 1 - (1 - clamp(x)) ** 3;
export const easeInCubic = (x: number) => clamp(x) ** 3;
export const easeInOutCubic = (x: number) => {
  const t = clamp(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
export const easeOutBack = (x: number, overshoot = 1.70158) => {
  const t = clamp(x) - 1;
  return 1 + (overshoot + 1) * t * t * t + overshoot * t * t;
};
export const easeOutElastic = (x: number) => {
  const t = clamp(x);
  if (t === 0 || t === 1) return t;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
/** A smooth step from 0 to 1 and back over one cycle, for loops that breathe. */
export const breathe = (t: number) => 0.5 - 0.5 * Math.cos(t * TAU);

/** Frame-rate independent smoothing toward `target`. */
export const damp = (current: number, target: number, rate: number, dt: number) => lerp(current, target, 1 - Math.exp(-rate * dt));

/** A seeded random generator (mulberry32): the same seed always draws the same scene. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable random number in [0, 1) for item `i` and channel `k`. */
export function hash(i: number, k = 0): number {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(k + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function lattice(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const at = (dx: number, dy: number, dz: number) => lattice(ix + dx, iy + dy, iz + dz);
  const x00 = lerp(at(0, 0, 0), at(1, 0, 0), fx);
  const x10 = lerp(at(0, 1, 0), at(1, 1, 0), fx);
  const x01 = lerp(at(0, 0, 1), at(1, 0, 1), fx);
  const x11 = lerp(at(0, 1, 1), at(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

export const noise2 = (x: number, y: number) => noise3(x, y, 0.5);

/** Fractal noise in [0, 1]: a few octaves of `noise3`. */
export function fbm(x: number, y: number, z = 0, octaves = 3): number {
  let sum = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * frequency, y * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}
