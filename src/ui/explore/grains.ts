import { BufferGeometry, Color, MathUtils, Mesh, Vector2, Vector3 } from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { Layer, LayerKind, StageArt } from '@/lib/stage';
import { makeLayerGeometry } from '@/ui/stage/stage-parts';

/**
 * A dish as a cloud of grains: points scattered over the surface of its layers, each with the
 * painted colour and the surface normal at that spot, so the cloud keeps the dish's shape, colours
 * and shading. Deterministic: the same dish always gives the same grains.
 */
export interface GrainCloud {
  count: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
}

/** How many grains a part gets relative to its area: big see-through or flat parts need fewer. */
const WEIGHT: Partial<Record<LayerKind, number>> = { glass: 0.35, saucer: 0.6, lemon: 0.7, liquid: 0.8, bag: 0.7 };
/** How opaque a part's grains are. */
const ALPHA: Partial<Record<LayerKind, number>> = { glass: 0.22, ice: 0.7, liquid: 0.92 };

const GLASS = new Color('#e9f3f8');
const CREMA = new Color('#f6e7c8');

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surfaceArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let total = 0;
  const triangles = index ? index.count / 3 : position.count / 3;
  for (let i = 0; i < triangles; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return total;
}

/** Writes a colour, 0 to 1 per channel, for a point of a texture given by its UV. */
export type TextureColour = (u: number, v: number, out: { r: number; g: number; b: number }) => void;

/**
 * A scanned dish as grains: points spread over its surface by area, each coloured by its texture where it lands, so the
 * cloud melts into the scan as it really looks. `geometry` is in the dish's own units, already placed on the plinth.
 */
export function sampleSurface(geometry: BufferGeometry, count: number, colourAt: TextureColour, seed = 7): GrainCloud {
  const cloud: GrainCloud = {
    count,
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    alphas: new Float32Array(count).fill(1),
  };
  const sampler = new MeshSurfaceSampler(new Mesh(geometry));
  (sampler as unknown as { setRandomGenerator(next: () => number): void }).setRandomGenerator(mulberry32(seed));
  sampler.build();
  const position = new Vector3();
  const normal = new Vector3();
  const uv = new Vector2();
  const colour = { r: 1, g: 1, b: 1 };
  for (let k = 0; k < count; k++) {
    sampler.sample(position, normal, undefined, uv);
    normal.normalize();
    colourAt(uv.x, uv.y, colour);
    cloud.positions.set([position.x, position.y, position.z], k * 3);
    cloud.normals.set([normal.x, normal.y, normal.z], k * 3);
    cloud.colors.set([colour.r, colour.g, colour.b], k * 3);
  }
  return cloud;
}

export function sampleDish(art: StageArt, layers: readonly Layer[], tone: string, count: number, seed = 7): GrainCloud {
  const parts = layers.map((layer) => {
    const geometry = makeLayerGeometry(layer.key, { tone });
    geometry.translate(0, layer.y, 0);
    return { layer, geometry, weight: surfaceArea(geometry) * (WEIGHT[layer.key] ?? 1) };
  });

  // Share the grains by weighted area, then hand the rounding remainder to the largest parts.
  const total = parts.reduce((sum, part) => sum + part.weight, 0) || 1;
  const counts = parts.map((part) => Math.floor((count * part.weight) / total));
  let missing = count - counts.reduce((sum, n) => sum + n, 0);
  const bySize = parts.map((_, i) => i).sort((x, y) => parts[y]!.weight - parts[x]!.weight);
  for (let i = 0; missing > 0; i = (i + 1) % bySize.length, missing--) counts[bySize[i]!]! += 1;

  const cloud: GrainCloud = {
    count,
    positions: new Float32Array(count * 3),
    normals: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    alphas: new Float32Array(count),
  };
  const random = mulberry32(seed + art.length * 101);
  const position = new Vector3();
  const normal = new Vector3();
  const color = new Color();
  const drink = new Color(tone);
  let k = 0;

  parts.forEach((part, p) => {
    const n = counts[p]!;
    if (n > 0) {
      const sampler = new MeshSurfaceSampler(new Mesh(part.geometry));
      // setRandomGenerator exists in the installed three.js but not yet in its type definitions.
      (sampler as unknown as { setRandomGenerator(next: () => number): void }).setRandomGenerator(random);
      sampler.build();
      const kind = part.layer.key;
      for (let i = 0; i < n; i++, k++) {
        sampler.sample(position, normal, color);
        normal.normalize();
        if (kind === 'coffee') {
          const r = Math.hypot(position.x, position.z);
          color.copy(drink).lerp(CREMA, MathUtils.smoothstep(r, 0.4, 0.64) * 0.7);
        } else if (kind === 'liquid') {
          color.copy(drink).multiplyScalar(0.92 + 0.12 * random());
        } else if (kind === 'glass') {
          color.copy(GLASS);
        }
        cloud.positions[k * 3] = position.x;
        cloud.positions[k * 3 + 1] = position.y;
        cloud.positions[k * 3 + 2] = position.z;
        cloud.normals[k * 3] = normal.x;
        cloud.normals[k * 3 + 1] = normal.y;
        cloud.normals[k * 3 + 2] = normal.z;
        cloud.colors[k * 3] = MathUtils.clamp(color.r, 0, 1.4);
        cloud.colors[k * 3 + 1] = MathUtils.clamp(color.g, 0, 1.4);
        cloud.colors[k * 3 + 2] = MathUtils.clamp(color.b, 0, 1.4);
        cloud.alphas[k] = ALPHA[kind] ?? 1;
      }
    }
    part.geometry.dispose();
  });
  return cloud;
}
