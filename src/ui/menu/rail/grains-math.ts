import type { RailDish } from '@/lib/rail';

/**
 * The grain dishes rail, as numbers: each category's dish as a small cloud of coloured grains, and the path a
 * grain takes when one dish melts into the next. Kept free of the DOM so it can be tested and so the menu only
 * downloads it once the page is idle.
 *
 * Dishes stand on y = 0 with a footprint of about one unit; the rail scales them to a few dozen pixels.
 */

export const RAIL_DISHES = ['burger', 'cup', 'glass', 'croissant', 'millefeuille', 'plate'] as const satisfies readonly RailDish[];

export interface DishCloud {
  count: number;
  /** x, y, z per grain. */
  positions: Float32Array;
  /** r, g, b per grain, 0 to 1. */
  colors: Float32Array;
}

type Rgb = readonly [number, number, number];
type Grain = readonly [number, number, number, Rgb];
type Part = readonly [weight: number, sample: (random: () => number) => Grain];

const TAU = Math.PI * 2;

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point on a flat disc of radius r at height y. */
const disc = (random: () => number, r: number, y: number, color: Rgb): Grain => {
  const a = random() * TAU;
  const q = Math.sqrt(random()) * r;
  return [Math.cos(a) * q, y, Math.sin(a) * q, color];
};

const CREAM = rgb('#efe7da');
const CUP: Part[] = [
  [3, (random) => disc(random, 1, 0, rgb('#e6dccb'))],
  [
    4,
    (random) => {
      const h = random();
      const a = random() * TAU;
      const r = 0.4 + 0.3 * Math.sqrt(h);
      return [Math.cos(a) * r, 0.06 + h * 0.62, Math.sin(a) * r, CREAM];
    },
  ],
  [
    2,
    (random) => {
      const a = random() * TAU;
      const q = Math.sqrt(random()) * 0.68;
      return [Math.cos(a) * q, 0.68, Math.sin(a) * q, q > 0.5 ? rgb('#d8b07a') : rgb('#7a4a2a')];
    },
  ],
  [
    1,
    (random) => {
      const a = random() * TAU;
      const b = random() * TAU;
      const rr = 0.16 + 0.04 * Math.cos(b);
      return [0.78 + Math.cos(a) * rr, 0.42 + Math.sin(a) * rr, 0.04 * Math.sin(b), CREAM];
    },
  ],
];

const CROISSANT: Part[] = [
  [
    1,
    (random) => {
      const s = random() * 2 - 1;
      const bend = s * 1.15;
      const a = random() * TAU;
      const rr = 0.36 * (1 - 0.72 * s * s) * (1 + 0.1 * Math.cos(s * 16));
      const nx = Math.sin(bend);
      const nz = Math.cos(bend);
      const light = Math.sin(a) * 0.5 + 0.5;
      return [
        nx * 0.8 + nx * Math.cos(a) * rr,
        Math.max(0.02, 0.32 + Math.sin(a) * rr),
        nz * 0.8 - 0.5 + nz * Math.cos(a) * rr,
        [(190 + 50 * light) / 255, (118 + 48 * light) / 255, (48 + 36 * light) / 255],
      ];
    },
  ],
];

const BURGER: Part[] = [
  [
    3,
    (random) => {
      if (random() < 0.5) return disc(random, 0.86, 0, rgb('#c88a45'));
      const a = random() * TAU;
      return [Math.cos(a) * 0.86, random() * 0.2, Math.sin(a) * 0.86, rgb('#d39a52')];
    },
  ],
  [
    2.5,
    (random) => {
      const a = random() * TAU;
      return [Math.cos(a) * 0.9, 0.22 + random() * 0.16, Math.sin(a) * 0.9, rgb('#5b3522')];
    },
  ],
  [
    1,
    (random) => {
      const a = random() * TAU;
      const w = 0.96 + 0.05 * Math.sin(a * 9);
      return [Math.cos(a) * w, 0.4 + random() * 0.03, Math.sin(a) * w, rgb('#e7b43c')];
    },
  ],
  [
    1.2,
    (random) => {
      const a = random() * TAU;
      const w = 1 + 0.07 * Math.sin(a * 11);
      return [Math.cos(a) * w, 0.44 + 0.03 * Math.sin(a * 7), Math.sin(a) * w, rgb('#7da846')];
    },
  ],
  [
    5,
    (random) => {
      const a = random() * TAU;
      const q = Math.sqrt(random()) * 0.88;
      const y = 0.47 + 0.55 * Math.sqrt(Math.max(0, 1 - (q / 0.9) ** 2));
      return [Math.cos(a) * q, y, Math.sin(a) * q, random() < 0.05 ? rgb('#f6ecd4') : rgb('#d8963f')];
    },
  ],
];

const LAYERS: ReadonlyArray<readonly [number, number, Rgb]> = [
  [0, 0.14, rgb('#d6a257')],
  [0.14, 0.3, rgb('#f1e7d3')],
  [0.3, 0.44, rgb('#d6a257')],
  [0.44, 0.6, rgb('#b7c886')],
  [0.6, 0.72, rgb('#d6a257')],
];
const MILLEFEUILLE: Part[] = [
  [
    3,
    (random) => {
      const [bottom, top, color] = LAYERS[Math.floor(random() * LAYERS.length)]!;
      const y = bottom + random() * (top - bottom);
      const side = Math.floor(random() * 4);
      const u = random() * 2 - 1;
      if (side === 0) return [u * 0.95, y, 0.48, color];
      if (side === 1) return [u * 0.95, y, -0.48, color];
      if (side === 2) return [0.95, y, u * 0.48, color];
      return [-0.95, y, u * 0.48, color];
    },
  ],
  [
    2,
    (random) => [
      (random() * 2 - 1) * 0.95,
      0.74,
      (random() * 2 - 1) * 0.48,
      random() < 0.12 ? rgb('#8fae4f') : rgb('#f7f1e4'),
    ],
  ],
];

const ICE: ReadonlyArray<readonly [number, number, number]> = [
  [0.12, 0.8, 0.1],
  [-0.15, 0.6, -0.1],
  [0.05, 0.35, -0.15],
];
const GLASS: Part[] = [
  [
    3,
    (random) => {
      const a = random() * TAU;
      return [Math.cos(a) * 0.52, random() * 1.3, Math.sin(a) * 0.52, rgb('#9fbcc6')];
    },
  ],
  [
    4,
    (random) => {
      if (random() < 0.35) return disc(random, 0.48, 1, rgb('#efcf5a'));
      const a = random() * TAU;
      return [Math.cos(a) * 0.48, random(), Math.sin(a) * 0.48, rgb('#efcf5a')];
    },
  ],
  [
    1,
    (random) => {
      const a = random() * TAU;
      const q = Math.sqrt(random()) * 0.28;
      return [0.42 + Math.cos(a) * q, 1.12 + Math.sin(a) * q, 0, rgb('#f4dc52')];
    },
  ],
  [
    0.8,
    (random) => {
      const [x, y, z] = ICE[Math.floor(random() * ICE.length)]!;
      return [x + (random() - 0.5) * 0.22, y + (random() - 0.5) * 0.22, z + (random() - 0.5) * 0.22, rgb('#f2f8fa')];
    },
  ],
];

const PLATE: Part[] = [
  [3, (random) => disc(random, 1, 0, rgb('#e8e1d4'))],
  [
    5,
    (random) => {
      const a = random() * TAU;
      const up = random() * (Math.PI / 2);
      return [Math.cos(a) * Math.cos(up) * 0.78, 0.04 + Math.sin(up) * 0.66, Math.sin(a) * Math.cos(up) * 0.78, rgb('#d6bc8a')];
    },
  ],
  [0.4, (random) => disc(random, 0.1, 0.78, rgb('#efe0bd'))],
];

const SHAPES: Record<RailDish, Part[]> = {
  cup: CUP,
  croissant: CROISSANT,
  burger: BURGER,
  millefeuille: MILLEFEUILLE,
  glass: GLASS,
  plate: PLATE,
};

/** A dish as a cloud of grains. Deterministic: the same dish and count always give the same grains. */
export function dishCloud(dish: RailDish, count: number, seed = 11): DishCloud {
  const parts = SHAPES[dish];
  const total = parts.reduce((sum, [weight]) => sum + weight, 0);
  const random = mulberry32(seed + dish.length * 977);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    let pick = random() * total;
    let sample = parts[parts.length - 1]![1];
    for (const [weight, part] of parts) {
      pick -= weight;
      if (pick <= 0) {
        sample = part;
        break;
      }
    }
    const [x, y, z, color] = sample(random);
    positions.set([x, y, z], k * 3);
    colors.set(color, k * 3);
  }
  return { count, positions, colors };
}

/** Four repeatable values in [0, 1) per grain: its delay, lift, spread and which arm of the vortex it joins. */
export function grainSeeds(count: number): Float32Array {
  const random = mulberry32(4242);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) out[i] = random();
  return out;
}

export interface Flight {
  x: number;
  y: number;
  z: number;
  /** How far along its way the grain is, 0 to 1; the rail also uses it to carry the grain sideways. */
  e: number;
  /** How airborne the grain is: 0 on a dish, 1 at the top of its flight. */
  s: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * Where grain `k` is, `progress` of the way from its place on the old dish (fx, fy, fz) to its place on the new
 * one (tx, ty, tz). The top of the old dish lets go first and the base of the new one lands first; in between,
 * grains rise into a turning three-armed vortex. Writes into and returns `out`, so a frame allocates nothing.
 */
export function flightPoint(
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
  seeds: Float32Array,
  k: number,
  progress: number,
  out: Flight,
): Flight {
  const delayed = seeds[k * 4]!;
  const lift = seeds[k * 4 + 1]!;
  const spread = seeds[k * 4 + 2]!;
  const arm = seeds[k * 4 + 3]!;
  const delay = 0.34 * (1 - clamp01(fy / 1.3)) + 0.34 * clamp01(ty / 1.3) + 0.1 * delayed;
  const m = clamp01((progress * 1.16 - delay) / 0.38);
  if (m <= 0 || m >= 1) {
    const done = m >= 1;
    out.x = done ? tx : fx;
    out.y = done ? ty : fy;
    out.z = done ? tz : fz;
    out.e = done ? 1 : 0;
    out.s = 0;
    return out;
  }
  const e = ease(m);
  const s = Math.sin(Math.PI * m);
  const rFrom = Math.hypot(fx, fz);
  const rTo = Math.hypot(tx, tz);
  const thFrom = Math.atan2(fz, fx);
  const thTo = Math.atan2(tz, tx);
  // Always turn the same way, and at least one full turn, so the flight reads as a vortex.
  const turn = ((((thTo - thFrom) % TAU) + TAU) % TAU) + TAU;
  const y = fy + (ty - fy) * e + s * (0.25 + 0.6 * lift);
  const pull = s * s * (3 - 2 * s);
  const helix = Math.floor(arm * 3) * (TAU / 3) + y * 2.4 + progress * 5;
  const theta = thFrom + turn * e + (helix + (spread - 0.5) * 0.5 - (thFrom + turn * e)) * pull;
  const r = (rFrom + (rTo - rFrom) * e) * (1 - pull) + (0.12 + 0.25 * delayed) * pull;
  out.x = Math.cos(theta) * r;
  out.y = y;
  out.z = Math.sin(theta) * r;
  out.e = e;
  out.s = s;
  return out;
}
