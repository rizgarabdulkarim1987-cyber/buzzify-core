import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { checkGlb } from '@/server/media/glb';
import { buildGlb, packGlb, smallPng, type Gltf } from '../helpers/scene-files';

/** Spec 2026-10-18-template-studio-stage-2-scene-files-design.md, 3.2: a GLB is parsed and checked, never executed. */

async function refusal(bytes: Uint8Array) {
  const result = await checkGlb(bytes);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

const edited = (edit: (gltf: Gltf) => void) => buildGlb({ edit });

describe('checkGlb', () => {
  it('accepts a small model and says what it holds', async () => {
    const result = await checkGlb(buildGlb({ triangles: 4, nodes: 2, image: { bytes: await smallPng(), mimeType: 'image/png' } }));
    expect(result).toEqual({ ok: true, meta: { triangles: 8, nodes: 2, materials: 1, textures: 1, animations: 0 } });
  });

  it('accepts a meshopt file with a fallback buffer', async () => {
    expect((await checkGlb(buildGlb({ meshopt: true }))).ok).toBe(true);
  });

  it.each([
    ['KHR_mesh_quantization'],
    ['KHR_texture_transform'],
    ['EXT_texture_webp'],
    ['KHR_materials_emissive_strength'],
  ])('accepts %s as a required extension', async (name) => {
    expect((await checkGlb(edited((g) => (g.extensionsRequired = [name])))).ok).toBe(true);
  });

  describe('refuses a file that is not a GLB', () => {
    it('bad magic', async () => {
      const bytes = buildGlb();
      bytes[0] = 0x00;
      expect(await refusal(bytes)).toBe('MODEL_INVALID');
    });

    it('version 1', async () => {
      const bytes = buildGlb();
      bytes[4] = 1;
      expect(await refusal(bytes)).toBe('MODEL_INVALID');
    });

    it('a length that is not the file', async () => {
      expect(await refusal(buildGlb().subarray(0, 100))).toBe('MODEL_INVALID');
    });

    it('a chunk that runs past the end', async () => {
      const bytes = buildGlb();
      new DataView(bytes.buffer).setUint32(12, 1_000_000, true);
      expect(await refusal(bytes)).toBe('MODEL_INVALID');
    });

    it('a JSON chunk that is not JSON', async () => {
      const bytes = buildGlb();
      bytes[20] = 0x5b; // [
      bytes[21] = 0x5b;
      expect(await refusal(bytes)).toBe('MODEL_INVALID');
    });

    it('glTF 1.0 in a version 2 container', async () => {
      expect(await refusal(edited((g) => (g.asset.version = '1.0')))).toBe('MODEL_INVALID');
    });
  });

  describe('refuses anything outside the file', () => {
    it.each([
      ['a buffer by link', (g: Gltf) => (g.buffers[0].uri = 'https://example.com/scene.bin')],
      ['a buffer as a data URI', (g: Gltf) => (g.buffers[0].uri = 'data:application/octet-stream;base64,AAAA')],
      ['an image by link', (g: Gltf) => (g.images = [{ uri: 'textures/wood.png' }])],
      ['a link inside an extension', (g: Gltf) => (g.extensions = { VENDOR_thing: { nested: [{ uri: 'https://example.com/x' }] } })],
    ])('%s', async (_, edit) => {
      expect(await refusal(edited(edit))).toBe('MODEL_EXTERNAL');
    });
  });

  it('refuses a buffer view past the binary chunk', async () => {
    expect(await refusal(edited((g) => (g.bufferViews[1].byteLength = 1_000_000)))).toBe('MODEL_INVALID');
  });

  it('refuses an accessor past its buffer view', async () => {
    expect(await refusal(edited((g) => (g.accessors[0].count = 400)))).toBe('MODEL_INVALID');
  });

  it('refuses a second buffer that is not a meshopt fallback', async () => {
    expect(await refusal(edited((g) => g.buffers.push({ byteLength: 16 })))).toBe('MODEL_INVALID');
  });

  it.each([['KHR_draco_mesh_compression'], ['KHR_texture_basisu'], ['VENDOR_custom']])('refuses %s as a required extension', async (name) => {
    expect(await refusal(edited((g) => (g.extensionsRequired = [name])))).toBe('MODEL_EXTENSION');
  });

  it('refuses an image whose bytes are not its declared type', async () => {
    expect(await refusal(buildGlb({ image: { bytes: await smallPng(), mimeType: 'image/jpeg' } }))).toBe('MODEL_INVALID');
  });

  it('refuses an image that is not a picture at all', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    expect(await refusal(buildGlb({ image: { bytes: html, mimeType: 'image/png' } }))).toBe('MODEL_INVALID');
  });

  it('refuses an image wider than 4096 px', async () => {
    const wide = new Uint8Array(await sharp({ create: { width: 4097, height: 4, channels: 3, background: '#000' } }).png().toBuffer());
    expect(await refusal(buildGlb({ image: { bytes: wide, mimeType: 'image/png' } }))).toBe('MODEL_TOO_COMPLEX');
  });

  it('refuses more than 300,000 triangles, counted for every node that draws them', async () => {
    expect((await checkGlb(buildGlb({ triangles: 150_000, nodes: 2 }))).ok).toBe(true);
    expect(await refusal(buildGlb({ triangles: 150_001, nodes: 2 }))).toBe('MODEL_TOO_COMPLEX');
  });

  it('refuses more than 2,000 nodes', async () => {
    expect(await refusal(edited((g) => (g.nodes = Array.from({ length: 2001 }, () => ({})))))).toBe('MODEL_TOO_COMPLEX');
  });

  it('refuses more than 64 materials, 32 textures or 32 animations', async () => {
    expect(await refusal(edited((g) => (g.materials = Array.from({ length: 65 }, () => ({})))))).toBe('MODEL_TOO_COMPLEX');
    expect(await refusal(edited((g) => (g.textures = Array.from({ length: 33 }, () => ({})))))).toBe('MODEL_TOO_COMPLEX');
    expect(await refusal(edited((g) => (g.animations = Array.from({ length: 33 }, () => ({ channels: [], samplers: [] })))))).toBe('MODEL_TOO_COMPLEX');
  });

  it('refuses a file without a binary chunk whose buffer needs one', async () => {
    const gltf = { asset: { version: '2.0' }, buffers: [{ byteLength: 12 }] };
    expect(await refusal(packGlb(gltf, null))).toBe('MODEL_INVALID');
  });
});
