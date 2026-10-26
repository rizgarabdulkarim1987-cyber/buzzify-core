import sharp from 'sharp';
import { sniffMediaType } from '@/server/domain/media-type';

/**
 * A GLB model for a menu's background, checked before it reaches the library (spec
 * 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.2). The file is parsed, never executed: its container must be
 * well formed, everything it draws must live inside it (no `uri` anywhere, not even a `data:` one), the extensions it
 * requires must be ones the menu's loader handles, its pictures must be pictures, and it must be light enough to draw on
 * a phone beside the menu. The file is stored as uploaded.
 */

export type GlbRefusal = 'MODEL_INVALID' | 'MODEL_EXTERNAL' | 'MODEL_EXTENSION' | 'MODEL_TOO_COMPLEX';

export interface ModelMeta {
  triangles: number;
  nodes: number;
  materials: number;
  textures: number;
  animations: number;
}

export const MODEL_LIMITS = {
  triangles: 300_000,
  nodes: 2_000,
  materials: 64,
  textures: 32,
  animations: 32,
  imageSide: 4096,
  imagePixels: 32_000_000,
} as const;

/** Extensions a file may require: those three.js's GLTFLoader handles with the meshopt decoder the menu ships. */
const REQUIRABLE = new Set(['KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_texture_transform', 'EXT_texture_webp']);
const requirable = (name: string) => REQUIRABLE.has(name) || name.startsWith('KHR_materials_');

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

class Refusal extends Error {
  constructor(
    readonly reason: GlbRefusal,
    readonly detail: string,
  ) {
    super(detail);
  }
}

const invalid = (detail: string) => new Refusal('MODEL_INVALID', detail);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const natural = (value: unknown, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid(`not a whole number: ${String(value)}`);
  return value;
};

/** Every `uri` in the document, wherever it is (extensions included): a GLB that names one reaches outside itself. */
function findUri(value: unknown, depth = 0): boolean {
  if (depth > 64) throw invalid('nested too deeply');
  if (Array.isArray(value)) return value.some((entry) => findUri(entry, depth + 1));
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, entry]) => key === 'uri' || findUri(entry, depth + 1));
}

/** The JSON and binary chunks, each inside the file. */
function chunks(bytes: Uint8Array): { json: Json; bin: Uint8Array | null } {
  if (bytes.length < 20) throw invalid('too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw invalid('not glTF');
  if (view.getUint32(4, true) !== 2) throw invalid('not version 2');
  if (view.getUint32(8, true) !== bytes.length) throw invalid('length is not the file');

  let at = 12;
  let json: Json | null = null;
  let bin: Uint8Array | null = null;
  for (let index = 0; at < bytes.length; index++) {
    if (at + 8 > bytes.length) throw invalid('chunk header past the end');
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + length > bytes.length) throw invalid('chunk past the end');
    const body = bytes.subarray(start, start + length);
    if (index === 0) {
      if (type !== CHUNK_JSON) throw invalid('first chunk is not JSON');
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
      } catch {
        throw invalid('JSON chunk is not JSON');
      }
      if (!isObject(parsed)) throw invalid('JSON chunk is not an object');
      json = parsed;
    } else if (index === 1 && type === CHUNK_BIN) {
      bin = body;
    }
    // Chunks of other types are ignored, as glTF says; they were still checked to lie inside the file.
    at = start + length;
  }
  if (!json) throw invalid('no JSON chunk');
  return { json, bin };
}

/** Whether a range lies inside a buffer of `size` bytes. */
const inside = (offset: number, length: number, size: number) => offset + length <= size;

interface ViewInfo {
  /** The bytes of the view, or null for a meshopt view whose data is decoded at load time. */
  bytes: Uint8Array | null;
  length: number;
  stride: number | null;
}

/** Buffers and buffer views: buffer 0 is the binary chunk; any other is a meshopt fallback with no bytes of its own. */
function bufferViews(gltf: Json, bin: Uint8Array | null): ViewInfo[] {
  const buffers = list(gltf.buffers);
  if (count(gltf.buffers) !== buffers.length) throw invalid('a buffer is not an object');
  const binLength = bin?.length ?? 0;
  buffers.forEach((buffer, index) => {
    const byteLength = natural(buffer.byteLength);
    if (index === 0) {
      if (!bin || byteLength > binLength) throw invalid('buffer 0 is not the binary chunk');
      return;
    }
    const meshopt = (buffer.extensions as Json | undefined)?.EXT_meshopt_compression as Json | undefined;
    if (meshopt?.fallback !== true) throw invalid(`buffer ${index} is not a meshopt fallback`);
  });

  return list(gltf.bufferViews).map((view, index) => {
    const buffer = natural(view.buffer);
    if (buffer >= buffers.length) throw invalid(`buffer view ${index} names no buffer`);
    const offset = natural(view.byteOffset, 0);
    const length = natural(view.byteLength);
    const stride = view.byteStride === undefined ? null : natural(view.byteStride);
    const meshopt = (view.extensions as Json | undefined)?.EXT_meshopt_compression as Json | undefined;
    if (meshopt) {
      if (natural(meshopt.buffer) !== 0) throw invalid(`meshopt view ${index} is not in the binary chunk`);
      if (!inside(natural(meshopt.byteOffset, 0), natural(meshopt.byteLength), binLength)) throw invalid(`meshopt view ${index} past the binary chunk`);
    }
    if (buffer !== 0) {
      if (!meshopt) throw invalid(`buffer view ${index} reads a fallback buffer`);
      return { bytes: null, length, stride };
    }
    if (!inside(offset, length, binLength)) throw invalid(`buffer view ${index} past the binary chunk`);
    return { bytes: bin!.subarray(offset, offset + length), length, stride };
  });
}

/** Accessors read inside their buffer views (matrices, padded by glTF's alignment rules, are left to the loader). */
function checkAccessors(gltf: Json, views: ViewInfo[]): Json[] {
  const accessors = list(gltf.accessors);
  accessors.forEach((accessor, index) => {
    const items = natural(accessor.count);
    if (accessor.bufferView === undefined) return;
    const view = views[natural(accessor.bufferView)];
    if (!view) throw invalid(`accessor ${index} names no buffer view`);
    const size = COMPONENT_BYTES[accessor.componentType as number];
    const components = TYPE_COMPONENTS[accessor.type as string];
    if (!size || !components) throw invalid(`accessor ${index} has an unknown type`);
    if (String(accessor.type).startsWith('MAT') || items === 0) return;
    const element = size * components;
    const needed = natural(accessor.byteOffset, 0) + (view.stride ?? element) * (items - 1) + element;
    if (needed > view.length) throw invalid(`accessor ${index} past its buffer view`);
  });
  return accessors;
}

/** Triangles drawn: every node that draws a mesh counts its triangles, times its instances. */
function triangles(gltf: Json, accessors: Json[]): number {
  const itemsOf = (index: unknown) => (typeof index === 'number' ? natural(accessors[index]?.count ?? 0) : 0);
  const meshTriangles = list(gltf.meshes).map((mesh) =>
    list(mesh.primitives).reduce((sum, primitive) => {
      const vertices = primitive.indices !== undefined ? itemsOf(primitive.indices) : itemsOf((primitive.attributes as Json | undefined)?.POSITION);
      const mode = primitive.mode ?? 4;
      if (mode === 4) return sum + Math.floor(vertices / 3);
      if (mode === 5 || mode === 6) return sum + Math.max(0, vertices - 2);
      return sum;
    }, 0),
  );
  return list(gltf.nodes).reduce((sum, node) => {
    if (typeof node.mesh !== 'number') return sum;
    const instancing = (node.extensions as Json | undefined)?.EXT_mesh_gpu_instancing as Json | undefined;
    const attributes = Object.values((instancing?.attributes as Json | undefined) ?? {});
    const instances = attributes.length > 0 ? itemsOf(attributes[0]) : 1;
    return sum + (meshTriangles[node.mesh] ?? 0) * instances;
  }, 0);
}

/** Embedded pictures: their bytes are the type they claim, and not too large to put on a phone's GPU. */
async function checkImages(gltf: Json, views: ViewInfo[]): Promise<void> {
  let pixels = 0;
  for (const [index, image] of list(gltf.images).entries()) {
    const view = views[natural(image.bufferView)];
    if (!view?.bytes) throw invalid(`image ${index} has no bytes in the file`);
    const declared = String(image.mimeType ?? '');
    if (!IMAGE_TYPES.has(declared) || sniffMediaType(view.bytes.subarray(0, 4096)) !== declared) {
      throw invalid(`image ${index} is not the ${declared || 'picture'} it claims to be`);
    }
    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = await sharp(view.bytes, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata());
    } catch {
      throw invalid(`image ${index} cannot be read`);
    }
    if (!width || !height) throw invalid(`image ${index} has no size`);
    if (Math.max(width, height) > MODEL_LIMITS.imageSide) throw new Refusal('MODEL_TOO_COMPLEX', `image ${index} is ${width}×${height}`);
    pixels += width * height;
  }
  if (pixels > MODEL_LIMITS.imagePixels) throw new Refusal('MODEL_TOO_COMPLEX', `${pixels} pixels of pictures`);
}

/** Checks a GLB and says what it holds, or why it is refused. */
export async function checkGlb(bytes: Uint8Array): Promise<{ ok: true; meta: ModelMeta } | { ok: false; reason: GlbRefusal; detail: string }> {
  try {
    const { json: gltf, bin } = chunks(bytes);
    if (!isObject(gltf.asset) || gltf.asset.version !== '2.0') throw invalid('not glTF 2.0');
    if (findUri(gltf)) throw new Refusal('MODEL_EXTERNAL', 'names a uri');
    const required = Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired : [];
    const unknown = required.filter((name) => typeof name !== 'string' || !requirable(name));
    if (unknown.length > 0) throw new Refusal('MODEL_EXTENSION', `requires ${unknown.join(', ')}`);

    const meta: ModelMeta = {
      triangles: 0,
      nodes: count(gltf.nodes),
      materials: count(gltf.materials),
      textures: count(gltf.textures),
      animations: count(gltf.animations),
    };
    for (const key of ['nodes', 'materials', 'textures', 'animations'] as const) {
      if (meta[key] > MODEL_LIMITS[key]) throw new Refusal('MODEL_TOO_COMPLEX', `${meta[key]} ${key}`);
    }
    const views = bufferViews(gltf, bin);
    const accessors = checkAccessors(gltf, views);
    meta.triangles = triangles(gltf, accessors);
    if (meta.triangles > MODEL_LIMITS.triangles) throw new Refusal('MODEL_TOO_COMPLEX', `${meta.triangles} triangles`);
    await checkImages(gltf, views);
    return { ok: true, meta };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason, detail: error.detail };
    return { ok: false, reason: 'MODEL_INVALID', detail: error instanceof Error ? error.message : 'unreadable' };
  }
}
