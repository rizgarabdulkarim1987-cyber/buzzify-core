import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TorusKnotGeometry } from 'three';

/**
 * Sample scene files for trying the Template Studio's background files locally (spec
 * 2026-10-18-template-studio-stage-2-scene-files-design.md): a gold torus knot as a GLB, and a Lottie animation of three
 * drifting dots. Both pass the library's checks. `npx tsx scripts/scene-fixtures.ts [folder]` writes them to
 * `.data/scene-fixtures/` (or the folder given); upload them on the Studio's Media page or in the Design tab.
 *
 * A video is not made here (that needs an H.264 encoder); any MP4 in H.264 of at most 30 s and 1920 px will do.
 */

const folder = process.argv[2] ?? join('.data', 'scene-fixtures');

/** A GLB of one mesh: positions, normals and indices, with a metallic gold material. */
function torusKnotGlb(): Uint8Array {
  const geometry = new TorusKnotGeometry(1, 0.32, 128, 16);
  const position = geometry.getAttribute('position').array as Float32Array;
  const normal = geometry.getAttribute('normal').array as Float32Array;
  const index = new Uint16Array(geometry.getIndex()!.array as ArrayLike<number>);
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox!;

  const pad = (n: number) => (4 - (n % 4)) % 4;
  const parts = [new Uint8Array(position.buffer, position.byteOffset, position.byteLength), new Uint8Array(normal.buffer, normal.byteOffset, normal.byteLength), new Uint8Array(index.buffer, index.byteOffset, index.byteLength)];
  const offsets: number[] = [];
  let length = 0;
  for (const part of parts) {
    offsets.push(length);
    length += part.length + pad(part.length);
  }
  const bin = new Uint8Array(length);
  parts.forEach((part, i) => bin.set(part, offsets[i]!));

  const gltf = {
    asset: { version: '2.0', generator: 'buzzify scene-fixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Knot' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Gold', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.74, 0.32, 1], metallicFactor: 1, roughnessFactor: 0.28 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: parts.map((part, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: part.length, target: i === 2 ? 34963 : 34962 })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: position.length / 3, type: 'VEC3', min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] },
      { bufferView: 1, componentType: 5126, count: normal.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: index.length, type: 'SCALAR' },
    ],
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = json.length + pad(json.length);
  const total = 12 + 8 + jsonLength + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + jsonLength);
  view.setUint32(20 + jsonLength, bin.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

/** Three gold dots drifting up and down out of step, on a 400 × 400 stage, looping every 3 s. */
function driftingDots(): string {
  const dot = (index: number, x: number, delay: number) => ({
    ddd: 0,
    ind: index,
    ty: 4,
    nm: `Dot ${index}`,
    sr: 1,
    ks: {
      o: { a: 0, k: 85 },
      r: { a: 0, k: 0 },
      p: {
        a: 1,
        k: [
          { t: delay, s: [x, 230, 0], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
          { t: delay + 45, s: [x, 170, 0], i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } },
          { t: delay + 90, s: [x, 230, 0] },
        ],
      },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    shapes: [
      { ty: 'el', d: 1, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [46, 46] }, nm: 'Circle' },
      { ty: 'fl', c: { a: 0, k: [0.85, 0.66, 0.29, 1] }, o: { a: 0, k: 100 }, r: 1, nm: 'Gold' },
    ],
    ip: 0,
    op: 180,
    st: 0,
    bm: 0,
  });
  return JSON.stringify({ v: '5.7.4', fr: 30, ip: 0, op: 90, w: 400, h: 400, nm: 'Drifting dots', ddd: 0, assets: [], layers: [dot(1, 120, 0), dot(2, 200, 15), dot(3, 280, 30)] });
}

mkdirSync(folder, { recursive: true });
const glb = torusKnotGlb();
writeFileSync(join(folder, 'torus-knot.glb'), glb);
const lottie = driftingDots();
writeFileSync(join(folder, 'drifting-dots.json'), lottie);
console.log(`Wrote ${join(folder, 'torus-knot.glb')} (${glb.length} bytes) and ${join(folder, 'drifting-dots.json')} (${lottie.length} bytes)`);
