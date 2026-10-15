import {
  BufferGeometry,
  CylinderGeometry,
  LatheGeometry,
  MathUtils,
  PlaneGeometry,
  RingGeometry,
  TorusGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LayerKind } from '@/lib/stage';

/**
 * Procedural burger parts. The burger's outer radius is 1 and every geometry is centred on its own
 * origin, so the scene places a layer by `layer.y` alone. Nothing here is random: the same call
 * always returns the same shape, which keeps renders and tests stable.
 */

const SEGMENTS = 48;
type Profile = ReadonlyArray<readonly [number, number]>;

/**
 * Turns a profile (radius, height) into a solid of revolution. Profiles run from the axis out along
 * the bottom, up the side and back to the axis, which gives outward-facing normals.
 */
function lathe(profile: Profile, height: number, segments = SEGMENTS): BufferGeometry {
  const geometry = new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), segments);
  geometry.translate(0, -height / 2, 0);
  geometry.computeVertexNormals();
  return geometry;
}

const BUN_BOTTOM: Profile = [
  [0, 0],
  [0.82, 0],
  [0.96, 0.02],
  [1.0, 0.1],
  [0.99, 0.22],
  [0.95, 0.31],
  [0.88, 0.34],
  [0, 0.34],
];

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

const BUN_TOP: Profile = [[0, 0], [0.9, 0], [0.99, 0.03], ...[...DOME].reverse()];

const PATTY: Profile = [
  [0, 0],
  [0.95, 0],
  [1.03, 0.04],
  [1.06, 0.13],
  [1.04, 0.22],
  [0.97, 0.26],
  [0, 0.26],
];

export function makeBun(kind: 'bottom' | 'top'): BufferGeometry {
  return kind === 'bottom' ? lathe(BUN_BOTTOM, 0.34) : lathe(BUN_TOP, 0.52);
}

/** A hand-formed patty: slightly uneven edge and a rough top, deterministic. */
export function makePatty(): BufferGeometry {
  const geometry = lathe(PATTY, 0.26, 64);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.2) continue;
    const angle = Math.atan2(z, x);
    const edge = 1 + 0.012 * Math.sin(5 * angle + 1.3) + 0.006 * Math.sin(11 * angle);
    const rough = y > 0.12 ? 0.012 * Math.sin(9 * x + 0.5) * Math.cos(7 * z) : 0;
    position.setXYZ(i, x * edge, y + rough, z * edge);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A square slice that drapes over the edge of the patty. */
export function makeCheese(): BufferGeometry {
  const geometry = new PlaneGeometry(2.16, 2.16, 24, 24);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const drop = -0.3 * MathUtils.smoothstep(Math.hypot(x, z), 0.95, 1.5);
    position.setY(i, drop);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A ruffled leaf ring. */
export function makeLettuce(): BufferGeometry {
  const geometry = new RingGeometry(0.35, 1.12, 64, 3);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const r = Math.hypot(x, z);
    const wave = 0.05 * Math.sin(7 * Math.atan2(z, x) + 3 * r) * MathUtils.smoothstep(r, 0.35, 1.1);
    position.setY(i, wave);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function makeTomato(): BufferGeometry {
  return new CylinderGeometry(0.84, 0.84, 0.09, 40);
}

/** Five pickle coins arranged on a ring. */
export function makePickles(): BufferGeometry {
  const coins: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    const coin = new CylinderGeometry(0.27, 0.27, 0.06, 20);
    coin.translate(0.58 * Math.cos(angle), 0, 0.58 * Math.sin(angle));
    coins.push(coin);
  }
  const merged = mergeGeometries(coins);
  coins.forEach((coin) => coin.dispose());
  return merged;
}

/** Two crossed, rippled strips. */
export function makeBacon(): BufferGeometry {
  const strips = [0.5, -0.5].map((turn) => {
    const strip = new PlaneGeometry(1.9, 0.36, 28, 2);
    strip.rotateX(-Math.PI / 2);
    const position = strip.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      position.setY(i, 0.022 * Math.sin(position.getX(i) * 8 + position.getZ(i) * 5));
    }
    strip.rotateY(turn);
    strip.computeVertexNormals();
    return strip;
  });
  const merged = mergeGeometries(strips);
  strips.forEach((strip) => strip.dispose());
  return merged;
}

const SAUCER: Profile = [
  [0, 0],
  [0.55, 0],
  [0.9, 0.025],
  [1.02, 0.085],
  [0.97, 0.085],
  [0.88, 0.06],
  [0.58, 0.045],
  [0, 0.045],
];

/** Outer wall up, over the rim, inner wall down, to the floor of the cup. */
const CUP: Profile = [
  [0, 0],
  [0.34, 0],
  [0.5, 0.04],
  [0.66, 0.28],
  [0.74, 0.6],
  [0.69, 0.6],
  [0.61, 0.3],
  [0.46, 0.1],
  [0, 0.09],
];

export function makeSaucer(): BufferGeometry {
  return lathe(SAUCER, 0.085, 64);
}

/** A cup with a loop handle on its +x side. */
export function makeCup(): BufferGeometry {
  const body = lathe(CUP, 0.6, 64);
  const handle = new TorusGeometry(0.19, 0.04, 10, 24, Math.PI);
  handle.rotateZ(-Math.PI / 2);
  handle.translate(0.7, 0.03, 0);
  const merged = mergeGeometries([body, handle]);
  body.dispose();
  handle.dispose();
  return merged;
}

/** The surface of the drink; a thin disc so its top face carries the crema texture. */
export function makeCoffee(): BufferGeometry {
  const disc = new CylinderGeometry(0.655, 0.655, 0.04, 56);
  return disc;
}

export function makeLayerGeometry(kind: LayerKind): BufferGeometry {
  switch (kind) {
    case 'saucer':
      return makeSaucer();
    case 'cup':
      return makeCup();
    case 'coffee':
      return makeCoffee();
    case 'bun-bottom':
      return makeBun('bottom');
    case 'bun-top':
      return makeBun('top');
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
