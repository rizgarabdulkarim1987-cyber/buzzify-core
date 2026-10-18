import sharp from 'sharp';

/**
 * Scene files built in the tests (spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 3): small, valid ones
 * by default, and every option a way to make one that a check must refuse.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a glTF document is free-form JSON
export type Gltf = Record<string, any>;

const pad4 = (length: number) => (4 - (length % 4)) % 4;

function u32(view: DataView, at: number, value: number) {
  view.setUint32(at, value, true);
}

/** A GLB from a glTF document and its binary chunk, as an exporter writes it. */
export function packGlb(gltf: Gltf, bin: Uint8Array | null): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = json.length + pad4(json.length);
  const binLength = bin ? bin.length + pad4(bin.length) : 0;
  const total = 12 + 8 + jsonLength + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46], 0); // glTF
  u32(view, 4, 2);
  u32(view, 8, total);
  u32(view, 12, jsonLength);
  u32(view, 16, 0x4e4f534a); // JSON
  out.set(json, 20);
  out.fill(0x20, 20 + json.length, 20 + jsonLength);
  if (bin) {
    const at = 20 + jsonLength;
    u32(view, at, binLength);
    u32(view, at + 4, 0x004e4942); // BIN
    out.set(bin, at + 8);
  }
  return out;
}

export interface GlbOptions {
  /** Triangles in the mesh (indices only: the check counts, it does not draw). */
  triangles?: number;
  /** Nodes that draw the mesh. */
  nodes?: number;
  /** An image embedded in the binary chunk, with the type it is declared as. */
  image?: { bytes: Uint8Array; mimeType: string };
  /** Positions stored the way `EXT_meshopt_compression` stores them, with a fallback buffer. */
  meshopt?: boolean;
  /** Changes to the document after it is built. */
  edit?: (gltf: Gltf) => void;
}

/** A GLB that draws one coloured triangle (or more), valid unless an option says otherwise. */
export function buildGlb(options: GlbOptions = {}): Uint8Array {
  const triangles = options.triangles ?? 1;
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array(triangles * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i % 3;

  const parts: Uint8Array[] = [];
  let length = 0;
  const add = (bytes: Uint8Array) => {
    const offset = length;
    parts.push(bytes);
    length += bytes.length;
    const padding = pad4(bytes.length);
    if (padding) {
      parts.push(new Uint8Array(padding));
      length += padding;
    }
    return { offset, length: bytes.length };
  };
  const positionView = add(new Uint8Array(positions.buffer));
  const indexView = add(new Uint8Array(indices.buffer));
  const imageView = options.image ? add(options.image.bytes) : null;
  const bin = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    bin.set(part, at);
    at += part.length;
  }

  const gltf: Gltf = {
    asset: { version: '2.0', generator: 'buzzify tests' },
    scene: 0,
    scenes: [{ nodes: Array.from({ length: options.nodes ?? 1 }, (_, i) => i) }],
    nodes: Array.from({ length: options.nodes ?? 1 }, () => ({ mesh: 0 })),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.2, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: positionView.offset, byteLength: positionView.length, target: 34962 },
      { buffer: 0, byteOffset: indexView.offset, byteLength: indexView.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  if (imageView && options.image) {
    gltf.bufferViews.push({ buffer: 0, byteOffset: imageView.offset, byteLength: imageView.length });
    gltf.images = [{ bufferView: 2, mimeType: options.image.mimeType }];
    gltf.textures = [{ source: 0 }];
    gltf.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  if (options.meshopt) {
    gltf.extensionsUsed = ['EXT_meshopt_compression'];
    gltf.extensionsRequired = ['EXT_meshopt_compression'];
    gltf.buffers.push({ byteLength: positionView.length, extensions: { EXT_meshopt_compression: { fallback: true } } });
    gltf.bufferViews[0] = {
      buffer: 1,
      byteOffset: 0,
      byteLength: positionView.length,
      extensions: {
        EXT_meshopt_compression: { buffer: 0, byteOffset: positionView.offset, byteLength: positionView.length, byteStride: 12, count: 3, mode: 'ATTRIBUTES' },
      },
    };
  }
  options.edit?.(gltf);
  return packGlb(gltf, bin);
}

/** A small PNG, for embedding. */
export async function smallPng(width = 8, height = 8): Promise<Uint8Array> {
  const png = await sharp({ create: { width, height, channels: 3, background: '#C9A227' } }).png().toBuffer();
  return new Uint8Array(png);
}

// MP4 -----------------------------------------------------------------------------------------------------------------

const ascii4 = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** An MP4 box: its size, its type and its body. `large` writes the 64-bit size form. */
export function box(type: string, body: Uint8Array | number[] = [], large = false): Uint8Array {
  const content = body instanceof Uint8Array ? body : new Uint8Array(body);
  const header = large ? 16 : 8;
  const out = new Uint8Array(header + content.length);
  const view = new DataView(out.buffer);
  if (large) {
    view.setUint32(0, 1);
    out.set(ascii4(type), 4);
    view.setBigUint64(8, BigInt(out.length));
  } else {
    view.setUint32(0, out.length);
    out.set(ascii4(type), 4);
  }
  out.set(content, header);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const u32be = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const zeros = (n: number) => new Array<number>(n).fill(0);

export interface Mp4Options {
  codec?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sound?: boolean;
  /** `moov` after `mdat`, as a phone writes it. */
  moovLast?: boolean;
  /** A fragmented file (a browser recorder's): `mvhd` says 0 and the fragments carry the time. */
  fragmented?: { fragments: number; msEach: number; defaultDuration?: boolean };
  /** No video track at all. */
  noVideo?: boolean;
  /** `mvhd` version 1 (64-bit times). */
  version1?: boolean;
}

const TIMESCALE = 1000;

function trak(id: number, handler: string, codec: string, width: number, height: number, durationMs: number): Uint8Array {
  // tkhd v0: flags, created, modified, track id, reserved, duration, reserved, layer, group, volume, reserved, matrix, width, height
  const tkhd = box('tkhd', [0, 0, 0, 3, ...zeros(8), ...u32be(id), ...zeros(4), ...u32be(durationMs), ...zeros(8), ...zeros(8), ...zeros(36), ...u32be(width * 65536), ...u32be(height * 65536)]);
  const mdhd = box('mdhd', [0, 0, 0, 0, ...zeros(8), ...u32be(TIMESCALE), ...u32be(durationMs), 0x55, 0xc4, 0, 0]);
  const hdlr = box('hdlr', [0, 0, 0, 0, ...zeros(4), ...ascii4(handler), ...zeros(12), 0]);
  const entry = box(codec, zeros(70));
  const stsd = box('stsd', [0, 0, 0, 0, ...u32be(1), ...entry]);
  const minf = box('minf', box('stbl', stsd));
  return box('trak', concat(tkhd, box('mdia', concat(mdhd, hdlr, minf))));
}

/** A minimal MP4 with the boxes the check reads, valid unless an option says otherwise. */
export function buildMp4(options: Mp4Options = {}): Uint8Array {
  const durationMs = options.fragmented ? 0 : (options.durationMs ?? 8000);
  const ftyp = box('ftyp', [...ascii4('isom'), 0, 0, 2, 0, ...ascii4('isomiso2avc1mp41')]);
  const mvhd = options.version1
    ? box('mvhd', [1, 0, 0, 0, ...zeros(16), ...u32be(TIMESCALE), 0, 0, 0, 0, ...u32be(durationMs), ...zeros(80)])
    : box('mvhd', [0, 0, 0, 0, ...zeros(8), ...u32be(TIMESCALE), ...u32be(durationMs), ...zeros(80)]);
  const tracks: Uint8Array[] = [];
  if (!options.noVideo) tracks.push(trak(1, 'vide', options.codec ?? 'avc1', options.width ?? 1080, options.height ?? 1920, durationMs));
  if (options.sound) tracks.push(trak(2, 'soun', 'mp4a', 0, 0, durationMs));
  const mvex = options.fragmented ? [box('mvex', box('trex', [0, 0, 0, 0, ...u32be(1), ...zeros(16)]))] : [];
  const moov = box('moov', concat(mvhd, ...tracks, ...mvex));
  const mdat = box('mdat', zeros(64));

  if (options.fragmented) {
    const { fragments, msEach, defaultDuration } = options.fragmented;
    const samples = 2;
    const each = msEach / samples;
    const moofs = Array.from({ length: fragments }, (_, i) => {
      // tfhd flags: 0x020000 (default-base-is-moof), and 0x000008 (default sample duration) when asked.
      const tfhd = defaultDuration ? box('tfhd', [0, 2, 0, 8, ...u32be(1), ...u32be(each)]) : box('tfhd', [0, 2, 0, 0, ...u32be(1)]);
      const tfdt = box('tfdt', [0, 0, 0, 0, ...u32be(i * msEach)]);
      // trun flags: 0x000100 (each sample's duration) unless the default is used.
      const trun = defaultDuration
        ? box('trun', [0, 0, 0, 0, ...u32be(samples)])
        : box('trun', [0, 0, 1, 0, ...u32be(samples), ...Array.from({ length: samples }, () => u32be(each)).flat()]);
      const moof = box('moof', concat(box('mfhd', [0, 0, 0, 0, ...u32be(i + 1)]), box('traf', concat(tfhd, tfdt, trun))));
      return concat(moof, box('mdat', zeros(16)));
    });
    return concat(ftyp, moov, ...moofs);
  }
  return options.moovLast ? concat(ftyp, mdat, moov) : concat(ftyp, moov, mdat);
}
