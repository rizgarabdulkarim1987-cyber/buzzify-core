import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  MathUtils,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SplineCurve,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LayerKind } from '@/lib/stage';

/**
 * Procedural dish parts. The burger's outer radius is 1 and every geometry is centred on its own
 * origin, so the scene places a layer by `layer.y` alone. Nothing here is random: the same call
 * always returns the same shape and colours, which keeps renders and tests stable.
 *
 * Every part carries a `color` attribute. Colour is painted per vertex from value noise, so crumb,
 * crust, char and veins come from the shape rather than from textures that need UVs.
 */

// ---------------------------------------------------------------------------------------------
// Deterministic value noise
// ---------------------------------------------------------------------------------------------

function lattice(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const at = (dx: number, dy: number, dz: number) => lattice(ix + dx, iy + dy, iz + dz);
  const x00 = mix(at(0, 0, 0), at(1, 0, 0), fx);
  const x10 = mix(at(0, 1, 0), at(1, 1, 0), fx);
  const x01 = mix(at(0, 0, 1), at(1, 0, 1), fx);
  const x11 = mix(at(0, 1, 1), at(1, 1, 1), fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}

/** Fractal noise in [0, 1]. */
export function fbm(x: number, y: number, z: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * frequency, y * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------------------------

const SEGMENTS = 96;
type Profile = ReadonlyArray<readonly [number, number]>;

/**
 * Turns a profile (radius, height) into a solid of revolution. Profiles run from the axis out along
 * the bottom, up the side and back to the axis, which gives outward-facing normals.
 */
function lathe(profile: Profile, height: number, segments = SEGMENTS): BufferGeometry {
  const raw = new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), segments);
  raw.translate(0, -height / 2, 0);
  // The seam of a lathe duplicates its vertices, which leaves a visible crease in the lighting.
  // Dropping the (unused) UVs lets the seam vertices merge before the normals are computed.
  raw.deleteAttribute('uv');
  const geometry = mergeVertices(raw, 1e-4);
  raw.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

/** Samples a smooth curve through control points. */
function smooth(points: Profile, samples: number): Array<readonly [number, number]> {
  const curve = new SplineCurve(points.map(([x, y]) => new Vector2(x, y)));
  return curve.getPoints(samples).map((p) => [p.x, p.y] as const);
}

/** Pushes every vertex along its normal by `amplitude` times centred noise. */
function organic(geometry: BufferGeometry, amplitude: number, frequency: number, octaves = 3, seed = 0): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const d = (fbm(x * frequency + seed, y * frequency + seed * 0.7, z * frequency - seed, octaves) - 0.5) * 2 * amplitude;
    position.setXYZ(i, x + normal.getX(i) * d, y + normal.getY(i) * d, z + normal.getZ(i) * d);
  }
  geometry.computeVertexNormals();
}

type Painter = (out: Color, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;

/** Writes a per-vertex `color` attribute (linear, clamped to a sane range). */
function paint(geometry: BufferGeometry, painter: Painter): BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const out = new Color();
  for (let i = 0; i < position.count; i++) {
    out.setRGB(1, 1, 1);
    painter(
      out,
      position.getX(i),
      position.getY(i),
      position.getZ(i),
      normal.getX(i),
      normal.getY(i),
      normal.getZ(i),
    );
    colors[i * 3] = MathUtils.clamp(out.r, 0, 1.4);
    colors[i * 3 + 1] = MathUtils.clamp(out.g, 0, 1.4);
    colors[i * 3 + 2] = MathUtils.clamp(out.b, 0, 1.4);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Keeps only position, normal and colour so differently built parts can be merged. */
function plain(geometry: BufferGeometry): BufferGeometry {
  geometry.deleteAttribute('uv');
  return geometry;
}

function join(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return merged;
}

/** A box with rounded edges, smooth-shaded. */
function slab(width: number, height: number, depth: number, radius: number, sx = 24, sy = 2, sz = 8): BufferGeometry {
  const box = new BoxGeometry(width, height, depth, sx, sy, sz);
  box.deleteAttribute('uv');
  const position = box.getAttribute('position');
  const hx = width / 2 - radius;
  const hy = height / 2 - radius;
  const hz = depth / 2 - radius;
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const cx = MathUtils.clamp(px, -hx, hx);
    const cy = MathUtils.clamp(py, -hy, hy);
    const cz = MathUtils.clamp(pz, -hz, hz);
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const length = Math.hypot(dx, dy, dz);
    if (length > 1e-9) {
      const scale = radius / length;
      position.setXYZ(i, cx + dx * scale, cy + dy * scale, cz + dz * scale);
    }
  }
  const geometry = mergeVertices(box, 1e-4);
  box.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------------------------

const DEFAULT_TONE = '#a5662f';
const CRUMB = new Color('#efd9a2');
const TOAST = new Color('#c79148');
const PATTY_BASE = new Color('#5a3320');
const PATTY_FAT = new Color('#9a6446');
const PATTY_CHAR = new Color('#1b100a');
const CHEESE = new Color('#f5b82c');
const CHEESE_EDGE = new Color('#e4961a');
const LETTUCE_DARK = new Color('#3f6a24');
const LETTUCE_LIGHT = new Color('#7aa83a');
const LETTUCE_VEIN = new Color('#bdd98a');
const TOMATO_SKIN = new Color('#a3180f');
const TOMATO_FLESH = new Color('#d2321f');
const TOMATO_GEL = new Color('#ea6a4d');
const TOMATO_CORE = new Color('#f3bba3');
const PICKLE_EDGE = new Color('#3f5c18');
const PICKLE_FACE = new Color('#a1bf50');
const PICKLE_RING = new Color('#7aa037');
const BACON_LEAN = new Color('#8d3024');
const BACON_FAT = new Color('#ecd0a8');
const PUFF_DARK = new Color('#a4702d');
const PUFF_LIGHT = new Color('#e1b565');
const CREAM = new Color('#f7e9c6');
const CREAM_SPECK = new Color('#b88f50');
const CHOCOLATE = new Color('#3a2217');
const CROISSANT_DARK = new Color('#7a4216');
const CROISSANT_LIGHT = new Color('#cf8a38');
const ICE = new Color('#e6f2fb');
const RIND = new Color('#f1c837');
const PITH = new Color('#fff4cf');
const FLESH = new Color('#f6dc6a');

function crustOf(tone?: string): Color {
  return new Color(tone && /^#[0-9a-f]{6}$/i.test(tone) ? tone : DEFAULT_TONE);
}

// ---------------------------------------------------------------------------------------------
// Burger
// ---------------------------------------------------------------------------------------------

/** The crown of the top bun as (radius, height) from the centre outward. */
const DOME: Profile = [
  [0, 0.52],
  [0.3, 0.51],
  [0.6, 0.47],
  [0.82, 0.39],
  [0.95, 0.27],
  [1.0, 0.12],
];

/** Height of the top bun's dome at a distance from its centre; used to seat sesame seeds. */
export function domeHeight(r: number): number {
  const clamped = MathUtils.clamp(r, 0, 1);
  for (let i = 1; i < DOME.length; i++) {
    const [r1, h1] = DOME[i]!;
    const [r0, h0] = DOME[i - 1]!;
    if (clamped <= r1) return h0 + ((h1 - h0) * (clamped - r0)) / (r1 - r0);
  }
  return DOME[DOME.length - 1]![1];
}

export function makeBun(kind: 'bottom' | 'top', tone?: string): BufferGeometry {
  const crust = crustOf(tone);
  if (kind === 'bottom') {
    const profile: Profile = [
      [0, 0],
      [0.5, 0],
      [0.86, 0.012],
      [0.975, 0.06],
      [1.0, 0.16],
      [0.985, 0.27],
      [0.94, 0.325],
      [0.86, 0.34],
      [0.75, 0.34],
      [0.6, 0.34],
      [0.45, 0.34],
      [0.3, 0.34],
      [0.15, 0.34],
      [0, 0.34],
    ];
    const geometry = lathe(profile, 0.34);
    organic(geometry, 0.011, 3.4, 3, 1.3);
    return paint(geometry, (c, x, y, z, nx, ny) => {
      const m = fbm(x * 3.5 + 4, y * 3.5, z * 3.5, 3);
      const fine = fbm(x * 16, y * 16, z * 16, 2);
      if (ny > 0.6) c.copy(CRUMB).lerp(TOAST, MathUtils.smoothstep(m, 0.35, 0.8)).multiplyScalar(0.94 + 0.14 * fine);
      else if (ny < -0.6) c.copy(crust).multiplyScalar(0.7 * (0.9 + 0.2 * m));
      else c.copy(crust).multiplyScalar((0.86 + 0.32 * m) * (1.04 - Math.abs(nx) * 0.0));
    });
  }
  const rim: Profile = [
    [0, 0],
    [0.3, 0],
    [0.6, 0],
    [0.85, 0],
    [0.96, 0.012],
  ];
  const dome = smooth(
    [
      [0.96, 0.012],
      [1.0, 0.12],
      [0.95, 0.27],
      [0.82, 0.39],
      [0.6, 0.47],
      [0.3, 0.51],
      [0, 0.52],
    ],
    30,
  );
  const geometry = lathe([...rim, ...dome.slice(1)], 0.52);
  organic(geometry, 0.014, 3.2, 3, 4.1);
  organic(geometry, 0.004, 15, 2, 9.4);
  return paint(geometry, (c, x, y, z, nx, ny) => {
    const m = fbm(x * 4 + 3, y * 4, z * 4, 3);
    const fine = fbm(x * 18, y * 18, z * 18, 2);
    if (ny < -0.6) {
      c.copy(CRUMB).multiplyScalar(0.9 + 0.2 * fine);
      return;
    }
    const crown = MathUtils.smoothstep(y + 0.26, 0.04, 0.5);
    c.copy(crust).multiplyScalar(mix(1.2, 0.78, crown) * (0.84 + 0.36 * m));
    c.multiplyScalar(0.97 + 0.06 * fine + nx * 0);
  });
}

/** One sesame seed: a small tapered ellipsoid lying flat. */
export function makeSesame(): BufferGeometry {
  const geometry = new SphereGeometry(0.05, 10, 8);
  geometry.deleteAttribute('uv');
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const pinch = 1 - 0.5 * MathUtils.clamp((x + 0.05) / 0.1, 0, 1);
    position.setXYZ(i, x * 1.15, position.getY(i) * 0.4 * pinch, position.getZ(i) * 0.6 * pinch);
  }
  geometry.computeVertexNormals();
  return paint(geometry, (c, x) => {
    c.set('#f1e0b4').multiplyScalar(0.92 + 0.16 * MathUtils.smoothstep(x, -0.05, 0.06));
  });
}

/** A hand-formed patty: uneven edge, rough seared top with grill marks, deterministic. */
export function makePatty(): BufferGeometry {
  const profile: Profile = [
    [0, 0],
    [0.5, 0],
    [0.9, 0.005],
    [1.0, 0.03],
    [1.055, 0.1],
    [1.06, 0.17],
    [1.03, 0.23],
    [0.98, 0.255],
    [0.9, 0.26],
    [0.8, 0.26],
    [0.7, 0.26],
    [0.6, 0.26],
    [0.5, 0.26],
    [0.4, 0.26],
    [0.3, 0.26],
    [0.2, 0.26],
    [0.1, 0.26],
    [0, 0.26],
  ];
  const geometry = lathe(profile, 0.26, 128);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.05) continue;
    const a = Math.atan2(z, x);
    const edge = 1 + 0.045 * (fbm(Math.cos(a) * 1.4 + 9, Math.sin(a) * 1.4 - 3, 1.7, 3) - 0.5) * 2;
    const rough = normal.getY(i) > 0.5 ? (fbm(x * 8, 0.5, z * 8, 3) - 0.5) * 0.03 : 0;
    position.setXYZ(i, x * edge, y + rough, z * edge);
  }
  geometry.computeVertexNormals();
  const grill = 0.55;
  const sx = Math.cos(grill);
  const sz = Math.sin(grill);
  return paint(geometry, (c, x, y, z, nx, ny) => {
    const r = Math.hypot(x, z);
    const m = fbm(x * 5, y * 5, z * 5, 3);
    const flecks = fbm(x * 22, y * 22, z * 22, 2);
    c.copy(PATTY_BASE).multiplyScalar(0.8 + 0.5 * m);
    c.lerp(PATTY_FAT, MathUtils.smoothstep(flecks, 0.7, 0.9) * 0.7);
    if (ny > 0.5) {
      const band = Math.abs(Math.sin((x * sx + z * sz) * 11));
      c.lerp(PATTY_CHAR, MathUtils.smoothstep(band, 0.8, 0.96) * 0.85);
    }
    c.lerp(PATTY_CHAR, MathUtils.smoothstep(r, 0.96, 1.07) * 0.55);
  });
}

/** A square slice that drapes over the edge of the patty, with melt tongues at the sides. */
export function makeCheese(): BufferGeometry {
  const sheet = new PlaneGeometry(2.16, 2.16, 64, 64);
  sheet.rotateX(-Math.PI / 2);
  plain(sheet);
  const position = sheet.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    const drape = -0.3 * MathUtils.smoothstep(r, 0.95, 1.5);
    const wave = (fbm(x * 2.2, 0.3, z * 2.2, 3) - 0.5) * 0.03;
    position.setY(i, drape + wave * MathUtils.smoothstep(r, 0.2, 0.9));
  }
  sheet.computeVertexNormals();
  paint(sheet, (c, x, _y, z) => {
    const r = Math.hypot(x, z);
    const m = fbm(x * 3, 1.1, z * 3, 3);
    c.copy(CHEESE).lerp(CHEESE_EDGE, MathUtils.smoothstep(r, 0.8, 1.4) * 0.8).multiplyScalar(0.92 + 0.16 * m);
  });
  const parts: BufferGeometry[] = [sheet];
  for (const [px, pz, length] of [
    [1.04, 0.12, 0.2],
    [-1.04, -0.2, 0.15],
    [0.22, 1.04, 0.17],
    [-0.15, -1.04, 0.22],
  ] as const) {
    const drip = new CapsuleGeometry(0.034, length, 4, 10);
    plain(drip);
    drip.translate(px, -0.05 - length / 2, pz);
    paint(drip, (c, _x, y) => {
      c.copy(CHEESE).lerp(CHEESE_EDGE, MathUtils.smoothstep(-y, 0.05, 0.3) * 0.7);
    });
    parts.push(drip);
  }
  return join(parts);
}

/** Three overlapping ruffled leaves with pale veins. */
export function makeLettuce(): BufferGeometry {
  const leaf = (radius: number, phase: number, frequency: number, lift: number): BufferGeometry => {
    const geometry = new RingGeometry(0.12, radius, 112, 20);
    geometry.rotateX(-Math.PI / 2);
    plain(geometry);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const t = MathUtils.smoothstep(r, 0.2, radius);
      const frill = 1 + 0.03 * Math.sin(frequency * 3 * a + phase * 2) * t;
      const ruffle =
        (0.024 * Math.sin(frequency * a + phase + r * 2.5) + 0.009 * Math.sin(frequency * 2.3 * a - phase)) * t;
      const grain = (fbm(x * 3 + phase, 0.4, z * 3, 2) - 0.5) * 0.01;
      position.setXYZ(i, x * frill, lift + ruffle + grain, z * frill);
    }
    geometry.computeVertexNormals();
    return paint(geometry, (c, x, _y, z) => {
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const t = r / radius;
      const vein = Math.pow(Math.abs(Math.cos(a * 3 + phase)), 28) * (1 - 0.6 * t);
      c.copy(LETTUCE_DARK).lerp(LETTUCE_LIGHT, MathUtils.smoothstep(t, 0.25, 1));
      c.lerp(LETTUCE_VEIN, vein * 0.55);
      c.multiplyScalar(0.9 + 0.2 * fbm(x * 4, phase, z * 4, 2));
    });
  };
  return join([leaf(1.08, 0, 9, -0.01), leaf(0.98, 2.1, 11, 0.018), leaf(0.9, 4.2, 13, 0.04)]);
}

/** Two thick slices with the pattern of a cut tomato on top. */
export function makeTomato(): BufferGeometry {
  const profile: Profile = [
    [0, 0],
    [0.5, 0],
    [0.8, 0],
    [0.845, 0.012],
    [0.85, 0.034],
    [0.82, 0.045],
    [0.6, 0.045],
    [0.4, 0.045],
    [0.2, 0.045],
    [0, 0.045],
  ];
  const slice = (offsetX: number, offsetY: number, offsetZ: number, turn: number): BufferGeometry => {
    const geometry = lathe(profile, 0.045, 72);
    geometry.rotateY(turn);
    geometry.translate(offsetX, offsetY, offsetZ);
    paint(geometry, (c, x, y, z, _nx, ny) => {
      const lx = x - offsetX;
      const lz = z - offsetZ;
      const r = Math.hypot(lx, lz);
      const a = Math.atan2(lz, lx) - turn;
      if (ny < 0.5) {
        c.copy(TOMATO_SKIN);
        return;
      }
      const chambers =
        MathUtils.smoothstep(Math.cos(5 * a), 0.1, 0.6) *
        MathUtils.smoothstep(r, 0.22, 0.4) *
        (1 - MathUtils.smoothstep(r, 0.58, 0.72));
      c.copy(TOMATO_SKIN).lerp(TOMATO_FLESH, MathUtils.smoothstep(r, 0.68, 0.8));
      c.lerp(TOMATO_GEL, chambers * 0.8);
      c.lerp(TOMATO_CORE, 1 - MathUtils.smoothstep(r, 0.05, 0.2));
      c.multiplyScalar(0.94 + 0.12 * fbm(lx * 6, y * 6, lz * 6, 2));
    });
    return geometry;
  };
  return join([slice(0.1, -0.0225, 0.02, 0.4), slice(-0.12, 0.0225, -0.05, 1.7)]);
}

/** Five crinkle-cut pickle coins on a ring. */
export function makePickles(): BufferGeometry {
  const coins: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const cx = 0.58 * Math.cos(angle);
    const cz = 0.58 * Math.sin(angle);
    const coin = new CylinderGeometry(0.27, 0.27, 0.06, 40, 1);
    plain(coin);
    const position = coin.getAttribute('position');
    for (let v = 0; v < position.count; v++) {
      const x = position.getX(v);
      const z = position.getZ(v);
      const a = Math.atan2(z, x);
      const crinkle = 1 + 0.05 * Math.sin(18 * a + i);
      position.setXYZ(v, x * crinkle, position.getY(v), z * crinkle);
    }
    coin.computeVertexNormals();
    paint(coin, (c, x, _y, z, _nx, ny) => {
      const r = Math.hypot(x, z) / 0.27;
      if (ny < 0.5 && ny > -0.5) {
        c.copy(PICKLE_EDGE);
        return;
      }
      c.copy(PICKLE_FACE).lerp(PICKLE_RING, MathUtils.smoothstep(r, 0.35, 0.6) * (1 - MathUtils.smoothstep(r, 0.7, 0.9)));
      c.lerp(PICKLE_EDGE, MathUtils.smoothstep(r, 0.82, 1));
    });
    coin.translate(cx, 0, cz);
    coins.push(coin);
  }
  return join(coins);
}

/** Two crossed, crinkled strips with lean and fat bands. */
export function makeBacon(): BufferGeometry {
  const strips = [0.5, -0.5].map((turn) => {
    const strip = new PlaneGeometry(1.9, 0.36, 44, 6);
    strip.rotateX(-Math.PI / 2);
    plain(strip);
    const position = strip.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, 0.02 * Math.sin(position.getX(i) * 8 + position.getZ(i) * 5) + 0.008 * Math.sin(position.getX(i) * 21));
    }
    strip.computeVertexNormals();
    paint(strip, (c, x, _y, z) => {
      const band = Math.sin(z * 24 + fbm(x * 3, 0, z * 3, 2) * 5 + x * 1.5);
      c.copy(BACON_LEAN).lerp(BACON_FAT, MathUtils.smoothstep(band, 0.1, 0.55));
      c.multiplyScalar(0.9 + 0.2 * fbm(x * 6, 0.2, z * 6, 2));
    });
    strip.rotateY(turn);
    return strip;
  });
  return join(strips);
}

// ---------------------------------------------------------------------------------------------
// Coffee
// ---------------------------------------------------------------------------------------------

/** Where the gilded rims sit, in each part's own centred coordinates. */
export const SAUCER_RIM = { radius: 0.995, y: 0.0425 } as const;
export const CUP_RIM = { radius: 0.728, y: 0.3 } as const;
export const GLASS_RIM = { radius: 0.508, y: 0.55 } as const;

const PORCELAIN = new Color('#f7f2ea');

export function makeSaucer(): BufferGeometry {
  const outer = smooth(
    [
      [0.55, 0],
      [0.82, 0.012],
      [0.96, 0.05],
      [1.015, 0.085],
    ],
    16,
  );
  const profile: Profile = [
    [0, 0],
    [0.3, 0],
    ...outer,
    [0.995, 0.088],
    [0.95, 0.08],
    [0.82, 0.052],
    [0.66, 0.04],
    [0.52, 0.036],
    [0.3, 0.038],
    [0, 0.04],
  ];
  const geometry = lathe(profile, 0.085, 128);
  return paint(geometry, (c) => c.copy(PORCELAIN));
}

/** A tulip cup with a foot ring, a rounded lip and an ear handle on its +x side. */
export function makeCup(): BufferGeometry {
  const outer = smooth(
    [
      [0.3, 0.0],
      [0.33, 0.035],
      [0.42, 0.075],
      [0.54, 0.2],
      [0.65, 0.38],
      [0.72, 0.52],
      [0.75, 0.59],
    ],
    22,
  );
  const inner = smooth(
    [
      [0.69, 0.585],
      [0.66, 0.46],
      [0.58, 0.3],
      [0.46, 0.15],
      [0.3, 0.1],
    ],
    18,
  );
  const profile: Profile = [
    [0, 0],
    [0.15, 0],
    ...outer,
    [0.745, 0.6],
    [0.715, 0.603],
    [0.7, 0.595],
    ...inner,
    [0, 0.09],
  ];
  const body = lathe(profile, 0.6, 128);
  paint(body, (c) => c.copy(PORCELAIN));

  const curve = new CatmullRomCurve3([
    new Vector3(0.68, 0.5, 0),
    new Vector3(0.86, 0.54, 0),
    new Vector3(1.0, 0.43, 0),
    new Vector3(0.98, 0.26, 0),
    new Vector3(0.82, 0.16, 0),
    new Vector3(0.64, 0.19, 0),
  ]);
  const handle = new TubeGeometry(curve, 44, 0.036, 14, false);
  plain(handle);
  const hp = handle.getAttribute('position');
  for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i), hp.getY(i) - 0.3, hp.getZ(i) * 0.78);
  handle.computeVertexNormals();
  paint(handle, (c) => c.copy(PORCELAIN));
  return join([body, handle]);
}

/** The surface of the drink, with a raised meniscus at the wall. UVs run flat across it. */
export function makeCoffee(): BufferGeometry {
  const geometry = new RingGeometry(0.0005, 0.655, 96, 12);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getZ(i));
    position.setY(i, 0.012 * MathUtils.smoothstep(r, 0.56, 0.655));
  }
  geometry.computeVertexNormals();
  return paint(geometry, (c) => c.setRGB(1, 1, 1));
}

// ---------------------------------------------------------------------------------------------
// Glass of lemonade
// ---------------------------------------------------------------------------------------------

export function makeGlass(): BufferGeometry {
  const outer = smooth(
    [
      [0.3, 0],
      [0.38, 0.012],
      [0.42, 0.04],
      [0.44, 0.3],
      [0.48, 0.75],
      [0.52, 1.1],
    ],
    24,
  );
  const inner = smooth(
    [
      [0.49, 1.1],
      [0.46, 0.78],
      [0.415, 0.32],
      [0.385, 0.13],
      [0.3, 0.105],
    ],
    18,
  );
  const profile: Profile = [[0, 0], [0.15, 0], ...outer, [0.525, 1.1], [0.51, 1.103], [0.49, 1.1], ...inner.slice(1), [0, 0.1]];
  return paint(lathe(profile, 1.1, 96), (c) => c.setRGB(1, 1, 1));
}

export function makeLiquid(): BufferGeometry {
  const profile: Profile = [
    [0, 0],
    [0.3, 0],
    [0.38, 0.03],
    [0.405, 0.2],
    [0.44, 0.6],
    [0.485, 0.86],
    [0.3, 0.86],
    [0, 0.86],
  ];
  return paint(lathe(profile, 0.86, 72), (c) => c.setRGB(1, 1, 1));
}

/** A few rounded ice cubes floating at different heights and angles. */
export function makeIce(): BufferGeometry {
  const cubes: BufferGeometry[] = [];
  const spec: Array<[number, number, number, number, number, number]> = [
    [-0.17, 0.04, 0.06, 0.5, 0.3, 0.24],
    [0.15, -0.04, -0.09, 1.1, 0.7, 0.22],
    [0.02, 0.05, -0.17, 0.2, 1.2, 0.2],
    [0.13, 0.02, 0.17, 0.9, 0.1, 0.2],
    [-0.1, -0.05, -0.13, 0.4, 0.8, 0.21],
  ];
  for (const [x, y, z, rx, ry, size] of spec) {
    const cube = slab(size, size, size, 0.045, 4, 4, 4);
    cube.rotateX(rx);
    cube.rotateY(ry);
    cube.translate(x, y, z);
    paint(cube, (c, px, py, pz) => {
      c.copy(ICE).multiplyScalar(0.9 + 0.2 * fbm(px * 8, py * 8, pz * 8, 2));
    });
    cubes.push(cube);
  }
  return join(cubes);
}

/** A lemon wheel, leaning on the rim of the glass. */
export function makeLemon(): BufferGeometry {
  const wheel = new CylinderGeometry(0.3, 0.3, 0.04, 56, 1);
  plain(wheel);
  paint(wheel, (c, x, _y, z, _nx, ny) => {
    const r = Math.hypot(x, z);
    if (Math.abs(ny) < 0.5) {
      c.copy(RIND);
      return;
    }
    const a = Math.atan2(z, x);
    const membrane = Math.pow(Math.abs(Math.cos(a * 4)), 12);
    if (r > 0.27) c.copy(RIND);
    else if (r > 0.245) c.copy(PITH);
    else {
      c.copy(FLESH).lerp(PITH, membrane * 0.8);
      c.lerp(PITH, 1 - MathUtils.smoothstep(r, 0.02, 0.07));
      c.multiplyScalar(0.94 + 0.12 * fbm(x * 14, 0, z * 14, 2));
    }
  });
  wheel.rotateZ(1.15);
  wheel.translate(0.44, 0.1, 0);
  return wheel;
}

// ---------------------------------------------------------------------------------------------
// Croissant
// ---------------------------------------------------------------------------------------------

export function makeCroissant(): BufferGeometry {
  const points: Vector3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const phi = MathUtils.lerp(-1.12, 1.12, i / steps);
    points.push(new Vector3(0.92 * Math.sin(phi), 0, 0.92 * (1 - Math.cos(phi)) * 1.1));
  }
  const curve = new CatmullRomCurve3(points);
  const radial = 30;
  const tubular = 110;
  const tube = new TubeGeometry(curve, tubular, 1, radial, false);
  plain(tube);
  const position = tube.getAttribute('position');
  const center = new Vector3();
  const offset = new Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    center.copy(curve.getPointAt(u));
    const taper = Math.pow(Math.sin(Math.PI * Math.min(0.97, Math.max(0.03, u))), 0.72);
    const ridge = 0.8 + 0.2 * Math.pow(Math.abs(Math.sin(u * Math.PI * 7)), 0.5);
    const radius = 0.31 * taper * ridge;
    for (let j = 0; j <= radial; j++) {
      const index = i * (radial + 1) + j;
      offset.set(position.getX(index), position.getY(index), position.getZ(index)).sub(center);
      offset.multiplyScalar(radius);
      offset.y *= 0.82;
      position.setXYZ(index, center.x + offset.x, center.y + offset.y, center.z + offset.z);
    }
  }
  tube.computeVertexNormals();
  tube.computeBoundingBox();
  const box = tube.boundingBox!;
  tube.translate(-(box.max.x + box.min.x) / 2, -(box.max.y + box.min.y) / 2, -(box.max.z + box.min.z) / 2);
  return paint(tube, (c, x, y, z) => {
    const ridges = Math.pow(Math.abs(Math.sin((x / 0.92) * 2.9 * 3.1)), 1.2);
    const m = fbm(x * 4, y * 4, z * 4, 3);
    const top = MathUtils.smoothstep(y, -0.15, 0.2);
    c.copy(CROISSANT_LIGHT).lerp(CROISSANT_DARK, top * 0.65 + (1 - ridges) * 0.18);
    c.multiplyScalar(0.84 + 0.32 * m);
    c.lerp(new Color('#f1d393'), MathUtils.smoothstep(-y, 0.12, 0.2) * 0.6);
  });
}

// ---------------------------------------------------------------------------------------------
// Mille-feuille
// ---------------------------------------------------------------------------------------------

const SLAB_WIDTH = 1.7;
const SLAB_DEPTH = 0.62;

export function makePuff(height = 0.12): BufferGeometry {
  const geometry = slab(SLAB_WIDTH, height, SLAB_DEPTH, 0.022, 48, 3, 16);
  return paint(geometry, (c, x, y, z, nx, _ny, nz) => {
    const side = Math.max(Math.abs(nx), Math.abs(nz)) > 0.5;
    const m = fbm(x * 2.4, y * 3, z * 2.4, 3);
    if (side) {
      const flakes = fbm(x * 2.2, y * 70, z * 2.2, 2);
      c.copy(PUFF_DARK).lerp(PUFF_LIGHT, MathUtils.smoothstep(flakes, 0.3, 0.8));
      c.multiplyScalar(0.88 + 0.28 * m);
    } else {
      c.copy(PUFF_LIGHT).multiplyScalar(0.84 + 0.3 * m);
    }
  });
}

export function makeCream(height = 0.09): BufferGeometry {
  const geometry = slab(SLAB_WIDTH - 0.04, height, SLAB_DEPTH - 0.04, 0.034, 48, 3, 16);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const bulge = 1 + 0.03 * (fbm(position.getX(i) * 3, 0.7, position.getZ(i) * 3, 2) - 0.2);
    position.setXYZ(i, position.getX(i) * 1.0, position.getY(i), position.getZ(i) * bulge);
  }
  geometry.computeVertexNormals();
  return paint(geometry, (c, x, y, z) => {
    const speck = fbm(x * 30, y * 30, z * 30, 1);
    c.copy(CREAM).lerp(CREAM_SPECK, MathUtils.smoothstep(speck, 0.82, 0.95) * 0.5);
  });
}

export function makeIcing(tone?: string): BufferGeometry {
  const base = crustOf(tone ?? '#9db07a').lerp(new Color('#ffffff'), 0.1);
  const geometry = slab(SLAB_WIDTH, 0.05, SLAB_DEPTH, 0.02, 48, 2, 16);
  return paint(geometry, (c, x, y, z, _nx, ny) => {
    const m = fbm(x * 2, y * 2, z * 2, 2);
    c.copy(base).multiplyScalar(0.92 + 0.14 * m);
    if (ny > 0.5) {
      const across = (z / SLAB_DEPTH + 0.5) * 9;
      const stripe = Math.abs(across - Math.round(across));
      const feather = 0.5 + 0.5 * Math.sin(x * 22 + Math.round(across) * 1.7);
      if (stripe < 0.1) {
        c.copy(CHOCOLATE);
        if (Math.round(across) % 2 === 0) c.lerp(base, MathUtils.smoothstep(feather, 0.5, 1) * 0.55);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export interface PartOptions {
  /** The product's art colour: the bun's crust, the icing, the drink. */
  tone?: string;
}

export function makeLayerGeometry(kind: LayerKind, options: PartOptions = {}): BufferGeometry {
  const { tone } = options;
  switch (kind) {
    case 'saucer':
      return makeSaucer();
    case 'cup':
      return makeCup();
    case 'coffee':
      return makeCoffee();
    case 'glass':
      return makeGlass();
    case 'liquid':
      return makeLiquid();
    case 'ice':
      return makeIce();
    case 'lemon':
      return makeLemon();
    case 'croissant':
      return makeCroissant();
    case 'puff-1':
    case 'puff-2':
    case 'puff-3':
      return makePuff();
    case 'cream-1':
    case 'cream-2':
      return makeCream();
    case 'icing':
      return makeIcing(tone);
    case 'bun-bottom':
      return makeBun('bottom', tone);
    case 'bun-top':
      return makeBun('top', tone);
    case 'patty':
    case 'patty-2':
      return makePatty();
    case 'cheese':
      return makeCheese();
    case 'lettuce':
      return makeLettuce();
    case 'tomato':
      return makeTomato();
    case 'pickles':
      return makePickles();
    case 'bacon':
      return makeBacon();
  }
}

