import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  IcosahedronGeometry,
  LatheGeometry,
  Path,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';

/**
 * Geometry the scenes are built from, made in code (no model files): ribbons, arches, stars, beans, leaves, petals,
 * pebbles and turned forms. Each builder is deterministic, so a scene looks the same on every load.
 */

/** A small seeded random generator, so scattered things land in the same places every time. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A flat ribbon along a smooth curve through `points`, `width` wide, turning `twist` radians along its length. Both
 * sides are drawn (the material should be double-sided).
 */
export function ribbonGeometry(points: Vector3[], width: number, twist: number, segments = 160): BufferGeometry {
  const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(segments, false);
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const point = curve.getPointAt(u);
    const angle = twist * u;
    const normal = frames.normals[i]!.clone().multiplyScalar(Math.cos(angle)).add(frames.binormals[i]!.clone().multiplyScalar(Math.sin(angle)));
    // Taper the ends so the ribbon comes out of nothing and goes back into it.
    const half = (width / 2) * Math.sin(Math.PI * Math.min(1, Math.max(0, u)) ) ** 0.35;
    const a = point.clone().addScaledVector(normal, half);
    const b = point.clone().addScaledVector(normal, -half);
    positions.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    uvs.set([u, 0, u, 1], i * 4);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** An arch: a rectangle with a round top, `thickness` wide all round, as a shape to extrude. */
export function archShape(width: number, height: number, thickness: number): Shape {
  const r = width / 2;
  const shape = new Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(-r, height - r);
  shape.absarc(0, height - r, r, Math.PI, 0, true);
  shape.lineTo(r, 0);
  shape.lineTo(r - thickness, 0);
  shape.lineTo(r - thickness, height - r);
  shape.absarc(0, height - r, r - thickness, 0, Math.PI, false);
  shape.lineTo(-r + thickness, 0);
  shape.lineTo(-r, 0);
  return shape;
}

/** A star of `points` points, as a shape to extrude (the eight-point star of Islamic geometry by default). */
export function starShape(points = 8, outer = 1, inner = 0.58, hole = 0): Shape {
  const shape = new Shape();
  for (let i = 0; i <= points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  if (hole > 0) {
    const path = new Path();
    path.absarc(0, 0, hole, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  return shape;
}

/** A coffee bean: an ellipsoid with a groove down one face. */
export function beanGeometry(): BufferGeometry {
  const geometry = new SphereGeometry(1, 28, 20);
  const position = geometry.attributes.position as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    v.x *= 0.72;
    v.y *= 1.0;
    v.z *= 0.52;
    // The groove: a narrow valley along y on the front face.
    if (v.z > 0) v.z -= 0.22 * Math.exp(-((v.x / 0.09) ** 2)) * Math.sqrt(Math.max(0, 1 - v.y * v.y));
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A leaf as a flat shape, base at the origin, pointing up. */
export function leafShape(length = 1, width = 0.42): Shape {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width, length * 0.25, width * 0.8, length * 0.7, 0, length);
  shape.bezierCurveTo(-width * 0.8, length * 0.7, -width, length * 0.25, 0, 0);
  return shape;
}

/** A leaf or petal with a gentle curl: the flat shape bent along its length and across it. */
export function curledGeometry(shape: Shape, curl = 0.35, cup = 0.25): BufferGeometry {
  const geometry = new ShapeGeometry(shape, 16);
  const position = geometry.attributes.position as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, curl * y * y + cup * x * x * 4);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A petal: rounder than a leaf, with a notch-free tip. */
export function petalShape(length = 1, width = 0.62): Shape {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(width * 0.9, length * 0.15, width, length * 0.85, 0, length);
  shape.bezierCurveTo(-width, length * 0.85, -width * 0.9, length * 0.15, 0, 0);
  return shape;
}

/** A smooth river stone: a squashed sphere with a little irregularity. */
export function pebbleGeometry(seed: number, squash = 0.55): BufferGeometry {
  const random = seeded(seed);
  const geometry = new SphereGeometry(1, 40, 28);
  const position = geometry.attributes.position as BufferAttribute;
  const a = 0.08 + random() * 0.06;
  const phase = random() * Math.PI * 2;
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const wobble = 1 + a * Math.sin(v.x * 2.1 + phase) * Math.cos(v.z * 1.7 + phase);
    position.setXYZ(i, v.x * wobble * 1.15, v.y * squash * wobble, v.z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A soft blob, to be moved by `displaceBlob` each frame. */
export function blobGeometry(detail = 5): IcosahedronGeometry {
  return new IcosahedronGeometry(1, detail);
}

/** Pushes a blob's surface in and out with slow waves; `base` is its original positions. */
export function displaceBlob(geometry: BufferGeometry, base: Float32Array, time: number, amount: number): void {
  const position = geometry.attributes.position as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = base[i * 3]!;
    const y = base[i * 3 + 1]!;
    const z = base[i * 3 + 2]!;
    const n = Math.sin(x * 2.2 + time * 0.9) * Math.sin(y * 2.6 + time * 0.7) * Math.sin(z * 1.9 + time * 0.8);
    const scale = 1 + n * amount;
    position.setXYZ(i, x * scale, y * scale, z * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** Turned forms: a cup, a bowl, a vase and a stand's stem, as lathe geometry from a profile. */
export function latheOf(profile: Array<[number, number]>, segments = 64): LatheGeometry {
  return new LatheGeometry(
    profile.map(([radius, height]) => new Vector2(radius, height)),
    segments,
  );
}

export const PROFILES = {
  cup: [
    [0, 0],
    [0.5, 0],
    [0.56, 0.05],
    [0.66, 0.5],
    [0.74, 0.92],
    [0.7, 0.95],
    [0.62, 0.55],
    [0.52, 0.12],
    [0, 0.12],
  ],
  bowl: [
    [0, 0],
    [0.45, 0],
    [0.5, 0.06],
    [0.9, 0.38],
    [1.05, 0.72],
    [1.0, 0.75],
    [0.84, 0.42],
    [0.44, 0.14],
    [0, 0.14],
  ],
  vase: [
    [0, 0],
    [0.42, 0],
    [0.55, 0.3],
    [0.6, 0.75],
    [0.38, 1.2],
    [0.24, 1.45],
    [0.3, 1.62],
    [0.26, 1.64],
    [0.18, 1.48],
    [0, 1.48],
  ],
  amphora: [
    [0, 0],
    [0.24, 0],
    [0.5, 0.35],
    [0.62, 0.8],
    [0.48, 1.25],
    [0.3, 1.45],
    [0.34, 1.6],
    [0.3, 1.62],
    [0.2, 1.5],
    [0, 1.5],
  ],
} satisfies Record<string, Array<[number, number]>>;
